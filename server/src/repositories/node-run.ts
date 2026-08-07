import type Database from "better-sqlite3";
import type { NodeRun, NodeRunStatus, GraphNodeKey } from "@personahub/shared/types";
import { generateRunId } from "../id.js";
import { isNodeRunDuplicateConflict, GraphConstraintError } from "../db/sqlite-errors.js";

export interface NodeRunCreateInput {
  id?: string;
  graph_run_id: string;
  node_key: GraphNodeKey;
  status: NodeRunStatus;
  assigned_adapter_config_id: string;
}

export interface NodeRunCompareAndSetResult {
  success: boolean;
  nodeRun: NodeRun | null;
}

interface NodeRunRow {
  id: string;
  graph_run_id: string;
  node_key: string;
  status: string;
  join_satisfied_at: string | null;
  result_event_id: string | null;
  assigned_adapter_config_id: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: NodeRunRow): NodeRun {
  return {
    id: row.id,
    graph_run_id: row.graph_run_id,
    node_key: row.node_key as GraphNodeKey,
    status: row.status as NodeRunStatus,
    join_satisfied_at: row.join_satisfied_at,
    result_event_id: row.result_event_id,
    assigned_adapter_config_id: row.assigned_adapter_config_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class NodeRunRepository {
  constructor(private db: Database.Database) {}

  create(input: NodeRunCreateInput): NodeRun {
    const id = input.id ?? generateRunId();
    const now = new Date().toISOString();

    try {
      this.db.prepare(
        `INSERT INTO node_runs (id, graph_run_id, node_key, status, join_satisfied_at, result_event_id, assigned_adapter_config_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      ).run(id, input.graph_run_id, input.node_key, input.status, input.assigned_adapter_config_id, now, now);
    } catch (error) {
      if (isNodeRunDuplicateConflict(error)) {
        throw new GraphConstraintError(
          "A NodeRun already exists for this (graph_run_id, node_key) pair.",
          "duplicate_node",
        );
      }
      throw error;
    }

    const row = this.db.prepare("SELECT * FROM node_runs WHERE id = ?").get(id) as NodeRunRow;
    return mapRow(row);
  }

  getById(id: string): NodeRun | null {
    const row = this.db.prepare("SELECT * FROM node_runs WHERE id = ?").get(id) as NodeRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  getByGraphRunAndKey(graphRunId: string, nodeKey: GraphNodeKey): NodeRun | null {
    const row = this.db.prepare(
      "SELECT * FROM node_runs WHERE graph_run_id = ? AND node_key = ?"
    ).get(graphRunId, nodeKey) as NodeRunRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByGraphRun(graphRunId: string): NodeRun[] {
    const rows = this.db.prepare(
      "SELECT * FROM node_runs WHERE graph_run_id = ? ORDER BY created_at ASC, id ASC"
    ).all(graphRunId) as NodeRunRow[];
    return rows.map(mapRow);
  }

  compareAndSetStatus(
    id: string,
    expected: NodeRunStatus,
    next: NodeRunStatus,
    patch?: {
      join_satisfied_at?: string | null;
      result_event_id?: string | null;
    },
  ): NodeRunCompareAndSetResult {
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [next, new Date().toISOString()];

    if (patch?.join_satisfied_at !== undefined) {
      sets.push("join_satisfied_at = ?");
      values.push(patch.join_satisfied_at);
    }
    if (patch?.result_event_id !== undefined) {
      sets.push("result_event_id = ?");
      values.push(patch.result_event_id);
    }

    values.push(id, expected);

    const result = this.db.prepare(
      `UPDATE node_runs SET ${sets.join(", ")} WHERE id = ? AND status = ?`
    ).run(...values);

    if (result.changes === 0) {
      return { success: false, nodeRun: null };
    }

    const row = this.db.prepare("SELECT * FROM node_runs WHERE id = ?").get(id) as NodeRunRow;
    return { success: true, nodeRun: mapRow(row) };
  }

  /** design.md §9 resolve-executors: rewrite the persisted executor after a
   *  no_capable_adapter blocker. Unconditional — the caller has already
   *  re-run resolveEligibleAdapter() and is the sole writer of this column
   *  outside of create(). */
  updateAssignedAdapter(id: string, adapterConfigId: string): NodeRun {
    this.db.prepare(
      "UPDATE node_runs SET assigned_adapter_config_id = ?, updated_at = ? WHERE id = ?"
    ).run(adapterConfigId, new Date().toISOString(), id);
    const row = this.db.prepare("SELECT * FROM node_runs WHERE id = ?").get(id) as NodeRunRow;
    return mapRow(row);
  }

  hasAnyReference(adapterConfigId: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM node_runs WHERE assigned_adapter_config_id = ? LIMIT 1"
    ).get(adapterConfigId) as { 1: number } | undefined;
    return row !== undefined;
  }
}