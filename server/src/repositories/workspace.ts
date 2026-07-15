import type Database from "better-sqlite3";
import type { Workspace, WorkspaceLockState } from "@personahub/shared/types";
import { generateWorkspaceId } from "../id.js";

export interface WorkspaceCreateInput {
  project_id: string;
  local_path: string;
  local_path_normalized: string;
  git_branch: string | null;
  lock_state: WorkspaceLockState;
}

export interface WorkspaceUpdateInput {
  git_branch: string | null;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  project_id: string;
  local_path: string;
  local_path_normalized: string;
  git_branch: string | null;
  lock_state: string;
  locked_by_run_id: string | null;
  locked_at: string | null;
  push_credentials_enabled: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    project_id: row.project_id,
    local_path: row.local_path,
    git_branch: row.git_branch,
    lock_state: row.lock_state as WorkspaceLockState,
    locked_by_run_id: row.locked_by_run_id,
    locked_at: row.locked_at,
    push_credentials_enabled: row.push_credentials_enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class WorkspaceRepository {
  constructor(private db: Database.Database) {}

  create(input: WorkspaceCreateInput): Workspace {
    const id = generateWorkspaceId();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, git_branch, lock_state, locked_by_run_id, locked_at, push_credentials_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)`
    ).run(id, input.project_id, input.local_path, input.local_path_normalized, input.git_branch, input.lock_state, now, now);

    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow;
    return mapRow(row);
  }

  getById(id: string): Workspace | null {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as WorkspaceRow | undefined;
    return row ? mapRow(row) : null;
  }

  getByProjectAndPath(projectId: string, localPathNormalized: string): Workspace | null {
    const row = this.db.prepare(
      "SELECT * FROM workspaces WHERE project_id = ? AND local_path_normalized = ?"
    ).get(projectId, localPathNormalized) as WorkspaceRow | undefined;
    return row ? mapRow(row) : null;
  }

  update(id: string, input: WorkspaceUpdateInput): void {
    this.db.prepare(
      "UPDATE workspaces SET git_branch = ?, updated_at = ? WHERE id = ?"
    ).run(input.git_branch, input.updated_at, id);
  }

  acquireLock(id: string, runId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `UPDATE workspaces SET lock_state = 'locked', locked_by_run_id = ?, locked_at = ?, updated_at = ?
       WHERE id = ? AND lock_state = 'idle'`
    ).run(runId, now, now, id);
    return result.changes > 0;
  }

  releaseLock(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE workspaces SET lock_state = 'idle', locked_by_run_id = NULL, locked_at = NULL, updated_at = ?
       WHERE id = ?`
    ).run(now, id);
  }

  releaseLockByRunId(runId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE workspaces SET lock_state = 'idle', locked_by_run_id = NULL, locked_at = NULL, updated_at = ?
       WHERE locked_by_run_id = ?`
    ).run(now, runId);
  }

  listLockedWorkspaces(): Workspace[] {
    const rows = this.db.prepare(
      "SELECT * FROM workspaces WHERE lock_state = 'locked'"
    ).all() as WorkspaceRow[];
    return rows.map(mapRow);
  }

  updatePushCredentialsEnabled(id: string, enabled: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE workspaces SET push_credentials_enabled = ?, updated_at = ? WHERE id = ?"
    ).run(enabled ? 1 : 0, now, id);
  }
}
