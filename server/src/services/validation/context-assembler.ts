import type { ValidationPolicySnapshot, TraceCompleteness, ThreadEvent } from "@personahub/shared/types";
import { ThreadEventType, TraceCompletenessStatus } from "@personahub/shared/types";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { HandoffPayload } from "../handoff-builder.js";
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
  const event = repo
    .listByThreadAndTypes(threadId, [ThreadEventType.HandoffCreated], undefined, 10)
    .find((e: ThreadEvent) => e.payload_json.run_id === implRunId);
  if (!event) return null;
  const p = event.payload_json;
  return {
    issue_id: (p.issue_id as string) ?? "",
    thread_id: threadId,
    run_id: implRunId,
    workspace_id: (p.workspace_id as string) ?? "",
    issue_goal: (p.issue_goal as string) ?? "",
    run_status: (p.run_status as string) ?? "completed",
    summary: (p.summary as string) ?? "",
    completed_work: (p.completed_work as string[]) ?? [],
    command_summary: (p.command_summary as HandoffPayload["command_summary"]) ?? { total: 0, succeeded: 0, failed: 0, blocked: 0, unknown: 0 },
    verification_summary: (p.verification_summary as HandoffPayload["verification_summary"]) ?? { passed: 0, failed: 0, unknown: 0 },
    file_summary: (p.file_summary as HandoffPayload["file_summary"]) ?? null,
    known_risks: (p.known_risks as string[]) ?? [],
    missing_evidence: (p.missing_evidence as string[]) ?? [],
    next_expected_action: (p.next_expected_action as string) ?? "",
    evidence_ref_count: (p.evidence_ref_count as number) ?? 0,
    evidence_refs_truncated: (p.evidence_refs_truncated as boolean) ?? false,
  };
}

function collectVerifications(
  repo: ThreadEventRepository,
  threadId: string,
  implRunId: string,
): ContextVerificationEvent[] {
  return repo
    .listByThreadAndTypes(threadId, [ThreadEventType.TestCompleted], undefined, 200)
    .filter((e: ThreadEvent) => e.payload_json.run_id === implRunId)
    .map((e: ThreadEvent) => ({
      id: e.id,
      kind: (e.payload_json.kind as string) ?? "test",
      result: (e.payload_json.result as string) ?? "unknown",
      command: (e.payload_json.command as string) ?? null,
      evidence_ref: `event:${e.id}`,
    }));
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
    .listByThreadAndTypes(threadId, [ThreadEventType.ValidationFinding], undefined, 200)
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
  const verifications = collectVerifications(deps.threadEventRepo, params.threadId, params.implementationRunId);
  const fileChanges = deps.fileChangeRepo
    .listByRun(params.implementationRunId)
    .map((fc) => ({ path: fc.path, change_type: fc.change_type }));
  const priorFindings = collectPriorFindings(deps.threadEventRepo, params.threadId);
  const hasFiles = fileChanges.length > 0;
  const hasVerif = verifications.length > 0;
  const traceCompleteness: TraceCompleteness = {
    commands: TraceCompletenessStatus.Complete,
    verification: hasVerif ? TraceCompletenessStatus.Complete : TraceCompletenessStatus.Unavailable,
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
