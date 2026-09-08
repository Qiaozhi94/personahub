---
topics: [project, repository, skill, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-08
---

# F013：Space, Project & Skills Foundation - 任务

## 0. 来源与执行规则

行为以 `spec.md`、迁移与安全边界以 `design.md` 为准。旧数据 fixture 必须覆盖非标准 Workflow JSON。

## 1. 前置条件

F009 新壳层的首次设置、项目 / 管理入口可替换。Skill revision contract 由本 Feature 自己定义；F012 只消费本 Feature 冻结后的 effective requirements 与路径授权 contract，不是本 Feature 的前置。

## 2. 实现任务

### Phase 1：仓库与项目边界

- [ ] T000 (`FR-001`, `FR-002`, `NFR-001`): 定义 Space contract，新增 schema 与幂等默认 Space migration；以清洁库与仅含历史 Project / Issue 的旧库 fixture 验证归属、原 ID 和游离任务语义。 — verify: `npm test --workspace server`
- [ ] T001 (`FR-003`, `FR-004`, `NFR-002`): 定义仓库、机器路径和项目引用 contract。 — verify: `npm run typecheck`
- [ ] T002 (`FR-003`, `FR-004`, `NFR-001`): 实现 migration、registry、真实路径与 Git 探测。 — verify: `npm test --workspace server`
- [ ] T003 (`FR-003`, `NFR-002`): 接入派工前权限交集校验。 — verify: `npm test --workspace server`
- [ ] T004 (`FR-001`, `FR-002`): 实现首次设置的 Space 创建 / 选择与游离任务创建旅程。 — verify: `npm run test:e2e`

### Phase 2：Skills 与项目 UI

- [ ] T010 (`FR-005`, `FR-006`): 定义 Skill revision schema、激活 / 冲突与 effective requirements。 — verify: `npm test`
- [ ] T011 (`FR-005`, `FR-007`, `NFR-001`): 迁移 Workflow Template 为 Skill refs 并保留 alias / legacy payload。 — verify: `npm test --workspace server`
- [ ] T012 [P] (`FR-003`, `FR-004`, `FR-007`): 实现项目文件 / Skills / 设置工作面。 — verify: `npm test --workspace web`
- [ ] T013 [P] (`FR-005`, `FR-008`): 实现能力面 Skills 表、筛选和整页详情。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-002`, `AC-004`, `AC-005`): 覆盖默认 Space、真实路径、软链、参考仓库写拒绝、旧 Skill ref requirements、冲突与 restart。 — verify: `npm test`
- [ ] T021 (`AC-001`, `AC-003`): 完成首次设置、项目 / Skill Playwright 旅程。 — verify: `npm run test:e2e`
- [ ] T022 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`): 运行发布质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

T000→T001→T002/T003/T004；T010→T011/T013；T012 等待仓库与 Skill API。两条 Phase 可在 Space、共享 ID / version contract 冻结后并行；完成 effective requirements contract 后 F012 才可实现 eligibility。

## 5. 明确后移

Memory、Skill candidate 和效用移交 v0.4；自动编组推荐移交 v0.6；插件 surface 与 marketplace 移交 v0.8。
