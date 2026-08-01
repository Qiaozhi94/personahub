---
feature_ids: [F004, F005]
related_features: [F001, F002, F003]
topics: [design, data-model, agent-team-os]
doc_kind: design
created: 2026-07-11
updated: 2026-08-01
---

# PersonaHub 系统设计草案：数据模型

> Status: draft | Owner: TBD

## 与 PRD 的关系

本文档从 `docs/personahub-prd.md` 拆出，承载数据模型这类实现级别的设计内容。产品判断、范围和路线仍以 PRD 为唯一真相源（见 PRD 第 16 节"文档关系"）；本文档描述的是"如何实现"，会随实现推进比 PRD 更频繁地变化，字段增删、拆表、类型调整不需要同步修改 PRD。

PRD 第 5 节"核心概念"是这些实体的产品语义来源，本文档只补充字段级细节，不重复定义概念。

模块划分、运行时/进程模型、存储与通信层等"整体怎么搭"的设计见 `docs/personahub-architecture.md`，本文档不重复定义，只提供该文档引用的字段级 schema。

## 数据模型草案

> F004 (Autonomous Validation) 新增/修改字段以 `# F004` 标记，完整 schema 细节见 `docs/features/0.1/F004-autonomous-validation/design.md` §3-4。F005 (Manual Multi-Agent Routing) 新增/修改字段以 `# F005` 标记，完整 schema 细节见 `docs/features/0.1/F005-multi-agent-manual-routing/design.md` §3-4。

