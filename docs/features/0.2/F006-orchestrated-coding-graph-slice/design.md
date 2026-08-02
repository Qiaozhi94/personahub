---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, fan-out, fan-in, recovery]
doc_kind: design
created: 2026-08-01
updated: 2026-08-02
---

# F006：Orchestrated Coding Graph Slice - 设计

> Status: ready-for-development | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

在现有 Run 之上补一层 **NodeRun（逻辑工作）**，把 Run 的职责收窄为 **Attempt（一次具体的 provider 执行）**，用新增的 `graph_runs` / `node_runs` 两张表承载图状态，Edge 定义内联在版本化的 definition 常量里，实际 edge traversal 用 ThreadEvent 记录。图推进挂在既有的 `RunDispatchService.workflowHook()` 这一个 seam 上，与 F004 的 validation 分支并列，不改写它。

物理串行由**既有机制**保证：fan-out 的两个节点各创建一个 `queued` Run，落到同一 workspace 的 FIFO 队列（`run.ts:132` `listQueuedByWorkspace`），由 `run-dispatch.ts:167` `startNextQueuedRun` 在前一个 Run 终态时自然驱动下一个。F006 不新建调度器、不碰 `workspace-lock.ts`。

## 2. 影响面

- **存储**：新增 `schema-v8.ts`（`graph_runs`、`node_runs` 两表 + `runs.node_run_id` 列 + 两个 partial unique index）。
- **后端 service**：新增 `GraphRuntimeService`（调度 / join / 恢复）；`RunDispatchService.workflowHook()` 增加一条按 `node_run_id` 分流的分支。
- **恢复**：新增 `GraphRecoveryService`，在 `index.ts` 启动序列中排在 `StaleRecoveryService.runAll()` 之后、`drainWorkspace` 之前。
- **事件**：新增 **7 个** `graph.*` ThreadEvent 类型（第 6 节表格，含 `graph.executor_reassigned` 与判别联合的 `graph.terminal`）；`graph.node_result` 须加入 `EvidenceService` 的 `TRUSTED_INTERNAL_ALLOWLIST`。事务内一律只 `write()`，broadcast 延到最外层提交后。
- **前端**：Thread 内的节点卡片与 Inspector 的 graph projection 段落；不做 Canvas。
- **共享原语**：新增 `resolveEligibleAdapter()`（组合既有 `resolveAdapter()` + `hasCapability()`，第 8.3 节），F006 与 F007 共用；不改这两个既有函数的签名。
- **改动既有代码（三处）**：`RunEscalationHandler.cancelQueuedRunsForIssue()` 增加 GraphNode 过滤；`transitionToRunning` 增加 GraphNode 分支同步 NodeRun；`RunDispatchService.cancel()` 的 queued 分支补图推进调用（该分支不走 `finalizeAndDrain`，见第 7 节）。
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
- **EdgeTraversal**：`thread_events` 已有 `evidence_refs TEXT NOT NULL DEFAULT '[]'` 列（`schema-v1.ts:98`）与 `EvidenceService` 的引用解析。traversal 是**发生过的事**，与 ThreadEvent 的语义完全吻合，且天生可回放、可在 Thread 中展示（满足 TR-001 / AC-003）。新建第五张表只会让同一件事有两个真相源。
  注意：既有解析只解决"引用指向谁"，**不解决"内容是什么"**，也从未产出过 `truncated`。节点结果的载体与截断另行定义，见第 6 节——这是本设计初稿最主要的一处事实错误。

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
  status TEXT NOT NULL,            -- running | blocked | cancelling | completed | cancelled
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
  result_event_id TEXT REFERENCES thread_events(id),   -- 指向 graph.node_result，见第 6 节
  assigned_adapter_config_id TEXT REFERENCES agent_configs(id),  -- 确认过的执行者，见第 8.4 节
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (graph_run_id, node_key)
);

ALTER TABLE runs ADD COLUMN node_run_id TEXT REFERENCES node_runs(id);

-- 一个 Issue 同时至多一个**非终态** GraphRun。非终态 = running + blocked + cancelling：
-- blocked 的图仍可经节点级 retry 恢复，cancelling 的图还在等运行中进程退出，
-- 两者都是活着的工作流实例；若只排除 running，在这两个状态下再次建图
-- 会产生两个图争抢同一个 Issue 状态与 workspace 队列。
CREATE UNIQUE INDEX idx_graph_runs_one_nonterminal_per_issue
  ON graph_runs(issue_id) WHERE status IN ('running', 'blocked', 'cancelling');

-- 一个 NodeRun 同时至多一个 active Attempt（spec 第 3 节边界场景的结构性兜底）
CREATE UNIQUE INDEX idx_runs_one_active_graph_attempt
  ON runs(node_run_id) WHERE node_run_id IS NOT NULL AND status IN ('queued', 'running');
```

### 三条约束各自防住什么

- `UNIQUE (graph_run_id, node_key)`：一个节点在一次 GraphRun 里只有一行逻辑工作，重复调度撞唯一约束而不是静默产生第二项工作。
- `idx_runs_one_active_graph_attempt`：单 active Attempt 不再只靠服务层 CAS。第 7 节的 retry CAS 仍是主路径（它给出干净的用户级错误），这个索引是**兜底**——覆盖 CAS 之外的其它建 Run 路径（恢复补建、join 触发的下游创建）。
- `idx_graph_runs_one_nonterminal_per_issue`：建图的幂等键，双击/重试不会产生第二个图。新图只能在前一个图 `completed` 或 `cancelled` 之后创建；前一个图仍 `blocked` 时应引导用户走节点级 retry 或先取消整图，而不是另起一个。

### NodeRun 生命周期：全部预建（Q1 补充结论）

前一轮 T021 说建图时把 synthesis 建为 `pending`，T032 又说 join 满足时"创建 synthesis NodeRun + Run"——两套互斥的生命周期模型。按字面实现，正常 join 成功每次都会撞 `UNIQUE (graph_run_id, node_key)`；若把这个撞击当成幂等成功吞掉，就会连 Attempt 一起跳过，图静默停在 fan-in。

**选定：建图时预建全部 NodeRun（含 synthesis，状态 `pending`）。** join 满足时**只做两件事**——CAS `pending → ready`，然后创建该节点的 Attempt。理由：

- 逻辑工作在图启动那一刻就是确定的，`node_runs` 表达的正是逻辑工作而非"已排上队的工作"。
- 执行者也在那一刻确定（第 8.4 节 `assigned_adapter_config_id`），预建才有地方存。
- 唯一约束回归为**真正的异常防线**，而不是正常路径的控制流。

对应地，恢复第 4 步改为"join 已满足但该 NodeRun 仍 `pending` / 无 active Attempt → CAS 并补建 Attempt"，`join_satisfied_at` 由 `evaluateJoin` 唯一写入。

**唯一索引冲突必须映射成用户级错误**：裸 `SQLITE_CONSTRAINT` 抛到 HTTP 边界会变成 500。连点 retry 的正确响应是"该节点已有进行中的尝试"，不是"服务器内部错误"。

### 新 FK 必须接入既有的 adapter 删除守卫

`AdapterConfigService.delete()` 目前只用 `hasRuns(id)` 判断在用，而 `hasRuns()` 查的是 `runs.adapter_config_id`（`agent-config.ts:220-224`）。新增 `node_runs.assigned_adapter_config_id` 后出现一个它看不见的引用：**`pending` 的 synthesis 节点已被指派执行者但还没有任何 Run**。若该 adapter 只被这一处引用，删除会通过前置检查、然后被数据库外键拒绝——裸 `SQLITE_CONSTRAINT` 逃逸成 500，而用户真正需要的是 `ADAPTER_IN_USE`。

因此把 NodeRun 引用并入同一道守卫：

- 判据是**任何** NodeRun 引用了该 adapter，不区分终态——`foreign_keys = ON` 下 FK 本就会拦住指向它的所有行，守卫必须与数据库的实际行为一致，否则守卫放行、数据库拒绝，还是 500。
- 这与既有语义是一致的而非更严：`hasRuns()` 同样在**任何历史 Run** 引用时就阻止删除。图跑过之后 `runs.adapter_config_id` 本来也会挡住删除，新守卫真正补上的只有"pending synthesis 已指派但还没有 Run"这一个窗口。
- 需要一条"只有 pending synthesis 引用、尚无 Run"的删除回归测试，断言返回 `ADAPTER_IN_USE` 而非 500。

FK 是有实效的——`db/index.ts:7` 已开 `foreign_keys = ON`。`ALTER TABLE ... ADD COLUMN ... REFERENCES` 在 SQLite 下合法的前提是默认值为 NULL，此处满足。`result_event_id` 指向 `thread_events`，而 thread_events 从不删除，FK 不会成为写入障碍。

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

### 节点指令契约（第四轮检视补，此前完全缺失）

`runs.instructions` 是 `NOT NULL`（`schema-v2.ts:29`），而既有的 `run-context-builder.ts` 只装配 Issue、角色、handoff、文件变更这些**通用**上下文——它不可能知道某个节点该从并发视角还是契约视角检视、该看哪些文件、必须输出什么结构。前几版把节点"责任"写在表格里当成了设计完成，实际上到了建 Run 那一步没有任何确定性来源可以填 `instructions`，T030 的解析器也就没有可靠的上游契约。

**指令属于 definition，与 definition 同版本、同 append-only 纪律。** 每个节点在 definition 里声明：

```ts
interface GraphNodeV1 {
  key: string;
  requiredCapabilities: AgentCapability[];
  /** 该节点的视角与判据，纯静态文本，随 definition 版本冻结 */
  instructionTemplate: string;
  /** 声明该节点需要哪些输入槽位，由 builder 按此拼装 */
  inputSlots: string[];
  /** 期望的输出 envelope（第 5 节结构），随指令一并下发 */
  outputContract: "findings_v1" | "synthesis_v1";
}
```

新增 `GraphNodeInstructionBuilder`，是图节点 `instructions` 的**唯一**生成入口：

```text
instructions = 节点视角与判据（instructionTemplate）
             + 目标文件集
             + 入边输入（synthesis 才有：两份可信 payload + 截断声明）
             + 输出 envelope 契约（outputContract 对应的 JSON schema 说明）
