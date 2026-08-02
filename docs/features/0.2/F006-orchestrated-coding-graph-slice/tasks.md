---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, recovery]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-02
---

# F006：Orchestrated Coding Graph Slice - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 0：设计收敛（已完成）

- [x] T001：选择并记录首个真实三节点 coding 场景，给出每个节点的输入/输出示例 → `design.md` 第 5 节
- [x] T002：对比"扩展 Run/Event"与"独立 Graph 持久化"两种方案，使用 ADR 0006 的恢复五条逐项验证 → `design.md` 第 4 节
- [x] T003：定义 Edge payload/evidence refs 与实际 traversal contract → `design.md` 第 6 节
- [x] T004：定义 GraphRun/NodeRun/Attempt 与 Issue/Run 状态、workspace 锁、retry/escalation 的映射 → `design.md` 第 7 节
- [x] T005：更新 `design.md` 关闭全部待确认问题，并将 spec 推进到 `ready-for-development`
- [x] T006：拆出按顺序可执行、能追踪到 FR/AC 的完整实现 tasks → 下方 Phase 1-6

## Phase 1：持久化与类型（FR-001、FR-003）

- [ ] T010：新建 `server/src/db/schema-v8.ts`：`graph_runs`（含 `blocked_node_keys` 与 `target_files_json` / `_hash` / `_truncated` / `_dropped_count` 四列，见第 4、5 节）、`node_runs` 两表 + `ALTER TABLE runs ADD COLUMN node_run_id TEXT REFERENCES node_runs(id)` + `idx_graph_runs_one_nonterminal_per_issue`（条件为 `status IN ('running','blocked','cancelling')`——**三个都是非终态**，漏掉 `cancelling` 会让取消中的图在重启后被跳过并永久卡住）/ `idx_runs_one_active_graph_attempt` 两个 partial unique index。`node_runs` 含 `result_event_id REFERENCES thread_events(id)` 与 `assigned_adapter_config_id REFERENCES agent_configs(id)`（第 8.4 节）。**不得追加进 v7**。
- [ ] T011：`migrations.ts` 追加 `currentVersion < 8` 分支。
- [ ] T012：迁移测试——旧版本数据库（v7）升级到 v8 后原有数据完好、新表可用；全新库直连 v8。断言 `foreign_keys = ON` 下 ALTER 后既有 Run 行仍可写（`node_run_id` 默认 NULL）。
- [ ] T013：`shared/src/types/` 新增 `GraphRunStatus`（含**非终态**的 `cancelling`）、`NodeRunStatus`、`GraphBlockReason`（**8 个取值**，含 `result_too_large`）、`GraphNodeKey` 与 DTO；**并给既有 `FailureReason` 追加 `AdapterNoLongerEligible = "adapter_no_longer_eligible"`**（`shared/src/types/index.ts:203-212` 当前没有该值，queued claim 资格失败要用它，否则只能塞自由字符串绕过类型闭集）。
- [ ] T014：`repositories/graph-run.ts`、`repositories/node-run.ts`：CRUD + `listByGraphRun` + 状态 CAS（沿用 `issueRepo.compareAndSetStatus` 的既有写法）。
- [ ] T015：`runs` 仓储与 DTO 补 `node_run_id` 映射，确保既有 Run 路径全部兼容 `null`。
- [ ] T016：唯一索引冲突 → 用户级错误映射（`NODE_RUN_ATTEMPT_IN_PROGRESS` 等，`design.md` 第 9 节错误码矩阵）；测试断言连点 retry 得到 409 而非 500。

## Phase 2：图定义与运行时骨架（FR-001、FR-002）

