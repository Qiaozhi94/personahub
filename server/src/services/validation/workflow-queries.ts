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
  return repo.getLatestByTypeAndPayload(
    threadId,
    ThreadEventType.ValidationRequested,
    "validator_run_id",
    validatorRunId,
  );
}

export function findHandoffEvent(
  repo: ThreadEventRepository,
  threadId: string,
  implementationRunId: string,
): ThreadEvent | null {
  return repo.getLatestByTypeAndPayload(
    threadId,
    ThreadEventType.HandoffCreated,
    "run_id",
    implementationRunId,
  );
}

export function findVerificationEvents(
  repo: ThreadEventRepository,
  threadId: string,
  implementationRunId: string,
): SummaryVerificationEvent[] {
  const raw = repo.listByThreadTypeAndPayload(
    threadId,
    [ThreadEventType.TestCompleted],
    "run_id",
    implementationRunId,
    201,
  );
  const truncated = raw.length > 200;
  const chronological = raw.slice(0, 200).reverse();
  return chronological.map((e) => ({
    id: e.id,
    kind: (e.payload_json.kind as string) ?? "test",
    result: (e.payload_json.result as string) ?? "unknown",
    command: (e.payload_json.command as string) ?? null,
    _truncated: truncated,
  })) as SummaryVerificationEvent[];
}

export function resultEventExistsForValidatorRun(
  repo: ThreadEventRepository,
  threadId: string,
  validatorRunId: string,
): boolean {
  return repo.existsByTypeAndPayload(
    threadId,
    ThreadEventType.ValidationPassed,
    "validator_run_id",
    validatorRunId,
  ) || repo.existsByTypeAndPayload(
    threadId,
    ThreadEventType.ValidationFailed,
    "validator_run_id",
    validatorRunId,
  ) || repo.existsByTypeAndPayload(
    threadId,
    ThreadEventType.ValidationBlocked,
    "validator_run_id",
    validatorRunId,
  );
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
  const raw = repo.listByThreadTypeAndPayload(
    threadId,
    [ThreadEventType.CommandCompleted],
    "run_id",
    implementationRunId,
    201,
  );
  const truncated = raw.length > 200;
  const chronological = raw.slice(0, 200).reverse();
  return chronological.map((e) => ({
    id: e.id,
    command: (e.payload_json.command as string) ?? "",
    outcome: (e.payload_json.outcome as string) ?? "unknown",
    output_summary: (e.payload_json.summary as string) ?? null,
    _truncated: truncated,
  })) as SummaryCommand[];
}

export interface ImplementationEvidence {
  handoffEvent: ThreadEvent | null;
  handoff: HandoffPayload | null;
  verifications: SummaryVerificationEvent[];
  fileChanges: { path: string; change_type: string }[];
  commands: SummaryCommand[];
  verificationsTruncated: boolean;
  commandsTruncated: boolean;
}

/** Gathers the full implementation evidence set used by both the policy gate and the Evidence Summary. */
export function collectImplementationEvidence(
  threadEventRepo: ThreadEventRepository,
  fileChangeRepo: FileChangeRepository,
  threadId: string,
  implementationRunId: string,
): ImplementationEvidence {
  const handoffEvent = findHandoffEvent(threadEventRepo, threadId, implementationRunId);
  const verifications = findVerificationEvents(threadEventRepo, threadId, implementationRunId);
  const commands = collectCommands(threadEventRepo, threadId, implementationRunId);
  return {
    handoffEvent,
    handoff: handoffPayloadFromEvent(handoffEvent, threadId, implementationRunId),
    verifications,
    fileChanges: fileChangeRepo.listByRun(implementationRunId).map((fc) => ({ path: fc.path, change_type: fc.change_type })),
    commands,
    verificationsTruncated: verifications.length > 0 && (verifications[0] as unknown as Record<string, unknown>)._truncated === true,
    commandsTruncated: commands.length > 0 && (commands[0] as unknown as Record<string, unknown>)._truncated === true,
  };
}
