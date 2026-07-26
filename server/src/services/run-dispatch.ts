import type Database from "better-sqlite3";
import type { Run, IssueStatus, ThreadEvent, RunPurpose } from "@personahub/shared/types";
import { IssueStatus as IS, RunStatus as RS, RunRole, FailureReason as FR, AdapterStatus as AS, ThreadEventType, ActorType, CommandTraceCapability, ValidationBlockReason } from "@personahub/shared/types";
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
import type { ValidationWorkflowService } from "./validation/workflow-service.js";
import { AppError } from "../api/errors.js";
import { buildRunContext } from "./run-context-builder.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import { sanitizeAuthStatusMessage } from "../runtime/trace/redaction.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";

export class RunDispatchService {
  /**
   * Tracks in-flight `reprobeAdapterOnFailure()` calls: fire-and-forget
   * (`void promise.catch(...)`) must never block queue drain, but "not
   * blocking the current request" isn't the same as "unmanaged" — an
   * untracked probe silently loses design §5.2's "must converge to
   * unavailable" guarantee if the process exits mid-probe (OpenCode's probe
   * alone can take up to 30s), and a thrown registry/provider/DB error had
   * nowhere to go but a swallowed `.catch(() => {})`.
   */
  private pendingAvailabilityProbes = new Set<Promise<void>>();

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
    /** closure-recheck-3-report fix: SAME instance injected into AdapterConfigService — see adapter-probe-coordinator.ts. */
    private probeCoordinator: AdapterAvailabilityProbeCoordinator,
  ) {}

  async dispatch(issueId: string, adapterId: string | undefined, instructions: string, purpose?: RunPurpose): Promise<Run> {
    const run = this.manualRoutingService.dispatch({ issueId, adapterId: adapterId || undefined, instructions, purpose });

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
        FR.SpawnFailed,
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
    // design §5.2: "dispatch 或 Run 期间遭遇 auth failure，必须把该 adapter
    // 更新为 unavailable" — re-probe (never guess from raw process output;
    // reuses the same provider validate() the explicit Validate button
    // calls) is best-effort and must never delay queue drain or a failed
    // Run's own terminal handling — but it is still a tracked background
    // task (see pendingAvailabilityProbes / shutdown()), not a fully
    // unmanaged fire-and-forget.
    this.trackAvailabilityProbe(runId, this.reprobeAdapterOnFailure(runId));

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

  /** Fire-and-forget but tracked: logs (never silently swallows) a probe failure, and lets shutdown() await outstanding probes with a bound. */
  private trackAvailabilityProbe(runId: string, probe: Promise<void>): void {
    this.pendingAvailabilityProbes.add(probe);
    const settle = probe
      .catch((error) => {
        console.warn(`[RunDispatchService] adapter availability re-probe failed for run ${runId}:`, error);
      })
      .finally(() => {
        this.pendingAvailabilityProbes.delete(probe);
      });
    void settle;
  }

  /**
   * Called from the server's onClose hook alongside AgentRunner.shutdown().
   * Bounded so a stuck/slow probe (OpenCode's spawn timeout alone is 30s)
   * can never hang process shutdown indefinitely — best-effort convergence
   * is worth a short wait, not worth blocking a restart/deploy.
   */
  async shutdown(timeoutMs = 5_000): Promise<void> {
    if (this.pendingAvailabilityProbes.size === 0) return;
    const pending = Promise.allSettled([...this.pendingAvailabilityProbes]);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([pending, timeout]);
  }

  /**
   * Convergence path for adapter availability: any Run (implementation,
   * validator, or consult — availability is a provider/config property, not
   * a function of whether the Run happened to drive workflow state) that
   * failed with a generic AdapterExitNonzero/SpawnFailed re-triggers the
   * adapter's own real provider `validate()` probe (e.g. Claude's
   * `auth status`) — never a guess parsed from this Run's stdout/stderr
   * text, which would risk misclassifying an unrelated failure as an auth
   * problem. Only downgrades on a confirmed-unavailable probe result; never
   * upgrades here.
   *
   * Race guard: the probe is awaited against a snapshot taken before the
   * (up to 30s) async call. If the config's generation, the target
   * workspace's `push_credentials_enabled` (closure-recheck-4-report fix —
   * a direct input to the probe, not just an incidental `updated_at` bump),
   * or (for the workspace-override path) the override row's `updated_at`
   * has moved by the time the probe resolves — the user edited the
   * command/key, flipped the workspace's credential-push setting, or an
   * explicit Validate already landed — the stale result is discarded rather
   * than clobbering newer state.
   *
   * closure-recheck-3-report fix: this is a SECOND writer of the same
   * `adapter_workspace_status` rows `AdapterConfigService.validate()`
   * writes — a race between the two (e.g. a Run's failure re-probe starts,
   * then the user clicks Validate for the same workspace before the
   * re-probe finishes) used to be decided by "whichever writes first wins"
   * (via the override row's own `updated_at`), which could let this
   * re-probe silently beat a strictly newer, more authoritative explicit
   * Validate to the write. Claiming a probe generation from the SAME
   * `probeCoordinator` instance `AdapterConfigService` uses — at the START
   * of this probe, not at write time — and checking it's still current
   * before writing fixes that: whichever call was invoked more recently for
   * this exact `(adapter, workspace)` scope wins, regardless of completion
   * order or which service issued it.
   *
   * Workspace-scoped write: a failed Run always belongs to exactly one
   * workspace, and its probe uses that workspace's real
   * `push_credentials_enabled` — so a confirmed-unavailable result is only
   * ever written as an EXCEPTION for `(adapter, run.workspace_id)`, never to
   * the Project-global `agent_configs.status`. A failure specific to one
   * (e.g. isolated) workspace must not disable the adapter for the
   * Project's other workspaces, which resolveAdapter()/claimValidatorSlot()
   * consult via `effectiveAdapterStatus()` (global + override) — matching
   * how `AdapterConfigService.validate(id, workspaceId)` already scopes its
   * writes.
   */
  private async reprobeAdapterOnFailure(runId: string): Promise<void> {
    // Nullable lookup, not RunService.get() (which throws RUN_NOT_FOUND): a
    // missing run is an unremarkable no-op here — e.g. a test/caller
    // exercising finalizeAndDrain() with a run id that was never
    // persisted — not a probe failure worth a warning.
    const run = this.runRepo.getById(runId);
    if (!run || run.status !== RS.Failed) return;
    if (run.failure_reason !== FR.AdapterExitNonzero && run.failure_reason !== FR.SpawnFailed) return;

    const record = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!record) return;
    const override = this.adapterWorkspaceStatusRepo.get(run.adapter_config_id, run.workspace_id);
    if (effectiveAdapterStatus(record, override) !== AS.Available) return;
    const snapshotConfigGeneration = this.probeCoordinator.getConfigGeneration(run.adapter_config_id);
    const probeScopeKey = AdapterAvailabilityProbeCoordinator.scopedProbeKey(run.adapter_config_id, run.workspace_id);
    const myProbeGeneration = this.probeCoordinator.claimProbe(probeScopeKey);
    const snapshotOverrideUpdatedAt = override?.updated_at ?? null;

    // This failed Run's own workspace is the exact environment the probe
    // must predict — pass its real push_credentials_enabled through rather
    // than always assuming the conservative isolated case. Snapshotted (not
    // just read inline) because it's a direct input to what the probe
    // finds — closure-recheck-4-report fix: a mid-flight flip of this exact
    // field (independent of config/probe-generation/override changes) must
    // invalidate the result exactly like `AdapterConfigService.validate()`'s
    // scoped path already requires.
    const workspace = this.workspaceRepo.getById(run.workspace_id);
    const snapshotPushCredentialsEnabled = workspace?.push_credentials_enabled ?? false;
    const publicConfig = toPublicAdapter(record, null);
    const adapter = this.adapterRegistry.getForConfig(publicConfig);
    const result = await adapter.validate(publicConfig, record.api_key, {
      pushCredentialsEnabled: snapshotPushCredentialsEnabled,
    });
    if (result.available) return;

    const current = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!current || this.probeCoordinator.getConfigGeneration(run.adapter_config_id) !== snapshotConfigGeneration) return;
    if (!this.probeCoordinator.isCurrentProbe(probeScopeKey, myProbeGeneration)) return;
    const currentWorkspace = this.workspaceRepo.getById(run.workspace_id);
    if (!currentWorkspace || currentWorkspace.push_credentials_enabled !== snapshotPushCredentialsEnabled) return;
    const currentOverride = this.adapterWorkspaceStatusRepo.get(run.adapter_config_id, run.workspace_id);
    if ((currentOverride?.updated_at ?? null) !== snapshotOverrideUpdatedAt) return;

    const now = new Date().toISOString();
    this.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: run.adapter_config_id,
      workspace_id: run.workspace_id,
      status: AS.Unavailable,
      last_checked_at: now,
      auth_status_message: sanitizeAuthStatusMessage(result.errorMessage, [record.api_key]),
    });
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
          // T060: safety-first applies to every provider/purpose alike — a
          // consult Run that never drives Issue state still gets Blocked on
          // a dangerous operation (design §7.3). The routing metadata lets
          // the UI say *which kind* of Run triggered it.
          purpose: escalationRun.purpose,
          role: escalationRun.role,
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
      if (run.role === RunRole.Implementation && issue.status !== IS.Inbox && issue.status !== IS.Ready && issue.status !== IS.Running) {
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
            FR.SpawnFailed,
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
