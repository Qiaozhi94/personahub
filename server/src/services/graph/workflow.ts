import type { GraphRun, NodeRun } from "@personahub/shared/types";
import type { ThreadEvent } from "@personahub/shared/types";
import {
  GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus,
  ThreadEventType, ActorType, RunRole, RunPurpose,
} from "@personahub/shared/types";
import type { GraphRunRepository } from "../../repositories/graph-run.js";
import type { NodeRunRepository } from "../../repositories/node-run.js";
import type { RunRepository } from "../../repositories/run.js";
import type { IssueRepository } from "../../repositories/issue.js";
import type { ThreadEventService } from "../thread-event.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import { getDefinition } from "../../runtime/graph/definitions.js";
import type { GraphEdgeV1, GraphNodeV1 } from "../../runtime/graph/types.js";
import { GraphNodeInstructionBuilder } from "../../runtime/graph/instruction-builder.js";
import type { AdapterResolverDeps } from "../adapter-resolver.js";
import { resolveEligibleAdapter } from "../adapter-eligibility.js";
import { mapGraphConstraint } from "../../db/sqlite-errors.js";
import type Database from "better-sqlite3";
import { buildEvidenceRef } from "../../evidence-ref.js";

export interface GraphWorkflowDeps {
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  threadEventService: ThreadEventService;
  threadEventRepo: ThreadEventRepository;
  adapterDeps: AdapterResolverDeps;
  db: Database.Database;
}

export function evaluateJoinAndTrigger(
  deps: GraphWorkflowDeps,
  graphRun: GraphRun,
  completedNodeRun: NodeRun,
  _pendingEvents: ThreadEvent[],
): ThreadEvent[] | null {
  const definition = getDefinition(graphRun.definition_id, graphRun.definition_version);
  if (!definition) return null;

  // Find edges where this node is a predecessor
  const outgoingEdges = definition.edges.filter((e: GraphEdgeV1) => e.from === completedNodeRun.node_key);
  if (outgoingEdges.length === 0) return null;

  const newEvents: ThreadEvent[] = [];

  for (const edge of outgoingEdges) {
    const synthesisNode = definition.nodes.find((n: GraphNodeV1) => n.key === edge.to);
    if (!synthesisNode) continue;

    const synthesisNodeRun = deps.nodeRunRepo.getByGraphRunAndKey(graphRun.id, edge.to);
    if (!synthesisNodeRun || synthesisNodeRun.status !== NodeRunStatus.Pending) continue;

    // Check if all predecessors in this joinGroup have completed
    const joinGroupEdges = definition.edges.filter((e: GraphEdgeV1) => e.to === edge.to && e.joinGroup === edge.joinGroup);
    const allPredecessorsCompleted = joinGroupEdges.every((je: GraphEdgeV1) => {
      const predNodeRun = deps.nodeRunRepo.getByGraphRunAndKey(graphRun.id, je.from);
      return predNodeRun && predNodeRun.status === NodeRunStatus.Completed;
    });

    if (!allPredecessorsCompleted) continue;

    try {
      deps.db.transaction(() => {
        // Pre-validation: check eligibility and read predecessor results FIRST
        const issue = deps.issueRepo.getById(graphRun.issue_id);
        if (!issue) return;
        const eligibility = resolveEligibleAdapter(deps.adapterDeps, issue.project_id, graphRun.workspace_id, {
          explicitAdapterId: synthesisNodeRun.assigned_adapter_config_id,
          requiredCapabilities: synthesisNode.requiredCapabilities,
        });

        if (!eligibility.ok) {
          deps.graphRunRepo.compareAndSetStatus(
            graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked,
            { blocked_reason_code: "no_capable_adapter" as never, blocked_node_keys: [synthesisNode.key] },
          );
          deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IssueStatus.Running, IssueStatus.Blocked);
          return;
        }

        const inputPayloads: Record<string, string> = {};
        for (const je of joinGroupEdges) {
          const predNodeRun = deps.nodeRunRepo.getByGraphRunAndKey(graphRun.id, je.from);
          if (!predNodeRun?.result_event_id) {
            deps.graphRunRepo.compareAndSetStatus(
              graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked,
              { blocked_reason_code: "result_unparsable" as never, blocked_node_keys: [je.from] },
            );
            deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IssueStatus.Running, IssueStatus.Blocked);
            return;
          }
          const resultEvent = deps.threadEventRepo.getById(predNodeRun.result_event_id);
          if (!resultEvent) {
            deps.graphRunRepo.compareAndSetStatus(
              graphRun.id, GraphRunStatus.Running, GraphRunStatus.Blocked,
              { blocked_reason_code: "result_unparsable" as never, blocked_node_keys: [je.from] },
            );
            deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IssueStatus.Running, IssueStatus.Blocked);
            return;
          }
          inputPayloads[je.inputSlot] = JSON.stringify(resultEvent.payload_json);
        }

        // All preconditions passed — now CAS pending → ready
        const casResult = deps.nodeRunRepo.compareAndSetStatus(
          synthesisNodeRun.id, NodeRunStatus.Pending, NodeRunStatus.Ready,
          { join_satisfied_at: new Date().toISOString() },
        );

        if (!casResult.success) return;

        // Create synthesis Attempt
        const instructions = new GraphNodeInstructionBuilder().build({
          node: synthesisNode,
          definition,
          graphRun,
          inputPayloads,
        });

        const run = deps.runRepo.create({
          issue_id: graphRun.issue_id,
          thread_id: graphRun.thread_id,
          workspace_id: graphRun.workspace_id,
          adapter_config_id: synthesisNodeRun.assigned_adapter_config_id,
          instructions,
          status: RunStatus.Queued,
          role: RunRole.GraphNode,
          node_run_id: synthesisNodeRun.id,
          purpose: RunPurpose.WorkflowBound,
        });

        const queuedEvent = deps.threadEventService.write(
          graphRun.thread_id,
          ThreadEventType.GraphNodeQueued,
          ActorType.System,
          null,
          { graph_run_id: graphRun.id, node_key: synthesisNode.key, run_id: run.id, attempt_index: 0, required_capabilities: synthesisNode.requiredCapabilities },
        );
        newEvents.push(queuedEvent);

        const joinEvent = deps.threadEventService.write(
          graphRun.thread_id,
          ThreadEventType.GraphJoinSatisfied,
          ActorType.System,
          null,
          { to_node_key: synthesisNode.key, satisfied_by: joinGroupEdges.map((e: GraphEdgeV1) => e.from), join_policy: "all_required" },
        );
        newEvents.push(joinEvent);

        for (const je of joinGroupEdges) {
          const predNodeRun = deps.nodeRunRepo.getByGraphRunAndKey(graphRun.id, je.from);
          const edgeRefs = predNodeRun?.result_event_id ? [buildEvidenceRef("event", predNodeRun.result_event_id)] : [];
          const edgeEvent = deps.threadEventService.write(
            graphRun.thread_id,
            ThreadEventType.GraphEdgeTraversed,
            ActorType.System,
            null,
            { from_node_key: je.from, to_node_key: je.to, outcome: "completed", decided_by: "deterministic_join" },
            edgeRefs,
          );
          newEvents.push(edgeEvent);
        }
      })();
    } catch (error) {
      mapGraphConstraint(error, { issueId: graphRun.issue_id, graphRunRepo: deps.graphRunRepo });
    }
  }

  return newEvents.length > 0 ? newEvents : null;
}
