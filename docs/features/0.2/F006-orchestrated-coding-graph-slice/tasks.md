---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, recovery]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-01
---

# F006：Orchestrated Coding Graph Slice - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 0：设计收敛（当前唯一可执行阶段）

- [ ] T001：选择并记录首个真实三节点 coding 场景，给出每个节点的输入/输出示例。
- [ ] T002：对比“扩展 Run/Event”与“独立 Graph 持久化”两种方案，使用 ADR 0006 的恢复五条逐项验证。
- [ ] T003：定义 Edge payload/evidence refs 与实际 traversal contract。
- [ ] T004：定义 GraphRun/NodeRun/Attempt 与 Issue/Run 状态、workspace 锁、retry/escalation 的映射。
- [ ] T005：更新 `design.md` 关闭全部待确认问题，并将 spec 从 `idea` 推进到 `ready-for-development`。
- [ ] T006：基于已关闭 design 拆出按顺序可执行、能追踪到 FR/AC 的完整实现 tasks。

## 依赖关系

- T001-T004 为证据收集与设计工作；T005 阻塞任何代码实现；T006 只能在 T005 后执行。

## 备注

- 当前 tasks 有意不包含 schema/service/UI 实现项，避免在关键设计问题关闭前伪造实施计划。
- 默认物理串行；结构性只读隔离若未来进入范围，必须有独立设计与三个 adapter 的越权测试。
