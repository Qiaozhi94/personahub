---
kind: feature
id: F011
version: "0.3"
status: draft
gate_version: 1
related_features: [F006, F007, F008, F009, F010, F012]
topics: [room, human-lead, intervention, graph, collaboration, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F011：Work Room & Human Intervention

> Owner: TBD | Target: v0.3

> **⚠️ SUPERSEDED PENDING REVIEW（2026-08-13）**：本文的用户场景、UX 需求与非目标
> 写于产品体验重置之前，其产品判断已不可直接使用。v0.3 已暂停，PersonaHub 用户旅程
> 正在重做，本 Feature 的三件套（`spec.md` / `design.md` / `tasks.md`）在旅程与原型
> 定稿前**不得作为开发输入**，`status: draft` 不代表可用。处理结论见
> <a href="../../../reviews/product-experience-reset-plan.md">`docs/reviews/product-experience-reset-plan.md`</a>
> 第 7 节；重新进入计划的条件按该节表格逐项判定。技术契约部分（数据模型、接口）
> 可作为背景材料，但需与新旅程重新对齐后才生效。

## 0. 来源与意图

- **PRD 来源**：`docs/personahub-prd.md` 第 5 节 Room、第 15 节 v0.3。
- **架构来源**：`docs/personahub-architecture.md` Graph/Run/Thread 章节。
- **系统设计 / Research / Contract 来源**：`docs/personahub-system-design.md` Room 草案；F006 Graph、F007 intake、F010 artifact projection。
- **上游决策**：v0.3 评审决策 Q4（Room 控制粒度只调整未开始节点），见 `docs/features/0.3/README.md` 第 6 节。
- **功能类型**：runtime / workflow / backend / ui。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：让用户看见并安全介入一个多节点协作现场，而不新建第二套执行引擎。

## 1. 问题、目标与非目标

### 问题

Graph 已能执行多节点，但用户看到的是运行卡片，无法把目标、分工、阶段产物和人工纠偏作为一个临时协作现场管理。Room 提供观察与控制边界；执行状态仍由 Graph/NodeRun/Run 和 workspace FIFO 决定。

### 目标

把 Room 做成现有 Graph/NodeRun/Run/Thread 之上的协作与控制边界。Feature 完成后，用户能进入 Room 查看分工，暂停/纠偏/调整后续执行并归档；事件回放能解释原计划、人工改动、最终执行者和产物。

### 非目标

- 本 feature 不做自由群聊、Room 自有调度器、跨 Issue Room、多人权限、语音/视频。
- 本 feature 不新建第二套执行状态机；执行、取消、恢复继续由 Graph/NodeRun/Run 负责。
- 本 feature 不实现可复用 Squad（留给 `F012`）。

## 2. 用户场景

每个用户场景都应该能独立交付价值，并能独立验证。按优先级排序，确保只完成 P1 时也能形成一个有意义的最小切片。

### US-001：自动开 Room（Priority: P1）

作为 `Human Lead`，我希望 `确认 orchestrator_subagent 推荐时同事务创建 Room/room Thread/Graph，并展示创建理由和成员分工`，以便 `进入一个可观察的协作现场`。

**为什么是这个优先级**：Room 必须先存在，后续观察/控制场景才有载体。

**独立测试**：确认推荐后断言 Room/Thread/Graph 同事务创建，任一失败无孤儿。

**验收场景**：

1. Given `F007 推荐被用户确认`，when `confirm 提交`，then `Issue/Room/Thread/Graph 同事务创建且展示创建理由与成员分工`。
2. Given `confirm 任一步失败`，when `事务回滚`，then `无孤儿记录、无幽灵事件`。

### US-002：旁听现场（Priority: P1）

作为 `Human Lead`，我希望 `查看节点、Run、成员、输入输出 contracts、artifacts/evidence 和决策时间线`，以便 `理解当前协作进展`。

**为什么是这个优先级**：旁听是控制动作的前提，且本身独立交付可观察价值。

**独立测试**：进入 Room，断言 projection 返回 Graph/members/artifacts/timeline。

**验收场景**：

1. Given `一个 active Room`，when `用户打开 Room 页面`，then `展示 overview、members、graph、artifacts、timeline`。

### US-003：暂停与纠偏（Priority: P1）

作为 `Human Lead`，我希望 `暂停只阻止当前 Room 所属 Graph 中尚未启动的 NodeRun Attempt，补充约束后恢复`，以便 `不停止 running 节点的同时调整后续执行`。

**为什么是这个优先级**：暂停/纠偏是 Room 控制价值的核心，且依赖 US-001/US-002 先成立。

**独立测试**：pause 后断言 queued GraphNode Run 不启动、running 节点继续；resume 后断言仅一个 drain 生效。

**验收场景**：

1. Given `Room active 且有 queued GraphNode Attempt`，when `用户 pause`，then `queued GraphNode Run 不启动，running 节点继续`。
2. Given `Room paused 且用户补充约束`，when `resume`，then `后续 GraphNode Run 上下文包含约束且仅一个 drain 生效`。

### US-004：调整执行者（Priority: P1）

作为 `Human Lead`，我希望 `未开始节点可换 adapter，running 节点必须先 cancel 再换人`，以便 `安全调整分工而不热换运行中进程`。

**为什么是这个优先级**：换人是对分工的直接控制，与暂停同属 P1 控制面。

**独立测试**：对 pending 节点 reassign 成功；对 running 节点 reassign 返回 409 并给出 cancel->retry 操作。

**验收场景**：

1. Given `未开始节点`，when `reassign`，then `服务端重新校验 availability/capability 后更新执行者`。
2. Given `running 节点`，when `reassign`，then `返回 409 ROOM_RUNNING_NODE_REASSIGN_REQUIRES_CANCEL 并给出 cancel->retry 操作`。

### US-005：归档回放（Priority: P2）

作为 `Human Lead`，我希望 `完成/失败/取消后 Room 归档，重启仍可回放计划、人工介入和最终产物`，以便 `事后追溯协作过程`。

**为什么是这个优先级**：归档回放依赖前四个场景的完整事件流先稳定。

**独立测试**：归档后重启，断言 Room、成员快照、人工操作、artifact 链完整回放。

**验收场景**：

1. Given `Room 到达终态或被显式取消`，when `归档并重启`，then `Room、成员快照、人工操作、artifact 链完整回放`。

## 3. 范围与边界

### 范围内

- Human Lead 可手动创建 Room；Coordinator 在用户确认 `orchestrator_subagent` 方案后可按确定性规则创建 Room。
- Room 拥有独立 Thread、目标、阶段、topology、成员快照、输入/输出契约、evidence 要求、终止条件和状态。
- 用户可查看创建理由、节点/成员分工、Run 状态、artifacts、evidence 和关键决策。
- 用户可暂停后续派工、补充约束、取消正在运行的 Run、调整尚未开始的节点执行者，并显式恢复。
- 所有人工介入和 override 写入结构化事件；Room 结束后只归档，不物理删除。

### 范围外

- 运行中进程热换 agent（必须先 cancel 再重建 Attempt）。
- 跨 workspace 并发、跨 Issue Room。
- 控制图完成后在 primary Thread 创建的普通 implementation/validation Run（v0.3 的 Room 是当前 `orchestrator_subagent` Graph 的控制面；未来若要控制这些阶段，应创建各自的阶段 Room）。

### 边界场景

- 当 pause 提交时会发生什么？只阻止该 Room/Graph 的 queued GraphNode Attempt；running 节点继续；普通 implementation/validation Run 不被误拦截。
- 如果 adapter 状态在 reassign 期间翻转，系统应如何处理？重新校验 availability/capability 并阻塞，不静默替换。
- 在 Room active/paused/blocked 时，哪些事情绝不能发生？不可归档；只有图终态后自动归档或用户显式取消全部活动 Run 后归档。

## 4. 需求

使用稳定 ID，方便 design、tasks、code review 和 tests 引用。

### 功能需求

- **FR-001**：Room 保存 Issue、专属 Thread、phase、goal、topology、创建理由、contracts、evidence 要求、termination condition 和状态。
- **FR-002**：自动创建仅发生在用户确认后；推荐阶段零写入。手动创建必须选择现有 Issue 和可执行图方案。
- **FR-003**：Room 投影复用 Graph/NodeRun/Run，不复制其执行状态为另一套可变真相源。
- **FR-004**：pause 原子地标记 Room，并使该 Room/Graph 的 queued GraphNode claim 资格判断拒绝新启动；已 running Run 不自动终止，非 GraphNode Run 不进入这个 Room gate。
- **FR-005**：constraint 以追加事件保存；resume 后 context assembler 把 active constraints 注入尚未启动的新/queued Attempt。
- **FR-006**：reassign 只允许 pending/ready 或已取消 Attempt 的节点；服务端重新校验 workspace availability/capability。
- **FR-007**：成员变化保存 adapter identity 快照、原因、操作者和生效边界；不改历史 Run identity。
- **FR-008**：Room 在 active/paused/blocked 时不可归档；图终态后自动归档，或用户在明确取消全部活动 Run 后归档。

### 事件 / Trace 需求

- **TR-001**：记录 `room.created/paused/resumed/constraint_added/member_added/member_removed/executor_reassigned/archived`。

### UX 需求

- **UX-001**：Room 页面展示 overview、members、graph、artifacts、timeline；每个控制动作有 pending/success/error 与影响范围说明。

### 非功能需求

- **NFR-001**：可靠性 / 恢复：创建/暂停/恢复/换人与对应事件同事务，提交前不广播/drain。
- **NFR-002**：兼容性：重复请求用 idempotency key 收敛；并发 pause/resume/reassign 采用 revision CAS。
- **NFR-003**：安全 / escalation 边界：所有控制动作保留 raw AgentOps signal；v0.3 不做评分。

## 5. 生命周期与不变量

```text
active <-> paused
active/paused -> blocked（图 blocker 投影）
blocked -> active/paused（恢复后按 pause 意图）
active/paused/blocked -> cancelling -> archived（显式取消）
active -> archived（图 completed）
任意非终态 -> failed（不可恢复的 Room contract 损坏）
```

不变量：

- Room status 不替代 Graph status；`blocked` 是投影缓存，恢复资格仍由 graph blocker 决定（FR-003）。
- pause 只阻止未启动 GraphNode Attempt，不终止 running Run（FR-004）。
- 成员变化不改历史 Run identity；历史 Run.adapter_identity 永不修改（FR-007）。
- Room active/paused/blocked 时不可归档（FR-008）。
- 控制动作与事件同事务，提交前不广播/drain（NFR-001）。

## 6. 成功与验收

### 成功标准

- **SC-001**：用户能进入 Room，查看分工，暂停/纠偏/调整后续执行并归档，执行状态仍由 Graph/Run 决定。
- **SC-002**：所有人人工介入和 override 可从结构化事件回放解释原计划、人工改动、最终执行者和产物。
- **SC-003**：Room 不拥有独立执行生命周期；pause 只阻止未启动 GraphNode Attempt，running 节点继续。

### 验收清单

验收清单每项引用第 4 节真实存在的需求 ID。本 Feature 处于 `draft`，`tests:` 路径暂缺，进入 `review` 前回填。

- [ ] **AC-001** (`FR-002`, `NFR-001`): F007 确认原子创建 Issue/Room/Thread/Graph；任一失败无孤儿、无幽灵事件。
- [ ] **AC-002** (`FR-004`): pause 后同 Room/Graph 的 queued GraphNode Run 不启动，running 节点继续，普通 implementation/validation Run 不被误拦截；resume 后仅一个 drain 生效。
- [ ] **AC-003** (`FR-005`, `TR-001`): 纠偏约束只影响生效点后的 Attempt，并可从事件解释。
- [ ] **AC-004** (`FR-006`): 未开始节点可换人；running 热换被拒并给出 cancel->retry 操作。
- [ ] **AC-005** (`FR-006`, `FR-007`): adapter 状态翻转时 reassign 复核并阻塞，不静默替换。
- [ ] **AC-006** (`FR-007`, `FR-008`): 归档/重启后 Room、成员快照、人工操作、artifact 链完整回放。

## 7. 测试、依赖与决策

### 测试策略

- 单元测试：状态机、资格 gate、constraint effective sequence、reassign guard。
- 集成测试：confirm 原子性、pause/drain 竞态、cancel/retry/reassign、restart。
- UI / E2E：五个场景；真实 CLI 做 pause->纠偏->换人->resume->archive。
- 真实环境 / 手动验证：真实 CLI 全旅程与 SSE replay。

### 依赖

- 上游 Feature / Contract：F006 Graph、F007 intake、F008 共享 queued classifier（T041b）、F009/F010 artifact projection。
- 下游消费者：F012 复用 Room 成员选择契约。
- 外部 / 环境依赖：真实 CLI 需真实环境验证 pause/resume/reassign 旅程。

### 决策与风险

| 决策 / 风险 | 结论或缓解 | 理由 | 后续 |
|---|---|---|---|
| Room 定位 | control/projection boundary，不拥有独立执行生命周期 | 不新建第二套执行状态机 | 不做 Room 自有调度器 |
| pause 语义 | future-dispatch pause，不冻结 OS 进程 | 只阻止未启动 GraphNode Attempt | 不 kill running |
| running 换人 | 必须先 cancel 再建 new Attempt | 热换需新进程协议 | 不允许运行中热换 |
| 控制粒度 | v0.3 只调整未开始节点 | 热换风险高 | 未来扩展另开阶段 Room |
| F008 T041b 未落地则 F011 阻塞（风险） | 显式依赖并复用其 classifier，不复制判定 | 避免资格判断漂移 | F011 不得自行复制 `startNextQueuedRun()` |

## 8. 待确认问题

- [x] Q-001: pause 的语义是什么？ - 决策：pause 是 future-dispatch pause，不冻结 OS 进程；只阻止该 Room/Graph 尚未启动的 GraphNode Attempt。
- [x] Q-002: running 节点能否热换 agent？ - 决策：running 换人必须先 cancel 再建 new Attempt；不允许运行中热换。
- [x] Q-003: Room 是否拥有独立执行生命周期？ - 决策：Room 不拥有独立执行生命周期；执行、取消、恢复继续由 Graph/NodeRun/Run 和 workspace FIFO 决定。
