---
kind: feature
id: F007
version: "0.2"
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, explainability]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-09
---

# F007：Coordinator Agent & Routing Recommendation - 任务

> Owner: TBD | Spec: `spec.md` | Design: `design.md`

> **实施证据（2026-08-08 完成）**：F007 服务端测试见 `server/tests/integration/{intake-confirm,intake-routes,intake-secret,intake-null-definition}.test.ts`，前端测试见 `web/src/f007-intake-dialog.test.tsx`。全部任务经 `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` 验证通过。
>
> 故障原子性/并发/边界（第三、四、五轮检视补齐，2026-08-08）：T021c 并发双击在三个层级覆盖——①「same token confirmed twice produces one Issue」顺序幂等；②两个独立 better-sqlite3 连接共享同一文件库双确认收敛单 Issue；③**两个 OS 子进程经 tsx 各持一连接、文件 barrier 同步后真实并行 confirm**（`parallel-confirm-worker.ts` +「two OS processes double-confirming converge to one Issue」）。confirm 外层事务对 `SQLITE_BUSY` 指数退避重试（`isBusyError`），并用 `testHooks.afterIdempotencyMiss` 把 barrier 放在两次 nonce miss 之后——两个进程都先观察到 miss 才竞争写入，`isIntakeConfirmationConflict` 的撞主键回滚+重读取胜者分支被确定性触发；测试断言两进程都成功、issue id 相同、恰一次 `replayed:false` + 一次 `replayed:true`。T021d 故障注入覆盖 event-write（`thread_events` trigger）、adapter 复核（替换无能力 adapter → `ADAPTER_CAPABILITY_MISSING`）、图创建（空 workspace → `GRAPH_TARGET_SET_EMPTY`）三处，均断言无孤儿。T021h 覆盖 sequential 与 graph 两分支的 commit 前零副作用（`broadcast`/`drainWorkspace` spy；未调用唯一派工入口 `drainWorkspace`，且回滚后无 run 进入 running——结构性推断，非直接观察 provider 进程）。T022 覆盖 adapter 状态翻转、workspace 解绑（→ `RECOMMENDATION_STALE`）、模板停用、graph definition 消失（→ `RECOMMENDATION_STALE` + `changed:["graph_definition_id"]`）。T033 覆盖超长目标（截断用于匹配、`goal` 存全文）。
>
> 提交后恢复（第六轮检视补齐，2026-08-08）：事务 commit 是成功边界；首次 confirm 提交后 `drainWorkspace` 若抛错，重试同一 token 会走 replay 路径并重新幂等 drain（`intake-service.ts`），确保 queued Run 不会被搁置。`SQLITE_BUSY` 整事务重试每次尝试用全新 `attemptEvents` 缓冲，成功后才广播该次事件，避免回滚尝试的“幽灵事件”进入在线 UI；`isBusyError` 优先按结构化 `code` 判断。
>
> 注：`npm test` 默认跑 server + web 全量（real-CLI gated 测试按仓库约定 `REAL_CODEX=1` 才启用，见 CLAUDE.md T083/T084）；`graph-cli-acceptance` 等真实 CLI 测试需真实 Codex 环境，不在默认门禁内。

## Phase 1：规则集与推荐服务（FR-001、FR-002、NFR-001）

