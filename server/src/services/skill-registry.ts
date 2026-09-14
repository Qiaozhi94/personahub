// F013 T011/T013: SkillRegistry——Skill revision 创建、激活、禁用、扫描与冲突
// 判定的唯一入口（ADR 0014 单一激活路径，design.md §2 / §3）。
//
// 写入时序（不变量 A）：先插 revision（构建期，published_at NULL）→ 写文件 →
// 置 published_at（冻结）→ 再插/更新 skills 行；skills 侧的 published 检查是
// 即时 trigger，revision → skills 的 FK 是 DEFERRABLE，两个方向在事务末合拢。

import path from "node:path";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { ErrorCode } from "@personahub/shared/errors";
import type { Skill, SkillListItem, SkillRevision } from "@personahub/shared/types";
import { AppError } from "../api/errors.js";
import { generateSkillId } from "../id.js";
import { AuditService } from "./audit.js";
import { canonicalJson } from "./skill-content.js";
import {
  mergeRequirements,
  parseRevisionContent,
  SkillSchemaError,
  type ParsedRevisionContent,
} from "./skill-revision-schema.js";
import {
  computeGroupStates,
  listAllSpaceIds,
  listCandidatesForSpace,
  upsertSpaceStates,
  type SkillGroupCandidate,
} from "./skill-space-state.js";

export interface RevisionDraftInput {
  title?: string | null;
  description?: string | null;
  capability_tags?: string[];
  steps?: unknown[] | null;
  completion_requirements?: unknown[] | null;
  source_locator?: string | null;
  files?: Array<{ rel_path: string; content: Buffer | string }>;
}

/** 单文件与总量上限（design §3：默认 1 MiB / 10 MiB）。 */
export const SKILL_FILE_MAX_BYTES = 1024 * 1024;
export const SKILL_FILES_TOTAL_MAX_BYTES = 10 * 1024 * 1024;

interface RevisionRow {
  skill_id: string;
  version: number;
  title: string | null;
  description: string | null;
  capability_tags_json: string;
  steps_json: string | null;
  completion_requirements_json: string | null;
  source_locator: string | null;
  content_hash: string;
  published_at: string | null;
  created_at: string;
}

function mapRevision(row: RevisionRow): SkillRevision {
  let steps: unknown = null;
  if (row.steps_json) {
    try {
      steps = JSON.parse(row.steps_json);
    } catch {
      steps = null;
    }
  }
  const stepCount = Array.isArray(steps) ? steps.length : 0;
  let requirementCount = 0;
  if (row.completion_requirements_json) {
    try {
      const parsed = JSON.parse(row.completion_requirements_json);
      requirementCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      requirementCount = 0;
    }
  }
  return {
    skill_id: row.skill_id,
    version: row.version,
    title: row.title,
    description: row.description,
    capability_tags: JSON.parse(row.capability_tags_json ?? "[]") as string[],
    has_steps: row.steps_json !== null,
    step_count: stepCount,
    requirement_count: requirementCount,
    source_locator: row.source_locator,
    content_hash: row.content_hash,
    published_at: row.published_at,
    created_at: row.created_at,
  };
}

/** 经验内容哈希：规范化 JSON 的 SHA-256（不含 files，文件各自有 hash）。 */
export function revisionContentHash(content: {
  title: string | null;
  steps: unknown;
  capability_tags: string[];
  completion_requirements: unknown;
}): string {
  return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}

export class SkillRegistry {
  constructor(
    protected db: Database.Database,
    protected audit: AuditService,
  ) {}

  // ---- 读取（构建期 revision 对外不存在：一律过滤 published_at IS NOT NULL）----

