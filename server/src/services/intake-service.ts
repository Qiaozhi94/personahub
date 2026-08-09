import type Database from "better-sqlite3";
import type {
  ConfirmationToken,
  ChosenPlan,
  ConfirmResponse,
  ConfirmDiff,
  RoutingRecommendation,
  RecommendationPremise,
  ThreadEvent,
} from "@personahub/shared/types";
import { ActorType, ThreadEventType } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { IssueService } from "./issue.js";
import type { ThreadEventService } from "./thread-event.js";
import type { IntakeConfirmationRecord, IntakeConfirmationRepository } from "../repositories/intake-confirmation.js";
import { ConfirmationTokenService, computeRecommendationId } from "./confirmation-token.js";
import type { RoutingRecommendationService } from "./routing-recommendation-service.js";
import { createSequentialRun, type SequentialRunDeps } from "./create-sequential-run.js";
import type { GraphRuntimeDeps } from "./graph-runtime.js";
import { createGraph } from "./graph-runtime.js";
import { getDefinition } from "../runtime/graph/definitions.js";
import { prepareGraph } from "../runtime/graph/preflight.js";
import { resolveEligibleAdapter, type EligibleAdapterInput } from "./adapter-eligibility.js";
import { AgentCapability } from "@personahub/shared/types";
import type { AdapterResolverDeps } from "./adapter-resolver.js";
import type { GraphDefinitionV1 } from "../runtime/graph/types.js";

export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const ALLOWED_CLOCK_SKEW_MS = 5 * 60 * 1000;
const CONFIRM_BUSY_RETRIES = 8;

function isBusyError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT") return true;
  }
  return error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface IntakeServiceOptions {
  db: Database.Database;
  tokenService: ConfirmationTokenService;
  recommendationService: RoutingRecommendationService;
  confirmationRepo: IntakeConfirmationRepository;
  projectRepo: ProjectRepository;
  workspaceRepo: WorkspaceRepository;
  threadEventService: ThreadEventService;
  issueService: IssueService;
  sequentialDeps: SequentialRunDeps;
  graphDeps: GraphRuntimeDeps;
  drainWorkspace: (workspaceId: string) => Promise<void>;
  /** Test-only hooks. `afterIdempotencyMiss` runs right after the idempotency
   *  lookup confirms the nonce is uncommitted and before any current-state or
   *  write work — lets a concurrency test place a barrier so both processes
   *  observe the miss before either commits, forcing the nonce-conflict branch.
   *  `afterBusyRetry` runs after a retryable SQLITE_BUSY abort and before the
   *  next attempt — lets a test clear an injected transient-lock condition. */
  testHooks?: {
    afterIdempotencyMiss?: () => void | Promise<void>;
    afterBusyRetry?: () => void | Promise<void>;
  };
}

function isIntakeConfirmationConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: intake_confirmations\.nonce/.test(error.message);
}

function collectRuleNames(recommended: RoutingRecommendation): string[] {
  return [
    recommended.issue_type.rule,
    recommended.issue_draft.title.rule,
    recommended.issue_draft.goal.rule,
    recommended.issue_draft.priority.rule,
    recommended.workflow_template.rule,
    recommended.collaboration_topology.rule,
    recommended.agent_roster.rule,
  ];
}

export function computeDiff(recommended: RoutingRecommendation, chosen: ChosenPlan): ConfirmDiff[] {
  const diffs: ConfirmDiff[] = [];
  const recTopology = recommended.collaboration_topology.value.value;
  if (recTopology !== chosen.topology) {
    diffs.push({ field: "collaboration_topology", recommended: recTopology, chosen: chosen.topology });
  }
  if (chosen.topology === "sequential") {
    const chosenRoster = { sequential: chosen.adapter_config_id };
    const recRoster = recommended.agent_roster.value;
    if (JSON.stringify(recRoster) !== JSON.stringify(chosenRoster)) {
      diffs.push({ field: "agent_roster", recommended: recRoster, chosen: chosenRoster });
    }
  } else {
    const recRoster = recommended.agent_roster.value;
    if (JSON.stringify(recRoster) !== JSON.stringify(chosen.node_assignments)) {
      diffs.push({ field: "agent_roster", recommended: recRoster, chosen: chosen.node_assignments });
    }
  }
  return diffs;
}

