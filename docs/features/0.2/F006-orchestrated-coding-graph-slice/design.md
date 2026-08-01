---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, fan-out, fan-in, recovery]
doc_kind: design
created: 2026-08-01
updated: 2026-08-01
---

# F006：Orchestrated Coding Graph Slice - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

在现有 Run 之上补一层 **NodeRun（逻辑工作）**，把 Run 的职责收窄为 **Attempt（一次具体的 provider 执行）**，用新增的 `graph_runs` / `node_runs` 两张表承载图状态，Edge 定义内联在版本化的 definition 常量里，实际 edge traversal 用 ThreadEvent 记录。图推进挂在既有的 `RunDispatchService.workflowHook()` 这一个 seam 上，与 F004 的 validation 分支并列，不改写它。

物理串行由**既有机制**保证：fan-out 的两个节点各创建一个 `queued` Run，落到同一 workspace 的 FIFO 队列（`run.ts:132` `listQueuedByWorkspace`），由 `run-dispatch.ts:167` `startNextQueuedRun` 在前一个 Run 终态时自然驱动下一个。F006 不新建调度器、不碰 `workspace-lock.ts`。

## 2. 影响面

- **存储**：新增 `schema-v8.ts`（`graph_runs`、`node_runs` 两表 + `runs.node_run_id` 列）。
- **后端 service**：新增 `GraphRuntimeService`（调度 / join / 恢复）；`RunDispatchService.workflowHook()` 增加一条按 `node_run_id` 分流的分支。
- **恢复**：新增 `GraphRecoveryService`，在 `index.ts` 启动序列中排在 `StaleRecoveryService.runAll()` 之后、`drainWorkspace` 之前。
- **事件**：新增 4 个 `graph.*` ThreadEvent 类型。
- **前端**：Thread 内的节点卡片与 Inspector 的 graph projection 段落；不做 Canvas。
- **不影响**：`ValidationWorkflowService` 及其全部 domain rules、`workspace-lock.ts`、`AdapterResolver`、F005 credential 隔离。

## 3. 已固定设计边界

- 全部节点默认进入 workspace 排他锁串行队列（无结构性只读隔离，见 ADR 0006 第 3 节）。
- 已完成节点不可因重启重复执行。
- active Attempt 重启后标 `interrupted`，新尝试使用新 Attempt。
- fan-in 依据持久化前驱状态收敛，与进程内状态无关。
- F004 validation policy gate 保持领域服务，不转写成通用 Edge 条件语言。

## 4. Q1（已关闭）：GraphRun / NodeRun / Attempt 的持久化方案

### 结论

**新增 `schema-v8.ts`：`graph_runs` + `node_runs` 两张表，并给 `runs` 加一个可空的 `node_run_id` 列。不新建 `node_attempts` 表，不新建 `edge_traversals` 表。**

### 依据：恢复五条 × 两方案逐项对照