- [x] T010：`shared/src/types/` 新增 `Recommendation<T>`、`RoutingRecommendation`、`RecommendationPremise`、`IssueDraft`、`IntakeBlockReason` DTO。
- [x] T011：`services/routing/rules.ts`——四条路由规则 + 三条 Issue 字段规则各自独立可测，统一返回 `{value, rule, candidates, excluded[]}`。
- [x] T011b：`IssueDraft` 规则实现——`derive_title_from_first_line`（首个非空行、折叠空白、120 字符截断）、`preserve_goal_verbatim`（仅去首尾空白）、`default_priority`；目标文本 8000 字符上限只作用于关键词匹配，`goal` 存全文（`design.md` 第 3 节）。
- [x] T011c：`IssueDraft` 边界样例测试——单行短文本、多行文本、纯空白、超长文本、首行为空后续有内容，逐个 Given/When/Then。
- [x] T012：`RoutingRecommendationService.recommend(projectId, goalText)`——纯计算，禁止写库、禁止取锁、禁止建 Run。
- [x] T012b：**目标 workspace 固定为 `project.default_workspace_id`**，`RecommendRequest` 不接受 `workspace_id`；服务端把它写进 token。理由：确认路径复用的 `IssueService.create()` 签名里没有 workspace，实现写死读默认值（`issue.ts:72`），允许指定别的 workspace 会让推荐依据与实际执行落在两个 workspace 上（`design.md` 第 9 节）。回归断言 token 中的 workspace 与最终 Issue/GraphRun/Run 全部一致。
- [x] T013：roster 规则接 `effectiveAdapterStatus()`；断言 Project 级 Available 但 workspace 级 Unavailable 的 adapter 出现在 `excluded` 且 reason 指明 workspace 级来源（US2）。
- [x] T013b：topology 规则按**逐节点能力覆盖**判定，允许同一 adapter 覆盖多个节点。回归测试：**只有一个 Available adapter 时，`orchestrator_subagent` 仍可被推荐**（`design.md` 第 7 节；初稿按 adapter 数量降级会让单 adapter 环境永不启用图）。
- [x] T013c：无 adapter 具备 `Implementation` 时**直接返回阻塞** `NO_AVAILABLE_CAPABLE_ADAPTER`，**不降级为 `sequential`**——v0.2 三个节点与 sequential 要的是同一项能力，降级后的方案同样不可执行，只会让 recommend 返回一个 confirm 必然拒绝的方案（`design.md` 第 7 节）。
- [x] T014：确定性测试——相同状态重复调用 N 次，**`RoutingRecommendation` + `RecommendationPremise` 完全一致**（FR-002）。确定性的比较对象**必须排除** `nonce`、`issued_at`、`signature` 以及包含它们的 `recommendation_id`：这些每次签发本就应当不同，拿整个 `RecommendResponse` 做全等比较必然失败。
- [x] T015：无副作用测试——调用 recommend 后断言 issues / threads / runs / 锁状态零变化（AC-005）。

## Phase 2：前提快照与确认路径（FR-003、FR-004、FR-005）

