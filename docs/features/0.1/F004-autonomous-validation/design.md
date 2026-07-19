---
feature_ids: [F004]
related_features: [F001, F002, F003, F005]
topics: [autonomous-validation, workflow-engine, validator, evidence-summary, issue-state, recovery]
doc_kind: design
created: 2026-07-16
updated: 2026-07-19
---

# F004：Autonomous Validation - 设计

> Status: in-progress | Owner: Sisyphus | Spec: `spec.md`

> 2026-07-19 final review reopened T090-T095. The architecture remains accepted, but production context wiring, blocked outcome submission, complete summary/export, per-round validator uniqueness, explicit round reset, and schema invariants must land before final verification.

## 1. 技术概要

F004 在 F003 已统一的 Run terminal finalization 出口之后增加最小 sequential workflow engine。Implementation Run 只有在 file change/handoff 已完成持久化后，才会触发 validator；validator terminal Run 则由同一 engine 解析最终回答、校验 evidence、提交 validation outcome。

```text
implementation Run completed
  -> F003 finalizeRun (file changes + handoff, lock still held)
  -> release workspace lock
  -> ValidationWorkflowService.requestValidation()
       Issue Running -> Validating
       validation.requested
       create validator Run (queued)
  -> normal workspace queue dispatch

validator Run completed
  -> F003 finalizeRun
  -> release workspace lock
  -> ValidationWorkflowService.processValidatorRun()
       parse strict result
       validate evidence refs / policy
       passed  -> validation.passed + EvidenceSummary + issue.done + Done
       failed  -> findings + validation.failed + round++ + Running
       blocked -> validation.blocked + blocker + Blocked
```

核心选择：

- 不引入通用 DAG engine；新增的 `ValidationWorkflowService` 只实现 coding workflow 的 implementation/validator 两步闭环。
- F003 `ThreadEvent` 和 typed evidence ref 仍是 evidence 真相源；`evidence_summaries` 是 Done projection，不取代原始事件。
- Validator 输出采用唯一、严格的 JSON envelope；只从 adapter 提供的 final agent message 解析，不从混合 stdout、command output 或自由 Markdown 猜结论。
- Validation fail 不自动创建修复 Run；Issue 回到 `Running`，findings 由下一次用户发起的 implementation Run 自动带入。
- 状态、result events、findings、round count、blocker、Evidence Summary 在一个 SQLite transaction 内提交，commit 后再广播。
- 自动 validator Run 也走 F002/F003 的普通 queue、workspace lock、credential isolation、trace/finalization，不建立旁路执行器。

## 2. 当前基线与影响面

### 2.1 上游可复用能力

| 能力 | 来源 | F004 用法 |
| --- | --- | --- |
| Issue/Thread/ThreadEvent 与状态字段 | F001 | 状态机和 UI 真相源 |
| Run CAS、queue、workspace lock、adapter registry | F002 | validator Run 生命周期 |
| terminal finalization 唯一出口 | F003 design Phase 7 | evidence 完成后触发 workflow |
| command/test/file/handoff evidence | F003 | validator context 和 Done gate |
| typed evidence refs / scope validation | F003 | findings、result、summary 引用校验 |
| `ValidationTraceService` | F003 | validation event payload 基础 contract |
| trace cards / Inspector evidence section | F003 | 扩展 validation 与 Done 展示 |

### 2.2 必须建立的边界

1. `RunService` 仍只负责 Run CAS 和 run event；不得自行判断 implementation/validator outcome。
2. `RunDispatchService.finalizeAndDrain()` 在 F003 finalization 和 unlock 后调用 workflow hook；hook 失败必须收敛为 Blocked，不能让 adapter callback 抛出未处理异常。
3. Validator Run 的非零退出、超时、取消、中断、无法解析都不是普通 validation fail；它们意味着本轮无法形成可信判断，统一进入 `Blocked`。
4. Implementation Run failed/cancelled/interrupted 不触发 validation，Issue 保持 `Running`（若 escalation 已置 Blocked 则保持 Blocked）。
5. 用户创建 Run 不能伪造 `role=validator`、`workflow_step`、`validation_round`、`dispatch_source` 或 validation result；F004 的 validator Run 只由 workflow service 创建。Done/Validating/Blocked Issue 的公开 implementation Run 创建在 service transaction 内拒绝，不能依赖稍后的 queue cancellation 兜底。

F004会把F003 terminal出口的最终顺序明确调整为：`trace finalize -> release lock -> workflow hook -> drain next queued Run`。Workflow hook必须早于queue drain：否则旧队列中的implementation/consult Run可能先启动，validator创建顺序会漂移；若validator结果需要把Issue置Blocked，也来不及在drain前取消不再eligible的queued Run。Hook无论成功或收敛为Blocked，最外层`finally`都必须继续执行queue drain，不能制造新死锁。

### 2.3 文件影响面

- **shared**：validation domain types、Run role/round、Issue blocker 字段、API contracts、错误码。
- **server/db**：schema v4、Evidence Summary 表、Run/Issue 字段和 active validator 唯一索引。
- **server/repositories**：evidence summary；Issue/Run/adapter/policy/workflow 查询与 CAS 扩展。
- **server/services**：validator selection、context builder、result parser、policy gate、workflow state machine、unblock/query。
- **server/runtime**：final agent message contract；Fake/Codex adapter 输出终态结构化文本。
- **server/api**：validation status、summary、unblock、显式触发默认 validator。
- **web**：validation hooks、Thread cards、Inspector validation panel、blocked recovery dialog。
- **tests/docs**：状态机、事务、race/recovery、UI 和全局设计回写。

## 3. 共享类型与领域 Contract

新增 `shared/src/types/validation.ts` 并从 `types/index.ts` re-export。