- [ ] T020：`server/src/runtime/graph/definitions.ts`：内置 `wgd_coding_dual_review` v1，三节点两条边，Edge 按 `GraphEdgeV1` 完整声明 `acceptedOutcomes` / `required` / `joinGroup` / `inputSlot`（`design.md` 第 6 节）。
- [ ] T020b：定义注册表按**精确 `(id, version)`** 查询，`(id, version)` append-only；查不到 → `definition_version_unavailable`，**禁止回退到最新版本**。
- [ ] T020c：definition 里为每个节点声明 `instructionTemplate` / `inputSlots` / `outputContract` 与目标文件集 glob，与 definition 同版本冻结（`design.md` 第 5 节）。
- [ ] T020d：`GraphNodeInstructionBuilder`——图节点 `instructions` 的**唯一**生成入口（`runs.instructions` 是 `NOT NULL`，既有 `run-context-builder` 只装配通用上下文，不知道节点视角）。拼装顺序：节点视角判据 + 目标文件集 + 入边输入（synthesis）+ 输出 envelope 契约。
- [ ] T020e：目标文件集——**在写事务之外**做 preflight 解析并冻结 `TargetFileSet`（`createGraph(tx,...)` 是纯 DB 写；把大仓库的目录遍历放进事务会长时间占住 SQLite 全局写锁，而那时 F007 的外层事务已经建了 Issue），事务内只复核 workspace id/路径未变后消费冻结结果。空集合 → 建图前拒绝 `GRAPH_TARGET_SET_EMPTY`；超 500 条或 64 KB 按声明顺序截断并在指令正文写明丢弃数量，**禁止静默截断**。
- [ ] T020e2：确定性规则——workspace 相对路径、分隔符统一 `/`、每个 glob 内按 UTF-8 字节字典序、跨 glob 全局去重保留首次位置、拒绝越出 workspace 的 symlink、特殊字符用 JSON 编码。测试覆盖 Windows/POSIX 分隔符、重复命中的 glob、symlink、含换行/引号的文件名——没有这些规则 T020g 的逐字节确定性在不同平台上必然失败。
- [ ] T020f：retry **原样复用** `runs.instructions` 上一个 Attempt 的指令，不重新生成——重新生成会让重试面对不同的文件集，同一 NodeRun 的多次 Attempt 失去可比性。
- [ ] T020g：确定性测试——同一 definition 版本 + 同一 workspace 状态，两次生成的 `instructions` 逐字节相同。
- [ ] T021：`prepareGraph(workspaceId, plan)`（**事务外**，遍历文件系统产出 `GraphPreflight`）+ `createGraph(tx, issueId, plan, preflight)`——后者**纯 DB 写、使用调用方事务、绝不拉起进程、绝不 drain、绝不碰文件系统**（第 8.1/8.2 节）。preflight 必须作为**显式入参**，否则实现者只能在事务内重新 glob。事务内复核 workspaceId/path/definitionVersion/`targetFilesHash` 一致，不一致整体拒绝。写入内容：GraphRun + **三个** NodeRun 全部预建（synthesis 为 `pending`）+ 两个前驱的 `queued` Run + `graph.node_queued` 事件 + Issue 转 `Running`，逐节点写 `assigned_adapter_config_id`，并把冻结文件集写入 `graph_runs.target_files_json` / `_hash` / `_truncated` / `_dropped_count` 四列。
- [ ] T021a：`GraphRuntimeService.start(issueId, plan)` 便利入口——自开事务调 `createGraph`，提交后触发 drain；供非 intake 的直接调用方使用。同时提供 `enqueueSequential(tx, ...)` 供 F007 顺序分支使用。
- [ ] T021b：幂等测试——重复调用撞 `idx_graph_runs_one_nonterminal_per_issue`，返回既有 GraphRun；**图处于 `blocked` 时再次建图同样被拒**（而非又起一个图）。
- [ ] T021c：`GraphExecutionPlan` 校验——`nodeAssignments` 必须覆盖 definition 全部节点（含 synthesis），缺项 → `GRAPH_PLAN_INCOMPLETE`；任一 assignment 复核不通过 → **整体拒绝**，不部分启动。
- [ ] T021d：嵌套事务故障测试——F007 在外层事务内调 `createGraph` 后回滚，断言**没有任何进程被拉起**、库中无残留 GraphRun。
- [ ] T022：新增共享原语 `resolveEligibleAdapter()`——组合既有 `resolveAdapter()` + `hasCapability()`，新增 `ADAPTER_CAPABILITY_MISSING` 错误码；**不改这两个既有函数的签名**（第 8.3 节）。建图与 F007 确认复核都只走它。
- [ ] T022b：能力校验回归——显式指定一个 Available **但缺该节点所需 capability** 的 adapter，断言被拒。前一轮"经 `resolveAdapter()` 复核"会放行，因为该函数根本没有 capability 参数（`adapter-resolver.ts:32-64`）。
- [ ] T022e：**延迟执行前的资格复核**（`design.md` 第 8.5 节）——join 建 synthesis Attempt、节点 retry、恢复补建 Attempt 三个时点，各对持久化的 `assigned_adapter_config_id` 调一次 `resolveEligibleAdapter()`；不合格则**同事务内** GraphRun `blocked` + `no_capable_adapter`，**不创建 Attempt、绝不静默换人**。既有 `startAdapter()` 只做 `getById()`（`run-dispatch.ts:224-227`），既不看 workspace 有效状态也不看能力，靠它兜不住。
- [ ] T022e2：**第四个复核时点——queued → running 的 claim 路径**。取锁后在事务内重读 GraphRun/NodeRun 并对 Run 上的显式 adapter id 复核；不合格则不拉进程、Run 置 `cancelled` + `adapter_no_longer_eligible`、NodeRun 回 **`ready`**（`pending` 的既有含义是「join 未满足」，两种含义重叠会让恢复扫描与 `resolve-executors` 无法识别目标，甚至给 join 未满足的 synthesis 提前建 Attempt）、`graph_runs.blocked_node_keys` 记下该节点、GraphRun `blocked` + `no_capable_adapter`、**释放 workspace 锁并继续 drain**。两个前驱的 Attempt 在建图时就已入队，第二个可能等很久，只在"创建 Attempt"时复核覆盖不到它。
- [ ] T022f：三类变化各一条测试——排队/等待期间 adapter 被置 unavailable、被摘掉 capability、被加上 workspace 级覆盖；断言进入 `no_capable_adapter` 恢复路径而非普通 `spawn_failed`。**场景固定为"N1 running、N2 queued，期间 N2 的 adapter 失效"**，并断言锁被正确释放。
- [ ] T022g：adapter 删除守卫——把 NodeRun 的 `assigned_adapter_config_id` 引用并入 `AdapterConfigService.delete()` 的 `ADAPTER_IN_USE` 判定（现有 `hasRuns()` 只查 `runs.adapter_config_id`，看不见"pending synthesis 已指派但尚无 Run"）。回归测试断言该场景返回 `ADAPTER_IN_USE` 而非裸 `SQLITE_CONSTRAINT` 造成的 500。
- [ ] T022c：**建图阶段的失败一律在写库之前拒绝**——definition 查不到 / `nodeAssignments` 缺项 / 任一资格解析不通过，直接返回错误让外层事务回滚，**绝不产生 `blocked` 的 GraphRun**（否则 F007 承诺的"确认失败原子回滚"不成立，用户会得到一个 Issue 加一个进不去也退不出的空图）。`no_capable_adapter` / `definition_version_unavailable` 只适用于**已建起来的图**（retry 时执行者失效、部署回退致版本消失）。
- [ ] T022d：回归断言——建图失败时库中无任何 GraphRun / NodeRun / Run 残留，且外层 Issue 一并回滚。
- [ ] T023：新增 **8 个** `graph.*` ThreadEvent 类型与写入封装（`design.md` 第 6 节表格）。**`graph.blocked` 与 `graph.terminal` 是两个独立事件**：前者每次 `running → blocked` 都写（blocked 是可恢复的非终态），后者只覆盖真正的终态 `completed` / `cancelled`——把 `blocked_terminal` 塞进 terminal 判别联合会让消费者无法区分「图结束了」和「图暂停可恢复」；**`graph.node_result` 必须加入 `EvidenceService.TRUSTED_INTERNAL_ALLOWLIST`**（`evidence.ts:20-31`），否则下游 `resolveTrustedPayload()` 恒返回 null。
- [ ] T023b：**事务内一律只调 `threadEventService.write()`，禁止 `writeAndBroadcast()`**（后者写完立即 publish，`thread-event.ts:33-44`）；事件经 `DbOnlyResult.pendingEvents` 上交，由最外层提交后统一 broadcast。既有 `RunEscalationHandler` 已是此写法，沿用。
- [ ] T023c：phantom 事件回归——F007 重复确认导致外层回滚时，断言 **event bus 未收到任何事件**（重复确认会先建出临时 Issue/Run/事件才撞 `nonce` 键回滚，广播出去就收不回来）。
- [ ] T024：新增 `RunRole.GraphNode`，图节点 Run 显式写该 role（列无 CHECK、新行写值，无需迁移）。**不得沿用默认 `implementation`**，否则会误触发 `requestValidation` 并被队列资格门取消（`design.md` 第 7 节）。
- [ ] T025：`RunDispatchService.workflowHook()` 增加 GraphNode 分支并**排在最前**、直接 return；现有 Implementation / Validator 两条分支一字不改。
- [ ] T026：`startNextQueuedRun` 增加 GraphNode 资格规则——按所属 GraphRun 状态判定，不参与 `validation_round` 匹配；Issue `Blocked` 时图节点留在队列而非取消。
- [ ] T026b：`transitionToRunning` 增加 GraphNode 分支，把 NodeRun 由 `ready` 同步为 `running`（状态映射表见 `design.md` 第 7 节）。
- [ ] T027：回归断言——图节点 Run 完成后 `requestValidation` **未被调用**，Issue 不进入 `Validating`（AC-005 的直接防线）。

