import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { ValidationWorkflowService } from "./workflow-service.js";
import type { Issue, AdapterIdentitySnapshot } from "@personahub/shared/types";
import { IssueStatus, RunRole, RunStatus, RunDispatchSource, ThreadEventType, ActorType, ValidationBlockReason } from "@personahub/shared/types";

export class ValidationRecoveryService {
  constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private threadEventRepo: ThreadEventRepository,
    private agentConfigRepo: AgentConfigRepository,
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
      if (this.hasValidationBeenRequested(issue)) continue;
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
      const requestedEvent = this.findValidationRequestedEvent(issue);
      if (requestedEvent) {
        const implRunId = requestedEvent.payload_json.implementation_run_id as string;
        this.rebuildValidatorForIssue(issue, implRunId);
      } else {
        this.blockIssueInRecovery(issue, ValidationBlockReason.RecoveryInconsistent, "No validation.requested event found during recovery for Validating issue");
      }
    }
  }

  private rebuildValidatorForIssue(issue: Issue, implRunId: string): void {
    const validators = this.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator);
    if (validators.length === 0) {
      this.blockIssueInRecovery(issue, ValidationBlockReason.ValidatorUnavailable, "No validator available during recovery");
      return;
    }
    const selected = validators[0];
    const round = issue.validation_round_count + 1;
    const validatorIdentity: AdapterIdentitySnapshot = {
      adapter_config_id: selected.id,
      name: selected.name,
      cli_provider: selected.cli_provider,
      default_model: selected.default_model,
    };
    const validatorRun = this.runRepo.create({
      issue_id: issue.id,
      thread_id: issue.primary_thread_id!,
      workspace_id: issue.workspace_id,
      adapter_config_id: selected.id,
      instructions: "",
      status: RunStatus.Queued,
      role: RunRole.Validator,
      dispatch_source: RunDispatchSource.System,
      validation_round: round,
      adapter_identity: validatorIdentity,
    });
    this.threadEventRepo.create({
      thread_id: issue.primary_thread_id!,
      type: ThreadEventType.RunQueued,
      actor_type: ActorType.System,
      actor_id: null,
      payload: {
        run_id: validatorRun.id,
        issue_id: issue.id,
        thread_id: issue.primary_thread_id!,
        workspace_id: issue.workspace_id,
        status: RunStatus.Queued,
        role: RunRole.Validator,
        validation_round: round,
      },
      evidence_refs: [],
    });
  }

  private blockIssueInRecovery(issue: Issue, reason: ValidationBlockReason, message: string): void {
    this.issueRepo.compareAndSetStatus(issue.id, issue.status, IssueStatus.Blocked, {
      blocked_reason_code: reason,
      blocked_reason_message: message,
    });
    this.threadEventRepo.create({
      thread_id: issue.primary_thread_id!,
      type: ThreadEventType.ValidationBlocked,
      actor_type: ActorType.System,
      actor_id: null,
      payload: {
        issue_id: issue.id,
        thread_id: issue.primary_thread_id!,
        workspace_id: issue.workspace_id,
        validation_round: issue.validation_round_count + 1,
        summary: message,
        reason_code: reason,
      },
      evidence_refs: [],
    });
  }

  private hasValidationBeenRequested(issue: Issue): boolean {
    const events = this.threadEventRepo.listByThreadAndTypes(
      issue.primary_thread_id!, [ThreadEventType.ValidationRequested], undefined, 1,
    );
    return events.length > 0;
  }

  private findLatestTerminalValidator(issueId: string) {
    return this.runRepo.getLatestTerminalByRole(issueId, RunRole.Validator);
  }

  private findValidationRequestedEvent(issue: Issue) {
    const events = this.threadEventRepo.listByThreadAndTypes(
      issue.primary_thread_id!, [ThreadEventType.ValidationRequested], undefined, 10,
    );
    return events.find((e) => e.payload_json.issue_id === issue.id) ?? null;
  }
}