```ts
export enum RunRole {
  Implementation = "implementation",
  Validator = "validator",
}

export enum RunDispatchSource {
  UserExplicit = "user_explicit",
  System = "system",
}

export enum AdapterRole {
  Implementation = "implementation",
  Validator = "validator",
}

export enum ValidationOutcome {
  Passed = "passed",
  Failed = "failed",
  Blocked = "blocked",
}

export enum ValidationBlockReason {
  ValidatorUnavailable = "validator_unavailable",
  ValidatorRunFailed = "validator_run_failed",
  ResultUnparsable = "result_unparsable",
  EvidenceMissing = "evidence_missing",
  EvidenceScopeMismatch = "evidence_scope_mismatch",
  RoundLimitReached = "round_limit_reached",
  WorkflowConfigurationInvalid = "workflow_configuration_invalid",
  RecoveryInconsistent = "recovery_inconsistent",
}

export interface ValidationFinding {
  severity: ValidationFindingSeverity;
  message: string;
  suggestion: string | null;
  evidence_refs: string[];
  file_path: string | null;
  line: number | null;
}

export interface ValidationResultEnvelope {
  schema_version: 1;
  outcome: ValidationOutcome;
  summary: string;
  findings: ValidationFinding[];
  evidence_refs: string[];
  missing_evidence: string[];
  key_decisions: string[];
  lessons_candidate: string[];
}

export interface AdapterIdentitySnapshot {
  adapter_config_id: string;
  name: string;
  cli_provider: string;
  default_model: string | null;
}

export interface ValidationPolicySnapshot {
  policy_id: string;
  version: number;
  max_validation_rounds: number;
  evidence_requirements: ValidationEvidenceRequirements;
}

export interface ValidationEvidenceRequirements {
  require_handoff: boolean;
  require_file_trace: boolean;
  require_verification: boolean;
  accepted_verification_kinds: VerificationKind[];
}
```

`Run` 增加：

```ts
role: RunRole
workflow_step: "implementation" | "validation" | null
validation_round: number | null
dispatch_source: RunDispatchSource
adapter_identity: AdapterIdentitySnapshot | null
```

`adapter_identity` 在每条新 Run 创建 transaction 内从已校验的 adapter config 固化，不含 command/args/env/credential；v1-v3 历史 Run 迁移后允许为 `null`。Same-origin、Evidence Summary 和恢复路径只读取 Run snapshot，不重新读取可变的 `agent_configs`。公开创建 input 不接受该字段；公共 Run DTO 只在确有 UI 需要时返回这份无凭据 snapshot。

`workflow_step` 完全由 `role` 派生，创建 Run 时按下表固化，不接受客户端传入，也不独立于 `role` 变化：

| `role` | `workflow_step` | 引入 |
| --- | --- | --- |
| `implementation` | `"implementation"` | F004（含 v4 迁移把历史 Run 归为此值） |
| `validator` | `"validation"` | F004（§6.2 创建 validator Run 时写入） |
| `consult` | `null` | F005（consult Run 不属于任何 workflow step） |

即 `workflow_step` 是 `role` 的展示派生列（`consult -> null`，其余同名映射）；任何创建路径都必须与 `role` 一致，二者不得出现 `role=consult` 却 `workflow_step` 非空之类的组合。

F003 已经持久化 `validation.requested/finding/passed/failed/blocked` 五类枚举，F004 复用并扩展其 payload contract，不重复新增。F004 只新增以下持久化枚举值：

```ts
IssueDone = "issue.done"
IssueUnblocked = "issue.unblocked"
ValidationRoundReset = "validation.round_reset"
```

`Issue` 增加：

```ts
blocked_reason_code: ValidationBlockReason | string | null
blocked_reason_message: string | null
```

F004 不把 `validation_status` 冗余到 Issue；它由 `Issue.status`、active validator Run 和 latest validation event 推导。`validation_round_count` 表示已经形成 `failed` 结果的轮次数；首次 validation request 使用 round `1`，fail 提交后 count 从 `0` 变为 `1`。

## 4. 数据模型 / Migration

### 4.1 Schema v4

新增 `server/src/db/schema-v4.ts`，在 F003 v3 后执行：

```sql
ALTER TABLE runs ADD COLUMN role TEXT NOT NULL DEFAULT 'implementation';
ALTER TABLE runs ADD COLUMN workflow_step TEXT;
ALTER TABLE runs ADD COLUMN validation_round INTEGER;
ALTER TABLE runs ADD COLUMN dispatch_source TEXT NOT NULL DEFAULT 'user_explicit';
ALTER TABLE runs ADD COLUMN final_message TEXT;
ALTER TABLE runs ADD COLUMN adapter_identity_json TEXT;

ALTER TABLE issues ADD COLUMN blocked_reason_code TEXT;
ALTER TABLE issues ADD COLUMN blocked_reason_message TEXT;

CREATE TABLE IF NOT EXISTS evidence_summaries (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  validator_run_id TEXT NOT NULL REFERENCES runs(id),
  implementation_run_id TEXT NOT NULL REFERENCES runs(id),
  validation_result TEXT NOT NULL CHECK (validation_result = 'passed'),
  evidence_refs TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  same_origin_validation INTEGER NOT NULL CHECK (same_origin_validation IN (0, 1)),
  implementation_identity_json TEXT NOT NULL,
  validator_identity_json TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_snapshot_json TEXT NOT NULL,
  policy_snapshot_hash TEXT NOT NULL CHECK (policy_snapshot_hash LIKE 'sha256:%'),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_validator
  ON runs(issue_id)
  WHERE role = 'validator' AND status IN ('queued', 'running');

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_validator_per_round
  ON runs(issue_id, validation_round)
  WHERE role = 'validator';

CREATE INDEX IF NOT EXISTS idx_runs_issue_role_created
  ON runs(issue_id, role, created_at DESC);
```

`implementation_identity_json` 与 `validator_identity_json` 都使用 `AdapterIdentitySnapshot` 的固定形状：

```json
{
  "adapter_config_id": "...",
  "name": "Codex Reviewer",
  "cli_provider": "codex",
  "default_model": "gpt-5"
}
```

