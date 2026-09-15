---
topics: [session, dispatch, runtime, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-14
---

# F012：Session, Dispatch & Intervention - 任务

## 0. 来源与执行规则

行为以 `spec.md`、实现边界以 `design.md` 为准；旧字段迁移必须先写 fixture 再改 schema。

## 1. 前置条件

F009 新壳层与相关兼容入口已可替换；F010 ref / `recordConsumption` contract 冻结；F013 发布 effective requirements 与路径授权 contract。adapter probe 由本 Feature 的具名 Phase 0 任务负责，不作为无 owner 的外部前置事实。

## 2. 实现任务

### Phase 0：Adapter capability readiness

- [x] T000 (`FR-003`, `FR-008`, `NFR-003`): 对 Codex / Claude Code / OpenCode 的模型枚举、深度（原生档位原文与三档映射）、session resume / 冷启动和原生 memory 关闭效果运行真实 CLI probe；将 CLI 版本、时间、命令、脱敏结果与 supported / unsupported / unverified 裁决写入 `adapter-capability-evidence.md` 和机器可读 fixture，并用缺字段 / 过期版本变异证明 eligibility 保守失败。 — verify: `npm test`

Phase 0 probe 是进入 schema / eligibility 实现的门槛。客观无法执行的 probe 必须标 unverified、记录缺失项和重跑命令；不得把缺失 probe 当作 supported，也不得因此静默跳过独立性要求。

### Phase 1：模型、迁移与 eligibility

- [x] T001 (`FR-001`, `FR-002`): 定义 Session / Dispatch / Attempt / execution identity / context snapshot / eligibility / outbox 类型。 — verify: `npm run typecheck`
- [x] T002 (`FR-002`, `NFR-001`): 新增 `runtime_machines` 单机根、`agent_configs.runtime_id`，并按 ADR 0012 落地表实现 `base_url` 的全部八个触点（migration、`AdapterConfig` 类型、repository 四处、DTO、契约形状校验、updater / route 透传、API Key 分支 UI；快照不加该列）。 — verify: `npm test --workspace server`
- [x] T003 (`FR-001`, `NFR-001`): 新增 `rooms` 表与 `threads.room_id` 一对一索引，为全部历史 thread 回填 room 且不改任何历史 ID；补历史 fixture。 — verify: `npm test --workspace server`
- [x] T004 (`FR-002`, `FR-004`): 新增 `dispatches`（幂等键 `(room_id, client_request_id)`）、`attempts`、context / capability 两张快照表及索引。 — verify: `npm test --workspace server`
- [x] T005 (`FR-006`, `FR-008`): 新增 `adapter_capability_evidence` 与三层 `dispatch_gates` 表，并把 `agent_configs` 的 AI 成员语义迁移为 adapter 接入事实（`name` 改执行组合可读名、`role` 只读保留、`capability_tags` 停用）。 — verify: `npm test --workspace server`
- [x] T006 (`FR-009`, `NFR-001`): 实现持久 DomainOutbox 公共基础设施（同一事务 enqueue、worker 投递、consumer ack、指数退避重试、poison 保留与诊断），并证明 Dispatch 广播与 F011 `acceptance.completed` 复用同一 contract。 — verify: `npm test --workspace server`
- [x] T007 (`FR-002`, `FR-003`, `FR-008`): 实现单机 runtime projection（adapter / 锁 / 队列 / 后台任务 / 额度事实）与三档 eligibility evaluator，将 F013 versioned effective requirements 固定到 Dispatch snapshot；本任务覆盖同源可选降级、结构性缺失不可选，以及 Skill 升级 / 禁用后的历史不漂移。 — verify: `npm test --workspace server`

### Phase 2：派工与介入

- [x] T010 (`FR-004`, `NFR-001`): 实现确认即建 draft、draft 撤销、立即开始、deadline CAS / starting lease，以及 context + consumption + Attempt / Run + dispatched 单事务提交；逐点故障注入并断言 commit 前零 spawn。 — verify: `npm test --workspace server`
- [x] T011 (`FR-005`, `FR-011`, `NFR-002`): 实现 context assembler、过滤事件、resume key 与五条强制冷启动，调用 F013 `verifyAuthorization()` 复核三层路径交集，并通过 F010 公共 API 幂等记录 Artifact consumption（同事务校验 Dispatch 与 `run_id` 归属一致）；本任务是该集成的最终 owner。 — verify: `npm test --workspace server`
- [x] T012 (`FR-006`, `NFR-001`): 实现任务 / 图 / 运行时三层 pause 与 claim barrier、cancel / reassign、restart recovery，并把「旧进程已死」推断提成具名函数 `isRunOwnerDead()`。 — verify: `npm test --workspace server`
- [x] T013 [P] (`FR-001`, `FR-007`): 实现独立会话、会话消息与转任务。 — verify: `npm test`
- [x] T014 (`FR-010`): 在确认与超时启动两条路径实现验收锁断言，拒绝在 finalizing / completed 上创建或确认 Dispatch 并返回替代路径。 — verify: `npm test --workspace server`
- [x] T015 (`FR-003`, `FR-004`, `FR-006`, `FR-008`, `NFR-004`): 接入选择器、撤销倒计时与立即开始横幅、`/sessions/:sessionId` 路由、会话面、运行时面与全局闸门，密钥与 session 标识默认遮罩。 — verify: `npm test --workspace web`

- [x] T016 (`FR-004`, `FR-008`, `NFR-001`): 按 design §2.1 把 graph 执行收敛到 Dispatch：graph scheduler 调 `DispatchService.confirm()`（图内节点 grace 固定为 `0`，`dispatches.graph_node_run_id` 指向 `node_runs`），节点执行组合由 `EligibilityEvaluator` 取代 F006 `resolveEligibleAdapter()`，启动 / 取消 / 节点重试 / executor 重选全部走 DispatchService，并把 graph 启动入口从 `ThreadView` 重挂到会话面后删除该宿主，完成后回填 T025 的 6 行矩阵证据与 e2e。 — verify: `npm test --workspace server && npm test --workspace web`

T016 进度（2026-09-15）：**已完成**（服务端 + web），仅 e2e 与 A012 归属判定留在别处。

- 服务端：① `DispatchService` 图节点能力——`graphNodeRunId` 落库、`createQueuedRun()` 建 `role=GraphNode` + `node_run_id` 的 Run、`nodeInstructions()` 从持久化 `node_runs` / `graph_runs` 重建节点指令、`confirmGraphNode()`（grace 0，请求内 claim/start）；② `graph-runtime.ts`——`createGraph()` 只建 graph_run + node_runs、`start()` 用 `EligibilityEvaluator` 解析执行组合后逐个 `confirmGraphNode`、删除 `enqueueSequential()`；③ `graph.ts`——节点重试 / resolve-executors / 图取消全部走 `DispatchService`（`confirmGraphNode` / `cancelAttempt`），`resolveEligibleAdapter()` 在 graph 路径退役。
- web：④ 新增 `web/src/components/graph/GraphRunPanel.tsx`（`StartGraphDialog` + `GraphRunCard` + 自取 issue/adapters 的 `GraphRunPanel`），挂到会话面（任务绑定房间）；⑤ `ThreadView.tsx` 收敛为**只读**（composer 与 graph UI 移除），作为任务面的兼容轨迹宿主重新挂回 `TaskDetailPage`，F005 验证横幅与事件流保持可达；⑥ 移除 `apiClient.runs.create` / `runs.cancel` 与 `useCreateRun` / `useCancelRun`。
- 测试与门禁：⑦ `tests/helpers.ts` 新增 `sessionService` / `eligibilityEvaluator` / `dispatchService` / `dispatchGates` 与 `seedCapabilityEvidence()` / `seedDispatchableAdapter()` / `TEST_CLI_VERSIONS`；⑧ `F009_WRITE_API_HOSTS` 更新（graph 写宿主 → `GraphRunPanel.tsx`；`runs.create` / `runs.cancel` → retired）；⑨ 删除 `f005-composer-routing.test.tsx` 与 f002 的两个 composer 用例，`f004-unblock-dialog` / `f006-graph-run-card` 同步。
- 证据：server 1907 tests 全绿、web 266 tests 全绿、`graph-routes-mutations` 5/5、`npm run verify` 全绿。
- e2e（2026-09-15 补齐）：`f009-create-task` 改走纯建任务流程；`f009-golden-journey` 的 J2（/runtime 无项目选择器）/ J3（新建任务）/ J4（会话面派工入口与三档披露）/ J8（graph 操作迁会话面、A011 取消入口退役）全部改写；`f009-a11y` 的 intake 条目删除、graph 条目经会话面打开、cancel-run 对话框随 A011 退役；`f009-deferred-boundary` 的 composer 与 /runtime 两条边界断言改按新面；`f009-empty-database` 的 /runtime 断言改按机器投影。证据：`npm run test:e2e` 43/43、`npm run test:e2e:empty-db` 4/4、`npm run test:e2e:invocation-lifecycle` 2/2。
- 复用结论：走 `EligibilityEvaluator` 的测试 adapter 必须以 `codex` / `claude-code` / `opencode` 注册并播种 `depth` 证据（`fake` 不在 `DEPTH_THREE_TIER_MAP`）。

## 3. 验证与验收任务

- [x] T020 (`AC-001`, `AC-003`, `AC-006`): 复跑 adapter evidence fixture、真实 CLI resume / 冷启动与原生 memory 隔离验证，并核对 unsupported / unverified eligibility 后果与遮罩。 — verify: `npm test`
- [x] T021 (`AC-002`, `AC-004`): 完成 cancel / claim、三层 pause / claim 并发，过期 starting lease、kill/restart 与恢复集成测试。 — verify: `npm test --workspace server`
- [x] T022 (`AC-007`): 完成 outbox 原子 enqueue、worker 崩溃重投、consumer ack 幂等与 poison 诊断的集成与重启测试。 — verify: `npm test --workspace server`
- [x] T023 (`AC-008`): 完成验收锁与路径授权复核的集成测试，覆盖两条启动路径与任务级范围只能收紧。 — verify: `npm test --workspace server`
- [x] T024 (`AC-005`): 完成 Playwright 派工、撤销、独立会话、会话消息、介入和运行时旅程。 — verify: `npm run test:e2e`
- [x] T025 (`AC-001`, `AC-004`, `AC-005`): 逐行核对 `migration-matrix.md` 中 owner 为 F012 的 18 行（P004、P006、P007、P010、A006-A015、A025-A028）的 `delete_when`，确认旧写入口不可达后更新矩阵的 `implementation_status` 与证据。 — verify: `npm run test:docs`

T025 结论（2026-09-15）：18 行全部核对完成，旧写入口不可达。

- 已达成旧写入口不可达并已在本地门禁验证：P004、A025、A026、A027（adapter 兼容契约含 `runtime_id` / `base_url`，唯一写宿主由 `F009-T020-001` 门禁锁定）；P006、A006、A007（intake recommend / confirm 路由与宿主 `IntakeDialog` 一并删除，派工确认幂等由 `web/src/f012-sessions.test.tsx` / `tests/integration/dispatch-service.test.ts` 覆盖）；A008、A009（`POST /api/issues/:id/runs` 路由删除，`ThreadView` 不再被任何生产页面渲染）；A011（inspector 取消写移除，取消由 `POST /api/attempts/:id/cancel` 承担）；P010、A028（`/runtime` 只保留 `RuntimeMachineSection` 单一读模型，schema 事实留在 `/system-diagnostics`，`RuntimeHealthPanel` 删除）。
- A012（graph 读）：读面已随 T016 迁到会话面的协作图区（`GraphRunPanel`），底层读 API 仍为遗留投影路由 `GET /api/issues/:id/graph`；该路由与其在 `IssueInspector` 的读宿主属 F011 的 A016–A019（M4）范围，其退役与 F011 一并判定。
- 附带退役债务（不阻塞 T025 判定，已记录）：`ManualRoutingService` / `RunDispatchService.dispatch()` 已无生产调用方（仅测试与 F005 T069 证据使用），其退役需与 `validation-manual-validator.test.ts` 证据改写一并处理。
- [x] T026 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`, `AC-008`): 运行发布质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

F013 contract 与本 Feature Phase 0 probe 完成后，T001→T002→T005→T006→T007→T010/T011/T012/T014→T015；T003 与 T004 可在 T001 后与 T002 并行（互不同表），但 T002 与 T005 必须串行——两者都迁移 `agent_configs`，并行会争抢同一个顺延 schema 版本号。T013 可在 T003 后并行。T000 的证据缺口只能产生 unverified，不允许以口头假设解锁 T007。T025 必须在 T015 之后、T026 之前。F011 在 Dispatch / Session / consumption integration 与 outbox contract 验收后接入，不形成反向依赖。

## 5. 明确后移

多机 daemon 移交 v0.7；自动续派与智能推荐移交 v0.6；用量聚合与 `run_usage` 表移交 v0.4。
