// F013 v12 migration 的专用编排与数据回填（design.md §3）。
//
// 现有 runner 把每个版本整体包进 db.transaction()，而 SQLite 在事务内切换
// PRAGMA foreign_keys 是静默 no-op——照现有框架写 rebuild，外键不会真的关闭，
// DROP TABLE projects 会因子表引用失败或留下悬空引用，且 DDL 本身不报错。
// 因此本版本用显式编排：事务外开关 FK（并断言读回值）、事务内
// foreign_key_check 与 schema_version 原子提交、finally 恢复进入前状态。

import type Database from "better-sqlite3";
import {
  SCHEMA_V12_ISSUES_NEW,
  SCHEMA_V12_PROJECTS_NEW,
  SCHEMA_V12_REBUILT_INDEXES_AND_TRIGGERS,
  SCHEMA_V12_SKILLS,
  SCHEMA_V12_SKILL_TRIGGERS,
  SCHEMA_V12_SPACES_AND_REPOSITORIES,
} from "./schema-v12.js";
import {
  generateAdminAuditEventId,
  generateRepositoryId,
  generateSkillId,
  generateSpaceId,
} from "../id.js";
import { canonicalJson, sha256Hex } from "../services/skill-content.js";
import {
  buildLegacyRevisionContent,
  type LegacyValidationPolicyRow,
  type LegacyWorkflowRow,
} from "../services/legacy-skill-mapping.js";

export const V12_VERSION = 12;

export const DEFAULT_SPACE_NAME = "Default Space";

/** legacy combo_map 的"无 policy"哨兵（SQLite 主键列不接受 NULL）。 */
export const LEGACY_NO_POLICY_SENTINEL = "-";

interface WorkflowTemplateFullRow extends LegacyWorkflowRow {
  collaboration_topology: string | null;
  agent_team_template_id: string | null;
  handoff_policy_json: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ValidationPolicyFullRow extends LegacyValidationPolicyRow {
  max_validation_rounds: number;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export function applyV12(db: Database.Database): void {
  const fkWasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  db.pragma("foreign_keys = OFF");
  // 读回值是断言对象，不能只看没报错。
  if (db.pragma("foreign_keys", { simple: true }) !== 0) {
    throw new Error("v12 migration: failed to disable foreign_keys before table rebuild");
  }
  try {
    db.transaction(() => {
      db.exec(SCHEMA_V12_SPACES_AND_REPOSITORIES);
      db.exec(SCHEMA_V12_SKILLS);

      const defaultSpaceId = ensureDefaultSpace(db);
      rebuildProjects(db, defaultSpaceId);
      rebuildIssues(db, defaultSpaceId);
      db.exec(SCHEMA_V12_REBUILT_INDEXES_AND_TRIGGERS);
      // Skill 触发器在 projects/issues 重建之后创建：ALTER TABLE RENAME 会重解析
      // 整个 schema，提前创建的 trg_project_skill_refs_* 会因旧表名已被 DROP 而
      // 让 rebuild 以 "no such table" 失败。
      db.exec(SCHEMA_V12_SKILL_TRIGGERS);

      migrateLegacyWorkspaces(db);
      migrateLegacyWorkflows(db, defaultSpaceId);

      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`v12 migration failed foreign_key_check: ${JSON.stringify(violations.slice(0, 5))}`);
      }
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        V12_VERSION,
        new Date().toISOString(),
      );
    })();
  } finally {
    // 无论成败都恢复进入前状态，异常路径不得留下关闭状态。
    db.pragma(fkWasOn ? "foreign_keys = ON" : "foreign_keys = OFF");
  }
}

/**
 * 升级器以稳定幂等键（is_default = 1 的部分唯一索引）创建唯一默认 Space。
 * 首个 Space 既是 default 也是 selected（二者初始重合，之后独立演化）。
 */
