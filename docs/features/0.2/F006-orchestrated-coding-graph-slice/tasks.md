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

- [ ] T010：新建 `server/src/db/schema-v8.ts`：`graph_runs`、`node_runs` 两表 + `ALTER TABLE runs ADD COLUMN node_run_id TEXT REFERENCES node_runs(id)` + `idx_graph_runs_one_nonterminal_per_issue`（条件为 `status IN ('running','blocked')`，**不是只有 running**）/ `idx_runs_one_active_graph_attempt` 两个 partial unique index。`node_runs` 含 `result_event_id REFERENCES thread_events(id)` 与 `assigned_adapter_config_id REFERENCES agent_configs(id)`（第 8.4 节）。**不得追加进 v7**。
- [ ] T011：`migrations.ts` 追加 `currentVersion < 8` 分支。
- [ ] T012：迁移测试——旧版本数据库（v7）升级到 v8 后原有数据完好、新表可用；全新库直连 v8。断言 `foreign_keys = ON` 下 ALTER 后既有 Run 行仍可写（`node_run_id` 默认 NULL）。
- [ ] T013：`shared/src/types/` 新增 `GraphRunStatus`、`NodeRunStatus`、`GraphBlockReason`（7 个取值，含 `node_run_cancelled`、`definition_version_unavailable`）、`GraphNodeKey` 与 DTO。
- [ ] T014：`repositories/graph-run.ts`、`repositories/node-run.ts`：CRUD + `listByGraphRun` + 状态 CAS（沿用 `issueRepo.compareAndSetStatus` 的既有写法）。
- [ ] T015：`runs` 仓储与 DTO 补 `node_run_id` 映射，确保既有 Run 路径全部兼容 `null`。
- [ ] T016：唯一索引冲突 → 用户级错误映射（`NODE_RUN_ATTEMPT_IN_PROGRESS` 等，`design.md` 第 9 节错误码矩阵）；测试断言连点 retry 得到 409 而非 500。

## Phase 2：图定义与运行时骨架（FR-001、FR-002）

- [ ] T020：`server/src/runtime/graph/definitions.ts`：内置 `wgd_coding_dual_review` v1，三节点两条边，Edge 按 `GraphEdgeV1` 完整声明 `acceptedOutcomes` / `required` / `joinGroup` / `inputSlot`（`design.md` 第 6 节）。
- [ ] T020b：定义注册表按**精确 `(id, version)`** 查询，`(id, version)` append-only；查不到 → `definition_version_unavailable`，**禁止回退到最新版本**。
- [ ] T021：`createGraph(tx, issueId, plan)`——**纯 DB 写、使用调用方事务、绝不拉起进程也绝不 drain**（第 8.2 节）：GraphRun + **三个** NodeRun 全部预建（synthesis 为 `pending`）+ 两个前驱的 `queued` Run + `graph.node_queued` 事件 + Issue 转 `Running`，逐节点写 `assigned_adapter_config_id`。
- [ ] T021a：`GraphRuntimeService.start(issueId, plan)` 便利入口——自开事务调 `createGraph`，提交后触发 drain；供非 intake 的直接调用方使用。同时提供 `enqueueSequential(tx, ...)` 供 F007 顺序分支使用。
- [ ] T021b：幂等测试——重复调用撞 `idx_graph_runs_one_nonterminal_per_issue`，返回既有 GraphRun；**图处于 `blocked` 时再次建图同样被拒**（而非又起一个图）。
- [ ] T021c：`GraphExecutionPlan` 校验——`nodeAssignments` 必须覆盖 definition 全部节点（含 synthesis），缺项 → `GRAPH_PLAN_INCOMPLETE`；任一 assignment 复核不通过 → **整体拒绝**，不部分启动。
- [ ] T021d：嵌套事务故障测试——F007 在外层事务内调 `createGraph` 后回滚，断言**没有任何进程被拉起**、库中无残留 GraphRun。
- [ ] T022：新增共享原语 `resolveEligibleAdapter()`——组合既有 `resolveAdapter()` + `hasCapability()`，新增 `ADAPTER_CAPABILITY_MISSING` 错误码；**不改这两个既有函数的签名**（第 8.3 节）。建图与 F007 确认复核都只走它。
- [ ] T022b：能力校验回归——显式指定一个 Available **但缺该节点所需 capability** 的 adapter，断言被拒。前一轮"经 `resolveAdapter()` 复核"会放行，因为该函数根本没有 capability 参数（`adapter-resolver.ts:32-64`）。
- [ ] T022c：无可用 adapter → GraphRun `blocked` + `no_capable_adapter`（禁止写死具体 adapter，FR-002）。
- [ ] T023：新增 5 个 `graph.*` ThreadEvent 类型与写入封装；**`graph.node_result` 必须加入 `EvidenceService.TRUSTED_INTERNAL_ALLOWLIST`**（`evidence.ts:20-31`），否则下游 `resolveTrustedPayload()` 恒返回 null。
- [ ] T024：新增 `RunRole.GraphNode`，图节点 Run 显式写该 role（列无 CHECK、新行写值，无需迁移）。**不得沿用默认 `implementation`**，否则会误触发 `requestValidation` 并被队列资格门取消（`design.md` 第 7 节）。
- [ ] T025：`RunDispatchService.workflowHook()` 增加 GraphNode 分支并**排在最前**、直接 return；现有 Implementation / Validator 两条分支一字不改。
- [ ] T026：`startNextQueuedRun` 增加 GraphNode 资格规则——按所属 GraphRun 状态判定，不参与 `validation_round` 匹配；Issue `Blocked` 时图节点留在队列而非取消。
- [ ] T026b：`transitionToRunning` 增加 GraphNode 分支，把 NodeRun 由 `ready` 同步为 `running`（状态映射表见 `design.md` 第 7 节）。
- [ ] T027：回归断言——图节点 Run 完成后 `requestValidation` **未被调用**，Issue 不进入 `Validating`（AC-005 的直接防线）。

