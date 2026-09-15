import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { GraphRunRepository } from "../../repositories/graph-run.js";
import type { NodeRunRepository } from "../../repositories/node-run.js";
import type { RunRepository } from "../../repositories/run.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { WorkspaceRepository } from "../../repositories/workspace.js";
import type { ThreadRepository } from "../../repositories/thread.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
import type { ProjectRepository } from "../../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../../repositories/adapter-workspace-status.js";
import { AppError, parseRequestBody } from "../errors.js";
import { z } from "zod";
import { ErrorCode } from "@personahub/shared/errors";
import type { GraphRuntimeService } from "../../services/graph-runtime.js";
import type { SessionService } from "../../services/session-service.js";
import type { EligibilityEvaluator } from "../../services/eligibility-evaluator.js";
import type { DispatchService } from "../../services/dispatch-service.js";
import { getDefinition } from "../../runtime/graph/definitions.js";

import type { ThreadEvent } from "@personahub/shared/types";
import type { ThreadEventService } from "../../services/thread-event.js";
import type { RunDispatchService } from "../../services/run-dispatch.js";
import {
  RunStatus,
  ThreadEventType,
  ActorType,
  NodeRunStatus,
  IssueStatus,
  GraphRunStatus,
  DispatchPurpose,
  ContextScope,
  type ExecutionIdentity,
} from "@personahub/shared/types";
import { buildEvidenceRef } from "../../evidence-ref.js";
import { requireLegacyWorkspaceId, requireLegacyProjectId } from "../../services/legacy-issue-fields.js";

interface GraphRouteDeps {
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  workspaceRepo: WorkspaceRepository;
  threadRepo: ThreadRepository;
  threadEventRepo: ThreadEventRepository;
  threadEventService: ThreadEventService;
  runDispatchService: RunDispatchService;
  graphRuntimeService: GraphRuntimeService;
  sessionService: SessionService;
  eligibilityEvaluator: EligibilityEvaluator;
  dispatchService: DispatchService;
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  db: Database.Database;
}

/** Latest `graph.edge_traversed` event per (from,to) pair — a retried
 *  precursor could in principle produce a second traversal, so this
 *  always keeps the most recent one (events arrive in ascending order). */
function indexEdgeEvents(
  events: ReturnType<ThreadEventRepository["listByThreadAndTypes"]>,
): Map<string, (typeof events)[number]> {
  const byEdge = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const payload = event.payload_json as { from_node_key?: string; to_node_key?: string };
    if (!payload.from_node_key || !payload.to_node_key) continue;
    byEdge.set(`${payload.from_node_key}->${payload.to_node_key}`, event);
  }
  return byEdge;
}

/** design §2.1: one node execution is one Dispatch. The scheduler never
 *  creates a Run itself — it asks DispatchService for one, with the node's
 *  execution identity resolved by EligibilityEvaluator. */
async function dispatchGraphNode(
  deps: GraphRouteDeps,
  graphRunId: string,
  nodeRunId: string,
  adapterId: string,
  issueId: string,
  attemptIndex: number,
  actor: string,
): Promise<string | null> {
  const roomId = deps.sessionService.ensureRoomForIssue(issueId).id;
  const eligibility = deps.eligibilityEvaluator.evaluate({
    roomId,
    purpose: DispatchPurpose.Execute,
    skillRefs: [],
    contextScope: ContextScope.All,
  });
  const candidate = eligibility.candidates.find(
    (entry) => entry.identity.adapter_config_id === adapterId && entry.tier !== "blocked",
  );
  if (!candidate) {
    throw new AppError(ErrorCode.NO_CAPABLE_ADAPTER, `Adapter '${adapterId}' has no eligible identity for this node.`);
  }
  const identity: ExecutionIdentity = candidate.identity;
  const outcome = await deps.dispatchService.confirmGraphNode(
    {
      roomId,
      clientRequestId: `graph:${graphRunId}:${nodeRunId}:${attemptIndex}`,
      purpose: DispatchPurpose.Execute,
      identity,
      identitySnapshotJson: JSON.stringify({
        adapter_config_id: identity.adapter_config_id,
        runtime_id: identity.runtime_id,
      }),
      contextScope: ContextScope.All,
      skillRevisionRefs: [],
      effectiveRequirementsJson: JSON.stringify(eligibility.requirements.items),
      effectiveRequirementsHash: eligibility.requirements.hash,
      handoffRefs: [],
      taskScopeJson: null,
      requirementOverride: null,
      actor,
      graphNodeRunId: nodeRunId,
    },
    actor,
  );
  return outcome.runId;
}