## Phase 3：fan-in 与结果契约（FR-004、TR-001）

- [ ] T030：节点结果 envelope 解析器（复用 F004 的容错解析手法，不复用 validator 语义）；**先施加第 6 节的数量/字节上限再持久化**，`graph.node_result` 存的就是裁剪后的内容；回填 `node_runs.result_event_id`。**结果不可用（解析失败 / 事件缺失 / 不在 allowlist / scope 不符）一律 NodeRun `failed` + `result_unparsable`，`result_event_id` 留 NULL——即便 Attempt 的进程状态是 `completed`**。原始 `final_message` 保留在既有 run trace 中备查。
- [ ] T030b：一致性断言——不存在"NodeRun `completed` 但 `result_unparsable`"的组合；构造该场景后断言节点可被 retry 受理（受理集合为 `{failed, interrupted, cancelled}`，若留在 `completed` 则图卡死无合法动作）。
- [ ] T030c：envelope **全部可变长字段**有界——findings 200 条/单字段 2000 字符、`not_reviewed` 100 条/单项 1000 字符；依次丢 findings 再丢 `not_reviewed` 后仍超 256 KB → NodeRun `failed` + `result_too_large`，**绝不持久化无界事件**。只限制 findings 时，一个巨大的 `not_reviewed` 能让裁剪算法永远达不到声明的上限。
- [ ] T031：`evaluateJoin(graphRunId, nodeKey)`：**在事务内**按前驱 `node_runs` 行判定，写 `join_satisfied_at`（唯一写入方），禁止读进程内状态（FR-004）。
- [ ] T032：join 满足时——synthesis NodeRun CAS `pending → ready` → 第 8.5 节资格复核 → 按 `assigned_adapter_config_id` 创建**唯一**一个 Attempt 并入队 → 写 `graph.node_queued`、`graph.join_satisfied` 与两条 `graph.edge_traversed`。**不创建 NodeRun 行**（三个节点已在建图时预建）。幂等键是 NodeRun CAS 与 `idx_runs_one_active_graph_attempt`，**不得**拿 `UNIQUE (graph_run_id, node_key)` 当正常路径的控制流。
- [ ] T032b：`graph.node_queued` 在**每次** Attempt 入队时都写（建图两前驱、synthesis 首次、retry、恢复补建），payload 带 `run_id` 与 `attempt_index`；断言 Thread 回放里 synthesis 与前驱有对称的入队记录。
- [ ] T033：synthesis 上下文装配——经 `resolveTrustedPayload(ref, scope)` 取两条入边的 `graph.node_result` payload；**scope 只传 `issueId` + `threadId`，不得传 `runId`**（传了必然 null，见 `evidence.ts:256-259`）。
- [ ] T033b：截断自实现——按 `run-context-builder.ts` 的 `mustNotTruncate` + 预算降级手法，超限时整条丢弃 finding 并记 `truncated` / `dropped_count`，截断声明必须出现在 synthesis 输入正文中。
- [ ] T033c：前驱结果取不到时 → 该 NodeRun `failed` + GraphRun `blocked` + `result_unparsable`；断言**不会**拿半份输入跑 synthesis。
- [ ] T033d：端到端断言——两个真实前驱 envelope 经与 synthesis 完全相同的 API 读出，findings 条数与内容逐条匹配（防止"节点 completed、边 traversed、输入为空"）。
- [ ] T034：join 只触发一次的并发测试。**断言对象必须是仍可能重复的副作用**——synthesis NodeRun 在建图时已预建，断言"只有一个 NodeRun"是恒真的、测不到任何竞态。改为断言：synthesis Attempt 有且仅有一个、`pending → ready` 的 CAS 只有一个赢家、`graph.join_satisfied` 只有一条、每条入边的 `graph.edge_traversed` 各只有一条、且并发过程中没有唯一约束错误逃逸到调用方。