  listForSpace(spaceId: string): SkillListItem[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, t.state AS space_state FROM skills s
         LEFT JOIN skill_space_state t ON t.skill_id = s.id AND t.space_id = ?
         ORDER BY s.display_name COLLATE NOCASE ASC, s.id ASC`,
      )
      .all(spaceId) as Array<Skill & { space_state: string | null }>;
    return rows.map((row) => ({
      ...row,
      space_state: (row.space_state ?? null) as SkillListItem["space_state"],
    }));
  }

  listRevisions(skillId: string): SkillRevision[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM skill_revisions WHERE skill_id = ? AND published_at IS NOT NULL ORDER BY version ASC",
      )
      .all(skillId) as RevisionRow[];
    return rows.map(mapRevision);
  }

  getRevision(skillId: string, version: number): { revision: SkillRevision; content: ParsedRevisionContent } {
    const row = this.db
      .prepare(
        "SELECT * FROM skill_revisions WHERE skill_id = ? AND version = ? AND published_at IS NOT NULL",
      )
      .get(skillId, version) as RevisionRow | undefined;
    if (!row) {
      throw new AppError(ErrorCode.SKILL_REVISION_NOT_FOUND, "Skill revision not found.");
    }
    const content = this.parsePublished(row);
    return {
      revision: mapRevision(row),
      content,
    };
  }

  getRevisionFiles(skillId: string, version: number): Array<{ rel_path: string; content_hash: string; size_bytes: number }> {
    this.assertRevisionPublished(skillId, version);
    return this.db
      .prepare(
        "SELECT rel_path, content_hash, size_bytes FROM skill_revision_files WHERE skill_id = ? AND version = ? ORDER BY rel_path ASC",
      )
      .all(skillId, version) as Array<{ rel_path: string; content_hash: string; size_bytes: number }>;
  }

  /**
   * 读取单个快照文件正文：用 content_hash 核验快照自身，不一致报
   * SKILL_FILE_HASH_MISMATCH，不返回可疑正文（design §3）。
   * 源目录事后失联不影响可读性——正文在激活时已入库。
   */
  readRevisionFile(skillId: string, version: number, relPath: string): { rel_path: string; content: Buffer; content_hash: string } {
    this.assertRevisionPublished(skillId, version);
    const row = this.db
      .prepare("SELECT rel_path, content, content_hash FROM skill_revision_files WHERE skill_id = ? AND version = ? AND rel_path = ?")
      .get(skillId, version, relPath) as { rel_path: string; content: Buffer; content_hash: string } | undefined;
    if (!row) {
      throw new AppError(ErrorCode.SKILL_REVISION_NOT_FOUND, "Skill revision file not found.");
    }
    const actual = createHash("sha256").update(row.content).digest("hex");
    if (actual !== row.content_hash) {
      throw new AppError(ErrorCode.SKILL_FILE_HASH_MISMATCH, `Snapshot hash mismatch for ${relPath}`);
    }
    return { rel_path: row.rel_path, content: row.content, content_hash: row.content_hash };
  }

  private assertRevisionPublished(skillId: string, version: number): void {
    const row = this.db
      .prepare("SELECT published_at FROM skill_revisions WHERE skill_id = ? AND version = ?")
      .get(skillId, version) as { published_at: string | null } | undefined;
    if (!row || row.published_at === null) {
      throw new AppError(ErrorCode.SKILL_REVISION_NOT_FOUND, "Skill revision not found.");
    }
  }

  /** 构建期内容可能不满足 canonical schema（legacy）；读取端按宽松解析。 */
  protected parsePublished(row: RevisionRow): ParsedRevisionContent {
    return parseRevisionContent(
      {
        steps_json: row.steps_json,
        capability_tags_json: row.capability_tags_json,
        completion_requirements_json: row.completion_requirements_json,
      },
      { requireCompletionEvidence: false },
    );
  }

  // ---- 写入：创建 / 激活 / 禁用 / 扫描 / 冲突消解 ----

  /**
   * 创建用户 Skill 并插入 revision 1（同一事务；构建期 + 激活一步完成）。
   * 新 Skill 默认归属当前选中 Space（private）；步骤非空即编组（FR-005）。
   */
  createSkill(input: {
    display_name: string;
    space_id?: string | null;
    source_kind?: "user";
    draft: RevisionDraftInput;
  }): { skill: Skill; version: number } {
    const displayName = input.display_name?.trim();
    if (!displayName) {
      throw new AppError(ErrorCode.SKILL_SCHEMA_INVALID, "Skill display name is required.", "display_name");
    }

    return this.db.transaction(() => {
      const skillId = generateSkillId();
      const now = new Date().toISOString();

      // 1) 构建：校验 schema → 插 revision（构建期）→ 快照文件。
      const stored = this.validateDraft(input.draft);
      const version = 1;
      this.insertRevisionRow(skillId, version, displayName, stored, input.draft.source_locator ?? null, now);
      this.snapshotFiles(skillId, version, input.draft.files ?? [], stored);

      // 2) 冻结 + skills 行（immediate trigger 要求 revision 已发布）。
      this.publishRevision(skillId, version, now);
      this.db
        .prepare(
          `INSERT INTO skills (id, space_id, display_name, source_kind, source_identity, current_revision, state, created_at, updated_at)
           VALUES (?, ?, ?, 'user', ?, 1, 'active', ?, ?)`,
        )
        .run(skillId, input.space_id ?? null, displayName, `user:${skillId}`, now, now);

      // 3) 同一事务内物化 skill_space_state（global → 所有 Space；private → 自己）。
      this.materializeSpaceStates(skillId);

      this.audit.record("skill.created", "skill", skillId, { display_name: displayName, version });
      this.audit.record("skill.revision_created", "skill", skillId, { version });
      this.audit.record("skill.revision_activated", "skill", skillId, { version });

      const skill = this.db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as Skill;
      return { skill, version };
    })();
  }

  /** 为既有 Skill 追加新 revision：构建 → 发布 → 推进 current_revision。 */
  addRevision(skillId: string, draft: RevisionDraftInput): { version: number } {
    return this.db.transaction(() => {
      const skill = this.getSkillRow(skillId);
      const nextVersion = skill.current_revision + 1;
      const now = new Date().toISOString();

      const stored = this.validateDraft(draft);
      this.insertRevisionRow(skillId, nextVersion, skill.display_name, stored, draft.source_locator ?? null, now);
      this.snapshotFiles(skillId, nextVersion, draft.files ?? [], stored);
      this.publishRevision(skillId, nextVersion, now);

      this.db
        .prepare("UPDATE skills SET current_revision = ?, updated_at = ? WHERE id = ?")
        .run(nextVersion, now, skillId);
      this.materializeSpaceStates(skillId);

      this.audit.record("skill.revision_created", "skill", skillId, { version: nextVersion });
      this.audit.record("skill.revision_activated", "skill", skillId, { version: nextVersion });
      return { version: nextVersion };
    })();
  }

  activate(skillId: string, version: number): void {
    this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT published_at FROM skill_revisions WHERE skill_id = ? AND version = ?")
        .get(skillId, version) as { published_at: string | null } | undefined;
      if (!row) {
        throw new AppError(ErrorCode.SKILL_REVISION_NOT_FOUND, "Skill revision not found.");
      }
      const now = new Date().toISOString();
      if (row.published_at === null) {
        // 激活事务内置上 published_at（构建期 → 冻结期，只允许这一次）。
        this.publishRevision(skillId, version, now);
      }
      this.db.prepare("UPDATE skills SET current_revision = ?, updated_at = ? WHERE id = ?").run(version, now, skillId);
      this.materializeSpaceStates(skillId);
      this.audit.record("skill.revision_activated", "skill", skillId, { version });
    })();
  }

  /** 禁用只改全局意图 state，不动 revision 行；按旧 ref 解析的结果逐字不变。 */
  disable(skillId: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE skills SET state = 'disabled', updated_at = ? WHERE id = ?").run(now, skillId);
    this.audit.record("skill.disabled", "skill", skillId, {});
  }

  /**
   * 项目默认 Skill 引用（FR-007，单数默认由 idx_project_default_skill 部分唯一
   * 索引保证）。跨 Space 引用由 trigger 在数据库层拒绝（SKILL_SPACE_MISMATCH）。
   */
  setDefaultSkillRef(projectId: string, skillId: string, pinnedVersion: number | null, now: string): void {
    this.db
      .prepare(
        `INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT (project_id, skill_id) DO UPDATE SET
           is_default = 1, pinned_version = excluded.pinned_version, updated_at = excluded.updated_at`,
      )
      .run(projectId, skillId, pinnedVersion, now, now);
    this.audit.record("project.default_skill_changed", "project", projectId, {
      skill_id: skillId,
      pinned_version: pinnedVersion,
    });
  }

  listProjectSkillRefs(projectId: string): Array<{
    project_id: string;
    skill_id: string;
    is_default: boolean;
    pinned_version: number | null;
    created_at: string;
    updated_at: string;
  }> {
    return (
      this.db
        .prepare("SELECT * FROM project_skill_refs WHERE project_id = ? ORDER BY created_at ASC")
        .all(projectId) as Array<Record<string, unknown>>
    ).map((row) => ({
      project_id: row.project_id as string,
      skill_id: row.skill_id as string,
      is_default: row.is_default === 1,
      pinned_version: (row.pinned_version as number | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    }));
  }

  getSkillRow(skillId: string): Skill {
    const row = this.db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as Skill | undefined;
    if (!row) {
      throw new AppError(ErrorCode.SKILL_NOT_FOUND, "Skill not found.");
    }
    return row;
  }

  /**
   * 扫描入口：v0.3 没有外部来源注册表，扫描 = 按 source_identity 对齐存量行 +
   * 对所有 Space 重算分组（检测 conflict、恢复只剩单候选的组）。返回计数供 UI。
   */
  scan(): { scanned: number; conflicts_detected: number } {
    return this.db.transaction(() => {
      const scanned = (this.db.prepare("SELECT COUNT(*) AS n FROM skills").get() as { n: number }).n;
      let conflicts = 0;
      for (const spaceId of listAllSpaceIds(this.db)) {
        conflicts += this.recomputeSpaceStates(spaceId);
      }
      this.audit.record("skill.scanned", "skill", "*", { scanned, conflicts_detected: conflicts });
      return { scanned, conflicts_detected: conflicts };
    })();
  }

  /**
   * 冲突消解：必须带 space_id——消解的是某个 Space 内的一组。选中保留方置
   * active、同组其余 shadowed；不动任何 Skill 的全局 state。
   */
  resolveConflict(spaceId: string, keepSkillId: string): void {
    this.db.transaction(() => {
      const keep = this.getSkillRow(keepSkillId);
      const groupMembers = this.listGroupMembers(spaceId, keep.display_name);
      if (groupMembers.length <= 1) {
        throw new AppError(ErrorCode.SKILL_CONFLICT_UNRESOLVED, "No conflict group for this skill in the space.");
      }
      const now = new Date().toISOString();
      for (const member of groupMembers) {
        const state = member.id === keepSkillId ? "active" : "shadowed";
        upsertSpaceStates(this.db, [{ skillId: member.id, spaceId, state }], now);
      }
      this.audit.record("skill.conflict_resolved", "skill", keepSkillId, {
        space_id: spaceId,
        shadowed: groupMembers.filter((m) => m.id !== keepSkillId).map((m) => m.id),
      });
    })();
  }

  // ---- 内部 ----

  private listGroupMembers(spaceId: string, displayName: string): SkillGroupCandidate[] {
    const candidates = listCandidatesForSpace(this.db, spaceId);
    const key = displayName.toLowerCase();
    return candidates.filter((candidate) => candidate.display_name.toLowerCase() === key);
  }

  /** 按 Space 分组重算：多来源同名 → conflict；组内只剩一个候选 → 自动回 active。 */
  private recomputeSpaceStates(spaceId: string): number {
    const candidates = listCandidatesForSpace(this.db, spaceId);
    const states = computeGroupStates(candidates);
    upsertSpaceStates(
      this.db,
      [...states.entries()].map(([skillId, state]) => ({ skillId, spaceId, state })),
      new Date().toISOString(),
    );
    return [...states.values()].filter((state) => state === "conflict").length;
  }

  /**
   * 激活 / 创建后的物化：global Skill（space_id IS NULL）为所有现存 Space 各一行；
   * private Skill 只为自己所在 Space 一行。读取端遇缺行按保守值处理（SQL LEFT JOIN
   * 给出 NULL，listForSpace 原样上报）。
   */
  private materializeSpaceStates(skillId: string): void {
    const skill = this.getSkillRow(skillId);
    const now = new Date().toISOString();
    // 冲突检测影响的是"该组在该 Space 的那些行"：物化写入受影响 Space 的
    // 全部候选状态，而不是只写新 Skill 自己的行。
    const affectedSpaces =
      skill.space_id === null ? listAllSpaceIds(this.db) : [skill.space_id];
    for (const spaceId of affectedSpaces) {
      const candidates = listCandidatesForSpace(this.db, spaceId);
      const states = computeGroupStates(candidates);
      const previous = new Map(
        (
          this.db
            .prepare("SELECT skill_id, state FROM skill_space_state WHERE space_id = ?")
            .all(spaceId) as Array<{ skill_id: string; state: string }>
        ).map((row) => [row.skill_id, row.state]),
      );
      upsertSpaceStates(
        this.db,
        [...states.entries()].map(([candidateId, state]) => ({ skillId: candidateId, spaceId, state })),
        now,
      );
      for (const [candidateId, state] of states) {
        if (state === "conflict" && previous.get(candidateId) !== "conflict") {
          this.audit.record("skill.conflict_detected", "skill", candidateId, { space_id: spaceId });
        }
      }
    }
  }

  private validateDraft(draft: RevisionDraftInput): {
    capabilityTags: string[];
    stepsJson: string | null;
    requirementsJson: string | null;
    parsed: ParsedRevisionContent;
  } {
    const stepsJson = draft.steps === undefined || draft.steps === null ? null : JSON.stringify(draft.steps);
    const requirementsJson =
      draft.completion_requirements === undefined || draft.completion_requirements === null
        ? null
        : JSON.stringify(draft.completion_requirements);
    const capabilityTags = draft.capability_tags ?? [];

    // 激活期校验（严格模式）：未知字段 / 保留 id / order 连续 / Evidence 契约。
    let parsed: ParsedRevisionContent;
    try {
      parsed = parseRevisionContent(
        {
          steps_json: stepsJson,
          capability_tags_json: JSON.stringify(capabilityTags),
          completion_requirements_json: requirementsJson,
        },
        { requireCompletionEvidence: true },
      );
      // 合并规则同键冲突在激活时拒绝。
      mergeRequirements([...(parsed.steps ?? []).flatMap((s) => s.requirements), ...parsed.completionRequirements]);
    } catch (error) {
      if (error instanceof SkillSchemaError) {
        throw new AppError(ErrorCode.SKILL_SCHEMA_INVALID, error.message, undefined, { code: error.code });
      }
      throw error;
    }
    return { capabilityTags, stepsJson, requirementsJson, parsed };
  }

  private insertRevisionRow(
    skillId: string,
    version: number,
    title: string,
    stored: { capabilityTags: string[]; stepsJson: string | null; requirementsJson: string | null },
    sourceLocator: string | null,
    now: string,
  ): void {
    const contentHash = revisionContentHash({
      title,
      steps: stored.stepsJson ? JSON.parse(stored.stepsJson) : null,
      capability_tags: stored.capabilityTags,
      completion_requirements: stored.requirementsJson ? JSON.parse(stored.requirementsJson) : [],
    });
    this.db
      .prepare(
        `INSERT INTO skill_revisions (skill_id, version, title, description, capability_tags_json, steps_json, completion_requirements_json, source_locator, content_hash, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        skillId,
        version,
        title,
        null,
        JSON.stringify(stored.capabilityTags),
        stored.stepsJson,
        stored.requirementsJson,
        sourceLocator,
        contentHash,
        now,
      );
  }

