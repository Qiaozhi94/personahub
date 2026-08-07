import type Database from "better-sqlite3";
import type { Run, ThreadEvent } from "@personahub/shared/types";
import { IssueStatus as IS, RunStatus as RS, NodeRunStatus, GraphRunStatus, ThreadEventType, ActorType } from "@personahub/shared/types";
import type { NodeRunRepository } from "../../repositories/node-run.js";
import type { GraphRunRepository } from "../../repositories/graph-run.js";
import type { RunRepository } from "../../repositories/run.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { ThreadEventService } from "../thread-event.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { ProjectRepository } from "../../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../../repositories/adapter-workspace-status.js";
import { tryFinalizeCancellingGraph } from "./cancelling-finalizer.js";
import { getDefinition } from "../../runtime/graph/definitions.js";
import { evaluateJoinAndTrigger } from "./workflow.js";
import { parseNodeResult } from "./result-parser.js";
import type { GraphWorkflowDeps } from "./workflow.js";

/**
 * Shared by RunDispatchService (real-time dispatch path) and
 * GraphRecoveryService (startup reconciliation, design.md §7 steps 6/7) —
 * a Run terminating for a graph node must always go through this exact
 * sequence, whether it's observed live or replayed after a restart.
 */
export interface NodeCompletionDeps {
  nodeRunRepo: NodeRunRepository;
  graphRunRepo: GraphRunRepository;
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  threadEventService: ThreadEventService;
  threadEventRepo: ThreadEventRepository;
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  db: Database.Database;
}

/** design.md §7 "事务一": terminalize the NodeRun for a just-finished Attempt,
 *  then (on success) re-evaluate downstream joins and try to finalize the
 *  graph — mirrors the original RunDispatchService.handleGraphNodeCompletion. */
export function processGraphNodeCompletion(deps: NodeCompletionDeps, run: Run): void {
  const nodeRunId = run.node_run_id;
  if (!nodeRunId) return;

  const nodeRun = deps.nodeRunRepo.getById(nodeRunId);
  if (!nodeRun) return;

  const graphRun = deps.graphRunRepo.getById(nodeRun.graph_run_id);
  if (!graphRun) return;

  if (nodeRun.status !== NodeRunStatus.Running) return;

  if (run.status !== RS.Completed) {
    if (run.status === RS.Cancelled) {
      deps.nodeRunRepo.compareAndSetStatus(nodeRun.id, NodeRunStatus.Running, NodeRunStatus.Cancelled);
      tryFinalizeCancellingGraph(
        { graphRunRepo: deps.graphRunRepo, nodeRunRepo: deps.nodeRunRepo, issueRepo: deps.issueRepo, threadEventService: deps.threadEventService, db: deps.db },
        graphRun.id,
      );
      return;
    }

    deps.nodeRunRepo.compareAndSetStatus(nodeRun.id, NodeRunStatus.Running, NodeRunStatus.Failed);
    const blocked = deps.graphRunRepo.compareAndSetStatus(
      graphRun.id,
      GraphRunStatus.Running,
      GraphRunStatus.Blocked,
      { blocked_reason_code: "node_run_failed" as never, blocked_node_keys: [nodeRun.node_key] },
    );
    if (blocked.success) {
      const blockedEvent = deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphBlocked, ActorType.System, null, {
        graph_run_id: graphRun.id,
        blocked_reason_code: "node_run_failed",
        blocked_node_keys: [nodeRun.node_key],
      });
      deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IS.Running, IS.Blocked);
      deps.threadEventService.broadcast(blockedEvent);
    }
    return;
  }

  const finalMessage = deps.runRepo.getFinalMessage(run.id);
  const parsed = parseNodeResult(finalMessage, nodeRun.node_key);

  if (parsed.status !== "ok") {
    deps.nodeRunRepo.compareAndSetStatus(nodeRun.id, NodeRunStatus.Running, NodeRunStatus.Failed);
    if (parsed.blockReason) {
      deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked, {
        blocked_reason_code: parsed.blockReason as never,
        blocked_node_keys: [nodeRun.node_key],
      });
      deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IS.Running, IS.Blocked);
      const blockedEvent = deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphBlocked, ActorType.System, null, {
        graph_run_id: graphRun.id, blocked_reason_code: parsed.blockReason, blocked_node_keys: [nodeRun.node_key],
      });
      deps.threadEventService.broadcast(blockedEvent);
    }
    return;
  }

  const pendingBroadcasts: ThreadEvent[] = [];

  try {
    deps.db.transaction(() => {
      const fresh = deps.nodeRunRepo.getById(nodeRunId);
      if (!fresh || fresh.status !== NodeRunStatus.Running) return;

      const resultEvent = deps.threadEventService.write(
        graphRun.thread_id,
        ThreadEventType.GraphNodeResult,
        ActorType.System,
        null,
        { ...parsed.payload, node_key: nodeRun.node_key },
      );

      const moved = deps.nodeRunRepo.compareAndSetStatus(fresh.id, NodeRunStatus.Running, NodeRunStatus.Completed, {
        result_event_id: resultEvent.id,
      });
      if (!moved.success) return;

      const attempts = deps.runRepo.listByIssue(graphRun.issue_id).filter((r) => r.node_run_id === nodeRun.id).length;
      const completedEvent = deps.threadEventService.write(
        graphRun.thread_id,
        ThreadEventType.GraphNodeCompleted,
        ActorType.System,
        null,
        { node_key: nodeRun.node_key, status: NodeRunStatus.Completed, attempt_count: attempts, result_event_id: resultEvent.id },
      );

      pendingBroadcasts.push(resultEvent, completedEvent);
    })();
  } catch {
    return;
  }

  for (const event of pendingBroadcasts) {
    deps.threadEventService.broadcast(event);
  }

  const freshNodeRun = deps.nodeRunRepo.getById(nodeRunId);
  if (!freshNodeRun) return;

  reevaluateOutgoingJoins(deps, graphRun.id, freshNodeRun.node_key);
  tryFinalizeGraphRun(deps, graphRun.id);
}

