import type Database from "better-sqlite3";
import type { Run, RunStatus, FailureReason, IssueStatus, ThreadEvent } from "@personahub/shared/types";
import { RunStatus as RS, IssueStatus as IS, FailureReason as FR, ThreadEventType, ActorType, AdapterStatus } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ThreadEventService } from "./thread-event.js";
import type { WorkspaceLockService } from "./workspace-lock.js";
import { AppError } from "../api/errors.js";

export interface RunCreateServiceInput {
  instructions: string;
  adapterId: string;
}

export class RunService {
  constructor(
    private runRepo: RunRepository,
    private threadEventService: ThreadEventService,
    private issueRepo: IssueRepository,
    private workspaceRepo: WorkspaceRepository,
    private agentConfigRepo: AgentConfigRepository,
    private workspaceLockService: WorkspaceLockService,
    private db: Database.Database,
  ) {}

  create(issueId: string, adapterId: string, instructions: string): Run {
    const issue = this.issueRepo.getById(issueId);
    if (!issue) {
      throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");
    }

    if (issue.status === IS.Blocked) {
      throw new AppError(ErrorCode.ISSUE_BLOCKED, "Issue is blocked and cannot accept new runs.");
    }

    const trimmedInstructions = instructions?.trim();
    if (!trimmedInstructions) {
      throw new AppError(ErrorCode.RUN_INSTRUCTIONS_REQUIRED, "Run instructions are required.", "instructions");
    }

    const adapter = this.agentConfigRepo.getById(adapterId);
    if (!adapter || adapter.project_id !== issue.project_id) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found for this project.");
    }

    if (adapter.status !== AdapterStatus.Available) {
      throw new AppError(ErrorCode.ADAPTER_UNAVAILABLE, "Adapter is not available.");
    }

