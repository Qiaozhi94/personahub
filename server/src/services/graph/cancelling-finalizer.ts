import type Database from "better-sqlite3";
import type { GraphRunRepository } from "../../repositories/graph-run.js";
import type { NodeRunRepository } from "../../repositories/node-run.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { ThreadEventService } from "../thread-event.js";
import type { ThreadEvent } from "@personahub/shared/types";
import { GraphRunStatus, NodeRunStatus, IssueStatus, ThreadEventType, ActorType } from "@personahub/shared/types";

export interface CancellingFinalizerDeps {
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  issueRepo: IssueRepository;
  threadEventService: ThreadEventService;
  db: Database.Database;
}

export function tryFinalizeCancellingGraph(deps: CancellingFinalizerDeps, graphRunId: string): void {
  const graphRun = deps.graphRunRepo.getById(graphRunId);
  if (!graphRun || graphRun.status !== GraphRunStatus.Cancelling) return;

  const nodeRuns = deps.nodeRunRepo.listByGraphRun(graphRunId);
  const allTerminal = nodeRuns.every((nr) =>
    [NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Interrupted, NodeRunStatus.Cancelled].includes(nr.status as NodeRunStatus),
  );
  if (!allTerminal) return;

  const pendingBroadcasts: ThreadEvent[] = [];

  deps.db.transaction(() => {
    const moved = deps.graphRunRepo.compareAndSetStatus(
      graphRun.id,
      GraphRunStatus.Cancelling,
      GraphRunStatus.Cancelled,
    );

    if (moved.success) {
      deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IssueStatus.Running, IssueStatus.Ready);

      const terminalEvent = deps.threadEventService.write(
        graphRun.thread_id,
        ThreadEventType.GraphTerminal,
        ActorType.System,
        null,
        {
          graph_run_id: graphRun.id,
          status: "cancelled",
          node_summary: nodeRuns.map((n) => ({ node_key: n.node_key, status: n.status })),
        },
      );
      pendingBroadcasts.push(terminalEvent);
    }
  })();

  for (const event of pendingBroadcasts) {
    deps.threadEventService.broadcast(event);
  }
}