约束与兼容：

- v1-v3 Run 全部迁移为 implementation/user_explicit；这是对已有行为的真实解释。历史 `adapter_identity_json` 可为 null，新建 Run 由 service 强制非空。
- `issue_id UNIQUE` 保证 Done projection 每个 Issue 只有一份。F004 不支持 reopen；重放 terminal hook 使用 `INSERT ... ON CONFLICT DO NOTHING` 加状态 CAS，不能覆盖历史 Done 证据。
- active validator partial unique index既保护 F004 重复 callback，也直接成为 F005 手动/自动互斥的数据库底线。
- per-round unique index 关闭 validator terminal 到 result transaction 之间的并发空窗；同一 Issue/round 无论 Run 已 queued、running 还是 terminal，都不得创建第二条 validator Run。显式补建与 recovery 必须先处理或返回已有 current-round Run。
- Evidence Summary 是 Done projection，`validation_result` 在 v0.1 只能为 `passed`；failed/blocked 只存在于 ThreadEvent，不创建伪 Done summary。
- migration 前若意外已有重复 pending validator（理论上旧 schema 无 role，不会出现），迁移测试必须失败并报告，不静默删除数据。
- SQLite `ALTER TABLE` 和建表在 migration transaction 内执行；版本号只在全部成功后更新。
- F004 尚未合并/发布时可直接修订 v4 建表与索引；若任何已保留数据库已经记录 schema version 4，则必须新增 v5 migration 落这些 invariant，不能只改 `schema-v4.ts` 后假设旧库会重跑。

### 4.2 Workflow 与 ValidationPolicy seed

v4 migration 只在默认记录仍为 v1 seed 形态时更新，不覆盖用户未来自定义值：

```json
// workflow_templates.steps_json
{
  "schema_version": 1,
  "steps": [
    { "id": "implementation", "role": "implementation" },
    { "id": "validation", "role": "validator" }
  ]
}
```

```json
// validation_policies.evidence_requirements_json
{
  "schema_version": 1,
  "require_handoff": true,
  "require_file_trace": true,
  "require_verification": true,
  "accepted_verification_kinds": ["test", "lint", "typecheck", "build"]
}
```

P0 pass gate 要求：本轮 implementation 有 `handoff.created`、file trace 为 complete/partial 且有 `file-change-set:` ref、至少一条 confirmed `test.completed`（其 `kind ∈ accepted_verification_kinds`）且 result=`passed`。若 Issue goal 明确是只读/无代码变更，P0 仍不自动放宽；operator 可处理 blocker 后重新组织任务，避免 engine 猜意图。

Validation request 时把 policy 解析为 `ValidationPolicySnapshot`，对规范化 JSON（稳定 key order）计算 SHA-256 `snapshot_hash`，并完整固化在 `validation.requested` payload；Evidence Summary 同时保存 snapshot JSON/hash。Context builder、pass gate、round gate、result submission 与 startup recovery 都读取该 requested snapshot，绝不在 validator terminal 时重新读取可能已修改的 policy 行。`policy_id/version` 仍用于展示和索引，但不能单独充当历史快照。

### 4.3 Repositories

新增 `repositories/evidence-summary.ts`：

- `createIfAbsent(input)`
- `getByIssueId(issueId)`
- `getById(id)`

扩展：

- `IssueRepository.compareAndSetStatus(id, expected, next, patch)`：在同一 UPDATE 中设置 round/blocker。
- `IssueRepository.listValidatingWithoutActiveValidator()`：startup recovery 用。
- `RunRepository.create()` 接收 role/step/round/source。
- `RunRepository.getLatestCompletedByRole(issueId, role, beforeRunId?)`。
- `RunRepository.getActiveValidator(issueId)`。
- `AgentConfigRepository.listAvailableByProjectAndRole(projectId, "validator")`，排序 `created_at,id`；F005 引入多 capability 后由 capability 查询取代，`role` 只作为 v4 阶段真相源。
- `ValidationPolicyRepository.getById(id)`、`WorkflowTemplateRepository.getById(id)`。

Repository 不解析 JSON result、不判断 evidence 是否足够、不广播事件。

`RunService` 的公开创建入口只创建 `role=implementation/workflow_step=implementation/dispatch_source=user_explicit`，并在同一 transaction 重新读取 Issue：仅 Inbox/Ready/Running 可接受；Validating/Done/Blocked 返回结构化 transition error。请求 body 出现 role/workflow_step/validation_round/dispatch_source/adapter_identity 等系统字段时直接拒绝未知/保留字段。`AdapterConfigService` 同样把 F004 role 限制为 `implementation|validator`，不允许任意字符串进入数据库。

## 5. Validator 输出与 Context

### 5.1 Final agent message

F003 的 `run.output` 是展示日志，不适合做自动决策。F004 扩展 adapter contract：

```ts
interface RunExitResult {
  exitCode: number | null
  failureReason: FailureReason | null
  errorMessage: string | null
  finalMessage: string | null
}
```

