import type Database from "better-sqlite3";
import type { RunTraceState } from "@personahub/shared/types";
import { CommandTraceCapability, BaselineStatus } from "@personahub/shared/types";

interface RunTraceStateRow {
  run_id: string;
  command_trace_capability: string;
  baseline_status: string;
  scanner_type: string | null;
  baseline_json: string | null;
  baseline_error_code: string | null;
  baseline_captured_at: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: RunTraceStateRow): RunTraceState {
  return {
    run_id: row.run_id,
    command_trace_capability: row.command_trace_capability as CommandTraceCapability,
    baseline_status: row.baseline_status as BaselineStatus,
    scanner_type: row.scanner_type,
    baseline_json: row.baseline_json,
    baseline_error_code: row.baseline_error_code,
    baseline_captured_at: row.baseline_captured_at,
    finalized_at: row.finalized_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class RunTraceRepository {
  constructor(private db: Database.Database) {}

  createPending(runId: string, capability: CommandTraceCapability, now: string): RunTraceState {
    this.db.prepare(
      `INSERT INTO run_trace_states (run_id, command_trace_capability, baseline_status, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         command_trace_capability = excluded.command_trace_capability,
         baseline_status = CASE WHEN run_trace_states.finalized_at IS NULL THEN 'pending' ELSE run_trace_states.baseline_status END,
         updated_at = excluded.updated_at`,
    ).run(runId, capability, now, now);

    return this.get(runId)!;
  }

  saveBaseline(runId: string, scannerType: string, baselineJson: string, now: string): void {
    this.db.prepare(
      `UPDATE run_trace_states
       SET baseline_status = 'captured', scanner_type = ?, baseline_json = ?, baseline_captured_at = ?, updated_at = ?
       WHERE run_id = ? AND finalized_at IS NULL`,
    ).run(scannerType, baselineJson, now, now, runId);
  }

  saveBaselineFailure(runId: string, reasonCode: string, now: string): void {
    this.db.prepare(
      `UPDATE run_trace_states
       SET baseline_status = 'failed', baseline_error_code = ?, updated_at = ?
       WHERE run_id = ? AND finalized_at IS NULL`,
    ).run(reasonCode, now, runId);
  }

  get(runId: string): RunTraceState | null {
    const row = this.db.prepare("SELECT * FROM run_trace_states WHERE run_id = ?").get(runId) as RunTraceStateRow | undefined;
    return row ? mapRow(row) : null;
  }

  listTerminalUnfinalized(): RunTraceState[] {
    const rows = this.db.prepare(
      `SELECT rts.* FROM run_trace_states rts
       JOIN runs r ON r.id = rts.run_id
       WHERE rts.finalized_at IS NULL
         AND r.status IN ('completed', 'failed', 'interrupted', 'cancelled')
         AND r.started_at IS NOT NULL`,
    ).all() as RunTraceStateRow[];
    return rows.map(mapRow);
  }

  markFinalized(runId: string, now: string): boolean {
    const result = this.db.prepare(
      "UPDATE run_trace_states SET finalized_at = ?, updated_at = ? WHERE run_id = ? AND finalized_at IS NULL",
    ).run(now, now, runId);
    return result.changes > 0;
  }
}