## Phase 4：失败、恢复与 retry（NFR-001、FR-003）

- [ ] T039：**图终态化事务（事务三）**——三条收尾路径各写 `graph.terminal` 的对应判别分支：成功 → GraphRun `running → completed`（CAS）、Issue `Ready`、清 blocker、带 `report_event_id`；失败 → `blocked` + reason、Issue `Blocked`；取消 → 最后一个非终态 NodeRun 终态时 `cancelling → cancelled`、Issue `Ready`。幂等，重复触发第二次直接返回。没有这一步，成功的图会永远停在 `running`。
- [ ] T039b：终态化测试——成功、失败、重复触发、写之间崩溃四种。**另加两组取消原子性验收**：① 无 running Attempt 的直接取消，断言 NodeRun/queued Run cancelled + GraphRun cancelled + Issue `Ready` + `graph.terminal` **同一事务提交**、提交后只广播一次；② `cancelling` 期间分别在 Run 终态钩子前、事务三写入中、提交后广播前崩溃，重启后最终 `cancelled`、锁释放、Issue `Ready`、terminal 事件恰好一条。
- [ ] T040：`GraphRecoveryService.reconcile()`，按 `design.md` 第 7 节实现。扫描集合是**全部非终态 GraphRun（`running` + `blocked` + `cancelling`）**；自动重评仅限 `definition_version_unavailable` 这类确定性 blocker，`node_run_failed` 等一律等待用户动作。
- [ ] T040d：**`cancelling` 最先分支**——同步 stale Run 对应的 NodeRun 为 `cancelled`、取消其余可取消节点、全部终态后 `cancelling → cancelled` + Issue `Ready` + `graph.terminal`，**不执行任何推进步骤**。故障注入测试：running Attempt 取消途中重启，断言图最终 `cancelled`、锁释放、可新建下一张图。缺这一步会形成没有合法动作的吸收态（第 8 步只终态化 `running` 的图）。
- [ ] T040a：**第 0 步守卫排在最前**——按精确 `(definition_id, version)` 查注册表，查不到就置 `blocked` + `definition_version_unavailable` 并**跳过该图其余全部步骤**。步骤 3/4/6 都要读 definition，守卫放末尾会先抛异常。版本回补后在同一事务内解除阻塞并恢复待续节点，提交后 drain；测试覆盖"消失 → 回补"完整往返。
- [ ] T040b：恢复第 7 步——**Run 已终态但 NodeRun 仍非终态**（事务一自身失败）→ 按 Run 的 `final_message`/`status` 幂等重放事务一；原始输出不可得则落 `failed` + 处理失败标记，**不得留在 running**。这是 `finalizeAndDrain` 空 catch 造成的持久化修复义务。
- [ ] T040c：恢复第 8 步——全部节点终态但 GraphRun 仍 `running` → 重放事务三。
- [ ] T041：`index.ts` 接线——排在 `StaleRecoveryService.runAll()` 之后、`drainWorkspace` 之前。
- [ ] T042：恢复语义①②确定性测试——重启后状态可重建、已完成节点不重跑。
- [ ] T043：恢复语义③测试——一个前驱完成、另一个 running 时重启，后者 NodeRun 变 `interrupted`（Run 层复用既有 `StaleRecoveryService`，断言不重复实现）。
- [ ] T044：恢复语义④测试——可从 interrupted NodeRun 发起新 Attempt，`node_run_id` 不变、Attempt 计数 +1。
- [ ] T045：恢复语义⑤测试——重启不使 fan-in 提前收敛；一个前驱仍未完成时 synthesis 不得创建。
- [ ] T045b：故障注入测试——在 `createGraph()` 内部、事务一的**解析前与写入中**、事务一与事务二之间、事务二内部、事务三内部各注入一次崩溃，断言重启后收敛。**不能只测事务之间**。
- [ ] T045c：`assigned_adapter_config_id` 持久化测试——fan-in 之前重启，断言确认过的 synthesis 执行者仍然生效，不发生重新解析。
- [ ] T046：节点级 retry API + `GraphBlockReason` 独立恢复入口；受理集合为 `{failed, interrupted, cancelled}`；断言**不复用** validation unblock（`recovery-action.ts` 的守卫必须仍然拒绝图类 blocker）。
- [ ] T046b：**retry 事务必须一并把 Issue 从 `Blocked` 放回 `Running` 并清掉图 blocker 字段**，提交后触发 drain。回归测试断言 retry 后排队的 Attempt **确实启动**——前一轮只回滚 NodeRun/GraphRun，Issue 仍 `Blocked`，队列资格门会让它永远不启动。
- [ ] T046c：blocker → 恢复动作矩阵逐行实现与测试（`design.md` 第 7 节表格）。其中：`result_unparsable` 的 NodeRun 在 T030 落库时**已经是 `failed`**，此处无需改判、直接可 retry；`no_capable_adapter` 的恢复实体是 GraphRun（走 T051c 的重解析入口），且只出现在**已建起来的图**上（建图阶段的失败按 T022c 直接拒绝，不产生 blocked 图）；`join_unsatisfiable` / `recovery_inconsistent` 只能整图取消。
- [ ] T047：`RunEscalationHandler.cancelQueuedRunsForIssue()` 增加 `role !== RunRole.GraphNode` 过滤（`run-escalation-handler.ts:72-76`）。**这是本 slice 对 escalation 的唯一改动**，检测/事件/Issue 置 Blocked 全部不动。
- [ ] T047b：escalation 确定性测试——**一个前驱 running、一个前驱 queued** 时触发 escalation，断言 running 者 → NodeRun `failed` → GraphRun `blocked`，且 **queued 的兄弟节点仍为 `queued`**、未被 `cancelQueued`。这是初稿"复用 escalation 不改逻辑"会直接跑挂的场景。
- [ ] T048：单 active Attempt——retry 在同一事务内先做 NodeRun 状态 CAS 再建 Run（主路径，给干净错误）；`idx_runs_one_active_graph_attempt` 兜底其余建 Run 路径。并发/连点测试断言只产生一个 Attempt。
- [ ] T049：**取消的接入点**——`RunDispatchService.cancel()` 的 queued 分支直接 `cancelQueued()` 就 return，**不经 `finalizeAndDrain`/`workflowHook`**（`run-dispatch.ts:202-207`）；补一次图推进调用，与 `workflowHook` 的 GraphNode 分支同一入口。running 分支不变。没有这一步，上表的 NodeRun 转移无从发生，Run 会 `cancelled` 而 NodeRun 永远停在 `ready`。
- [ ] T049b：取消状态转移测试——按 `design.md` 第 7 节表格分别测单节点取消、整图取消、系统队列取消三条路径及各自的 GraphRun 结果，其中**必须包含一个 queued 图节点被取消**的用例。
- [ ] T049c：整图取消协议（`design.md` 第 7 节）——**不得对 running Attempt 做 DB-first**。① 事务内只取消**无活进程**的部分（`pending`/`ready` NodeRun 与其 `queued` Run），GraphRun → `cancelling`（有运行中 Attempt）或直接 `cancelled`；② 事务外对每个运行中 Attempt 走既有 `RunDispatchService.cancel(runId)` 路径（其 `transitionToCancelled` 的 CAS 因此能正常成功、`finalizeAndDrain()` 正常释放锁），**但 `AgentRunner.cancelRun()` 本身必须改造成有界等待**，见 T049f；③ 最后一个非终态 NodeRun 终态时由事务三把 GraphRun `cancelling → cancelled`。
- [ ] T049d：新增 `GraphRunStatus.cancelling`（**非终态**），非终态唯一索引条件同步为 `('running','blocked','cancelling')`。
- [ ] T049e：锁生命周期测试——若先把 running Run 写成 `cancelled`，`agent-runner.ts:318-323` 的 CAS 会失败返回 null，`run-dispatch.ts:205-211` 就不会调 `finalizeAndDrain()`，**workspace 锁永远不释放**。测试必须断言取消后锁被释放、队列继续 drain。另覆盖 kill 抛错、kill 无返回/超时、进程已自行退出、完成与取消同时到达四种，每种都断言最终锁状态。
- [ ] T049f：**`AgentRunner.cancelRun()` 改为有界等待**（`design.md` 第 7 节）——① 不再在 await 前 `clearTimeout(activeRun.timeoutTimer)`，让执行超时在 cancel 完成前保持有效；② `Promise.race([handle.cancel(), delay(CANCEL_TIMEOUT_MS)])`；③ 超时分支保持 Run `running`、保持锁、GraphRun 停 `cancelling`，API **有界返回 202**。上一版声称「既有执行超时兜底」是错的：`exited = true` 与 `clearTimeout` 都在 await **之前**执行（`agent-runner.ts:308-313`），cancel 若不 resolve，兜底早已被自己关掉，HTTP 请求会一直挂着。**这解除了上一轮「不修改既有 cancel 路径」的约束。**
- [ ] T049g：`cancelling` 是所有图 mutation 的**首要守卫**——retry / `resolve-executors` 一律先判 `cancelling` 并返回 409 `GRAPH_RUN_CANCELLING`。缺这道守卫时，取消事务已把部分 NodeRun 置为 `cancelled`，而 retry 的受理集合恰好含 `cancelled`，一次并发 retry 就能把 GraphRun 改回 `running`、逆转整图取消意图。