- Codex final message 的权威来源是 `item/completed` 通知中 `item.type === "agentMessage"` 且 `item.phase === "final_answer"` 的 item，取其 `text` 字段；同一 turn 出现多条时取最后一条 `final_answer`。**不得累加 `item/agentMessage/delta` 流**——一个 turn 可能先有 preamble agentMessage（`phase !== "final_answer"`）再有 final answer，累加会把两段拼成非法 JSON 而误判 unparsable。也**不得依赖 `turn/completed`**，其 `turn.items` 为 `[]`、`itemsView=notLoaded`，不携带正文。最大 64 KiB；command output 走 `commandExecution.aggregatedOutput`，不进入该字段。
- 取不到 `phase === "final_answer"` 的 agentMessage item 视为 final message 缺失，validator Run 按 `result_unparsable` Blocked。
- 上述契约由真实 Codex `0.144.5`（Windows）final-answer probe 固化：delta 字段名为 `delta`；preamble agentMessage 观测到 `phase="commentary"`、final answer 为 `phase="final_answer"`，故采集须**只认 `final_answer` 并显式排除 `commentary`**；每条 agentMessage 先 `item/started`（text 空）后 `item/completed`（text 完整），采集认 `item/completed`；命令输出（`commandExecution.aggregatedOutput`）与 final message 隔离已验证，Unicode 原样保留。probe 未覆盖的 64 KiB 截断、缺失/非零/cancel/timeout 由实现期正式 fixture 补齐，均已有 Blocked 兜底。
- Fake adapter 可直接配置 `finalMessage`。
- 不支持 final message 的 adapter 可以正常做 implementation，但不能作为 validator；availability capability 显示原因。
- AgentRunner 在 validator Run terminal 时把 `finalMessage` 交给 workflow hook；不把未 redacted 原文新增到结构化 validation payload。原始输出仍按 F002/F003 有界 trace 留存。

### 5.2 Parser

Validator prompt 要求 final message 只包含一个 JSON object。Parser：

