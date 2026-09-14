// F012 T012: restart recovery (design §5.6) — a fixed-order startup scan over
// the four residue classes a crash can leave behind. Order matters: due
// drafts re-enter the normal claim flow first; expired starting leases are
// resumed UNDER THE SAME dispatch (never a second attempt — the seq=1 check
// short-circuits back to the spawn stage); queued Runs are re-spawned (the
// normal post-commit-crash state); running Runs are declared interrupted via
// the isRunOwnerDead() inference. Pause intent lives in dispatch_gates and
// therefore survives restarts untouched (§5.6).

import type Database from "better-sqlite3";
import type { Attempt, Run } from "@personahub/shared/types";
import type { DomainOutbox } from "./domain-outbox.js";
import type { StaleRecoveryService } from "./stale-recovery.js";
import type { DispatchService } from "./dispatch-service.js";

/**
 * ADR 0015 §3: "the new process starting implies the previous owner is gone."
 * v0.3 runs a single server process per machine, so a Run still marked
 * `running` at startup belongs to a dead process. The inference is named so
 * the multi-machine rollout (v0.7) replaces exactly this body (lease/heartbeat
 * based) without touching the recovery flow.
 */
export function isRunOwnerDead(_run: Pick<Run, "id" | "started_at">): boolean {
  return true; // single-process assumption — see ADR 0015 §3
}

export interface DispatchRecoveryOptions {
  /** Post-commit spawn hook shared with DispatchService. */
  spawnRun: (runId: string) => Promise<void>;
}

export class DispatchRecoveryService {
  constructor(
    private db: Database.Database,
    private outbox: DomainOutbox,
    private staleRecovery: StaleRecoveryService,
    private dispatchService: DispatchService,
    private options: DispatchRecoveryOptions,
  ) {}

  /** Full startup scan; returns a per-class tally for diagnostics. */
  async recoverAll(worker: string): Promise<{
    draftsClaimed: string[];
    leasesResumed: string[];
    runsRespawned: string[];
    runsInterrupted: number;
  }> {
    const draftsClaimed = await this.claimDueDrafts(worker);
    const leasesResumed = await this.resumeExpiredLeases(worker);
    const runsRespawned = await this.respawnQueuedRuns();
    const runsInterrupted = await this.interruptRunningRuns();
    return { draftsClaimed, leasesResumed, runsRespawned, runsInterrupted };
  }

  private async claimDueDrafts(worker: string): Promise<string[]> {
    // Due drafts re-enter the normal claim flow — gates and the acceptance
    // lock are re-checked inside claimAndStart's critical section (§5.4).
    return this.dispatchService.claimDue(worker);
  }

  /** Expired starting leases: resume under the SAME dispatch. A dispatch that
   *  already has its seq=1 attempt goes straight back to the spawn stage —
   *  a second attempt must never be created for one dispatch's start (§5.6).
   *  Deterministic failures are retried as start_failed by re-running start's
   *  assembly only when no attempt exists yet. */
  private async resumeExpiredLeases(worker: string): Promise<string[]> {
    const now = new Date().toISOString();
    const expired = this.db
      .prepare("SELECT * FROM dispatches WHERE state = 'starting' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?")
      .all(now) as DispatchRow[];
    const resumed: string[] = [];
    for (const dispatch of expired) {
      const attempt = this.db
        .prepare("SELECT * FROM attempts WHERE dispatch_id = ? AND seq = 1")
        .get(dispatch.id) as Attempt | undefined;
      const takeover = this.db
        .prepare(
          "UPDATE dispatches SET lease_owner = ?, lease_expires_at = ? WHERE id = ? AND state = 'starting' AND lease_expires_at <= ?",
        )
        .run(worker, new Date(Date.now() + 120_000).toISOString(), dispatch.id, now);
      if (takeover.changes === 0) continue; // another owner took it first

      if (attempt && attempt.run_id) {
        // Commit already happened pre-crash; the residue is just the spawn.
        resumed.push(dispatch.id);
        await this.options.spawnRun(attempt.run_id);
      } else {
        resumed.push(dispatch.id);
        await this.dispatchService.resumeStart(dispatch.id, worker);
      }
    }
    return resumed;
  }

  /** queued Runs after a post-commit crash are a normal state — re-spawn. */
  private async respawnQueuedRuns(): Promise<string[]> {
    const queued = this.db
      .prepare("SELECT id, started_at FROM runs WHERE status = 'queued' ORDER BY created_at ASC")
      .all() as Array<Pick<Run, "id" | "started_at">>;
    for (const run of queued) {
      if (!isRunOwnerDead(run)) continue; // v0.3: always true (single process)
      await this.options.spawnRun(run.id);
    }
    return queued.map((run) => run.id);
  }

  /** running Runs: the owner process is dead by isRunOwnerDead() — delegate
   *  to the existing StaleRecoveryService for the interrupted transition,
   *  trace finalization and lock release (no second implementation to drift). */
  private async interruptRunningRuns(): Promise<number> {
    const running = this.db.prepare("SELECT COUNT(*) AS c FROM runs WHERE status = 'running'").get() as { c: number };
    if (running.c === 0) return 0;
    await this.staleRecovery.recoverStaleRuns();
    return running.c;
  }
}

interface DispatchRow {
  id: string;
  state: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
}

