import type Database from "better-sqlite3";
import type { RunFileChange, FileChangeType } from "@personahub/shared/types";
import { generateFileChangeId } from "../id.js";

export interface FileChangeRecord {
  path: string;
  previous_path: string | null;
  change_type: FileChangeType;
  before_fingerprint: string | null;
  after_fingerprint: string | null;
}

interface FileChangeRow {
  id: string;
  run_id: string;
  path: string;
  previous_path: string | null;
  change_type: string;
  before_fingerprint: string | null;
  after_fingerprint: string | null;
  created_at: string;
}

function mapRow(row: FileChangeRow): RunFileChange {
  return {
    id: row.id,
    run_id: row.run_id,
    path: row.path,
    previous_path: row.previous_path,
    change_type: row.change_type as FileChangeType,
    created_at: row.created_at,
  };
}

export class FileChangeRepository {
  constructor(private db: Database.Database) {}

  replaceForRun(runId: string, changes: FileChangeRecord[], now: string): void {
    this.db.prepare("DELETE FROM run_file_changes WHERE run_id = ?").run(runId);

    const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
    const stmt = this.db.prepare(
      `INSERT INTO run_file_changes (id, run_id, path, previous_path, change_type, before_fingerprint, after_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const change of sorted) {
      stmt.run(
        generateFileChangeId(), runId, change.path, change.previous_path,
        change.change_type, change.before_fingerprint, change.after_fingerprint, now,
      );
    }
  }

  listByRun(runId: string, afterId?: string, limit = 100): RunFileChange[] {
    if (afterId) {
      const afterRow = this.db.prepare(
        "SELECT path FROM run_file_changes WHERE run_id = ? AND id = ?",
      ).get(runId, afterId) as { path: string } | undefined;

      if (!afterRow) {
        return [];
      }

      const rows = this.db.prepare(
        `SELECT * FROM run_file_changes WHERE run_id = ? AND path > ? ORDER BY path ASC LIMIT ?`,
      ).all(runId, afterRow.path, limit) as FileChangeRow[];
      return rows.map(mapRow);
    }
    const rows = this.db.prepare(
      `SELECT * FROM run_file_changes WHERE run_id = ? ORDER BY path ASC LIMIT ?`,
    ).all(runId, limit) as FileChangeRow[];
    return rows.map(mapRow);
  }

  countByRun(runId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM run_file_changes WHERE run_id = ?",
    ).get(runId) as { cnt: number };
    return row.cnt;
  }

  existsForRun(runId: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 as one FROM run_file_changes WHERE run_id = ? LIMIT 1",
    ).get(runId) as { one: number } | undefined;
    return row !== undefined;
  }
}