| ADR 0006 第 3 节恢复要求 | 方案 A：只扩展现有 Run / ThreadEvent | 方案 B：graph_runs + node_runs + runs.node_run_id |
|---|---|---|
| ① 重启后可重建 Graph/Node 的已完成、运行中、待执行状态 | 需从 `runs` + `thread_events` **反推**。已有先例可度量成本：F004 为**单条边**的线性流程就需要 `ValidationRecoveryService` 的 3 个 reconcile pass，其中"是否已请求过验证"要靠扫事件负载判断（`recovery-service.ts:109-116` 的 `existsByTypeAndPayload(..., "implementation_run_id", implRunId)`），且必须保留 `RecoveryInconsistent` 兜底 block reason 处理反推不出来的状态 | `node_runs.status` 直接读，零推断 |
| ② 已完成的 Node 不重复执行 | 依赖 ① 的反推正确 | `status = 'completed'` 直接跳过 |
| ③ 重启时执行中的 Attempt 标 `interrupted` | ✅ 已具备：`StaleRecoveryService.recoverStaleRuns()` 把 running Run 置 `RunStatus.Interrupted` + `FailureReason.ServerRestarted`（`stale-recovery.ts:27-68`） | ✅ 复用同一机制，额外把该 Run 所属 NodeRun 置 `interrupted` |
| ④ 可从对应 Node 发起新 Attempt | Run 没有"逻辑工作"身份，新旧 Run 只能靠 `role`/`workflow_step` 近似关联；`context_source_run_id` 是单值，表达不了"同一节点的第二次尝试" | 新建 Run 且 `node_run_id` 指向同一 NodeRun，天然是第二个 Attempt（直接满足 FR-003） |
| ⑤ fan-in 只在前驱重新满足后才继续 | **硬冲突，非成本问题**：`context_source_run_id` 是 `runs` 表上的单列外键（`repositories/run.ts:48`，`run-context-builder.ts:54` 返回 `string \| null`），物理上无法表达两个前驱；`evidence_summary` 以 `ON CONFLICT(issue_id) DO NOTHING`（`repositories/evidence-summary.ts:80`）保证每 Issue 至多一行，第二、三个节点的 summary 会被**静默丢弃**（`DO NOTHING`，不报错） | join 在事务内按前驱 `node_runs` 行判定 |

第 ⑤ 条是决定性的：方案 A 不是"要多写代码"，而是现有 schema 表达不了多前驱。因此选方案 B。

### 为什么不建 `node_attempts` 表

`Run` 实体当前携带的 `adapter_config_id` / `adapter_identity` / `exit_code` / `started_at` / `completed_at` / `failure_reason`（`shared/src/types/index.ts:220-245`）**正是** ADR 0006 定义的 Attempt 属性。再建一张 `node_attempts` 会与 `runs` 大面积重复，更严重的是会让两个既有机制失去它们唯一认得的主体：

- workspace 锁按 Run 加解（`repositories/workspace.ts:80-87` 的 `locked_by_run_id`）
- FIFO 队列按 Run 排队和 drain（`run.ts:132-137`、`run-dispatch.ts:167`）

所以正确的动作不是把 Run 拆开，而是**把 Run 的职责收窄为 Attempt，把逻辑工作身份上移到 `node_runs`**。这正面回应了 ADR 0006"Run 把四种职责压在一张表"的批评：新代码不再往 Run 上叠加逻辑角色，图相关的逻辑身份一律落在 NodeRun。

### 为什么 Edge 定义不入库、EdgeTraversal 不建表

- **Edge 定义**：本 slice 只有一个内置固定图，Edge 形状正是 ADR 0006 列为"待验证假设"的部分。先以 TypeScript 常量声明（带 `definition_id` + `version`，`graph_runs` 只存这两个值），等第二种图形状出现再决定是否需要可编辑的持久化定义。这与 ADR 0006 第 2 节"不做 Graph Compiler / Canvas"一致。
- **EdgeTraversal**：`thread_events` 已有 `evidence_refs TEXT NOT NULL DEFAULT '[]'` 列（`schema-v1.ts:98`）和成熟的 `EvidenceResolution` 三态解析（`shared/src/types/trace.ts:110-122`）。traversal 是**发生过的事**，与 ThreadEvent 的语义完全吻合，且天生可回放、可在 Thread 中展示（满足 TR-001 / AC-003）。新建第五张表只会让同一件事有两个真相源。

### 迁移纪律

新建 `server/src/db/schema-v8.ts` 并在 `migrations.ts` 追加 `currentVersion < 8` 分支。**绝不追加进已应用的 v7** —— F005 曾因"追加进跑过的 schema、旧数据库永远拿不到新列"否决过 `availability_revision` 方案，同一错误不重复。`runs.node_run_id` 用 `ALTER TABLE runs ADD COLUMN`，与 v6 添加 `context_source_run_id` 的既有做法一致（`schema-v6.ts:12`）。

### 表结构

