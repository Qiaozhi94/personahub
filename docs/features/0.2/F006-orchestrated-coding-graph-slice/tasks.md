---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, recovery]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-01
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

- [ ] T010：新建 `server/src/db/schema-v8.ts`：`graph_runs`、`node_runs` 两表 + `ALTER TABLE runs ADD COLUMN node_run_id TEXT REFERENCES node_runs(id)` + `idx_graph_runs_one_active_per_issue` / `idx_runs_one_active_graph_attempt` 两个 partial unique index。`node_runs.result_event_id` 带 `REFERENCES thread_events(id)`。**不得追加进 v7**。
- [ ] T011：`migrations.ts` 追加 `currentVersion < 8` 分支。
- [ ] T012：迁移测试——旧版本数据库（v7）升级到 v8 后原有数据完好、新表可用；全新库直连 v8。断言 `foreign_keys = ON` 下 ALTER 后既有 Run 行仍可写（`node_run_id` 默认 NULL）。
- [ ] T013：`shared/src/types/` 新增 `GraphRunStatus`、`NodeRunStatus`、`GraphBlockReason`（7 个取值，含 `node_run_cancelled`、`definition_version_unavailable`）、`GraphNodeKey` 与 DTO。
- [ ] T014：`repositories/graph-run.ts`、`repositories/node-run.ts`：CRUD + `listByGraphRun` + 状态 CAS（沿用 `issueRepo.compareAndSetStatus` 的既有写法）。
- [ ] T015：`runs` 仓储与 DTO 补 `node_run_id` 映射，确保既有 Run 路径全部兼容 `null`。
- [ ] T016：唯一索引冲突 → 用户级错误映射（`NODE_RUN_ATTEMPT_IN_PROGRESS` 等，`design.md` 第 8 节表格）；测试断言连点 retry 得到 409 而非 500。

## Phase 2：图定义与运行时骨架（FR-001、FR-002）

- [ ] T020：`server/src/runtime/graph/definitions.ts`：内置 `wgd_coding_dual_review` v1，三节点两条边，Edge 按 `GraphEdgeV1` 完整声明 `acceptedOutcomes` / `required` / `joinGroup` / `inputSlot`（`design.md` 第 6 节）。
- [ ] T020b：定义注册表按**精确 `(id, version)`** 查询，`(id, version)` append-only；查不到 → `definition_version_unavailable`，**禁止回退到最新版本**。
- [ ] T021：`GraphRuntimeService.start(issueId)`：GraphRun + 两个前驱 NodeRun + 两个 `queued` Run + `graph.node_queued` 事件 + Issue 转 `Running` **全部在一个事务内**；synthesis 节点建为 `pending`；派工留给提交后的既有 drain。
- [ ] T021b：`start()` 幂等测试——重复调用撞 `idx_graph_runs_one_active_per_issue`，返回既有 GraphRun 而非创建第二个。
- [ ] T022：节点执行者解析——按 `required_capabilities` 走既有 `AdapterResolver`；无可用 adapter → GraphRun `blocked` + `no_capable_adapter`（禁止写死具体 adapter，FR-002）。
- [ ] T023：新增 5 个 `graph.*` ThreadEvent 类型与写入封装；**`graph.node_result` 必须加入 `EvidenceService.TRUSTED_INTERNAL_ALLOWLIST`**（`evidence.ts:20-31`），否则下游 `resolveTrustedPayload()` 恒返回 null。
- [ ] T024：新增 `RunRole.GraphNode`，图节点 Run 显式写该 role（列无 CHECK、新行写值，无需迁移）。**不得沿用默认 `implementation`**，否则会误触发 `requestValidation` 并被队列资格门取消（`design.md` 第 7 节）。
- [ ] T025：`RunDispatchService.workflowHook()` 增加 GraphNode 分支并**排在最前**、直接 return；现有 Implementation / Validator 两条分支一字不改。
- [ ] T026：`startNextQueuedRun` 增加 GraphNode 资格规则——按所属 GraphRun 状态判定，不参与 `validation_round` 匹配；Issue `Blocked` 时图节点留在队列而非取消。
- [ ] T026b：`transitionToRunning` 增加 GraphNode 分支，把 NodeRun 由 `ready` 同步为 `running`（状态映射表见 `design.md` 第 7 节）。
- [ ] T027：回归断言——图节点 Run 完成后 `requestValidation` **未被调用**，Issue 不进入 `Validating`（AC-005 的直接防线）。

## Phase 3：fan-in 与结果契约（FR-004、TR-001）