## Phase 3：fan-in 与结果契约（FR-004、TR-001）

- [ ] T030：节点结果 envelope 解析器（复用 F004 的容错解析手法，不复用 validator 语义）；**先施加第 6 节的数量/字节上限再持久化**，`graph.node_result` 存的就是裁剪后的内容；回填 `node_runs.result_event_id`；解析失败 → NodeRun `failed` + `result_unparsable`。原始 `final_message` 保留在既有 run trace 中不受影响。
- [ ] T031：`evaluateJoin(graphRunId, nodeKey)`：**在事务内**按前驱 `node_runs` 行判定，写 `join_satisfied_at`（唯一写入方），禁止读进程内状态（FR-004）。
- [ ] T032：join 满足时**只做两件事**——synthesis NodeRun CAS `pending → ready`，然后按其 `assigned_adapter_config_id` 创建 Attempt 并入队；写 `graph.join_satisfied` 与两条 `graph.edge_traversed`。**不创建 NodeRun 行**（三个节点已在建图时预建，第 4 节）；唯一约束回归为异常防线，不得作为正常路径的控制流。
- [ ] T033：synthesis 上下文装配——经 `resolveTrustedPayload(ref, scope)` 取两条入边的 `graph.node_result` payload；**scope 只传 `issueId` + `threadId`，不得传 `runId`**（传了必然 null，见 `evidence.ts:256-259`）。
- [ ] T033b：截断自实现——按 `run-context-builder.ts` 的 `mustNotTruncate` + 预算降级手法，超限时整条丢弃 finding 并记 `truncated` / `dropped_count`，截断声明必须出现在 synthesis 输入正文中。
- [ ] T033c：前驱结果取不到时 → GraphRun `blocked` + `result_unparsable`；断言**不会**拿半份输入跑 synthesis。
- [ ] T033d：端到端断言——两个真实前驱 envelope 经与 synthesis 完全相同的 API 读出，findings 条数与内容逐条匹配（防止"节点 completed、边 traversed、输入为空"）。
- [ ] T034：join 只触发一次的并发测试——两个前驱几乎同时终态时，synthesis 有且只有一个 NodeRun（依赖 `UNIQUE (graph_run_id, node_key)`）。

## Phase 4：失败、恢复与 retry（NFR-001、FR-003）

