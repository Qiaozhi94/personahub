import type { GraphExecutionPlan, GraphPreflight } from "../runtime/graph/types.js";
import type { ThreadEvent } from "@personahub/shared/types";
import {
  GraphRunStatus,
  NodeRunStatus,
  IssueStatus,
  ThreadEventType,
  ActorType,
  DispatchPurpose,
  ContextScope,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import type { GraphRunRepository } from "../repositories/graph-run.js";
import type { NodeRunRepository } from "../repositories/node-run.js";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { ThreadEventService } from "./thread-event.js";
import { getDefinition } from "../runtime/graph/definitions.js";
import { GraphNodeInstructionBuilder } from "../runtime/graph/instruction-builder.js";
import type { AdapterResolverDeps } from "./adapter-resolver.js";
import type { GraphConstraintContext } from "../db/sqlite-errors.js";
import { mapGraphConstraint, isNonTerminalGraphConflict } from "../db/sqlite-errors.js";
import type Database from "better-sqlite3";
import { prepareGraph } from "../runtime/graph/preflight.js";
import type { SessionService } from "./session-service.js";
import type { EligibilityEvaluator } from "./eligibility-evaluator.js";
import type { DispatchService } from "./dispatch-service.js";

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
  sessionService: SessionService;
  eligibilityEvaluator: EligibilityEvaluator;
  dispatchService: DispatchService;
}

const SYNTHESIZE_NODE_KEY = "synthesize_findings";

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
    throw new AppError(
      ErrorCode.GRAPH_DEFINITION_UNAVAILABLE,
      `Graph definition '${plan.definitionId}' v${plan.definitionVersion} not found.`,
    );
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
    if (!adapterId) {
      throw new AppError(ErrorCode.GRAPH_PLAN_INCOMPLETE, `Node '${nodeKey}' has no adapter assignment.`);
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

      for (const node of definition.nodes) {
        deps.nodeRunRepo.create({
          graph_run_id: graphRun.id,
          node_key: node.key,
          status: node.inputSlots.length === 0 ? NodeRunStatus.Ready : NodeRunStatus.Pending,
          assigned_adapter_config_id: plan.nodeAssignments[node.key],
        });
      }

      const issueMoved = deps.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Running);
      if (!issueMoved.success) {
        throw new AppError(ErrorCode.INVALID_ISSUE_TRANSITION, "Issue is not in Inbox state, cannot start graph.");
      }

      return { graphRunId: graphRun.id, queuedRunIds: [] as string[], pendingEvents: [] as ThreadEvent[] };
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
  constructor(
    private deps: GraphRuntimeDeps,
    private db: Database.Database,
  ) {}

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
      throw new AppError(
        ErrorCode.GRAPH_DEFINITION_UNAVAILABLE,
        `Graph definition '${plan.definitionId}' v${plan.definitionVersion} not found.`,
      );
    }

    const preflight = prepareGraph(workspacePath, workspaceId, definition, plan.definitionId, plan.definitionVersion);

    const roomId = this.deps.sessionService.ensureRoomForIssue(issueId).id;
    const eligibility = this.deps.eligibilityEvaluator.evaluate({
      roomId,
      purpose: DispatchPurpose.Execute,
      skillRefs: [],
      contextScope: ContextScope.All,
    });
    const precursorNodes = definition.nodes.filter((n) => n.key !== SYNTHESIZE_NODE_KEY);
    const identities = new Map(
      precursorNodes.map((node) => {
        const adapterId = plan.nodeAssignments[node.key];
        const candidate = eligibility.candidates.find(
          (entry) => entry.identity.adapter_config_id === adapterId && entry.tier !== "blocked",
        );
        if (!candidate) {
          throw new AppError(
            ErrorCode.NO_CAPABLE_ADAPTER,
            `Adapter '${adapterId}' has no eligible identity for node '${node.key}'.`,
          );
        }
        return [node.key, candidate.identity] as const;
      }),
    );

    const result = this.db.transaction(() =>
      createGraph(this.deps, issueId, threadId, workspaceId, projectId, plan, preflight),
    )();

    const nodeRuns = this.deps.nodeRunRepo.listByGraphRun(result.graphRunId);
    const pendingEvents: ThreadEvent[] = [];
    for (const node of precursorNodes) {
      const nodeRun = nodeRuns.find((nr) => nr.node_key === node.key);
      if (!nodeRun) continue;
      const identity = identities.get(node.key)!;
      const outcome = await this.deps.dispatchService.confirmGraphNode(
        {
          roomId,
          clientRequestId: `graph:${result.graphRunId}:${node.key}:0`,
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
          actor: "graph-scheduler",
          graphNodeRunId: nodeRun.id,
        },
        "graph-scheduler",
      );
      if (outcome.runId) {
        pendingEvents.push(
          this.deps.threadEventService.write(threadId, ThreadEventType.GraphNodeQueued, ActorType.System, null, {
            graph_run_id: result.graphRunId,
            node_key: node.key,
            run_id: outcome.runId,
            attempt_index: 0,
            required_capabilities: node.requiredCapabilities,
          }),
        );
      }
    }

    for (const event of pendingEvents) {
      this.deps.threadEventService.broadcast(event);
    }

    await this.deps.drainWorkspace(workspaceId);

    return { graphRunId: result.graphRunId };
  }
}
