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
| F007 | 0.2 | Coordinator Agent & Routing Recommendation | idea | TBD | 待建 |
| F008 | 0.2 | Workflow Template Admin & Runtime Health | idea | TBD | 待建 |

## v0.2 拆分说明

PRD 第 15 节 v0.2（Orchestrator Workflow）的完成判据覆盖多个独立 intent，按 SOP"一个 feature 一个主要 intent"拆为三个 Feature：

- **F006**：`orchestrator_subagent` 拓扑的图执行能力（fan-out → fan-in、显式 Node/Edge、恢复语义）。ADR 0006 Slice 1 的触发点。先做，因为 Coordinator 推荐出的拓扑需要有东西能执行它。
- **F007**：Coordinator Agent 本体——自然语言目标 → Issue 自动创建/补全、Issue Type 识别、Workflow/Topology/Agent Team 推荐，以及"为什么这么选"的解释。
- **F008**：Workflow Template 管理 UI 初版 + Runtime health check。

**F007 有一个前置决策未做**：Coordinator 的"推荐 + 解释"走哪个执行通道。现有三个 adapter 全是长时交互式 CLI agent，为选一个模板去 spawn 一次 CLI 会话代价与延迟都不成比例；但直连 API 会引入第一个非 CLI 执行路径，牵动 F005 围绕 CLI 自身 auth 设计的凭据隔离模型。该决策应先出独立 ADR，再进入 F007 的 spec。
