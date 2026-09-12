---
feature_ids: [F004, F005, F006, F007, F008]
related_features: [F001, F002, F003, F009, F010, F011, F012, F013, F014]
topics: [design, data-model, sqlite, migration]
doc_kind: design
created: 2026-07-11
updated: 2026-09-08
---

# PersonaHub 系统设计：数据模型

## 1. 文档边界

本文是字段、表和数据关系的实现级索引。产品语义与路线以 `personahub-prd.md` 为准；进程、模块和通信边界以 `personahub-architecture.md` 为准；单 Feature 的最终字段以其 `design.md` 为准。

本文严格区分：

- **已实现**：当前代码和 SQLite schema v11 的事实。
- **v0.3 目标**：F009 先完成零业务表变更的生产前端迁移；V3.44 新领域模型由 F010–F014 计划引入，尚未实现，字段名可在开发前设计检视中调整。

不得把目标模型写成当前已交付能力，也不得因旧表仍存在就把已取消概念继续暴露给 UI。

## 2. 已实现基线：schema v11

唯一版本常量是 `server/src/db/migrations.ts` 的 `CURRENT_SCHEMA_VERSION = 11`。Migration v1→v11 顺序执行；已发布 migration 文件不可修改，只能新增后续版本。

### 2.1 表清单

| 表 | 当前职责 | 来源版本 |
|---|---|---|
| `projects` | 项目及默认代码目录 / adapter 配置 | v1、v6 |
| `workspaces` | 项目内本地代码目录、分支与写锁 | v1、v2 |
| `workflow_templates` | coding workflow 版本与激活 | v1、v10 |
| `validation_policies` | 验证条件与轮次上限 | v1 |
| `issues` | 任务、状态、验证轮次与阻塞调度期限 | v1、v4、v6 |
| `threads` / `thread_events` | 每个任务的主 Thread 与顺序事件 | v1 |
| `agent_configs` | 历史“AI 成员 / adapter config”混合记录 | v2、v6 |
| `runs` | 单次 CLI 进程执行与验证 attempt | v2、v4、v6、v8、v11 |
| `run_trace_states` / `run_file_changes` | Trace 最终化与文件变化 | v3 |
| `evidence_summaries` | 验证通过后形成的确定性完成摘要 | v4、v5 |
| `adapter_workspace_status` | adapter 在代码目录范围内的状态覆盖 | v7 |
| `graph_runs` / `node_runs` | F006 可恢复执行图、节点与 Attempt 归属 | v8 |
| `intake_confirmations` | F007 签名推荐的一认领 | v9 |
| `app_secrets` | 与数据库同生命周期的 HMAC secret | v9 |
| `admin_audit_events` | Workflow 管理的全局审计 | v10 |

### 2.2 当前关键关系

```text
Project 1 ── N Workspace
Project 1 ── N Issue
Issue   1 ── 1 primary Thread
Thread  1 ── N ThreadEvent
Issue    1 ── N Run
Run     1 ── 0..1 RunTraceState
Run     1 ── N RunFileChange
Issue   1 ── 0..1 EvidenceSummary
Issue   1 ── N GraphRun
GraphRun 1 ── N NodeRun
NodeRun  1 ── N Run (Attempt)
```

这是历史实现关系，不是最终 UI 语言。特别是 `primary Thread`、`validation_policy_id`、`agent_configs.role` 仅代表当前数据库形状。

### 2.3 当前数据库不变量

- 每个 Issue 最多一个 primary Thread。
- 同一 Issue 最多一个 active validator。
- v11 后 validator 唯一键为 `(issue_id, validation_round, validation_attempt)`；attempt 失败不消耗新的 validation round。
- 同一 Issue 最多一个非终态 GraphRun。
- 同一 NodeRun 最多一个 active Attempt。
- 每个 issue type 最多一个 active WorkflowTemplate，同一 `(issue_type, version)` 唯一。
- EvidenceSummary 只在 passed 时存在，保存实现 / 验证执行身份、策略快照 hash 与去重 evidence refs。
- `adapter_workspace_status` 只存相对 `agent_configs.status` 的例外；统一经 effective status 合并。

