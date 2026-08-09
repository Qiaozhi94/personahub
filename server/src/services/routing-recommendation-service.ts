import type {
  RecommendResponse,
  RoutingRecommendation,
  RecommendationPremise,
  AgentRosterRecommendation,
  ConfirmationTokenPayload,
} from "@personahub/shared/types";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AgentConfigRepository, AgentConfigRecord } from "../repositories/agent-config.js";
import type {
  AdapterWorkspaceStatusRepository,
  AdapterWorkspaceStatusRecord,
} from "../repositories/adapter-workspace-status.js";
import type { WorkflowTemplateRepository } from "../repositories/workflow-template.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { hasCapability } from "../repositories/agent-config.js";
import { getDefinition } from "../runtime/graph/definitions.js";
import { WGD_CODING_DUAL_REVIEW_V1 } from "../runtime/graph/definitions.js";
import {
  singleActiveIssueType,
  activeTemplateForIssueType,
  isMultiPerspectiveKeywordHit,
  decideTopology,
  buildNodeRoster,
  deriveIssueDraft,
  KEYWORD_MATCH_LIMIT,
} from "./routing/rules.js";
import { ConfirmationTokenService, generateNonce, computeRecommendationId } from "./confirmation-token.js";

const IMPLEMENTATION_CAPABILITY = AgentCapability.Implementation;

export interface RoutingRecommendationDeps {
  projectRepo: ProjectRepository;
  agentConfigRepo: AgentConfigRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  workflowTemplateRepo: WorkflowTemplateRepository;
}

export interface RoutingRecommendationServiceOptions {
  deps: RoutingRecommendationDeps;
  tokenService: ConfirmationTokenService;
}

export function isBlockedRecommendationCode(code: ErrorCode): boolean {
  return (
    code === ErrorCode.NO_AVAILABLE_ADAPTER ||
    code === ErrorCode.NO_AVAILABLE_CAPABLE_ADAPTER ||
    code === ErrorCode.PROJECT_WORKSPACE_REQUIRED ||
    code === ErrorCode.TOPOLOGY_NOT_EXECUTABLE
  );
}

export class RoutingRecommendationService {
  constructor(private options: RoutingRecommendationServiceOptions) {}

  private get deps(): RoutingRecommendationDeps {
    return this.options.deps;
  }

  recommend(projectId: string, goalText: string): RecommendResponse {
    const project = this.deps.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    const workspaceId = project.default_workspace_id;
    if (!workspaceId) {
      throw new AppError(
        ErrorCode.PROJECT_WORKSPACE_REQUIRED,
        "Project must have a default workspace before routing a recommendation.",
        undefined,
        { suggested_action: "为 Project 绑定默认 workspace 后再试" },
      );
    }

    const adapters = this.deps.agentConfigRepo.listByProject(projectId);
    const overrides = this.deps.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId);
    const overrideByAdapterId = new Map(overrides.map((o) => [o.adapter_config_id, o]));

    const effective = (a: AgentConfigRecord) => effectiveAdapterStatus(a, overrideByAdapterId.get(a.id) ?? null);

    const anyAvailable = adapters.some((a) => effective(a) === AdapterStatus.Available);
    if (!anyAvailable) {
      throw new AppError(ErrorCode.NO_AVAILABLE_ADAPTER, "No adapter is available in this workspace.", undefined, {
        suggested_action: "在 Adapter Settings 中验证适配器",
      });
    }

    const anyCapable = adapters.some(
      (a) => effective(a) === AdapterStatus.Available && hasCapability(a, IMPLEMENTATION_CAPABILITY),
    );
    if (!anyCapable) {
      throw new AppError(
        ErrorCode.NO_AVAILABLE_CAPABLE_ADAPTER,
        "No available adapter has the implementation capability.",
        undefined,
        { suggested_action: "为至少一个适配器启用 implementation 能力并验证" },
      );
    }

    const template = this.deps.workflowTemplateRepo.getDefault();
    if (!template) {
      throw new AppError(
        ErrorCode.TOPOLOGY_NOT_EXECUTABLE,
        "No active coding workflow template is available.",
        undefined,
        { suggested_action: "激活一个 coding workflow template（F008）" },
      );
    }
    const goalFragment = goalText.slice(0, KEYWORD_MATCH_LIMIT);
    const keywordHit = isMultiPerspectiveKeywordHit(goalFragment);
    const definition = getDefinition(WGD_CODING_DUAL_REVIEW_V1.id, WGD_CODING_DUAL_REVIEW_V1.version);

    const sequentialRoster = this.buildRoster(adapters, overrides, "sequential", null);