- [x] T019：新建 `server/src/db/schema-v9.ts`——`intake_confirmations`（`nonce` 主键，**无 `status` 列**，结果字段全 NOT NULL，`target_kind` 带 CHECK）+ `app_secrets` 表 + `migrations.ts` 分支 + 迁移测试。版本号按实际落地顺序取，**不得追加进已应用版本**。
- [x] T019b：HMAC 密钥生命周期（`design.md` 第 1 节）——首次启动生成 32 字节 CSPRNG 并写 `app_secrets`，后续启动读回、**跨重启不变**；值损坏/为空则启动失败并给出明确信息，**不静默重新生成**（静默重生成会让在途 token 变成无法解释的"签名无效"）。不做轮换。测试：跨重启验签通过、损坏值启动失败、首次启动只生成一次。
- [x] T020：`ConfirmationToken` 签发——`nonce` 每次全新、`premise` 采集、规范化序列化（键升序 + 稳定编码，签发与验签共用同一函数）、`recommendation_id` 作内容摘要（**不作身份、不作校验依据**）。`payload.recommended` 必须携带全部五个维度（`issue_type`/`issue_draft`/`workflow_template`/`collaboration_topology`/`agent_roster`），与 `RecommendResponse` 一致（R002，`design.md` 第 9 节）。**签发不写任何库**，与 T012 的零副作用要求一致（`design.md` 第 1、5 节）。
- [x] T020e：一致性测试——同一次推荐里 `RecommendResponse.issue_type`、`token.payload.recommended.issue_type`、confirm 后 `coordinator.recommendation_applied` 事件里的 issue type 三处取值一致；Intake UI 展示的 issue type 与响应一致（US1，R002）。
- [x] T020a：**HMAC 签名与验签**——密钥来源唯一为 `app_secrets` 表（见 T019b，不再有"本地配置或首次生成"的二选一）。confirm 的事务外顺序固定：验签失败 → 400 `CONFIRMATION_TOKEN_INVALID`；再校验路由 `:projectId` 与 payload 一致；**再按 `nonce` 查已确认事实，命中即返回 200**；未命中才判 `issued_at` 是否超 30 分钟。
- [x] T020a3：过期重放测试——已成功确认的 token 在 31 分钟后重放，断言返回 **200 与既有结果**而非 `RECOMMENDATION_STALE`；未确认过的过期 token 才返回 stale。
- [x] T020a2：篡改测试六种——改 `issued_at`（绕过期）、改 `issue_draft`（绕只读）、改 `issue_type`（绕只读，R002 新增维度同样受签名保护）、改 `project_id`（跨 Project）、改 `premise`（污染审计）、伪造/缺失 `signature`。零写入模型下 token 的唯一副本在客户端手里，**没有签名服务端就无法执行自己的契约**（`design.md` 第 1 节）。
- [x] T020b：premise 必须包含 `capability_tags` 与 `updated_at`——`capability_tags` 的修改不进 `availabilityRelevantFieldsTouched`（`adapter-config-updater.ts:113-119`），只比可用性会漏掉能力被摘除的情况。回归测试：改能力不改可用性后 confirm，断言 `RECOMMENDATION_STALE`。
- [x] T020c：两个不同目标在同一系统状态下各拿到不同 `nonce`、可各自独立确认——防止用哈希作身份导致第二个目标拿到第一个的结果。
- [x] T020d：`createSequentialRun(deps, issueId, threadId, workspaceId, projectId, adapterConfigId)` 自由函数（`design.md` 第 6 节）——不接收 `tx`、不自持事务、不 broadcast、不拉进程、**不接收 `instructions` 参数**：① `issueRepo.getById(issueId)` 校验归属 project/workspace，**`instructions` 唯一来源是 `issue.goal.trim()`**（不接受调用方另传，避免与 token 中签名保护的 goal 分叉）；② 经 `resolveEligibleAdapter()` 复核 `Implementation` 能力，`agentConfigRepo.getById()` 取 adapter 实体；③ `runRepo.create({..., role: Implementation, purpose: WorkflowBound, status: Queued, dispatch_source: UserExplicit, adapter_identity: {adapter_config_id, name, cli_provider, default_model}, context_source_run_id: null})`——provenance 字段与既有普通 implementation Run 对齐，不留空；④ `issueRepo.compareAndSetStatus(issueId, Inbox, Running)`；⑤ 写 `RunQueued` ThreadEvent（字段与 `ManualRoutingService.dispatch()` 对齐：含 `dispatch_source`/`cli_provider`/`context_source_run_id`/`drives_issue_state: true`）加入返回的 `pendingEvents`，**不在函数内 broadcast**。返回 `{ runId, pendingEvents }`。**替代**上一轮误写的"`sequential` 复用 F006 `enqueueSequential()`"——后者只是 `createGraph()` 的别名，会把单 Run 请求悄悄建成三节点图（`design.md` 第 6 节，2026-08-08 检视修正）。
- [x] T020f：instructions 一致性测试——token 中签名保护的 `issue_draft.goal`、confirm 后落库的 Issue `goal`、`createSequentialRun` 建出的 Run `instructions` 三者完全一致；HTTP `chosen` payload 不能覆盖 instructions（R006）。
- [x] T020g：provenance 测试——sequential Run 的 `adapter_identity`/`dispatch_source`/`context_source_run_id` 与普通 implementation Run 同形状；confirm 之后修改该 adapter 配置（改名/换 provider），断言已创建 Run 的 `adapter_identity` snapshot 保持确认时的身份不变（R007）。**Run 的 `adapter_identity` 是执行者历史身份的唯一真相源**——不要求 `coordinator.recommendation_applied` 事件也独立保留 name/provider/model 快照：该事件的 `recommended`/`chosen` 只存 adapter id（`design.md` 第 6 节、T024），职责是记录规则、推荐值、最终选择与差异，不是身份快照（第二次最终复检修正：v0.2 不新增 `chosen_adapter_identities` 这类事件字段，避免图分支也要逐节点补齐同一份数据）。
- [x] T021：`IntakeService.confirm()`——**事务外**先验签/结构校验/过期/projectId 一致；**单外层事务**：复核前提与用户改选 → `IssueService.create()` 创建 Issue（内部自身的 `db.transaction()` 在已有事务中自动退化为 SAVEPOINT）→ 写 `coordinator.recommendation_applied` 事件 → 按 topology 建首个执行单元 → **最后一步** INSERT `intake_confirmations` 完整行；**commit 之后**把 `createSequentialRun(...)` 或 `createGraph(...)` 返回的 `pendingEvents` 与 coordinator 事件合并后**逐一 broadcast**，再对确认时使用的默认 workspace 调一次 drain（v0.2 两条分支的目标 workspace 恒为同一个，见 `design.md` 第 9 节"只对 Project 默认 workspace 推荐"，无需去重多个 workspace id）。只写 drain 会让 Graph/Run/Coordinator 事件入库却不实时推送，SSE/UI 要刷新才可见。认领之所以在最后：表内全部列 NOT NULL，`issue_id`/`target_id` 要等实体建完才有值，开头 INSERT 插不进去。
- [x] T021b：topology 分流——`sequential` → `createSequentialRun(deps, issueId, threadId, workspaceId, projectId, adapterConfigId)`（T020d，自由函数，无 `tx` 参数）；`orchestrator_subagent` → **先在事务外调 `prepareGraph()`**（遍历文件系统，不能占写锁），再 `createGraph(deps, issueId, threadId, workspaceId, projectId, plan, preflight)`（F006 自由函数，同样无 `tx` 参数——真实签名见 F006 `design.md` 第 8.2 节，`server/src/services/graph-runtime.ts:59-67`）。顺序固定为：验签 → 幂等命中检查 → 过期判断 → `prepareGraph()`（仅图分支需要）→ 开写事务。空文件集或越界 symlink 在 preflight 阶段就失败，此时**尚未写入任何 Issue**。两者**只写库不拉进程**（F006 `design.md` 第 8.2 节）。F006 未落地时图分支返回 409 `TOPOLOGY_NOT_EXECUTABLE`，**禁止静默回退为 `sequential`**。
- [x] T021c：幂等测试——同一 token 重复 confirm（含并发双击）只产生一个 Issue。测试要断言具体事务序列：后到者在最后一步撞 `nonce` 主键 → 整个事务回滚 → 另起读操作取胜者已提交的行 → 返回 200 与既有 `issue_id`/`target_id`。`intake_confirmations` **无 `status` 列**，也**不存在 `CONFIRMATION_IN_PROGRESS`**（单事务下不可观察）。
- [x] T021e：token 过期测试——超过 30 分钟的 token 返回 `RECOMMENDATION_STALE`。
- [x] T021f：失败后重试测试——事务回滚后表中无残留行，同一未过期 token 可再次成功确认。
- [x] T021d：失败原子性测试——在事件写入、adapter 复核、图启动三处各注入一次失败，断言事务回滚、**不留孤儿 Issue/Thread**，且客户端可安全重试。
- [x] T021g：`sequential` 分支故障注入测试——在 `createSequentialRun(...)` 返回**之后**、外层事务 commit **之前**注入失败（例如 `intake_confirmations` INSERT 失败），断言回滚后库中不留 Issue/Thread/Run/ThreadEvent 任何一行；同一未过期 token 可安全重试并最终成功（R001 完成判据，`design.md` 第 6 节）。
- [x] T021h：commit 前无副作用测试——`sequential` 与 `orchestrator_subagent` 两条分支在外层事务提交前，断言 `threadEventService.broadcast()` 未被调用、`drainWorkspace()` 未被调用、无 provider 子进程启动；仅在 commit 成功后才发生（呼应 T012 的推荐阶段零副作用要求，这里覆盖的是确认阶段"未提交前零副作用"）。
- [x] T022：`RECOMMENDATION_STALE` 错误码与变化项返回；测试覆盖 adapter 状态翻转、workspace 解绑、模板版本变更三种失效。
- [x] T022b：**用户改选值的独立校验**——用户把推荐的 adapter 换成另一个后，若新选的 adapter 当前不可用，必须返回 `RECOMMENDATION_STALE` 并指明是哪一项；断言该校验不依赖原始快照是否包含它（`design.md` 第 5 节）。
- [x] T023：断言确认路径经**共享的 `resolveEligibleAdapter()`**（F006 第 8.3 节）且传入显式 adapter id（两条 topology 分支各测一次）；回归断言推荐服务从不写 `default_adapter_config_id`（FR-005）。
- [x] T023b：图分支断言——`nodeAssignments` 覆盖 definition 全部节点（含 synthesis），在 `createGraph` 事务内逐项复核；任一不通过则整体拒绝，**不部分启动、不自行替换执行者**（US3 对 `orchestrator_subagent` 同样成立）。
- [x] T023c：外层回滚测试——`createGraph`/`createSequentialRun` 返回后外层事务回滚，断言无进程被拉起、库中无残留 Issue/GraphRun/Run。
- [x] T024：新增 `coordinator.recommendation_applied` ThreadEvent，payload 含 `rules[]`、`recommended`、`chosen`、`diff[]`（TR-001）。
- [x] T025：无关 adapter 的后台 probe 收敛**不得**使推荐失效——针对性回归测试。

