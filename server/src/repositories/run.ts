import type Database from "better-sqlite3";
import type { Run, RunStatus, FailureReason, RunRole, RunDispatchSource, AdapterIdentitySnapshot } from "@personahub/shared/types";
import { RunRole as RR, RunDispatchSource as RDS } from "@personahub/shared/types";
import { generateRunId } from "../id.js";

export interface RunCreateInput {
  issue_id: string;
  thread_id: string;
  workspace_id: string;
  adapter_config_id: string;
  instructions: string;
  status: RunStatus;
  role?: RunRole;
  dispatch_source?: RunDispatchSource;
  validation_round?: number | null;
  adapter_identity?: AdapterIdentitySnapshot | null;
}

export interface RunTransitionResult {
  success: boolean;
  run: Run | null;
}

interface RunRow {
  id: string;
  issue_id: string;
  thread_id: string;
  workspace_id: string;
  adapter_config_id: string;
  status: string;
  failure_reason: string | null;
  instructions: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  error_message: string | null;
  role: string;
  workflow_step: string | null;
  validation_round: number | null;
  dispatch_source: string;
  final_message: string | null;
  adapter_identity_json: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: RunRow): Run {
  return {
    id: row.id,
    issue_id: row.issue_id,
    thread_id: row.thread_id,
    workspace_id: row.workspace_id,
    adapter_config_id: row.adapter_config_id,
    status: row.status as RunStatus,
    failure_reason: row.failure_reason as FailureReason | null,
    instructions: row.instructions,
    started_at: row.started_at,
    completed_at: row.completed_at,
    exit_code: row.exit_code,
    error_message: row.error_message,
    role: row.role as RunRole,
    workflow_step: row.workflow_step as "implementation" | "validation" | null,
    validation_round: row.validation_round,
    dispatch_source: row.dispatch_source as RunDispatchSource,
    adapter_identity: row.adapter_identity_json
      ? (JSON.parse(row.adapter_identity_json) as AdapterIdentitySnapshot)
      : null,
    has_final_message: row.final_message !== null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class RunRepository {
  constructor(private db: Database.Database) {}

  create(input: RunCreateInput): Run {
    const id = generateRunId();
    const now = new Date().toISOString();
    const role = input.role ?? RR.Implementation;
    const workflowStep = role === RR.Validator ? "validation" : "implementation";
    const dispatchSource = input.dispatch_source ?? RDS.UserExplicit;
    const validationRound = input.validation_round ?? null;
    const identityJson = input.adapter_identity ? JSON.stringify(input.adapter_identity) : null;

    this.db.prepare(
      `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, failure_reason, instructions, role, workflow_step, validation_round, dispatch_source, adapter_identity_json, started_at, completed_at, exit_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`
    ).run(id, input.issue_id, input.thread_id, input.workspace_id, input.adapter_config_id, input.status, input.instructions, role, workflowStep, validationRound, dispatchSource, identityJson, now, now);

    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow;
    return mapRow(row);
  }

  getById(id: string): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByIssue(issueId: string): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE issue_id = ? ORDER BY created_at DESC"
    ).all(issueId) as RunRow[];
    return rows.map(mapRow);
  }

  listQueuedByWorkspace(workspaceId: string): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE workspace_id = ? AND status = 'queued' ORDER BY created_at ASC, id ASC"
    ).all(workspaceId) as RunRow[];
    return rows.map(mapRow);
  }

  listRunning(): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE status = 'running'"
    ).all() as RunRow[];
    return rows.map(mapRow);
  }

  transitionStatus(
    id: string,
    expectedStatus: RunStatus,
    newStatus: RunStatus,
    updates: {
      failure_reason?: FailureReason | null;
      started_at?: string | null;
      completed_at?: string | null;
      exit_code?: number | null;
      error_message?: string | null;
      final_message?: string | null;
    },
  ): RunTransitionResult {
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [newStatus, new Date().toISOString()];

    if (updates.failure_reason !== undefined) { sets.push("failure_reason = ?"); values.push(updates.failure_reason); }
    if (updates.started_at !== undefined) { sets.push("started_at = ?"); values.push(updates.started_at); }
    if (updates.completed_at !== undefined) { sets.push("completed_at = ?"); values.push(updates.completed_at); }
    if (updates.exit_code !== undefined) { sets.push("exit_code = ?"); values.push(updates.exit_code); }
    if (updates.error_message !== undefined) { sets.push("error_message = ?"); values.push(updates.error_message); }
    if (updates.final_message !== undefined) { sets.push("final_message = ?"); values.push(updates.final_message); }

    values.push(id, expectedStatus);

    const result = this.db.prepare(
      `UPDATE runs SET ${sets.join(", ")} WHERE id = ? AND status = ?`
    ).run(...values);

    if (result.changes === 0) {
      return { success: false, run: null };
    }

    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow;
    return { success: true, run: mapRow(row) };
  }

  updateInstructions(id: string, instructions: string): void {
    this.db.prepare("UPDATE runs SET instructions = ?, updated_at = ? WHERE id = ?")
      .run(instructions, new Date().toISOString(), id);
  }

  getLatestCompletedByRole(issueId: string, role: RunRole, beforeRunId?: string): Run | null {
    const roleStr = role as string;
    if (beforeRunId) {
      const beforeRow = this.db.prepare(
        "SELECT created_at, id FROM runs WHERE id = ?",
      ).get(beforeRunId) as { created_at: string; id: string } | undefined;
      if (!beforeRow) {
        return null;
      }
      const row = this.db.prepare(
        `SELECT * FROM runs
         WHERE issue_id = ? AND role = ? AND status = 'completed'
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      ).get(issueId, roleStr, beforeRow.created_at, beforeRow.created_at, beforeRow.id) as RunRow | undefined;
      return row ? mapRow(row) : null;
    }
    const row = this.db.prepare(
      `SELECT * FROM runs
       WHERE issue_id = ? AND role = ? AND status = 'completed'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(issueId, roleStr) as RunRow | undefined;
    return row ? mapRow(row) : null;
  }

  getActiveValidator(issueId: string): Run | null {
    const row = this.db.prepare(
      `SELECT * FROM runs
       WHERE issue_id = ? AND role = 'validator' AND status IN ('queued', 'running')
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    ).get(issueId) as RunRow | undefined;
    return row ? mapRow(row) : null;
  }

  getValidatorRunByRound(issueId: string, round: number): Run | null {
    const row = this.db.prepare(
      `SELECT * FROM runs
       WHERE issue_id = ? AND role = 'validator' AND validation_round = ?
       ORDER BY created_at ASC, id ASC LIMIT 1`,
    ).get(issueId, round) as RunRow | undefined;
    return row ? mapRow(row) : null;
  }

  getLatestTerminalByRole(issueId: string, role: RunRole): Run | null {
    const roleStr = role as string;
    const row = this.db.prepare(
      `SELECT * FROM runs
       WHERE issue_id = ? AND role = ? AND status IN ('completed', 'failed', 'cancelled', 'interrupted')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(issueId, roleStr) as RunRow | undefined;
    return row ? mapRow(row) : null;
  }
}
