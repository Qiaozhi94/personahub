---
topics: [frontend, v344, migration, implementation]
doc_kind: tasks
created: 2026-09-08
updated: 2026-09-08
---

# F009：V3.44 Frontend Foundation & Migration - 任务

## 0. 来源与执行规则

行为以 `spec.md`、结构以 `design.md`、范围与处置以开发前冻结的 `migration-matrix.md`、交互细节以 V3.44 `implementation-notes.md` 为准。每迁移一个入口必须同时更新迁移矩阵、回归测试和旧组件删除清单。

## 1. 前置条件

V3.44 设计冻结且 125 条 browser checks 全绿；F001–F008 release contract、`v02-fixture-contract.md` 与迁移矩阵已冻结；开始编码前完成本 Feature 三件套与当前 `web/src` 影响面检视。实际 fixture 由 Phase 0 T000 建立，Phase 0 fixture 通过前不得执行 T001。

## 2. 实现任务

### Phase 0：历史数据库夹具

- [ ] T000 (`FR-003`, `NFR-001`): 按 `v02-fixture-contract.md` 从 commit `5ef5055` 的 v10 migration 生成并审核 schema snapshot，以 raw SQL seed 建立多 Project / Issue / Run / Graph / Trace / FileChange / Evidence / validation round / adapter / Workflow Template / runtime-health fixture；验证来源指纹、v10 → v11 → current head、二次启动幂等和两项规定变异，禁止调用当前 public API 造数。 — verify: `npm test --workspace server -- f009-v02-fixture`

### Phase 1：迁移清单与前端基础

- [ ] T001 (`FR-002`, `FR-007`, `NFR-004`): T001 只维护和校验已经冻结的矩阵；逐项迁移页面、路由、弹窗、动作、hook 和测试后更新状态与旧组件删除证据，发现漏项须先补矩阵门禁，禁止到实现末尾才反向盘点范围。 — verify: `node --test tools/check-v03-plan-contracts.test.mjs`
- [ ] T002 (`UX-001`, `UX-002`): 对齐 V3.44 design tokens，并建立 dialog / tabs / table / feedback / page-state 共享原语。 — verify: `npm test --workspace web`
- [ ] T003 (`FR-001`, `FR-005`): 严格按 `design.md` 的 M1 SurfaceRegistry manifest 实现 ApplicationShell 与一级导航；测试九个槽位的 enabled / not-registered 状态、route、数据投影和允许动作，并断言未注册 surface 无导航控件、不可聚焦、deep link 进入 not-found。 — verify: `npm test --workspace web`

### Phase 2：既有能力迁入新结构

- [ ] T010 (`FR-003`, `FR-006`): 按迁移矩阵 A001–A005 迁移项目选择 / 创建、代码目录绑定、任务列表 / 创建和当前任务上下文，复用逐行指定的既有 API。 — verify: `npm test --workspace web`
- [ ] T011 [P] (`FR-003`, `FR-006`, `NFR-004`): 按迁移矩阵 A006–A015 为推荐确认、执行启动、人工介入、Run / Graph 状态和会话事件建立唯一 transitional-host；不改领域契约，由 F012 验收时删除，latest_milestone=M3。 — verify: `npm test --workspace web`
- [ ] T012 [P] (`FR-003`, `UX-003`, `NFR-004`): 按迁移矩阵 A016–A024 建任务事实与验收 transitional-host；A016–A020 只读，A021–A024 保留 trigger validation、unblock、reset rounds 与摘要复制 / 下载动作并调用矩阵指定 API；由 F011 验收时删除，latest_milestone=M4。 — verify: `npm test --workspace web`
- [ ] T013 [P] (`FR-003`, `FR-005`, `NFR-004`): 按迁移矩阵 A025–A029 将 adapter / runtime health 最小入口放入运行时 / 设置 transitional-host（F012 验收时删除，latest_milestone=M3）；旧 Workflow Template A030 只保留只读列表 / 详情（F013 验收时删除，latest_milestone=M2），不得重做管理写面或调用旧写 API。 — verify: `npm test --workspace web`
- [ ] T014 (`FR-004`): 按 `design.md` 的 M1 route manifest 实现 `/`、Task / Project base routes 与管理子页；逐条覆盖直达、刷新、History 前进 / 后退、默认 replace、未知 ID、非法子路径和诊断清除。F012 发布 Session ID 前不得注册 `/sessions/:sessionId`，F011 / F013 接管前不得注册 task view / project tab。 — verify: `npm test --workspace web`

### Phase 3：旧入口退出与生产验证

- [ ] T020 (`FR-007`, `NFR-003`, `NFR-004`): 移除生产 registry 中的旧 App Shell、Inspector、Dock、旧管理弹窗和重复写入口；静态断言每个 migrated action ID 只有一个生产 host、每个 retired action ID 无可达写入口，并校验所有 transitional-host 的替换 owner / 删除条件 / 最晚里程碑。 — verify: `node --test tools/check-v03-plan-contracts.test.mjs && npm run typecheck`
- [ ] T021 (`AC-001`, `AC-003`): 只使用 T000 builder 升级后的同一个临时数据库建立新壳层黄金旅程、历史根入口升级和新 canonical deep links Playwright 覆盖；不得用当前 API 重建第二套 E2E seed。 — verify: `npm run test:e2e`
- [ ] T022 (`AC-002`, `AC-004`, `AC-005`): 加入迁移矩阵、死入口、键盘、语义、窄视口、console 和 canonical API 门禁；逐条实现 `v344-browser-check-applicability.md` 的 28 条 adapted 生产断言，并对新增共享原语各做一次失败变异。 — verify: `npm run verify:release`

## 3. 验证与验收任务

- [ ] T030 (`AC-001`, `AC-005`): 运行 F001–F008 全量回归并核对持久化事实、终态与调用路径未变。 — verify: `npm run verify`
- [ ] T031 (`AC-002`, `AC-003`, `AC-004`): 人工按迁移矩阵逐项检查真实浏览器，核对 125 条适用性分母未变化，并运行 `v344-browser-check-applicability.md` 的全部 adapted 生产断言；deferred 项只能验证为无入口。 — verify: `npm run verify:release`
- [ ] T032 (`SC-001`, `SC-002`, `SC-003`): 完成一次代码影响面复核，确认 F010–F014 不需要再向旧视觉容器增加功能。 — verify: `npm run check:features`

## 4. 依赖与并行关系

T000→T001，Phase 0 fixture 通过前不得执行 T001；T001 先于所有迁移；T002/T003 可在清单冻结后并行；T010 完成当前对象路由后，T011–T014 可并行；T020 等对应新入口通过测试后逐项执行；T021/T022/T030/T031 构成退出门禁。F010 只可在 F009 壳层边界冻结后开始，F011–F013 的生产 UI 只接入新壳层。

## 5. 明确后移

Artifact / provenance 移交 F010；任务最终四视图移交 F011；会话、Dispatch 和运行时新事实移交 F012；repository / Skills 移交 F013；跨 schema 升级、兼容清零和整版发布证据移交 F014。
