---
topics: [backlog]
doc_kind: note
created: 2026-07-11
updated: 2026-09-14
---

# Feature Roadmap

> **Replan complete (2026-09-08)**: V3.44 interaction design has passed final review. The design
> freeze is lifted. F009 shipped on 2026-09-12 — implementation review cycle 20 converged in 6 rounds and
> `npm run verify:release` plus Windows CI are green, so it is `done` and has left the active table;
> F010 shipped on 2026-09-14 — implementation review cycle 25 converged in 5 rounds and
> `npm run verify:release` plus Windows CI are green — and it has left the active table;
> F013 shipped on 2026-09-14 — implementation review converged, `npm run verify:release` and Windows CI are green, so it is `done` and has left the active table; F012 moved to `ready-for-development` on 2026-09-14 after its pre-development review (cycle 24, 2 rounds) and into `in-progress` on 2026-09-15 (T000–T024 implemented on branch `f012-session-dispatch`); on 2026-09-15 development completed: T007 verified, intake recommend/confirm routes + host removed, `POST /api/issues/:id/runs` and `POST /api/runs/:id/cancel` removed, task face switched to the session surface (`POST /api/issues/:issueId/session`), inspector cancel write removed, `/runtime` reduced to the single F012 projection; T016 converged graph execution onto DispatchService (each node execution is one Dispatch, grace 0, `EligibilityEvaluator` replaces `resolveEligibleAdapter`), the graph surface moved to the session face and `ThreadView` became a read-only compat host; T025 verified all 18 matrix rows and T026 passed with `npm run verify:release` (server 1907 / web 266 / e2e 43+4+2 all green), so it moved to `code-reviewing`（v4 词表；旧名 review）awaiting the implementation review loop. Known follow-ups recorded in T016: `ManualRoutingService` / `RunDispatchService.dispatch()` have no production caller left (retirement tied to F005 T069 evidence), A012's graph read API stays the legacy projection route (F011 M4 owns its retirement), and probe-backed capability evidence is required before any dispatch — e2e fixtures seed none, so dispatch/graph execution itself is covered by server integration tests; F011 completed its pre-development requirement/design review on 2026-09-13 (cycle 23, 3 rounds, 24 findings all fixed) and, with the feature gate verified green, advanced to `ready-for-development` on 2026-09-15 — its implementation still waits for F012's public contracts to pass acceptance (F012's implementation review loop); F014 remains `draft` and in its own doc-review stage. The former Room/Squad plan has been replaced by the trusted task workbench
> sequence in [`docs/features/0.3/README.md`](docs/features/0.3/README.md).

> **Rules**: Only active Features (idea/spec/ready-for-development/in-progress/review). Move to done after completion.
> `ready-for-development` = spec 与 design 均已定稿、`design.md` 的待确认问题全部关闭（`docs/features/README.md` 的硬性约束），可以开始写代码。
> Details live in `docs/features/{version}/Fxxx-feature-name/`（`spec.md`、`design.md`、`tasks.md`），按大版本（0.1、0.2…）分层，见 `docs/features/README.md`。

| ID   | Version | Name                             | Status                | Owner      | Link                                                           |
| ---- | ------- | -------------------------------- | --------------------- | ---------- | -------------------------------------------------------------- |
| F011 | 0.3     | Trusted Task Surface             | ready-for-development | unassigned | `docs/features/0.3/F011-trusted-task-surface/spec.md`          |
| F012 | 0.3     | Session, Dispatch & Intervention | code-reviewing | unassigned | `docs/features/0.3/F012-session-dispatch-intervention/spec.md` |
| F014 | 0.3     | Trusted Task Journey Closure     | draft                 | unassigned | `docs/features/0.3/F014-trusted-task-journey-closure/spec.md`  |

> v0.1、v0.2（F001-F008）已收口，交付摘要见 `docs/features/releases/0.1.md` /
> `0.2.md`；均不再出现在上方活跃表。v0.2 期间多轮独立检视的完整逐条记录见
> `docs/reviews/RETROSPECTIVE.md`（循环 3-4），不在本文件重复。
>
> v0.3 的 F009-F014 已按“前端迁移先行”路线重排 `spec.md` / `design.md` / `tasks.md`；F009 已于 2026-09-12 收口为 `done`（实现代码检视循环 20 六轮收敛，`npm run verify:release` 与 Windows CI 全绿，逐条 finding 见 `docs/reviews/RETROSPECTIVE.md` 循环 20），F010 已于 2026-09-14 收口为 `done`（实现代码检视循环 25 五轮收敛，`npm run verify:release` 与 Windows CI 全绿，逐条 finding 见 `docs/reviews/RETROSPECTIVE.md` 循环 25），F013 已于 2026-09-14 收口为 `done`（实现代码检视已收敛，`npm run verify:release` 与 Windows CI 全绿，逐条证据见 `docs/reviews/RETROSPECTIVE.md` 循环 26），F012 已于 2026-09-14 完成开发前需求与设计文档检视（循环 24 两轮收敛）并推进为 `ready-for-development`，F011、F014 仍为 `draft` 并处于影响面与开发前审查阶段。F014 是唯一端到端交付 owner。版本范围、顺序与验收旅程
> 见 `docs/features/0.3/README.md`。

## v0.2 拆分说明（历史背景，供理解 v0.3 延续的拆分惯例参考）

PRD 第 15 节 v0.2（Orchestrator Workflow）的完成判据覆盖多个独立 intent，按 SOP
"一个 feature 一个主要 intent" 拆为 F006（图执行）/ F007（Coordinator 推荐）/
F008（模板管理 UI）三个 Feature，这一惯例延续到了 v0.3 的 F009-F014 拆分。
三者已于 2026-08-09 全部收口，详见 `docs/features/releases/0.2.md`；期间的
需求文档检视与实现代码检视共产出 100+ 条 finding，逐条记录在
`docs/reviews/RETROSPECTIVE.md` 循环 3-4，值得复用的教训（如"运行时状态并发写序
保护优先用进程内 generation 计数而非持久化列做 CAS"）已沉淀在其中。
