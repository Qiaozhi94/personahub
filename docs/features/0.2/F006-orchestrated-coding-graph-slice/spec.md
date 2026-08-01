---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, fan-out, fan-in, recovery, v0.2]
doc_kind: spec
created: 2026-08-01
updated: 2026-08-01
---

# F006：Orchestrated Coding Graph Slice

> Status: idea | Owner: TBD | Target: v0.2

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 15 节 v0.2 `orchestrator_subagent` 完成判据。
- **架构来源**：`docs/personahub-architecture.md` 第 2、5 节。
- **系统设计来源**：现有 Issue / Run / ThreadEvent / HandoffPacket；最终字段形状由本 feature design 验证后确定。
- **上游决策**：`docs/decisions/0006-executable-work-graph.md`。
- **功能类型**：runtime / workflow / data-model / trace / user-facing。
- **规格模式**：full（进入 design 前补齐）。
- **变更类型**：ADDED。
- **一句话意图**：让一个真实 coding Issue 能被拆成至少两个独立分析节点，并通过显式边汇聚到 synthesis 节点，且执行过程可追踪、可恢复。

## 1. 问题与目标

### 问题

v0.1 只能执行 Implementation → Validation 循环和用户手动顺序接力。`collaboration_topology` / `steps_json` 目前不驱动执行，Run 也同时承担逻辑工作与 provider attempt，无法表达多前驱汇聚或重启后的节点级恢复。

### 目标

- 用一个真实 coding 场景验证 `orchestrator_subagent`：两个独立 review/research 节点 fan-out，结果经显式 Edge 回传，由 synthesis 节点收敛。
- 记录每个节点的职责、输入来源、执行者、attempt、结果与实际 edge traversal。
- 进程重启后重建节点状态，已完成节点不重复执行，进行中 attempt 标记 interrupted，fan-in 不提前收敛。
- 默认所有节点继续进入 workspace 排他锁串行队列；结构性只读隔离未实现前，不宣称物理并行。

### 非目标

- 不做 Graph Compiler / Linter、自然语言 Graph Draft、Canvas 编辑器。
- 不同时做通用 Issue Type 自动分类、Workflow Template 管理 UI 或完整 runtime health dashboard。
- 不改写 F004 validation domain rules，不做并行写入和 branch/worktree 自动合并。

## 2. 用户场景与独立测试

### US1：真实 fan-out → fan-in coding 协作（Priority: P1）

作为用户，我希望系统把一个代码审查/方案分析目标拆成两个独立节点并汇总，以便得到有来源、可复核的综合结论。

**独立测试**：使用 Fake adapter 和临时 workspace 启动固定三节点图，断言两个前驱各产生结果，synthesis 只在两者完成后启动，输入可追溯到两条显式边。

**验收场景**：

1. Given 两个前驱均成功，when 最后一个前驱完成，then synthesis 启动且收到两个前驱的有序结果。
2. Given 一个前驱失败或 blocked，when fan-in 判定，then synthesis 不被误启动，并展示阻塞原因与恢复入口。

### US2：节点级重启恢复（Priority: P1）

作为用户，我希望服务重启后从中断节点继续，而不是重跑已完成工作或提前汇聚。

**独立测试**：在一个前驱完成、另一个 attempt running 时模拟重启，断言前者保持完成，后者变为 interrupted，并可发起新 attempt。

### US3：执行解释与追踪（Priority: P2）

作为用户，我希望在 Thread/Inspector 中看到节点、依赖和收敛理由，以便判断系统为何选择这条执行路径。

**独立测试**：查询 GraphRun projection，验证节点执行者、输入 refs、attempt 状态和 edge traversal 均可展示。

## 3. 范围

### 范围内

- 一个内置、固定结构的 coding graph definition。
- Node / Edge / GraphRun / NodeRun / Attempt 的最小可执行语义。
- fan-out 调度、fan-in join、失败阻塞和节点级恢复。
- 与现有 adapter capability、workspace 锁、Run trace 和 ThreadEvent 的组合。

### 范围外

- 用户自定义任意图、条件表达式语言、循环图。
- 物理并行保证和只读沙箱。
- 通用 Coordinator 推荐系统。

### 边界场景

- 任何节点可能失败、取消、被 escalation 阻塞或在服务重启时 interrupted。
- 同一 NodeRun 可有多个 Attempt，但只有一个 active Attempt。
- fan-in 必须按持久化前驱状态判断，不能只依赖进程内 Promise/event。
- 写节点始终持 workspace 排他锁；无结构性隔离时分析节点也持锁。

## 4. 初始需求边界

- **FR-001**：系统应执行至少两个独立前驱 NodeRun 和一个 synthesis NodeRun，并通过显式 Edge 表达依赖与载荷来源。
- **FR-002**：Node 只表达责任与 required capabilities，不写死具体 adapter/agent。
- **FR-003**：每个 NodeRun 应支持多个 Attempt，provider fallback/重试不得创建第二项逻辑工作。
- **FR-004**：fan-in 只在全部 required 前驱满足 join 条件后触发一次。
- **FR-005**：Graph Runtime 应组合现有 validation/dispatch/lock/evidence service，不复制 F004 domain rules。
- **TR-001**：实际 edge traversal 必须记录 outcome、决策来源和输入/输出 refs。
- **NFR-001**：恢复语义必须完整满足 ADR 0006 第 3 节五条最小要求。
- **NFR-002**：结构性隔离未验证前，全部节点进入现有 workspace 串行队列。

## 5. 成功标准

- **SC-001**：固定三节点 coding graph 在 Fake adapter 和至少一个真实 CLI 场景中完成 fan-out → fan-in。
- **SC-002**：重启恢复测试证明已完成节点不重跑、running attempt 变 interrupted、fan-in 不提前。
- **SC-003**：用户能从 Thread/Inspector 追溯每个节点的执行者、输入、结果和收敛决策。

## 6. 验收清单

- [ ] **AC-001**（`FR-001` - `FR-004`）：真实三节点 graph 正确执行并汇聚。
- [ ] **AC-002**（`NFR-001`）：五条最小恢复语义均有确定性集成测试。
- [ ] **AC-003**（`TR-001`）：实际 edge traversal 和 attempt 可查询、可展示、可回放。
- [ ] **AC-004**（`NFR-002`）：未实现结构性隔离时无两个 agent 进程并发访问同一 workspace。
- [ ] **AC-005**（`FR-005`）：F001-F005 全量回归通过，F004 validation 语义未被复制或改写。

## 7. 待确认问题

以下问题阻塞进入开发，必须在 `design.md` 关闭：

- **Q1**：现有 Run/Event 能否扩展满足 GraphRun/NodeRun/Attempt 的恢复与审计，还是需要独立持久化表？
- **Q2**：首个真实 coding 场景的两个前驱职责与 synthesis 输出 contract 是什么？
- **Q3**：Edge payload 是引用现有 evidence/handoff，还是需要新的稳定 payload envelope？
- **Q4**：节点失败、用户 retry 和 GraphRun 最终状态如何映射回现有 Issue 状态机？

## 8. 实现备注

- 本文档当前为 `idea`，不是开发授权；先完成 design 证据、关闭问题并细化 tasks。
- 任何与 ADR 0006 四条不变量冲突的方案必须通过 superseding ADR，而不能在本 feature 内静默偏离。
