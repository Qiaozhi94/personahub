import type Database from "better-sqlite3";
import type { ThreadEvent } from "@personahub/shared/types";
import { ThreadEventType } from "@personahub/shared/types";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { SummaryVerificationEvent } from "./evidence-summary-builder.js";

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