    const workspace = this.workspaceRepo.getById(issue.workspace_id);
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for issue.");
    }

    if (!issue.primary_thread_id) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Issue has no primary thread.");
    }

    const threadId = issue.primary_thread_id;

    const { run, event } = this.db.transaction(() => {
      const run = this.runRepo.create({
        issue_id: issueId,
        thread_id: threadId,
        workspace_id: workspace.id,
        adapter_config_id: adapterId,
        instructions: trimmedInstructions,
        status: RS.Queued,
      });

      if (issue.status === IS.Inbox || issue.status === IS.Ready) {
        this.issueRepo.updateStatus(issueId, {
          status: IS.Running,
          updatedAt: new Date().toISOString(),
        });
      }

      const event = this.threadEventService.write(
        run.thread_id,
        ThreadEventType.RunQueued,
        ActorType.System,
        null,
        {
          run_id: run.id,
          issue_id: issueId,
          thread_id: threadId,
          workspace_id: workspace.id,
          status: RS.Queued,
          adapter_config_id: adapterId,
        },
      );

      return { run, event };
    })();

    this.threadEventService.broadcast(event);
    return run;
  }

  get(runId: string): Run {
    const run = this.runRepo.getById(runId);
    if (!run) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, "Run not found.");
    }
    return run;
  }

  listByIssue(issueId: string): Run[] {
    return this.runRepo.listByIssue(issueId);
  }

  transitionToRunning(runId: string): Run | null {
    const now = new Date().toISOString();
    const result = this.runRepo.transitionStatus(runId, RS.Queued, RS.Running, {
      started_at: now,
    });

    if (!result.success || !result.run) {
      return null;
    }

    this.threadEventService.writeAndBroadcast(
      result.run.thread_id,
      ThreadEventType.RunStarted,
      ActorType.System,
      null,
      {
        run_id: runId,
        issue_id: result.run.issue_id,
        thread_id: result.run.thread_id,
        workspace_id: result.run.workspace_id,
        status: RS.Running,
      },
    );

    return result.run;
  }

  transitionToCompleted(runId: string, exitCode: number): Run | null {
    const now = new Date().toISOString();
    const result = this.runRepo.transitionStatus(runId, RS.Running, RS.Completed, {
      completed_at: now,
      exit_code: exitCode,
    });

    if (!result.success || !result.run) {
      return null;
    }

    this.threadEventService.writeAndBroadcast(
      result.run.thread_id,
      ThreadEventType.RunCompleted,
      ActorType.System,
      null,
      {
        run_id: runId,
        issue_id: result.run.issue_id,
        thread_id: result.run.thread_id,
        workspace_id: result.run.workspace_id,
        status: RS.Completed,
        exit_code: exitCode,
      },
    );

    this.workspaceLockService.releaseByRunId(runId);
    return result.run;
  }

  transitionToFailed(
    runId: string,
    failureReason: FailureReason,
    exitCode: number | null,
    errorMessage: string | null,
  ): Run | null {
    const now = new Date().toISOString();
    const result = this.runRepo.transitionStatus(runId, RS.Running, RS.Failed, {
      completed_at: now,
      failure_reason: failureReason,
      exit_code: exitCode,
      error_message: errorMessage,
    });

    if (!result.success || !result.run) {
      return null;
    }

    this.threadEventService.writeAndBroadcast(
      result.run.thread_id,
      ThreadEventType.RunFailed,
      ActorType.System,
      null,
      {
        run_id: runId,
        issue_id: result.run.issue_id,
        thread_id: result.run.thread_id,
        workspace_id: result.run.workspace_id,
        status: RS.Failed,
        failure_reason: failureReason,
        exit_code: exitCode,
        error_message: errorMessage,
      },
    );

    this.workspaceLockService.releaseByRunId(runId);
    return result.run;
  }

  transitionToInterrupted(runId: string): Run | null {
    const now = new Date().toISOString();
    const result = this.runRepo.transitionStatus(runId, RS.Running, RS.Interrupted, {
      completed_at: now,
      failure_reason: FR.ServerRestarted,
    });

    if (!result.success || !result.run) {
      return null;
    }

    this.threadEventService.writeAndBroadcast(
      result.run.thread_id,
      ThreadEventType.RunInterrupted,
      ActorType.System,
      null,
      {
        run_id: runId,
        issue_id: result.run.issue_id,
        thread_id: result.run.thread_id,
        workspace_id: result.run.workspace_id,
        status: RS.Interrupted,
        failure_reason: FR.ServerRestarted,
      },
    );

    this.workspaceLockService.releaseByRunId(runId);
    return result.run;
  }

  cancelQueued(runId: string, reason: string): Run | null {
    const run = this.runRepo.getById(runId);
    if (!run) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, "Run not found.");
    }

    if (isTerminalStatus(run.status)) {
      return run;
    }

    if (run.status !== RS.Queued) {
      return null;
    }

    const result = this.runRepo.transitionStatus(runId, RS.Queued, RS.Cancelled, {});
    if (!result.success || !result.run) {
      return null;
    }

    this.threadEventService.writeAndBroadcast(
      result.run.thread_id,
      ThreadEventType.RunCancelled,
      ActorType.System,
      null,
      {
        run_id: runId,
        issue_id: result.run.issue_id,
        thread_id: result.run.thread_id,
        workspace_id: result.run.workspace_id,
        status: RS.Cancelled,
        reason,
      },
    );

    return result.run;
  }

  transitionToCancelled(runId: string, reason: string): Run | null {
    const now = new Date().toISOString();
    const result = this.runRepo.transitionStatus(runId, RS.Running, RS.Cancelled, {
      completed_at: now,
    });

    if (!result.success || !result.run) {
      return null;
    }

    this.threadEventService.writeAndBroadcast(
      result.run.thread_id,
      ThreadEventType.RunCancelled,
      ActorType.System,
      null,
      {
        run_id: runId,
        issue_id: result.run.issue_id,
        thread_id: result.run.thread_id,
        workspace_id: result.run.workspace_id,
        status: RS.Cancelled,
        reason,
      },
    );

    this.workspaceLockService.releaseByRunId(runId);
    return result.run;
  }

  startNextQueuedRun(workspaceId: string): Run | null {
    const queuedRuns = this.runRepo.listQueuedByWorkspace(workspaceId);

    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) {
        continue;
      }

      if (issue.status === IS.Blocked) {
        const cancelResult = this.runRepo.transitionStatus(run.id, RS.Queued, RS.Cancelled, {});
        if (cancelResult.success && cancelResult.run) {
          this.threadEventService.writeAndBroadcast(
            cancelResult.run.thread_id,
            ThreadEventType.RunCancelled,
            ActorType.System,
            null,
            { run_id: run.id, issue_id: run.issue_id, thread_id: run.thread_id, workspace_id: run.workspace_id, status: RS.Cancelled, reason: "issue_blocked_before_start" },
          );
        }
        continue;
      }

      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) {
        return null;
      }

      const startedRun = this.transitionToRunning(run.id);
      if (startedRun) {
        return startedRun;
      }
      this.workspaceLockService.releaseByRunId(run.id);
    }

    return null;
  }
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === RS.Completed || status === RS.Failed || status === RS.Interrupted || status === RS.Cancelled;
}