    if (!definition && keywordHit) {
      throw new AppError(ErrorCode.TOPOLOGY_NOT_EXECUTABLE, "Graph definition is unavailable.", undefined, {
        suggested_action: "恢复所需的 graph definition（F006）",
      });
    }

    const topology = decideTopology({
      keywordHit,
      definitionAvailable: !!definition,
      definitionId: WGD_CODING_DUAL_REVIEW_V1.id,
      definitionVersion: WGD_CODING_DUAL_REVIEW_V1.version,
    });

    const rosters_by_topology: RecommendResponse["rosters_by_topology"] = { sequential: sequentialRoster };
    let graphRoster: AgentRosterRecommendation | null = null;
    if (definition) {
      graphRoster = this.buildRoster(adapters, overrides, "orchestrator_subagent", definition);
      rosters_by_topology.orchestrator_subagent = graphRoster;
    }
    const roster = topology.value.value === "orchestrator_subagent" ? graphRoster! : sequentialRoster;

    const issue_type = singleActiveIssueType();
    const issue_draft = deriveIssueDraft(goalText);
    const workflow_template = activeTemplateForIssueType(template);

    const recommended: RoutingRecommendation = {
      issue_type,
      issue_draft,
      workflow_template,
      collaboration_topology: topology,
      agent_roster: roster,
    };

    const referencedIds = [...new Set(Object.values(roster.value))];
    const premise = this.collectPremise(projectId, workspaceId, referencedIds);

    const now = new Date().toISOString();
    const payload: ConfirmationTokenPayload = {
      nonce: generateNonce(),
      issued_at: now,
      project_id: projectId,
      workspace_id: workspaceId,
      premise,
      recommended,
    };
    const token = this.options.tokenService.sign(payload);

    return {
      token,
      recommendation_id: computeRecommendationId(payload),
      issue_type,
      issue_draft,
      workflow_template,
      collaboration_topology: topology,
      agent_roster: roster,
      rosters_by_topology,
      editable: ["collaboration_topology", "agent_roster"],
    };
  }

  private buildRoster(
    adapters: AgentConfigRecord[],
    overrides: AdapterWorkspaceStatusRecord[],
    topologyValue: "sequential" | "orchestrator_subagent",
    definition: ReturnType<typeof getDefinition>,
  ): AgentRosterRecommendation {
    if (topologyValue === "sequential") {
      const nodeRoster = buildNodeRoster(adapters, overrides, "sequential", [IMPLEMENTATION_CAPABILITY]);
      const chosen = nodeRoster.candidates[0];
      return {
        value: { sequential: chosen },
        rule: "capability_match_and_effective_availability",
        by_node: { sequential: nodeRoster },
      };
    }
    const byNode: Record<string, { candidates: string[]; excluded: { id: string; reason: string }[] }> = {};
    const value: Record<string, string> = {};
    for (const node of definition!.nodes) {
      const nodeRoster = buildNodeRoster(adapters, overrides, node.key, node.requiredCapabilities);
      byNode[node.key] = nodeRoster;
      value[node.key] = nodeRoster.candidates[0];
    }
    return {
      value,
      rule: "capability_match_and_effective_availability",
      by_node: byNode,
    };
  }

  collectPremise(projectId: string, workspaceId: string, referencedAdapterIds: string[]): RecommendationPremise {
    const adapters = this.deps.agentConfigRepo.listByProject(projectId);
    const overrides = this.deps.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId);
    const overrideByAdapterId = new Map(overrides.map((o) => [o.adapter_config_id, o]));
    const referenced = new Set(referencedAdapterIds);

    const adapterSnapshot: RecommendationPremise["adapters"] = {};
    for (const a of adapters) {
      if (!referenced.has(a.id)) continue;
      adapterSnapshot[a.id] = {
        effective_status: effectiveAdapterStatus(a, overrideByAdapterId.get(a.id) ?? null),
        capability_tags: a.capability_tags,
        updated_at: a.updated_at,
      };
    }

    const template = this.deps.workflowTemplateRepo.getDefault();
    const definition = getDefinition(WGD_CODING_DUAL_REVIEW_V1.id, WGD_CODING_DUAL_REVIEW_V1.version);
    return {
      project_id: projectId,
      workspace_id: workspaceId,
      adapters: adapterSnapshot,
      workflow_template_id: template?.id ?? "",
      workflow_template_version: template?.version ?? 0,
      graph_definition_id: definition ? WGD_CODING_DUAL_REVIEW_V1.id : null,
      graph_definition_version: definition ? WGD_CODING_DUAL_REVIEW_V1.version : null,
    };
  }
}

export { WGD_CODING_DUAL_REVIEW_V1 };