/** design.md §7 "事务二", replayable: re-run join evaluation for a specific
 *  completed node's outgoing edges. Idempotent (evaluateJoinAndTrigger's own
 *  CAS/status guards no-op if already evaluated) — safe to call for a node
 *  that just completed live, or for any already-Completed node during
 *  startup reconciliation (design §7 steps 3/4/6: "join 已满足但节点仍
 *  pending" and "NodeRun 已终态但其出边从未评估过" are the same replay). */
export function reevaluateOutgoingJoins(deps: NodeCompletionDeps, graphRunId: string, completedNodeKey: string): void {
  const graphRun = deps.graphRunRepo.getById(graphRunId);
  if (!graphRun) return;
  const nodeRun = deps.nodeRunRepo.getByGraphRunAndKey(graphRunId, completedNodeKey);
  if (!nodeRun || nodeRun.status !== NodeRunStatus.Completed) return;

  const workflowDeps: GraphWorkflowDeps = {
    graphRunRepo: deps.graphRunRepo,
    nodeRunRepo: deps.nodeRunRepo,
    runRepo: deps.runRepo,
    issueRepo: deps.issueRepo,
    threadEventService: deps.threadEventService,
    adapterDeps: {
      agentConfigRepo: deps.agentConfigRepo,
      projectRepo: deps.projectRepo,
      adapterWorkspaceStatusRepo: deps.adapterWorkspaceStatusRepo,
    },
    threadEventRepo: deps.threadEventRepo,
    db: deps.db,
  };

  const events = evaluateJoinAndTrigger(workflowDeps, graphRun, nodeRun, []);
  if (events) {
    for (const event of events) {
      deps.threadEventService.broadcast(event);
    }
  }
}

/**
 * A cancelled precursor node can make a still-non-terminal downstream
 * node's join permanently unsatisfiable. If that's the case here, block
 * the graph immediately (blocked_reason_code: node_run_cancelled) instead
 * of relying on tryFinalizeGraphRun()'s allTerminal gate, which would never
 * fire on its own (the downstream node stays pending forever). Returns
 * true if the graph was blocked by this call.
 */
