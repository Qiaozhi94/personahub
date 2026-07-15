import type { RunStatus } from "@personahub/shared/types";
import { RunStatus as RS, FailureReason as FR, ThreadEventType, ActorType } from "@personahub/shared/types";
import type { RunRepository } from "../repositories/run.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { ThreadEventService } from "./thread-event.js";
import type { WorkspaceLockService } from "./workspace-lock.js";

export class StaleRecoveryService {
  constructor(
    private runRepo: RunRepository,
    private workspaceRepo: WorkspaceRepository,
    private threadEventService: ThreadEventService,
    private workspaceLockService: WorkspaceLockService,
  ) {}

  recoverStaleRuns(): void {
    const runningRuns = this.runRepo.listRunning();

    for (const run of runningRuns) {
      const result = this.runRepo.transitionStatus(
        run.id,
        RS.Running,
        RS.Interrupted,
        {
          completed_at: new Date().toISOString(),
          failure_reason: FR.ServerRestarted,
        },
      );

      if (result.success && result.run) {
        this.threadEventService.writeAndBroadcast(
          result.run.thread_id,
          ThreadEventType.RunInterrupted,
          ActorType.System,
          null,
          { run_id: run.id, issue_id: result.run.issue_id, thread_id: result.run.thread_id, workspace_id: result.run.workspace_id, status: RS.Interrupted, failure_reason: FR.ServerRestarted },
        );

        this.workspaceLockService.releaseByRunId(run.id);
      }
    }
  }

  cleanupStaleLocks(): void {
    const lockedWorkspaces = this.workspaceRepo.listLockedWorkspaces();

    for (const workspace of lockedWorkspaces) {
      if (!workspace.locked_by_run_id) {
        this.workspaceLockService.release(workspace.id);
        continue;
      }

      const run = this.runRepo.getById(workspace.locked_by_run_id);
      if (!run) {
        this.workspaceLockService.release(workspace.id);
        continue;
      }

      if (isTerminalStatus(run.status)) {
        this.workspaceLockService.release(workspace.id);
      }
    }
  }

  runAll(): void {
    this.recoverStaleRuns();
    this.cleanupStaleLocks();
  }
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === RS.Completed || status === RS.Failed || status === RS.Interrupted || status === RS.Cancelled;
}