```

几处必须钉死，否则实现者要自行补产品决策：

- **目标文件集的真相源**：v1 由 definition 常量声明一组 glob，解析成具体文件列表后**随指令冻结**（写进 `instructions`），不在执行时再扫。理由是两个前驱必须看同一份文件集才可比，执行时各扫一次会因中途文件变动而产生不可比的两份结果。
- **解析在写事务之外做**。`createGraph(tx, ...)` 是纯 DB 写，而 glob 要遍历文件系统——把它放进事务里，会让一个大仓库的目录遍历一直占着 SQLite 的全局写锁，而此时 F007 的外层事务已经创建了 Issue。因此顺序是：**preflight（事务外）解析并冻结 `TargetFileSet` → 开写事务 → 事务内只复核 workspace id 与路径未变，然后消费冻结结果**。
- **确定性规则必须写死**，否则 T020g 的"逐字节相同"在不同平台/glob 库下根本无法稳定通过：
  - 路径一律 workspace 相对、分隔符统一为 `/`；
  - 每个 glob 内部按**字典序**排序（按 UTF-8 字节比较，不用 locale 敏感的比较）；
  - 多个 glob 之间按 definition 中的声明顺序拼接，跨 glob 全局去重且**保留首次出现的位置**；
  - 解析后越出 workspace 的 symlink 一律拒绝（建图失败），不跟随；
  - 文件名中的换行、引号等特殊字符用 JSON 编码写入指令，防止破坏指令结构。
  - 测试覆盖 Windows/POSIX 分隔符、重复命中的 glob、symlink、含特殊字符的文件名。
- **空集合**：解析结果为空 → 建图阶段直接拒绝 `GRAPH_TARGET_SET_EMPTY`（属第 7 节"写库前拒绝"的一类），不建一个注定跑空的图。
- **上限**：文件列表超过 500 条或 64 KB 时，按 glob 声明顺序截断并在指令正文写明截断事实与丢弃数量；**禁止静默截断**，与结果侧的裁剪纪律一致。
- **retry 复用原指令**：从 `runs.instructions` 原样复制上一个 Attempt 的指令，**不重新生成**。重新生成会让重试面对与首次不同的文件集，"同一个 NodeRun 的多次 Attempt"就失去了可比性。
- synthesis 的入边输入按第 6 节的预算与截断规则拼装，`inputSlots` 的键名与 `GraphEdgeV1.inputSlot` 一一对应。

`instructionTemplate` 是静态文本、不做变量插值以外的任何逻辑，这样"同一 definition 版本产出同样的指令"可被测试直接断言。

### required_capabilities 的诚实取舍

`AgentCapability` 当前只有 `Implementation` 和 `Validator` 两个值（`shared/src/types/adapter.ts:24-27`）。本 slice 三个节点**统一声明 `Implementation`**，不新增 `analysis` / `review` 枚举值。

理由：新增枚举值会牵动 adapter 配置 UI 的 capability 勾选，而**用户已配置的 adapter 不会自动获得新 tag**，结果是图一上线就找不到可用执行者。等真正出现"某类 agent 不能做分析"的证据时再加。这不违反 ADR 0006 的"Node ≠ Agent"——节点声明的仍是能力而非具体 adapter，只是当前能力词汇表还很粗。

## 6. Q3（已关闭）：Edge payload 与 traversal contract

**Edge 只承载引用——但引用必须指向一个真的能取回内容的载体。**

### 初稿的两处事实错误（已修正）

初稿写"走既有 `evidence_refs` / `EvidenceResolution` 通道，复用它 `resolved | missing | truncated` 的三态语义"。核实后两处都不成立：

1. `EvidenceService.resolveEventRef()` 只返回 `target: { id, type, thread_id, run_id }`（`evidence.ts:125-136`），**不含 payload**。它回答"这条引用指向谁"，不回答"内容是什么"。
2. `EvidenceResolution.status` 的类型声明里虽然写了 `"truncated"`，但 `evidence.ts` 全文只产出 `"resolved"` 与 `"missing"`——**该状态从未被任何代码写出过**。把它当既有能力用，是把类型声明误读成了实现。

再加上 `graph.node_completed` 只记 `status`/`attempt_count`，按初稿实现的结果是：两个节点显示 completed、两条边显示 traversed、synthesis 拿到空输入。

### 结果的唯一真相源

- 新增 ThreadEvent 类型 `graph.node_result`，payload 存**已解析**的节点结果 envelope（第 5 节的结构）。
- `node_runs.result_event_id` 指向该事件，**不指向 `graph.node_completed`**。
- 必须把 `graph.node_result` 加入 `EvidenceService` 的 `TRUSTED_INTERNAL_ALLOWLIST`（`evidence.ts:20-31`）；不加则 `resolveTrustedPayload()` 对它直接返回 `null`，下游一无所获。
- 下游取内容一律经 `resolveTrustedPayload(ref, scope)`，且 **scope 只传 `issueId` + `threadId`，绝不传 `runId`**：该方法在 `scope.runId` 存在时要求事件 payload 的 `run_id` 与之相等（`evidence.ts:256-259`），而 fan-in 的本质就是跨 Run 取前驱结果，传了必然返回 `null`。

### 截断由本 slice 自己实现

既然 `truncated` 不是既有能力，synthesis 的输入预算按 `run-context-builder.ts` 的既有手法自己实现（`mustNotTruncate` 段 + 逐级降级 + `RUN_CONTEXT_MAX_BYTES` 上限）：

**顺序与边界必须明确**（前一轮"事件存完整 envelope"与"每份 envelope 有字节上限"自相矛盾，读不出库里存的到底是哪个）：

```text
Run final_message（原始，保留在既有 run trace 中，供审计/retry）
  → 解析
  → 施加数量/字节上限，超限则丢弃并计数
  → 持久化【已裁剪】的 graph.node_result
  → 组装 synthesis 上下文（此处只做拼装与整体预算，不再二次裁剪单份结果）
