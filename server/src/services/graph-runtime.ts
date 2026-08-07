import type { GraphExecutionPlan, GraphPreflight, GraphDefinitionV1 } from "../runtime/graph/types.js";
import type { GraphRun, NodeRun } from "@personahub/shared/types";
import type { ThreadEvent } from "@personahub/shared/types";
import { GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, ThreadEventType, ActorType, RunRole, RunPurpose } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import type { GraphRunRepository } from "../repositories/graph-run.js";
import type { NodeRunRepository } from "../repositories/node-run.js";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { ThreadEventService } from "./thread-event.js";
import { getDefinition } from "../runtime/graph/definitions.js";
import { GraphNodeInstructionBuilder } from "../runtime/graph/instruction-builder.js";
import type { InstructionBuilderInput } from "../runtime/graph/instruction-builder.js";
import type { AdapterResolverDeps } from "./adapter-resolver.js";
import { resolveEligibleAdapter } from "./adapter-eligibility.js";
import type { GraphConstraintContext } from "../db/sqlite-errors.js";
import { mapGraphConstraint, isNonTerminalGraphConflict } from "../db/sqlite-errors.js";
import type Database from "better-sqlite3";
import { prepareGraph } from "../runtime/graph/preflight.js";

export interface GraphCreateResult {
  graphRunId: string;
  queuedRunIds: string[];
  pendingEvents: ThreadEvent[];
}

export interface GraphRuntimeDeps {
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  threadEventService: ThreadEventService;
  adapterDeps: AdapterResolverDeps;
  instructionBuilder: GraphNodeInstructionBuilder;
  drainWorkspace: (workspaceId: string) => Promise<void>;
}

const instructionBuilder = new GraphNodeInstructionBuilder();

function buildNodeInstructions(
  nodeKey: string,
  definition: GraphDefinitionV1,
  graphRun: GraphRun,
  inputPayloads?: Record<string, string>,
): string {
  const node = definition.nodes.find((n) => n.key === nodeKey);
  if (!node) throw new Error(`Node ${nodeKey} not found in definition`);

  const input: InstructionBuilderInput = {
    node,
    definition,
    graphRun,
    inputPayloads,
  };
  return instructionBuilder.build(input);
}

