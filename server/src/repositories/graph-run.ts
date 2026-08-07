import type Database from "better-sqlite3";
import type { GraphRun, GraphRunStatus, GraphBlockReason, GraphNodeKey } from "@personahub/shared/types";
import { generateRunId } from "../id.js";
import { isNonTerminalGraphConflict, GraphConstraintError } from "../db/sqlite-errors.js";

export interface GraphRunCreateInput {
  id?: string;
  issue_id: string;
  thread_id: string;
  workspace_id: string;
  definition_id: string;
  definition_version: number;
  status: GraphRunStatus;
  target_files: readonly string[];
  target_files_hash: string;
  target_files_truncated?: boolean;
  target_files_dropped_count?: number;
}

export interface GraphRunCompareAndSetResult {
  success: boolean;
  graphRun: GraphRun | null;
}

interface GraphRunRow {
  id: string;
  issue_id: string;
  thread_id: string;
  workspace_id: string;
  definition_id: string;
  definition_version: number;
  status: string;
  blocked_reason_code: string | null;
  blocked_node_keys: string | null;
  target_files_json: string;
  target_files_hash: string;
  target_files_truncated: number;
  target_files_dropped_count: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: GraphRunRow): GraphRun {
  const parsed: unknown = JSON.parse(row.target_files_json);
  if (!Array.isArray(parsed) || parsed.some((f) => typeof f !== "string")) {
    throw new Error(
      `target_files_json is not a string array for graph_run ${row.id}`,
    );
  }
  const targetFiles = parsed;

  return {
    id: row.id,
    issue_id: row.issue_id,
    thread_id: row.thread_id,
    workspace_id: row.workspace_id,
    definition_id: row.definition_id,
    definition_version: row.definition_version,
    status: row.status as GraphRunStatus,
    blocked_reason_code: row.blocked_reason_code as GraphBlockReason | null,
    blocked_node_keys: JSON.parse(row.blocked_node_keys ?? "[]") as GraphNodeKey[],
    target_files: targetFiles,
    target_files_hash: row.target_files_hash,
    target_files_truncated: row.target_files_truncated !== 0,
    target_files_dropped_count: row.target_files_dropped_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class GraphRunRepository {
  constructor(private db: Database.Database) {}

  create(input: GraphRunCreateInput): GraphRun {
    const id = input.id ?? generateRunId();
    const now = new Date().toISOString();
    const targetFilesTruncated = input.target_files_truncated ? 1 : 0;
    const targetFilesDroppedCount = input.target_files_dropped_count ?? 0;

    if (!Array.isArray(input.target_files) || input.target_files.some((f) => typeof f !== "string")) {
      throw new Error("target_files must be a string array");
    }
    if (input.target_files.length === 0) {
      throw new Error("target_files must not be empty");
    }
    const dropped = input.target_files_dropped_count ?? 0;
    if (
      !Number.isSafeInteger(dropped) ||
      dropped < 0 ||
      (input.target_files_truncated === true) !== (dropped > 0)
    ) {
      throw new Error("Invalid target file truncation metadata");
    }
    const targetFilesJson = JSON.stringify(input.target_files);

    try {
      this.db.prepare(
        `INSERT INTO graph_runs (id, issue_id, thread_id, workspace_id, definition_id, definition_version, status, blocked_reason_code, blocked_node_keys, target_files_json, target_files_hash, target_files_truncated, target_files_dropped_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, input.issue_id, input.thread_id, input.workspace_id,
        input.definition_id, input.definition_version, input.status,
        targetFilesJson, input.target_files_hash,
        targetFilesTruncated, targetFilesDroppedCount,
        now, now,
      );
    } catch (error) {
      if (isNonTerminalGraphConflict(error)) {
        throw new GraphConstraintError(
          "A non-terminal graph run already exists for this issue.",
          "nonterminal_graph",
        );
      }
      throw error;
    }

    const row = this.db.prepare("SELECT * FROM graph_runs WHERE id = ?").get(id) as GraphRunRow;
    return mapRow(row);
  }

  getById(id: string): GraphRun | null {
    const row = this.db.prepare("SELECT * FROM graph_runs WHERE id = ?").get(id) as GraphRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  getByIssueId(issueId: string): GraphRun | null {
    const row = this.db.prepare(
      "SELECT * FROM graph_runs WHERE issue_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
    ).get(issueId) as GraphRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  getNonTerminalByIssueId(issueId: string): GraphRun | null {
    const row = this.db.prepare(
      `SELECT * FROM graph_runs WHERE issue_id = ? AND status IN ('running', 'blocked', 'cancelling')
       ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(issueId) as GraphRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  listNonTerminal(): GraphRun[] {
    const rows = this.db.prepare(
      `SELECT * FROM graph_runs WHERE status IN ('running', 'blocked', 'cancelling')
       ORDER BY created_at ASC, id ASC`
    ).all() as GraphRunRow[];
    return rows.map(mapRow);
  }

  compareAndSetStatus(
    id: string,
    expected: GraphRunStatus,
    next: GraphRunStatus,
    patch?: {
      blocked_reason_code?: GraphBlockReason | null;
      blocked_node_keys?: GraphNodeKey[] | null;
    },
  ): GraphRunCompareAndSetResult {
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [next, new Date().toISOString()];

    if (patch?.blocked_reason_code !== undefined) {
      sets.push("blocked_reason_code = ?");
      values.push(patch.blocked_reason_code);
    }
    if (patch?.blocked_node_keys !== undefined) {
      sets.push("blocked_node_keys = ?");
      values.push(patch.blocked_node_keys !== null ? JSON.stringify(patch.blocked_node_keys) : null);
    }

    values.push(id, expected);

    const result = this.db.prepare(
      `UPDATE graph_runs SET ${sets.join(", ")} WHERE id = ? AND status = ?`
    ).run(...values);

    if (result.changes === 0) {
      return { success: false, graphRun: null };
    }

    const row = this.db.prepare("SELECT * FROM graph_runs WHERE id = ?").get(id) as GraphRunRow;
    return { success: true, graphRun: mapRow(row) };
  }
}