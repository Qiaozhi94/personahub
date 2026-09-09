---
topics: [backlog]
doc_kind: note
created: 2026-07-11
updated: 2026-09-08
---

# Feature Roadmap

> **Replan complete (2026-09-08)**: V3.44 interaction design has passed final review. The design
> freeze is lifted. F009 has passed its revised spec/design/tasks and current-code impact review and is
> `ready-for-development`; F010-F014 remain `draft` until their own reviews close. The former Room/Squad plan has been replaced by the trusted task workbench
> sequence in [`docs/features/0.3/README.md`](docs/features/0.3/README.md).

> **Rules**: Only active Features (idea/spec/ready-for-development/in-progress/review). Move to done after completion.
> `ready-for-development` = spec 与 design 均已定稿、`design.md` 的待确认问题全部关闭（`docs/features/README.md` 的硬性约束），可以开始写代码。
> Details live in `docs/features/{version}/Fxxx-feature-name/`（`spec.md`、`design.md`、`tasks.md`），按大版本（0.1、0.2…）分层，见 `docs/features/README.md`。

| ID   | Version | Name                             | Status | Owner | Link                                                            |
| ---- | ------- | -------------------------------- | ------ | ----- | --------------------------------------------------------------- |
| F009 | 0.3     | V3.44 Frontend Foundation & Migration | ready-for-development | unassigned | `docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md` |
| F010 | 0.3     | Artifact & Provenance Foundation | draft | unassigned | `docs/features/0.3/F010-artifact-foundation-provenance/spec.md` |
| F011 | 0.3     | Trusted Task Surface | draft | unassigned | `docs/features/0.3/F011-trusted-task-surface/spec.md` |
| F012 | 0.3     | Session, Dispatch & Intervention | draft | unassigned | `docs/features/0.3/F012-session-dispatch-intervention/spec.md` |
| F013 | 0.3     | Project & Skills Foundation | draft | unassigned | `docs/features/0.3/F013-project-skills-foundation/spec.md` |
| F014 | 0.3     | Trusted Task Journey Closure | draft | unassigned | `docs/features/0.3/F014-trusted-task-journey-closure/spec.md` |

> v0.1、v0.2（F001-F008）已收口，交付摘要见 `docs/features/releases/0.1.md` /
> `0.2.md`；均不再出现在上方活跃表。v0.2 期间多轮独立检视的完整逐条记录见
> `docs/reviews/RETROSPECTIVE.md`（循环 3-4），不在本文件重复。
>
> v0.3 的 F009-F014 已按“前端迁移先行”路线重排 `spec.md` / `design.md` / `tasks.md`；F009 已完成开发前检视并进入 `ready-for-development`，F010–F014 仍为 `draft` 并处于影响面与开发前审查阶段。F014 是唯一端到端交付 owner。版本范围、顺序与验收旅程
> 见 `docs/features/0.3/README.md`。

## v0.2 拆分说明（历史背景，供理解 v0.3 延续的拆分惯例参考）

PRD 第 15 节 v0.2（Orchestrator Workflow）的完成判据覆盖多个独立 intent，按 SOP
"一个 feature 一个主要 intent" 拆为 F006（图执行）/ F007（Coordinator 推荐）/
F008（模板管理 UI）三个 Feature，这一惯例延续到了 v0.3 的 F009-F014 拆分。
三者已于 2026-08-09 全部收口，详见 `docs/features/releases/0.2.md`；期间的
需求文档检视与实现代码检视共产出 100+ 条 finding，逐条记录在
`docs/reviews/RETROSPECTIVE.md` 循环 3-4，值得复用的教训（如"运行时状态并发写序
保护优先用进程内 generation 计数而非持久化列做 CAS"）已沉淀在其中。