## Phase 5：查询、API 与 UI（US3、AC-003）

- [ ] T050：GraphRun projection 查询——节点、执行者、attempt 列表、edge traversal、输入 refs。
- [ ] T051：HTTP 路由 `GET /api/issues/:id/graph`、`GET /api/graph-runs/:id`、`POST /api/graph-runs/:id/nodes/:key/retry`，DTO 与错误码矩阵按 `design.md` 第 9 节实现；沿用项目既定的 zod 边界校验（F005 已统一该做法）。
- [ ] T051b：非图 Issue 的 projection 返回 `200` + `null`，Issue 不存在返回 `404`；断言两者可区分。
- [ ] T051c：`POST /api/graph-runs/:id/cancel`——响应 `status` 是 `"cancelling" | "cancelled"`（**不得写死 cancelled**）并带 `active_run_ids`；无运行中 Attempt 时同事务收敛并返回 200 `cancelled`，有运行中 Attempt 时返回 202 `cancelling` 且 **Issue 保持 `Running`**（进程还在跑，提前置 `Ready` 会误导用户）。幂等；与终态竞争时以 GraphRun 状态 CAS 为准与 `POST /api/graph-runs/:id/resolve-executors`。后者按 `design.md` 第 9 节实现：请求体 `node_assignments` **由用户显式给出**（`resolveEligibleAdapter()` 是校验器不是搜索器，不给显式 id 时只解析 Project 默认 adapter，"自动挑一个合格的"没有实现依据）；成功事务内必须**补建 queued Attempt**（复用历史 `runs.instructions`，synthesis 首次则调 `GraphNodeInstructionBuilder`）+ 写 `graph.node_queued` + 写 `graph.executor_reassigned` 审计事件。
- [ ] T051e2：`resolve-executors` 的目标由 `graph_runs.blocked_node_keys` 确定，只处理这些节点；**创建任何下游 Attempt 前重新执行 join 判定**，断言 join 未满足的 synthesis 不会被提前建 Attempt（回归场景：N1 的 queued adapter 失效、synthesis 尚未满足 join，只补建 N1）。
- [ ] T051e：恢复空转回归——断言 `resolve-executors` 之后**确实存在并启动了一个 Attempt**，而不只是 GraphRun 变成 `running`。停住的根因正是那些时点"不创建 Attempt"，只改状态会让图以 `running` 永久空转。三种 blocker 来源（join / retry / recovery）各一条。
- [ ] T051d：projection 基数——响应形状为 `{ current, history[] }`；一个 Issue 多个 GraphRun 时 `current` 取非终态的那个，无非终态则按 `created_at DESC, id DESC` 取首个；断言实现里**没有无序的 `LIMIT 1`**。历史详情走 `GET /api/graph-runs/:id`。
- [ ] T052：Thread 内节点卡片——展示节点责任、执行者、状态、attempt 次数。
- [ ] T053：Inspector graph 段落——展示依赖关系与收敛理由（`satisfied_by` / `decided_by`）。
- [ ] T054：阻塞态 UI——展示 `blocked_reason_code` 与 `blocked_node_keys`、节点级恢复入口（对应 US1 验收场景 2）。
- [ ] T054b：**`cancelling` 前端状态**——禁用 retry / resolve-executors / 再次发起图，展示 `active_run_ids` 与锁状态；对 `GraphRunStatus` 用 `assertNever` 穷尽，新增状态编译期报漏。补取消正常完成、kill 抛错、kill 超时三个 UI 测试。kill 超时时 `cancelling` 可能持续很久，是需要用户观察的状态，不能只存在于后端 DTO。