export function ensureDefaultSpace(db: Database.Database): string {
  const existing = db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string } | undefined;
  if (existing) return existing.id;
  const id = generateSpaceId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO spaces (id, name, state, is_default, is_selected, created_at, updated_at)
     VALUES (?, ?, 'active', 1, 1, ?, ?)`,
  ).run(id, DEFAULT_SPACE_NAME, now, now);
  return id;
}

function rebuildProjects(db: Database.Database, defaultSpaceId: string): void {
  db.exec(SCHEMA_V12_PROJECTS_NEW);
  db.prepare(
    `INSERT INTO projects_f013
       (id, name, description, default_workspace_id, default_coordinator_agent_id, default_adapter_config_id,
        space_id, state, archived_at, created_at, updated_at)
     SELECT id, name, description, default_workspace_id, default_coordinator_agent_id, default_adapter_config_id,
        ?, 'active', NULL, created_at, updated_at
     FROM projects`,
  ).run(defaultSpaceId);
  db.exec("DROP TABLE projects");
  db.exec("ALTER TABLE projects_f013 RENAME TO projects");
}

function rebuildIssues(db: Database.Database, defaultSpaceId: string): void {
  db.exec(SCHEMA_V12_ISSUES_NEW);
  db.prepare(
    `INSERT INTO issues_f013
       (id, project_id, workspace_id, primary_thread_id, issue_type, workflow_template_id, validation_policy_id,
        title, goal, status, owner_agent_id, coordinator_agent_id, priority, labels, validation_round_count,
        blocked_reason_code, blocked_reason_message, validation_dispatch_due_at, space_id, created_at, updated_at)
     SELECT id, project_id, workspace_id, primary_thread_id, issue_type, workflow_template_id, validation_policy_id,
        title, goal, status, owner_agent_id, coordinator_agent_id, priority, labels, validation_round_count,
        blocked_reason_code, blocked_reason_message, validation_dispatch_due_at, ?, created_at, updated_at
     FROM issues`,
  ).run(defaultSpaceId);
  db.exec("DROP TABLE issues");
  db.exec("ALTER TABLE issues_f013 RENAME TO issues");
}

function basenameOfAnyPlatform(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * legacy workspace → repositories + project_repository_refs（design.md §3 桥规则）：
 * - default_workspace_id 指向的那条 → primary（access=read_write），legacy_workspace_id 回填；
 * - 其余 workspace → reference（CHECK 强制 read_only），legacy_workspace_id 同样回填（历史 Run 可追溯）；
 * - 无 default 但存在 workspace（数据异常）→ 取 created_at 最早的一条作 primary，并写诊断记录；
 * - 只登记仓库与引用，不创建授权行：local_path_normalized 是 path.resolve 的产物，
 *   不得当作已授权真实路径（design §7）。
 */
function migrateLegacyWorkspaces(db: Database.Database): void {
  const now = new Date().toISOString();
  const repoIdByNormalizedPath = new Map<string, string>();

  const findOrCreateRepository = (localPath: string, localPathNormalized: string): string => {
    const existing = repoIdByNormalizedPath.get(localPathNormalized);
    if (existing) return existing;
    const id = generateRepositoryId();
    db.prepare(
      `INSERT INTO repositories (id, kind, display_name, git_remote_url, created_at, updated_at)
       VALUES (?, 'local_dir', ?, NULL, ?, ?)`,
    ).run(id, basenameOfAnyPlatform(localPath), now, now);
    repoIdByNormalizedPath.set(localPathNormalized, id);
    return id;
  };

  const projects = db
    .prepare("SELECT id, default_workspace_id FROM projects ORDER BY created_at ASC, id ASC")
    .all() as Array<{ id: string; default_workspace_id: string | null }>;

  for (const project of projects) {
    const workspaces = db
      .prepare(
        "SELECT id, local_path, local_path_normalized FROM workspaces WHERE project_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(project.id) as Array<{ id: string; local_path: string; local_path_normalized: string }>;
    if (workspaces.length === 0) continue;

    let primaryWorkspaceId = project.default_workspace_id;
    let anomaly = false;
    if (primaryWorkspaceId && !workspaces.some((ws) => ws.id === primaryWorkspaceId)) {
      primaryWorkspaceId = null;
    }
    if (!primaryWorkspaceId) {
      primaryWorkspaceId = workspaces[0].id;
      anomaly = true;
    }

    for (const ws of workspaces) {
      const repositoryId = findOrCreateRepository(ws.local_path, ws.local_path_normalized);
      const role = ws.id === primaryWorkspaceId ? "primary" : "reference";
      db.prepare(
        `INSERT INTO project_repository_refs
           (project_id, repository_id, role, access, scope_json, legacy_workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(project.id, repositoryId, role, role === "primary" ? "read_write" : "read_only", ws.id, now, now);
    }

    if (anomaly) {
      db.prepare(
        `INSERT INTO admin_audit_events
           (id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at)
         VALUES (?, 'legacy_workspace_migration.default_workspace_missing', 'project', ?, NULL, 'system', NULL, ?, ?)`,
    ).run(
        generateAdminAuditEventId(),
        project.id,
        JSON.stringify({ chosen_workspace_id: primaryWorkspaceId, rule: "earliest created_at" }),
        now,
      );
    }
  }
}

/**
 * legacy Workflow + Validation Policy → Skill / Skill revision（design.md §3 映射矩阵）。
 * 按 (workflow, policy) 组合生成 revision：同一 workflow 配过两个 policy 产生两个
 * revision，各自由 combo_map 一行指向；没有任何 Issue 引用的 workflow 用其自带
 * policy 生成一条 revision。版本号按 policy 键排序（'-' 最先）后从 1 连续分配。
 */