export function blockGraphOnCancelledPrecursor(deps: NodeCompletionDeps, graphRunId: string, cancelledNodeKey: string): boolean {
  const graphRun = deps.graphRunRepo.getById(graphRunId);
  if (!graphRun || graphRun.status !== GraphRunStatus.Running) return false;

  const definition = getDefinition(graphRun.definition_id, graphRun.definition_version);
  if (!definition) return false;

  const nodeRuns = deps.nodeRunRepo.listByGraphRun(graphRunId);
  const nodeRunByKey = new Map(nodeRuns.map((nr) => [nr.node_key, nr]));

  const strandsNonTerminalDownstream = definition.edges.some((edge) => {
    if (edge.from !== cancelledNodeKey) return false;
    const downstream = nodeRunByKey.get(edge.to);
    return (
      downstream !== undefined &&
      ![NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Cancelled].includes(downstream.status as NodeRunStatus)
    );
  });
  if (!strandsNonTerminalDownstream) return false;

  const blocked = deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked, {
    blocked_reason_code: "node_run_cancelled" as never,
    blocked_node_keys: [cancelledNodeKey],
  });
  if (blocked.success) {
    const blockedEvent = deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphBlocked, ActorType.System, null, {
      graph_run_id: graphRun.id,
      blocked_reason_code: "node_run_cancelled",
      blocked_node_keys: [cancelledNodeKey],
    });
    deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IS.Running, IS.Blocked);
    deps.threadEventService.broadcast(blockedEvent);
  }
  return blocked.success;
}

/** design.md §7 "事务三", replayable: once every NodeRun is terminal, either
 *  finalize the graph as completed or block it — mirrors the original
 *  RunDispatchService.tryFinalizeGraph. Idempotent via the GraphRun CAS. */
export function tryFinalizeGraphRun(deps: NodeCompletionDeps, graphRunId: string): void {
  const graphRun = deps.graphRunRepo.getById(graphRunId);
  if (!graphRun || graphRun.status !== GraphRunStatus.Running) return;

  const nodeRuns = deps.nodeRunRepo.listByGraphRun(graphRunId);
  const allTerminal = nodeRuns.every((nr) =>
    [NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Cancelled].includes(nr.status as NodeRunStatus),
  );
  if (!allTerminal) return;

  const pendingBroadcasts: ThreadEvent[] = [];

  deps.db.transaction(() => {
    const anyFailed = nodeRuns.some((nr) =>
      [NodeRunStatus.Failed, NodeRunStatus.Cancelled, NodeRunStatus.Interrupted].includes(nr.status as NodeRunStatus),
    );
    if (anyFailed) {
      deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked, {
        blocked_reason_code: "node_run_failed" as never,
        blocked_node_keys: nodeRuns.filter((n) => n.status !== NodeRunStatus.Completed).map((n) => n.node_key),
      });
      deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IS.Running, IS.Blocked);
      const blockedEvent = deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphBlocked, ActorType.System, null, {
        graph_run_id: graphRun.id,
        blocked_reason_code: "node_run_failed",
        blocked_node_keys: nodeRuns.filter((n) => n.status !== NodeRunStatus.Completed).map((n) => n.node_key),
      });
      pendingBroadcasts.push(blockedEvent);
      return;
    }

    const moved = deps.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Running, GraphRunStatus.Completed);
    if (moved.success) {
      deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IS.Running, IS.Ready);
      const terminalEvent = deps.threadEventService.write(graphRun.thread_id, ThreadEventType.GraphTerminal, ActorType.System, null, {
        graph_run_id: graphRun.id, status: "completed", node_summary: nodeRuns.map((n) => ({ node_key: n.node_key, status: n.status })),
      });
      pendingBroadcasts.push(terminalEvent);
    }
  })();

  for (const event of pendingBroadcasts) {
    deps.threadEventService.broadcast(event);
  }
}
