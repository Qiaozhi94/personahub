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
| F006 | 0.2 | Orchestrated Coding Graph Slice | ready-for-development | TBD | `docs/features/0.2/F006-orchestrated-coding-graph-slice/spec.md` |
| F007 | 0.2 | Coordinator Agent & Routing Recommendation | ready-for-development | TBD | `docs/features/0.2/F007-coordinator-routing-recommendation/spec.md` |
| F008 | 0.2 | Workflow Template Admin & Runtime Health | ready-for-development | TBD | `docs/features/0.2/F008-workflow-template-admin-runtime-health/spec.md` |

## v0.2 拆分说明

PRD 第 15 节 v0.2（Orchestrator Workflow）的完成判据覆盖多个独立 intent，按 SOP"一个 feature 一个主要 intent"拆为三个 Feature：

- **F006**：`orchestrator_subagent` 拓扑的图执行能力（fan-out → fan-in、显式 Node/Edge、恢复语义）。ADR 0006 Slice 1 的触发点。先做，因为 Coordinator 推荐出的拓扑需要有东西能执行它。
- **F007**：Coordinator Agent 本体——自然语言目标 → Issue 自动创建/补全、Issue Type 识别、Workflow/Topology/Agent Team 推荐，以及"为什么这么选"的解释。
- **F008**：Workflow Template 管理 UI 初版 + Runtime health check。

F007 的前置决策已由 `docs/decisions/0007-coordinator-execution-channel.md` 关闭：v0.2 的 Coordinator 是确定性规则引擎，不引入 LLM 执行通道，只推荐不派工。关键依据是 `runs` 的三个 NOT NULL 外键使 pre-Issue 调用不能是 Run，以及 v0.2 的推荐候选集大小本来就是 1。

**实施顺序**：F006 → F007 → F008。F007 不依赖 F006 实现完成即可开发（只读取图 definition 常量）；F008 是收尾项。

PRD v0.2 范围里的 "Structured Handoff Packet" 已由 v0.1.4 交付（`handoff-builder.ts`），不重复实现。
