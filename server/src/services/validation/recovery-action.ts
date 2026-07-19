import type Database from "better-sqlite3";
import type { Issue } from "@personahub/shared/types";
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
}
