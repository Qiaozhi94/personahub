// F012 T012: three-layer dispatch gates (design §3.6 / §5.4). Pause only ever
// blocks NEW attempts — a running Attempt keeps executing (PRD §5.10). The
// gate row's monotonic `revision` participates in claim linearization: the
// claim's critical section re-reads the gates inside its own transaction, so
// a pause that committed first is always observed (no missed-start window),
// and the persisted row survives restarts without user action (§5.6).

import type Database from "better-sqlite3";
import { GateScopeType, GateState, type DispatchGate } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";

export class DispatchGateService {
  constructor(private db: Database.Database) {}

  get(scopeType: GateScopeType, scopeId: string): DispatchGate {
    const row = this.db
      .prepare("SELECT * FROM dispatch_gates WHERE scope_type = ? AND scope_id = ?")
      .get(scopeType, scopeId) as DispatchGate | undefined;
    if (!row) throw new AppError(ErrorCode.GATE_SCOPE_UNKNOWN, `No gate for ${scopeType}/${scopeId}.`);
    return row;
  }

  /** Returns the gates relevant for a dispatch on this room: the runtime
   *  row, the room's issue row (when bound) and — for graph dispatches — the
   *  graph row keyed by graph_run_id. Issue/graph rows are created lazily on
   *  first pause; absence means open. */
  relevantFor(issueId: string | null, graphRunId: string | null): DispatchGate[] {
    const rows: DispatchGate[] = [this.get(GateScopeType.Runtime, "local")];
    const optional: Array<[GateScopeType, string]> = [];
    if (issueId) optional.push([GateScopeType.Issue, issueId]);
    if (graphRunId) optional.push([GateScopeType.Graph, graphRunId]);
    for (const [scopeType, scopeId] of optional) {
      const row = this.db
        .prepare("SELECT * FROM dispatch_gates WHERE scope_type = ? AND scope_id = ?")
        .get(scopeType, scopeId) as DispatchGate | undefined;
      if (row) rows.push(row);
    }
    return rows;
  }

  /** Must run inside the claim/confirm transaction: reads see every
   *  previously committed pause, and better-sqlite3's serialized writes make
   *  the read+CAS pair atomic against concurrent pause commits. */
  assertOpenFor(issueId: string | null, graphRunId: string | null): void {
    if (this.isPausedFor(issueId, graphRunId)) {
      throw new AppError(ErrorCode.DISPATCH_GATE_PAUSED, "Dispatch gate paused — resume via the runtime/task surface.");
    }
  }

  /** Claim-path variant: a paused gate is "not now", not an error. */
  isPausedFor(issueId: string | null, graphRunId: string | null): boolean {
    return this.relevantFor(issueId, graphRunId).some((gate) => gate.state === GateState.Paused);
  }

  setPaused(scopeType: GateScopeType, scopeId: string, paused: boolean, reason: string | null, actor: string): DispatchGate {
    const now = new Date().toISOString();
    const state = paused ? GateState.Paused : GateState.Open;
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT revision FROM dispatch_gates WHERE scope_type = ? AND scope_id = ?")
        .get(scopeType, scopeId) as { revision: number } | undefined;
      if (!existing) {
        // issue/graph gates are created on first pause; runtime is seeded.
        this.db
          .prepare(
            "INSERT INTO dispatch_gates (scope_type, scope_id, state, revision, reason, actor, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
          )
          .run(scopeType, scopeId, state, reason, actor, now);
      } else {
        this.db
          .prepare(
            "UPDATE dispatch_gates SET state = ?, revision = revision + 1, reason = ?, actor = ?, updated_at = ? WHERE scope_type = ? AND scope_id = ?",
          )
          .run(state, reason, actor, now, scopeType, scopeId);
      }
    });
    tx();
    return this.get(scopeType, scopeId);
  }

  /** Issue gate rows are created lazily by setPaused; tasks without a pause
   *  history simply have no row — open by absence. */
  ensureIssueGate(issueId: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO dispatch_gates (scope_type, scope_id, state, revision, reason, actor, updated_at) VALUES ('issue', ?, 'open', 0, 'seeded', 'system', ?)",
      )
      .run(issueId, new Date().toISOString());
  }
}
