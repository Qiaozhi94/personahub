---
topics: [journey, migration, integration, release]
doc_kind: tasks
created: 2026-09-08
updated: 2026-09-08
---

# F014：Trusted Task Journey Closure - 任务

## 0. 来源与执行规则

只在公开 API 与 F009 生产壳层集成；发现业务缺口回到 F009–F013，不在本 Feature 直写表、复制状态或重建前端骨架。

## 1. 前置条件

F009–F013 达到 review 且各自 AC 有真实测试路径；生产测试可使用隔离 CLI 配置和临时代码目录。

## 2. 实现任务

### Phase 1：迁移与导航

- [ ] T001 (`FR-003`, `NFR-001`): 建立全部发布 schema fixture、升级矩阵与守恒断言。 — verify: `npm test --workspace server`
- [ ] T002 (`FR-003`, `FR-004`): 实现 owner import adapters、migration report 与 legacy route map。 — verify: `npm test`
- [ ] T003 (`FR-001`, `FR-004`, `UX-001`): 在 F009 壳层注册已验收工作面，完成剩余路由 / 深链切流并清除兼容写入口。 — verify: `npm test --workspace web`

### Phase 2：端到端旅程

- [ ] T010 (`FR-002`, `UX-001`): 建立 J1–J5 API / browser fixture builder。 — verify: `npm run typecheck`
- [ ] T011 (`FR-002`, `UX-001`, `UX-002`): 实现首次设置、派工、四视图、异常恢复与验收 Playwright。 — verify: `npm run test:e2e`
- [ ] T012 (`FR-005`, `NFR-002`): 实现隔离真实 CLI + 独立验证 + kill/restart smoke 和证据索引。 — verify: `npm run verify:release`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-004`): 对照 V3.44 执行生产可访问性与人工浏览器检查。 — verify: `npm run test:e2e`
- [ ] T021 (`AC-002`): 从每个 release schema 升级两次并核对报告、ID、终态与 refs。 — verify: `npm test --workspace server`
- [ ] T022 (`AC-003`): 运行真实 CLI 版本验收旅程并保存 Evidence Summary 链接。 — verify: `npm run verify:release`
- [ ] T023 (`AC-001`, `AC-002`, `AC-003`, `AC-004`): 更新发布摘要并运行最终门禁。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

T001 可与 F009–F013 收尾并行；T002 依赖各 owner import contract；T003 依赖页面 ready；T010→T011/T012→T020–T023。

## 5. 明确后移

J6–J8 的完整旅程移交 v0.4；多机与 daemon 发布旅程移交 v0.7；非 coding 旅程移交 v0.5。