```text
Project
  id
  name
  description
  default_workspace_id
  default_coordinator_agent_id
  default_adapter_config_id  # F005: composer 省略 adapter_id 时的解析目标（AdapterResolver）；与自动 validator 的 ValidatorSelector 是两回事，不得合并
  created_at
  updated_at

Workspace
  id
  project_id
  local_path
  local_path_normalized
  git_branch
  lock_state
  locked_by_run_id
  locked_at
  push_credentials_enabled
  created_at
  updated_at

CoordinatorAgent
  id
  project_id
  agent_id
  default_topology_policy_json
  escalation_policy_json
  result_synthesis_policy_json

Issue
  id
  project_id
  workspace_id
  primary_thread_id
  issue_type
  workflow_template_id
  validation_policy_id
  title
  goal
  status
  owner_agent_id
  coordinator_agent_id
  priority
  labels
  validation_round_count
  blocked_reason_code        # F004: ValidationBlockReason | string | null
  blocked_reason_message     # F004: human-readable blocker description | null
  validation_dispatch_due_at # F005 §8.1: set in Phase A (implementation completed), cleared by the Phase B winner (manual pick or ValidationDispatchScheduler auto-claim); non-null means the grace window is still open. Indexed by idx_issues_validation_due.
  created_at
  updated_at

Thread
  id
  issue_id
  room_id
  thread_type
  title
  created_at
  updated_at

WorkRoom
  id
  issue_id
  thread_id
  phase
  goal
  topology
  leader_agent_id
  member_agent_ids_json
  input_contract_json
  output_contract_json
  evidence_requirements_json
  budget_policy_json
  termination_condition_json
  status
  created_at
  updated_at

ThreadEvent
  id
  event_sequence
  thread_id
  type
  actor_type
  actor_id
  payload_json
  evidence_refs
  created_at

HandoffPacket
  id
  issue_id
  thread_id
  from_agent_id
  to_agent_id
  to_room_id
  current_phase
  payload_json
  artifact_refs
  evidence_refs
  created_at

Agent (adapter_config)
  id
  project_id
  name
  role                     # deprecated：仅内部保留，永不出现在 public DTO；capability_tags 是 role 的真相源（见 F005 design §4.1）
  cli_provider             # F005: codex | claude-code | opencode（后两者为真实落地的第二/三 provider，非预留占位）
  command
  args
  capability_tags          # AgentCapability[]：implementation | validator；consult 不是可配置能力（任何 adapter 都能承接咨询）
  default_model
  status
  last_checked_at
  auth_type                # F005: oauth | api_key；provider 支持矩阵见 architecture.md §3
  model_provider           # F005: OpenCode api_key 模式下的 model provider（如 "openai"），走白名单校验
  api_key                  # F005: 原始 secret，internal-only（AgentConfigRecord），public DTO 永远没有这个字段
  auth_status_message      # F005: validate() 探测失败时的经清洗 message；成功时为 null
  created_at
  updated_at
  # F005 public DTO（AdapterConfig，非独立 DB 列）额外投影：
  #   has_api_key  — api_key 是否已配置（write-only 布尔投影，从不回显原值）
  #   is_default   — 与 Project.default_adapter_config_id 比对得出的 service 层计算字段
  #   effective_status / effective_last_checked_at / effective_auth_status_message / has_workspace_override
  #     — 仅 workspace-scoped API 返回，由 agent_configs 基线与下方例外覆盖合并得到

AdapterWorkspaceStatus        # F005 closure / schema v7；只存与 Project 级基线不同的例外
  adapter_config_id
  workspace_id
  status
  last_checked_at
  auth_status_message
  updated_at
  # PK(adapter_config_id, workspace_id)；无记录 = 使用 agent_configs.status 基线
  # 所有 workspace-scoped 路由判断统一经过 effectiveAdapterStatus()

WorkflowTemplate
  id
  name
  issue_type
  collaboration_topology
  agent_team_template_id
  validation_policy_id
  steps_json
  handoff_policy_json
  evidence_requirements_json
  status
  version
  created_at
  updated_at

AgentTeamTemplate
  id
  name
  issue_type
  roles_json
  default_assignments_json

ValidationPolicy
  id
  name
  issue_type
  pass_conditions_json
  fail_conditions_json
  evidence_requirements_json   # F004: ValidationEvidenceRequirements
  max_validation_rounds        # F004: default 3, 3rd failed -> Blocked
  status
  version
  created_at
  updated_at

Run
  id
  issue_id
  thread_id
  workspace_id
  adapter_config_id
  status
  failure_reason
  instructions
  started_at
  completed_at
  exit_code
  error_message
  role                    # F004: implementation | validator；F005 扩展新增 consult（见 shared/src/types/validation.ts RunRole）
  workflow_step           # F004: "implementation" | "validation" | null (derived from role)
  validation_round        # F004: round number for validator Runs; v5 partial unique idx (issue_id, validation_round) WHERE role='validator'
  dispatch_source         # F004: user_explicit | system；F005 扩展新增 user_default（composer 省略 adapter_id、走 Project default 解析时）
  purpose                 # F005: workflow_bound | ad_hoc_consult；workflow_bound 驱动 Issue 状态机与 round，ad_hoc_consult 从不驱动（即便 role 恰好命中 implementation/validator 的 capability）
  context_source_run_id   # F005: 本 Run 的 Handoff/evidence 上下文来自哪个 Run（通常是最近一次 completed implementation Run）；首个 Run 为 null
  final_message           # F004: validator final agent message (internal, not in public Run DTO)
  adapter_identity_json   # F004: snapshot of adapter config identity at Run creation
  created_at
  updated_at

EvidenceSummary         # F004: deterministic Done projection, one per Issue
  id
  issue_id
  thread_id
  validator_run_id
  implementation_run_id
  validation_result       # v5 CHECK 恒为 "passed"（Evidence Summary 仅在验证通过时生成）
  evidence_refs           # aggregated evidence refs (max 500, deduplicated)
  summary_markdown        # deterministic Markdown (max 256 KiB)
  same_origin_validation  # 1 if provider+model match, 0 otherwise; v5 CHECK: IN (0,1)
  implementation_identity_json   # AdapterIdentitySnapshot at Run creation
  validator_identity_json        # AdapterIdentitySnapshot at Run creation
  policy_id
  policy_version
  policy_snapshot_json    # complete policy snapshot at request time
  policy_snapshot_hash    # SHA-256 of canonical JSON; v5 CHECK: LIKE 'sha256:%'
  created_at

# Schema 当前版本 v7（v1→v7 顺序 migration）。F004 关键 DB invariant：
#   - evidence_summaries CHECK：validation_result='passed'、same_origin_validation IN (0,1)、
#     policy_snapshot_hash LIKE 'sha256:%'（SQLite 无法 ALTER-ADD CHECK，v5 create-copy-drop-rename 重建该表）
#   - idx_runs_one_active_validator (issue_id) WHERE role='validator' AND status IN (queued,running)
#     —— 同 Issue 至多一个活跃 validator
#   - idx_runs_validator_per_round (issue_id, validation_round) WHERE role='validator'
#     —— 同 Issue+round 至多一条 validator Run（terminal 也计），与 service 层唯一性（T093）双层保证
# F005（schema v6，server/src/db/schema-v6.ts）关键 DB invariant：
#   - idx_issues_validation_due (status, validation_dispatch_due_at) WHERE status='Validating' AND validation_dispatch_due_at IS NOT NULL
#     —— ValidationDispatchScheduler 每秒 tick 扫描到期 Issue 的查询索引
#   - agent_configs 新增 auth_type/model_provider/api_key/auth_status_message，SQLite ALTER ADD COLUMN（非 CHECK，校验在 service 层 validateAuthState()）
#   - runs 新增 purpose/context_source_run_id；projects 新增 default_adapter_config_id（无列级 FK，由 service 校验同 Project 且 available）
# F005 closure（schema v7，server/src/db/schema-v7.ts）关键 DB invariant：
#   - adapter_workspace_status PRIMARY KEY(adapter_config_id, workspace_id)
#   - 表只保存与 agent_configs.status 基线不同的例外；无行即回退基线
#   - effectiveAdapterStatus() 是 workspace-scoped availability 的统一合并入口

Artifact
  id
  issue_id
  thread_id
  room_id
  run_id
  artifact_type
  title
  storage_type
  uri_or_content_ref
  evidence_refs
  created_by_agent_id
  created_at
  updated_at

Memory
  id
  project_id
  source_issue_id
  source_thread_id
  source_event_ids
  type
  content
  confidence
  originating_input_trust_level
  human_confirmed
  created_by
  created_at

Skill
  id
  name
  trigger
  issue_type
  topology
  roles_json
  phase_plan_json
  instructions
  output_schema
  verification
  provenance_json

ProvenanceGateDecision
  id
  target_type
  target_id
  source_issue_id
  source_thread_id
  source_event_ids
  input_trust_level
  decision
  decided_by
  created_at
```