```

即**库里存的就是裁剪后的结果**，`graph.node_result` 不承载无界内容。具体上限：

| 项 | 上限 | 超限行为 |
|---|---|---|
| 单份结果 findings 条数 | 200 | 按原序保留前 200 条，`dropped_count` 记差值 |
| 单条 finding 各字符串字段 | 2000 字符 | 该条整体丢弃并计数（不切碎单条） |
| `not_reviewed` 条数 | 100 | 按原序保留前 100 条并计数 |
| `not_reviewed` 单项 | 1000 字符 | 该项整体丢弃并计数 |
| 单份 `graph.node_result` payload | 256 KB | 依次丢 findings、再丢 `not_reviewed`；**仍超限则该 NodeRun `failed` + `result_too_large`**，绝不持久化无界事件 |
| synthesis 上下文总预算 | 复用 `RUN_CONTEXT_MAX_BYTES` | 按 `run-context-builder.ts` 的降级手法 |

**envelope 的每个可变长字段都要有界**，否则上限是算不到的：上一版只限制了 findings，而 `not_reviewed: string[]` 完全不设限——agent 返回一个巨大的 `not_reviewed` 时，把 findings 全部删光 payload 仍可能远超 256 KB，裁剪算法达不到自己声明的目标。`result_too_large` 是 `GraphBlockReason` 的第 8 个取值，恢复动作同 `result_unparsable`（节点 retry）。

- 每个前驱 envelope 超限时**按 finding 条目整条丢弃**（不切碎单条 JSON），并在 payload 记 `truncated: true` + `dropped_count`。
- 原始 `final_message` 不受影响，仍可用于事后核对与 retry。
- 截断声明必须出现在 synthesis 的输入正文里，**禁止静默缩水**——这正是初稿误以为免费获得的性质。
- 前驱结果取不到（解析失败 / 事件缺失 / 不在 allowlist / scope 不符）视为该节点结果不可用。**统一规则**：Attempt（Run）的进程状态可以是 `completed`，但该 **NodeRun 落 `failed` + `result_unparsable`**，`result_event_id` 保持 NULL，原始 `final_message` 留在既有 run trace 中备查。join 因此判定失败 → GraphRun `blocked` + `result_unparsable`。**不允许拿半份输入跑 synthesis**。

  这条在全文只有一种写法：**进程跑成功 ≠ 逻辑节点成功**。NodeRun 表达的是"这个节点契约要求的产出可不可用"，不是"子进程有没有退出码 0"。若把 NodeRun 留在 `completed`，节点 retry 的受理集合（`{failed, interrupted, cancelled}`）就够不着它，图会卡死且没有任何合法动作——第 7 节的恢复矩阵、事务一、恢复第 7 步、tasks 与测试全部按此对齐。

### ThreadEvent 类型（7 个）

| 类型 | 何时写 | payload 要点 |
|---|---|---|
| `graph.node_queued` | **每次** Attempt 入队（含 retry、恢复补建、synthesis 首次） | `graph_run_id`、`node_key`、`run_id`、`attempt_index`、`required_capabilities` |
| `graph.node_result` | 节点 envelope 解析成功 | 已裁剪的 envelope + `truncated`、`dropped_count` |
| `graph.node_completed` | NodeRun 终态 | `node_key`、`status`、`attempt_count`、`result_event_id` |
| `graph.edge_traversed` | 每次实际边转移 | `from_node_key`、`to_node_key`、`outcome`、`decided_by`、`input_refs[]` |
| `graph.join_satisfied` | fan-in 条件满足 | `to_node_key`、`satisfied_by[]`、`join_policy` |
| `graph.executor_reassigned` | `resolve-executors` 改写执行者 | `node_key`、`from`、`to`、`reason` |
| `graph.terminal` | GraphRun 到达终态（事务三） | 判别联合，见下 |

两处定义必须精确：

- **`graph.node_queued` 每个 Attempt 都写一条**，不是"NodeRun 第一次 ready 时写一次"。否则 synthesis 在事务二入队时没有事件（上一版 T032 只列了 `join_satisfied` 与 `edge_traversed`），同一事件类型对前驱有记录、对 synthesis 没有，Thread 回放会缺一段。payload 带 `run_id` 与 `attempt_index` 以便与具体 Attempt 关联。
- **`graph.terminal` 而不是 `graph.completed`**：事务三要处理成功、阻塞终态与取消三种收尾，而 `report_event_id` 只有成功态才有。用一个名为 "completed" 的事件表示取消是错的，让 `report_event_id` 在取消时随便填 null 也是错的。改成判别联合：

```ts
type GraphTerminalPayload =
  | { graph_run_id: string; status: "completed"; node_summary: NodeSummary[]; report_event_id: string }
  | { graph_run_id: string; status: "cancelled"; node_summary: NodeSummary[]; cancelled_node_keys: string[] }
  | { graph_run_id: string; status: "blocked_terminal"; node_summary: NodeSummary[]; blocked_reason_code: GraphBlockReason };
