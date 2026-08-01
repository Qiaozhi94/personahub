---
feature_ids: [F006]
related_features: [F003, F004, F005]
topics: [executable-work-graph, orchestrator-subagent, recovery]
doc_kind: design
created: 2026-08-01
updated: 2026-08-01
---

# F006：Orchestrated Coding Graph Slice - 设计

> Status: draft | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

待真实 coding 场景与恢复需求验证后定稿。默认从 ADR 0006 的 Node ≠ Agent、Edge 一等对象、Definition / GraphRun / NodeRun / Attempt 分层、Graph Runtime 组合领域服务四条不变量出发。

## 2. 影响面

- 后端 / API：GraphRun 查询、节点 retry/恢复入口。
- 存储 / migration：待 Q1 关闭后决定，不预设必须新增四张表。
- Runtime：fan-out/fan-in 调度、attempt lifecycle、workspace 锁组合。
- 事件 / evidence：edge traversal 与输入/输出 refs。
- 前端：Thread/Inspector 的最小 graph projection，不做 Canvas。

## 3. 已固定设计边界

- 全部节点默认进入 workspace 排他锁串行队列。
- 已完成节点不可因重启重复执行。
- active Attempt 重启后标 interrupted，新尝试使用新 Attempt。
- fan-in 依据持久化前驱状态收敛。
- F004 validation policy gate 保持领域服务，不转写成通用 Edge 条件语言。

## 4. 待确认设计问题

- **Q1（未关闭）**：Run/Event 扩展与独立 Graph 持久化方案的恢复、审计和迁移比较。
- **Q2（未关闭）**：固定三节点场景和各节点输入/输出 contract。
- **Q3（未关闭）**：Edge payload/evidence ref envelope。
- **Q4（未关闭）**：GraphRun / NodeRun / Attempt 与 Issue / Run 状态映射。

> 按 `docs/features/README.md`，以上问题未关闭前不得开始代码开发。
