// F013 T014: Skill 下发（design.md §3 不变量 C）。下发身份属于安装
// (runtime_id, cli_provider)，不属于 project-scoped 的 agent_configs 行；
// 候选安装 = 该 runtime 上 agent_configs.cli_provider 出现过的去重集合（同一
// provider 多配置只产生一行）。激活事务不包含下发：激活先提交（每个候选安装
// 写 pending），下发在其后逐安装执行，单个失败不回滚激活、不影响其他安装，
// 重试按行幂等重放。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
 * YAML 标量安全序列化：JSON 字符串字面量是合法的 YAML double-quoted scalar
 * （同一套 `\"` / `\\` / `\n` / `\uXXXX` 转义），因此冒号、井号、引号、换行与
 * 控制字符都不会破坏 frontmatter。R1-012：直接拼接会让 `Release: production`
 * 这类 description 生成无效/歧义 YAML。
 */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** Agent Skills 生态（Claude Code / OpenCode）要求 name 为 lowercase hyphen
 * 分隔且 ≤64 字符，并与目录名一致；过长时截断并附 skill id 哈希保持唯一。 */
export function providerSafeSkillName(skillId: string, version: number): string {
  const safeId =
    skillId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill";
  const suffix = `-v${version}`;
  const full = `personahub-${safeId}${suffix}`;
  if (full.length <= 64) return full;
  const hash = createHash("sha256").update(skillId).digest("hex").slice(0, 8);
  const maxIdLength = Math.max(8, 64 - "personahub-".length - hash.length - 1 - suffix.length);
  return `personahub-${safeId.slice(0, maxIdLength)}-${hash}${suffix}`;
}

const MAX_NATIVE_DESCRIPTION_LENGTH = 1024;

/** description 必须是单行、非空、≤1024 字符（两个发现端都会过滤超限/缺失项）。 */
function nativeDescription(revision: { title: string | null; description?: string | null }): string {
  const singleLine = (revision.description ?? revision.title ?? "PersonaHub Skill").replace(/[\r\n]+/g, " ").trim();
  const text = singleLine === "" ? "PersonaHub Skill" : singleLine;
  return text.length > MAX_NATIVE_DESCRIPTION_LENGTH
    ? `${text.slice(0, MAX_NATIVE_DESCRIPTION_LENGTH - 1)}…`
    : text;
}

function renderRequirementLine(requirement: Record<string, unknown>): string {
  const id = typeof requirement.id === "string" ? requirement.id : "(id)";
  const strength = typeof requirement.strength === "string" ? requirement.strength : "hard";
  const tags = Array.isArray(requirement.tags) ? (requirement.tags as string[]) : [];
  const description =
    typeof requirement.description === "string" ? requirement.description.replace(/[\r\n]+/g, " ").trim() : "";
  const tagPart = tags.length > 0 ? ` tags=${tags.join(",")}` : "";
  const descriptionPart = description ? ` — ${description}` : "";
  return `- ${id} [${strength}]${tagPart}${descriptionPart}`;
}

/**
 * 翻译协议：把 revision 的 steps + completion requirements 渲染成该 CLI 的
 * 原生指令文件（CLAUDE.md 的姊妹格式 SKILL.md：YAML frontmatter + markdown
 * 正文）。纯函数（输入 revision 内容，输出字节 + 格式名 + 期望 frontmatter），
 * 可单测；`name` / `description` 供写后读回校验使用。
 */
export function renderNativeInstructions(
  cliProvider: string,
  revision: { title: string | null; description?: string | null; steps: unknown; completion_requirements: unknown },
  identity: { skillId: string; version: number },
): { native_format: string; bytes: Buffer; name: string; description: string } | null {
  const KNOWN = new Set(["codex", "claude", "opencode"]);
  if (!KNOWN.has(cliProvider)) return null;

  const lines: string[] = [];
  const name = providerSafeSkillName(identity.skillId, identity.version);
  const description = nativeDescription(revision);
  lines.push("---");
  lines.push(`name: ${yamlScalar(name)}`);
  lines.push(`description: ${yamlScalar(description)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${revision.title ?? "PersonaHub Skill"}`);
  lines.push("");
  const steps = Array.isArray(revision.steps) ? revision.steps : [];
  if (steps.length > 0) {
    lines.push("## Steps");
    const sorted = [...(steps as Array<Record<string, unknown>>)].sort(
      (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0),
    );
    for (const step of sorted) {
      lines.push("");
      lines.push(`### ${String(step.order ?? 0)}. ${String(step.title ?? "(step)")}`);
      lines.push(`- Step ID: ${String(step.id ?? "(id)")}`);
      const stepRequirements = Array.isArray(step.requirements) ? (step.requirements as Array<Record<string, unknown>>) : [];
      if (stepRequirements.length === 0) {
        lines.push("- Requirements: (none)");
      } else {
        lines.push("- Requirements:");
        for (const requirement of stepRequirements) {
          lines.push(`  ${renderRequirementLine(requirement)}`);
        }
      }
    }
    lines.push("");
  }
  const requirements = Array.isArray(revision.completion_requirements) ? revision.completion_requirements : [];
  if (requirements.length > 0) {
    lines.push("## Completion Requirements");
    for (const requirement of requirements as Array<Record<string, unknown>>) {
      lines.push(renderRequirementLine(requirement));
    }
    lines.push("");
  }
  return {
    native_format: "skill-md",
    bytes: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
    name,
    description,
  };
}

