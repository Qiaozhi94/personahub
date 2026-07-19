import type Database from "better-sqlite3";
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { ValidationWorkflowService } from "./workflow-service.js";
import type { ThreadEventService } from "../thread-event.js";
import type { Issue, ThreadEvent, ValidationPolicySnapshot } from "@personahub/shared/types";
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

  private reconcileStuckValidating(): void {
    const stuckIssues = this.issueRepo.listValidatingWithoutActiveValidator();
    for (const issue of stuckIssues) {
      if (!issue.primary_thread_id) continue;
      if (this.findLatestTerminalValidator(issue.id)) continue;
      const requestedEvent = this.threadEventRepo.getLatestByTypeAndPayload(
        issue.primary_thread_id!,
        ThreadEventType.ValidationRequested,
        "issue_id",
        issue.id,
      );
      if (requestedEvent) {
        const implRunId = requestedEvent.payload_json.implementation_run_id as string;
        const frozenSnapshot = requestedEvent.payload_json.policy_snapshot as ValidationPolicySnapshot;
        const frozenHash = requestedEvent.payload_json.policy_snapshot_hash as string;
        const frozenValidatorConfigId = requestedEvent.payload_json.validator_adapter_config_id as string | undefined;
        if (frozenSnapshot && frozenHash) {
          this.validationWorkflowService.rebuildStuckValidation(
            issue.id, implRunId, frozenSnapshot, frozenHash, frozenValidatorConfigId,
          );
        } else {
          this.blockIssueInRecovery(issue, ValidationBlockReason.RecoveryInconsistent, "Original validation.requested missing frozen policy snapshot");
        }
      } else {
        this.blockIssueInRecovery(issue, ValidationBlockReason.RecoveryInconsistent, "No validation.requested event found during recovery for Validating issue");
      }
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
