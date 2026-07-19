import type { ValidationPolicySnapshot, TraceCompleteness, ThreadEvent } from "@personahub/shared/types";
import { ThreadEventType, TraceCompletenessStatus } from "@personahub/shared/types";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { HandoffPayload } from "../handoff-builder.js";
import { handoffPayloadFromEvent } from "./workflow-queries.js";
import {
  buildValidatorContext,
  type ValidatorContextResult,
  type ContextRunIdentity,
  type ContextPriorFinding,
  type ContextVerificationEvent,
} from "./context-builder.js";

/**
 * Collects the persisted implementation evidence for one implementation Run and
 * assembles the validator prompt via the pure `buildValidatorContext`. Kept out
 * of the workflow service so the state machine stays within the file-size limit
 * and so the same evidence-gathering can be reused for repair/summary contexts.
 */
export interface AssembleValidatorContextDeps {
  threadEventRepo: ThreadEventRepository;
  fileChangeRepo: FileChangeRepository;
}

export interface AssembleValidatorContextParams {
  issue: { title: string; goal: string | null };
  threadId: string;
  implementationRunId: string;
  implementationRun: ContextRunIdentity;
  validatorRun: ContextRunIdentity;
  policySnapshot: ValidationPolicySnapshot;
  policySnapshotHash: string;
  validationRound: number;
}

function collectHandoff(
  repo: ThreadEventRepository,
  threadId: string,
  implRunId: string,
): HandoffPayload | null {
  const event = repo.getLatestByTypeAndPayload(
    threadId,
    ThreadEventType.HandoffCreated,
    "run_id",
    implRunId,
  );
  return handoffPayloadFromEvent(event, threadId, implRunId);
}

function collectVerifications(
  repo: ThreadEventRepository,
  threadId: string,
  implRunId: string,
): { items: ContextVerificationEvent[]; truncated: boolean } {
  const raw = repo.listByThreadTypeAndPayload(
    threadId,
    [ThreadEventType.TestCompleted],
    "run_id",
    implRunId,
    201,
  );
  const truncated = raw.length > 200;
  const chronological = raw.slice(0, 200).reverse();
  const items = chronological.map((e: ThreadEvent) => ({
    id: e.id,
    kind: (e.payload_json.kind as string) ?? "test",
    result: (e.payload_json.result as string) ?? "unknown",
    command: (e.payload_json.command as string) ?? null,
    evidence_ref: `event:${e.id}`,
  }));
  return { items, truncated };
}

/**
 * Prior validation findings across all prior rounds. The pure context builder
 * decides how much to keep (latest round first) under the size budget.
 */
export function collectPriorFindings(
  repo: ThreadEventRepository,
  threadId: string,
): ContextPriorFinding[] {
  return repo
    .listLatestByThreadAndTypes(threadId, [ThreadEventType.ValidationFinding], 200)
    .reverse()
    .map((e: ThreadEvent) => ({
      validation_round: (e.payload_json.validation_round as number) ?? 0,
      severity: (e.payload_json.severity as string) ?? "info",
      message: (e.payload_json.message as string) ?? "",
      suggestion: (e.payload_json.suggestion as string) ?? null,
      file_path: (e.payload_json.file_path as string) ?? null,
      line: (e.payload_json.line as number) ?? null,
    }));
}

export function assembleValidatorContext(
  deps: AssembleValidatorContextDeps,
  params: AssembleValidatorContextParams,
): ValidatorContextResult {
  const handoff = collectHandoff(deps.threadEventRepo, params.threadId, params.implementationRunId);
  const verificationResult = collectVerifications(deps.threadEventRepo, params.threadId, params.implementationRunId);
  const verifications = verificationResult.items;
  const verificationsTruncated = verificationResult.truncated;
  const fileChanges = deps.fileChangeRepo
    .listByRun(params.implementationRunId)
    .map((fc) => ({ path: fc.path, change_type: fc.change_type }));
  const priorFindings = collectPriorFindings(deps.threadEventRepo, params.threadId);
  const hasFiles = fileChanges.length > 0;
  const hasVerif = verifications.length > 0;
  const traceCompleteness: TraceCompleteness = {
    commands: TraceCompletenessStatus.Complete,
    verification: hasVerif
      ? (verificationsTruncated ? TraceCompletenessStatus.Partial : TraceCompletenessStatus.Complete)
      : TraceCompletenessStatus.Unavailable,
    file_changes: hasFiles ? TraceCompletenessStatus.Complete : TraceCompletenessStatus.Unavailable,
    refs: TraceCompletenessStatus.Complete,
    reasons: [],
  };
  return buildValidatorContext({
    issue: params.issue,
    policySnapshot: params.policySnapshot,
    policySnapshotHash: params.policySnapshotHash,
    implementationRun: params.implementationRun,
    validatorRun: params.validatorRun,
    handoff,
    verifications,
    fileChanges,
    fileChangeSetRef: `file-change-set:${params.implementationRunId}`,
    priorFindings,
    traceCompleteness,
    validationRound: params.validationRound,
  });
}