```

共享类型、Thread UI 与取消测试按此对齐。

`graph.edge_traversed` 的 `evidence_refs` 指向前驱的 `graph.node_result` 事件——这就是 TR-001 要求的"输入/输出 refs"。

### Edge 定义 v1 的形状

ADR 0006 要求 Edge 承载 outcome/条件、join、载荷传递、路由决策来源四件事。初稿把前三件都推给了 traversal 事件，等于没有定义——实现者按 T020 打勾也可能产出互不兼容的图。v1 显式定义：

```ts
interface GraphEdgeV1 {
  from: NodeKey;
  to: NodeKey;
  acceptedOutcomes: NodeRunStatus[];   // v1 固定 ["completed"]
  required: boolean;                   // v1 固定 true
  joinGroup: string;                   // v1 固定 "all_required"
  inputSlot: string;                   // 载荷进入下游的键名，如 "review_concurrency"
}
```

`decided_by` 是**观测值**，只记在 traversal 事件里（本 slice 唯一取值 `deterministic_join`，字段先留出以承接 ADR 0006 的"路由决策来源"要求），不进定义。定义回答"什么情况下允许通过"，traversal 记录"实际通过了没有、依据是什么"——两个契约必须分开，否则恢复时无从判断一条边该不该重走。

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

- 新增独立的 `GraphBlockReason` 枚举（`node_run_failed` / `node_run_cancelled` / `join_unsatisfiable` / `no_capable_adapter` / `result_unparsable` / `definition_version_unavailable` / `recovery_inconsistent`），**不复用 `ValidationBlockReason`**。
- 图 blocker 需要自己的恢复入口（节点级 retry），**不能走 validation 的 unblock 按钮**。这不是可选项——复用会让 validation 的 unblock 守卫失效。

### workspace 锁与并发

不新增任何锁机制。每个 Attempt 就是一个 Run，沿用 `workspaceLockService.acquire(workspace_id, run.id)`。fan-out 时两个 NodeRun 各创建一个 `queued` Run：第一个抢到锁执行，第二个留在队列，由 `finalizeAndDrain` → `startNextQueuedRun` 在第一个终态时启动（`run-dispatch.ts:144-168`）。

**AC-004（无两个 agent 进程并发访问同一 workspace）由既有机制保证，F006 不需要为此写新代码**，只需要一条断言测试证明该性质在图场景下依然成立。

### retry 与 escalation

- **retry**：见下方 blocker → 恢复动作矩阵。**retry 事务必须一并把 Issue 从 `Blocked` 放回 `Running` 并清掉图 blocker 字段**——前一轮只写了 NodeRun 与 GraphRun 回到运行态，Issue 仍停在 `Blocked`，而 `startNextQueuedRun` 的资格门是按 Issue 状态判定的，结果是按钮点了、Attempt 建了、队列永远不启动它。
- **"同一 NodeRun 只有一个 active Attempt"必须结构性保证**（spec 第 3 节边界场景）。仅靠 UI 禁用按钮不够：workspace 队列允许同一 workspace 上有多个 `queued` Run，连点两次 retry 会产生两个 Attempt，先后执行、后者覆盖前者结果。强制手段是 retry 入口在**同一事务内**做 NodeRun 状态 CAS（`{failed, interrupted, cancelled}` → `ready`）再建 Run，CAS 失败即拒绝——第二次点击拿不到 CAS，不会创建第二个 Run。这与 F004 `claimValidatorSlot()` 用 CAS 抢占验证槽位是同一手法。目标态是 `ready` 而非 `running`：Attempt 实际启动时才由 `transitionToRunning` 推进到 `running`（见本节状态映射表）。
- **escalation**：**必须改 `run-escalation-handler`，"复用且不改其逻辑"是错的。** 详见下一小节。

### escalation 必须变成 graph-aware（初稿错误，已修正）

初稿写"复用 `run-escalation-handler`，不改其逻辑"，同时又在队列资格门里给 GraphNode 开了个例外。这两句互相矛盾：`RunEscalationHandler.handle()` 在事务提交后直接调 `cancelQueuedRunsForIssue()`（`run-escalation-handler.ts:68,72-76`），对该 Issue 下**所有** `Queued` Run 无差别 `cancelQueued`——它根本不经过 `startNextQueuedRun`，第 7 节给 GraphNode 加的资格例外拦不住它。

后果：N1 触发 escalation → Issue `Blocked` → **排队中的 N2 当场被销毁**，且这次 cancel 不映射回任何 NodeRun，图变成不可恢复。

选定策略：**保留排队中的图节点 Attempt**。

- `cancelQueuedRunsForIssue()` 增加 `run.role !== RunRole.GraphNode` 过滤。理由：非图 Run 被取消是因为 Issue 状态机已经改变、它们再跑没有意义；而图节点有自己的生命周期（GraphRun）和自己的恢复入口，Issue `Blocked` 不等于该节点的工作作废。
- escalation 影响的那个节点：Run `failed` → NodeRun `failed` → join 不满足 → GraphRun `blocked` + `node_run_failed`。
- 兄弟节点保持 `queued`，等节点级 retry 或 GraphRun 恢复后由既有 drain 继续。
- **这是 `run-escalation-handler` 唯一允许的改动**，escalation 的检测、事件、Issue 置 `Blocked` 全部不动。

### blocker → 恢复动作矩阵

七个 `GraphBlockReason` 里前一轮只定义了节点 retry 一条路，另外几个进去就出不来。逐个定：

| blocker | 可恢复实体 | 受理动作 | 前置 | 事务内必须完成 |
|---|---|---|---|---|
| `node_run_failed` | NodeRun | 节点 retry | NodeRun ∈ `{failed, interrupted, cancelled}` | NodeRun→`ready`、GraphRun→`running`、Issue→`Running`、清 blocker、建 Attempt；提交后 drain |
| `node_run_cancelled` | NodeRun | 同上 | 同上 | 同上 |
| `result_unparsable` | NodeRun | 节点 retry | NodeRun 落库时**已经是 `failed`**（第 6 节统一规则），无需改判 | 同上 |
| `no_capable_adapter` | GraphRun | 改配置后"重新解析执行者" | 存在满足该节点能力的 Available adapter | 重解析并写 `assigned_adapter_config_id`、GraphRun→`running`、Issue→`Running`、清 blocker |
| `definition_version_unavailable` | GraphRun | 部署回补该版本后自动重评 | 注册表中该 `(id, version)` 重新可查 | 恢复扫描自动处理，无需用户动作 |
| `join_unsatisfiable` | GraphRun | 只能整图取消 | — | 终态化，不提供 retry |
| `recovery_inconsistent` | GraphRun | 只能整图取消 | — | 同上 |

两处必须点明：

- **`result_unparsable` 的 NodeRun 从落库那一刻就是 `failed`**（第 6 节统一规则），本表不做任何改判。曾经的"先 `completed` 再改判"写法已废弃——它会让 retry 的受理集合 `{failed, interrupted, cancelled}` 够不着该节点，图卡死且无合法动作。
- **`no_capable_adapter` 只产生于已建起来的图**：join 满足要建 synthesis Attempt 时、节点 retry 时、重启恢复补建 Attempt 时，持久化的执行者复核不通过（第 8.5 节）。**建图阶段绝不产生这个 blocker**——那时的资格失败一律在写库前整体拒绝（第 7 节），否则 F007 的"确认失败原子回滚"不成立。

### 取消的完整状态转移（初稿缺失，已补）

spec 第 3 节把"取消"列为边界场景、schema 也有 `NodeRunStatus.cancelled`，但初稿只映射了成功与失败，导致一个被取消的 required 前驱会让 join 永远不满足且没有任何合法恢复动作。

| 触发 | Run | NodeRun | GraphRun |
|---|---|---|---|
| 用户取消单个节点 | `cancelled` | `cancelled` | `blocked` + `node_run_cancelled` |
| 用户取消整个图 | 全部非终态 Run `cancelled` | 全部非终态 NodeRun `cancelled` | `cancelled`（终态，不可 retry） |
| 系统队列取消（非图路径误取消） | `cancelled` | `interrupted` | `running` 保持，按 interrupted 恢复 |

- `GraphBlockReason` 增加 `node_run_cancelled`。
- retry 的受理集合从 `{failed, interrupted}` 扩展为 `{failed, interrupted, cancelled}`——单节点取消是用户的主动动作，重来是合理诉求。
- GraphRun `cancelled` 是终态：不可 retry，用户要重跑就发起新的 GraphRun（此时前一个图已终态，不再占用非终态唯一索引）。

**取消必须有接入点，否则上表不可执行。** `RunDispatchService.cancel()` 的 queued 分支直接调 `runService.cancelQueued()` 就 return（`run-dispatch.ts:202-207`），**不经过 `finalizeAndDrain()`，因而不经过 `workflowHook()`**——图节点被排队取消时，Run 变 `cancelled` 而 NodeRun 会永远停在 `ready`。running 分支反而没问题（它走 `finalizeAndDrain`）。因此：

- 所有 GraphNode 的取消（用户单节点、整图、系统队列取消）**统一路由到一个 graph-aware 的终态回调**，与 running 路径共用同一段 NodeRun/GraphRun 推进逻辑。
- 具体接入点：`cancelQueued()` 之后补一次图推进调用，与 `workflowHook` 的 GraphNode 分支同一个入口函数；running 路径不变。
- 这是除 escalation 过滤之外，本 slice 对既有 dispatch 代码的第二处改动。

### Run / NodeRun 状态映射表（初稿缺失，已补）

初稿 schema 定义了 `ready` 但没有任何地方写入它，retry 又直接写 `running`，导致 health、UI、恢复三处对"排队中的节点算 ready 还是 running"可以有三种理解。显式定义：

```text
pending  --join 满足-->  ready  --Attempt 入队-->  ready
ready    --Attempt 实际启动-->  running
running  --Attempt 终态-->  completed | failed | interrupted | cancelled
```

- `pending`：join 未满足，尚未创建 Attempt。
- `ready`：已创建 `queued` Attempt，但还没抢到 workspace 锁。
- `running`：Attempt 已 `running`。需要在 `transitionToRunning` 处增加一个 GraphNode 分支同步 NodeRun。
- retry：CAS 成功后 NodeRun 先回到 `ready`（而非初稿的 `running`），Attempt 启动时才转 `running`。

### 图定义的版本保留纪律

`graph_runs` 只存 `definition_id` + `definition_version`，定义本体在 TypeScript 常量里。因此：

- **图定义按 `(id, version)` append-only**：v1 一旦有 GraphRun 引用过就不得原地修改或删除，改动一律发新版本。这与 F008 对 `workflow_templates` 的版本化纪律同源。
- 运行时按**精确版本**从注册表查定义，不得"取最新"。
- 查不到该版本 → GraphRun `blocked` + `definition_version_unavailable`（新增的 `GraphBlockReason` 取值），**不得静默降级到最新版本**——那会让恢复出来的图和当初跑的图结构不同。

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

### 写入原子性与推进的幂等性

初稿没有对 `start()` 与图推进提出事务要求，而恢复算法只修"active Attempt 被 interrupt"和"下游未创建"两种情况，修不了半途崩溃留下的残局。两处必须收紧：

**建图全部落在一个事务里**——GraphRun、**三个** NodeRun（含 `pending` 的 synthesis，逐个写 `assigned_adapter_config_id`）、两个前驱的 `queued` Run、`graph.node_queued` 事件、Issue 转 `Running` 一并提交。实际派工发生在提交之后（由调用方在最外层提交后触发 drain，见第 8.2 节），因此不需要 `initializing` 中间态。幂等由 `idx_graph_runs_one_nonterminal_per_issue` 保证：重复调用撞唯一索引，返回既有 GraphRun 而不是建第二个。

**建图前先做全量校验，失败一律不写库。** definition 查不到、`nodeAssignments` 缺项、任一 assignment 的资格解析不通过——这三类**在任何写入之前**判定并直接拒绝（`GRAPH_DEFINITION_UNAVAILABLE` / `GRAPH_PLAN_INCOMPLETE` / `ADAPTER_CAPABILITY_MISSING` 等），让 F007 的外层事务整体回滚。**建图阶段绝不产生 `blocked` 的 GraphRun**——否则 F007 承诺的"确认失败则原子回滚"就不成立：用户会得到一个已创建的 Issue 加一个进不去也退不出的空图。

`no_capable_adapter` / `definition_version_unavailable` 这两个 blocker 只适用于**已经建起来的图**：节点 retry 时其 `assigned_adapter_config_id` 已不可用或已失去能力、部署回退导致 definition 版本消失。此时图已有实体与历史，阻塞并提供恢复入口才有意义。

**图推进拆成两个各自幂等的事务**，因为 `finalizeAndDrain()` 对 `workflowHook()` 的异常是全吞的（`run-dispatch.ts:163-166` 的空 catch，注释写明"hook errors must not prevent queue drain"）——这条不能改，它保护的是队列不被单个 Run 的问题卡死。代价是：图推进一旦抛异常，NodeRun 会停在非终态且**无人知晓**，直到下次重启。应对是让推进本身可被无损重放：

1. **事务一**：NodeRun 置终态 + 写 `graph.node_result` / `graph.node_completed` + 回填 `result_event_id`。幂等键是 NodeRun 状态 CAS——已终态则直接返回。
2. **事务二**：评估 join → synthesis NodeRun CAS `pending → ready` → 第 8.5 节的资格复核 → 创建**唯一**一个 queued Attempt → 写 `graph.node_queued` / `graph.join_satisfied` / 两条 `graph.edge_traversed`。**不创建 NodeRun 行**（三个节点建图时已预建）。
   幂等键分别是：NodeRun 的 `pending → ready` CAS、`idx_runs_one_active_graph_attempt`（保证只有一个 active Attempt）、以及各事件按 `(graph_run_id, node_key)` + 类型的存在性判断。**不得再拿 `UNIQUE (graph_run_id, node_key)` 当正常路径的幂等控制流**——那是预建模型下的异常防线，正常 join 根本不会撞它。

只要事务一提交了，事务二任何时候重放都得到同样结果。

**事务三：图终态化。** 前一轮只描述了"完成一个节点"和"创建下游节点"，没有任何一步负责把图收尾——synthesis 成功后 GraphRun 会一直停在 `running`、Issue 停在 `Running`，而第 7 节的状态表却承诺了"全部节点完成 → Issue `Ready`"。补上，同样幂等：

- **成功**：synthesis NodeRun 终态 + 结果事件已写 → GraphRun `running → completed`（CAS）、Issue `Running → Ready`、清空 blocker 字段、写 `graph.terminal`（`status: "completed"` 分支，带 `report_event_id`）。提交后再 broadcast。
- **失败**：required 前驱终态失败且无 active Attempt → GraphRun `running → blocked` + 对应 `GraphBlockReason`、Issue → `Blocked`。这条同样必须是一个明确的事务，而不是散落在 `evaluateJoin` 里的副作用。
- **取消收尾**：最后一个非终态 NodeRun 到达终态时 → GraphRun `cancelling → cancelled`、Issue → `Ready`、写 `graph.terminal`（`status: "cancelled"` 分支）。
- 幂等键是 GraphRun 状态 CAS；重复触发（hook 重入、恢复重放）第二次直接返回。
- 测试：成功、失败、重复触发、写之间崩溃四种。

### 重启恢复流程

新增 `GraphRecoveryService.reconcile()`，在 `index.ts` 中排在 `StaleRecoveryService.runAll()` 之后、`drainWorkspace` 之前（现为 `index.ts:149` 与 `index.ts:161-164`）。

**扫描集合是全部非终态 GraphRun，即 `{running, blocked}`**，不是只有 `running`。`definition_version_unavailable` 与 `no_capable_adapter` 这类 blocker 会因为部署回补或配置修好而重新可解，若把 blocked 排除在扫描外，一个本可自愈的临时问题会永久固化。但**自动重评仅限确定性的、与用户意图无关的 blocker**（`definition_version_unavailable`）；`node_run_failed` / `node_run_cancelled` / `join_unsatisfiable` / `recovery_inconsistent` 一律保持等待用户动作，恢复流程不得替用户决定重试。

**第 0 步是守卫，必须排在最前**：按 `(definition_id, definition_version)` 精确查注册表。查不到就**跳过该图的其余全部步骤**并置 `blocked` + `definition_version_unavailable`。步骤 3、4、6 都要读 definition 才能算 join 与出边，若把缺失检测放在末尾，实现会在到达它之前先抛异常——守卫必须先于它保护的操作。

若该版本此后被回补，下一次扫描在同一事务内：GraphRun → `running`、Issue → `Running`、清 blocker、按第 3~4 步恢复待续节点，提交后 drain。这是唯一一个由恢复流程自动解除的 blocker。

1. 每个非终态 GraphRun：把"active Run 已被置 `Interrupted`"的 NodeRun 同步为 `interrupted`（Run 层的 interrupted 由既有 `StaleRecoveryService` 完成，不重复实现）。
2. 已 `completed` 的 NodeRun 一律不动（满足恢复要求 ②）。
3. 重新评估每个 `pending` 节点的 join：只按 `node_runs` 前驱行判定；不满足就保持 `pending`（满足恢复要求 ⑤）。
4. join 已满足但该 NodeRun 仍 `pending` 或无 active Attempt → CAS 到 `ready` 并按 `assigned_adapter_config_id` 补建 Attempt（全部 NodeRun 在建图时已预建，此处不新建行）。
5. 既不满足 join、也没有任何可继续节点、且存在非终态节点的 GraphRun → `blocked` + `recovery_inconsistent`。
6. **NodeRun 已终态但其出边从未评估过**（事务一提交、事务二未提交）→ 重放事务二。
7. **Run 已终态但其 NodeRun 仍非终态**（事务一自身失败）→ 按 Run 的 `final_message` / `status` **幂等重放事务一**，含解析失败映射为 `result_unparsable`。若原始输出已不可得，落 NodeRun `failed` + 明确的处理失败标记，**不留在 running**。这一条是前一轮真正缺的：第 1 步只处理被置为 `interrupted` 的 Run，第 5 步只会把图整个判成 inconsistent，而 `finalizeAndDrain` 的空 catch 恰恰会让事务一的失败无声无息。
8. 全部节点已终态但 GraphRun 仍 `running` → 重放事务三（终态化）。
（definition 缺失的检测与回补解除见上方第 0 步守卫，不再作为末尾步骤。）

**故障注入测试要打在每个写边界上**，而不只是事务之间：`start()` 内部、事务一的解析前/写入中、事务一与事务二之间、事务二内部、事务三内部，各注入一次崩溃，断言重启后收敛。

## 8. 跨 feature 执行契约（F006 拥有，F007 消费）

前一轮把 `start(issueId, plan)` 只写进了 F007，F006 这边仍是 `start(issueId)` 且内部自行 resolve——改调用方文档不构成契约。**本节是该契约的唯一定义处**，F007 引用本节而不自行声明。

### 8.1 `GraphExecutionPlan`

```ts
interface GraphExecutionPlan {
  definitionId: string;
  definitionVersion: number;
  /** 逐节点执行者，键为 definition 内的 node_key，必须覆盖 definition 的全部节点 */
  nodeAssignments: Record<string, string>;
  /** 供审计与 stale 溯源，运行时不解释其内容 */
  premiseHash: string | null;
}
```

- **必须覆盖全部节点**，包括启动时还不执行的 synthesis。缺任何一个节点 → `GRAPH_PLAN_INCOMPLETE`，不允许"到时候再算"。
- 每项在建图事务内经 8.3 的资格解析复核；任一不通过 → **整体拒绝**，不部分启动、不自行替换。

### 8.2 事务归属：持久化与派工分离

前一轮 F007 要求"单外层事务内调 `start()`"，F006 又写"`start()` 自持事务、返回后触发 drain"。两者嵌套时内层只能提交 savepoint，外层若回滚，已经被拉起的子进程无法撤销。

拆成两个入口，**只有最外层的 commit 才有意义**：

```ts
interface DbOnlyResult<T> {
  value: T;
  pendingEvents: ThreadEvent[];      // 已写库、尚未 broadcast
  affectedWorkspaceIds: string[];    // 待 drain
}

