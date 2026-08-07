import type Database from "better-sqlite3";
import type { Run } from "@personahub/shared/types";
import type { GraphRunRepository } from "../repositories/graph-run.js";
import type { NodeRunRepository } from "../repositories/node-run.js";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { ThreadEventService } from "./thread-event.js";
import { GraphRunStatus, NodeRunStatus, RunStatus, ThreadEventType, ActorType } from "@personahub/shared/types";
import { tryFinalizeCancellingGraph } from "./graph/cancelling-finalizer.js";
import {
  processGraphNodeCompletion,
  reevaluateOutgoingJoins,
  tryFinalizeGraphRun,
  type NodeCompletionDeps,
} from "./graph/node-completion.js";
import { getDefinition } from "../runtime/graph/definitions.js";

export interface GraphRecoveryDeps {
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  threadEventService: ThreadEventService;
  threadEventRepo: ThreadEventRepository;
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  db: Database.Database;
}

export interface RecoveryResult {
  pendingEvents: ReturnType<ThreadEventService["write"]>[];
  workspaceIdsToDrain: string[];
}

/** "Done, nothing more will ever happen to this node without a user-
 *  triggered retry" — matches tryFinalizeGraphRun's own terminal set.
 *  Deliberately excludes `interrupted`: an interrupted node is paused, not
 *  resolved, and step 5 below must still see it as something blocking
 *  progress. */
const DONE_NODE_STATUSES: readonly NodeRunStatus[] = [
  NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Cancelled,
];
/** Attempt statuses step 7 may replay transaction one from. Deliberately
 *  excludes `interrupted` — that's step 1's own signal (the Attempt was
 *  paused by a restart, not finished), and processGraphNodeCompletion has
 *  no way to tell "interrupted by restart" apart from "genuinely failed"
 *  once replayed, which would lose the NodeRun `interrupted` state that
 *  retry's acceptance set specifically depends on. */
const REPLAYABLE_RUN_STATUSES: readonly RunStatus[] = [
  RunStatus.Completed, RunStatus.Failed, RunStatus.Cancelled,
];

export class GraphRecoveryService {
  constructor(private deps: GraphRecoveryDeps) {}

  /** design.md §7 restart reconciliation. Runs once at startup, before the
   *  HTTP server accepts traffic (see index.ts) — same timing guarantee
   *  StaleRecoveryService/ValidationRecoveryService already rely on, which
   *  is why the shared node-completion.ts helpers can broadcast directly:
   *  there are no SSE listeners yet to receive a phantom event. */
  async reconcile(): Promise<RecoveryResult> {
    const pendingEvents: RecoveryResult["pendingEvents"] = [];
    const workspaceIds = new Set<string>();

    const nonTerminalGraphs = this.deps.graphRunRepo.listNonTerminal();

    for (const graphRun of nonTerminalGraphs) {
      if (graphRun.status === GraphRunStatus.Cancelling) {
        this.handleCancellingGraph(graphRun, pendingEvents, workspaceIds);
        continue;
      }

      // Step 0 (must run first — steps 3/4/6 all need the definition to
      // evaluate edges/joins, so a missing definition has to be caught
      // before any of them can throw): exact (id, version) lookup, never
      // fall back to the latest version.
      const definition = getDefinition(graphRun.definition_id, graphRun.definition_version);
      if (!definition) {
        if (graphRun.status === GraphRunStatus.Running) {
          const blocked = this.deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked, {
            blocked_reason_code: "definition_version_unavailable" as never,
            blocked_node_keys: [],
          });
          if (blocked.success) {
            const event = this.deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphBlocked, ActorType.System, null, {
              graph_run_id: graphRun.id, blocked_reason_code: "definition_version_unavailable", blocked_node_keys: [],
            });
            pendingEvents.push(event);
            this.deps.issueRepo.compareAndSetStatus(graphRun.issue_id, "Running" as never, "Blocked" as never);
          }
        }
        // Skip every remaining step for this graph — none of them can be
        // evaluated without the definition, and re-blocking it every scan
        // would just thrash the same CAS.
        continue;
      }