function projectGraphRun(
  gr: NonNullable<ReturnType<GraphRunRepository["getById"]>>,
  nodeRuns: ReturnType<NodeRunRepository["listByGraphRun"]>,
  runsByNode: Map<string, ReturnType<RunRepository["listByIssue"]>>,
  edgeEvents: ReturnType<ThreadEventRepository["listByThreadAndTypes"]>,
) {
  const definition = getDefinition(gr.definition_id, gr.definition_version);
  const edgeEventByPair = indexEdgeEvents(edgeEvents);
  const edges =
    definition?.edges.map((e) => {
      const event = edgeEventByPair.get(`${e.from}->${e.to}`);
      const payload = event?.payload_json as { outcome?: string; decided_by?: string } | undefined;
      return {
        from: e.from,
        to: e.to,
        traversed_at: event?.created_at ?? null,
        outcome: payload?.outcome ?? null,
        decided_by: payload?.decided_by ?? null,
        input_refs: event?.evidence_refs ?? ([] as string[]),
      };
    }) ?? [];

  return {
    graph_run: {
      id: gr.id,
      status: gr.status,
      blocked_reason_code: gr.blocked_reason_code,
      blocked_node_keys: gr.blocked_node_keys,
      definition_id: gr.definition_id,
      definition_version: gr.definition_version,
      created_at: gr.created_at,
      updated_at: gr.updated_at,
    },
    nodes: nodeRuns.map((nr) => ({
      node_key: nr.node_key,
      title: nr.node_key,
      responsibility: nr.node_key,
      status: nr.status,
      join_satisfied_at: nr.join_satisfied_at,
      result_event_id: nr.result_event_id,
      attempts: (runsByNode.get(nr.id) ?? []).map((r) => ({
        run_id: r.id,
        status: r.status,
        adapter_config_id: r.adapter_config_id,
        adapter_identity: r.adapter_identity,
        failure_reason: r.failure_reason,
        started_at: r.started_at,
        completed_at: r.completed_at,
      })),
    })),
    edges,
  };
}