1. UTF-8 trim；允许最外层一个 ```json fenced block，但 fence 外只能有空白。
2. `JSON.parse` 后做严格 schema 校验；未知顶层字段拒绝，避免协议漂移被静默吞掉。
3. 限制 summary 8 KiB、finding 100 条、单 finding message/suggestion 各 4 KiB、refs 200 条、key decisions/lessons candidate 各 50 条且单项 4 KiB。
4. `passed` 必须 `findings=[]` 且 `missing_evidence=[]`；否则拒绝为 unparsable。
5. `failed` 必须至少一个 finding；`blocked` 必须在 `missing_evidence` 或 finding 中说明原因；`key_decisions`/`lessons_candidate` 必须存在但允许空数组。
6. 所有 implementation evidence refs 用 F003 EvidenceService 按 Issue/Thread/`implementation_run_id` scope 校验；issue-level result refs另按 Issue/Thread scope校验；finding `file_path` 规范化为 workspace-relative，越界拒绝。

解析失败不尝试 regex/Markdown fallback，写 `validation.blocked(reason=result_unparsable)` 并保留 `validator_run_id` 供用户查看原始 Run trace。

### 5.3 Validator context

`ValidationContextBuilder` 生成有界 Markdown prompt，固定顺序：

```text
System contract + JSON schema
Issue title / goal
Validation policy id/version/evidence requirements/max rounds
Validation policy snapshot hash
Implementation Run identity
Handoff payload whose run_id equals implementation_run_id
Verification events and refs scoped to implementation_run_id
File change summary and paged paths scoped to implementation_run_id (bounded)
Prior validation findings (if any)
Missing/partial trace completeness warnings
```

`implementation_run_id` 是 validator context 的强制 scope：handoff、verification、file change set 和 evidence refs 都必须解析到该 Run；同一 Issue 后续 consult/其他 Run 的更新 handoff 不参与本次验证。绝对 workspace path、baseline fingerprints、raw command output、secret-bearing config 不进入 context。上下文达到 128 KiB 时按“完整 file list -> command summaries -> older findings”顺序截断，但 policy、goal、目标 implementation handoff、missing-evidence 状态和 refs 不得截断；仍超限则 Blocked。

`implementation_run_id` 与 `policy_snapshot` 的权威来源都是本轮 `validation.requested` event payload——它们在 §6.2 request 时一次性确定并固化。`runs` 表不新增 `implementation_run_id` 列；context builder（§5.3）、passed/failed gate（§6.4/§6.5）和 startup recovery（§6.7 处理 terminal validator）都读取同一个 requested event，绝不在 validator terminal 时重新推导目标 Run 或重读可变 policy。这样即便 Validating 期间出现其他 Run/配置变化，被验证对象和判定规则也不会漂移。

### 5.4 Validation event ownership 与 evidence scope

Validation event 的执行来源和证据目标是两个独立维度，不复用一个 `runId` 参数：

- `validator_run_id` 表示产生判断的 validator Run；`implementation_run_id` 表示被验证对象。
- `validation.requested/finding/passed/failed/blocked` payload 显式保存这两个字段；不使用含义模糊的通用 `run_id` 代替任一字段。
- `ValidationTraceService` 写入接口拆为 `sourceValidatorRunId` 与 `evidenceScopeRunId`。事件自身先校验 validator Run 属于同 Issue/Thread/round；所有 handoff/test/file-change refs 再用 `evidenceScopeRunId=implementation_run_id` 调用 F003 EvidenceService。
- issue-level ref（例如 `event:<validation.passed>`）只做 Issue/Thread scope 校验；implementation evidence 必须额外做 Run scope 校验。不得为兼容两类 ref 而整体关闭 Run scope。
- trusted payload resolver 仍只允许 F003 allowlist，并强制目标 `implementation_run_id`；`run.output` 永不进入 context。

下一轮 implementation context builder 在现有 Issue/Run context 后追加最新一轮 `validation.failed` 与 findings；只有当前 Issue 的最新 failed round，最多 100 条。进入 Ready 后重新执行仍保留历史 findings，但标注其 round。

## 6. Runtime / Workflow 设计

### 6.1 Validator selection

P0 固定角色，不做 capability scoring。`ValidatorSelector`：

1. 读取 Issue 对应 workflow，确认存在 `validation` step。
2. 查 Project 内 `status=available AND role='validator'` 的 configs。
3. 按 `created_at ASC,id ASC` 选第一条，保证确定性。
4. 没有可用 validator 时直接 Blocked，reason=`validator_unavailable`。

Adapter config 的 `role` 在 F004 是受控枚举而非自由标签；create/update API 和 service 都拒绝其他值。F005 以后改用 capability 作为能力真相源时再按其 migration 扩展，不提前允许未知角色。

F004 UI 在 Adapter Settings 暴露 `role`（implementation/validator）和 model；允许同 provider/model，Done 时如实标 same-origin。F004 不自动把 implementation adapter 当 validator，因为那会把配置缺失伪装成有效 workflow。

### 6.1.1 Queue drain eligibility

每次从 workspace FIFO 取出 queued Run 时都必须重新读取 Issue 并校验 role/status，而不是只在创建时校验：

```text
implementation -> Inbox / Ready / Running
validator      -> Validating，且 validation_round 等于当前 round
```

同一 Issue 的 Run 若因状态已推进而不再 eligible，使用 CAS 将其从 `queued` 置为 `cancelled`，写 `run.cancelled(reason=issue_state_changed_before_start)`，然后继续扫描下一条 queued Run；不得让 stale implementation 阻塞其后的 validator。其他 Issue 中仍 eligible 的更早 Run继续遵守 workspace FIFO，validator不获得跨 Issue 插队权。F005 会在此规则上增加 `consult -> 任意非终态`。

### 6.2 Request validation

触发条件同时满足：

- terminal Run `role=implementation`、`status=completed`；
- F003 trace state 已 finalized；
- Issue 当前为 `Running`；
- 该 Run 是 Issue 最新 completed implementation Run，且之后没有 requested/pass/fail/block result；
- implementation Run 有创建时固化的无凭据 adapter identity snapshot，Issue policy 可解析并能生成稳定 snapshot/hash；
- Issue 未 Done/Blocked。

单个 transaction：

1. CAS Issue `Running -> Validating`，清旧 blocker。
2. 计算 `round = validation_round_count + 1`。
3. 选择 validator并创建 queued validator Run row，`role=validator`、`workflow_step=validation`、`validation_round=round`、`dispatch_source=system`，同时固化 validator identity；此时尚不写 queued event。
4. 写 `validation.requested`，固化 `implementation_run_id`、validator Run/config、implementation identity、完整 policy snapshot/hash，refs 指向 implementation handoff/file/test evidence。
5. 写 `run.queued`，因此对外 event sequence 仍是 requested 在 queued 之前。

若 Issue 已 Validating，先查 current-round validator（不限于 active status）：queued/running 返回现有 Run；terminal 且尚无 result event 时先进入统一 result submission/recovery，不创建重复 Run；已有 result 时按幂等结果返回。

若 implementation identity缺失或 policy/validator 配置无效，第 1 步不单独提交，改为同 transaction `Running -> Blocked` + `validation.blocked`。DB unique conflict表示另一路已创建 validator；重新读取该 Issue/round 的 Run，若 scope 匹配则幂等返回，否则以 `recovery_inconsistent` Blocked。

事务提交后按 event sequence 广播，再让 queue 尝试取得 workspace lock。不得在 transaction 内 spawn adapter。

### 6.3 Process validator terminal

只处理 `role=validator`：

- `completed`：解析 finalMessage并进入 outcome submission。
- `failed/cancelled/interrupted`：Blocked `validator_run_failed`，不增加 failed round count。
- duplicate callback：如果 Issue 已不是 Validating或已有该 run 的 result event，幂等返回。
- strict envelope 的 `outcome=blocked`：写 `validation.blocked`、持久化 reason/missing evidence，并将 Issue 置 Blocked；不得无动作返回或永久停留 Validating。

Outcome submission 先在事务外完成 parse、evidence resolve、summary draft；事务内重新校验 Issue/Run/round，防止 stale result 覆盖新状态。

### 6.4 Passed / Done gate

`passed` 仍必须经过 deterministic policy gate，不能仅信任 agent 声明；gate 使用 requested event 固化的 policy snapshot：

- result refs 均存在且 scope 正确；
- implementation handoff/file trace/confirmed passed verification 满足 policy；
- validator Run 本身 completed且 round 等于当前 round；
- summary builder 能生成完整 projection。

同 transaction：写 `validation.passed` -> create EvidenceSummary -> Issue `Validating -> Done` -> 写 `issue.done`。`issue.done.evidence_refs` 含 `event:<validation.passed>` 与 summary 聚合 refs，payload 含 `evidence_summary_id`。Summary 使用 implementation/validator Run 创建时固化的 identity snapshots、requested policy snapshot，以及 result envelope 的 key decisions/lessons candidate。

### 6.5 Failed / round limit

轮次语义采用“本次 fail 计入后比较上限”：

```ts
nextCount = issue.validation_round_count + 1
if (nextCount >= policy.max_validation_rounds) -> Blocked
else -> Running
```

默认 max=3，因此第三次 failed 直接 Blocked。两条路径都先逐条写 `validation.finding`，再写 result：

- 未达上限：`validation.failed`，Issue `Validating -> Running`，count=`nextCount`。
- 达上限：`validation.failed` 后写 `validation.blocked(reason=round_limit_reached)`，Issue -> Blocked，count=`nextCount` 并保存 blocker。

这里不创建修复 Run；用户下一次发送 implementation 指令时 context builder附最新 findings。

### 6.6 Blocked 与恢复

所有 F004 blocker 同时持久化到 Issue columns和 `validation.blocked` event。恢复 API 只允许 `status=Blocked` 且 latest blocker 属于 validation：

- `operator_note.trim()` 长度 1-4000；
- transaction CAS `Blocked -> Ready`，清 blocker columns，写 `issue.unblocked`；
- 普通 unblock 不重置 `validation_round_count`，历史 round 继续受上限约束。
- 不自动创建/启动 Run。

Round reset 与 unblock 是两个动作：

- 仅 `blocked_reason_code=round_limit_reached` 时允许 reset；
- 请求必须包含 `operator_note.trim()` 长度 1-4000；
- transaction 内将 `validation_round_count` 从旧值置 0，并写 `validation.round_reset`（old/new/note）；
- Issue 仍为 Blocked，blocker 不清除；operator 随后显式 unblock 才进入 Ready；
- 普通 unblock 永远不隐式清零。

### 6.7 Recovery

F003 startup recovery完成 terminal finalization后，F004 执行 `ValidationRecoveryService.reconcile()`，然后才 listen/drain queue：

1. 对 finalized completed implementation + Issue Running且无 result 的记录，幂等 request validation。
2. 对 terminal validator + Issue Validating且无 result，幂等 process result；从 requested event 读取固化的 implementation/policy scope。finalMessage 必须已随 terminal capture 持久化。为此 v4 在 `runs` 增加 `final_message TEXT` 内部列（API `Run` 默认不返回正文，只返回 `has_final_message`）。
3. Validating但无 active/terminal validator时：若 requested event存在且创建中断，重建一次；配置不可用则 Blocked。
4. Done但缺 validation.passed或 summary视为数据不一致：不伪造，记录 server diagnostic并将 Issue转 Blocked仅适用于尚未对外进入 Done 的同事务失败；已提交 Done按 SQLite transaction不应出现该状态，startup检测后停止该 Issue自动化并报告。

Recovery 所有写入仍用相同 CAS/unique/idempotency guard。

## 7. API / Contract 设计

### 7.1 Validation status

```http
GET /api/issues/:issue_id/validation
```

```ts
interface IssueValidationResponse {
  issue_id: string
  status: IssueStatus
  current_round: number | null
  completed_failed_rounds: number
  max_rounds: number
  active_validator_run: RunSummary | null
  latest_result: ValidationResultSummary | null
  latest_findings: ValidationFindingRecord[]
  blocker: { reason_code: string; message: string; event_id: string } | null
  evidence_summary: EvidenceSummary | null
}
```

Findings 从 ThreadEvent projection读取，按 event_sequence；不另建 findings 表。响应最多返回 latest round 100 条。

### 7.2 Evidence Summary

```http
GET /api/issues/:issue_id/evidence-summary
```

Done且存在返回 `{ evidence_summary }`；非 Done或尚无 summary 返回 404 `EVIDENCE_SUMMARY_NOT_FOUND`，不返回空壳。

### 7.3 显式触发/重试默认 validator

```http
POST /api/issues/:issue_id/validation
```

F004 仅允许以下幂等语义：Issue 已 `Validating` 且当前 round 没有任何 validator Run 时补建默认 validator；正常 implementation completion仍自动调用同一 service。Running/Ready/Blocked/Done 返回 `INVALID_ISSUE_TRANSITION`。若当前 round 已有 queued/running Run，返回现有 Run；若已有 terminal Run但尚无 result，先处理/恢复该 Run，不能创建第二条。

若显式补建时发现 validator/config 不可用，service 仍按统一状态机提交 `validation.blocked` + Issue Blocked；HTTP 返回 409 `VALIDATOR_UNAVAILABLE` 并携带更新后的 blocker metadata。该 409 是“请求未能创建 validator，但状态已安全收敛”的领域结果，不是无副作用回滚。

### 7.4 Unblock

```http
POST /api/issues/:issue_id/unblock
Content-Type: application/json

