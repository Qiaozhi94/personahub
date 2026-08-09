import type Database from "better-sqlite3";

export interface AdminAuditEventInput {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  target_version: number | null;
  actor_type: string;
  actor_id: string | null;
  details_json: string;
  created_at: string;
}

// F008 T031: global audit ledger for workflow-template mutations. insert() is
// a plain statement so the service can keep it in the same transaction as the
// template mutation (T031b: audit failure rolls back the template change).
// actor_id is always null - the app has no auth (design §7).
export class AdminAuditEventRepository {
  constructor(private db: Database.Database) {}

  insert(input: AdminAuditEventInput): void {
    this.db
      .prepare(
        `INSERT INTO admin_audit_events
        (id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.action,
        input.target_type,
        input.target_id,
        input.target_version,
        input.actor_type,
        input.actor_id,
        input.details_json,
        input.created_at,
      );
  }

  getById(id: string): {
    id: string;
    action: string;
    target_type: string;
    target_id: string;
    target_version: number | null;
    actor_type: string;
    actor_id: string | null;
    details_json: string;
    created_at: string;
  } | null {
    const row = this.db
      .prepare(
        "SELECT id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at FROM admin_audit_events WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          action: string;
          target_type: string;
          target_id: string;
          target_version: number | null;
          actor_type: string;
          actor_id: string | null;
          details_json: string;
          created_at: string;
        }
      | undefined;
    return row ?? null;
  }

  listByTarget(targetId: string): Array<{
    id: string;
    action: string;
    target_type: string;
    target_id: string;
    target_version: number | null;
    actor_type: string;
    actor_id: string | null;
    details_json: string;
    created_at: string;
  }> {
    const rows = this.db
      .prepare(
        "SELECT id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at FROM admin_audit_events WHERE target_id = ? ORDER BY created_at ASC",
      )
      .all(targetId) as Array<{
      id: string;
      action: string;
      target_type: string;
      target_id: string;
      target_version: number | null;
      actor_type: string;
      actor_id: string | null;
      details_json: string;
      created_at: string;
    }>;
    return rows;
  }
}
