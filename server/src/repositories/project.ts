import type Database from "better-sqlite3";
import type { Project } from "@personahub/shared/types";
import { generateProjectId } from "../id.js";

export type SetDefaultAdapterResult =
  | { success: true }
  | { success: false; reason: "adapter_not_found" | "cross_project" | "unavailable" };

/**
 * 指向 projects(id) 的引用类别（design.md §3 删除保护）。新增任何指向 projects
 * 的外键都必须同步这里——project-lifecycle 测试用 PRAGMA foreign_key_list 反查
 * 全部引用表并与该清单比对，清单漏项即测试失败。
 */
export const PROJECT_REFERENCE_CATEGORIES = [
  "issues",
  "workspaces",
  "agent_configs",
  "intake_confirmations",
  "project_repository_refs",
  "project_skill_refs",
] as const;

export type ProjectReferenceCategory = (typeof PROJECT_REFERENCE_CATEGORIES)[number];

const REFERENCE_TABLE_BY_CATEGORY: Record<ProjectReferenceCategory, { table: string; column: string }> = {
  issues: { table: "issues", column: "project_id" },
  workspaces: { table: "workspaces", column: "project_id" },
  agent_configs: { table: "agent_configs", column: "project_id" },
  intake_confirmations: { table: "intake_confirmations", column: "project_id" },
  project_repository_refs: { table: "project_repository_refs", column: "project_id" },
  project_skill_refs: { table: "project_skill_refs", column: "project_id" },
};

export interface ProjectListOptions {
  /** 显式 Space 覆盖；缺省按当前选中 Space 过滤（design §4 Space 作用域规则）。 */
  spaceId?: string;
  includeArchived?: boolean;
}

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  create(name: string, description: string | null, spaceId: string): Project {
    const id = generateProjectId();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, space_id, state, archived_at, default_workspace_id, default_coordinator_agent_id, default_adapter_config_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(id, name, description, spaceId, now, now);

    return this.getById(id) as Project;
  }

  list(options: ProjectListOptions = {}): Project[] {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (!options.includeArchived) {
      conditions.push("state = 'active'");
    }
    const spaceId = options.spaceId ?? this.getSelectedSpaceId();
    if (spaceId !== null) {
      conditions.push("space_id = ?");
      values.push(spaceId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM projects ${where} ORDER BY updated_at DESC, created_at DESC`)
      .all(...values) as Project[];
  }

  private getSelectedSpaceId(): string | null {
    const row = this.db.prepare("SELECT id FROM spaces WHERE is_selected = 1").get() as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  get(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
    return row ?? null;
  }

  getById(id: string): Project | null {
    return this.get(id);
  }

  updateDefaultWorkspace(projectId: string, workspaceId: string, updatedAt: string): void {
    this.db.prepare("UPDATE projects SET default_workspace_id = ?, updated_at = ? WHERE id = ?").run(
      workspaceId,
      updatedAt,
      projectId,
    );
  }

  archive(projectId: string, archivedAt: string): void {
    this.db.prepare("UPDATE projects SET state = 'archived', archived_at = ?, updated_at = ? WHERE id = ?").run(
      archivedAt,
      archivedAt,
      projectId,
    );
  }

  restore(projectId: string, updatedAt: string): void {
    this.db.prepare("UPDATE projects SET state = 'active', archived_at = NULL, updated_at = ? WHERE id = ?").run(
      updatedAt,
      projectId,
    );
  }

  /** 逐类检查引用；返回非空类别清单（删除保护，design §3）。 */
  listBlockingReferenceCategories(projectId: string): ProjectReferenceCategory[] {
    const blocking: ProjectReferenceCategory[] = [];
    for (const category of PROJECT_REFERENCE_CATEGORIES) {
      const { table, column } = REFERENCE_TABLE_BY_CATEGORY[category];
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(projectId) as {
        n: number;
      };
      if (row.n > 0) blocking.push(category);
    }
    return blocking;
  }

  delete(projectId: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  }

  /**
   * F005: set the Project's default adapter. SQLite can't enforce
   * "same project + available" via a column-level FK (design §4.1), so this
   * repository method validates both explicitly before writing.
   */
  setDefaultAdapter(projectId: string, adapterConfigId: string): SetDefaultAdapterResult {
    const adapter = this.db.prepare("SELECT project_id, status FROM agent_configs WHERE id = ?").get(
      adapterConfigId,
    ) as { project_id: string; status: string } | undefined;

    if (!adapter) {
      return { success: false, reason: "adapter_not_found" };
    }
    if (adapter.project_id !== projectId) {
      return { success: false, reason: "cross_project" };
    }
    if (adapter.status !== "available") {
      return { success: false, reason: "unavailable" };
    }

    this.db
      .prepare("UPDATE projects SET default_adapter_config_id = ?, updated_at = ? WHERE id = ?")
      .run(adapterConfigId, new Date().toISOString(), projectId);
    return { success: true };
  }

  clearDefaultAdapter(projectId: string, updatedAt: string = new Date().toISOString()): void {
    this.db.prepare("UPDATE projects SET default_adapter_config_id = NULL, updated_at = ? WHERE id = ?").run(
      updatedAt,
      projectId,
    );
  }
}