function comparePremise(expected: RecommendationPremise, fresh: RecommendationPremise): string[] {
  const changed: string[] = [];
  if (expected.project_id !== fresh.project_id) changed.push("project_id");
  if (expected.workspace_id !== fresh.workspace_id) changed.push("workspace_id");
  if (expected.workflow_template_id !== fresh.workflow_template_id) changed.push("workflow_template_id");
  if (expected.workflow_template_version !== fresh.workflow_template_version) changed.push("workflow_template_version");
  if (expected.graph_definition_id !== fresh.graph_definition_id) changed.push("graph_definition_id");
  if (expected.graph_definition_version !== fresh.graph_definition_version) changed.push("graph_definition_version");

  const adapterKeys = new Set([...Object.keys(expected.adapters), ...Object.keys(fresh.adapters)]);
  for (const key of adapterKeys) {
    const exp = expected.adapters[key];
    const fr = fresh.adapters[key];
    if (!exp || !fr) {
      changed.push(`adapter.${key}`);
      continue;
    }
    if (exp.effective_status !== fr.effective_status) changed.push(`adapter.${key}.effective_status`);
    if (JSON.stringify(exp.capability_tags) !== JSON.stringify(fr.capability_tags)) {
      changed.push(`adapter.${key}.capability_tags`);
    }
    if (exp.updated_at !== fr.updated_at) changed.push(`adapter.${key}.updated_at`);
  }
  return changed;
}

function assertChosenTopologyEligible(
  adapterDeps: AdapterResolverDeps,
  projectId: string,
  workspaceId: string,
  adapterConfigId: string,
  requiredCapabilities: AgentCapability[],
  nodeLabel: string,
): void {
  const input: EligibleAdapterInput = {
    explicitAdapterId: adapterConfigId,
    requiredCapabilities,
  };
  const result = resolveEligibleAdapter(adapterDeps, projectId, workspaceId, input);
  if (!result.ok) {
    if (result.errorCode === ErrorCode.ADAPTER_UNAVAILABLE || result.errorCode === ErrorCode.ADAPTER_NOT_FOUND) {
      throw new AppError(
        ErrorCode.RECOMMENDATION_STALE,
        `Chosen adapter for ${nodeLabel} is no longer available. Please re-run recommendation.`,
        undefined,
        { changed: [`agent_roster.${nodeLabel}`] },
      );
    }
    throw new AppError(result.errorCode, `Adapter for ${nodeLabel} is not eligible.`);
  }
}

function assertGraphPlanShape(
  chosen: Extract<ChosenPlan, { topology: "orchestrator_subagent" }>,
  definition: GraphDefinitionV1,
): void {
  const nodeKeys = definition.nodes.map((n) => n.key);
  for (const key of nodeKeys) {
    if (!(key in chosen.node_assignments)) {
      throw new AppError(ErrorCode.GRAPH_PLAN_INCOMPLETE, `Node '${key}' is missing from node_assignments.`);
    }
  }
  for (const key of Object.keys(chosen.node_assignments)) {
    if (!nodeKeys.includes(key)) {
      throw new AppError(ErrorCode.GRAPH_PLAN_UNKNOWN_NODE, `Unknown node '${key}' in node_assignments.`);
    }
  }
}

export class IntakeService {
  constructor(private options: IntakeServiceOptions) {}

  private async returnReplay(
    routeProjectId: string,
    confirmation: IntakeConfirmationRecord,
  ): Promise<{ response: ConfirmResponse; replayed: true }> {
    if (confirmation.project_id !== routeProjectId) {
      throw new AppError(ErrorCode.CONFIRMATION_TOKEN_INVALID, "Token project_id does not match route.");
    }
    await this.options.drainWorkspace(confirmation.workspace_id);
    return {
      response: {
        issue_id: confirmation.issue_id,
        target_kind: confirmation.target_kind,
        target_id: confirmation.target_id,
        diff: [],
      },
      replayed: true,
    };
  }