- [ ] T039：**图终态化事务（事务三）**——synthesis 终态 → GraphRun `running → completed`（CAS）、Issue → `Ready`、清 blocker、写 `graph.completed`；失败路径 → GraphRun `blocked` + reason、Issue → `Blocked`。幂等，重复触发第二次直接返回（`design.md` 第 7 节）。前一轮没有任何一步负责收尾，成功的图会永远停在 `running`。
- [ ] T039b：终态化测试——成功、失败、重复触发、写之间崩溃四种。
- [ ] T040：`GraphRecoveryService.reconcile()` 九步，按 `design.md` 第 7 节实现。扫描集合是**全部非终态 GraphRun（`running` + `blocked`）**；自动重评仅限 `definition_version_unavailable` 这类确定性 blocker，`node_run_failed` 等一律等待用户动作。
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
- [ ] T046c：blocker → 恢复动作矩阵逐行实现与测试（`design.md` 第 7 节表格）。其中：`result_unparsable` 必须把 NodeRun 由 `completed` **改判为 `failed`** 才可 retry；`no_capable_adapter` 的恢复实体是 GraphRun（走 T051c 的重解析入口），因为建图时失败根本没有失败的 NodeRun 可 retry；`join_unsatisfiable` / `recovery_inconsistent` 只能整图取消。
- [ ] T047：`RunEscalationHandler.cancelQueuedRunsForIssue()` 增加 `role !== RunRole.GraphNode` 过滤（`run-escalation-handler.ts:72-76`）。**这是本 slice 对 escalation 的唯一改动**，检测/事件/Issue 置 Blocked 全部不动。
- [ ] T047b：escalation 确定性测试——**一个前驱 running、一个前驱 queued** 时触发 escalation，断言 running 者 → NodeRun `failed` → GraphRun `blocked`，且 **queued 的兄弟节点仍为 `queued`**、未被 `cancelQueued`。这是初稿"复用 escalation 不改逻辑"会直接跑挂的场景。
- [ ] T048：单 active Attempt——retry 在同一事务内先做 NodeRun 状态 CAS 再建 Run（主路径，给干净错误）；`idx_runs_one_active_graph_attempt` 兜底其余建 Run 路径。并发/连点测试断言只产生一个 Attempt。
- [ ] T049：**取消的接入点**——`RunDispatchService.cancel()` 的 queued 分支直接 `cancelQueued()` 就 return，**不经 `finalizeAndDrain`/`workflowHook`**（`run-dispatch.ts:202-207`）；补一次图推进调用，与 `workflowHook` 的 GraphNode 分支同一入口。running 分支不变。没有这一步，上表的 NodeRun 转移无从发生，Run 会 `cancelled` 而 NodeRun 永远停在 `ready`。
- [ ] T049b：取消状态转移测试——按 `design.md` 第 7 节表格分别测单节点取消、整图取消、系统队列取消三条路径及各自的 GraphRun 结果，其中**必须包含一个 queued 图节点被取消**的用例。

## Phase 5：查询、API 与 UI（US3、AC-003）

- [ ] T050：GraphRun projection 查询——节点、执行者、attempt 列表、edge traversal、输入 refs。
- [ ] T051：HTTP 路由 `GET /api/issues/:id/graph`、`GET /api/graph-runs/:id`、`POST /api/graph-runs/:id/nodes/:key/retry`，DTO 与错误码矩阵按 `design.md` 第 9 节实现；沿用项目既定的 zod 边界校验（F005 已统一该做法）。
- [ ] T051b：非图 Issue 的 projection 返回 `200` + `null`，Issue 不存在返回 `404`；断言两者可区分。
- [ ] T051c：`POST /api/graph-runs/:id/cancel`（整图取消，幂等；与终态竞争时以 GraphRun 状态 CAS 为准）与 `POST /api/graph-runs/:id/resolve-executors`（`no_capable_adapter` 的恢复入口）。前者是 AC-007 整图取消场景的调用入口——没有它验收测试无从发起。
- [ ] T051d：projection 基数——一个 Issue 多个 GraphRun 时，`GET /api/issues/:id/graph` 返回非终态的那个，无非终态则按 `created_at DESC, id DESC` 取首个，并附 `history[]`；断言实现里**没有无序的 `LIMIT 1`**。
- [ ] T052：Thread 内节点卡片——展示节点责任、执行者、状态、attempt 次数。
- [ ] T053：Inspector graph 段落——展示依赖关系与收敛理由（`satisfied_by` / `decided_by`）。
- [ ] T054：阻塞态 UI——展示阻塞原因与节点级恢复入口（对应 US1 验收场景 2）。

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
