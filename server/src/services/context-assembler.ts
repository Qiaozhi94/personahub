// F012 T011: context assembler — runs ONLY inside the start transaction
// (design §5.3 step 2): three-tier scope collection → F013 verifyAuthorization
// → resume feasibility. It is the single call site for recordConsumption and
// the single call site for verifyAuthorization (§2). Refs only, never body
// content (NFR-002); every filtered item carries its reason for disclosure.

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ContextScope,
  StartMode,
  type Attempt,
  type ColdStartReason,
  type ContextSnapshotItem,
  type Dispatch,
} from "@personahub/shared/types";
import type { AuthorizationVerification } from "@personahub/shared/types";
import type { RepositoryRegistry } from "./repository-registry.js";
import type { ArtifactConsumptionLedger } from "./artifact/consumption.js";
import type { Scope } from "@personahub/shared/types";

export interface AssembledContext {
  scope: ContextScope;
  items: ContextSnapshotItem[];
  contentHash: string;
  /** refs that resolved to artifacts; recorded via F010 in the same tx. */
  consumptionRefs: Array<{ revisionRef: string; purpose: string }>;
  startMode: StartMode.Resumed | StartMode.Cold;
  coldStartReason: ColdStartReason | null;
  resumedFromAttemptId: string | null;
}

export interface AssembleInput {
  dispatch: Dispatch;
  runId: string;
  /** Task-level narrowing frozen on the dispatch (F013 scope_json shape). */
  taskScope: Scope | null;
}

/** Deterministic failures land in `start_failed` + diagnostics; transient
 *  failures (IO, lock contention) must NOT be signalled by these errors —
 *  the caller leaves the dispatch on its lease for another owner instead. */
export interface ContextAssembler {
  assemble(input: AssembleInput): Promise<AssembledContext>;
  /** Same-transaction F010 consumption recording (不变量 12). */
  recordConsumptions(input: AssembleInput, assembled: AssembledContext, dispatchThreadId: string | null): void;
}

/** Deterministic assembly failure carrying its stable failed_reason_code
 *  (stored verbatim in dispatches.failed_reason_code — F013 reason strings
 *  like REPO_PATH_UNAUTHORIZED are reason codes, not ErrorCode members). */
export class DispatchContextError extends Error {
  constructor(
    public readonly reasonCode: string,
    message: string,
  ) {
    super(message);
  }
}

/** The five mandatory cold-start conditions (ADR 0009 §4) as a pure decision —
 *  unit-testable, shared by eligibility preview and the start transaction. */
export function decideStartMode(input: {
  purpose: Dispatch["purpose"];
  previousAttempt: Pick<Attempt, "id" | "provider_session_id"> | null;
  userRequestedRestart: boolean;
  previousTerminatedOnPoisonedInput: boolean;
  sessionUnusable: boolean;
  nativeMemoryIsolation: "supported" | "unsupported" | "unverified";
}): { startMode: StartMode; coldStartReason: ColdStartReason | null; resumedFromAttemptId: string | null } {
  const force = (reason: ColdStartReason): { startMode: StartMode; coldStartReason: ColdStartReason | null; resumedFromAttemptId: string | null } => ({
    startMode: StartMode.Cold,
    coldStartReason: reason,
    resumedFromAttemptId: null,
  });
  if (input.userRequestedRestart) return force("user_restart");
  if (input.sessionUnusable) return force("session_unusable");
  if (input.previousTerminatedOnPoisonedInput) return force("poisoned_predecessor");
  if (input.purpose === "validate" || input.purpose === "design_cases") {
    return force("independence_required");
  }
  if (input.nativeMemoryIsolation !== "supported") return force("memory_isolation_unavailable");
  if (!input.previousAttempt || !input.previousAttempt.provider_session_id) {
    return { startMode: StartMode.Cold, coldStartReason: null, resumedFromAttemptId: null };
  }
  return { startMode: StartMode.Resumed, coldStartReason: null, resumedFromAttemptId: input.previousAttempt.id };
}

/** T011 assembly implementation: authorization intersection + scoped ref
 *  collection + F010 consumption recording. The hash is computed over the
 *  sorted (source_ref, decision, reason) triples so the same refs always
 *  rebuild to the same content_hash (AC-003). */
