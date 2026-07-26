import type Database from "better-sqlite3";
import type { AdapterStatus } from "@personahub/shared/types";

/**
 * Workspace-aware adapter availability override (schema v7). Deliberately
 * NOT the single source of truth for adapter status — `agent_configs.status`
 * stays the Project-global, conservative baseline. A row here means "this
 * specific (adapter, workspace) pair's effective status genuinely differs
 * from that baseline" (design: OpenCode OAuth on Windows is Unknown
 * globally but confirmed Available in one workspace with
 * push_credentials_enabled=true; a Run failure in one workspace shouldn't
 * silently disable the adapter for every other workspace in the Project).
 * No row for a pair means "no override — use the global status".
 */
export interface AdapterWorkspaceStatusRecord {
  adapter_config_id: string;
  workspace_id: string;
  status: AdapterStatus;
  last_checked_at: string | null;
  auth_status_message: string | null;
  updated_at: string;
}

export interface AdapterWorkspaceStatusUpsertInput {
  adapter_config_id: string;
  workspace_id: string;
  status: AdapterStatus;
  last_checked_at: string | null;
  auth_status_message: string | null;
}

interface AdapterWorkspaceStatusRow {
  adapter_config_id: string;
  workspace_id: string;
  status: string;
  last_checked_at: string | null;
  auth_status_message: string | null;
  updated_at: string;
}

function mapRow(row: AdapterWorkspaceStatusRow): AdapterWorkspaceStatusRecord {
  return {
    adapter_config_id: row.adapter_config_id,
    workspace_id: row.workspace_id,
    status: row.status as AdapterStatus,
    last_checked_at: row.last_checked_at,
    auth_status_message: row.auth_status_message,
    updated_at: row.updated_at,
  };
}

export class AdapterWorkspaceStatusRepository {
  constructor(private db: Database.Database) {}

  get(adapterConfigId: string, workspaceId: string): AdapterWorkspaceStatusRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM adapter_workspace_status WHERE adapter_config_id = ? AND workspace_id = ?"
    ).get(adapterConfigId, workspaceId) as AdapterWorkspaceStatusRow | undefined;
    return row ? mapRow(row) : null;
  }

  /** All override rows for one workspace — lets a list-based selector (e.g. ValidatorSelector) apply overrides in one query instead of N. */
  listForWorkspace(workspaceId: string): AdapterWorkspaceStatusRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM adapter_workspace_status WHERE workspace_id = ?"
    ).all(workspaceId) as AdapterWorkspaceStatusRow[];
    return rows.map(mapRow);
  }

  upsert(input: AdapterWorkspaceStatusUpsertInput): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO adapter_workspace_status (adapter_config_id, workspace_id, status, last_checked_at, auth_status_message, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (adapter_config_id, workspace_id) DO UPDATE SET
         status = excluded.status,
         last_checked_at = excluded.last_checked_at,
         auth_status_message = excluded.auth_status_message,
         updated_at = excluded.updated_at`
    ).run(input.adapter_config_id, input.workspace_id, input.status, input.last_checked_at, input.auth_status_message, now);
  }

  deleteForAdapter(adapterConfigId: string): void {
    this.db.prepare("DELETE FROM adapter_workspace_status WHERE adapter_config_id = ?").run(adapterConfigId);
  }

  /** Drops a single (adapter, workspace) override — used when a fresh scoped probe's result turns out to equal the global baseline again, so the table stays exception-only rather than accumulating no-op rows. */
  delete(adapterConfigId: string, workspaceId: string): void {
    this.db.prepare(
      "DELETE FROM adapter_workspace_status WHERE adapter_config_id = ? AND workspace_id = ?"
    ).run(adapterConfigId, workspaceId);
  }
}