// 纯 DB 写，使用调用方的事务；绝不拉起进程、绝不 drain、绝不 broadcast
createGraph(tx, issueId, plan): DbOnlyResult<{ graphRunId: string; queuedRunIds: string[] }>
enqueueSequential(tx, ...): DbOnlyResult<{ runId: string }>

// 便利入口：自开事务调 createGraph，提交后 broadcast + drain。供非 intake 的直接调用方使用
start(issueId, plan): Promise<{ graphRunId: string }>
```

提交后由最外层统一收尾：

```ts
for (const e of pendingEvents) threadEventService.broadcast(e);
for (const id of affectedWorkspaceIds) drainWorkspace(id);
```

- F007 的 `IntakeService.confirm()` 调 **`createGraph(tx, ...)`**，在自己的事务里；提交后由它统一 broadcast 与 drain。
- **契约是"事务内不得有任何不可回滚的副作用"**，不只是"不 drain"。事务内一律只调 `threadEventService.write()`，**禁止 `writeAndBroadcast()`**——后者写完立即 `eventBus.publish()`（`thread-event.ts:33-44`），而 F007 的幂等设计会让重复确认先建出临时 Issue/Run/事件、最后撞 `nonce` 唯一键整体回滚：广播出去的消息**收不回来**，SSE/UI 会收到一批实际并不存在的 Issue 与 Run。既有 `RunEscalationHandler` 已经是这个写法（收集 `pendingBroadcasts`，事务外逐个 broadcast），本 slice 沿用同一纪律。
- 该约束适用于**全部**图事务：建图、事务一/二/三、retry、恢复、取消、`resolve-executors`。
- **明令禁止**：任何嵌套 service 在自己返回时拉起 provider 进程。drain 失败不损坏状态——queued Run 仍在库里，下次 drain 或重启恢复即可继续。
- 两条分支都要有"内层返回后外层回滚"的故障注入测试，断言项包括：无进程、库中无残留行、**event bus 未收到任何 phantom 事件**。

### 8.3 资格解析必须同时验能力

`resolveAdapter(deps, projectId, workspaceId, explicitAdapterId?)` 的实际签名**没有 capability 参数**（`adapter-resolver.ts:32-64`），它只校验同 Project 归属与 workspace 级有效可用性。`hasCapability()` 是 `agent-config.ts:12` 里另一个独立函数。因此前一轮"经 `resolveAdapter()` 复核"只证明了 adapter 可用，**没有证明它能干这个节点**——一个 Available 但缺 `implementation` 能力的 adapter 会原样通过那道"保护"。

新增一个共享原语，F006 建图与 F007 确认复核都只走它：

```ts
resolveEligibleAdapter(deps, projectId, workspaceId, {
  explicitAdapterId?: string | null;
  requiredCapabilities: AgentCapability[];
}): { ok: true; adapterConfigId: string; source: RunDispatchSource }
 | { ok: false; errorCode: ErrorCode }   // 新增 ADAPTER_CAPABILITY_MISSING