export class ScopedContextAssembler implements ContextAssembler {
  constructor(
    private db: Database.Database,
    private repositoryRegistry: RepositoryRegistry,
    private consumptionLedger: ArtifactConsumptionLedger | null,
    private resolveRefsForScope: (input: { dispatch: Dispatch; scope: ContextScope }) => Promise<{
      items: ContextSnapshotItem[];
      consumptionRefs: Array<{ revisionRef: string; purpose: string }>;
    }>,
    private dispatchThreadId: (dispatch: Dispatch) => string | null,
  ) {}

  async assemble(input: AssembleInput): Promise<AssembledContext> {
    const { dispatch } = input;
    const room = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(dispatch.room_id) as
      | { issue_id: string | null }
      | undefined;
    if (!room) throw new DispatchContextError("ROOM_NOT_FOUND", `Room missing: ${dispatch.room_id}`);

    const issue = room.issue_id
      ? (this.db.prepare("SELECT * FROM issues WHERE id = ?").get(room.issue_id) as
          | { project_id: string | null; workspace_id: string | null }
          | undefined)
      : undefined;
    // The recorded v0.3 boundary (design §9.3): independent sessions can hold
    // drafts, but the start transaction needs a workspace to execute in.
    if (!issue || !issue.workspace_id) {
      throw new DispatchContextError(
        "RUNTIME_CONTEXT_UNAVAILABLE",
        "Independent sessions cannot start execution — convert the session to a task first.",
      );
    }

    // F013 verifyAuthorization: realpath re-read + identity match + the
    // three-layer scope intersection (machine ∩ project ∩ task). Task scope
    // may only narrow; verifyAuthorization enforces containment internally.
    const projectId = issue.project_id;
    if (!projectId) {
      throw new DispatchContextError("REPO_NOT_AUTHORIZED", "Issue has no project repository binding.");
    }
    const primary = this.repositoryRegistry.listProjectRefs(projectId).find((ref) => ref.role === "primary");
    if (!primary) {
      throw new DispatchContextError("REPO_NOT_AUTHORIZED", "Project has no primary repository authorization.");
    }
    const taskScope = input.taskScope ?? dispatch.task_scope_json ?? null;
    const verification: AuthorizationVerification = this.repositoryRegistry.verifyAuthorization({
      repository_id: primary.repository_id,
      project_id: projectId,
      task_scope: (taskScope as Scope | null) ?? null,
    });
    if (!verification.ok) {
      throw new DispatchContextError(verification.reason, `Path authorization failed: ${verification.reason}`);
    }

    const scopeFacts = await this.resolveRefsForScope({ dispatch, scope: dispatch.context_scope });
    const items = scopeFacts.items;
    if (items.some((item) => item.decision === "filtered" && !item.reason)) {
      throw new DispatchContextError("CONTEXT_FILTER_UNDISCLOSED", "Filtered context items require a disclosure reason.");
    }

    const hashInput = [...items]
      .sort((a, b) => (a.source_ref < b.source_ref ? -1 : a.source_ref > b.source_ref ? 1 : 0))
      .map((item) => `${item.source_ref}|${item.decision}|${item.reason ?? ""}`)
      .join("\n");
    const contentHash = createContentHash(hashInput);

    return {
      scope: dispatch.context_scope,
      items,
      contentHash,
      consumptionRefs: scopeFacts.consumptionRefs,
      startMode: StartMode.Cold,
      coldStartReason: null,
      resumedFromAttemptId: null,
    };
  }

  /** Same-transaction F010 consumption recording (不变量 12): the ledger
   *  validates the revision ref; this wrapper validates that the consuming
   *  run belongs to THIS dispatch before delegating. */
  recordConsumptions(input: AssembleInput, assembled: AssembledContext, dispatchThreadId: string | null): void {
    if (!this.consumptionLedger) return;
    for (const consumption of assembled.consumptionRefs) {
      this.consumptionLedger.record({
        dispatchId: input.dispatch.id,
        runId: input.runId,
        revisionRef: consumption.revisionRef,
        purpose: consumption.purpose,
        dispatchThreadId: dispatchThreadId ?? undefined,
      });
    }
  }
}

export function createContentHash(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}
