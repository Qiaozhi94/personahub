import type Database from "better-sqlite3";
import type { Run, RunStatus, FailureReason, RunRole, RunDispatchSource, RunPurpose as RunPurposeType, AdapterIdentitySnapshot } from "@personahub/shared/types";
import { RunRole as RR, RunDispatchSource as RDS, RunPurpose } from "@personahub/shared/types";
import { generateRunId } from "../id.js";
import { isActiveGraphAttemptConflict, GraphConstraintError } from "../db/sqlite-errors.js";

export interface RunCreateInput {
  /** Pre-generated id — lets a caller build content that must reference the Run's own id (e.g. validator context) before the row exists, so the row can be created once with final content instead of insert-then-update. Omitted generates one internally. */
  id?: string;
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
  purpose?: RunPurposeType;
  context_source_run_id?: string | null;
  /** F006: parent NodeRun for graph-node Runs. null for non-graph Runs. */
  node_run_id?: string | null;
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
  purpose: string;
  context_source_run_id: string | null;
  node_run_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Design §7.4: role -> workflow_step derivation. Consult never gets a workflow_step. */
function deriveWorkflowStep(role: RunRole): "implementation" | "validation" | null {
  switch (role) {
    case RR.Implementation:
      return "implementation";
    case RR.Validator:
      return "validation";
    case RR.Consult:
    case RR.GraphNode:
      return null;
  }
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
    purpose: row.purpose as RunPurposeType,
    context_source_run_id: row.context_source_run_id,
    node_run_id: row.node_run_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class RunRepository {
  constructor(private db: Database.Database) {}

  create(input: RunCreateInput): Run {
    const id = input.id ?? generateRunId();
    const now = new Date().toISOString();
    const role = input.role ?? RR.Implementation;
    const workflowStep = deriveWorkflowStep(role);
    const dispatchSource = input.dispatch_source ?? RDS.UserExplicit;
    const validationRound = input.validation_round ?? null;
    const identityJson = input.adapter_identity ? JSON.stringify(input.adapter_identity) : null;
    const purpose = input.purpose ?? RunPurpose.WorkflowBound;
    const contextSourceRunId = input.context_source_run_id ?? null;
    const nodeRunId = input.node_run_id ?? null;

    if ((role === RR.GraphNode) !== (nodeRunId !== null)) {
      throw new Error(
        "Invariant violation: GraphNode runs require node_run_id, and only GraphNode runs may set it.",
      );
    }

    try {
      this.db.prepare(
        `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, failure_reason, instructions, role, workflow_step, validation_round, dispatch_source, adapter_identity_json, started_at, completed_at, exit_code, error_message, purpose, context_source_run_id, node_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
      ).run(id, input.issue_id, input.thread_id, input.workspace_id, input.adapter_config_id, input.status, input.instructions, role, workflowStep, validationRound, dispatchSource, identityJson, purpose, contextSourceRunId, nodeRunId, now, now);
    } catch (error) {
      if (isActiveGraphAttemptConflict(error)) {
        throw new GraphConstraintError(
          "This graph node already has an active attempt.",
          "active_attempt",
        );
      }
      throw error;
    }

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

  /** F005: filter an Issue's Runs to just workflow-bound or just ad-hoc-consult (design §7.4/§10.3). */
  listByIssueAndPurpose(issueId: string, purpose: RunPurposeType): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE issue_id = ? AND purpose = ? ORDER BY created_at DESC"
    ).all(issueId, purpose) as RunRow[];
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

  getFinalMessage(runId: string): string | null {
    const row = this.db.prepare("SELECT final_message FROM runs WHERE id = ?").get(runId) as { final_message: string | null } | undefined;
    return row?.final_message ?? null;
  }
}
