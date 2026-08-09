---
topics: [backlog]
doc_kind: note
created: 2026-07-11
---

# Feature Roadmap

> **Rules**: Only active Features (idea/spec/ready-for-development/in-progress/review). Move to done after completion.
> `ready-for-development` = spec 与 design 均已定稿、`design.md` 的待确认问题全部关闭（`docs/features/README.md` 的硬性约束），可以开始写代码。
> Details live in `docs/features/{version}/Fxxx-feature-name/`（`spec.md`、`design.md`、`tasks.md`），按大版本（0.1、0.2…）分层，见 `docs/features/README.md`。

| ID | Version | Name | Status | Owner | Link |
|----|---------|------|--------|-------|------|
| F007 | 0.2 | Coordinator Agent & Routing Recommendation | done | TBD | `docs/features/0.2/F007-coordinator-routing-recommendation/spec.md` |
| F008 | 0.2 | Workflow Template Admin & Runtime Health | ready-for-development | TBD | `docs/features/0.2/F008-workflow-template-admin-runtime-health/spec.md` |

> F006（Orchestrated Coding Graph Slice）已于 2026-08-08 完成全部 AC 验收（`spec.md` Status: done），按上方规则移出活跃表；详情见 `docs/features/0.2/F006-orchestrated-coding-graph-slice/spec.md`。

## v0.2 拆分说明

PRD 第 15 节 v0.2（Orchestrator Workflow）的完成判据覆盖多个独立 intent，按 SOP"一个 feature 一个主要 intent"拆为三个 Feature：

- **F006**：`orchestrator_subagent` 拓扑的图执行能力（fan-out → fan-in、显式 Node/Edge、恢复语义）。ADR 0006 Slice 1 的触发点。先做，因为 Coordinator 推荐出的拓扑需要有东西能执行它。
- **F007**：Coordinator Agent 本体——自然语言目标 → Issue 自动创建/补全、Issue Type 识别、Workflow/Topology/Agent Team 推荐，以及"为什么这么选"的解释。
- **F008**：Workflow Template 管理 UI 初版 + Runtime health check。

F007 的前置决策已由 `docs/decisions/0007-coordinator-execution-channel.md` 关闭：v0.2 的 Coordinator 是确定性规则引擎，不引入 LLM 执行通道，只推荐不派工。关键依据是 `runs` 的三个 NOT NULL 外键使 pre-Issue 调用不能是 Run，以及 v0.2 的推荐候选集大小本来就是 1。

**实施顺序**：F006 → F007 → F008。F006 已完成（见上方说明）。F007 的多数任务不依赖 F006 实现完成；`orchestrator_subagent` 分支依赖 F006 的两项现行契约——事务外的 `prepareGraph(workspacePath, workspaceId, definition, definitionId, definitionVersion)`（同步函数）、事务内只写库的自由函数 `createGraph(deps, issueId, threadId, workspaceId, projectId, plan, preflight)`（均由 F006 `design.md` 第 8 节拥有，2026-08-08 已核对与 `server/src/services/graph-runtime.ts` 实现一致；`createGraph` 不接收 `tx` 参数）。`sequential` 分支**不依赖** F006——2026-08-08 开发前检视发现上一轮误写成复用 F006 的 `GraphRuntimeService.enqueueSequential(...)`（那只是 `createGraph(...)` 的实例方法别名，会把普通单 Run 请求悄悄建成三节点图），已改为 F007 自己的自由函数 `createSequentialRun(deps, issueId, threadId, workspaceId, projectId, adapterConfigId)`（F007 `design.md` 第 6 节）。两条分支都经共享原语 `resolveEligibleAdapter()` 复核能力。**F007 不调用便利入口 `start(issueId, threadId, workspaceId, workspacePath, projectId, plan)`**——那是给非 intake 调用方的自开事务包装，从 F007 调它会重新引入嵌套事务与提前 drain。F008 是收尾项。

**schema 版本按落地顺序**：F006 = v8（`graph_runs`（含 `blocked_node_keys` 与 `target_files_*` 四列）/ `node_runs` / `runs.node_run_id` / 两个 partial unique index），F007 = v9（`intake_confirmations` **和** `app_secrets` 两张表），F008 = v10（`admin_audit_events` 一张表 + `workflow_templates` 的两个唯一索引）。顺序若变则顺延——**绝不追加进任何已应用的版本**（F005 的 `availability_revision` 教训）。

### 2026-08-08 F007 开发前最后契约核对（已关闭）