## Phase 3：HTTP API（FR-006）

- [x] T030：`POST /api/projects/:id/intake/recommend`，zod 边界校验（沿用 F005 统一做法）。
- [x] T031：`POST /api/projects/:id/intake/confirm`。
- [x] T032：阻塞响应——`no_available_adapter`、`project_workspace_required` 等结构化原因 + 建议动作（FR-006）。
- [x] T033：边界用例——空/纯空白/超长目标文本，按 `design.md` 第 8 节表格逐项断言。

## Phase 4：Intake UI（US1、US3）

- [x] T040：Intake 入口与目标输入框；保留既有 `CreateIssueDialog` 手工路径不动。
- [x] T041：推荐结果面板——五个维度（issue type、issue draft、workflow template、topology、roster）分别展示 `value` / `rule` / `candidates` / `excluded`；`issue_type` 控件禁用并注明"当前只有 coding 候选"（R002，`design.md` 第 9 节）；`agent_roster` 按 `by_node[node_key]` 逐节点展示候选与排除原因，不是单一候选列表（`design.md` 第 9 节 `AgentRosterRecommendation`）。
- [x] T042：调整控件——**仅 `collaboration_topology` 与 `agent_roster` 可改**，按服务端返回的 `editable[]` 渲染；`issue_draft` 与 `workflow_template` 展示规则与候选集但控件禁用并注明"v0.2 不可调整"（`design.md` 第 9 节）。
- [x] T043：确认 / 取消；取消后断言无任何持久化写入（US3）。
- [x] T044：阻塞态展示原因与建议动作；`RECOMMENDATION_STALE` 引导重新推荐。
- [x] T045：文案检查——不得出现"系统理解到"这类语义理解暗示，统一为"命中规则 X"（`design.md` 第 3 节、ADR 0007）。

