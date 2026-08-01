import type { Run, FailureReason, Workspace, AdapterAuthType } from "@personahub/shared/types";
import { FailureReason as FR, ThreadEventType, ActorType, CommandTraceCapability, type RunTraceSignal } from "@personahub/shared/types";
import type { AgentAdapter, RunHandle, RunOutputChunk, RunExitResult, AgentRunInput } from "./types.js";
import { DEFAULT_EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES, MAX_CHUNK_BYTES } from "./types.js";
import type { RunService } from "../services/run.js";
import type { ThreadEventService } from "../services/thread-event.js";
import type { WorkspaceLockService } from "../services/workspace-lock.js";
import { buildWorkspaceContext } from "./workspace-context.js";
import { CommandCorrelator } from "./trace/command-correlator.js";

interface ActiveRun {
  handle: RunHandle;
  outputBytes: number;
  sequence: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
  truncated: boolean;
  exited: boolean;
  correlator: CommandCorrelator;
  workspacePath: string;
  traceCapability: CommandTraceCapability;
}

export interface AgentRunnerDeps {
  runService: RunService;
  threadEventService: ThreadEventService;
  workspaceLockService: WorkspaceLockService;
}

export interface StartRunParams {
  run: Run;
  adapter: AgentAdapter;
  workspace: Workspace;
  context: string;
  adapterConfig: {
    command: string;
    args: string[];
    model_provider: string | null;
    default_model: string | null;
    auth_type: AdapterAuthType;
    api_key: string | null;
  };
  onTerminal?: (runId: string, workspaceId: string) => void;
  onEscalation?: (params: EscalationParams) => void;
}

export interface EscalationParams {
  runId: string;
  issueId: string;
  threadId: string;
  blockedBy: string;
  failureReason: FailureReason;
  detectedOperation: string;
}

const ESCALATION_REASONS: Set<FailureReason> = new Set([
  FR.CredentialIsolationBlocked,
  FR.PreExecutionApprovalRejected,
  FR.PostHocEscalation,
]);

const ESCALATION_BLOCKED_BY: Record<FailureReason, string> = {
  [FR.CredentialIsolationBlocked]: "credential_isolation",
  [FR.PreExecutionApprovalRejected]: "pre_execution_approval",
  [FR.PostHocEscalation]: "post_hoc_detection",
  [FR.AdapterExitNonzero]: "",
  [FR.SpawnFailed]: "",
  [FR.ExecutionTimeout]: "",
  [FR.ServerRestarted]: "",
  [FR.OutputParseFailed]: "",
};

export class AgentRunner {
  private activeRuns = new Map<string, ActiveRun>();

  constructor(private deps: AgentRunnerDeps) {}

  async startRun(params: StartRunParams): Promise<void> {
    const { run, adapter, workspace, context, adapterConfig, onTerminal, onEscalation } = params;

    const input: AgentRunInput = {
      runId: run.id,
      issueId: run.issue_id,
      threadId: run.thread_id,
      workspace: buildWorkspaceContext(workspace),
      instructions: run.instructions,
      context,
      adapterConfig,
    };

    const activeRun: ActiveRun = {
      handle: null as never,
      outputBytes: 0,
      sequence: 0,
      timeoutTimer: null as never,
      truncated: false,
      exited: false,
      correlator: new CommandCorrelator(this.deps.threadEventService),
      workspacePath: workspace.local_path,
      traceCapability: adapter.capabilities.supportsStructuredTrace
        ? CommandTraceCapability.Supported
        : CommandTraceCapability.Unsupported,
    };

    const timeoutTimer = setTimeout(() => {
      if (activeRun.exited) return;
      void this.timeoutRun(run, workspace.id, activeRun, onTerminal, onEscalation);
    }, adapter.capabilities.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS);

    activeRun.timeoutTimer = timeoutTimer;

    const handle = await adapter.start(input);
    activeRun.handle = handle;
    this.activeRuns.set(run.id, activeRun);

    handle.onOutput((event: RunOutputChunk) => {
      if (activeRun.exited) return;
      this.handleOutput(run, event, activeRun);
    });

    handle.onTrace((signal: RunTraceSignal) => {
      if (activeRun.exited) return;
      activeRun.correlator.handleSignal(signal, {
        run,
        workspacePath: activeRun.workspacePath,
        traceCapability: activeRun.traceCapability,
      });
    });

    handle.onExit((result: RunExitResult) => {
      if (activeRun.exited) return;
      activeRun.exited = true;
      clearTimeout(activeRun.timeoutTimer);
      this.handleExit(run, workspace.id, result, onTerminal, onEscalation);
    });
  }

  private async timeoutRun(
    run: Run,
    workspaceId: string,
    activeRun: ActiveRun,
    onTerminal?: (runId: string, workspaceId: string) => void,
    onEscalation?: (params: EscalationParams) => void,
  ): Promise<void> {
    if (activeRun.exited) return;
    activeRun.exited = true;
    try {
      await activeRun.handle.cancel();
    } catch {
      void 0;
    }
    this.handleExit(run, workspaceId, {
      exitCode: null,
      failureReason: FR.ExecutionTimeout,
      errorMessage: "Execution timed out",
      finalMessage: null,
    }, onTerminal, onEscalation);
  }

