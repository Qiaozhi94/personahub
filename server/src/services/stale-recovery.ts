import type { RunStatus } from "@personahub/shared/types";
import { RunStatus as RS, FailureReason as FR, ThreadEventType, ActorType, BaselineStatus } from "@personahub/shared/types";
import type { RunRepository } from "../repositories/run.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { ThreadEventService } from "./thread-event.js";
import type { WorkspaceLockService } from "./workspace-lock.js";
import type { DevelopmentTraceService } from "./development-trace.js";
import type { RunTraceRepository } from "../repositories/run-trace.js";
import { SCAN_REASON_CODES } from "../runtime/trace/constants.js";

export class StaleRecoveryService {
  constructor(
    private runRepo: RunRepository,
    private workspaceRepo: WorkspaceRepository,
    private threadEventService: ThreadEventService,
    private workspaceLockService: WorkspaceLockService,
    private developmentTraceService?: DevelopmentTraceService,
    private runTraceRepo?: RunTraceRepository,
  ) {}

  async runAll(): Promise<void> {
    await this.recoverStaleRuns();
    await this.recoverTerminalUnfinalized();
    this.cleanupStaleLocks();
  }

  async recoverStaleRuns(): Promise<void> {
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

        const workspace = this.workspaceRepo.getById(run.workspace_id);
        const ownsWorkspace = workspace?.locked_by_run_id === run.id;

        if (ownsWorkspace) {
          try {
            this.developmentTraceService?.finalizeRun(run.id);
          } catch {
            // finalization failure during recovery is non-fatal
          }
          this.workspaceLockService.releaseByRunId(run.id);
        } else {
          this.developmentTraceService?.finalizeRunWithoutWorkspace(
            run.id,
            SCAN_REASON_CODES.workspaceOwnershipLost,
          );
        }
      }
    }
  }

  async recoverTerminalUnfinalized(): Promise<void> {
    if (!this.runTraceRepo) return;
    const unfinalized = this.runTraceRepo.listTerminalUnfinalized();

    for (const state of unfinalized) {
      const workspace = this.workspaceRepo.listLockedWorkspaces().find(
        (w) => w.locked_by_run_id === state.run_id,
      );

      if (workspace && workspace.locked_by_run_id === state.run_id) {
        try {
          this.developmentTraceService?.finalizeRun(state.run_id);
        } catch {
          // finalization failure during recovery is non-fatal
        }
        this.workspaceLockService.releaseByRunId(state.run_id);
      } else {
        this.developmentTraceService?.finalizeRunWithoutWorkspace(
          state.run_id,
          SCAN_REASON_CODES.workspaceOwnershipLost,
        );
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
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === RS.Completed || status === RS.Failed || status === RS.Interrupted || status === RS.Cancelled;
}
