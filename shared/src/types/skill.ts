// F013: Skill 与 Skill revision 的存储行与读取视图（FR-005 / FR-008）。
// canonical revision schema（Requirement / Step / EvidenceSpec DTO）定义在
// server/src/services/skill-revision-schema.ts——evidence_kind 必须引用
// server/src/evidence-ref.ts 的 EvidenceRefKind 唯一真相源，不能在 shared
// 侧复制第二份 kind 清单，因此结构化要求类型不进 shared。

export type SkillSourceKind = "builtin" | "user" | "legacy-workflow";

/** skills 行。state 是全局意图（active / disabled）；per-Space 生效结果在 skill_space_state。 */
export interface Skill {
  id: string;
  /** NULL 表示内置 / 全局 Skill（所有 Space 可见）。 */
  space_id: string | null;
  display_name: string;
  source_kind: SkillSourceKind;
  /** 跨扫描稳定的来源身份（包内路径 / 创建时 ULID / workflow:<旧id>）。 */
  source_identity: string;
  current_revision: number;
  state: SkillGlobalState;
  created_at: string;
  updated_at: string;
}

export type SkillGlobalState = "active" | "disabled";

/** skill_space_state 行：该 Skill 在某个 Space 的生效结果（design §3 冲突消解闭环）。 */
export interface SkillSpaceState {
  skill_id: string;
  space_id: string;
  state: SkillSpaceEffectiveState;
  updated_at: string;
}

export type SkillSpaceEffectiveState = "active" | "shadowed" | "conflict";

/** skill_revisions 读取视图（不含 JSON 正文列的解析结果）。 */
export interface SkillRevision {
  skill_id: string;
  version: number;
  title: string | null;
  description: string | null;
  capability_tags: string[];
  /** 有 steps 即投影为编组（FR-005）。 */
  has_steps: boolean;
  step_count: number;
  requirement_count: number;
  source_locator: string | null;
  content_hash: string;
  published_at: string | null;
  created_at: string;
}

/** skill_revision_files 只读清单（FR-008 只读文件）。 */
export interface SkillRevisionFileMeta {
  rel_path: string;
  content_hash: string;
  size_bytes: number;
}

/** skill_delivery_status 行：下发身份属于安装 (runtime_id, cli_provider)，不属于配置。 */
export interface SkillDeliveryStatus {
  skill_id: string;
  version: number;
  runtime_id: string;
  cli_provider: string;
  state: SkillDeliveryState;
  target_path: string | null;
  native_format: string | null;
  detail: string | null;
  attempted_at: string | null;
  updated_at: string;
}

export type SkillDeliveryState = "pending" | "delivered" | "unsupported" | "failed";

export interface SkillListResponse {
  skills: SkillListItem[];
}

/** GET /api/skills 的行：全局意图 + 当前 Space 的生效结果两层并报（design §3）。 */
export interface SkillListItem extends Skill {
  /** 请求 Space 内的生效状态；全局 Skill 无行时为 null（保守处理为不可用）。 */
  space_state: SkillSpaceEffectiveState | null;
  /** Current published revision projection used by the capability table. */
  has_steps: boolean;
  step_count: number;
  requirement_count: number;
}

export interface SkillRevisionListResponse {
  revisions: SkillRevision[];
}

export interface SkillRevisionDetailResponse {
  revision: SkillRevision;
  steps: unknown;
  completion_requirements: unknown;
}

export interface SkillRevisionFilesResponse {
  files: SkillRevisionFileMeta[];
}

export interface SkillDeliveryListResponse {
  deliveries: SkillDeliveryStatus[];
}

export interface SkillScanResponse {
  scanned: number;
  conflicts_detected: number;
}

export interface SkillConflictResolveInput {
  space_id: string;
  /** 该 Space 内保留为 active 的 Skill id；同组其余成员置 shadowed。 */
  keep_skill_id: string;
}

/** GET /api/skills/:id/effective-requirements?version=<n>（F012 消费的只读契约的 HTTP 面）。 */
export interface EffectiveRequirementsResponse {
  skill_id: string;
  version: number;
  capability_requirements: unknown[];
  completion_requirements: unknown[];
}

export interface ProjectSkillRef {
  project_id: string;
  skill_id: string;
  is_default: boolean;
  pinned_version: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDefaultSkillInput {
  skill_id: string;
  pinned_version?: number | null;
}