## Phase 5：验收

- [x] T050：US1-US4 四条独立测试全部通过。
- [x] T051：topology 判定测试——断言"仅有一个可用 adapter"**不触发**降级；断言无 `Implementation` 能力时返回 `NO_AVAILABLE_CAPABLE_ADAPTER` 阻塞而非 `sequential` 方案。**v0.2 不存在可触发的能力降级路径**，不要为它写一条测不出来的分支（`design.md` 第 7 节）。
- [x] T052：F001-F006 全量回归。
- [x] T053：门禁——`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`；新增文件纳入 Prettier format targets。
- [x] T054：回写 `spec.md` 验收清单与 `BACKLOG.md` 状态。

## 依赖关系

- Phase 1 → Phase 2 → Phase 3 → Phase 4 顺序执行。API 契约已在 `design.md` 第 9 节定稿，无额外准入条件。
- T051 依赖 F006 的 definition 已存在（只读取 `definition_id`/`version` 与逐节点 `required_capabilities`，不依赖其运行时完成）。
- **T021b / T023b / T023c 依赖 F006 的 `createGraph(deps, ...)` 自由函数与 `resolveEligibleAdapter()` 落地**（不接收 `tx` 参数；跨 feature 契约由 F006 `design.md` 第 8 节拥有，2026-08-08 已核对与实现一致）。F006 已于 2026-08-08 完成（`spec.md` Status: done），此依赖已满足。`sequential` 分支不再依赖 F006——`createSequentialRun`（T020d）是本 feature 自己的自由函数，与 F006 的 `enqueueSequential()` 无关（该方法只是 `createGraph()` 的别名，2026-08-08 检视后已不再用于 `sequential` 分支，见 `design.md` 第 6 节）。其余任务不依赖 F006 实现完成即可开发。

## 备注

- 不引入 LLM、不自动派工、不新建执行路径（ADR 0007）。
- `coordinator_agent_id` 两列在 v0.2 保持 NULL，不写入（`design.md` 第 4 节）。
- PRD v0.2 范围中的 Structured Handoff Packet 已由 v0.1.4 交付，不重复实现。
