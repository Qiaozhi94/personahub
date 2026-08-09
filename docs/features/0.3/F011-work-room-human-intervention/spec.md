---
feature_ids: [F011]
related_features: [F006, F007, F008, F009, F010, F012]
topics: [room, human-lead, intervention, graph, collaboration, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F011：Work Room & Human Intervention

> Status: draft | Owner: TBD | Target: v0.3

## 0. 元信息与意图

- **PRD 来源**：第 5 节 Room、第 15 节 v0.3。
- **一句话意图**：让用户看见并安全介入一个多节点协作现场，而不新建第二套执行引擎。

## 1. 问题、目标与非目标

Graph 已能执行多节点，但用户看到的是运行卡片，无法把目标、分工、阶段产物和人工纠偏作为一个临时协作现场管理。Room 提供观察与控制边界；执行状态仍由 Graph/NodeRun/Run 和 workspace FIFO 决定。

不做：自由群聊、Room 自有调度器、运行中热换 agent、跨 Issue Room、多人权限、跨 workspace 并发、语音视频。v0.3 的 Room 是当前 `orchestrator_subagent` Graph（research/synthesis 阶段）的控制面，不拦截图完成后在 primary Thread 创建的普通 implementation/validation Run；未来若要控制这些阶段，应创建各自的阶段 Room，而不是让已归档 Graph Room 控制整个 Issue。

## 2. 用户场景

- **US1（P1）自动开 Room**：确认 `orchestrator_subagent` 推荐时，同事务创建 Room/room Thread/Graph；展示创建理由和成员分工。
- **US2（P1）旁听现场**：用户查看节点、Run、成员、输入输出 contracts、artifacts/evidence 和决策时间线。
- **US3（P1）暂停与纠偏**：暂停只阻止当前 Room 所属 Graph 中尚未启动的 NodeRun Attempt；用户补充约束后恢复，后续 GraphNode Run 上下文包含约束。已经 running 的节点以及图完成后在 primary Thread 创建的普通 implementation/validation Run 不受该 Room pause 控制。
- **US4（P1）调整执行者**：未开始节点可换 adapter；running 节点必须先 cancel，产生新 Attempt 后才能换人。
- **US5（P2）归档回放**：完成/失败/取消后 Room 归档，重启仍可回放计划、人工介入和最终产物。

## 3. 需求

- **FR-001**：Room 保存 Issue、专属 Thread、phase、goal、topology、创建理由、contracts、evidence 要求、termination condition 和状态。
- **FR-002**：自动创建仅发生在用户确认后；推荐阶段零写入。手动创建必须选择现有 Issue 和可执行图方案。
- **FR-003**：Room 投影复用 Graph/NodeRun/Run，不复制其执行状态为另一套可变真相源。
- **FR-004**：pause 原子地标记 Room，并使该 Room/Graph 的 queued GraphNode claim 资格判断拒绝新启动；已 running Run 不自动终止，非 GraphNode Run 不进入这个 Room gate。
- **FR-005**：constraint 以追加事件保存；resume 后 context assembler 把 active constraints 注入尚未启动的新/queued Attempt。
- **FR-006**：reassign 只允许 pending/ready 或已取消 Attempt 的节点；服务端重新校验 workspace availability/capability。
- **FR-007**：成员变化保存 adapter identity 快照、原因、操作者和生效边界；不改历史 Run identity。
- **FR-008**：Room 在 active/paused/blocked 时不可归档；图终态后自动归档，或用户在明确取消全部活动 Run 后归档。

### Trace / UX / 非功能

- **TR-001**：记录 `room.created/paused/resumed/constraint_added/member_added/member_removed/executor_reassigned/archived`。
- **UX-001**：Room 页面展示 overview、members、graph、artifacts、timeline；每个控制动作有 pending/success/error 与影响范围说明。
- **NFR-001**：创建/暂停/恢复/换人与对应事件同事务，提交前不广播/drain。
- **NFR-002**：重复请求用 idempotency key 收敛；并发 pause/resume/reassign 采用 revision CAS。
- **NFR-003**：所有控制动作保留 raw AgentOps signal；v0.3 不做评分。

## 4. 生命周期

```text
active <-> paused
active/paused -> blocked（图 blocker 投影）
blocked -> active/paused（恢复后按 pause 意图）
active/paused/blocked -> cancelling -> archived（显式取消）
active -> archived（图 completed）
任意非终态 -> failed（不可恢复的 Room contract 损坏）
```

Room status 不替代 Graph status；`blocked` 是投影缓存，恢复资格仍由 graph blocker 决定。

## 5. 验收

- [ ] **AC-001**：F007 确认原子创建 Issue/Room/Thread/Graph；任一失败无孤儿、无幽灵事件。
- [ ] **AC-002**：pause 后同 Room/Graph 的 queued GraphNode Run 不启动，running 节点继续，普通 implementation/validation Run 不被误拦截；resume 后仅一个 drain 生效。
- [ ] **AC-003**：纠偏约束只影响生效点后的 Attempt，并可从事件解释。
- [ ] **AC-004**：未开始节点可换人；running 热换被拒并给出 cancel→retry 操作。
- [ ] **AC-005**：adapter 状态翻转时 reassign 复核并阻塞，不静默替换。
- [ ] **AC-006**：归档/重启后 Room、成员快照、人工操作、artifact 链完整回放。

## 6. 测试与决策

- 单元：状态机、资格 gate、constraint effective sequence、reassign guard。
- 集成：confirm 原子性、pause/drain 竞态、cancel/retry/reassign、restart。
- UI/E2E：五个场景；真实 CLI 做 pause→纠偏→换人→resume→archive。

**已关闭**：pause 是 future-dispatch pause，不冻结 OS 进程；running 换人必须 cancel+new Attempt；Room 不拥有独立执行生命周期。