```

内部组合既有的 `resolveAdapter()` + `hasCapability()`，**不改这两者的签名**，避免波及 F002/F004/F005 的既有调用点。测试必须覆盖"显式指定一个 Available 但无该能力的 adapter"。

### 8.4 执行者必须落库

synthesis 节点在建图时创建但**不立即执行**，其执行者若只存在于内存计划中，重启即丢失。因此 `node_runs` 增加一列：

```sql
assigned_adapter_config_id TEXT REFERENCES agent_configs(id)
```

建图时按 `nodeAssignments` 逐节点写入；join 满足后创建 synthesis Attempt 时**读这一列**，不重新解析出另一个执行者。恢复流程照常从库中读回。需要一条"fan-in 之前重启，确认过的 synthesis 执行者仍然生效"的测试。

### 8.5 延迟执行前必须复核资格（第四轮检视补）

"不重新解析"指的是**不换人**，不是**不校验**。synthesis 从建图到实际执行之间可能隔很久，这段时间里被指派的 adapter 完全可能被置为 unavailable、被摘掉 capability、或被加上一条 workspace 级覆盖。而既有的 `startAdapter()` 只做 `agentConfigRepo.getById()`（`run-dispatch.ts:224-227`），**既不看 workspace 有效状态也不看能力**——照当前文档实现，系统会拿一个已经不合格的 adapter 继续启动，失败后只得到一个普通的 `spawn_failed`，永远走不到文档承诺的 `no_capable_adapter` 恢复路径。

因此在每个**延迟创建 Attempt** 的时点，对持久化的显式 id 调一次 `resolveEligibleAdapter()`：

| 时点 | 处置 |
|---|---|
| join 满足、创建 synthesis Attempt | 不合格 → 同事务内 GraphRun `blocked` + `no_capable_adapter`、Issue `Blocked`，**不创建 Attempt** |
| 节点 retry | 同上，retry 请求返回 409 `NO_CAPABLE_ADAPTER` |
| 重启恢复补建 Attempt | 同上，恢复流程置 blocked 而非静默跳过 |
| **queued Attempt 被 claim 去启动** | 见下，这是第四个时点 |

**第四个时点不可省。** 上一版只在"创建 Attempt"时复核，但两个前驱的 Attempt 在**建图时就已创建并排队**——第二个前驱可能在队列里等第一个跑很久。这段等待期里 adapter 的 status、workspace 覆盖或 capability 完全可能变化，而它不经过任何一个创建时点，最终由只做 `getById()` 的 `startAdapter()` 直接启动（`run-dispatch.ts:224-227`）。

因此在 GraphNode 从 `queued` 转 `running` 的那条原子路径上加最后一道门：

```text
取得 workspace 锁
→ 事务：重读 GraphRun / NodeRun，对 Run 上的显式 adapter id + definition 节点能力
         调 resolveEligibleAdapter()
   ├─ 合格   → Run/NodeRun → running，提交，**提交后**才拉起进程
   └─ 不合格 → 不拉进程；Run 置 `cancelled` + failure_reason `adapter_no_longer_eligible`；
               NodeRun 回 `pending`（保留可恢复性，不是 failed——这次尝试根本没跑）；
               GraphRun `blocked` + `no_capable_adapter`；Issue `Blocked`；
               **释放 workspace 锁**并继续 drain 队列里的其它 Run
