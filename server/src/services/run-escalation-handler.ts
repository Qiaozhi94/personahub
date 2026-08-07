import type Database from "better-sqlite3";
import type { ThreadEvent } from "@personahub/shared/types";
import { ActorType, IssueStatus as IS, RunStatus as RS, RunRole, ThreadEventType } from "@personahub/shared/types";
import type { EscalationParams } from "../runtime/agent-runner.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { RunService } from "./run.js";
import type { ThreadEventService } from "./thread-event.js";

export class RunEscalationHandler {
  constructor(
    private runService: RunService,
    private issueRepo: IssueRepository,
    private threadEventService: ThreadEventService,
    private db: Database.Database,
    private finalizeAndDrain: (runId: string, workspaceId: string) => Promise<void>,
  ) {}

  handle(params: EscalationParams): void {
    const escalationRun = this.runService.get(params.runId);
    const issue = this.issueRepo.getById(params.issueId);
    const previousStatus = issue?.status ?? "Running";
    const pendingBroadcasts: ThreadEvent[] = [];

    this.db.transaction(() => {
      pendingBroadcasts.push(
        this.threadEventService.write(params.threadId, ThreadEventType.EscalationTriggered, ActorType.System, null, {
          run_id: params.runId,
          issue_id: params.issueId,
          thread_id: params.threadId,
          workspace_id: escalationRun.workspace_id,
          status: "failed",
          reason: "dangerous_git_operation",
          detected_operation: params.detectedOperation,
          blocked_by: params.blockedBy,
          pre_execution_blocked: params.blockedBy !== "post_hoc_detection",
          capability_note: capabilityNote(params.blockedBy),
          purpose: escalationRun.purpose,
          role: escalationRun.role,
        }),
      );

      const failedResult = this.runService.transitionToFailedWriteOnly(
        params.runId,
        params.failureReason,
        null,
        params.detectedOperation,
      );
      if (failedResult) pendingBroadcasts.push(failedResult.event);

      this.issueRepo.updateStatus(params.issueId, {
        status: IS.Blocked,
        updatedAt: new Date().toISOString(),
      });
      pendingBroadcasts.push(
        this.threadEventService.write(params.threadId, ThreadEventType.IssueBlocked, ActorType.System, null, {
          issue_id: params.issueId,
          run_id: params.runId,
          thread_id: params.threadId,
          previous_status: previousStatus,
          status: "Blocked",
          reason: "dangerous_git_operation",
          blocked_by: params.blockedBy,
        }),
      );
    })();

    for (const event of pendingBroadcasts) this.threadEventService.broadcast(event);
    this.cancelQueuedRunsForIssue(params.issueId);
    void this.finalizeAndDrain(params.runId, escalationRun.workspace_id);
  }

  private cancelQueuedRunsForIssue(issueId: string): void {
    for (const run of this.runService.listByIssue(issueId)) {
      if (run.status === RS.Queued && run.role !== RunRole.GraphNode) {
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
      }
    }
  }
}

function capabilityNote(blockedBy: EscalationParams["blockedBy"]): string {
  if (blockedBy === "credential_isolation") {
    return "Push failed: no push credentials provisioned for this workspace.";
  }
  if (blockedBy === "pre_execution_approval") {
    return "Push blocked by pre-execution approval - command was rejected before execution.";
  }
  return "Push detected after execution - this is post-hoc detection, not pre-execution blocking.";
}