  private handleOutput(run: Run, event: RunOutputChunk, activeRun: ActiveRun): void {
    if (activeRun.truncated) return;

    const remaining = Math.max(0, MAX_OUTPUT_BYTES - activeRun.outputBytes);
    if (remaining === 0) {
      if (!activeRun.truncated) {
        activeRun.truncated = true;
        this.deps.threadEventService.writeAndBroadcast(
          run.thread_id,
          ThreadEventType.RunOutputTruncated,
          ActorType.System,
          null,
          {
            run_id: run.id,
            issue_id: run.issue_id,
            thread_id: run.thread_id,
            workspace_id: run.workspace_id,
            status: "running",
            max_bytes: MAX_OUTPUT_BYTES,
          },
        );
      }
      return;
    }

    let chunk = event.chunk;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (chunkBytes > remaining) {
      const buf = Buffer.from(chunk, "utf8");
      chunk = buf.subarray(0, remaining).toString("utf8");
    }
    if (chunkBytes > MAX_CHUNK_BYTES) {
      const buf = Buffer.from(chunk, "utf8");
      chunk = buf.subarray(0, Math.min(remaining, MAX_CHUNK_BYTES)).toString("utf8");
    }

    activeRun.outputBytes += Buffer.byteLength(chunk, "utf8");
    activeRun.sequence++;

    if (activeRun.outputBytes >= MAX_OUTPUT_BYTES) {
      activeRun.truncated = true;
      this.deps.threadEventService.writeAndBroadcast(
        run.thread_id,
        ThreadEventType.RunOutputTruncated,
        ActorType.System,
        null,
        {
          run_id: run.id,
          issue_id: run.issue_id,
          thread_id: run.thread_id,
          workspace_id: run.workspace_id,
          status: "running",
          max_bytes: MAX_OUTPUT_BYTES,
        },
      );
      return;
    }

    const outputEvent = this.deps.threadEventService.writeAndBroadcast(
      run.thread_id,
      ThreadEventType.RunOutput,
      ActorType.System,
      null,
      {
        run_id: run.id,
        issue_id: run.issue_id,
        thread_id: run.thread_id,
        workspace_id: run.workspace_id,
        status: "running",
        stream: event.stream,
        sequence: activeRun.sequence,
        chunk,
        ...(event.sourceItemId ? { source_item_id: event.sourceItemId } : {}),
      },
    );
    activeRun.correlator.trackOutputEvent(event.sourceItemId, outputEvent.id);
  }

  private handleExit(
    run: Run,
    workspaceId: string,
    result: RunExitResult,
    onTerminal?: (runId: string, workspaceId: string) => void,
    onEscalation?: (params: EscalationParams) => void,
  ): void {
    this.activeRuns.delete(run.id);

    if (result.failureReason && ESCALATION_REASONS.has(result.failureReason)) {
      const blockedBy = ESCALATION_BLOCKED_BY[result.failureReason] || "post_hoc_detection";
      if (onEscalation) {
        onEscalation({
          runId: run.id,
          issueId: run.issue_id,
          threadId: run.thread_id,
          blockedBy,
          failureReason: result.failureReason,
          detectedOperation: result.errorMessage ?? "",
        });
      } else {
        this.deps.runService.transitionToFailed(
          run.id,
          result.failureReason,
          result.exitCode,
          result.errorMessage,
        );
        onTerminal?.(run.id, workspaceId);
      }
      return;
    }

    if (result.exitCode === 0 && !result.failureReason) {
      this.deps.runService.transitionToCompleted(run.id, 0, result.finalMessage);
    } else if (result.failureReason === FR.SpawnFailed) {
      this.deps.runService.transitionToFailed(
        run.id,
        FR.SpawnFailed,
        result.exitCode,
        result.errorMessage,
      );
    } else if (result.failureReason === FR.ExecutionTimeout) {
      this.deps.runService.transitionToFailed(
        run.id,
        FR.ExecutionTimeout,
        result.exitCode,
        result.errorMessage,
      );
    } else if (result.exitCode !== null && result.exitCode !== 0) {
      this.deps.runService.transitionToFailed(
        run.id,
        FR.AdapterExitNonzero,
        result.exitCode,
        result.errorMessage,
      );
    } else {
      this.deps.runService.transitionToCompleted(run.id, result.exitCode ?? 0, result.finalMessage);
    }

    onTerminal?.(run.id, workspaceId);
  }

  async cancelRun(runId: string): Promise<Run | null> {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return null;
    }

    if (activeRun.exited) {
      return null;
    }

    activeRun.exited = true;
    clearTimeout(activeRun.timeoutTimer);

    try {
      await activeRun.handle.cancel();
    } catch {
      void 0;
    }

    this.activeRuns.delete(runId);

    const result = this.deps.runService.transitionToCancelled(
      runId,
      "user_cancelled",
    );

    return result;
  }

  hasActiveRun(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  async shutdown(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const activeRun of this.activeRuns.values()) {
      if (!activeRun.exited) {
        activeRun.exited = true;
        clearTimeout(activeRun.timeoutTimer);
        promises.push(activeRun.handle.cancel().catch(() => {}));
      }
    }
    this.activeRuns.clear();
    await Promise.all(promises);
  }
}