```

- NodeRun 回 `pending` 而非 `failed`：进程从未启动，把它记成"尝试失败"会让 attempt 计数虚增、也误导用户。恢复由 `resolve-executors` 承担。
- 不写 `graph.node_completed`（节点没有完成任何事），改写 `graph.node_queued` 的对应撤销信息进 `graph.blocked` 语义——具体见第 6 节事件表。
- 必须有一条确定性测试：**前驱 N1 running、N2 queued，期间把 N2 的 adapter 置为不可用**，断言 N2 不启动进程、图进入 `no_capable_adapter`、且 workspace 锁被正确释放。

- **绝不静默换人**：不合格就阻塞，由用户经 `resolve-executors` 显式决定。
- 校验与 Attempt 创建在**同一事务**内，避免"校验通过 → 配置变更 → 创建"的窗口；配置变更侧本就要走各自的写事务，SQLite 的写串行化足以定序。
- `resolve-executors` 成功后同样在其事务内复核一遍再解除阻塞。
- 三类变化（status、workspace override、capability）各需一条测试。

## 9. API 契约

`docs/features/README.md` 要求 design 覆盖 API/contract。初稿只点了路由名，不足以让前端确定 loading / stale / blocked / retry 各态。

### `GET /api/issues/:issueId/graph`

**基数**：一个 Issue 可以有多个 GraphRun（前一个 `cancelled` 后可再起）。本端点返回**当前的那一个**，定义为：非终态的那个（由唯一索引保证至多一个）；若无非终态图，则取 `created_at DESC, id DESC` 的第一个。响应同时给出 `history: [{ graph_run_id, status, created_at }]` 供切换，历史详情走 `GET /api/graph-runs/:graphRunId`（同一 projection 形状）。**不允许**实现里出现无序的 `LIMIT 1`。

```ts
// 200
interface IssueGraphResponse {
  current: GraphRunProjection | null;          // 非图 Issue 为 null
  history: Array<{ graph_run_id: string; status: GraphRunStatus; created_at: string }>;
}

interface GraphRunProjection {
  graph_run: {
    id: string; status: GraphRunStatus; blocked_reason_code: GraphBlockReason | null;
    definition_id: string; definition_version: number;
    created_at: string; updated_at: string;
  };
  nodes: Array<{
    node_key: string; title: string; responsibility: string;
    status: NodeRunStatus; join_satisfied_at: string | null;
    result_event_id: string | null;
    attempts: Array<{                        // 按 created_at 升序
      run_id: string; status: RunStatus;
      adapter_config_id: string; adapter_identity: string | null;
      failure_reason: string | null; started_at: string | null; completed_at: string | null;
    }>;
  }>;
  edges: Array<{
    from: string; to: string; traversed_at: string | null;
    outcome: string | null; decided_by: string | null; input_refs: string[];
  }>;
}
```

- Issue 无 GraphRun → `200` + `{ current: null, history: [] }`（**不是 404**）：前端要能区分"这个 Issue 不是图执行"和"Issue 不存在"。
- Issue 不存在 → `404` `ISSUE_NOT_FOUND`。
- `GET /api/graph-runs/:graphRunId` 返回单个 `GraphRunProjection`，供从 `history` 切换查看历史图。

### `POST /api/graph-runs/:graphRunId/nodes/:nodeKey/retry`

```ts
// 202
interface NodeRetryAccepted { node_run_id: string; run_id: string; status: NodeRunStatus }
```

| 情形 | 状态码 | 错误码 |
|---|---|---|
| NodeRun 不在 `{failed, interrupted, cancelled}` | 409 | `NODE_RUN_NOT_RETRYABLE` |
| 已有 active Attempt（CAS 失败或撞唯一索引） | 409 | `NODE_RUN_ATTEMPT_IN_PROGRESS` |
| GraphRun 为 `cancelled` / `completed` | 409 | `GRAPH_RUN_TERMINAL` |
| 无可用 adapter | 409 | `NO_CAPABLE_ADAPTER` |
| GraphRun / node_key 不存在 | 404 | `GRAPH_RUN_NOT_FOUND` / `NODE_RUN_NOT_FOUND` |

409 一律附 `blocked_reason_code` 与建议动作。**唯一索引冲突不得逃逸成 500**（第 4 节）。

### `POST /api/graph-runs/:graphRunId/cancel`

第 7 节定义了"用户取消整个图"，但前一轮没给入口，验收测试无从调用。

```ts
// 202
interface GraphCancelAccepted { graph_run_id: string; status: "cancelled"; cancelled_node_keys: string[] }
```

- 语义：全部非终态 NodeRun → `cancelled`，GraphRun → `cancelled`，Issue → `Ready`（图不再推进，交还给用户决定下一步）。
- **幂等**：已 `cancelled` 返回 200 + 当前状态，不报错。
- **与终态竞争**：取消与某个 Attempt 恰好完成竞争时，以 GraphRun 状态 CAS 为准；已 `completed` 的图返回 409 `GRAPH_RUN_TERMINAL`，不回退已完成的工作。

**不能对 running Attempt 采用 DB-first。** 上一版写"事务内先把全部 Run/NodeRun/GraphRun 写成 cancelled，再事务外停进程"，这与既有实现正面冲突：`AgentRunner.cancelRun()` 在 kill 之后执行 `runService.transitionToCancelled(runId)`，那是一个 `running → cancelled` 的 **CAS**（`agent-runner.ts:318-323`）。若数据库已经是 `cancelled`，CAS 必然失败并返回 `null`；而 `RunDispatchService.cancel()` 只在 `cancelled?.status === Cancelled` 时才调 `finalizeAndDrain()`（`run-dispatch.ts:205-211`）——于是 **workspace 锁永远不释放**。指望"随后到达的 terminal callback 兜底"也不成立：`cancelRun()` 会主动 `activeRuns.delete()` 并直接返回，正常退出路径的 `onTerminal` 根本不会被调用。

因此按"**已启动的走既有路径，未启动的才 DB-first**"拆开：

1. **事务内**（只处理没有活进程的部分）：`pending` / `ready` 的 NodeRun → `cancelled`，其 `queued` Run → `cancelled`；GraphRun → **`cancelling`**（若存在运行中的 Attempt）或直接 `cancelled`（若没有）。提交后 broadcast。
2. **事务外**：对每个运行中的 Attempt 调**未经修改的既有** `RunDispatchService.cancel(runId)`。因为第 1 步**没有**预先改写 running Run 的状态，`transitionToCancelled` 的 CAS 正常成功 → `finalizeAndDrain()` 正常执行 → **锁正常释放、队列正常 drain**。
3. **收尾**：GraphNode 的终态钩子把该 NodeRun 置 `cancelled`；当最后一个非终态 NodeRun 到达终态时，事务三把 GraphRun `cancelling → cancelled`、Issue → `Ready`。

因此 `GraphRunStatus` 增加 `cancelling`，它是**非终态**——非终态唯一索引的条件相应为 `status IN ('running', 'blocked', 'cancelling')`。

**kill 失败或进程不退出时诚实地卡住**：Run 保持 `running`、锁保持持有、GraphRun 停在 `cancelling`，并在 projection 与 health 中可见。这比"数据库说取消了、进程还在改 workspace、锁却被释放"要好——后者直接违反 AC-004。既有的执行超时与重启 stale recovery 是这条路径的兜底。

测试需覆盖：多个运行中 Attempt、kill 抛错、kill 无返回、进程已自行退出、完成与取消同时到达；每种都断言**最终的锁状态与队列是否继续 drain**。

### `POST /api/graph-runs/:graphRunId/resolve-executors`

`no_capable_adapter` 的恢复入口（第 7 节矩阵）。

```ts
// 请求：执行者由用户显式给出
interface ResolveExecutorsRequest {
  node_assignments: Record<string, string>;   // 至少覆盖全部因资格失败而停住的节点
}

