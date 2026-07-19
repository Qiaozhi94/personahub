import type {
  Issue,
  IssueValidationResponse,
  ValidationResultSummary,
  ValidationFindingRecord,
  ValidationFindingSeverity,
  Run,
  RunSummary,
} from "@personahub/shared/types";
import {
  IssueStatus,
  ThreadEventType,
  RunStatus,
  ValidationOutcome,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { EvidenceSummaryRepository } from "../../repositories/evidence-summary.js";
import type { ValidationPolicyRepository } from "../../repositories/validation-policy.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { ThreadEvent } from "@personahub/shared/types";
import { AppError } from "../../api/errors.js";

const RESULT_EVENT_TYPES = [
  ThreadEventType.ValidationPassed,
  ThreadEventType.ValidationFailed,
  ThreadEventType.ValidationBlocked,
] as const;

function toRunSummary(run: Run): RunSummary {
  return {
    id: run.id,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    exit_code: run.exit_code,
  };
}

export class ValidationQueryService {
  constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private evidenceSummaryRepo: EvidenceSummaryRepository,
    private validationPolicyRepo: ValidationPolicyRepository,
    private threadEventRepo: ThreadEventRepository,
  ) {}

  getValidationStatus(issueId: string): IssueValidationResponse {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }

    const policy = this.validationPolicyRepo.getById(issue.validation_policy_id);
    const maxRounds = policy?.max_validation_rounds ?? 3;
    const threadId = issue.primary_thread_id;

    const latestResult = threadId
      ? this.getLatestResult(threadId)
      : null;

    const latestFindings = threadId
      ? this.getLatestFindings(threadId, latestResult, issue)
      : [];

    const activeValidatorRun = this.runRepo.getActiveValidator(issueId);
    const evidenceSummary = issue.status === IssueStatus.Done
      ? this.evidenceSummaryRepo.getByIssueId(issueId)
      : null;

    const currentRound = this.getCurrentRound(issue, latestResult, threadId);

    return {
      issue_id: issueId,
      status: issue.status,
      current_round: currentRound,
      completed_failed_rounds: issue.validation_round_count,
      max_rounds: maxRounds,
      active_validator_run: activeValidatorRun
        ? toRunSummary(activeValidatorRun)
        : null,
      latest_result: latestResult,
      latest_findings: latestFindings,
      blocker: this.getBlocker(issue, threadId),
      evidence_summary: evidenceSummary,
    };
  }

  private getLatestResult(threadId: string): ValidationResultSummary | null {
    const events = this.threadEventRepo.listByThreadAndTypes(
      threadId,
      [...RESULT_EVENT_TYPES],
      undefined,
      1000,
    );
    if (events.length === 0) return null;
    const event = events[events.length - 1];
    return this.mapResultEvent(event);
  }

  private mapResultEvent(event: ThreadEvent): ValidationResultSummary {
    const outcome = this.eventTypeToOutcome(event.type);
    return {
      outcome,
      summary: (event.payload_json.summary as string) ?? "",
      validation_round: (event.payload_json.validation_round as number) ?? 0,
      finding_count: (event.payload_json.finding_count as number) ?? 0,
      validator_run_id: (event.payload_json.validator_run_id as string) ?? "",
      created_at: event.created_at,
    };
  }

  private eventTypeToOutcome(
    type: ThreadEventType,
  ): ValidationOutcome {
    if (type === ThreadEventType.ValidationPassed) return ValidationOutcome.Passed;
    if (type === ThreadEventType.ValidationFailed) return ValidationOutcome.Failed;
    return ValidationOutcome.Blocked;
  }

  private getLatestFindings(
    threadId: string,
    latestResult: ValidationResultSummary | null,
    issue: Issue,
  ): ValidationFindingRecord[] {
    const targetRound = this.getFindingsTargetRound(
      threadId,
      latestResult,
      issue,
    );
    if (targetRound === null) return [];

    const findingEvents = this.threadEventRepo.listByThreadAndTypes(
      threadId,
      [ThreadEventType.ValidationFinding],
      undefined,
      1000,
    );

    const roundFindings = findingEvents
      .filter(
        (e) =>
          (e.payload_json.validation_round as number) === targetRound,
      );

    return roundFindings
      .slice(0, 100)
      .map((e) => ({
        validation_round: targetRound,
        finding_index:
          (e.payload_json.finding_index as number) ?? 0,
        severity: e.payload_json.severity as ValidationFindingSeverity,
        message: (e.payload_json.message as string) ?? "",
        suggestion:
          (e.payload_json.suggestion as string) ?? null,
        evidence_refs: e.evidence_refs,
        file_path:
          (e.payload_json.file_path as string) ?? null,
        line: (e.payload_json.line as number) ?? null,
        event_id: e.id,
        created_at: e.created_at,
      }));
  }

  private getFindingsTargetRound(
    threadId: string,
    latestResult: ValidationResultSummary | null,
    issue: Issue,
  ): number | null {
    if (latestResult) return latestResult.validation_round;

    if (issue.status === IssueStatus.Validating) {
      const requestedEvents = this.threadEventRepo.listByThreadAndTypes(
        threadId,
        [ThreadEventType.ValidationRequested],
        undefined,
        1000,
      );
      if (requestedEvents.length > 0) {
        const lastRequested =
          requestedEvents[requestedEvents.length - 1];
        return (
          (lastRequested.payload_json
            .validation_round as number) ?? null
        );
      }
      return issue.validation_round_count > 0
        ? issue.validation_round_count + 1
        : 1;
    }

    return null;
  }

  private getCurrentRound(
    issue: Issue,
    latestResult: ValidationResultSummary | null,
    threadId: string | null,
  ): number | null {
    if (latestResult) return latestResult.validation_round;

    if (threadId && issue.status === IssueStatus.Validating) {
      const requestedEvents = this.threadEventRepo.listByThreadAndTypes(
        threadId,
        [ThreadEventType.ValidationRequested],
        undefined,
        1000,
      );
      if (requestedEvents.length > 0) {
        const lastRequested =
          requestedEvents[requestedEvents.length - 1];
        return (
          (lastRequested.payload_json
            .validation_round as number) ?? null
        );
      }
      return issue.validation_round_count > 0
        ? issue.validation_round_count + 1
        : 1;
    }

    return null;
  }

  private getBlocker(
    issue: Issue,
    threadId: string | null,
  ): {
    reason_code: string;
    message: string;
    event_id: string;
  } | null {
    if (!issue.blocked_reason_code || !threadId) return null;

    const blockedEvents = this.threadEventRepo.listByThreadAndTypes(
      threadId,
      [ThreadEventType.ValidationBlocked],
      undefined,
      1000,
    );
    if (blockedEvents.length === 0) return null;

    const latestBlocked = blockedEvents[blockedEvents.length - 1];
    return {
      reason_code: issue.blocked_reason_code,
      message: issue.blocked_reason_message ?? "",
      event_id: latestBlocked.id,
    };
  }
}
