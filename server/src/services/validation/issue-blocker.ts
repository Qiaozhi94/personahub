import type Database from "better-sqlite3";
import type { Issue, ThreadEvent } from "@personahub/shared/types";
import { ActorType, IssueStatus, ThreadEventType, ValidationBlockReason } from "@personahub/shared/types";
import type { IssueRepository } from "../../repositories/issue.js";
import type { ThreadEventService } from "../thread-event.js";

export class ValidationIssueBlocker {
  constructor(
    private db: Database.Database,
    private issueRepo: IssueRepository,
    private threadEventService: ThreadEventService,
  ) {}

  blockIssue(issueId: string, reason: ValidationBlockReason, message: string): void {
    const pendingEvents: ThreadEvent[] = [];
    this.db.transaction(() => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue) return;
      if (issue.status !== IssueStatus.Running && issue.status !== IssueStatus.Validating) return;
      this.blockIssueInTx(issue, reason, message, pendingEvents);
    })();
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
  }

  blockIssueInTx(issue: Issue, reason: ValidationBlockReason, message: string, pendingEvents: ThreadEvent[]): void {
    const casResult = this.issueRepo.compareAndSetStatus(issue.id, issue.status, IssueStatus.Blocked, {
      blocked_reason_code: reason,
      blocked_reason_message: message,
    });
    if (!casResult.success) return;
    pendingEvents.push(
      this.threadEventService.write(
        issue.primary_thread_id!,
        ThreadEventType.ValidationBlocked,
        ActorType.System,
        null,
        {
          issue_id: issue.id,
          thread_id: issue.primary_thread_id!,
          workspace_id: issue.workspace_id,
          validation_round: issue.validation_round_count + 1,
          summary: message,
          reason_code: reason,
        },
      ),
    );
  }

  blockValidation(issueId: string, validatorRunId: string, reason: ValidationBlockReason): void {
    this.blockIssue(issueId, reason, `Validator run ${validatorRunId} blocked: ${reason}`);
  }
}