// 200
interface ResolveExecutorsResult {
  graph_run_id: string;
  status: GraphRunStatus;                                  // 成功后为 running
  reassigned: Array<{ node_key: string; from: string | null; to: string }>;
  queued_run_ids: string[];                                // 本次真正补建并入队的 Attempt
}
```

**必须由用户显式给出新执行者，不能"自动重解析"。** 上一版说"经 `resolveEligibleAdapter()` 重新解析、可能换成别的 adapter"——这条没有实现依据：该原语在不给显式 id 时只会解析 Project 默认 adapter（`adapter-resolver.ts` 的注释明确"永不回退到列表里第一个可用 adapter"），它是**校验器不是搜索器**。要"自动挑一个合格的"就得新增一个列举 + 确定性选择的原语，而那正是 `AdapterResolver` 刻意拒绝提供的能力。因此改为用户在请求里指定，与 F007 确认路径的做法一致。

**成功路径必须补出 Attempt，只改状态不够。** 图之所以停住，正是因为那些时点"不创建 Attempt"（第 8.5 节）。若恢复只写 assignment 与状态，库里依然没有 queued Run，drain 无事可做，图会以 `running` **永久空转**。同一事务内完整恢复：

1. 逐项 `resolveEligibleAdapter(显式 id, 该节点 required_capabilities)`；任一不合格 → 整体拒绝 409。
2. 写回 `assigned_adapter_config_id`。
3. 对**没有 active Attempt** 的 `ready` / `pending` 节点：复用其历史 `runs.instructions`（若曾有 Attempt），否则调 `GraphNodeInstructionBuilder` 生成——首个 synthesis Attempt 属于后者，没有历史指令可抄。
4. 创建 queued Attempt，写 `graph.node_queued`。
5. GraphRun → `running`、Issue → `Running`、清 blocker。
6. 写 `graph.executor_reassigned` 审计事件（见下）。

提交后 broadcast + drain。测试必须覆盖 join / retry / recovery 三种 blocker 来源，并断言**恢复后确实存在且启动了一个 Attempt**，而不只是状态变成了 `running`。

**`reassigned[]` 要落库才算审计。** 上一版只把它放在 HTTP 响应里，刷新页面就没了——用户无从知道自己确认的执行者何时因何被换掉。改为同事务写 `graph.executor_reassigned` ThreadEvent，payload 含 `node_key` / `from` / `to` / `reason`，提交后 broadcast。
**判断优先级（避免 running 图同时命中两条规则）**，按此顺序求值，命中即返回：

1. GraphRun 为 `completed` / `cancelled` → 409 `GRAPH_RUN_TERMINAL`。
2. GraphRun 为 `blocked` 且 blocker 是 `no_capable_adapter` → 正常执行重解析。
3. GraphRun 为 `blocked` 但 blocker 是别的 → 409 `RECOVERY_ACTION_NOT_APPLICABLE`。
4. GraphRun 为 `running` → 409 `RECOVERY_ACTION_NOT_APPLICABLE`（图没有阻塞，无需恢复）。

上一版同时写了"running 时返回 200 幂等"和"blocker 不匹配返回 409"，而 running 的图恰恰没有 blocker，同一请求两条都命中。这里取**规则 4**：与其为"曾经被本动作恢复过"另存一份持久化事实，不如让重复提交得到一个明确的 409——用户刷新一下就能看到图已经在跑。

| 情形 | 状态码 | 错误码 |
|---|---|---|
| 仍有节点无合格 adapter | 409 | `NO_CAPABLE_ADAPTER`（指明哪个节点缺哪项能力） |
| GraphRun 为 `completed` / `cancelled` | 409 | `GRAPH_RUN_TERMINAL` |
| GraphRun 非 `blocked`，或 blocker 不是 `no_capable_adapter` | 409 | `RECOVERY_ACTION_NOT_APPLICABLE`（对应 blocker 的正确入口在响应里给出） |
| 与并发的节点 retry 竞争 | 409 | `NODE_RUN_ATTEMPT_IN_PROGRESS` |
| GraphRun 不存在 | 404 | `GRAPH_RUN_NOT_FOUND` |

### 前端状态

`loading` / `not_a_graph_issue`（projection 为 null）/ `running`（轮询或 SSE 复用既有 Thread 事件流）/ `blocked`（展示 `blocked_reason_code` + 节点级 retry 入口）/ `retry_conflict`（409 后刷新 projection，不重试）/ `terminal`。

## 10. 开放项（不阻塞开发）

- Edge 的 `joinPolicy` 本 slice 只实现 `all_required`；`any_of` / 条件路由等待第二种图形状。
- 结构性只读隔离未实现，物理并行不在范围内（ADR 0006 第 3 节已定为默认基线）。
- `AgentCapability` 词汇表扩展待真实证据。

> 全部 Q1-Q4 已关闭，`spec.md` 状态由 `idea` 推进为 `ready-for-development`，可按 `tasks.md` 展开实现。