```sql
CREATE TABLE graph_runs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  status TEXT NOT NULL,            -- running | completed | blocked | cancelled
  blocked_reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE node_runs (
  id TEXT PRIMARY KEY,
  graph_run_id TEXT NOT NULL REFERENCES graph_runs(id),
  node_key TEXT NOT NULL,          -- definition 内的稳定标识
  status TEXT NOT NULL,            -- pending | ready | running | completed | failed | interrupted | cancelled
  join_satisfied_at TEXT,
  result_event_id TEXT,            -- 结果事件，供下游按 ref 取用
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (graph_run_id, node_key)
);

ALTER TABLE runs ADD COLUMN node_run_id TEXT;
```

`UNIQUE (graph_run_id, node_key)` 是结构性保证"一个节点在一次 GraphRun 里只有一行逻辑工作"，重复调度会撞唯一约束而不是静默产生第二项工作。

## 5. Q2（已关闭）：首个真实场景与节点契约

### 场景：PersonaHub 自身代码的双视角检视

选它的理由：本仓库已经跑过十几轮人工代码检视，有真实 ground truth 可以判断 synthesis 输出质量是否成立；且三个节点天然只读，不触碰写并发这条尚未解决的边界。

definition：`wgd_coding_dual_review` v1

```text
N1 review_concurrency ─┐
                       ├─→ N3 synthesize_findings
N2 review_contract    ─┘
```

| node_key | 责任 | 输入 | 输出 |
|---|---|---|---|
| `review_concurrency` | 审查并发、状态一致性、恢复路径 | Issue goal + 目标文件集 | `findings[]` |
| `review_contract` | 审查契约、边界校验、错误语义 | Issue goal + 目标文件集（同一份） | `findings[]` |
| `synthesize_findings` | 合并去重两份 findings，标注来源 | 两条入边各自的 `result_event_id` | 合并报告 |

### 节点结果 contract

前驱节点输出 envelope：

```json
{
  "node_key": "review_concurrency",
  "findings": [
    { "severity": "high|medium|low", "file": "server/src/…", "line": 123,
      "claim": "一句话陈述缺陷", "failure_scenario": "具体输入/状态 → 错误结果" }
  ],
  "not_reviewed": ["未覆盖到的范围，诚实声明"]
}
```

synthesis 输出在此基础上，每条 finding 额外带 `source_nodes: ["review_concurrency", ...]`，并保留 `duplicates_merged` 计数。

**这里只复用 F004 的"要求 CLI 输出结构化 envelope + 容错解析"这一手法**（该手法已被三个 CLI 真实验证），**不复用 validator 的任何语义**：不判 pass/fail、不进 policy gate、不计 validation_round。解析失败的处理见第 7 节。

### required_capabilities 的诚实取舍

`AgentCapability` 当前只有 `Implementation` 和 `Validator` 两个值（`shared/src/types/adapter.ts:24-27`）。本 slice 三个节点**统一声明 `Implementation`**，不新增 `analysis` / `review` 枚举值。

理由：新增枚举值会牵动 adapter 配置 UI 的 capability 勾选，而**用户已配置的 adapter 不会自动获得新 tag**，结果是图一上线就找不到可用执行者。等真正出现"某类 agent 不能做分析"的证据时再加。这不违反 ADR 0006 的"Node ≠ Agent"——节点声明的仍是能力而非具体 adapter，只是当前能力词汇表还很粗。

## 6. Q3（已关闭）：Edge payload 与 traversal contract

**Edge 不承载内容，只承载引用。** 下游节点通过前驱 `node_runs.result_event_id` 取结果，走既有的 `evidence_refs` / `EvidenceResolution` 通道，复用它 `resolved | missing | truncated` 的三态语义——前驱输出超限被截断时，下游拿到的是明确的 `truncated`，而不是一段静默缩水的文本。

新增 4 个 ThreadEvent 类型：