{ "operator_note": "Configured a validator and reviewed missing evidence." }
```

成功返回更新后的 Issue。空 note -> `OPERATOR_NOTE_REQUIRED` (400)；非 Blocked或非 validation blocker -> `INVALID_ISSUE_TRANSITION` (409)。F002 escalation blocker暂不由此接口恢复，避免扩大 scope。

### 7.5 Explicit round reset

```http
POST /api/issues/:issue_id/validation-rounds/reset
Content-Type: application/json

{ "operator_note": "Requirements changed; grant a fresh validation budget." }
```

仅 `round_limit_reached` blocker 允许。成功返回仍为 Blocked 的 Issue 和 reset event identity；空 note 为 400，其他 blocker/status 为 409。reset 与 unblock 分离，避免一个看似普通的恢复动作静默抹除安全计数。

### 7.6 Evidence Summary Markdown export

Inspector 直接从 `EvidenceSummary.summary_markdown` 提供 Copy Markdown / Download `.md`。不重新渲染、不调用 LLM、不自动写入 workspace；文件名使用经过清理的 Issue title/id。现有 GET summary contract 足以支持前端下载，无需新增生成型 API。

### 7.7 新错误码

| ErrorCode | HTTP | 场景 |
| --- | --- | --- |
| `INVALID_ISSUE_TRANSITION` | 409 | 状态不允许 validation/unblock |
| `VALIDATOR_UNAVAILABLE` | 409 | 显式触发但无可用 validator |
| `VALIDATOR_RUN_CONFLICT` | 409 | 已有不同 pending validator |
| `VALIDATION_RESULT_INVALID` | 422 | 内部 parser；公开读取不直接暴露 raw output |
| `EVIDENCE_REQUIREMENTS_NOT_MET` | 409 | result声称 pass但 deterministic gate失败 |
| `EVIDENCE_SUMMARY_NOT_FOUND` | 404 | Issue无 Done summary |
| `OPERATOR_NOTE_REQUIRED` | 400 | unblock note为空 |
| `VALIDATION_ROUND_RESET_NOT_ALLOWED` | 409 | 非 round-limit blocker 或状态不允许 reset |

## 8. Event / Trace 设计

所有 payload 包含 `issue_id/thread_id/validation_round`；有 Run 时分别包含 `validator_run_id`/`implementation_run_id`，不使用通用 `run_id` 混淆执行来源和 evidence scope。

### `validation.requested`

```json
{
  "validation_round": 1,
  "policy_id": "vpl_coding_default",
  "policy_version": 1,
  "policy_snapshot": {
    "policy_id": "vpl_coding_default",
    "version": 1,
    "max_validation_rounds": 3,
    "evidence_requirements": {
      "require_handoff": true,
      "require_file_trace": true,
      "require_verification": true,
      "accepted_verification_kinds": ["test", "lint", "typecheck", "build"]
    }
  },
  "policy_snapshot_hash": "sha256:...",
  "implementation_run_id": "...",
  "validator_run_id": "...",
  "validator_adapter_config_id": "...",
  "target": "implementation_result"
}
```

### `validation.finding`

沿用 F003 contract，增加 `finding_index`，保证同轮稳定排序。message/suggestion已过长度限制，file_path为 workspace-relative。event refs 同时保存于 `ThreadEvent.evidence_refs`，payload不复制 refs。

### Result events

- `validation.passed`：summary、finding_count=0、validator/implementation Run、policy id/version、same_origin_validation。
- `validation.failed`：summary、finding_count、next_status (`Running|Blocked`)。
- `validation.blocked`：reason_code、summary、missing_evidence、validator_run_id可空。
- `validation.round_reset`：previous_round_count、new_round_count=0、operator_note、previous_block_reason；Issue status 仍为 Blocked。
- `issue.done`：previous_status、evidence_summary_id、validation_event_id。
- `issue.unblocked`：previous_status、status=Ready、operator_note、previous_block_reason。

事件与状态写入同 transaction；使用 `ThreadEventService.write()` 收集 pending events，commit 后按 sequence `broadcast()`。

## 9. Evidence Summary

`EvidenceSummaryBuilder` 使用结构化数据确定性生成 Markdown，不调用 LLM。固定结构：

```markdown
# <Issue title> — Evidence Summary