  private publishRevision(skillId: string, version: number, now: string): void {
    this.db
      .prepare("UPDATE skill_revisions SET published_at = ? WHERE skill_id = ? AND version = ?")
      .run(now, skillId, version);
  }

  /**
   * 文件快照（T012）：正文在激活时入库，不在读取时回源。rel_path 必须规范化后
   * 仍落在根内（path.relative 判断），拒绝绝对路径 / .. / NUL；单文件 1 MiB、
   * 总量 10 MiB 上限，超限整体拒绝。
   */
  private snapshotFiles(
    skillId: string,
    version: number,
    files: Array<{ rel_path: string; content: Buffer | string }>,
    _stored: unknown,
  ): void {
    if (files.length === 0) return;
    const stmt = this.db.prepare(
      "INSERT INTO skill_revision_files (skill_id, version, rel_path, content, content_hash, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    );
    let total = 0;
    for (const file of files) {
      const relPath = file.rel_path;
      if (typeof relPath !== "string" || relPath === "") {
        throw new AppError(ErrorCode.SKILL_SCHEMA_INVALID, "Skill file rel_path is required.");
      }
      if (relPath.includes("\0") || relPath.includes("\\")) {
        throw new AppError(ErrorCode.SKILL_SCHEMA_INVALID, `Illegal skill file path: ${relPath}`);
      }
      const normalized = path.posix.normalize(relPath);
      if (
        path.posix.isAbsolute(relPath) ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized !== relPath
      ) {
        throw new AppError(ErrorCode.SKILL_SCHEMA_INVALID, `Skill file path escapes the revision root: ${relPath}`);
      }
      const content = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : file.content;
      if (content.byteLength > SKILL_FILE_MAX_BYTES) {
        throw new AppError(ErrorCode.SKILL_FILES_TOO_LARGE, `Skill file exceeds 1 MiB: ${relPath}`);
      }
      total += content.byteLength;
      if (total > SKILL_FILES_TOTAL_MAX_BYTES) {
        throw new AppError(ErrorCode.SKILL_FILES_TOO_LARGE, "Skill files exceed the 10 MiB total limit");
      }
      const hash = createHash("sha256").update(content).digest("hex");
      stmt.run(skillId, version, normalized, content, hash, content.byteLength);
    }
  }
}