function migrateLegacyWorkflows(db: Database.Database, defaultSpaceId: string): void {
  const now = new Date().toISOString();

  const workflows = db
    .prepare("SELECT * FROM workflow_templates ORDER BY created_at ASC, id ASC")
    .all() as WorkflowTemplateFullRow[];
  const policies = new Map<string, ValidationPolicyFullRow>();
  for (const row of db.prepare("SELECT * FROM validation_policies").all() as ValidationPolicyFullRow[]) {
    policies.set(row.id, row);
  }

  const issueCombos = db
    .prepare(
      "SELECT DISTINCT workflow_template_id, validation_policy_id FROM issues WHERE workflow_template_id IS NOT NULL AND validation_policy_id IS NOT NULL",
    )
    .all() as Array<{ workflow_template_id: string; validation_policy_id: string }>;
  const combosByWorkflow = new Map<string, Set<string>>();
  for (const combo of issueCombos) {
    const set = combosByWorkflow.get(combo.workflow_template_id) ?? new Set<string>();
    set.add(combo.validation_policy_id);
    combosByWorkflow.set(combo.workflow_template_id, set);
  }

  for (const workflow of workflows) {
    const ownPolicyKey = workflow.validation_policy_id ?? LEGACY_NO_POLICY_SENTINEL;
    const comboSet = combosByWorkflow.get(workflow.id) ?? new Set<string>();
    comboSet.add(ownPolicyKey);
    const combos = [...comboSet].sort();

    const skillId = generateSkillId();
    const versionByPolicyKey = new Map<string, number>();
    combos.forEach((policyKey, index) => {
      const version = index + 1;
      versionByPolicyKey.set(policyKey, version);
      const policy = policyKey === LEGACY_NO_POLICY_SENTINEL ? null : (policies.get(policyKey) ?? null);
      const content = buildLegacyRevisionContent(workflow, policy);
      const contentHash = sha256Hex(
        canonicalJson({
          title: workflow.name,
          steps: content.steps,
          capability_tags: content.capability_tags,
          completion_requirements: content.completion_requirements,
        }),
      );
      db.prepare(
        `INSERT INTO skill_revisions
           (skill_id, version, title, description, capability_tags_json, steps_json, completion_requirements_json,
            source_locator, content_hash, published_at, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        skillId,
        version,
        workflow.name,
        JSON.stringify(content.capability_tags),
        content.steps === null ? null : canonicalJson(content.steps),
        canonicalJson(content.completion_requirements),
        contentHash,
        now,
        now,
      );
    });

    db.prepare(
      `INSERT INTO skills (id, space_id, display_name, source_kind, source_identity, current_revision, state, created_at, updated_at)
       VALUES (?, ?, ?, 'legacy-workflow', ?, ?, 'active', ?, ?)`,
    ).run(skillId, defaultSpaceId, workflow.name, `workflow:${workflow.id}`, versionByPolicyKey.get(ownPolicyKey) ?? 1, now, now);

    // private Skill（space_id = 默认 Space）：只物化自己那一行（T013 的第三条物化路径）。
    db.prepare("INSERT INTO skill_space_state (skill_id, space_id, state, updated_at) VALUES (?, ?, 'active', ?)").run(
      skillId,
      defaultSpaceId,
      now,
    );

    for (const [policyKey, version] of versionByPolicyKey) {
      db.prepare(
        "INSERT INTO skill_legacy_combo_map (workflow_template_id, validation_policy_id, skill_id, version) VALUES (?, ?, ?, ?)",
      ).run(workflow.id, policyKey, skillId, version);
    }

    db.prepare("INSERT INTO skill_legacy_aliases (source_kind, legacy_id, raw_payload_json) VALUES ('workflow_template', ?, ?)").run(
      workflow.id,
      JSON.stringify(workflow),
    );
  }

  for (const policy of policies.values()) {
    db.prepare("INSERT INTO skill_legacy_aliases (source_kind, legacy_id, raw_payload_json) VALUES ('validation_policy', ?, ?)").run(
      policy.id,
      JSON.stringify(policy),
    );
  }

  // 迁移末尾反查断言：每条历史 Issue 的组合都必须能经 combo_map 解析，零缺失。
  const missing = db
    .prepare(
      `SELECT COUNT(*) AS n FROM issues i
       WHERE i.workflow_template_id IS NOT NULL AND i.validation_policy_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM skill_legacy_combo_map m
           WHERE m.workflow_template_id = i.workflow_template_id AND m.validation_policy_id = i.validation_policy_id
         )`,
    )
    .get() as { n: number };
  if (missing.n > 0) {
    throw new Error(`v12 legacy skill migration: ${missing.n} issue (workflow, policy) combos unresolved`);
  }
}
