import type Database from "better-sqlite3";
import type { Run, RunPurpose } from "@personahub/shared/types";
import {
  IssueStatus as IS,
  RunStatus as RS,
  RunRole,
  FailureReason as FR,
  CommandTraceCapability,
  ValidationBlockReason,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { RunService } from "./run.js";
import type { ManualRoutingService } from "./manual-routing-service.js";
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
import type { RunRepository } from "../repositories/run.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { FileChangeRepository } from "../repositories/file-change.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import { NodeRunStatus } from "@personahub/shared/types";
import type { NodeRunRepository } from "../repositories/node-run.js";
import type { GraphRunRepository } from "../repositories/graph-run.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { ValidationWorkflowService } from "./validation/workflow-service.js";
import {
  processGraphNodeCompletion,
  blockGraphOnCancelledPrecursor,
  tryFinalizeGraphRun,
  type NodeCompletionDeps,
} from "./graph/node-completion.js";
import { AppError } from "../api/errors.js";
import { buildRunContext } from "./run-context-builder.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";
import { AdapterFailureReprobe } from "./adapter-failure-reprobe.js";
import { RunEscalationHandler } from "./run-escalation-handler.js";

export class RunDispatchService {
  private failureReprobe: AdapterFailureReprobe;
  private escalationHandler: RunEscalationHandler;

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
    private runRepo: RunRepository,
    private threadEventRepo: ThreadEventRepository,
    private fileChangeRepo: FileChangeRepository,
    private manualRoutingService: ManualRoutingService,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private nodeRunRepo: NodeRunRepository,
    private graphRunRepo: GraphRunRepository,
    private projectRepo: ProjectRepository,
    /** closure-recheck-3-report fix */
    probeCoordinator: AdapterAvailabilityProbeCoordinator,
  ) {
    this.failureReprobe = new AdapterFailureReprobe(
      runRepo,
      agentConfigRepo,
      workspaceRepo,
      adapterWorkspaceStatusRepo,
      adapterRegistry,
      probeCoordinator,
    );
    this.escalationHandler = new RunEscalationHandler(
      runService,
      issueRepo,
      threadEventService,
      db,
      (runId, workspaceId) => this.finalizeAndDrain(runId, workspaceId),
    );
  }

  async dispatch(
    issueId: string,
    adapterId: string | undefined,
    instructions: string,
    purpose?: RunPurpose,
  ): Promise<Run> {
    const run = this.manualRoutingService.dispatch({
      issueId,
      adapterId: adapterId || undefined,
      instructions,
      purpose,
    });

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
      this.runService.transitionToFailed(startedRun.id, FR.SpawnFailed, null, String(error));
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
    // design §5.2: "dispatch 或 Run 期间遭遇 auth failure，必须把该 adapter
    // 更新为 unavailable" — re-probe (never guess from raw process output;
    // reuses the same provider validate() the explicit Validate button
    // calls) is best-effort and must never delay queue drain or a failed
    // Run's own terminal handling — but it is still a tracked background
    // task (see pendingAvailabilityProbes / shutdown()), not a fully
    // unmanaged fire-and-forget.
    this.failureReprobe.trigger(runId);

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

  async shutdown(timeoutMs = 5_000): Promise<void> {
    await this.failureReprobe.shutdown(timeoutMs);
  }

  private async workflowHook(runId: string): Promise<void> {
    const run = this.runService.get(runId);
    if (!run || !run.role) return;

    if (run.role === RunRole.GraphNode) {
      processGraphNodeCompletion(this.nodeCompletionDeps(), run);
      return;
    }

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
    this.escalationHandler.handle(params);
  }

  async cancel(runId: string): Promise<Run | null> {
    const run = this.runService.get(runId);

    if (run.status === RS.Queued) {
      const cancelled = this.runService.cancelQueued(runId, "user_cancelled");
      if (cancelled && cancelled.role === RunRole.GraphNode && cancelled.node_run_id) {
        this.nodeRunRepo.compareAndSetStatus(cancelled.node_run_id, NodeRunStatus.Ready, NodeRunStatus.Cancelled);
        const nr = this.nodeRunRepo.getById(cancelled.node_run_id);
        if (nr) {
          // A cancelled precursor can make a still-non-terminal downstream
          // node's join permanently unsatisfiable — tryFinalizeGraph()'s
          // allTerminal gate only fires once *every* node reaches a
          // terminal state, which never happens on its own in that case
          // (the graph would silently sit in `running` forever). Detect
          // that condition and block immediately instead of waiting.
          const blockedImmediately = blockGraphOnCancelledPrecursor(
            this.nodeCompletionDeps(),
            nr.graph_run_id,
            nr.node_key,
          );
          if (!blockedImmediately) tryFinalizeGraphRun(this.nodeCompletionDeps(), nr.graph_run_id);
        }
        await this.startNextQueuedRun(cancelled.workspace_id);
      }
      return cancelled;
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
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }
    // design §6.5: RunContextBuilder replaces F002's hand-rolled context
    // string — implementation/consult Runs now see the latest eligible
    // prior handoff; validator Runs stay strictly bound to their own
    // context_source_run_id (never re-derived here).
    const { context } = buildRunContext(
      { runRepo: this.runRepo, threadEventRepo: this.threadEventRepo, fileChangeRepo: this.fileChangeRepo },
      run,
      issue,
    );

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
        if (run.role === RunRole.GraphNode) continue;
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
        continue;
      }
      if (issue.status === IS.Done) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }
      // design §7.5: eligibility is role-specific, not just "validator vs
      // everything else" — consult stays eligible through Validating too
      // (it never drives workflow state, so it doesn't compete with the
      // validator for that round; only implementation is excluded once
      // Validating starts).
      if (
        run.role === RunRole.Implementation &&
        issue.status !== IS.Inbox &&
        issue.status !== IS.Ready &&
        issue.status !== IS.Running
      ) {
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
      // consult: eligible on Inbox/Ready/Running/Validating — Done/Blocked
      // already handled above, nothing further to check here.

      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) return;

      let startedRun: Run | null = null;

      if (run.role === RunRole.GraphNode && run.node_run_id) {
        let claimedRun: Run | null = null;
        try {
          this.db.transaction(() => {
            const nodeMoved = this.nodeRunRepo.compareAndSetStatus(
              run.node_run_id!,
              NodeRunStatus.Ready,
              NodeRunStatus.Running,
            );
            if (!nodeMoved.success) throw new Error("node_not_ready");
            const runResult = this.runRepo.transitionStatus(run.id, RS.Queued, RS.Running, {
              started_at: new Date().toISOString(),
            });
            if (!runResult.success) throw new Error("run_not_queued");
            claimedRun = runResult.run;
          })();
        } catch {
          this.workspaceLockService.releaseByRunId(run.id);
          continue;
        }
        startedRun = claimedRun;
      } else {
        try {
          startedRun = this.prepareAndStart(run);
        } catch {
          this.workspaceLockService.releaseByRunId(run.id);
          continue;
        }
      }
      if (startedRun) {
        try {
          await this.startAdapter(startedRun);
        } catch (error) {
          this.runService.transitionToFailed(startedRun.id, FR.SpawnFailed, null, String(error));
          await this.finalizeAndDrain(startedRun.id, workspaceId);
        }
        return;
      }
      this.workspaceLockService.releaseByRunId(run.id);
    }
  }

  /** Bundles this service's own repositories/services into the shape
   *  node-completion.ts's free functions expect — those functions are
   *  shared with GraphRecoveryService, so the dispatch-time and
   *  restart-recovery paths can never drift apart again. */
  private nodeCompletionDeps(): NodeCompletionDeps {
    return {
      nodeRunRepo: this.nodeRunRepo,
      graphRunRepo: this.graphRunRepo,
      runRepo: this.runRepo,
      issueRepo: this.issueRepo,
      threadEventService: this.threadEventService,
      threadEventRepo: this.threadEventRepo,
      agentConfigRepo: this.agentConfigRepo,
      projectRepo: this.projectRepo,
      adapterWorkspaceStatusRepo: this.adapterWorkspaceStatusRepo,
      db: this.db,
    };
  }
}