## 3. v0.3 目标对象模型

F009 不新增目标对象或业务字段，只把当前 schema 的 Project / Issue / Thread / Run / Trace / Evidence 通过受控兼容投影接入 V3.44 壳层。下列新对象从 F010 开始引入。

V3.44 与 ADR 0012 取消了 AI 成员、Primary / Project Thread、独立 Validation Policy 和独立 Squad 类型。目标关系如下：

```text
Space
├─ Project 0..N
├─ Issue 0..N (project_id nullable)
├─ Skill 0..N
└─ Memory 0..N

Issue
├─ Session(Room) 1..N ── 1 Thread
├─ Dispatch 0..N ── Attempt(Run) 0..N
├─ GraphRun / NodeRun
├─ Artifact ── ArtifactRevision
└─ Claim ── Argument ── EvidenceRef

Runtime
└─ RuntimeMachine 1..N
   └─ AdapterInstallation 0..N
      └─ AdapterAccess 1..N
```

v0.3 首批只要求一个 Space 和一台执行机器，但表 / API 不应重新把它们硬编码成 Project 或浏览器进程的属性。

## 4. F010 目标：Artifact 与可信结构

建议形状，最终以 F010 design 为准：

```text
artifacts
  id, issue_id, thread_id, type, title, current_revision, state,
  created_by,
  created_at, updated_at

artifact_revisions
  artifact_id, revision, storage_kind,
  inline_content | (source_relative_path, archive_relative_path),
  content_hash, source_run_id,
  created_by, idempotency_key, request_fingerprint, created_at

artifact_consumptions
  artifact_id, revision, dispatch_id, run_id, purpose, consumed_at

artifact_evidence_links
  artifact_id, revision, evidence_ref

artifact_maintenance_leases
  name, owner_id, expires_at_ms

claims
  id, issue_id, requirement_key, statement, source_kind, state

arguments
  id, claim_id, rationale, created_at

claim_evidence_links
  claim_id, argument_id, evidence_ref, relation, independence
```

F010 冻结约束：Artifact 以 `issue_id` 为唯一归属，Project / Workspace 由 Issue 推导；现有 `runs` 行即 Attempt，因此 revision 只保存 `source_run_id`，不创建悬空的 `source_attempt_id`。文件 revision 分存可变 source locator 与 content-addressed archive locator；`(artifact_id, idempotency_key)` 唯一，消费主键固定到确定 revision。完整字段约束、发布协议与错误语义以 F010 `design.md` 为准。

不变量：revision 发布后不可变；进入 Dispatch 的 ref 必须带 revision；不存在 / 越权 / hash 不符不得解析成“当前内容”。Claim 状态是证据投影，不是百分比。

## 5. F012 目标：会话、派工与运行时

```text
sessions (domain name: rooms)
  id, issue_id nullable, title, state, created_at, ended_at

threads
  ... existing fields ...
  room_id UNIQUE NOT NULL

dispatches
  id, issue_id, room_id, runtime_id,
  adapter_installation_id, adapter_access_id, model, depth,
  context_scope, handoff_json,
  skill_revision_refs_json, requirement_snapshot_json,
  state, start_deadline_at, created_at, dispatched_at

dispatch_context_items
  dispatch_id, source_ref, disposition, reason, token_count

runtime_machines
  id, hostname, status, last_seen_at

adapter_installations
  id, runtime_id, provider, cli_version, capabilities_json, status

adapter_accesses
  id, installation_id, name, base_url nullable,
  auth_type, billing_mode, credential_ref, status
```

