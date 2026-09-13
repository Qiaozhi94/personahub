import type Database from "better-sqlite3";
import { ActorType, ThreadEventType, type ArtifactConsumption, type ThreadEvent } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../api/errors.js";
import { isUniqueViolation } from "../../db/sqlite-errors.js";
import { parseEvidenceRef, resolveForDispatch } from "../../evidence-ref.js";
import type { ArtifactRepository } from "../../repositories/artifact.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventService } from "../thread-event.js";

/**
 * F010 consumption ledger — the `recordConsumption` half of the
 * ArtifactService write surface (design §2/§4). Only artifact refs carrying a
 * definite revision are accepted; a floating ref must never enter a Dispatch
 * snapshot. Idempotency granularity is the consumption PK
 * `(dispatch, run, revision, purpose)`: replays return the original row and
 * emit no second event; a dispatch continued under a new Run records its own
 * row so Run → Artifact lookups never miss.
 *
 * `dispatch_id` is a deliberate soft reference (the dispatches table is F012's
 * and does not exist yet): F012 must validate dispatch existence and run
 * ownership inside its own transaction when it integrates the call sites.
 */

export interface RecordConsumptionInput {
  dispatchId: string;
  runId: string;
  /** Only `artifact:<id>@<revision>` is accepted; floating refs are rejected. */
  revisionRef: string;
  purpose: string;
  /** Dispatch-owned thread for rejection events (F012 supplies it). */
  dispatchThreadId?: string;
}

export interface ConsumptionLedgerDeps {
  db: Database.Database;
  artifactRepo: ArtifactRepository;
  runRepo: RunRepository;
  threadEventService: ThreadEventService;
  log?: (info: Record<string, unknown>) => void;
}

interface RecordOutcome {
  consumed: ArtifactConsumption;
  replayed: boolean;
}

export class ArtifactConsumptionLedger {
  constructor(private deps: ConsumptionLedgerDeps) {}

  record(input: RecordConsumptionInput): ArtifactConsumption {
    const started = Date.now();
    try {
      const { consumed, replayed } = this.recordInner(input);
      this.deps.log?.({
        event: "artifact.consume",
        artifact_id: consumed.artifact_id,
        revision: consumed.revision,
        dispatch_id: consumed.dispatch_id,
        run_id: consumed.run_id,
        replayed,
        duration_ms: Date.now() - started,
      });
      return consumed;
    } catch (error) {
      this.deps.log?.({
        event: "artifact.consume",
        artifact_id: null,
        revision: null,
        duration_ms: Date.now() - started,
        reason_code: error instanceof AppError ? error.code : ErrorCode.INTERNAL_ERROR,
      });
      throw error;
    }
  }

  private recordInner(input: RecordConsumptionInput): RecordOutcome {
    const check = resolveForDispatch(parseEvidenceRef(input.revisionRef));
    const rejectThread = () =>
      check.ok
        ? (input.dispatchThreadId ?? this.deps.artifactRepo.getArtifact(check.artifactId)?.thread_id ?? null)
        : (input.dispatchThreadId ?? null);
    if (!check.ok) {
      this.rejectResolve(input.revisionRef, "record_consumption", ErrorCode.ARTIFACT_REF_INVALID, rejectThread());
    }
    const artifact = this.deps.artifactRepo.getArtifact(check.artifactId);
    if (!artifact) {
      this.rejectResolve(
        input.revisionRef,
        "record_consumption",
        ErrorCode.ARTIFACT_NOT_FOUND,
        input.dispatchThreadId ?? null,
      );
    }
    if (!this.deps.artifactRepo.getRevision(artifact.id, check.revision!)) {
      this.rejectResolve(
        input.revisionRef,
        "record_consumption",
        ErrorCode.ARTIFACT_REVISION_NOT_FOUND,
        artifact.thread_id,
      );
    }
    if (!this.deps.runRepo.getById(input.runId)) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, `Run not found: ${input.runId}`);
    }

    const pendingEvents: ThreadEvent[] = [];
    let consumed: ArtifactConsumption | null = null;
    let replayed = false;
    this.deps.db.transaction(() => {
      const existing = this.deps.artifactRepo.getConsumption(
        input.dispatchId,
        input.runId,
        artifact.id,
        check.revision!,
        input.purpose,
      );
      if (existing) {
        consumed = existing;
        replayed = true;
        return;
      }
      const row: ArtifactConsumption = {
        artifact_id: artifact.id,
        revision: check.revision!,
        dispatch_id: input.dispatchId,
        run_id: input.runId,
        purpose: input.purpose,
        consumed_at: new Date().toISOString(),
      };
      try {
        this.deps.artifactRepo.insertConsumption(row);
      } catch (error) {
        // Concurrent identical insert: the PK winner's row is the answer.
        if (!isUniqueViolation(error, "artifact_consumptions.")) throw error;
        const winner = this.deps.artifactRepo.getConsumption(
          input.dispatchId,
          input.runId,
          artifact.id,
          check.revision!,
          input.purpose,
        );
        if (!winner) throw error;
        consumed = winner;
        replayed = true;
        return;
      }
      pendingEvents.push(
        this.deps.threadEventService.write(
          artifact.thread_id,
          ThreadEventType.ArtifactConsumed,
          ActorType.System,
          null,
          {
            artifact_id: artifact.id,
            revision: row.revision,
            issue_id: artifact.issue_id,
            dispatch_id: input.dispatchId,
            run_id: input.runId,
            purpose: input.purpose,
          },
        ),
      );
      consumed = row;
    })();
    for (const event of pendingEvents) this.deps.threadEventService.broadcast(event);
    return { consumed: consumed!, replayed };
  }

  /** Resolve rejection (TR-001): persist `artifact.resolve_rejected` on the
   *  best-available thread and broadcast; when no thread is derivable, only
   *  the service log records the refusal — never a fabricated thread id. */
  private rejectResolve(ref: string, callerMode: string, reasonCode: ErrorCode, threadId: string | null): never {
    if (threadId) {
      const event = this.deps.threadEventService.write(
        threadId,
        ThreadEventType.ArtifactResolveRejected,
        ActorType.System,
        null,
        {
          ref,
          caller_mode: callerMode,
          reason_code: reasonCode,
        },
      );
      this.deps.threadEventService.broadcast(event);
    } else {
      this.deps.log?.({
        event: "artifact.resolve_rejected",
        persisted: false,
        ref,
        caller_mode: callerMode,
        reason_code: reasonCode,
      });
    }
    throw new AppError(reasonCode, `Artifact ref rejected (${reasonCode}): ${ref}`);
  }
}