F006 完成、F007 开工前的最后一轮检视（`docs/reviews/requirements-review-2026-08-08-F007-pre-development.md`），5 条 finding 逐条核实后全部成立，均已修复：`sequential` 确认路径误复用 F006 `enqueueSequential()`（改为 F007 自己的 `createSequentialRun(...)`，见上文实施顺序段）；`RecommendResponse` 缺 PRD 要求的 Issue Type 推荐维度（已补第五个字段并纳入 token 签名保护）；`agent_roster` 套用通用 `Recommendation<T>` 无法表达逐节点候选/排除（改为专用 `AgentRosterRecommendation` DTO，`by_node[node_key]` 拆分）；`tasks.md` 残留 `DbOnlyResult`/`affectedWorkspaceIds`/`enqueueSequential(tx,...)`/`createGraph(tx,...)` 等废弃引用（按真实签名重写，`recommendation_id`/"重复确认"统一改回 `nonce`）；`CLAUDE.md`/PRD/ADR 0007 留有 F006 开发前及初稿的过时表述（"下一 active Feature 是 F006"、Coordinator"不需要 workspace"的无限定说法、FR-005 只提 `resolveAdapter()`）（均已同步）。随后复检又发现并修复 3 条收尾 finding（R006～R008）：`createSequentialRun` 流程图与正式签名不一致（签名唯一化，`instructions` 只能来自函数内部读取的 `issue.goal.trim()`）；`runRepo.create()`/`RunQueued` 事件缺 `adapter_identity`/`dispatch_source`/`context_source_run_id`，与既有普通 implementation Run 的 provenance 不对称（已补齐）；`tasks.md` T023c 与 ADR 0007 各留一处旧术语/自相矛盾表述（已清理）。第二次复检又发现 R007 收尾时留了一处过度承诺：`tasks.md` T020g 要求 `coordinator.recommendation_applied` 事件也独立保留 adapter 改名后的身份快照，但该事件 payload（`rules[]`/`recommended`/`chosen`/`diff[]`）只存 adapter id，不存 name/provider/model；已收窄为"`Run.adapter_identity` 是执行者历史身份的唯一真相源，事件不重复快照"，不新增事件字段。累计 9 条 finding 全部关闭，F007 三件套与 ADR 0007 已回写为 2026-08-08，可以开工。

### 2026-08-02 外部检视后的修订

一份独立的 v0.2 需求文档检视（20 条 finding）经逐条对照源码核实后**全部成立**，已并入三个 feature 的 spec/design/tasks。五处会直接导致跑不通或静默损坏的问题：

- **F006 fan-in 取不到前驱结果**：初稿误把 `EvidenceResolution` 当成能取 payload 且有 `truncated` 三态；实际它只返回引用元数据、只产出 `resolved`/`missing`，且 `resolveTrustedPayload()` 的 allowlist 不含 `graph.*`。改为新增 `graph.node_result` 事件作唯一结果真相源并自行实现截断。
- **F006 escalation 会销毁排队中的兄弟节点**：`RunEscalationHandler` 直接 `cancelQueued` 该 Issue 全部 queued Run，不经队列资格门，初稿加的 GraphNode 例外拦不住。
- **F007 按 adapter 数量降级 topology**：会让单 adapter（个人用户默认形态）环境永不启用图。改为逐节点能力覆盖判定。
- **F007 图分支丢弃用户确认的执行者**：`start(issueId)` 不带执行计划，图内部重新解析，US3 对 `orchestrator_subagent` 不成立。
- **F008 通用 `setStatus()` 可造出两个 active 模板**，重新打开 Q2 声称已关闭的隐式接管陷阱；另有审计事件无合法 thread 可写（`workflow_templates` 无 `project_id`，`thread_events.thread_id` NOT NULL）。

三个 feature 状态维持 `ready-for-development`；F007 新增一条 Phase 0 准入（T009 补齐 API 契约后再开工）。

### 2026-08-02 第二轮检视（30 条）

同样逐条核实后全部成立。**其中三条最严重的是上一轮修订自己引入的**：F007 让推荐阶段写库（与它自身「推荐无副作用」的 FR/AC/T012 冲突）、`recommendation_id` 用不含目标文本的 premise 哈希作身份（两个不同目标撞同一主键）、以及 F007/F006 对事务归属各说各话（嵌套时外层回滚撤不掉已拉起的进程）。另有一条是只改了调用方 F007 而没同步 F006，跨 feature 契约实际未成立。

### 2026-08-02 第六轮检视（14 条：7 High + 7 Medium）

**7 条 High 全部源自第五轮引入的 `cancelling` 状态与冻结文件集**——新增设计面本身成了新的不一致来源：`cancelling` 没进迁移任务/恢复扫描/API 守卫（重启后图会永久卡在吸收态；并发 retry 能逆转取消意图）；"kill 无返回时既有执行超时兜底"是错的，`cancelRun()` 在 await **之前**就 `clearTimeout` 了（`agent-runner.ts:308-313`），必须改成有界等待并解除"不改既有 cancel 路径"的约束；`graph.terminal` 把可恢复的 `blocked` 写成终态；preflight 没进 `createGraph` 签名；冻结文件集只存在指令文本里，synthesis 首次入队前被 blocked 就再也重建不出来；queued-claim 失败把 NodeRun 退回 `pending`，与"join 未满足"含义重叠。

