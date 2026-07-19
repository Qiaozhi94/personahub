import type Database from "better-sqlite3";
import type { Project } from "@personahub/shared/types";
import { generateProjectId } from "../id.js";

export type SetDefaultAdapterResult =
  | { success: true }
  | { success: false; reason: "adapter_not_found" | "cross_project" | "unavailable" };

export class ProjectRepository {
  constructor(private db: Database.Database) {}

  create(name: string, description: string | null): Project {
    const id = generateProjectId();
    const now = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO projects (id, name, description, default_workspace_id, default_coordinator_agent_id, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
    ).run(id, name, description, now, now);

    return {
      id,
      name,
      description,
      default_workspace_id: null,
      default_coordinator_agent_id: null,
      // F005 schema v6 adds this column; a freshly created Project has no default yet.
      default_adapter_config_id: null,
      created_at: now,
      updated_at: now,
    };
  }

  list(): Project[] {
    return this.db.prepare(
      "SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC"
    ).all() as Project[];
  }

  get(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
    return row ?? null;
  }

  getById(id: string): Project | null {
    return this.get(id);
  }

  updateDefaultWorkspace(projectId: string, workspaceId: string, updatedAt: string): void {
    this.db.prepare(
      "UPDATE projects SET default_workspace_id = ?, updated_at = ? WHERE id = ?"
    ).run(workspaceId, updatedAt, projectId);
  }

  /**
   * F005: set the Project's default adapter. SQLite can't enforce
   * "same project + available" via a column-level FK (design §4.1), so this
   * repository method validates both explicitly before writing.
   */
  setDefaultAdapter(projectId: string, adapterConfigId: string): SetDefaultAdapterResult {
    const adapter = this.db.prepare(
      "SELECT project_id, status FROM agent_configs WHERE id = ?"
    ).get(adapterConfigId) as { project_id: string; status: string } | undefined;

    if (!adapter) {
      return { success: false, reason: "adapter_not_found" };
    }
    if (adapter.project_id !== projectId) {
      return { success: false, reason: "cross_project" };
    }
    if (adapter.status !== "available") {
      return { success: false, reason: "unavailable" };
    }

    this.db.prepare(
      "UPDATE projects SET default_adapter_config_id = ?, updated_at = ? WHERE id = ?"
    ).run(adapterConfigId, new Date().toISOString(), projectId);
    return { success: true };
  }

  clearDefaultAdapter(projectId: string, updatedAt: string = new Date().toISOString()): void {
    this.db.prepare(
      "UPDATE projects SET default_adapter_config_id = NULL, updated_at = ? WHERE id = ?"
    ).run(updatedAt, projectId);
  }
}