- [ ] T030：节点结果 envelope 解析器（复用 F004 的容错解析手法，不复用 validator 语义）；解析成功写 `graph.node_result` 事件并回填 `node_runs.result_event_id`；解析失败 → NodeRun `failed` + `result_unparsable`。
- [ ] T031：`evaluateJoin(graphRunId, nodeKey)`：**在事务内**按前驱 `node_runs` 行判定，写 `join_satisfied_at`，禁止读进程内状态（FR-004）。
- [ ] T032：join 满足时创建 synthesis NodeRun + Run 并入队，写 `graph.join_satisfied` 与两条 `graph.edge_traversed`。
- [ ] T033：synthesis 上下文装配——经 `resolveTrustedPayload(ref, scope)` 取两条入边的 `graph.node_result` payload；**scope 只传 `issueId` + `threadId`，不得传 `runId`**（传了必然 null，见 `evidence.ts:256-259`）。
- [ ] T033b：截断自实现——按 `run-context-builder.ts` 的 `mustNotTruncate` + 预算降级手法，超限时整条丢弃 finding 并记 `truncated` / `dropped_count`，截断声明必须出现在 synthesis 输入正文中。
- [ ] T033c：前驱结果取不到时 → GraphRun `blocked` + `result_unparsable`；断言**不会**拿半份输入跑 synthesis。
- [ ] T033d：端到端断言——两个真实前驱 envelope 经与 synthesis 完全相同的 API 读出，findings 条数与内容逐条匹配（防止"节点 completed、边 traversed、输入为空"）。
- [ ] T034：join 只触发一次的并发测试——两个前驱几乎同时终态时，synthesis 有且只有一个 NodeRun（依赖 `UNIQUE (graph_run_id, node_key)`）。

## Phase 4：失败、恢复与 retry（NFR-001、FR-003）

- [ ] T040：`GraphRecoveryService.reconcile()` 七步，按 `design.md` 第 7 节实现。
- [ ] T041：`index.ts` 接线——排在 `StaleRecoveryService.runAll()` 之后、`drainWorkspace` 之前。
- [ ] T042：恢复语义①②确定性测试——重启后状态可重建、已完成节点不重跑。
- [ ] T043：恢复语义③测试——一个前驱完成、另一个 running 时重启，后者 NodeRun 变 `interrupted`（Run 层复用既有 `StaleRecoveryService`，断言不重复实现）。
- [ ] T044：恢复语义④测试——可从 interrupted NodeRun 发起新 Attempt，`node_run_id` 不变、Attempt 计数 +1。
- [ ] T045：恢复语义⑤测试——重启不使 fan-in 提前收敛；一个前驱仍未完成时 synthesis 不得创建。
- [ ] T045b：故障注入测试——在 `start()`、推进事务一、推进事务二三个写边界后各模拟一次崩溃，断言重启后收敛到一致状态（恢复第 6 步覆盖"事务一成功、事务二失败"）。
- [ ] T046：节点级 retry API + `GraphBlockReason` 独立恢复入口；受理集合为 `{failed, interrupted, cancelled}`；断言**不复用** validation unblock（`recovery-action.ts` 的守卫必须仍然拒绝图类 blocker）。
- [ ] T047：`RunEscalationHandler.cancelQueuedRunsForIssue()` 增加 `role !== RunRole.GraphNode` 过滤（`run-escalation-handler.ts:72-76`）。**这是本 slice 对 escalation 的唯一改动**，检测/事件/Issue 置 Blocked 全部不动。
- [ ] T047b：escalation 确定性测试——**一个前驱 running、一个前驱 queued** 时触发 escalation，断言 running 者 → NodeRun `failed` → GraphRun `blocked`，且 **queued 的兄弟节点仍为 `queued`**、未被 `cancelQueued`。这是初稿"复用 escalation 不改逻辑"会直接跑挂的场景。
- [ ] T048：单 active Attempt——retry 在同一事务内先做 NodeRun 状态 CAS 再建 Run（主路径，给干净错误）；`idx_runs_one_active_graph_attempt` 兜底其余建 Run 路径。并发/连点测试断言只产生一个 Attempt。
- [ ] T049：取消状态转移——按 `design.md` 第 7 节表格分别测试单节点取消、整图取消、系统队列取消三条路径及各自的 GraphRun 结果。

## Phase 5：查询、API 与 UI（US3、AC-003）

- [ ] T050：GraphRun projection 查询——节点、执行者、attempt 列表、edge traversal、输入 refs。
- [ ] T051：HTTP 路由 `GET /api/issues/:id/graph`、`POST /api/graph-runs/:id/nodes/:key/retry`，DTO 与错误码矩阵按 `design.md` 第 8 节实现；沿用项目既定的 zod 边界校验（F005 已统一该做法）。
- [ ] T051b：非图 Issue 的 projection 返回 `200` + `null`，Issue 不存在返回 `404`；断言两者可区分。
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
