import type Database from "better-sqlite3";
import type { Run, FailureReason, IssueStatus, ThreadEvent } from "@personahub/shared/types";
import { IssueStatus as IS, RunStatus as RS, RunRole, ThreadEventType, ActorType, CommandTraceCapability, ValidationBlockReason } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { RunService } from "./run.js";
import type { WorkspaceLockService } from "./workspace-lock.js";
import type { ThreadEventService } from "./thread-event.js";
import type { DevelopmentTraceService } from "./development-trace.js";
import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
import type { AgentRunner, EscalationParams } from "../runtime/agent-runner.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { ThreadRepository } from "../repositories/thread.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { RunTraceRepository } from "../repositories/run-trace.js";
import type { ValidationWorkflowService } from "./validation/workflow-service.js";
import { AppError } from "../api/errors.js";

export class RunDispatchService {
  constructor(
    private runService: RunService,
    private workspaceLockService: WorkspaceLockService,
    private adapterRegistry: AgentAdapterRegistry,
    private agentConfigRepo: AgentConfigRepository,
    private issueRepo: IssueRepository,
    private threadRepo: ThreadRepository,
    private workspaceRepo: WorkspaceRepository,
    private threadEventService: ThreadEventService,
    private agentRunner: AgentRunner,
    private developmentTraceService: DevelopmentTraceService,
    private runTraceRepo: RunTraceRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private db: Database.Database,
  ) {}

  async dispatch(issueId: string, adapterId: string, instructions: string): Promise<Run> {
    const run = this.runService.create(issueId, adapterId, instructions);

    const lockAcquired = this.workspaceLockService.acquire(run.workspace_id, run.id);
    if (!lockAcquired) {
      return run;
    }

    let startedRun: Run | null;
    try {
      startedRun = this.prepareAndStart(run);
    } catch (error) {
      // prepareAndStart can throw (e.g. workspace/adapter deleted after create);
      // never leave the just-acquired lock held.
      this.workspaceLockService.releaseByRunId(run.id);
      throw error;
    }
    if (!startedRun) {
      this.workspaceLockService.releaseByRunId(run.id);
      return run;
    }

    try {
      await this.startAdapter(startedRun);
    } catch (error) {
      this.runService.transitionToFailed(
        startedRun.id,
        "spawn_failed" as FailureReason,
        null,
        String(error),
      );
      await this.finalizeAndDrain(startedRun.id, startedRun.workspace_id);
    }
    return run;
  }

  private prepareAndStart(run: Run): Run | null {
    const workspace = this.workspaceRepo.getById(run.workspace_id);
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
    }