      // `definition_version_unavailable` is the one blocker recovery is
      // allowed to clear on its own (design.md §7: "自动重评仅限确定性的、
      // 与用户意图无关的 blocker") — every other blocked_reason_code needs
      // an explicit user action (retry / resolve-executors / cancel).
      if (graphRun.status === GraphRunStatus.Blocked) {
        if (graphRun.blocked_reason_code !== "definition_version_unavailable") continue;
        const unblocked = this.deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Blocked, GraphRunStatus.Running, {
          blocked_reason_code: null, blocked_node_keys: null,
        });
        if (!unblocked.success) continue;
        this.deps.issueRepo.compareAndSetStatus(graphRun.issue_id, "Blocked" as never, "Running" as never);
      }

      const completionDeps = this.completionDeps();

      // Step 1: Run-layer interrupted marking already happened in
      // StaleRecoveryService.runAll() (invoked before this service, see
      // index.ts) — sync the corresponding NodeRun here, not redo it. Only
      // the Attempt's own `interrupted` status counts: a NodeRun stuck at
      // `running` whose latest Attempt actually finished (Completed/Failed/
      // Cancelled) is step 7's target, not this one — conflating the two
      // would replay a successfully-finished Attempt as if the server had
      // crashed mid-run and lose its result.
      const issueRuns = this.deps.runRepo.listByIssue(graphRun.issue_id);
      const latestAttemptByNodeRun = new Map<string, Run>();
      for (const nodeRun of this.deps.nodeRunRepo.listByGraphRun(graphRun.id)) {
        if (nodeRun.status !== NodeRunStatus.Running) continue;
        const attempts = issueRuns.filter((r) => r.node_run_id === nodeRun.id);
        const latestAttempt = attempts.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (!latestAttempt) continue;
        latestAttemptByNodeRun.set(nodeRun.id, latestAttempt);
        if (latestAttempt.status === RunStatus.Interrupted) {
          this.deps.nodeRunRepo.compareAndSetStatus(nodeRun.id, NodeRunStatus.Running, NodeRunStatus.Interrupted);
        }
      }

      // Step 7: the Attempt (Run) already reached a terminal status but its
      // NodeRun is still `running` — transaction one itself never completed
      // (crash between the Run's own terminal write and the workflow hook).
      // Replay it idempotently through the exact same path a live
      // completion takes.
      for (const nodeRun of this.deps.nodeRunRepo.listByGraphRun(graphRun.id)) {
        if (nodeRun.status !== NodeRunStatus.Running) continue;
        const latestAttempt = latestAttemptByNodeRun.get(nodeRun.id);
        if (latestAttempt && REPLAYABLE_RUN_STATUSES.includes(latestAttempt.status)) {
          processGraphNodeCompletion(completionDeps, latestAttempt);
        }
      }

      // Steps 3/4/6: re-run join evaluation for every already-Completed
      // node. evaluateJoinAndTrigger() (inside reevaluateOutgoingJoins) is
      // idempotent — a join that was already satisfied and already has an
      // Attempt just no-ops via its own CAS guard, so calling this
      // unconditionally on every reconcile is safe and covers both "join
      // became satisfied but the synthesis Attempt was never created" and
      // "the edge was never marked traversed" in one pass.
      for (const nodeRun of this.deps.nodeRunRepo.listByGraphRun(graphRun.id)) {
        if (nodeRun.status === NodeRunStatus.Completed) {
          reevaluateOutgoingJoins(completionDeps, graphRun.id, nodeRun.node_key);
        }
      }

      // Step 8: every node terminal but the graph itself never got
      // finalized (crash inside/after transaction two, before three).
      tryFinalizeGraphRun(completionDeps, graphRun.id);

      // Step 5: nothing above moved this graph forward, it's still
      // `running`, and no node is positioned to make further progress on
      // its own (nothing `ready`/`running`) while at least one node is
      // still non-terminal — that combination has no path out of the loop
      // it's currently in, so make it visible instead of a silent stall.
      const freshGraphRun = this.deps.graphRunRepo.getById(graphRun.id);
      if (freshGraphRun && freshGraphRun.status === GraphRunStatus.Running) {
        const freshNodes = this.deps.nodeRunRepo.listByGraphRun(graphRun.id);
        const anyNonTerminal = freshNodes.some((n) => !DONE_NODE_STATUSES.includes(n.status as NodeRunStatus));
        const anyContinuable = freshNodes.some((n) => n.status === NodeRunStatus.Ready || n.status === NodeRunStatus.Running);
        if (anyNonTerminal && !anyContinuable) {
          const stuckKeys = freshNodes.filter((n) => !DONE_NODE_STATUSES.includes(n.status as NodeRunStatus)).map((n) => n.node_key);
          const blocked = this.deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked, {
            blocked_reason_code: "recovery_inconsistent" as never,
            blocked_node_keys: stuckKeys,
          });
          if (blocked.success) {
            const event = this.deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphBlocked, ActorType.System, null, {
              graph_run_id: graphRun.id, blocked_reason_code: "recovery_inconsistent", blocked_node_keys: stuckKeys,
            });
            pendingEvents.push(event);
            this.deps.issueRepo.compareAndSetStatus(graphRun.issue_id, "Running" as never, "Blocked" as never);
          }
        }
      }

      workspaceIds.add(graphRun.workspace_id);
    }

    return { pendingEvents, workspaceIdsToDrain: [...workspaceIds] };
  }

  private completionDeps(): NodeCompletionDeps {
    return {
      nodeRunRepo: this.deps.nodeRunRepo,
      graphRunRepo: this.deps.graphRunRepo,
      runRepo: this.deps.runRepo,
      issueRepo: this.deps.issueRepo,
      threadEventService: this.deps.threadEventService,
      threadEventRepo: this.deps.threadEventRepo,
      agentConfigRepo: this.deps.agentConfigRepo,
      projectRepo: this.deps.projectRepo,
      adapterWorkspaceStatusRepo: this.deps.adapterWorkspaceStatusRepo,
      db: this.deps.db,
    };
  }

  private handleCancellingGraph(
    graphRun: ReturnType<GraphRunRepository["getById"]>,
    _events: RecoveryResult["pendingEvents"],
    workspaceIds: Set<string>,
  ): void {
    if (!graphRun) return;
    const nodeRuns = this.deps.nodeRunRepo.listByGraphRun(graphRun.id);
    const allTerminal = nodeRuns.every((nr) =>
      [NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Interrupted, NodeRunStatus.Cancelled].includes(nr.status as NodeRunStatus),
    );

    for (const nr of nodeRuns) {
      if (nr.status === NodeRunStatus.Running) {
        const runs = this.deps.runRepo.listByIssue(graphRun.issue_id)
          .filter((r) => r.node_run_id === nr.id && r.status === RunStatus.Running);
        if (runs.length === 0) {
          this.deps.nodeRunRepo.compareAndSetStatus(nr.id, NodeRunStatus.Running, NodeRunStatus.Cancelled);
        }
      } else if (nr.status === NodeRunStatus.Ready || nr.status === NodeRunStatus.Pending) {
        this.deps.nodeRunRepo.compareAndSetStatus(nr.id, nr.status, NodeRunStatus.Cancelled);
        const queuedRuns = this.deps.runRepo.listByIssue(graphRun.issue_id)
          .filter((r) => r.node_run_id === nr.id && r.status === RunStatus.Queued);
        for (const qr of queuedRuns) {
          this.deps.runRepo.transitionStatus(qr.id, RunStatus.Queued, RunStatus.Cancelled, {});
        }
      }
    }

    if (allTerminal) {
      tryFinalizeCancellingGraph(
        { graphRunRepo: this.deps.graphRunRepo, nodeRunRepo: this.deps.nodeRunRepo, issueRepo: this.deps.issueRepo, threadEventService: this.deps.threadEventService, db: this.deps.db },
        graphRun.id,
      );
    }
    workspaceIds.add(graphRun.workspace_id);
  }
}
