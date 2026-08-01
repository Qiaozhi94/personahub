---
feature_ids: [F007]
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, explainability]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-01
---

# F007：Coordinator Agent & Routing Recommendation - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：规则集与推荐服务（FR-001、FR-002、NFR-001）

- [ ] T010：`shared/src/types/` 新增 `Recommendation<T>`、`RoutingRecommendation`、`RecommendationPremise`、`IntakeBlockReason` DTO。
- [ ] T011：`services/routing/rules.ts`——四条规则各自独立可测，统一返回 `{value, rule, candidates, excluded[]}`。
- [ ] T012：`RoutingRecommendationService.recommend(projectId, goalText)`——纯计算，禁止写库、禁止取锁、禁止建 Run。
- [ ] T013：roster 规则接 `effectiveAdapterStatus()`；断言 Project 级 Available 但 workspace 级 Unavailable 的 adapter 出现在 `excluded` 且 reason 指明 workspace 级来源（US2）。
- [ ] T014：确定性测试——相同状态重复调用 N 次结果完全一致（FR-002）。
- [ ] T015：无副作用测试——调用 recommend 后断言 issues / threads / runs / 锁状态零变化（AC-005）。

## Phase 2：前提快照与确认路径（FR-003、FR-004、FR-005）

- [ ] T020：`RecommendationPremise` 采集与哈希；**只快照推荐中实际引用到的 adapter**（`design.md` 第 5 节）。
- [ ] T021：`IntakeService.confirm()`——复核快照、创建 Issue、写事件、按确认的 topology 分流发起执行。
- [ ] T021b：topology 分流——`sequential` → `RunDispatchService.dispatch()`；`orchestrator_subagent` → `GraphRuntimeService.start()`。F006 未落地时该分支返回明确阻塞，**禁止静默回退为 `sequential`**（`design.md` 第 6、7 节）。
- [ ] T022：`RECOMMENDATION_STALE` 错误码与变化项返回；测试覆盖 adapter 状态翻转、workspace 解绑、模板版本变更三种失效。
- [ ] T023：断言确认路径经 `resolveAdapter()` 且传入显式 adapter id；回归断言推荐服务从不写 `default_adapter_config_id`（FR-005）。
- [ ] T024：新增 `coordinator.recommendation_applied` ThreadEvent，payload 含 `rules[]`、`recommended`、`chosen`、`diff[]`（TR-001）。
- [ ] T025：无关 adapter 的后台 probe 收敛**不得**使推荐失效——针对性回归测试。

## Phase 3：HTTP API（FR-006）

- [ ] T030：`POST /api/projects/:id/intake/recommend`，zod 边界校验（沿用 F005 统一做法）。
- [ ] T031：`POST /api/projects/:id/intake/confirm`。
- [ ] T032：阻塞响应——`no_available_adapter`、`project_workspace_required` 等结构化原因 + 建议动作（FR-006）。
- [ ] T033：边界用例——空/纯空白/超长目标文本，按 `design.md` 第 8 节表格逐项断言。

## Phase 4：Intake UI（US1、US3）

- [ ] T040：Intake 入口与目标输入框；保留既有 `CreateIssueDialog` 手工路径不动。
- [ ] T041：推荐结果面板——四个维度分别展示 `value` / `rule` / `candidates` / `excluded`。
- [ ] T042：逐项调整控件（topology、adapter 可改）。
- [ ] T043：确认 / 取消；取消后断言无任何持久化写入（US3）。
- [ ] T044：阻塞态展示原因与建议动作；`RECOMMENDATION_STALE` 引导重新推荐。
- [ ] T045：文案检查——不得出现"系统理解到"这类语义理解暗示，统一为"命中规则 X"（`design.md` 第 3 节、ADR 0007）。

## Phase 5：验收

- [ ] T050：US1-US4 四条独立测试全部通过。
- [ ] T051：topology 降级路径测试——可用 adapter 不足时降级为 `sequential` 且原因出现在 `excluded`（`design.md` 第 7 节）。
- [ ] T052：F001-F006 全量回归。
- [ ] T053：门禁——`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`；新增文件纳入 Prettier format targets。
- [ ] T054：回写 `spec.md` 验收清单与 `BACKLOG.md` 状态。

## 依赖关系

- Phase 1 → Phase 2 → Phase 3 → Phase 4 顺序执行。
- T051 依赖 F006 的 definition 已存在（只读取 `definition_id`/`version`，不依赖其运行时完成）。
- 本 feature 不依赖 F006 的实现完成即可开发，但 T051 的完整验收需要 F006 的 definition 常量落地。

## 备注

- 不引入 LLM、不自动派工、不新建执行路径（ADR 0007）。
- `coordinator_agent_id` 两列在 v0.2 保持 NULL，不写入（`design.md` 第 4 节）。
- PRD v0.2 范围中的 Structured Handoff Packet 已由 v0.1.4 交付，不重复实现。