## Phase 6：验收（SC-001~003、AC-001~005）

- [ ] T060：Fake adapter + 临时 workspace 的完整三节点端到端测试（AC-001）。
- [ ] T061：AC-004 断言测试——图执行全程同一 workspace 至多一个 Run 持锁；证明由既有 FIFO 队列保证。
- [ ] T062：F001-F005 全量回归 + 断言 `ValidationWorkflowService` 未被修改（AC-005）。
- [ ] T063：真实 CLI 场景验收——本机已登录 Codex/Claude/OpenCode 至少一个，跑通 `wgd_coding_dual_review`（SC-001）。
- [ ] T064：门禁——`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`；新增文件纳入 Prettier format targets。
- [ ] T065：回写 `spec.md` 验收清单与 `BACKLOG.md` 状态。

## 依赖关系

- Phase 1 阻塞其余全部阶段。
- Phase 2 → Phase 3 → Phase 4 顺序执行；Phase 5 依赖 Phase 3 的 projection 数据。
- Phase 6 最后执行；T063 需要真实 CLI 环境。

## 备注

- 默认物理串行；结构性只读隔离若未来进入范围，必须有独立设计与三个 adapter 的越权测试。
- 本 slice 不做 Graph Compiler / Linter、自然语言 Graph Draft、Canvas 编辑器，不实现 `any_of` join 或条件路由。