`runs` 逐步改为 Attempt 记录并引用 `dispatch_id`；旧 `adapter_config_id` 保留兼容映射。组合身份是 installation + access + model + depth，`runtime_id` 单独进入快照。

不变量：Dispatch 提交后身份与上下文快照不可变；starting 可在 deadline 前取消且不产生 Run；换上下文范围必须冷启动；Room / Session 不复制执行状态。

## 6. F013 目标：项目仓库与 Skills

```text
repositories
  id, canonical_path nullable, remote_url nullable, display_name, kind

repository_machine_paths
  repository_id, runtime_id, resolved_path, access

project_repositories
  project_id, repository_id, role(main|reference), read_scope, write_scope

skills
  id, source_id, current_revision, state

skill_revisions
  skill_id, revision, name, description,
  required_capabilities_json, steps_json nullable,
  completion_requirements_json, source_manifest_json, content_hash

project_skill_refs
  project_id, skill_id, revision nullable, is_default
```

有 `steps_json` 即投影为编组，不另建 Squad 表。项目只保存 Skill ref。旧 WorkflowTemplate 无法无损映射的字段保存在 legacy attachment，不猜测填入新字段。

## 7. Memory 目标模型

字段和状态机由 ADR 0016 与 `personahub-memory-design.md` 拥有。核心表族：

- `memories`：当前条目、scope、type、stance、state。
- `memory_revisions`：append-only 正文与来源包。
- `memory_write_rejections`：被白名单 / Provenance Gate 拒绝的写入。
- `memory_edges`：已解析目标的关系。
- `memory_retrieval_events` / `memory_adoption_events`：展示、引用、采纳和帮助证据。

Memory 不在 v0.3 实现；F009 不预留 Memory 假数据，F010–F014 只需确保验收事件、Artifact 与 Dispatch 上下文具备将来的来源数据。

## 8. 自动化与统计目标

v0.4 引入：

```text
automation_rules
  trigger_config, model, depth, task_markdown_revision, project_id, enabled

automation_invocations
  rule_id, trigger_event, admission_result, issue_id nullable, replayed_from

run_usage
  attempt_id, run_id, dispatch_id, issue_id, project_id,
  adapter, model, depth, context_scope, step_kind,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_micro_usd, cost_source, billing_mode, started_at, ended_at
```

每个有效自动化触发必须创建普通 Issue；入口拒绝不产生 Run。`run_usage` 一行代表一次 Attempt × model，不预建多租户 rollup。历史成本在写入时固化，价表变化不重算。

## 9. Migration 与兼容纪律

1. 每个新版本从 `CURRENT_SCHEMA_VERSION` 真实值顺延；设计稿不得预占数字。
2. 已发布 migration 文件永不修改；升级器覆盖 v1 至当前每个发布版本。
3. 移除 UI 概念不等于立即删列。先停止新写、建立目标表与兼容读，再迁移和删除。
4. 旧 ID、终态、时间、原始 payload、Evidence ref 与 Run trace 必须守恒。
5. 不能无损映射时写 `legacy` / `unknown` 与原始来源，不根据当前配置推断历史。
6. migration 可重入；文件系统副作用必须有 journal 或可确定恢复协议。
7. F014 输出 migration report，但不拥有业务表。

## 10. 数据安全

- 所有本机路径在授权前解析到真实路径；保存规范化形式与必要的展示形式。
- 密钥不出现在公共 DTO、事件、错误、导出和诊断包。当前 `agent_configs.api_key` 为明文 SQLite 列，系统诊断必须如实提示；后续 `credential_ref` 迁移需单独设计。
- 插件来源字段与核心数据分离；停用只影响当前激活，不改历史快照。
- 删除配置、仓库、Skill、项目或 Memory 前检查引用；历史执行与证据不可级联删除。

## 11. 文档更新触发

任何 migration、表职责或跨对象关系改变时同步更新本文件。仅改变单 Feature 内部实现而未改变全局字段语义时，更新对应 Feature design 即可。