  async confirm(
    routeProjectId: string,
    token: ConfirmationToken,
    chosen: ChosenPlan,
  ): Promise<{ response: ConfirmResponse; replayed: boolean }> {
    const { payload } = token;

    if (!this.options.tokenService.verify(token)) {
      throw new AppError(ErrorCode.CONFIRMATION_TOKEN_INVALID, "Confirmation token signature is invalid.");
    }
    if (payload.project_id !== routeProjectId) {
      throw new AppError(ErrorCode.CONFIRMATION_TOKEN_INVALID, "Token project_id does not match route.");
    }

    const existing = this.options.confirmationRepo.getByNonce(payload.nonce);
    if (existing) {
      // The database commit is the success boundary. If the first confirm's
      // post-commit drain failed, this replay must re-run the idempotent drain
      // so the queued Run still starts rather than being left stranded.
      return this.returnReplay(routeProjectId, existing);
    }

    await this.options.testHooks?.afterIdempotencyMiss?.();

    const project = this.options.projectRepo.getById(routeProjectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    if (!project.default_workspace_id || project.default_workspace_id !== payload.workspace_id) {
      throw new AppError(
        ErrorCode.RECOMMENDATION_STALE,
        "Project default workspace changed since the recommendation was issued.",
        undefined,
        { changed: ["workspace_id"] },
      );
    }
    const workspace = this.options.workspaceRepo.getById(payload.workspace_id);
    if (!workspace || workspace.project_id !== project.id) {
      throw new AppError(
        ErrorCode.RECOMMENDATION_STALE,
        "The recommendation's workspace is no longer valid.",
        undefined,
        { changed: ["workspace_id"] },
      );
    }
    const workspaceId = workspace.id;

    const issuedMs = Date.parse(payload.issued_at);
    const ageMs = Date.now() - issuedMs;
    if (Number.isNaN(issuedMs) || ageMs < -ALLOWED_CLOCK_SKEW_MS || ageMs > TOKEN_TTL_MS) {
      throw new AppError(ErrorCode.RECOMMENDATION_STALE, "Recommendation has expired. Please re-run recommendation.");
    }

    const recommended = payload.recommended;
    const diff = computeDiff(recommended, chosen);

    let definition: GraphDefinitionV1 | null = null;
    let preflight: ReturnType<typeof prepareGraph> | null = null;
    if (chosen.topology === "orchestrator_subagent") {
      const offered = payload.recommended.collaboration_topology.candidates.some(
        (c) =>
          c.value === "orchestrator_subagent" &&
          c.definition_id === chosen.definition_id &&
          c.definition_version === chosen.definition_version,
      );
      if (!offered) {
        throw new AppError(
          ErrorCode.TOPOLOGY_NOT_EXECUTABLE,
          "Chosen graph definition was not offered by the recommendation.",
        );
      }
      definition = getDefinition(chosen.definition_id, chosen.definition_version);
      if (!definition) {
        throw new AppError(
          ErrorCode.RECOMMENDATION_STALE,
          "The recommended graph definition is no longer available.",
          undefined,
          { changed: ["graph_definition_id"] },
        );
      }
      assertGraphPlanShape(chosen, definition);
      preflight = prepareGraph(
        workspace.local_path,
        workspaceId,
        definition,
        chosen.definition_id,
        chosen.definition_version,
      );
    }

    let targetKind: "graph" | "run" = "run";
    let targetId = "";
    let issueId = "";
    let pendingEvents: ThreadEvent[] = [];

    let transactionResult: {
      issueId: string;
      targetKind: "graph" | "run";
      targetId: string;
      pendingEvents: ThreadEvent[];
    };
    for (let attempt = 0; ; attempt++) {
      // A fresh event buffer per attempt: SQLite only rolls back DB state, not
      // the outer JS array, so a rolled-back attempt must not leak its events
      // into the next attempt's broadcast.
      const attemptEvents: ThreadEvent[] = [];
      const transaction = this.options.db.transaction(() => {
        const freshPremise = this.options.recommendationService.collectPremise(
          project.id,
          workspaceId,
          Object.keys(payload.premise.adapters),
        );
        const changed = comparePremise(payload.premise, freshPremise);
        if (changed.length > 0) {
          throw new AppError(
            ErrorCode.RECOMMENDATION_STALE,
            "Recommendation premise changed. Please re-run recommendation.",
            undefined,
            { changed },
          );
        }

        const adapterDeps = this.options.sequentialDeps.adapterDeps;
        if (chosen.topology === "sequential") {
          assertChosenTopologyEligible(
            adapterDeps,
            project.id,
            workspaceId,
            chosen.adapter_config_id,
            [AgentCapability.Implementation],
            "sequential",
          );
        } else {
          for (const node of definition!.nodes) {
            assertChosenTopologyEligible(
              adapterDeps,
              project.id,
              workspaceId,
              chosen.node_assignments[node.key],
              node.requiredCapabilities,
              node.key,
            );
          }
        }

        const created = this.options.issueService.create(project.id, {
          title: recommended.issue_draft.title.value,
          goal: recommended.issue_draft.goal.value,
          priority: recommended.issue_draft.priority.value,
        });
        issueId = created.issue.id;
        const threadId = created.primary_thread.id;

        const coordinatorEvent = this.options.threadEventService.write(
          threadId,
          ThreadEventType.CoordinatorRecommendationApplied,
          ActorType.System,
          null,
          {
            rules: collectRuleNames(recommended),
            recommended: recommended,
            chosen: chosen,
            diff,
          },
        );
        attemptEvents.push(coordinatorEvent);

        if (chosen.topology === "sequential") {
          const seq = createSequentialRun(
            this.options.sequentialDeps,
            issueId,
            threadId,
            workspaceId,
            project.id,
            chosen.adapter_config_id,
          );
          targetKind = "run";
          targetId = seq.runId;
          attemptEvents.push(...seq.pendingEvents);
        } else {
          const plan = {
            definitionId: chosen.definition_id,
            definitionVersion: chosen.definition_version,
            nodeAssignments: chosen.node_assignments,
            premiseHash: null,
          };
          const graphResult = createGraph(
            this.options.graphDeps,
            issueId,
            threadId,
            workspaceId,
            project.id,
            plan,
            preflight!,
          );
          targetKind = "graph";
          targetId = graphResult.graphRunId;
          attemptEvents.push(...graphResult.pendingEvents);
        }

        this.options.confirmationRepo.create({
          nonce: payload.nonce,
          project_id: project.id,
          workspace_id: workspaceId,
          recommendation_id: computeRecommendationId(payload),
          chosen_json: JSON.stringify(chosen),
          issue_id: issueId,
          target_kind: targetKind,
          target_id: targetId,
          issued_at: payload.issued_at,
          confirmed_at: new Date().toISOString(),
        });

        return { issueId, targetKind, targetId, pendingEvents: attemptEvents };
      });

      try {
        transactionResult = transaction();
        break;
      } catch (error) {
        if (isIntakeConfirmationConflict(error)) {
          const winner = this.options.confirmationRepo.getByNonce(payload.nonce);
          if (winner) {
            return this.returnReplay(routeProjectId, winner);
          }
        }
        if (isBusyError(error) && attempt < CONFIRM_BUSY_RETRIES) {
          await this.options.testHooks?.afterBusyRetry?.();
          await sleepMs(20 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
    issueId = transactionResult.issueId;
    targetKind = transactionResult.targetKind;
    targetId = transactionResult.targetId;
    pendingEvents = transactionResult.pendingEvents;

    for (const event of pendingEvents) {
      this.options.threadEventService.broadcast(event);
    }
    await this.options.drainWorkspace(workspaceId);

    return {
      response: { issue_id: issueId, target_kind: targetKind, target_id: targetId, diff },
      replayed: false,
    };
  }
}