处置：`graph_runs` 加 `blocked_node_keys` 与 `target_files_*` 四列；preflight 拆出 `prepareGraph()` 并作显式入参；`graph.blocked` 与 `graph.terminal` 拆开（共 8 个事件）；queued-claim 失败退回 `ready` 而非新增状态；`cancelling` 贯穿索引/恢复/守卫/前端；`GraphBlockReason` 补 `result_too_large` 共 8 项；`FailureReason` 补 `adapter_no_longer_eligible`；F008 不再声称 health 阈值与实际超时同源（实际是 per-adapter，`agent-runner.ts:107`），改为约束 v0.2 adapter 必须用默认值并加断言测试。

### 2026-08-02 第五轮检视（16 条：6 High + 10 Medium）

**本轮三条 High 是前两轮修复自身的后果**，值得记录：① 第四轮为堵"延迟执行不复核资格"加的"不合格就不创建 Attempt"，使得 `resolve-executors` 只改状态时库里没有 queued Run，图会以 `running` **永久空转**——恢复必须补建 Attempt（首个 synthesis 还得现调 `GraphNodeInstructionBuilder`）；② 同一处修复只覆盖"创建 Attempt"三个时点，漏了**建图时就已入队、可能等很久**的前驱 Attempt，补第四个 claim 时点；③ 第四轮定的整图取消 DB-first 协议与既有实现冲突——`AgentRunner.cancelRun()` 末尾的 `transitionToCancelled` 是 `running → cancelled` CAS，DB 先写成 cancelled 会让它失败返回 null，`RunDispatchService.cancel()` 就不调 `finalizeAndDrain()`，**workspace 锁永远不释放**；已改为"未启动的才 DB-first，运行中的走既有路径"，并新增非终态的 `GraphRunStatus.cancelling`。

另外三条 High：F007 允许对非默认 workspace 推荐，而 `IssueService.create()` 写死 `project.default_workspace_id`（`issue.ts:72`），推荐依据与实际执行会落在两个 workspace 上（v0.2 收窄为只支持默认 workspace）；跨 feature 契约只禁了"事务内 drain"没禁"事务内 broadcast"，而 `writeAndBroadcast()` 写完立即 publish，F007 重复确认回滚时会向 SSE 播出**实际不存在的 Issue/Run**（契约收紧为"事务内无任何不可回滚副作用"）；核心原子性章节的"事务二创建下游 NodeRun"仍与全部预建模型冲突。

### 2026-08-02 第四轮检视（13 条：6 High + 7 Medium）

数量继续下降，但**暴露了一个前三轮都没抓到的真实缺口**：`runs.instructions` 是 `NOT NULL`（`schema-v2.ts:29`），而 F006 从未定义图节点的指令从哪来——既有 `run-context-builder` 只装配通用上下文，不知道某节点该从并发视角还是契约视角检视、看哪些文件、输出什么结构。已补节点指令契约（`instructionTemplate` 随 definition 版本冻结、`GraphNodeInstructionBuilder` 作唯一生成入口、目标文件集建图时解析并冻结、retry 原样复用原指令）。

另外三条实质问题：确认表全列 NOT NULL 却要求开头就 INSERT 认领行（认领改到事务最后一步）；已确认的执行者只在建图时校验、延迟创建 Attempt 时无复核点而 `startAdapter()` 只做 `getById()`（补第 8.5 节的三个复核时点）；新增 FK 未接入 adapter 删除守卫，"pending synthesis 已指派但尚无 Run"会绕过 `hasRuns()` 后被数据库拒绝成 500。F008 则发现 `:sourceId` 继承来源与当前 active 被混称为 source——从无 validator 的旧 inactive 版本克隆并激活会绕过关闭验证的确认闸门。

其余为旧术语残留与 DTO/表格不同步，一并清理。

### 2026-08-02 第三轮检视（16 条）

数量降到 5 High + 11 Medium，且**性质变了**：这轮几乎全是同一份文档内部段落之间的措辞冲突（旧结论没随新决定一起改），不再是缺失的契约。五条 High：确认 token 无签名（零写入使其唯一副本在客户端手里，服务端无法执行自己的过期与只读字段契约，已改为 HMAC）、建图既要求"失败即整体拒绝"又要求"落 blocked 图"（已定为写库前拒绝，blocker 只适用于已建起来的图）、能力不足降级为 `sequential` 而 sequential 需要同一项能力（v0.2 不存在可触发的降级，直接阻塞）、`result_unparsable` 同时被写成 `completed` 与 `failed`（统一为 `failed`）、F008 的 T023e 与 T030b 互斥（按四行矩阵重写）。

处置：跨 feature 契约收归 F006 `design.md` 第 8 节单一拥有（`GraphExecutionPlan`、只写库的 `createGraph(tx,...)`、共享的 `resolveEligibleAdapter()`、执行者落库）；推荐阶段改为零写入 + `nonce` token；补齐图的终态化事务、blocker→恢复动作矩阵、取消的接入点（`RunDispatchService.cancel()` 的 queued 分支不走 `finalizeAndDrain`）；F008 明确只有 `steps_json` 有运行时消费者，其余字段只读。F007 的 API 契约已定稿，上一轮的 Phase 0 准入撤销。

PRD v0.2 范围里的 "Structured Handoff Packet" 已由 v0.1.4 交付（`handoff-builder.ts`），不重复实现。
