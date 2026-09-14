// F012 T010: DispatchService — the ONLY dispatch write path (不变量 7). UI,
// F006 graph scheduler and F011 actions all go through here; no second Run
// creation path survives.
//
// Three legal lifecycle paths (§5.1): draft → cancelled, draft → starting →
// dispatched, or draft → starting → start_failed on deterministic assembly
// errors. The confirm transaction (commit point 1) inserts exactly one draft
// per (room_id, client_request_id) and enqueues dispatch.drafted in the SAME
// transaction; the deadline claim (commit point 2) CASes draft → starting
// under a lease with the gate check inside the same critical section (§5.4);
// the start transaction (commit point 3) writes context snapshot, F010
// consumption, the first Attempt + queued Run and the dispatched state
// atomically — the process spawns only AFTER that commit (不变量 7).

import type Database from "better-sqlite3";
import {
  DispatchState,
  RunStatus,
  RunRole,
  RunPurpose,
  RunDispatchSource,
  StartMode,
  type Attempt,
  type ContextScope,
  type Dispatch,
  type DispatchPurpose as DispatchPurposeValue,
  type ExecutionIdentity,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import { isUniqueViolation } from "../db/sqlite-errors.js";
import { generateAttemptId, generateDispatchId, generateRunId } from "../id.js";
import type { DomainOutbox } from "./domain-outbox.js";
import type { DispatchGateService } from "./dispatch-gate-service.js";
import type { ContextAssembler, AssembledContext } from "./context-assembler.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { RunRepository } from "../repositories/run.js";
import { decideStartMode } from "./context-assembler.js";

export interface DispatchConfirmInput {
  roomId: string;
  clientRequestId: string;
  purpose: DispatchPurposeValue;
  identity: ExecutionIdentity;
  identitySnapshotJson: string;
  contextScope: ContextScope;
  skillRevisionRefs: string[];
  /** F013 resolver verbatim output — frozen on the row (AC-001). */
  effectiveRequirementsJson: string;
  effectiveRequirementsHash: string;
  handoffRefs: string[];
  taskScopeJson: string | null;
  /** Soft-requirement deviation record; structural gaps are rejected upstream. */
  requirementOverride: { requirementId: string; strength: string; reason: string } | null;
  graceWindowMs: number;
  actor: string;
  /** ADR 0009 §4 cold-start condition #1 — user explicitly restarts. */
  userRequestedRestart?: boolean;
}

export interface StartOutcome {
  dispatch: Dispatch;
  attemptId: string | null;
  runId: string | null;
  startMode: StartMode | null;
  spawn: boolean;
}

export interface DispatchServiceOptions {
  /** Default 10s, configurable 0–60000 (§5.1). */
  graceWindowMs?: () => number;
  leaseMs?: number;
  /** F011 wiring point: query the issue's acceptance case state. */
  acceptanceLock?: (issueId: string) => { locked: boolean; reason?: string };
  /** Post-commit spawn hook — MUST NOT run any earlier (不变量 7). */
  spawnRun?: (runId: string) => Promise<void>;
  /** Wired to the existing RunDispatchService.cancel for running Runs. */
  cancelRunningRun?: (runId: string) => Promise<void>;
  nativeMemoryIsolation?: (provider: string) => "supported" | "unsupported" | "unverified";
}

const LEASE_DEFAULT_MS = 120_000;

export class DispatchService {
  constructor(
    private db: Database.Database,
    private outbox: DomainOutbox,
    private gates: DispatchGateService,
    private assembler: ContextAssembler,
    private agentConfigRepo: AgentConfigRepository,
    private runRepo: RunRepository,
    private options: DispatchServiceOptions = {},
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  private graceDeadline(from: string, windowMs: number): string {
    return new Date(Date.parse(from) + windowMs).toISOString();
  }

  get(dispatchId: string): Dispatch {
    const row = this.db.prepare("SELECT * FROM dispatches WHERE id = ?").get(dispatchId) as Dispatch | undefined;
    if (!row) throw new AppError(ErrorCode.DISPATCH_NOT_FOUND, `Dispatch not found: ${dispatchId}`);
    return row;
  }

  listByRoom(roomId: string): Dispatch[] {
    return this.db
      .prepare("SELECT * FROM dispatches WHERE room_id = ? ORDER BY created_at ASC")
      .all(roomId) as Dispatch[];
  }

  getContextSnapshot(dispatchId: string): unknown {
    return (
      this.db.prepare("SELECT * FROM dispatch_context_snapshots WHERE dispatch_id = ?").get(dispatchId) ?? null
    );
  }

  listAttempts(dispatchId: string): Attempt[] {
    return this.db
      .prepare("SELECT * FROM attempts WHERE dispatch_id = ? ORDER BY seq ASC")
      .all(dispatchId) as Attempt[];
  }

  // ---------------------------------------------------------------- confirm

  confirm(input: DispatchConfirmInput): Dispatch {
    if (input.graceWindowMs < 0 || input.graceWindowMs > 60_000) {
      throw new AppError(ErrorCode.DISPATCH_GRACE_WINDOW_INVALID, "grace window must be 0–60000ms.");
    }
    // Idempotent replay: the same (room, client_request_id) returns the
    // original draft and writes no second event (FR-004).
    const existing = this.db
      .prepare("SELECT * FROM dispatches WHERE room_id = ? AND client_request_id = ?")
      .get(input.roomId, input.clientRequestId) as Dispatch | undefined;
    if (existing) return existing;

    const room = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(input.roomId) as
      | { id: string; issue_id: string | null; state: string }
      | undefined;
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, `Room not found: ${input.roomId}`);
    if (room.state === "ended") throw new AppError(ErrorCode.ROOM_ENDED, "Room has ended.");

    this.gates.assertOpenFor(room.issue_id, null);
    if (room.issue_id) this.assertAcceptanceUnlocked(room.issue_id);

    const adapter = this.agentConfigRepo.getById(input.identity.adapter_config_id);
    if (!adapter) throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");

    const now = this.now();
    const id = generateDispatchId();
    if (input.userRequestedRestart) this.restartFlags.set(id, true);
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO dispatches (id, room_id, issue_id, client_request_id, state, purpose, runtime_id, adapter_config_id, access_ref, model, depth_raw, depth_normalized, identity_snapshot_json, context_scope, skill_revision_refs_json, effective_requirements_json, effective_requirements_hash, handoff_refs_json, task_scope_json, requirement_override_json, grace_deadline_at, created_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, input.roomId, room.issue_id, input.clientRequestId, input.purpose,
          input.identity.runtime_id, input.identity.adapter_config_id, input.identity.access_ref,
          input.identity.model, input.identity.depth_raw, input.identity.depth_normalized,
          input.identitySnapshotJson, input.contextScope, JSON.stringify(input.skillRevisionRefs),
          input.effectiveRequirementsJson, input.effectiveRequirementsHash, JSON.stringify(input.handoffRefs),
          input.taskScopeJson,
          input.requirementOverride ? JSON.stringify(input.requirementOverride) : null,
          this.graceDeadline(now, input.graceWindowMs), now,
        );
      this.outbox.enqueue(this.db, {
        topic: "dispatch.drafted",
        dedupeKey: `dispatch:${id}:drafted`,
        payload: {
          dispatch_id: id, room_id: input.roomId, issue_id: room.issue_id,
          identity: input.identity, context_scope: input.contextScope,
          grace_deadline_at: this.graceDeadline(now, input.graceWindowMs),
          requirements_hash: input.effectiveRequirementsHash,
        },
      });
      if (input.requirementOverride) {
        this.outbox.enqueue(this.db, {
          topic: "dispatch.requirement_overridden",
          dedupeKey: `dispatch:${id}:requirement_overridden:${input.requirementOverride.requirementId}`,
          payload: {
            dispatch_id: id,
            requirement_id: input.requirementOverride.requirementId,
            strength: input.requirementOverride.strength,
            actor: input.actor,
          },
        });
      }
    });
    try {
      insert();
    } catch (error) {
      // Concurrent identical confirm: the PK winner's draft is the answer.
      if (isUniqueViolation(error, "dispatches.")) {
        const winner = this.db
          .prepare("SELECT * FROM dispatches WHERE room_id = ? AND client_request_id = ?")
          .get(input.roomId, input.clientRequestId) as Dispatch | undefined;
        if (winner) return winner;
      }
      throw error;
    }
    return this.get(id);
  }

  private assertAcceptanceUnlocked(issueId: string): void {
    const lock = this.options.acceptanceLock?.(issueId);
    if (lock?.locked) {
      // 不变量 14: no new dispatch/attempt once acceptance finalizes; the
      // alternative path is a NEW task (v0.3 has no reopening).
      throw new AppError(
        ErrorCode.DISPATCH_ACCEPTANCE_LOCKED,
        lock.reason ?? "Acceptance case is finalizing/completed — create a new task instead.",
      );
    }
  }

  // ----------------------------------------------------------------- cancel

  cancel(dispatchId: string, actor: string): Dispatch {
    const cancelled = this.db.transaction(() => {
      const result = this.db
        .prepare("UPDATE dispatches SET state = 'cancelled', ended_at = ? WHERE id = ? AND state = 'draft'")
        .run(this.now(), dispatchId);
      if (result.changes === 0) return null;
      this.outbox.enqueue(this.db, {
        topic: "dispatch.cancelled",
        dedupeKey: `dispatch:${dispatchId}:cancelled`,
        payload: { dispatch_id: dispatchId, actor, cancelled_at: this.now() },
      });
      return this.get(dispatchId);
    })();
    if (!cancelled) {
      const current = this.get(dispatchId);
      throw new AppError(
        ErrorCode.DISPATCH_NOT_CANCELLABLE,
        `Dispatch is ${current.state} — only drafts can be cancelled; running attempts must be cancelled individually.`,
      );
    }
    return cancelled;
  }

  /** start-now: give up the remaining grace window and claim immediately. */
  async startNow(dispatchId: string, _worker: string): Promise<StartOutcome> {
    const dispatch = this.get(dispatchId);
    if (dispatch.state !== DispatchState.Draft) {
      throw new AppError(ErrorCode.DISPATCH_NOT_CANCELLABLE, `Dispatch is ${dispatch.state}.`);
    }
    return this.claimAndStart(dispatchId, _worker);
  }

  // ------------------------------------------------------- claim (point 2)

  /** Deadline worker tick: claim every due draft. Gate checks and the draft →
   *  starting CAS share one transaction with the gate reads (§5.4), so a
   *  committed pause can never be followed by a missed start. */
  async claimDue(worker: string): Promise<string[]> {
    const now = this.now();
    const due = this.db
      .prepare("SELECT id FROM dispatches WHERE state = 'draft' AND grace_deadline_at <= ? ORDER BY grace_deadline_at ASC")
      .all(now) as Array<{ id: string }>;
    const claimed: string[] = [];
    for (const row of due) {
      const outcome = await this.claimAndStart(row.id, worker);
      if (outcome.attemptId !== null || outcome.dispatch.state === DispatchState.StartFailed) claimed.push(row.id);
    }
    return claimed;
  }

  async claimAndStart(dispatchId: string, worker: string): Promise<StartOutcome> {
    const leaseMs = this.options.leaseMs ?? LEASE_DEFAULT_MS;
    const now = this.now();
    let gatePaused = false;
    let acceptanceBlocked = false;
    const claimed = this.db.transaction(() => {
      const current = this.get(dispatchId);
      if (current.state !== DispatchState.Draft) return null;
      // Gate reads share this critical section with the CAS (§5.4): a pause
      // that committed earlier is always observed — the draft is left for the
      // next scan instead of a missed start.
      gatePaused = this.gates.isPausedFor(current.issue_id, current.graph_node_run_id);
      if (gatePaused) return null;
      acceptanceBlocked = current.issue_id !== null && (this.options.acceptanceLock?.(current.issue_id)?.locked ?? false);
      const result = this.db
        .prepare(
          "UPDATE dispatches SET state = 'starting', lease_owner = ?, lease_expires_at = ? WHERE id = ? AND state = 'draft'",
        )
        .run(worker, new Date(Date.parse(now) + leaseMs).toISOString(), dispatchId);
      if (result.changes === 0) return null;
      this.outbox.enqueue(this.db, {
        topic: "dispatch.starting",
        dedupeKey: `dispatch:${dispatchId}:starting`,
        payload: { dispatch_id: dispatchId, lease_owner: worker, lease_expires_at: new Date(Date.parse(now) + leaseMs).toISOString() },
      });
      return this.get(dispatchId);
    })();
    if (!claimed) {
      // Lost the race against cancel/another owner, or a gate pause — the
      // worker loop treats both as "not now".
      return { dispatch: this.get(dispatchId), attemptId: null, runId: null, startMode: null, spawn: false };
    }
    if (acceptanceBlocked) {
      // 不变量 14 on the claim path: start_failed instead of an Attempt.
      return this.recordStartFailed(
        claimed,
        ErrorCode.DISPATCH_ACCEPTANCE_LOCKED,
        "Acceptance case is finalizing/completed — create a new task instead.",
      );
    }
    return this.start(claimed, worker);
  }

  // ------------------------------------------------------- start (point 3)

  private async start(dispatch: Dispatch, _worker: string): Promise<StartOutcome> {
    let assembled: AssembledContext;
    const runId = generateRunId();
    try {
      assembled = await this.assembler.assemble({
        dispatch,
        runId,
        taskScope: dispatch.task_scope_json ? JSON.parse(dispatch.task_scope_json) : null,
      });
      this.createQueuedRun(dispatch, runId);
    } catch (error) {
      if (error instanceof AppError) {
        return this.recordStartFailed(dispatch, error.code, error.message);
      }
      if (error instanceof DispatchServiceWorkspaceError) {
        return this.recordStartFailed(
          dispatch,
          ErrorCode.RUNTIME_CONTEXT_UNAVAILABLE,
          "Independent sessions cannot start execution — convert the session to a task first.",
        );
      }
      throw error; // transient: leave the lease to expire for another owner
    }
    const attemptId = generateAttemptId();
    const previous = this.findResumableAttempt(dispatch);
    const provider = this.agentConfigRepo.getById(dispatch.adapter_config_id)?.cli_provider ?? "";
    const nativeMemory = this.options.nativeMemoryIsolation?.(provider) ?? "unverified";
    const mode = decideStartMode({
      purpose: dispatch.purpose,
      previousAttempt: previous,
      userRequestedRestart: this.consumeRestartFlag(dispatch.id),
      previousTerminatedOnPoisonedInput: false,
      sessionUnusable: false,
      nativeMemoryIsolation: nativeMemory,
    });

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attempts (id, dispatch_id, seq, run_id, state, start_mode, resumed_from_attempt_id, provider_session_id, cold_start_reason, created_at)
           VALUES (?, ?, 1, ?, 'queued', ?, ?, NULL, ?, ?)`,
        )
        .run(attemptId, dispatch.id, runId, mode.startMode, mode.resumedFromAttemptId, mode.coldStartReason, this.now());

      this.db
        .prepare(
          "INSERT INTO dispatch_context_snapshots (dispatch_id, scope, items_json, content_hash, assembled_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(dispatch.id, assembled.scope, JSON.stringify(assembled.items), assembled.contentHash, this.now());

      this.assembler.recordConsumptions({ dispatch, runId, taskScope: null }, assembled, this.dispatchThreadId(dispatch));

      this.db
        .prepare("UPDATE dispatches SET state = 'dispatched', started_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?")
        .run(this.now(), dispatch.id);

      this.outbox.enqueue(this.db, {
        topic: "dispatch.context_filtered",
        dedupeKey: `dispatch:${dispatch.id}:context_filtered`,
        payload: {
          dispatch_id: dispatch.id, scope: assembled.scope,
          filtered: assembled.items.filter((item) => item.decision === "filtered"),
          content_hash: assembled.contentHash,
        },
      });
      this.outbox.enqueue(this.db, {
        topic: "dispatch.dispatched",
        dedupeKey: `dispatch:${dispatch.id}:dispatched`,
        payload: {
          dispatch_id: dispatch.id, attempt_id: attemptId, run_id: runId,
          start_mode: mode.startMode, cold_start_reason: mode.coldStartReason,
        },
      });
    })();

    // commit succeeded — and only now may the process spawn (不变量 7).
    if (this.options.spawnRun) await this.options.spawnRun(runId);
    return {
      dispatch: this.get(dispatch.id),
      attemptId,
      runId,
      startMode: mode.startMode,
      spawn: true,
    };
  }

  /** §5.6 lease continuation: re-run the start transaction for a starting
   *  dispatch whose lease expired BEFORE its attempt existed. The seq=1
   *  uniqueness guarantees at most one attempt per dispatch no matter how
   *  many owners take over. */
  async resumeStart(dispatchId: string, _worker: string): Promise<StartOutcome> {
    const dispatch = this.get(dispatchId);
    if (dispatch.state !== DispatchState.Starting) {
      return { dispatch, attemptId: null, runId: null, startMode: null, spawn: false };
    }
    return this.start(dispatch, _worker);
  }

  /** Cancel exactly one Attempt and its Run (§5.4): a cancelled Attempt does
   *  not rewrite the dispatch's dispatched fact, sibling attempts, or any
   *  historical dispatch. Running Runs are cancelled through the injected
   *  hook (wired to the existing RunDispatchService at composition). */
  async cancelAttempt(attemptId: string, actor: string): Promise<Attempt> {
    const attempt = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as Attempt | undefined;
    if (!attempt) throw new AppError(ErrorCode.ATTEMPT_NOT_FOUND, `Attempt not found: ${attemptId}`);
    if (attempt.state !== "queued" && attempt.state !== "running") {
      throw new AppError(ErrorCode.ATTEMPT_NOT_ACTIVE, `Attempt is already ${attempt.state}.`);
    }
    const run = this.runRepo.getById(attempt.run_id);
    if (run && (run.status === RunStatus.Queued || run.status === RunStatus.Running)) {
      if (run.status === RunStatus.Running && this.options.cancelRunningRun) {
        await this.options.cancelRunningRun(run.id);
      } else if (run.status === RunStatus.Queued) {
        this.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Cancelled, { completed_at: this.now() });
      }
    }
    const cancelled = this.db.transaction(() => {
      this.db
        .prepare("UPDATE attempts SET state = 'cancelled', ended_at = ? WHERE id = ? AND state IN ('queued','running')")
        .run(this.now(), attemptId);
      this.outbox.enqueue(this.db, {
        topic: "attempt.cancelled",
        dedupeKey: `attempt:${attemptId}:cancelled`,
        payload: {
          attempt_id: attemptId,
          dispatch_id: attempt.dispatch_id,
          actor,
          preserved: "已产出的事实保留（输出、文件变化、轨迹）",
          voided: "该 Attempt 的执行被终止，不产生新证据主张",
        },
      });
      return this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as Attempt;
    })();
    return cancelled;
  }

  recordStartFailed(dispatch: Dispatch, reasonCode: string, diagnostics: string): StartOutcome {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE dispatches SET state = 'start_failed', failed_reason_code = ?, failed_diagnostics_json = ?, ended_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND state IN ('draft','starting')",
        )
        .run(reasonCode, JSON.stringify({ detail: diagnostics.slice(0, 2000) }), this.now(), dispatch.id);
      this.outbox.enqueue(this.db, {
        topic: "dispatch.start_failed",
        dedupeKey: `dispatch:${dispatchIdSafe(dispatch.id)}:start_failed`,
        payload: { dispatch_id: dispatch.id, reason_code: reasonCode, diagnostics: diagnostics.slice(0, 2000) },
      });
    })();
    return { dispatch: this.get(dispatch.id), attemptId: null, runId: null, startMode: null, spawn: false };
  }

  private createQueuedRun(dispatch: Dispatch, runId: string) {
    const room = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(dispatch.room_id) as
      | { issue_id: string | null }
      | undefined;
    const issue = room?.issue_id
      ? (this.db.prepare("SELECT * FROM issues WHERE id = ?").get(room.issue_id) as
          | { workspace_id: string | null; goal: string }
          | undefined)
      : undefined;
    if (!issue || !issue.workspace_id) {
      // Recorded v0.3 boundary (design §9.3): no workspace, no Run.
      throw new DispatchServiceWorkspaceError();
    }
    const thread = this.db
      .prepare("SELECT * FROM threads WHERE room_id = ? LIMIT 1")
      .get(dispatch.room_id) as { id: string } | undefined;
    if (!thread) throw new AppError(ErrorCode.RUNTIME_CONTEXT_UNAVAILABLE, "Room has no thread event stream.");
    const run = {
      id: runId,
      issue_id: room!.issue_id!,
      thread_id: thread.id,
      workspace_id: issue.workspace_id,
      adapter_config_id: dispatch.adapter_config_id,
      instructions: issue.goal ?? dispatch.model,
      status: RunStatus.Queued,
      role: RunRole.Implementation,
      purpose: RunPurpose.WorkflowBound,
      dispatch_source: "user_explicit" as RunDispatchSource,
      adapter_identity: JSON.parse(dispatch.identity_snapshot_json),
      context_source_run_id: null,
    };
    this.runRepo.create(run as never);
    return run;
  }

  /** Resume key (ADR 0009 §2): 执行组合 + Issue + Room + 上下文范围 all equal,
   *  and the previous attempt actually captured a provider session — only
   *  then may the new attempt resume. Same-dispatch retries are covered by
   *  seq; this looks one dispatch back across the room's history. */
  private findResumableAttempt(dispatch: Dispatch): Attempt | null {
    return (
      (this.db
        .prepare(
          `SELECT a.* FROM attempts a JOIN dispatches d ON d.id = a.dispatch_id
           WHERE d.room_id = ? AND d.issue_id IS ? AND d.adapter_config_id = ? AND d.model = ?
             AND d.depth_raw = ? AND d.runtime_id = ? AND d.context_scope = ?
             AND a.provider_session_id IS NOT NULL
             AND a.state IN ('succeeded','failed','cancelled','interrupted')
           ORDER BY a.created_at DESC LIMIT 1`,
        )
        .get(
          dispatch.room_id, dispatch.issue_id, dispatch.adapter_config_id, dispatch.model,
          dispatch.depth_raw, dispatch.runtime_id, dispatch.context_scope,
        ) as Attempt | undefined) ?? null
    );
  }

  /** The restart flag is captured at confirm (per dispatch) and consumed once
   *  at start. ADR 0009 §4 cold-start condition #1. */
  private restartFlags = new Map<string, boolean>();
  private captureRestartFlag(dispatchId: string, restart: boolean): void {
    if (restart) this.restartFlags.set(dispatchId, true);
  }

  private consumeRestartFlag(dispatchId: string): boolean {
    const flag = this.restartFlags.get(dispatchId) ?? false;
    this.restartFlags.delete(dispatchId);
    return flag;
  }

  /** Run-terminal hook: persist the adapter-reported provider session id so
   *  later dispatches can evaluate resume feasibility (ADR 0009 §5). */
  recordProviderSessionId(attemptId: string, providerSessionId: string): void {
    this.db.prepare("UPDATE attempts SET provider_session_id = ? WHERE id = ?").run(providerSessionId, attemptId);
  }

  private dispatchThreadId(dispatch: Dispatch): string | null {
    const room = this.db.prepare("SELECT issue_id FROM rooms WHERE id = ?").get(dispatch.room_id) as
      | { issue_id: string | null }
      | undefined;
    if (!room?.issue_id) return null;
    const thread = this.db
      .prepare("SELECT id FROM threads WHERE room_id = ? LIMIT 1")
      .get(dispatch.room_id) as { id: string } | undefined;
    return thread?.id ?? null;
  }
}

export class DispatchServiceWorkspaceError extends Error {}

function dispatchIdSafe(id: string): string {
  return id;
}