export default async function graphRoutes(app: FastifyInstance, deps: GraphRouteDeps): Promise<void> {
  const { graphRunRepo, nodeRunRepo, runRepo, issueRepo, threadEventRepo } = deps;

  app.get("/api/issues/:issueId/graph", async (request) => {
    const { issueId } = request.params as { issueId: string };
    const issue = issueRepo.getById(issueId);
    if (!issue) throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");

    const current = graphRunRepo.getNonTerminalByIssueId(issueId) ?? graphRunRepo.getByIssueId(issueId);

    const history: Array<{ graph_run_id: string; status: string; created_at: string }> = [];
    if (current) history.push({ graph_run_id: current.id, status: current.status, created_at: current.created_at });

    if (current) {
      const allRuns = runRepo.listByIssue(issueId);
      const runsByNode = new Map<string, typeof allRuns>();
      for (const r of allRuns) {
        if (r.node_run_id) {
          const arr = runsByNode.get(r.node_run_id) ?? [];
          arr.push(r);
          runsByNode.set(r.node_run_id, arr);
        }
      }
      const nodeRuns = nodeRunRepo.listByGraphRun(current.id);
      const edgeEvents = threadEventRepo.listByThreadAndTypes(current.thread_id, [ThreadEventType.GraphEdgeTraversed]);
      return { current: projectGraphRun(current, nodeRuns, runsByNode, edgeEvents), history };
    }
    return { current: null, history };
  });

  app.get("/api/graph-runs/:graphRunId", async (request) => {
    const { graphRunId } = request.params as { graphRunId: string };
    const gr = graphRunRepo.getById(graphRunId);
    if (!gr) throw new AppError(ErrorCode.GRAPH_RUN_NOT_FOUND, "Graph run not found.");

    const allRuns = runRepo.listByIssue(gr.issue_id);
    const runsByNode = new Map<string, typeof allRuns>();
    for (const r of allRuns) {
      if (r.node_run_id) {
        const arr = runsByNode.get(r.node_run_id) ?? [];
        arr.push(r);
        runsByNode.set(r.node_run_id, arr);
      }
    }
    const edgeEvents = threadEventRepo.listByThreadAndTypes(gr.thread_id, [ThreadEventType.GraphEdgeTraversed]);
    return projectGraphRun(gr, nodeRunRepo.listByGraphRun(gr.id), runsByNode, edgeEvents);
  });

  const startSchema = z.object({
    definitionId: z.string().min(1),
    definitionVersion: z.number().int().positive(),
    nodeAssignments: z.record(z.string()),
    premiseHash: z.string().nullable().optional(),
  });

  app.post("/api/issues/:issueId/graph-runs", async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const body = parseRequestBody(startSchema, request.body);

    const issue = issueRepo.getById(issueId);
    if (!issue) throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");

    const thread = deps.threadRepo.getById(issue.primary_thread_id ?? "");
    if (!thread) throw new AppError(ErrorCode.THREAD_NOT_FOUND, "Primary thread not found.");

    const workspace = deps.workspaceRepo.getById(requireLegacyWorkspaceId(issue));
    if (!workspace) throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");

    const result = await deps.graphRuntimeService.start(
      issueId,
      thread.id,
      workspace.id,
      workspace.local_path,
      requireLegacyProjectId(issue),
      {
        definitionId: body.definitionId,
        definitionVersion: body.definitionVersion,
        nodeAssignments: body.nodeAssignments,
        premiseHash: body.premiseHash ?? null,
      },
    );

    reply.code(201);
    return { graph_run_id: result.graphRunId };
  });

  app.post("/api/graph-runs/:graphRunId/nodes/:nodeKey/retry", async (request, reply) => {
    const { graphRunId, nodeKey } = request.params as { graphRunId: string; nodeKey: string };
    const gr = graphRunRepo.getById(graphRunId);
    if (!gr) throw new AppError(ErrorCode.GRAPH_RUN_NOT_FOUND, "Graph run not found.");
    if (gr.status === ("cancelling" as never))
      throw new AppError(ErrorCode.GRAPH_RUN_CANCELLING, "Graph is cancelling.");
    if (gr.status === ("completed" as never) || gr.status === ("cancelled" as never))
      throw new AppError(ErrorCode.GRAPH_RUN_TERMINAL, "Graph is terminal.");

    const nr = nodeRunRepo.getByGraphRunAndKey(graphRunId, nodeKey);
    if (!nr) throw new AppError(ErrorCode.NODE_RUN_NOT_FOUND, "Node run not found.");
    if (!(["failed", "interrupted", "cancelled"] as string[]).includes(nr.status)) {
      throw new AppError(ErrorCode.NODE_RUN_NOT_RETRYABLE, "Node is not in a retryable state.");
    }

    const casResult = nodeRunRepo.compareAndSetStatus(nr.id, nr.status as never, NodeRunStatus.Ready);
    if (!casResult.success)
      throw new AppError(ErrorCode.NODE_RUN_ATTEMPT_IN_PROGRESS, "Node already has an active attempt.");

    const existingRuns = runRepo.listByIssue(gr.issue_id).filter((r) => r.node_run_id === nr.id);

    graphRunRepo.compareAndSetStatus(gr.id, gr.status as never, GraphRunStatus.Running, {
      blocked_reason_code: null,
      blocked_node_keys: null,
    });
    issueRepo.compareAndSetStatus(gr.issue_id, IssueStatus.Blocked, IssueStatus.Running);

    const runId = await dispatchGraphNode(
      deps,
      gr.id,
      nr.id,
      nr.assigned_adapter_config_id!,
      gr.issue_id,
      existingRuns.length,
      "graph-retry",
    );

    if (runId) {
      deps.threadEventService.write(gr.thread_id, ThreadEventType.GraphNodeQueued, ActorType.System, null, {
        graph_run_id: gr.id,
        node_key: nodeKey,
        run_id: runId,
        attempt_index: existingRuns.length,
        required_capabilities: [],
      });
    }

    await deps.runDispatchService.drainWorkspace(gr.workspace_id);

    reply.code(202);
    return { node_run_id: nr.id, run_id: runId, status: NodeRunStatus.Ready };
  });

  app.post("/api/graph-runs/:graphRunId/cancel", async (request, reply) => {
    const { graphRunId } = request.params as { graphRunId: string };
    const gr = graphRunRepo.getById(graphRunId);
    if (!gr) throw new AppError(ErrorCode.GRAPH_RUN_NOT_FOUND, "Graph run not found.");
    if (gr.status === ("completed" as never) || gr.status === ("cancelled" as never)) {
      throw new AppError(ErrorCode.GRAPH_RUN_TERMINAL, "Graph is already terminal.");
    }

    const nodeRuns = nodeRunRepo.listByGraphRun(graphRunId);
    const hasRunning = nodeRuns.some((nr) => nr.status === ("running" as never));
    const newStatus = hasRunning ? "cancelling" : "cancelled";

    // The graph's own cancelling/cancelled intent must be persisted BEFORE
    // any running Attempt is awaited below. RunDispatchService.cancel() can
    // synchronously drive that Attempt's NodeRun to `cancelled` and then
    // call tryFinalizeCancellingGraph() — which only acts once the GraphRun
    // itself is already `cancelling`. Doing this CAS after the awaits (as a
    // prior version did) meant the very first running node's cancellation
    // would find the graph still `running`, silently no-op, and leave the
    // graph stuck at `cancelling` forever once the CAS below finally ran —
    // recoverable only by a server restart.
    const moved = graphRunRepo.compareAndSetStatus(gr.id, gr.status as never, newStatus as never);

    const activeRunIds: string[] = [];
    const runningNodes: typeof nodeRuns = [];

    // F012 (T016): graph cancellation goes through the intervention surface
    // (DispatchService.cancelAttempt), which owns the Attempt/Run transition
    // and delegates a running process to the same run cancel hook.
    const attemptIdForRun = (runId: string): string | null =>
      (
        deps.db.prepare("SELECT id FROM attempts WHERE run_id = ? ORDER BY seq ASC LIMIT 1").get(runId) as
          | { id: string }
          | undefined
      )?.id ?? null;

    for (const nr of nodeRuns) {
      if (nr.status === ("running" as never)) {
        runningNodes.push(nr);
      } else if (nr.status !== ("completed" as never) && nr.status !== ("failed" as never)) {
        // No live process for this one — safe to cancel DB-first. Doing
        // this before awaiting the running nodes below ensures that by the
        // time the last running Attempt's cancellation resolves and checks
        // "is everything terminal now", these are already there.
        nodeRunRepo.compareAndSetStatus(nr.id, nr.status as never, "cancelled" as never);
        const queuedRuns = runRepo
          .listByIssue(gr.issue_id)
          .filter((r) => r.node_run_id === nr.id && r.status === ("queued" as never));
        for (const qr of queuedRuns) {
          const attemptId = attemptIdForRun(qr.id);
          if (attemptId) {
            await deps.dispatchService.cancelAttempt(attemptId, "graph-cancel");
          } else {
            runRepo.transitionStatus(qr.id, "queued" as never, "cancelled" as never, {});
          }
        }
      }
    }

    for (const nr of runningNodes) {
      const runs = runRepo
        .listByIssue(gr.issue_id)
        .filter((r) => r.node_run_id === nr.id && r.status === ("running" as never));
      for (const r of runs) {
        activeRunIds.push(r.id);
        const attemptId = attemptIdForRun(r.id);
        if (attemptId) {
          await deps.dispatchService.cancelAttempt(attemptId, "graph-cancel");
        } else {
          await deps.runDispatchService.cancel(r.id);
        }
      }
    }

    if (moved.success && !hasRunning) {
      // Nothing above went through the running-node path, so nothing
      // triggered tryFinalizeCancellingGraph on our behalf — finalize here.
      const issueExpected = gr.status === "blocked" ? IssueStatus.Blocked : IssueStatus.Running;
      deps.issueRepo.compareAndSetStatus(gr.issue_id, issueExpected as never, IssueStatus.Ready as never);
      const terminalEvent = deps.threadEventService.write(
        gr.thread_id,
        ThreadEventType.GraphTerminal,
        ActorType.System,
        null,
        {
          graph_run_id: gr.id,
          status: "cancelled",
          node_summary: nodeRuns.map((n) => ({ node_key: n.node_key, status: n.status })),
        },
      );
      deps.threadEventService.broadcast(terminalEvent);
    }

    reply.code(hasRunning ? 202 : 200);
    return {
      graph_run_id: graphRunId,
      status: newStatus,
      cancelled_node_keys: nodeRuns.filter((n) => n.status !== ("completed" as never)).map((n) => n.node_key),
      active_run_ids: activeRunIds,
    };
  });

  const resolveExecutorsSchema = z.object({
    node_assignments: z.record(z.string()),
  });

  app.post("/api/graph-runs/:graphRunId/resolve-executors", async (request, reply) => {
    const { graphRunId } = request.params as { graphRunId: string };
    const body = parseRequestBody(resolveExecutorsSchema, request.body);

    const gr = graphRunRepo.getById(graphRunId);
    if (!gr) throw new AppError(ErrorCode.GRAPH_RUN_NOT_FOUND, "Graph run not found.");

    // design.md §9: priority-ordered checks, first match wins.
    if (gr.status === GraphRunStatus.Cancelling) {
      throw new AppError(ErrorCode.GRAPH_RUN_CANCELLING, "Graph is cancelling.");
    }
    if (gr.status === GraphRunStatus.Completed || gr.status === GraphRunStatus.Cancelled) {
      throw new AppError(ErrorCode.GRAPH_RUN_TERMINAL, "Graph is terminal.");
    }
    if (gr.status !== GraphRunStatus.Blocked || gr.blocked_reason_code !== "no_capable_adapter") {
      throw new AppError(ErrorCode.RECOVERY_ACTION_NOT_APPLICABLE, "Graph is not blocked on a capability gap.");
    }

    const definition = getDefinition(gr.definition_id, gr.definition_version);
    if (!definition) throw new AppError(ErrorCode.GRAPH_DEFINITION_UNAVAILABLE, "Graph definition not found.");

    const issue = issueRepo.getById(gr.issue_id);
    if (!issue) throw new AppError(ErrorCode.ISSUE_NOT_FOUND, "Issue not found.");

    const targetKeys = gr.blocked_node_keys;
    if (targetKeys.length === 0)
      throw new AppError(ErrorCode.RECOVERY_ACTION_NOT_APPLICABLE, "No blocked nodes to resolve.");

    // Validate every target up front — a partial success (some nodes fixed,
    // others not) would leave the caller unable to tell which adapter is
    // still wrong, so the whole request is rejected atomically instead.
    const targets = targetKeys.map((nodeKey) => {
      const newAdapterId = body.node_assignments[nodeKey];
      if (!newAdapterId)
        throw new AppError(ErrorCode.GRAPH_PLAN_INCOMPLETE, `Missing adapter assignment for node '${nodeKey}'.`);
      const node = definition.nodes.find((n) => n.key === nodeKey);
      if (!node) throw new AppError(ErrorCode.NODE_RUN_NOT_FOUND, `Unknown node '${nodeKey}' in definition.`);
      const nodeRun = nodeRunRepo.getByGraphRunAndKey(graphRunId, nodeKey);
      if (!nodeRun) throw new AppError(ErrorCode.NODE_RUN_NOT_FOUND, `Node run for '${nodeKey}' not found.`);

      const roomId = deps.sessionService.ensureRoomForIssue(gr.issue_id).id;
      const eligibility = deps.eligibilityEvaluator.evaluate({
        roomId,
        purpose: DispatchPurpose.Execute,
        skillRefs: [],
        contextScope: ContextScope.All,
      });
      const stillEligible = eligibility.candidates.some(
        (entry) => entry.identity.adapter_config_id === newAdapterId && entry.tier !== "blocked",
      );
      if (!stillEligible)
        throw new AppError(ErrorCode.NO_CAPABLE_ADAPTER, `Adapter is still not eligible for node '${nodeKey}'.`);

      return { nodeKey, node, nodeRun, newAdapterId, from: nodeRun.assigned_adapter_config_id };
    });

    const reassigned: Array<{ node_key: string; from: string | null; to: string }> = [];
    const toDispatch: Array<{
      nodeRunId: string;
      nodeKey: string;
      adapterId: string;
      attemptIndex: number;
      requiredCapabilities: string[];
    }> = [];
    const pendingBroadcasts: ThreadEvent[] = [];

    deps.db.transaction(() => {
      for (const target of targets) {
        nodeRunRepo.updateAssignedAdapter(target.nodeRun.id, target.newAdapterId);
        reassigned.push({ node_key: target.nodeKey, from: target.from, to: target.newAdapterId });

        const reassignEvent = deps.threadEventService.write(
          gr.thread_id,
          ThreadEventType.GraphExecutorReassigned,
          ActorType.System,
          null,
          {
            node_key: target.nodeKey,
            from: target.from,
            to: target.newAdapterId,
            reason: "resolve_executors",
          },
        );
        pendingBroadcasts.push(reassignEvent);

        const existingRuns = runRepo.listByIssue(gr.issue_id).filter((r) => r.node_run_id === target.nodeRun.id);
        const hasActiveAttempt = existingRuns.some(
          (r) => r.status === RunStatus.Queued || r.status === RunStatus.Running,
        );
        if (hasActiveAttempt) continue;

        // Never create a downstream Attempt whose join isn't actually
        // satisfied — a node in blocked_node_keys can in principle still be
        // waiting on a sibling precursor (design.md §9 T051e2 regression).
        const incomingEdges = definition.edges.filter((e) => e.to === target.nodeKey);
        if (incomingEdges.length > 0) {
          let joinSatisfied = true;
          for (const edge of incomingEdges) {
            const predNodeRun = nodeRunRepo.getByGraphRunAndKey(graphRunId, edge.from);
            if (!predNodeRun || predNodeRun.status !== NodeRunStatus.Completed || !predNodeRun.result_event_id) {
              joinSatisfied = false;
              break;
            }
            if (!threadEventRepo.getById(predNodeRun.result_event_id)) {
              joinSatisfied = false;
              break;
            }
          }
          if (!joinSatisfied) continue;
        }

        const casResult = nodeRunRepo.compareAndSetStatus(
          target.nodeRun.id,
          target.nodeRun.status,
          NodeRunStatus.Ready,
          incomingEdges.length > 0 ? { join_satisfied_at: new Date().toISOString() } : undefined,
        );
        if (!casResult.success) continue;

        toDispatch.push({
          nodeRunId: target.nodeRun.id,
          nodeKey: target.nodeKey,
          adapterId: target.newAdapterId,
          attemptIndex: existingRuns.length,
          requiredCapabilities: target.node.requiredCapabilities,
        });

        if (incomingEdges.length > 0) {
          const joinEvent = deps.threadEventService.write(
            gr.thread_id,
            ThreadEventType.GraphJoinSatisfied,
            ActorType.System,
            null,
            {
              to_node_key: target.nodeKey,
              satisfied_by: incomingEdges.map((e) => e.from),
              join_policy: "all_required",
            },
          );
          pendingBroadcasts.push(joinEvent);

          for (const edge of incomingEdges) {
            const predNodeRun = nodeRunRepo.getByGraphRunAndKey(graphRunId, edge.from);
            const edgeRefs = predNodeRun?.result_event_id
              ? [buildEvidenceRef("event", predNodeRun.result_event_id)]
              : [];
            const edgeEvent = deps.threadEventService.write(
              gr.thread_id,
              ThreadEventType.GraphEdgeTraversed,
              ActorType.System,
              null,
              {
                from_node_key: edge.from,
                to_node_key: target.nodeKey,
                outcome: "completed",
                decided_by: "deterministic_join",
              },
              edgeRefs,
            );
            pendingBroadcasts.push(edgeEvent);
          }
        }
      }

      graphRunRepo.compareAndSetStatus(gr.id, GraphRunStatus.Blocked, GraphRunStatus.Running, {
        blocked_reason_code: null,
        blocked_node_keys: null,
      });
      issueRepo.compareAndSetStatus(gr.issue_id, IssueStatus.Blocked, IssueStatus.Running);
    })();

    const queuedRunIds: string[] = [];
    for (const target of toDispatch) {
      const runId = await dispatchGraphNode(
        deps,
        gr.id,
        target.nodeRunId,
        target.adapterId,
        gr.issue_id,
        target.attemptIndex,
        "graph-resolve-executors",
      );
      if (!runId) continue;
      queuedRunIds.push(runId);
      pendingBroadcasts.push(
        deps.threadEventService.write(gr.thread_id, ThreadEventType.GraphNodeQueued, ActorType.System, null, {
          graph_run_id: gr.id,
          node_key: target.nodeKey,
          run_id: runId,
          attempt_index: target.attemptIndex,
          required_capabilities: target.requiredCapabilities,
        }),
      );
    }

    for (const event of pendingBroadcasts) {
      deps.threadEventService.broadcast(event);
    }

    await deps.runDispatchService.drainWorkspace(gr.workspace_id);

    reply.code(202);
    return {
      graph_run_id: gr.id,
      status: GraphRunStatus.Running,
      reassigned,
      queued_run_ids: queuedRunIds,
    };
  });
}