    const adapterConfig = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!adapterConfig) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const adapter = this.adapterRegistry.getForConfig(adapterConfig);
    const traceCapability = adapter.capabilities.supportsStructuredTrace
      ? CommandTraceCapability.Supported
      : CommandTraceCapability.Unsupported;

    try {
      this.developmentTraceService.prepareRun({ run, workspace, traceCapability });
    } catch {
      // baseline failure does not prevent Run
    }

    return this.runService.transitionToRunning(run.id);
  }

  async finalizeAndDrain(runId: string, workspaceId: string): Promise<void> {
    try {
      try {
        this.developmentTraceService.finalizeRun(runId);
      } catch {
        // finalization failure still releases lock
      }
    } finally {
      this.workspaceLockService.releaseByRunId(runId);
      try {
        await this.workflowHook(runId);
      } catch {
        // hook errors must not prevent queue drain
      }
      await this.startNextQueuedRun(workspaceId);
    }
  }

  private async workflowHook(runId: string): Promise<void> {
    const run = this.runService.get(runId);
    if (!run || !run.role) return;

    if (run.role === RunRole.Implementation && run.status === RS.Completed) {
      this.validationWorkflowService.requestValidation(run.issue_id, runId);
      return;
    }

    if (run.role === RunRole.Validator) {
      if (run.status === RS.Completed) {
        this.validationWorkflowService.processValidatorResult(runId);
      } else if (run.status === RS.Failed || run.status === RS.Cancelled || run.status === RS.Interrupted) {
        this.validationWorkflowService.blockValidation(run.issue_id, runId, ValidationBlockReason.ValidatorRunFailed);
      }
      return;
    }
  }

  onRunTerminal(runId: string, workspaceId: string): void {
    void this.finalizeAndDrain(runId, workspaceId);
  }

  onEscalation(params: EscalationParams): void {
    const escalationRun = this.runService.get(params.runId);
    const issue = this.issueRepo.getById(params.issueId);
    const previousStatus = issue?.status ?? "Running";
    const capabilityNote = params.blockedBy === "credential_isolation"
      ? "Push failed: no push credentials provisioned for this workspace."
      : params.blockedBy === "pre_execution_approval"
        ? "Push blocked by pre-execution approval - command was rejected before execution."
        : "Push detected after execution - this is post-hoc detection, not pre-execution blocking.";

    const pendingBroadcasts: ThreadEvent[] = [];

    this.db.transaction(() => {
      const escalationEvent = this.threadEventService.write(
        params.threadId,
        ThreadEventType.EscalationTriggered,
        ActorType.System,
        null,
        {
          run_id: params.runId,
          issue_id: params.issueId,
          thread_id: params.threadId,
          workspace_id: escalationRun.workspace_id,
          status: "failed",
          reason: "dangerous_git_operation",
          detected_operation: params.detectedOperation,
          blocked_by: params.blockedBy,
          pre_execution_blocked: params.blockedBy !== "post_hoc_detection",
          capability_note: capabilityNote,
        },
      );
      pendingBroadcasts.push(escalationEvent);

      const failedResult = this.runService.transitionToFailedWriteOnly(
        params.runId,
        params.failureReason,
        null,
        params.detectedOperation,
      );
      if (failedResult) {
        pendingBroadcasts.push(failedResult.event);
      }

      this.issueRepo.updateStatus(params.issueId, {
        status: IS.Blocked,
        updatedAt: new Date().toISOString(),
      });

      const blockedEvent = this.threadEventService.write(
        params.threadId,
        ThreadEventType.IssueBlocked,
        ActorType.System,
        null,
        {
          issue_id: params.issueId,
          run_id: params.runId,
          thread_id: params.threadId,
          previous_status: previousStatus,
          status: "Blocked",
          reason: "dangerous_git_operation",
          blocked_by: params.blockedBy,
        },
      );
      pendingBroadcasts.push(blockedEvent);
    })();

    for (const event of pendingBroadcasts) {
      this.threadEventService.broadcast(event);
    }

    this.cancelQueuedRunsForIssue(params.issueId);

    void this.finalizeAndDrain(params.runId, escalationRun.workspace_id);
  }

  async cancel(runId: string): Promise<Run | null> {
    const run = this.runService.get(runId);

    if (run.status === RS.Queued) {
      return this.runService.cancelQueued(runId, "user_cancelled");
    }

    if (run.status === RS.Running) {
      const cancelled = await this.agentRunner.cancelRun(runId);
      if (cancelled?.status === RS.Cancelled) {
        await this.finalizeAndDrain(runId, cancelled.workspace_id);
      }
      return cancelled;
    }

    return run;
  }

  async drainWorkspace(workspaceId: string): Promise<void> {
    await this.startNextQueuedRun(workspaceId);
  }

  private async startAdapter(run: Run): Promise<void> {
    const adapterConfig = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!adapterConfig) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const adapter = this.adapterRegistry.getForConfig(adapterConfig);
    const workspace = this.workspaceRepo.getById(run.workspace_id);
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
    }

    const issue = this.issueRepo.getById(run.issue_id);
    const context = [
      `Issue: ${issue?.title ?? ""}`,
      `Goal: ${issue?.goal ?? ""}`,
      `Workspace: ${workspace.local_path}`,
      `Thread ID: ${run.thread_id}`,
      `Run ID: ${run.id}`,
    ].join("\n");

    await this.agentRunner.startRun({
      run,
      adapter,
      workspace,
      context,
      adapterConfig: {
        command: adapterConfig.command,
        args: adapterConfig.args,
        model_provider: adapterConfig.model_provider,
        default_model: adapterConfig.default_model,
        auth_type: adapterConfig.auth_type,
        api_key: adapterConfig.api_key,
      },
      onTerminal: (terminalRunId, workspaceId) => {
        this.onRunTerminal(terminalRunId, workspaceId);
      },
      onEscalation: (escalationParams) => {
        this.onEscalation(escalationParams);
      },
    });
  }

  private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) continue;
      if (issue.status === IS.Blocked) {
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
        continue;
      }
      if (issue.status === IS.Done) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }
      if (issue.status === IS.Validating && run.role !== RunRole.Validator) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }

      if (run.role === RunRole.Validator) {
        if (issue.status !== IS.Validating) {
          this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
          continue;
        }
        const expectedRound = issue.validation_round_count + 1;
        if (run.validation_round !== expectedRound) {
          this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
          continue;
        }
      }

      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) return;

      let startedRun: Run | null;
      try {
        startedRun = this.prepareAndStart(run);
      } catch {
        // Do not leak the lock or reject out of the finalize/drain path;
        // release and try the next queued Run.
        this.workspaceLockService.releaseByRunId(run.id);
        continue;
      }
      if (startedRun) {
        try {
          await this.startAdapter(startedRun);
        } catch (error) {
          this.runService.transitionToFailed(
            startedRun.id,
            "spawn_failed" as FailureReason,
            null,
            String(error),
          );
          await this.finalizeAndDrain(startedRun.id, workspaceId);
        }
        return;
      }
      this.workspaceLockService.releaseByRunId(run.id);
    }
  }

  private cancelQueuedRunsForIssue(issueId: string): void {
    const runs = this.runService.listByIssue(issueId);
    for (const run of runs) {
      if (run.status === RS.Queued) {
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
      }
    }
  }
}
