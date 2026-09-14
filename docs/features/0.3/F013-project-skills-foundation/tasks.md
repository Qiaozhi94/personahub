---
topics: [project, repository, skill, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-12
---

# F013：Space, Project & Skills Foundation - 任务

## 0. 来源与执行规则

行为以 `spec.md`、迁移与安全边界以 `design.md` 为准。旧数据 fixture 必须覆盖非标准 Workflow JSON。**正式升级 fixture 必须是合法 v10 数据**（`issues.workspace_id` 非空、未绑定 Project 名下无 Issue）；损坏库场景另建显式命名的 adversarial fixture，见 `design.md` §8。

## 1. 前置条件

F009 新壳层的首次设置、项目 / 管理入口可替换。Skill revision contract 由本 Feature 自己定义；F012 只消费本 Feature 冻结后的 effective requirements 与路径授权 contract，不是本 Feature 的前置。

## 2. 实现任务

### Phase 1：Space、项目与仓库边界

- [ ] T000 (`FR-001`, `FR-002`, `NFR-001`): 定义 Space contract 与 `is_default` / `is_selected` 双事实；新增 schema 与幂等默认 Space migration。 — verify: `npm test --workspace server`
- [ ] T001 (`FR-001`, `FR-002`, `NFR-001`): 实现本版本专用 migration orchestration——事务外开关 `foreign_keys` 并断言读回值、事务内 `foreign_key_check` 与 `schema_version` 原子提交、`finally` 恢复；覆盖注入异常的失败路径。 — verify: `npm test --workspace server`
- [ ] T002 (`FR-001`, `NFR-001`): 在同一 migration 内 rebuild `projects` 与 `issues`（补 `space_id`、`projects.state` / `archived_at`，放宽 `issues` 四列），重建索引与触发器，回填默认 Space。 — verify: `npm test --workspace server`
- [ ] T003 (`FR-001`): 实现 Space 与 Project 的归属约束：`ISSUE_SPACE_MISMATCH` trigger、游离任务创建契约、Project archive / restore / 引用保护删除。 — verify: `npm test --workspace server`
- [ ] T004 (`FR-003`, `FR-004`, `NFR-002`): 定义仓库、机器路径、项目引用（含项目级 `access` 与 `role='reference'` 恒只读的 CHECK）与 `Scope` contract，含入库前前缀校验（绝对路径 / 盘符 / UNC / `..` / NUL / 反斜杠 / 归一化 / 去重）。 — verify: `npm run typecheck`
- [ ] T005 (`FR-003`, `FR-004`, `NFR-001`): 实现 repository migration、registry、`realpathSync` 解析、`authorized_identity` 记录与 Git remote 探测；identity 按 runtime 实时读取不落库。 — verify: `npm test --workspace server`
- [ ] T006 (`FR-003`, `NFR-002`): 实现 `verifyAuthorization()`——重解析 `raw_path`、比对 identity、三层 scope 交集、更新 `last_verified_at`，并冻结为 F012 可消费的只读契约。**本任务只交付契约与其单测，不接入 Dispatch**；派工侧接入由 F012 拥有。 — verify: `npm test --workspace server`
- [ ] T007 (`FR-003`, `FR-004`): 实现 `legacy_workspace_id` 桥，区分两条路径：**迁移产生的 reference 保留**旧 workspace id 供历史追溯，**新建的 reference 恒 NULL**；primary 在迁移时回填、在新建 / 改绑时同事务 upsert；兼容投影只读 primary 行。 — verify: `npm test --workspace server`
- [ ] T008 (`FR-001`, `FR-002`): 实现首次设置的 Space 创建 / 选择与游离任务创建旅程。 — verify: `npm run test:e2e`

### Phase 2：Skills 与项目 UI

- [ ] T010 (`FR-005`, `FR-006`): 定义 canonical revision schema——`Requirement` / `Step` / `EvidenceSpec` DTO、未知字段 fail-closed、id 与 order 规则、按 `(kind, tags)` 的合并去重与稳定排序。**`EvidenceSpec.evidence_kind` 直接引用 `server/src/evidence-ref.ts` 的 `EvidenceRefKind` 类型（不在 F013 侧另列清单，加一条断言：该类型新增成员时本处编译即跟随）**；`status_map` 断言 `resolved` / `missing` / `truncated` 各恰好出现在一个键下，缺任一即 `SKILL_EVIDENCE_STATUS_UNMAPPED` 拒绝激活；未认领归一化 owner 的 kind 报 `SKILL_EVIDENCE_KIND_UNAVAILABLE`。**（review tracked：F013-R1-006，由本任务在实现期关闭——Evidence 契约只认 `EvidenceRefKind` 唯一真相源，该类型新增成员时编译必须跟随，禁止在 F013 侧快照第二份枚举。）** — verify: `npm test --workspace server`
- [ ] T011 (`FR-005`, `NFR-001`): 实现 `skills` / `skill_revisions` 存储与发布态冻结（revision 的 UPDATE / DELETE 与 `skill_revision_files` 的三类写入各自拦截），并**用穷举测试证明不变量 A 的完备性**：对 `project_skill_refs` 与 `skills` 覆盖 INSERT、UPDATE（逐列，含**只改 `skill_id`** 与只改 `pinned_version`）、`INSERT OR REPLACE`、UPSERT 四类写入路径，断言任何路径结束后每条引用都解析到 `published_at IS NOT NULL` 的 revision；用几个 trigger、是否改用不带 `OF` 的 `BEFORE UPDATE` 由实现决定，**判据是该测试全绿**。**（review tracked：F013-R1-003，由本任务在实现期关闭——必须用穷举测试证明不存在绕过 pinned 发布态校验的写入路径，只锁 trigger 名不算关闭。）** — verify: `npm test --workspace server`
- [ ] T012 (`FR-005`, `FR-008`): 实现 Skill 文件快照——激活时入库、`rel_path` containment 与大小上限、读取时 hash 核验。 — verify: `npm test --workspace server`
- [ ] T013 (`FR-005`): 实现扫描、按 `source_identity` 对齐、按 Space 可见集分组的冲突检测；`skill_space_state` 的物化（Space 创建、global Skill 激活为所有 Space、private Skill 激活为自己 Space，三条路径均用 UPSERT 保证重复激活幂等并重算状态）、**读取与 eligibility 的两层与运算**（`skills.state='active'` AND `skill_space_state.state='active'`）、带 `space_id` 的 `resolve-conflict` 与 per-Space 自动恢复。 — verify: `npm test --workspace server`
- [ ] T014 (`FR-006`, `FR-008`): 实现 `skill_delivery_status`，主键 `(skill_id, version, runtime_id, cli_provider)` 并记录 `target_path`；候选安装由该 runtime 的 `cli_provider` 去重得到（同 provider 多配置只一行），渲染器纯函数，激活先提交后逐安装下发，单个失败不回滚且可幂等重试。 — verify: `npm test --workspace server`
- [ ] T015 (`FR-005`, `FR-007`, `NFR-001`): 迁移 legacy Workflow + Validation Policy——按 `(workflow, policy)` 组合生成 revision、写 `skill_legacy_aliases` 与 `skill_legacy_combo_map`、Issue 上的 policy 优先。 — verify: `npm test --workspace server`
- [ ] T016 (`FR-006`): 实现 `EffectiveRequirementsResolver` 与 `SKILL_EVIDENCE_CONFLICT` 判定，冻结为 F012 可消费的只读契约。 — verify: `npm test --workspace server`
- [ ] T019 (`FR-001`, `FR-003`, `FR-005`): 实现 §4 五组审计事件写入（Space / Project / 仓库与授权 / Skill / 下发，含创建类与失败类动作），payload 带 `space_id`、`runtime_id` / `cli_provider` 归属字段，全部写 `admin_audit_events`。 — verify: `npm test --workspace server`
- [ ] T017 [P] (`FR-003`, `FR-004`, `FR-007`): 实现项目文件 / Skills / 设置三个 tab（不注册项目记忆 tab）。 — verify: `npm test --workspace web`
- [ ] T018 [P] (`FR-005`, `FR-008`): 实现能力面 Skills 表、筛选与整页详情（来源、版本、要求、下发状态、只读文件）。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-002`): 覆盖默认 Space 与双表 rebuild、migration runner 的 FK 开关与失败恢复、兼容投影、真实路径 / 软链 / identity 变更、scope 校验与交集、参考仓库写拒绝。 — verify: `npm test`
- [ ] T021 (`AC-003`, `AC-005`): 覆盖 revision schema 拒绝规则、引用完整性的**四类写入路径穷举**（含只改 `skill_id` 的绕过反例）、文件快照不漂移、delivery 失败局部化、冲突分组与消解闭环、跨 Space 引用拒绝。 — verify: `npm test`
- [ ] T022 (`AC-001`, `AC-004`): 覆盖 legacy 组合迁移的逐 Issue 可解析断言、单一 primary Workspace 选取与旧 ref requirements 逐字不变。 — verify: `npm test`
- [ ] T023 (`AC-001`, `AC-005`): 按 §4 事件表逐项触发对应动作并核对落账，缺一即失败。 — verify: `npm test --workspace server`
- [ ] T024 (`AC-001`, `AC-003`): 完成首次设置、项目 / Skill Playwright 旅程。 — verify: `npm run test:e2e`
- [ ] T025 (`AC-001`, `AC-003`): 保持 design 与 tasks 的事实源一致，由 `tools/check-v03-plan-contracts.test.mjs::F013-DOC-R4-INVARIANTS` 锁定五组不变量措辞，改动任一份文档而不同步另一份即门禁变红。 — verify: `npm run test:docs`
- [ ] T026 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`): 按 `migration-matrix.md` 逐行删除 owner 为 F013 的 8 个 transitional-host（P002、P003、P009、A001、A002、A003、A029、A030）并核对 `delete_when`。 — verify: `npm run test:e2e`
- [ ] T027 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`): 运行发布质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

T000→T001→T002→T003；T004→T005→T006/T007；T008 依赖 T003。Phase 2：T010→T011→T012/T013/T014/T015→T016→T019；T017 等待仓库 API（T005/T007），T018 等待 Skill API（T013/T014）。两条 Phase 可在 Space 与共享 ID / version contract 冻结后并行。

**跨 Feature 边界**：T006 与 T016 只交付**只读契约与单测**，不接入派工；`verifyAuthorization` 与 `resolveEffectiveRequirements` 的 Dispatch 侧集成由 F012 拥有并验收（`design.md` §0 / §4）。完成这两个 contract 后 F012 才可实现 eligibility。

## 5. 明确后移

Memory、Skill candidate 和效用移交 v0.4；自动编组推荐移交 v0.6；插件 surface 与 marketplace 移交 v0.8。
