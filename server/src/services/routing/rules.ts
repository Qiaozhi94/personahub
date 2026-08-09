import type {
  Recommendation,
  TopologyRecommendationValue,
  IssueDraft,
  IssueType,
  WorkflowTemplate,
  AgentCapability,
} from "@personahub/shared/types";
import { IssueType as IT, IssuePriority as IP, AdapterStatus } from "@personahub/shared/types";
import { hasCapability, type AgentConfigRecord } from "../../repositories/agent-config.js";
import { effectiveAdapterStatus } from "../adapter-availability.js";
import type { AdapterWorkspaceStatusRecord } from "../../repositories/adapter-workspace-status.js";

export const TITLE_MAX_CHARS = 120;
export const TITLE_ELLIPSIS = "…";
export const KEYWORD_MATCH_LIMIT = 8000;

export const MULTI_PERSPECTIVE_KEYWORDS: readonly string[] = [
  "review",
  "audit",
  "评审",
  "审查",
  "复核",
  "多视角",
  "双人",
  "交叉验证",
  "code review",
  "multi-perspective",
  "concurrency",
];

export function singleActiveIssueType(): Recommendation<IssueType> {
  return {
    value: IT.Coding,
    rule: "single_active_issue_type",
    candidates: [IT.Coding],
    excluded: [],
  };
}

export function activeTemplateForIssueType(
  template: WorkflowTemplate | null,
): Recommendation<{ id: string; version: number }> {
  const value = template ? { id: template.id, version: template.version } : null;
  const candidates = template ? [{ id: template.id, version: template.version }] : [];
  return {
    value: value ?? { id: "", version: 0 },
    rule: "active_template_for_issue_type",
    candidates,
    excluded: template
      ? []
      : [{ id: "default_coding_template", reason: "no active default coding workflow template found" }],
  };
}

export function isMultiPerspectiveKeywordHit(goalFragment: string): boolean {
  const lowered = goalFragment.toLowerCase();
  return MULTI_PERSPECTIVE_KEYWORDS.some((kw) => lowered.includes(kw.toLowerCase()));
}

export interface TopologyDecisionInput {
  keywordHit: boolean;
  definitionAvailable: boolean;
  definitionId: string;
  definitionVersion: number;
}

export function decideTopology(input: TopologyDecisionInput): Recommendation<TopologyRecommendationValue> {
  const graphCandidate: TopologyRecommendationValue = {
    value: "orchestrator_subagent",
    definition_id: input.definitionId,
    definition_version: input.definitionVersion,
  };
  const sequentialCandidate: TopologyRecommendationValue = { value: "sequential" };

  const candidates: TopologyRecommendationValue[] = input.definitionAvailable
    ? [sequentialCandidate, graphCandidate]
    : [sequentialCandidate];

  const graphExcluded = input.definitionAvailable
    ? []
    : [{ id: input.definitionId, reason: "graph definition unavailable (TOPOLOGY_NOT_EXECUTABLE)" }];

  const shouldUseGraph = input.keywordHit && input.definitionAvailable;
  return {
    value: shouldUseGraph ? graphCandidate : sequentialCandidate,
    rule: "multi_perspective_keyword",
    candidates,
    excluded: graphExcluded,
  };
}

export interface AdapterEligibilityForNode {
  adapter: AgentConfigRecord;
  effectiveStatus: AdapterStatus;
  capabilitySatisfied: boolean;
}

export function evaluateAdapterForNode(
  adapter: AgentConfigRecord,
  override: AdapterWorkspaceStatusRecord | null,
  requiredCapabilities: AgentCapability[],
): AdapterEligibilityForNode {
  const effectiveStatus = effectiveAdapterStatus(adapter, override);
  const capabilitySatisfied = requiredCapabilities.every((cap) => hasCapability(adapter, cap));
  return { adapter, effectiveStatus, capabilitySatisfied };
}

export function buildNodeRoster(
  adapters: AgentConfigRecord[],
  overrides: AdapterWorkspaceStatusRecord[],
  nodeKey: string,
  requiredCapabilities: AgentCapability[],
): { candidates: string[]; excluded: { id: string; reason: string }[] } {
  const overrideByAdapterId = new Map(overrides.map((o) => [o.adapter_config_id, o]));
  const candidates: string[] = [];
  const excluded: { id: string; reason: string }[] = [];

  for (const adapter of adapters) {
    const eval_ = evaluateAdapterForNode(adapter, overrideByAdapterId.get(adapter.id) ?? null, requiredCapabilities);
    if (eval_.effectiveStatus === AdapterStatus.Available && eval_.capabilitySatisfied) {
      candidates.push(adapter.id);
    } else {
      const reasons: string[] = [];
      if (eval_.effectiveStatus !== AdapterStatus.Available) {
        reasons.push(
          adapter.status === AdapterStatus.Available && overrideByAdapterId.has(adapter.id)
            ? `workspace ${nodeKey === "sequential" ? "workspace" : "node"} unavailable via workspace override`
            : "not available in this workspace",
        );
      }
      if (!eval_.capabilitySatisfied) {
        const missing = requiredCapabilities.filter((cap) => !hasCapability(adapter, cap)).join(", ");
        reasons.push(`missing required capability: ${missing}`);
      }
      excluded.push({ id: adapter.id, reason: reasons.join("; ") });
    }
  }

  return {
    candidates: candidates.sort((a, b) => a.localeCompare(b)),
    excluded,
  };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) return line;
  }
  return "";
}

export function deriveTitleFromFirstLine(goal: string): Recommendation<string> {
  const firstLine = firstNonEmptyLine(goal);
  const collapsed = collapseWhitespace(firstLine);
  const chars = Array.from(collapsed);
  let value = collapsed;
  if (chars.length > TITLE_MAX_CHARS) {
    value = chars.slice(0, TITLE_MAX_CHARS - 1).join("") + TITLE_ELLIPSIS;
  }
  return {
    value,
    rule: "derive_title_from_first_line",
    candidates: [value],
    excluded: [],
  };
}

export function preserveGoalVerbatim(goal: string): Recommendation<string> {
  const value = goal.trim();
  return {
    value,
    rule: "preserve_goal_verbatim",
    candidates: [value],
    excluded: [],
  };
}

export function defaultPriority(): Recommendation<string> {
  return {
    value: IP.Normal,
    rule: "default_priority",
    candidates: [IP.Normal],
    excluded: [],
  };
}

export function deriveIssueDraft(goal: string): IssueDraft {
  return {
    title: deriveTitleFromFirstLine(goal),
    goal: preserveGoalVerbatim(goal),
    priority: defaultPriority(),
  };
}

export { IT, IP };