| 类型 | 何时写 | payload 要点 |
|---|---|---|
| `graph.node_queued` | NodeRun 创建并入队 | `graph_run_id`、`node_key`、`required_capabilities` |
| `graph.node_completed` | NodeRun 终态 | `node_key`、`status`、`attempt_count` |
| `graph.edge_traversed` | 每次实际边转移 | `from_node_key`、`to_node_key`、`outcome`、`decided_by`、`input_refs[]` |
| `graph.join_satisfied` | fan-in 条件满足 | `to_node_key`、`satisfied_by[]`、`join_policy` |

`decided_by` 记录路由决策的来源（本 slice 只有 `deterministic_join` 一种取值，字段先留出以承接 ADR 0006 的"路由决策来源"要求）。`graph.edge_traversed` 的 `evidence_refs` 指向前驱结果事件——这就是 TR-001 要求的"输入/输出 refs"，无需新 envelope。

## 7. Q4（已关闭）：状态映射、锁、retry 与 escalation

### Issue 状态

| GraphRun 事件 | Issue 状态 |
|---|---|
| 图启动 | → `Running`（复用现有语义） |
| 全部节点完成，报告写入 Thread | → `Ready` |
| 任一 required 前驱终态失败且未 retry | → `Blocked` |

**为什么完成后是 `Ready` 而不是 `Done`**：`Done` 目前由 validation pass 驱动（`workflowHook` → `processValidatorResult`）。三节点只读图不产生可验证的代码产物，直接置 `Done` 会与 F004 的 `Done` 语义冲突。报告是给用户看的中间产物，后续是否进入实现由用户决定。

### Blocked 语义必须独立于 validation

`ValidationRecoveryActionService.unblock()` 硬校验 `VALIDATION_BLOCK_REASONS.has(issue.blocked_reason_code)`，并对非 validation 类 blocker 抛 `INVALID_ISSUE_TRANSITION`（`recovery-action.ts:45-53`）。因此：

- 新增独立的 `GraphBlockReason` 枚举（`node_run_failed` / `join_unsatisfiable` / `no_capable_adapter` / `result_unparsable` / `recovery_inconsistent`），**不复用 `ValidationBlockReason`**。
- 图 blocker 需要自己的恢复入口（节点级 retry），**不能走 validation 的 unblock 按钮**。这不是可选项——复用会让 validation 的 unblock 守卫失效。

### workspace 锁与并发

不新增任何锁机制。每个 Attempt 就是一个 Run，沿用 `workspaceLockService.acquire(workspace_id, run.id)`。fan-out 时两个 NodeRun 各创建一个 `queued` Run：第一个抢到锁执行，第二个留在队列，由 `finalizeAndDrain` → `startNextQueuedRun` 在第一个终态时启动（`run-dispatch.ts:144-168`）。

**AC-004（无两个 agent 进程并发访问同一 workspace）由既有机制保证，F006 不需要为此写新代码**，只需要一条断言测试证明该性质在图场景下依然成立。

### retry 与 escalation

- **retry**：对 `failed` / `interrupted` 的 NodeRun 发起 retry → 新建 Run（`node_run_id` 不变）→ 入队。NodeRun 回到 `running`，Attempt 计数 +1。GraphRun 从 `blocked` 回到 `running`。
- **"同一 NodeRun 只有一个 active Attempt"必须结构性保证**（spec 第 3 节边界场景）。仅靠 UI 禁用按钮不够：workspace 队列允许同一 workspace 上有多个 `queued` Run，连点两次 retry 会产生两个 Attempt，先后执行、后者覆盖前者结果。强制手段是 retry 入口在**同一事务内**做 NodeRun 状态 CAS（`failed|interrupted` → `running`）再建 Run，CAS 失败即拒绝——第二次点击拿不到 CAS，不会创建第二个 Run。这与 F004 `claimValidatorSlot()` 用 CAS 抢占验证槽位是同一手法。
- **escalation**：复用 `run-escalation-handler`，不改其逻辑。escalation 导致 Run 失败 → NodeRun `failed` → join 不满足 → GraphRun `blocked`。

### 图推进的接入点，以及必须新增 `RunRole.GraphNode` 的原因

