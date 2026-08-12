---
topics: [backlog]
doc_kind: note
created: 2026-07-11
---

# Feature Roadmap

> **Development freeze (2026-08-12)**: v0.3 product development is paused after the first
> v0.2 dogfood exposed blocking journey and discoverability gaps. F009-F012 remain `draft`;
> do not advance them or implement new business code until the user journeys and clickable
> prototype are explicitly approved. The execution source of truth is
> [`docs/reviews/product-experience-reset-plan.md`](docs/reviews/product-experience-reset-plan.md).

> **Rules**: Only active Features (idea/spec/ready-for-development/in-progress/review). Move to done after completion.
> `ready-for-development` = spec 与 design 均已定稿、`design.md` 的待确认问题全部关闭（`docs/features/README.md` 的硬性约束），可以开始写代码。
> Details live in `docs/features/{version}/Fxxx-feature-name/`（`spec.md`、`design.md`、`tasks.md`），按大版本（0.1、0.2…）分层，见 `docs/features/README.md`。

| ID | Version | Name | Status | Owner | Link |
|----|---------|------|--------|-------|------|
| F009 | 0.3 | Artifact Foundation & Provenance | draft | TBD | `docs/features/0.3/F009-artifact-foundation-provenance/spec.md` |
| F010 | 0.3 | Artifact-Centered Coding Slice | draft | TBD | `docs/features/0.3/F010-artifact-centered-coding-slice/spec.md` |
| F011 | 0.3 | Work Room & Human Intervention | draft | TBD | `docs/features/0.3/F011-work-room-human-intervention/spec.md` |
| F012 | 0.3 | Reusable Agent Squads | draft | TBD | `docs/features/0.3/F012-reusable-agent-squads/spec.md` |

> v0.1、v0.2（F001-F008）已收口，交付摘要见 `docs/features/releases/0.1.md` /
> `0.2.md`；均不再出现在上方活跃表。v0.2 期间多轮独立检视的完整逐条记录见
> `docs/reviews/RETROSPECTIVE.md`（循环 3-4），不在本文件重复。
>
> v0.3 的 F009-F012 已分别建立 draft `spec.md` / `design.md` / `tasks.md`，当前
> 处于需求与设计审查阶段；版本范围、顺序与验收旅程见 `docs/features/0.3/README.md`。

## v0.2 拆分说明（历史背景，供理解 v0.3 延续的拆分惯例参考）

PRD 第 15 节 v0.2（Orchestrator Workflow）的完成判据覆盖多个独立 intent，按 SOP
"一个 feature 一个主要 intent" 拆为 F006（图执行）/ F007（Coordinator 推荐）/
F008（模板管理 UI）三个 Feature，这一惯例延续到了 v0.3 的 F009-F012 拆分。
三者已于 2026-08-09 全部收口，详见 `docs/features/releases/0.2.md`；期间的
需求文档检视与实现代码检视共产出 100+ 条 finding，逐条记录在
`docs/reviews/RETROSPECTIVE.md` 循环 3-4，值得复用的教训（如"运行时状态并发写序
保护优先用进程内 generation 计数而非持久化列做 CAS"）已沉淀在其中。
