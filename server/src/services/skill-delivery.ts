// F013 T014: Skill 下发（design.md §3 不变量 C）。下发身份属于安装
// (runtime_id, cli_provider)，不属于 project-scoped 的 agent_configs 行；
// 候选安装 = 该 runtime 上 agent_configs.cli_provider 出现过的去重集合（同一
// provider 多配置只产生一行）。激活事务不包含下发：激活先提交（每个候选安装
// 写 pending），下发在其后逐安装执行，单个失败不回滚激活、不影响其他安装，
// 重试按行幂等重放。

import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { LOCAL_RUNTIME_ID } from "./repository-registry.js";
import { AuditService } from "./audit.js";

export interface DeliveryOutcome {
  state: "delivered" | "unsupported" | "failed";
  target_path: string | null;
  native_format: string | null;
  detail: string | null;
}

/**
 * 翻译协议：把 revision 的 steps + completion requirements 渲染成该 CLI 的
 * 原生指令文件。纯函数（输入 revision 内容，输出字节 + 格式名），可单测。
 * v0.3 三种 provider 统一渲染为 markdown 指令摘要；未来按 CLI 分化。
 */
export function renderNativeInstructions(
  cliProvider: string,
  revision: { title: string | null; steps: unknown; completion_requirements: unknown },
): { native_format: string; bytes: Buffer } | null {
  const KNOWN = new Set(["codex", "claude", "opencode"]);
  if (!KNOWN.has(cliProvider)) return null;

  const lines: string[] = [];
  lines.push(`# PersonaHub Skill Instructions — ${revision.title ?? "(untitled)"}`);
  lines.push("");
  const steps = Array.isArray(revision.steps) ? revision.steps : [];
  if (steps.length > 0) {
    lines.push("## Steps");
    const sorted = [...(steps as Array<{ order?: number; title?: string }>)].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    for (const step of sorted) {
      lines.push(`- ${step.title ?? "(step)"}`);
    }
    lines.push("");
  }
  const requirements = Array.isArray(revision.completion_requirements) ? revision.completion_requirements : [];
  if (requirements.length > 0) {
    lines.push("## Completion Requirements");
    for (const requirement of requirements as Array<{ id?: string; description?: string; tags?: string[] }>) {
      const tags = (requirement.tags ?? []).join(", ");
      lines.push(`- ${requirement.id ?? "(id)"}${tags ? ` [${tags}]` : ""}${requirement.description ? ` — ${requirement.description}` : ""}`);
    }
    lines.push("");
  }
  return { native_format: "markdown", bytes: Buffer.from(lines.join("\n"), "utf8") };
}

