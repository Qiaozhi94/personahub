---
topics: [task-surface, projection, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-08
---

# F011：Trusted Task Surface - 任务

## 0. 来源与执行规则

行为以 `spec.md`、结构以 `design.md` 为准；生产组件不得复制原型静态数据。

## 1. 前置条件

F009 新壳层和任务兼容 adapter 清单已冻结；F010 ref / provenance contract 已冻结；F012 Dispatch / 会话 / consumption integration 已验收；ADR 0010 状态为 accepted。

## 2. 实现任务

### Phase 1：Projection 与 claim contract

- [ ] T001 (`FR-001`, `NFR-001`): 定义 TaskProjection、attention 计数与 cursor contract。 — verify: `npm run typecheck`
- [ ] T002 (`FR-003`): 实现 claim / argument / evidence 读取与独立性计算。 — verify: `npm test --workspace server`
- [ ] T003 (`FR-001`, `FR-002`, `FR-006`): 聚合 overview 和异常状态矩阵。 — verify: `npm test --workspace server`
- [ ] T004 (`FR-007`, `FR-008`, `NFR-002`): 实现 AcceptanceService、完成要求基线、主张链、风险接受、不可变完成摘要与 `acceptance.completed` outbox；IssueService 仅幂等消费该事件进入 done。 — verify: `npm test --workspace server`

### Phase 2：四视图与副栏

- [ ] T010 (`FR-002`, `UX-001`): 实现任务 shell、概览 / 活动与跨视图草稿。 — verify: `npm test --workspace web`
- [ ] T011 [P] (`FR-003`, `UX-002`): 实现验收 / 大纲、筛选与文件返回条。 — verify: `npm test --workspace web`
- [ ] T012 [P] (`FR-004`, `UX-002`): 实现资源清单 / 预览与变化导航。 — verify: `npm test --workspace web`
- [ ] T013 [P] (`FR-005`): 实现会话旁轨迹、搜索、折叠、分页与放大。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-002`, `AC-005`): 建立状态、可信度与验收写链组件 / API fixture；故障注入摘要写入并验证不会产生无摘要 done。 — verify: `npm test`
- [ ] T021 (`AC-003`, `AC-004`): 建立 Playwright 四视图、键盘和 SSE replay 旅程。 — verify: `npm run test:e2e`
- [ ] T022 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`): 运行发布质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

Projection contract 先于前端。T011/T012/T013 可在 T001–T004 后并行；每个新视图通过后删除对应 F009 兼容 adapter；派工交互只调用已验收的 F012 公共 API，不反向要求 F012 等待本 Feature 的页面容器。

## 5. 明确后移

Memory、自动化、统计工作面移交 v0.4；非 coding 特殊验收表达移交 v0.5。
