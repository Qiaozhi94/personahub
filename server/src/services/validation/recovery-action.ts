import type Database from "better-sqlite3";
import type { Issue, ThreadEvent } from "@personahub/shared/types";
import { IssueStatus, ValidationBlockReason } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { IssueRepository } from "../../repositories/issue.js";
import type { ValidationTraceService } from "../validation-trace.js";
import { AppError } from "../../api/errors.js";

const VALIDATION_BLOCK_REASONS = new Set<string>(
  Object.values(ValidationBlockReason),
);

export class ValidationRecoveryActionService {
  constructor(
    private issueRepo: IssueRepository,
    private validationTraceService: ValidationTraceService,
    private db: Database.Database,
  ) {}

  unblock(issueId: string, operatorNote: string): Issue {
    const trimmed = operatorNote.trim();
    if (!trimmed) {
      throw new AppError(
        ErrorCode.OPERATOR_NOTE_REQUIRED,
        "Operator note is required.",
      );
    }
    if (trimmed.length > 4000) {
      throw new AppError(
        ErrorCode.OPERATOR_NOTE_REQUIRED,
        "Operator note must not exceed 4000 characters.",
      );
    }

    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }
    if (issue.status !== IssueStatus.Blocked) {
      throw new AppError(
        ErrorCode.INVALID_ISSUE_TRANSITION,
        `Cannot unblock issue in status ${issue.status}.`,
      );
    }
    if (
      !issue.blocked_reason_code ||
      !VALIDATION_BLOCK_REASONS.has(issue.blocked_reason_code)
    ) {
      throw new AppError(
        ErrorCode.INVALID_ISSUE_TRANSITION,
        "Only validation-related blockers can be resolved via unblock.",
      );
    }

    const threadId = issue.primary_thread_id!;
    const workspaceId = issue.workspace_id;
    const previousBlockReason = issue.blocked_reason_code;

    const result = this.db.transaction(() => {
      const casResult = this.issueRepo.compareAndSetStatus(
        issueId,
        IssueStatus.Blocked,
        IssueStatus.Ready,
        {
          blocked_reason_code: null,
          blocked_reason_message: null,
        },
      );
      if (!casResult.success || !casResult.issue) {
        throw new AppError(
          ErrorCode.INVALID_ISSUE_TRANSITION,
          "Issue is no longer Blocked.",
        );
      }

      const unblockedEvent = this.validationTraceService.writeIssueUnblocked({
        issueId,
        threadId,
        workspaceId,
        previousStatus: IssueStatus.Blocked,
        operatorNote: trimmed,
        previousBlockReason,
      });

      return { issue: casResult.issue, event: unblockedEvent };
    })();

    this.validationTraceService.broadcast(result.event);
    return result.issue;
  }

  /**
   * Explicit round-limit reset: only for round_limit_reached blockers. Clears
   * the validation_round_count to 0 while KEEPING the Issue Blocked (a separate
   * unblock is still required to resume), so the operator consciously grants
   * more rounds. A non-empty note is required.
   */
  resetRounds(issueId: string, operatorNote: string): { issue: Issue; event: ThreadEvent } {
    const trimmed = operatorNote.trim();
    if (!trimmed) {
      throw new AppError(ErrorCode.OPERATOR_NOTE_REQUIRED, "Operator note is required.");
    }
    if (trimmed.length > 4000) {
      throw new AppError(ErrorCode.OPERATOR_NOTE_REQUIRED, "Operator note must not exceed 4000 characters.");
    }

    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }
    if (issue.status !== IssueStatus.Blocked) {
      throw new AppError(ErrorCode.INVALID_ISSUE_TRANSITION, `Cannot reset rounds for issue in status ${issue.status}.`);
    }
    if (issue.blocked_reason_code !== ValidationBlockReason.RoundLimitReached) {
      throw new AppError(ErrorCode.INVALID_ISSUE_TRANSITION, "Round reset is only allowed for round_limit_reached blockers.");
    }

    const threadId = issue.primary_thread_id!;
    const workspaceId = issue.workspace_id;
    const previousRoundCount = issue.validation_round_count;

    const result = this.db.transaction(() => {
      const casResult = this.issueRepo.compareAndSetStatus(
        issueId,
        IssueStatus.Blocked,
        IssueStatus.Blocked,
        { validation_round_count: 0 },
      );
      if (!casResult.success || !casResult.issue) {
        throw new AppError(ErrorCode.INVALID_ISSUE_TRANSITION, "Issue is no longer Blocked.");
      }
      const event = this.validationTraceService.writeRoundReset({
        issueId, threadId, workspaceId,
        previousRoundCount,
        operatorNote: trimmed,
        blockReason: ValidationBlockReason.RoundLimitReached,
      });
      return { issue: casResult.issue, event };
    })();

    this.validationTraceService.broadcast(result.event);
    return { issue: result.issue, event: result.event };
  }
}