export class SkillDeliveryService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    /** 下发根目录（每个 CLI 安装一个约定位置）。测试注入临时目录。 */
    private deliveryRoot: string,
  ) {}

  /** 候选安装：该 runtime 上出现过的 cli_provider 去重集合。 */
  listCandidateInstallations(_runtimeId: string = LOCAL_RUNTIME_ID): string[] {
    return (
      this.db
        .prepare("SELECT DISTINCT cli_provider FROM agent_configs ORDER BY cli_provider ASC")
        .all() as Array<{ cli_provider: string }>
    )
      .map((row) => row.cli_provider)
      .filter((provider) => provider !== "fake" || process.env.PERSONAHUB_ALLOW_FAKE_DELIVERY === "1");
  }

  /** 激活事务提交后调用：为每个候选安装登记 pending（幂等 upsert）。 */
  enqueuePending(skillId: string, version: number, runtimeId: string = LOCAL_RUNTIME_ID): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO skill_delivery_status (skill_id, version, runtime_id, cli_provider, state, target_path, native_format, detail, attempted_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?)
       ON CONFLICT (skill_id, version, runtime_id, cli_provider) DO UPDATE SET
         state = 'pending', target_path = NULL, native_format = NULL, detail = NULL, updated_at = excluded.updated_at`,
    );
    for (const provider of this.listCandidateInstallations(runtimeId)) {
      stmt.run(skillId, version, runtimeId, provider, now);
      this.audit.record("skill.delivery_pending", "skill", skillId, { runtime_id: runtimeId, cli_provider: provider, version });
    }
  }

  /** 逐安装执行下发；幂等重放；单行失败只落在本行。 */
  deliverAll(skillId: string, version: number, runtimeId: string = LOCAL_RUNTIME_ID): void {
    const revision = this.db
      .prepare("SELECT title, steps_json, completion_requirements_json FROM skill_revisions WHERE skill_id = ? AND version = ?")
      .get(skillId, version) as
      | { title: string | null; steps_json: string | null; completion_requirements_json: string | null }
      | undefined;
    if (!revision) return;

    const pending = this.db
      .prepare(
        "SELECT cli_provider FROM skill_delivery_status WHERE skill_id = ? AND version = ? AND runtime_id = ? ORDER BY cli_provider ASC",
      )
      .all(skillId, version, runtimeId) as Array<{ cli_provider: string }>;

    for (const { cli_provider } of pending) {
      this.deliverOne(skillId, version, runtimeId, cli_provider);
    }
  }

  deliverOne(
    skillId: string,
    version: number,
    runtimeId: string,
    cliProvider: string,
  ): DeliveryOutcome {
    const revision = this.db
      .prepare("SELECT title, steps_json, completion_requirements_json FROM skill_revisions WHERE skill_id = ? AND version = ? AND published_at IS NOT NULL")
      .get(skillId, version) as
      | { title: string | null; steps_json: string | null; completion_requirements_json: string | null }
      | undefined;
    if (!revision) {
      return { state: "failed", target_path: null, native_format: null, detail: "revision not found or unpublished" };
    }

    let outcome: DeliveryOutcome;
    try {
      const rendered = renderNativeInstructions(cliProvider, {
        title: revision.title,
        steps: revision.steps_json ? JSON.parse(revision.steps_json) : null,
        completion_requirements: revision.completion_requirements_json
          ? JSON.parse(revision.completion_requirements_json)
          : [],
      });
      if (!rendered) {
        outcome = { state: "unsupported", target_path: null, native_format: null, detail: `no renderer for ${cliProvider}` };
      } else {
        const targetDir = path.join(this.deliveryRoot, runtimeId, cliProvider);
        fs.mkdirSync(targetDir, { recursive: true });
        const targetPath = path.join(targetDir, `skill-${skillId}-v${version}.${rendered.native_format === "markdown" ? "md" : "txt"}`);
        fs.writeFileSync(targetPath, rendered.bytes);
        outcome = { state: "delivered", target_path: targetPath, native_format: rendered.native_format, detail: null };
      }
    } catch (error) {
      outcome = {
        state: "failed",
        target_path: null,
        native_format: null,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE skill_delivery_status
         SET state = ?, target_path = ?, native_format = ?, detail = ?, attempted_at = ?, updated_at = ?
         WHERE skill_id = ? AND version = ? AND runtime_id = ? AND cli_provider = ?`,
      )
      .run(
        outcome.state,
        outcome.target_path,
        outcome.native_format,
        outcome.detail,
        now,
        now,
        skillId,
        version,
        runtimeId,
        cliProvider,
      );

    const eventByState = {
      delivered: "skill.delivery_succeeded",
      unsupported: "skill.delivery_unsupported",
      failed: "skill.delivery_failed",
    } as const;
    this.audit.record(eventByState[outcome.state], "skill", skillId, {
      runtime_id: runtimeId,
      cli_provider: cliProvider,
      version,
      target_path: outcome.target_path,
      detail: outcome.detail,
    });
    return outcome;
  }

  list(skillId: string, version: number): Array<{
    skill_id: string;
    version: number;
    runtime_id: string;
    cli_provider: string;
    state: string;
    target_path: string | null;
    native_format: string | null;
    detail: string | null;
    attempted_at: string | null;
    updated_at: string;
  }> {
    return this.db
      .prepare(
        "SELECT * FROM skill_delivery_status WHERE skill_id = ? AND version = ? ORDER BY runtime_id, cli_provider ASC",
      )
      .all(skillId, version) as Array<{
      skill_id: string;
      version: number;
      runtime_id: string;
      cli_provider: string;
      state: string;
      target_path: string | null;
      native_format: string | null;
      detail: string | null;
      attempted_at: string | null;
      updated_at: string;
    }>;
  }
}
