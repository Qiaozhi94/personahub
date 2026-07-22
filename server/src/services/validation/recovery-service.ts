import type Database from "better-sqlite3";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { ValidationWorkflowService } from "./workflow-service.js";
import type { ThreadEventService } from "../thread-event.js";
import type { Issue, ThreadEvent } from "@personahub/shared/types";
import { IssueStatus, RunRole, ThreadEventType, ActorType, ValidationBlockReason } from "@personahub/shared/types";

export class ValidationRecoveryService {
  constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private threadEventRepo: ThreadEventRepository,
    private agentConfigRepo: AgentConfigRepository,
    private db: Database.Database,
    private threadEventService: ThreadEventService,
  ) {}

  async reconcile(): Promise<void> {
    this.reconcileUnrequestedImplementations();
    this.reconcileTerminalValidators();
    this.reconcileStuckValidating();
  }

  private reconcileUnrequestedImplementations(): void {
    const runningIssues = this.issueRepo.listByStatus(IssueStatus.Running);
    for (const issue of runningIssues) {
      if (!issue.primary_thread_id) continue;
      const implRun = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation);
      if (!implRun || !implRun.adapter_identity) continue;
      if (this.hasValidationBeenRequestedForRun(issue, implRun.id)) continue;
      this.validationWorkflowService.requestValidation(issue.id, implRun.id);
    }
  }

  private reconcileTerminalValidators(): void {
    const validatingIssues = this.issueRepo.listByStatus(IssueStatus.Validating);
    for (const issue of validatingIssues) {
      if (!issue.primary_thread_id) continue;
      const terminalValidator = this.findLatestTerminalValidator(issue.id);
      if (!terminalValidator) continue;
      this.validationWorkflowService.processValidatorResult(terminalValidator.id);
    }
  }

  /**
   * design §8.3 restart recovery: due already passed -> claim immediately
   * (Phase B); due still in the future -> leave it, the grace window is
   * legitimately still open and the scheduler will pick it up; due is NULL
   * with no active/terminal validator -> genuinely inconsistent (can only
   * happen if the process crashed between Phase A commit and the
   * dispatch_due_at write, which the same transaction rules out in
   * practice, or if a pre-F005 DB is being recovered).
   */
  private reconcileStuckValidating(): void {
    const now = new Date().toISOString();
    const dueIssues = this.issueRepo.listValidatingWithDueBefore(now);
    for (const issue of dueIssues) {
      if (!issue.primary_thread_id) continue;
      this.validationWorkflowService.claimValidatorSlot(issue.id, { mode: "auto" });
    }

    const validatingIssues = this.issueRepo.listByStatus(IssueStatus.Validating);
    for (const issue of validatingIssues) {
      if (!issue.primary_thread_id) continue;
      if (issue.validation_dispatch_due_at !== null) continue;
      if (this.runRepo.getActiveValidator(issue.id)) continue;
      if (this.findLatestTerminalValidator(issue.id)) continue;
      this.blockIssueInRecovery(
        issue,
        ValidationBlockReason.RecoveryInconsistent,
        "Validating issue has no dispatch due date, no active validator, and no terminal validator",
      );
    }
  }

  private blockIssueInRecovery(issue: Issue, reason: ValidationBlockReason, message: string): void {
    const pendingEvents: ThreadEvent[] = [];
    const blocked = this.db.transaction(() => {
      const casResult = this.issueRepo.compareAndSetStatus(issue.id, issue.status, IssueStatus.Blocked, {
        blocked_reason_code: reason,
        blocked_reason_message: message,
      });
      if (!casResult.success) return false;
      pendingEvents.push(this.threadEventService.write(
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
      ));
      return true;
    })();
    if (blocked) {
      for (const event of pendingEvents) this.threadEventService.broadcast(event);
    }
  }

  private hasValidationBeenRequestedForRun(issue: Issue, implRunId: string): boolean {
    return this.threadEventRepo.existsByTypeAndPayload(
      issue.primary_thread_id!,
      ThreadEventType.ValidationRequested,
      "implementation_run_id",
      implRunId,
    );
  }

  private findLatestTerminalValidator(issueId: string) {
    return this.runRepo.getLatestTerminalByRole(issueId, RunRole.Validator);
  }
}
