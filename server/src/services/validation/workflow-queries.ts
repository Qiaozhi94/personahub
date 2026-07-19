import type Database from "better-sqlite3";
import type { ThreadEvent } from "@personahub/shared/types";
import { ThreadEventType } from "@personahub/shared/types";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { FileChangeRepository } from "../../repositories/file-change.js";
import type { HandoffPayload } from "../handoff-builder.js";
import type { SummaryVerificationEvent, SummaryCommand } from "./evidence-summary-builder.js";

/**
 * Stateless read helpers shared by the validation workflow state machine.
 * Extracted from the service so the state machine itself stays within the
 * file-size budget; all queries are scoped by thread + run id.
 */

export function findRequestedEvent(
  repo: ThreadEventRepository,
  threadId: string,
  validatorRunId: string,
): ThreadEvent | null {
  return (
    repo
      .listByThreadAndTypes(threadId, [ThreadEventType.ValidationRequested], undefined, 50)
      .find((e) => e.payload_json.validator_run_id === validatorRunId) ?? null
  );
}

export function findHandoffEvent(
  repo: ThreadEventRepository,
  threadId: string,
  implementationRunId: string,
): ThreadEvent | null {
  return (
    repo
      .listByThreadAndTypes(threadId, [ThreadEventType.HandoffCreated], undefined, 10)
      .find((e) => e.payload_json.run_id === implementationRunId) ?? null
  );
}

export function findVerificationEvents(
  repo: ThreadEventRepository,
  threadId: string,
  implementationRunId: string,
): SummaryVerificationEvent[] {
  return repo
    .listByThreadAndTypes(threadId, [ThreadEventType.TestCompleted], undefined, 200)
    .filter((e) => e.payload_json.run_id === implementationRunId)
    .map((e) => ({
      id: e.id,
      kind: (e.payload_json.kind as string) ?? "test",
      result: (e.payload_json.result as string) ?? "unknown",
      command: (e.payload_json.command as string) ?? null,
    }));
}

export function resultEventExistsForValidatorRun(
  repo: ThreadEventRepository,
  threadId: string,
  validatorRunId: string,
): boolean {
  const events = repo.listByThreadAndTypes(
    threadId,
    [ThreadEventType.ValidationPassed, ThreadEventType.ValidationFailed, ThreadEventType.ValidationBlocked],
    undefined,
    200,
  );
  return events.some((e) => e.payload_json.validator_run_id === validatorRunId);
}

export function getFinalMessage(db: Database.Database, runId: string): string | null {
  const row = db.prepare("SELECT final_message FROM runs WHERE id = ?").get(runId) as
    | { final_message: string | null }
    | undefined;
  return row?.final_message ?? null;
}

/** Reconstructs a HandoffPayload from a persisted HandoffCreated event. */
export function handoffPayloadFromEvent(
  event: ThreadEvent | null,
  threadId: string,
  implementationRunId: string,
): HandoffPayload | null {
  if (!event) return null;
  const p = event.payload_json;
  return {
    issue_id: (p.issue_id as string) ?? "",
    thread_id: threadId,
    run_id: implementationRunId,
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

export function collectCommands(
  repo: ThreadEventRepository,
  threadId: string,
  implementationRunId: string,
): SummaryCommand[] {
  return repo
    .listByThreadAndTypes(threadId, [ThreadEventType.CommandCompleted], undefined, 200)
    .filter((e) => e.payload_json.run_id === implementationRunId)
    .map((e) => ({
      id: e.id,
      command: (e.payload_json.command as string) ?? "",
      outcome: (e.payload_json.outcome as string) ?? "unknown",
      output_summary: (e.payload_json.summary as string) ?? null,
    }));
}

export interface ImplementationEvidence {
  handoffEvent: ThreadEvent | null;
  handoff: HandoffPayload | null;
  verifications: SummaryVerificationEvent[];
  fileChanges: { path: string; change_type: string }[];
  commands: SummaryCommand[];
}

/** Gathers the full implementation evidence set used by both the policy gate and the Evidence Summary. */
export function collectImplementationEvidence(
  threadEventRepo: ThreadEventRepository,
  fileChangeRepo: FileChangeRepository,
  threadId: string,
  implementationRunId: string,
): ImplementationEvidence {
  const handoffEvent = findHandoffEvent(threadEventRepo, threadId, implementationRunId);
  return {
    handoffEvent,
    handoff: handoffPayloadFromEvent(handoffEvent, threadId, implementationRunId),
    verifications: findVerificationEvents(threadEventRepo, threadId, implementationRunId),
    fileChanges: fileChangeRepo.listByRun(implementationRunId).map((fc) => ({ path: fc.path, change_type: fc.change_type })),
    commands: collectCommands(threadEventRepo, threadId, implementationRunId),
  };
}