`RunDispatchService.workflowHook()`（`run-dispatch.ts:175-192`）已经是"Run 终态 → 决定下一步"的唯一 seam，图推进在此分流到 `GraphRuntimeService`。但**不能让图节点的 Run 沿用默认 role**，原因是 `runs.role` 的列定义是 `TEXT NOT NULL DEFAULT 'implementation'`（`schema-v2.ts:6`、`schema-v4.ts:2`），没有 CHECK 约束也不可为空——图节点 Run 若不显式指定 role，就会带着 `implementation` 落库，从而踩中两处既有逻辑：

1. **`workflowHook` 会误触发验证**：`if (run.role === RunRole.Implementation && run.status === RS.Completed)` → `requestValidation(...)`（`run-dispatch.ts:179-181`）。结果是一个只读检视节点跑完就启动 F004 的完整 Implementation → Validation 循环。这直接违反 AC-005。
2. **队列资格门会静默取消排队中的图 Run**：`startNextQueuedRun` 对 `role === Implementation` 的 queued Run 要求 Issue 状态必须在 `{Inbox, Ready, Running}` 内，否则 `cancelQueued(run.id, "issue_state_changed_before_start")`（`run-dispatch.ts:290-297`）。图执行期间 Issue 一旦转入 `Blocked`（例如另一个节点失败），尚未启动的兄弟节点会被悄悄取消，而不是保持可恢复的 `pending`。

因此本 slice 新增 `RunRole.GraphNode = "graph_node"`：

- 该列无 CHECK 约束、新行显式写值，**不需要 schema 迁移**；既有行不受影响。
- 也不复用 `RunRole.Consult`：consult 的既有语义是"ad-hoc、不驱动 Issue 状态机"（`shared/src/types/validation.ts:5-7` 的注释），而图节点是 workflow-bound 的，且 `run-context-builder.ts:133` 对 consult 有专门的上下文装配规则。借用会让两种语义互相污染。

对应的两处改动：

- `workflowHook`：`run.role === RunRole.GraphNode` 分支**排在最前**并直接 return，现有 Implementation / Validator 两条分支一字不改。
- `startNextQueuedRun`：为 GraphNode 增加显式资格规则——所属 GraphRun 为 `running` 且 Issue 未 `Done`（`Done`/`Blocked` 的既有前置判断保留，但 `Blocked` 对图节点不再取消而是留在队列，由节点级恢复决定），不参与 `validation_round` 匹配。

### 重启恢复流程

新增 `GraphRecoveryService.reconcile()`，在 `index.ts` 中排在 `StaleRecoveryService.runAll()` 之后、`drainWorkspace` 之前（现为 `index.ts:149` 与 `index.ts:161-164`）：

1. 每个 `running` GraphRun：把"active Run 已被置 `Interrupted`"的 NodeRun 同步为 `interrupted`（Run 层的 interrupted 由既有 `StaleRecoveryService` 完成，不重复实现）。
2. 已 `completed` 的 NodeRun 一律不动（满足恢复要求 ②）。
3. 重新评估每个 `pending` 节点的 join：只按 `node_runs` 前驱行判定；不满足就保持 `pending`（满足恢复要求 ⑤）。
4. join 已满足但下游 NodeRun 尚未创建的，补建并入队。
5. 既不满足 join、也没有任何可继续节点、且存在非终态节点的 GraphRun → `blocked` + `recovery_inconsistent`。

## 8. 开放项（不阻塞开发）

- Edge 的 `joinPolicy` 本 slice 只实现 `all_required`；`any_of` / 条件路由等待第二种图形状。
- 结构性只读隔离未实现，物理并行不在范围内（ADR 0006 第 3 节已定为默认基线）。
- `AgentCapability` 词汇表扩展待真实证据。

> 全部 Q1-Q4 已关闭，`spec.md` 状态由 `idea` 推进为 `ready-for-development`，可按 `tasks.md` 展开实现。