## Goal
## Final Result
## Implementation Summary
## Key Decisions
## Validation
## Run Identities
## Validation Policy
## Key Commands
## Verification Evidence
## Changed Files
## Implementation Handoff
## Findings
## Lessons Candidate
## Trace Completeness
```

`evidence_refs` 聚合 pass event、implementation handoff、verification、file-change-set，去重保序并限制 500 条。Goal 来自 Issue；implementation summary/handoff 来自目标 implementation Run 的 F003 handoff；final/validation result、key decisions、lessons candidate 来自 strict result envelope与系统 outcome；commands/tests/files来自目标 Run evidence。`summary_markdown` 最大 256 KiB，file list超过上限时写 truncated标记；不能因 renderer截断丢失 goal、result、policy snapshot/hash、双方 identity、same-origin、key decisions、lessons candidate 或 trace completeness。

Same-origin 只比较 implementation/validator Run 创建时写入 `runs.adapter_identity_json` 的 provider/model snapshot；任一新 Run 缺 snapshot 都不得自动 Done，并以 `recovery_inconsistent` Blocked。Evidence Summary复制双方 snapshot，后续 adapter config 修改不会改变历史结论。v1-v3 历史 Run snapshot 为 null，不参与自动 validation。

## 10. UI 设计

### 10.1 Thread

扩展 F003 `ValidationTraceCard`：

- requested：round、validator、policy；
- finding：severity文字 badge、message、suggestion、file:line、可点击 evidence ref；
- passed/failed/blocked：summary和下一状态；
- issue.done：链接/展开 Evidence Summary；
- issue.unblocked：展示 operator note。

### 10.2 Inspector

新增 `Validation` section：当前状态、`round / max`、active validator、latest findings、blocker、same-origin badge。Done显示完整 summary；Blocked显示 reason和“Resolve blocker”按钮；round-limit blocker 另显示明确的“Reset validation rounds”操作，并说明 reset 不会自动 unblock。

Unblock dialog要求 note，前端只做便利校验，后端仍强制。成功后刷新 issue/validation/events/runs；不会自动发送指令。

Done summary 区域提供 Copy Markdown 与 Download Markdown，内容直接使用持久化 `summary_markdown`。

### 10.3 Adapter Settings

F004 在既有 Codex配置表单增加 role选择和只读 capability提示。至少配置一个 available validator才能自动闭环；列表明确显示 implementation/validator，避免用户误以为任意 adapter都会被自动选中。

## 11. 失败处理

| 场景 | 收敛行为 |
| --- | --- |
| implementation evidence finalization失败 | F003先完成/标 partial；F004 policy不足则 Blocked |
| validator配置缺失/不可用 | 不创建Run；validation.blocked + Issue Blocked |
| implementation identity缺失/policy snapshot非法 | recovery_inconsistent/workflow_configuration_invalid -> Blocked，不启动validator |
| duplicate terminal callback | result event/run/Issue CAS幂等，无重复 summary |
| validator spawn/timeout/nonzero/cancel/restart | validator_run_failed -> Blocked |
| finalMessage缺失/超限/JSON非法 | result_unparsable -> Blocked；正文仅内部持久化，不进入公共 Run/evidence/API payload |
| result refs越界/缺失 | scope mismatch/evidence missing -> Blocked，不得 Done |
| pass声明但 deterministic gate不满足 | evidence_missing -> Blocked |
| fail达到round limit | findings + failed + blocked同事务，停止自动化 |
| result transaction失败 | Issue仍Validating；startup recovery从terminal Run重试 |
| summary renderer异常 | 整个pass transaction回滚，不出现Done无summary |
| SSE广播失败 | DB已提交，现有replay补发 |
| unblock note为空/状态已改变 | 400/409，不写event |

## 12. 测试策略

### 12.1 Unit

- strict result parser、limits、fence、unknown fields、key decisions/lessons candidate、Windows file refs。
- policy evidence gate和round boundary (`nextCount >= max`)。
- validator selector deterministic order/role/status。
- context builder截断优先级、prior findings注入。
- same-origin和Evidence Summary renderer。
- Issue/Run state guards和block reason映射。

### 12.2 Integration

- v3 -> v4 migration、旧Run defaults、identity snapshot兼容、partial unique index。
- implementation completed -> F003 finalize -> validation requested -> queued validator的严格顺序。
- pass事务含 passed/summary/done；任一点失败整体回滚。
- fail回流、findings顺序、round count、下一implementation context。
- 第3次fail -> Blocked；无后续自动Run。
- validator unavailable/unparsable/missing evidence/terminal failure -> Blocked。
- duplicate/racing callbacks、unique conflict、restart reconcile。
- unblock note和非法状态。
- API、SSE replay、Evidence Summary追溯。

### 12.3 UI / E2E

- Thread六类validation/done/unblock event。
- Inspector round/max/findings/blocker/summary。
- same-origin和independent文案，不只靠颜色。
- unblock dialog validation/error/success。
- adapter role配置和missing-validator提示。

### 12.4 Manual

- 真实Codex implementation -> validator -> Done。
- 故意输出failed findings ->用户修复->再次validation。
- 缺test evidence、无validator、非法validator JSON。
- Windows路径、server在implementation/validator terminal附近重启。

## 13. 设计决策

| 决策 | 理由 | 替代方案 |
| --- | --- | --- |
| workflow hook在F003 finalization后 | validator必须看到完整file/handoff evidence | run.completed立刻触发；会读到未收尾证据 |
| strict final-message JSON | 自动Done不能依赖模糊文本猜测 | regex/Markdown fallback；可能静默误判pass |
| deterministic policy gate二次校验pass | agent声明不能替代系统证据底线 | 完全信validator；缺证据也可能Done |
| fail不自动开修复Run | 防止无人值守无限消耗，符合spec关闭问题 | 自动loop直到max；风险更高 |
| findings保留为events | F003已有事件真相源，P0查询量小 | findings表；重复projection和事务复杂度 |
| EvidenceSummary独立表 | Done需要稳定可查projection和policy/identity快照 | 每次从events动态拼；历史config变化且查询重 |
| Run创建时固化adapter identity | same-origin和审计不能受后续config修改影响 | validation commit时读当前config；历史结论会漂移 |
| request时固化policy snapshot/hash | terminal/restart必须使用同一判定规则 | 只存id/version后重读可变行；同版本修改会漂移 |
| active validator DB唯一索引在v4落地 | F004本身也需要幂等；F005可直接复用 | 只靠进程锁；race/restart不可靠 |
| validator用显式role选择 | 固定workflow角色、确定性、可解释 | 自动把implementation config复用；掩盖缺配置 |
| 第N次fail计入后与max比较 | max=3直观表示最多三次失败结果 | 超过后第4次才Block；多跑一轮 |
| Blocked恢复到Ready且保留round | operator action不等于任务正在运行，历史不能抹除 | 回Running/清零；制造错误状态或绕过limit |
| round reset独立于unblock | 清零是安全预算变更，必须显式、带note且可追溯 | unblock隐式清零；用户无法判断历史是否被抹除 |
| 同一Issue/round仅一条validator Run | 关闭terminal到result提交之间的重复创建窗口 | 只限制queued/running；在线race可重复验证同一round |

### 13.1 Requirement → Design映射

| Requirement | 设计落点 |
| --- | --- |
| `FR-001` 自动触发Validator | 4.1 active唯一约束、6.1-6.2选择与request、6.7 recovery |
| `FR-002` Validator输入 | 5.3 context builder、F003 evidence resolver |
| `FR-003` Result解析 | 5.1 final message、5.2 strict parser、6.3 terminal处理 |
| `FR-004` Pass To Done | 6.4 deterministic gate、9 Evidence Summary |
| `FR-005` Fail回流 | 5.3 repair context、6.5 findings/Running事务 |
| `FR-006` Round Limit | 6.5计数边界、6.6 Blocked收敛 |
| `FR-007` Evidence Summary | 4.1表结构、9 builder/Markdown |
| `FR-008` Same-Origin | 9 identity比较与历史限制、10 UI |
| `FR-009` Blocked恢复 | 6.6恢复规则、7.4 API |
| `FR-010` Validation UI | 7.1 query projection、10 Thread/Inspector |
| `FR-011` Round reset | 6.6显式reset规则、7.5 API、8 event、10 Inspector |

## 14. 待确认设计问题

产品级设计问题已关闭；final review 发现的实现缺口已转为 T090-T095：

- **已关闭：validator输出协议**——使用 final agent message严格JSON；真实Codex final message字段由实现probe验证，字段差异只改adapter normalizer，不改领域contract。
- **已关闭：下一轮修复是否自动启动**——不自动，等待用户明确发起。
- **已关闭：Evidence Summary存储**——独立结构化记录 + deterministic Markdown，覆盖PRD第7.6节；原始evidence仍在ThreadEvent/F003表。
- **已关闭：同源验证**——允许并标记；不把同源伪装成跨provider独立验证。
- **已关闭：round上限边界**——本次fail计入后 `>= max` 即Blocked。
- **已关闭：手动触发**——公开接口只补建当前Validating的默认validator，不允许任意状态重验Done或绕过Blocked。
- **已关闭：round reset**——普通 unblock 保留 round；仅 round-limit blocker 可通过独立、带 note 的 reset action 清零，reset 后仍 Blocked。
- **已关闭：summary export**——F004 提供复制/下载已持久化 Markdown，不自动写 workspace。
- **已关闭：terminal validator race**——同一 Issue/round 全生命周期唯一；terminal 未提交 result 时处理/返回现有 Run，不重建。

- **已关闭：Codex final-message 契约**——真实 Codex `0.144.5`（Windows）probe 完成，final message = `item/completed` 中 `phase === "final_answer"` 的 agentMessage `text`（禁止累加 delta、禁止依赖 turn/completed），命令输出隔离与 Unicode 已验证，见 §5.1。

Windows 重启时序仍为 `tasks.md` 任务，已有明确 fallback（无法可靠取得即 Blocked），不阻塞开发。

## 15. 实现后回写

- `docs/personahub-system-design.md`：补齐Run role/round/source、Issue blocker、EvidenceSummary实际字段。
- `docs/personahub-architecture.md`：补充terminal finalization后的workflow hook、strict validation gate和恢复顺序。
- F005实现时复用active validator唯一索引和ValidationWorkflowService，不复制parser/state machine。
- 完成验收后更新 `BACKLOG.md`、本三件套Status和`CLAUDE.md`现状。
