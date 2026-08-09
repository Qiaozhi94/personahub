// F007: Coordinator Agent & Routing Recommendation — shared DTOs.
// These are the cross-process contract between the routing-recommendation
// service (server) and the Intake UI (web). Signatures live in design.md §1,
// §3, §5, §9. The recommendation phase is strictly read-only; persistence
// happens only on confirm, and the only durable token identity is `nonce`.

import type { AdapterStatus, AgentCapability, IssueType } from "./index.js";

/** 统一推荐形状 (design §3). Every dimension is returned with the rule that
 *  produced its value, the full candidate set, and the excluded items + reasons. */
export interface Recommendation<T> {
  value: T;
  rule: string;
  candidates: T[];
  excluded: { id: string; reason: string }[];
}

/** Issue-draft 规则 (design §3「Issue 字段的确定性规则」) — each field is
 *  itself a Recommendation so candidates stay visible even when the set is 1. */
export interface IssueDraft {
  title: Recommendation<string>;
  goal: Recommendation<string>;
  priority: Recommendation<string>;
}

/** 阻塞原因 (design §8/§9). A recommend call returns 409 with one of these
 *  structured codes plus a suggested action instead of a fabricated plan. */
export type IntakeBlockReason = "no_available_adapter" | "no_available_capable_adapter" | "project_workspace_required";

/** 单个 adapter 的前提快照条目 (design §5). Capability AND availability must
 *  both be snapshotted — capability changes are not availability-relevant
 *  (adapter-config-updater.ts), so only comparing availability would miss a
 *  stripped `implementation` capability. `updated_at` is a stable revision. */
export interface PremiseAdapterState {
  effective_status: AdapterStatus;
  capability_tags: AgentCapability[];
  updated_at: string;
}

/** 推荐前提快照 (design §5). Only snapshots adapters actually referenced by
 *  the recommendation, never the whole table — an unrelated adapter's probe
 *  convergence must not invalidate a recommendation. */
export interface RecommendationPremise {
  project_id: string;
  workspace_id: string;
  adapters: Record<string, PremiseAdapterState>;
  workflow_template_id: string;
  workflow_template_version: number;
  graph_definition_id: string | null;
  graph_definition_version: number | null;
}

/** 协作拓扑推荐值 (design §7). When `orchestrator_subagent` is recommended the
 *  value carries F006's definition_id + version. */
export interface TopologyRecommendationValue {
  value: "sequential" | "orchestrator_subagent";
  definition_id?: string;
  definition_version?: number;
}

/** 可编辑拓扑的键（v0.2 仅此二者）。 */
export type CollaborationTopology = "sequential" | "orchestrator_subagent";

/** AgentRosterRecommendation (design §3/§9) — 专用 DTO，非通用
 *  Recommendation<Record<string,string>>。候选与排除原因按节点区分：同一
 *  adapter 可以对节点 A 是候选、对节点 B 因缺能力被排除；value 与 by_node 的
 *  键集合必须严格一致（sequential 分支为 { "sequential" }，图分支为 definition
 *  全部 node_key 含 synthesis）。 */
export interface AgentRosterRecommendation {
  value: Record<string, string>;
  rule: string;
  by_node: Record<
    string,
    {
      candidates: string[];
      excluded: { id: string; reason: string }[];
    }
  >;
}

/** 推荐五维度 (design §1/§9). token payload 的 `recommended` 必须携带与
 *  RecommendResponse 相同的这组五维度。 */
export interface RoutingRecommendation {
  issue_type: Recommendation<IssueType>;
  issue_draft: IssueDraft;
  workflow_template: Recommendation<{ id: string; version: number }>;
  collaboration_topology: Recommendation<TopologyRecommendationValue>;
  agent_roster: AgentRosterRecommendation;
}

/** ConfirmationToken payload (design §1). `nonce` 每次签发全新，是确认的唯一
 *  身份；`premise` 与 `recommended` 都是签名保护的可信前提。 */
export interface ConfirmationTokenPayload {
  nonce: string;
  issued_at: string;
  project_id: string;
  workspace_id: string;
  premise: RecommendationPremise;
  recommended: RoutingRecommendation;
}

/** ConfirmationToken (design §1). 推荐阶段零写入——token 的唯一副本在客户端
 *  手里，因此必须由服务端 HMAC 签名；验签失败整体拒绝。 */
export interface ConfirmationToken {
  payload: ConfirmationTokenPayload;
  signature: string;
}

/** 用户最终选择 (design §9) — 判别联合，topology 与 roster 形状绑死，
 *  zod 在 HTTP 边界就拒绝内部不一致的组合。 */
export type ChosenPlan =
  | { topology: "sequential"; adapter_config_id: string }
  | {
      topology: "orchestrator_subagent";
      definition_id: string;
      definition_version: number;
      /** 键必须恰好等于 definition 的节点集。 */
      node_assignments: Record<string, string>;
    };

/** 推荐值与用户最终选择的差异条目 (design §6 TR-001)。用户全盘接受时为空数组。 */
export interface ConfirmDiff {
  field: string;
  recommended: unknown;
  chosen: unknown;
}

/** POST .../intake/confirm 201 响应 (design §9)。 */
export interface ConfirmResponse {
  issue_id: string;
  target_kind: "graph" | "run";
  target_id: string;
  diff: ConfirmDiff[];
}

/** POST .../intake/recommend 200 响应 (design §9)。editable 由服务端返回，
 *  前端不得自行假定；v0.2 仅 collaboration_topology / agent_roster 可改。 */
export interface RecommendResponse {
  token: ConfirmationToken;
  /** 内容摘要，仅供显示/日志；既不是身份也不是校验依据 (design §1/§5)。 */
  recommendation_id: string;
  issue_type: Recommendation<IssueType>;
  issue_draft: IssueDraft;
  workflow_template: Recommendation<{ id: string; version: number }>;
  collaboration_topology: Recommendation<TopologyRecommendationValue>;
  agent_roster: AgentRosterRecommendation;
  /** 每个可编辑 topology 各自的 roster。仅包含实际被推荐/可选的 topology：当
   *  图 definition 不可用时只含 `sequential`。UI 在用户切换 topology 时用对应
   *  roster 重建可编辑执行者集合，避免沿用被推荐 topology 的 roster 产生非法计划。 */
  rosters_by_topology: Partial<Record<CollaborationTopology, AgentRosterRecommendation>>;
  editable: ("collaboration_topology" | "agent_roster")[];
}

/** POST .../intake/recommend 409 阻塞响应 (design §9). 阻塞原因经标准的
 *  ApiError envelope 传递，`details.suggested_action` 承载建议动作。 */
export interface RecommendBlocked {
  error: {
    code:
      | "NO_AVAILABLE_ADAPTER"
      | "NO_AVAILABLE_CAPABLE_ADAPTER"
      | "PROJECT_WORKSPACE_REQUIRED"
      | "TOPOLOGY_NOT_EXECUTABLE";
    message: string;
    details?: Record<string, unknown>;
  };
}