/**
 * 写后读回校验（R1-012）：只有 frontmatter 能被重新解析且 name/description
 * 与渲染意图逐字一致，才允许报告 `delivered`；否则该行落 `failed`。
 */
export function parseDeliveredFrontmatter(bytes: Buffer): { name: string; description: string } | null {
  const text = bytes.toString("utf8");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const frontmatter = text.slice(4, end);
  const nameMatch = /^name: (.*)$/m.exec(frontmatter);
  const descriptionMatch = /^description: (.*)$/m.exec(frontmatter);
  if (!nameMatch || !descriptionMatch) return null;
  try {
    const name = JSON.parse(nameMatch[1]) as unknown;
    const description = JSON.parse(descriptionMatch[1]) as unknown;
    if (typeof name !== "string" || typeof description !== "string") return null;
    return { name, description };
  } catch {
    return null;
  }
}

function nativeSkillsDirectory(provider: string): string | null {
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  const base =
    provider === "codex"
      ? (process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
      : provider === "claude"
        ? (process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"))
        : provider === "opencode"
          ? (process.env.OPENCODE_CONFIG_DIR ?? path.join(configHome, "opencode"))
          : null;
  return base ? path.join(base, "skills") : null;
}

export class SkillDeliveryService {
  constructor(
    private db: Database.Database,
    private audit: AuditService,
    /** 仅测试注入隔离根目录；生产路径由各 CLI 的原生配置目录决定。 */
    private deliveryRoot?: string,
  ) {}

  /** 候选安装：该 runtime 上出现过的 cli_provider 去重集合。 */
  listCandidateInstallations(_runtimeId: string = LOCAL_RUNTIME_ID): string[] {
    return (
      this.db.prepare("SELECT DISTINCT cli_provider FROM agent_configs ORDER BY cli_provider ASC").all() as Array<{
        cli_provider: string;
      }>
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
      this.audit.record("skill.delivery_pending", "skill", skillId, {
        runtime_id: runtimeId,
        cli_provider: provider,
        version,
      });
    }
  }

  /** 逐安装执行下发；幂等重放；单行失败只落在本行。 */
  deliverAll(skillId: string, version: number, runtimeId: string = LOCAL_RUNTIME_ID): void {
    const revision = this.db
      .prepare(
        "SELECT title, description, steps_json, completion_requirements_json FROM skill_revisions WHERE skill_id = ? AND version = ?",
      )
      .get(skillId, version) as
      | {
          title: string | null;
          description: string | null;
          steps_json: string | null;
          completion_requirements_json: string | null;
        }
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

  deliverOne(skillId: string, version: number, runtimeId: string, cliProvider: string): DeliveryOutcome {
    const revision = this.db
      .prepare(
        "SELECT title, description, steps_json, completion_requirements_json FROM skill_revisions WHERE skill_id = ? AND version = ? AND published_at IS NOT NULL",
      )
      .get(skillId, version) as
      | {
          title: string | null;
          description: string | null;
          steps_json: string | null;
          completion_requirements_json: string | null;
        }
      | undefined;
    if (!revision) {
      return { state: "failed", target_path: null, native_format: null, detail: "revision not found or unpublished" };
    }

    let outcome: DeliveryOutcome;
    try {
      const rendered = renderNativeInstructions(
        cliProvider,
        {
          title: revision.title,
          description: revision.description,
          steps: revision.steps_json ? JSON.parse(revision.steps_json) : null,
          completion_requirements: revision.completion_requirements_json
            ? JSON.parse(revision.completion_requirements_json)
            : [],
        },
        { skillId, version },
      );
      if (!rendered) {
        outcome = {
          state: "unsupported",
          target_path: null,
          native_format: null,
          detail: `no renderer for ${cliProvider}`,
        };
      } else {
        const nativeRoot = this.deliveryRoot
          ? path.join(this.deliveryRoot, runtimeId, cliProvider, "skills")
          : nativeSkillsDirectory(cliProvider);
        if (!nativeRoot) throw new Error(`no native skill directory for ${cliProvider}`);
        const targetDir = path.join(nativeRoot, providerSafeSkillName(skillId, version));
        fs.mkdirSync(targetDir, { recursive: true });
        const targetPath = path.join(targetDir, "SKILL.md");
        const tempPath = path.join(targetDir, `.SKILL.md.${randomUUID()}.tmp`);
        try {
          fs.writeFileSync(tempPath, rendered.bytes, { flag: "wx" });
          const written = fs.readFileSync(tempPath);
          if (!written.equals(rendered.bytes)) throw new Error("native skill verification failed");
          fs.renameSync(tempPath, targetPath);
        } finally {
          fs.rmSync(tempPath, { force: true });
        }
        const verified = fs.readFileSync(targetPath);
        if (!verified.equals(rendered.bytes)) throw new Error("native skill verification failed");
        const frontmatter = parseDeliveredFrontmatter(verified);
        if (
          !frontmatter ||
          frontmatter.name !== rendered.name ||
          frontmatter.description !== rendered.description
        ) {
          throw new Error("native skill verification failed: frontmatter does not round-trip");
        }
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

  list(
    skillId: string,
    version: number,
  ): Array<{
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