export function createGraph(
  deps: GraphRuntimeDeps,
  issueId: string,
  threadId: string,
  workspaceId: string,
  projectId: string,
  plan: GraphExecutionPlan,
  preflight: GraphPreflight,
): GraphCreateResult {
  const definition = getDefinition(plan.definitionId, plan.definitionVersion);
  if (!definition) {
    throw new AppError(ErrorCode.GRAPH_DEFINITION_UNAVAILABLE, `Graph definition '${plan.definitionId}' v${plan.definitionVersion} not found.`);
  }

  const issue = deps.issueRepo.getById(issueId);
  if (!issue || issue.project_id !== projectId || issue.workspace_id !== workspaceId) {
    throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "Issue does not belong to the specified project/workspace.");
  }

  if (preflight.workspaceId !== workspaceId) {
    throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "Preflight workspace does not match.");
  }
  if (preflight.definitionId !== plan.definitionId || preflight.definitionVersion !== plan.definitionVersion) {
    throw new AppError(ErrorCode.REQUEST_BODY_INVALID, "Preflight does not match plan definition.");
  }

  if (preflight.targetFiles.length === 0 && !preflight.truncated) {
    throw new AppError(ErrorCode.GRAPH_TARGET_SET_EMPTY, "Graph target file set must not be empty.");
  }

  const nodeKeys = definition.nodes.map((n) => n.key);
  for (const key of nodeKeys) {
    if (!(key in plan.nodeAssignments)) {
      throw new AppError(ErrorCode.GRAPH_PLAN_INCOMPLETE, `Node '${key}' is missing from nodeAssignments.`);
    }
  }

  for (const [nodeKey, adapterId] of Object.entries(plan.nodeAssignments)) {
    if (!nodeKeys.includes(nodeKey)) {
      throw new AppError(ErrorCode.GRAPH_PLAN_INCOMPLETE, `Unknown node '${nodeKey}' in nodeAssignments.`);
    }
    const node = definition.nodes.find((n) => n.key === nodeKey)!;
    const eligibility = resolveEligibleAdapter(deps.adapterDeps, projectId, workspaceId, {
      explicitAdapterId: adapterId,
      requiredCapabilities: node.requiredCapabilities,
    });
    if (!eligibility.ok) {
      throw new AppError(eligibility.errorCode, `Adapter '${adapterId}' is not eligible for node '${nodeKey}'.`);
    }
  }

  const attemptResult = (() => {
    try {
      const graphRun = deps.graphRunRepo.create({
        issue_id: issueId,
        thread_id: threadId,
        workspace_id: workspaceId,
        definition_id: plan.definitionId,
        definition_version: plan.definitionVersion,
        status: GraphRunStatus.Running,
        target_files: preflight.targetFiles,
        target_files_hash: preflight.targetFilesHash,
        target_files_truncated: preflight.truncated,
        target_files_dropped_count: preflight.droppedCount,
      });

      const createdNodeRuns: NodeRun[] = [];
      for (const node of definition.nodes) {
        const nodeRun = deps.nodeRunRepo.create({
          graph_run_id: graphRun.id,
          node_key: node.key,
          status: node.inputSlots.length === 0 ? NodeRunStatus.Ready : NodeRunStatus.Pending,
          assigned_adapter_config_id: plan.nodeAssignments[node.key],
        });
        createdNodeRuns.push(nodeRun);
      }

      const graphRunEntity = deps.graphRunRepo.getById(graphRun.id)!;
      const precursorNodes = definition.nodes.filter((n) => n.key !== "synthesize_findings");
      const queuedRunIds: string[] = [];
      const pendingEvents: ThreadEvent[] = [];

      for (const node of precursorNodes) {
        const nodeRun = createdNodeRuns.find((nr) => nr.node_key === node.key)!;
        const instructions = buildNodeInstructions(node.key, definition, graphRunEntity);

        const run = deps.runRepo.create({
          issue_id: issueId,
          thread_id: threadId,
          workspace_id: workspaceId,
          adapter_config_id: plan.nodeAssignments[node.key],
          instructions,
          status: RunStatus.Queued,
          role: RunRole.GraphNode,
          node_run_id: nodeRun.id,
          purpose: RunPurpose.WorkflowBound,
        });
        queuedRunIds.push(run.id);

        const event = deps.threadEventService.write(threadId, ThreadEventType.GraphNodeQueued, ActorType.System, null, {
          graph_run_id: graphRun.id,
          node_key: node.key,
          run_id: run.id,
          attempt_index: 0,
          required_capabilities: node.requiredCapabilities,
        });
        pendingEvents.push(event);
      }

      const issueMoved = deps.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Running);
      if (!issueMoved.success) {
        throw new AppError(ErrorCode.INVALID_ISSUE_TRANSITION, "Issue is not in Inbox state, cannot start graph.");
      }

      return { graphRunId: graphRun.id, queuedRunIds, pendingEvents };
    } catch (error) {
      if (isNonTerminalGraphConflict(error)) {
        const constraintCtx: GraphConstraintContext = { issueId, graphRunRepo: deps.graphRunRepo };
        const existingId = mapGraphConstraint(error, constraintCtx);
        if (typeof existingId === "string") {
          return { graphRunId: existingId, queuedRunIds: [], pendingEvents: [] };
        }
      }
      throw error;
    }
  })();

  return attemptResult;
}

export class GraphRuntimeService {
  private instructionBuilder = new GraphNodeInstructionBuilder();

  constructor(private deps: GraphRuntimeDeps, private db: Database.Database) {}

  async start(
    issueId: string,
    threadId: string,
    workspaceId: string,
    workspacePath: string,
    projectId: string,
    plan: GraphExecutionPlan,
  ): Promise<{ graphRunId: string }> {
    const definition = getDefinition(plan.definitionId, plan.definitionVersion);
    if (!definition) {
      throw new AppError(ErrorCode.GRAPH_DEFINITION_UNAVAILABLE, `Graph definition '${plan.definitionId}' v${plan.definitionVersion} not found.`);
    }

    const preflight = prepareGraph(workspacePath, workspaceId, definition, plan.definitionId, plan.definitionVersion);

    const result = this.db.transaction(() => {
      return createGraph(this.deps, issueId, threadId, workspaceId, projectId, plan, preflight);
    })();

    for (const event of result.pendingEvents) {
      this.deps.threadEventService.broadcast(event);
    }

    await this.deps.drainWorkspace(workspaceId);

    return { graphRunId: result.graphRunId };
  }

  enqueueSequential(
    issueId: string,
    threadId: string,
    workspaceId: string,
    projectId: string,
    plan: GraphExecutionPlan,
    preflight: GraphPreflight,
  ): GraphCreateResult {
    return createGraph(this.deps, issueId, threadId, workspaceId, projectId, plan, preflight);
  }
}
