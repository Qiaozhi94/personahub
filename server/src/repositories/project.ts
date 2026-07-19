import type Database from "better-sqlite3";
import type { Project } from "@personahub/shared/types";
import { generateProjectId } from "../id.js";

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
}
