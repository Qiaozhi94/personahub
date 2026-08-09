---
kind: feature
id: F001
version: "0.1"
related_features: []
topics: [project, workspace, issue, thread, sqlite, api, ui, v0.1.0]
doc_kind: tasks
created: 2026-07-12
updated: 2026-08-09
---

# F001：Workspace & Issue Foundation - 任务

> Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 规则

- 任务应当能追踪到 `spec.md` 中的需求 ID。
- 只有当任务修改不同文件且没有顺序依赖时，才标记 `[P]`。
- 标记需求完成前，应先添加或更新对应测试。

## 当前验证状态（2026-07-16）

- 代码实现和 `AC-001` - `AC-010` 行为已完成；`npm run typecheck`、`npm test`、`npm run build` 全部通过。
- Server 自动化测试通过 200 项，Web 自动化测试通过 19 项。
- `web/src/f001-ui-flows.test.tsx` 已覆盖 Project 创建、Workspace 绑定/替换、Issue 创建和 primary Thread 展示的完整 UI 交互；Feature 状态为 `done`。
- 本 feature 不实现 agent execution、Run lifecycle、validation loop、Room、Artifact、Memory 或 Skill 行为。

## Phase 1：项目初始化与存储基础

- [x] T001（`DR-001` - `DR-007`）：按 `design.md` 第 3 节已定的方案（版本化内联 SQL + `schema_version` 表，参考 clowder-ai 模式），实现 `applyMigrations(db)` 启动时迁移函数。
- [x] T002（`DR-001` - `DR-007`, `TR-004`）：新增 Project、Workspace、Issue、Thread、ThreadEvent 以及默认 coding workflow/policy seed data 的初始 SQLite schema（作为 `SCHEMA_V1`）；ThreadEvent 包含持久化 `event_sequence`。
- [x] T003（`NFR-002`）：新增本地启动时应用 migrations 的 database initialization 代码。
- [x] T004（`DR-001` - `DR-007`）：新增 Project、Workspace、Issue、Thread、ThreadEvent、WorkflowTemplate、ValidationPolicy 的 repository interfaces 和 implementations。

## Phase 2：后端领域服务

- [x] T005（`FR-001`, `FR-002`）：实现 Project service，包括 create、list、get/switch context 支持。
- [x] T006（`FR-003`, `FR-004`, `FR-005`, `NFR-003`）：实现 Workspace path validation、path normalize/comparable key 和 best-effort git branch detection。
- [x] T007（`FR-003`, `FR-004`, `FR-005`, `DR-002`）：实现 Workspace binding service，支持等价 path 复用、替换 default Workspace，并保持已有 Issue 的 `workspace_id` 不变。
- [x] T008（`FR-006`, `FR-007`, `FR-008`）：实现 Issue creation service，包括 coding issue type、priority 枚举校验、默认 workflow/policy lookup、初始 status 推导。
- [x] T009（`FR-009`, `DR-006`, `TR-001`, `TR-002`）：实现事务性 Issue + primary Thread + `issue.created` 创建。
- [x] T010（`FR-010`, `TR-003`, `TR-004`）：实现按持久化 `event_sequence` 排序的 Thread 和 ThreadEvent read service，并支持 `after_event_id` 解析到 sequence 后查询。

## Phase 3：后端 API

- [x] T011（`IR-001`）：新增 Project create/list/read API endpoints 或 handlers。
- [x] T012（`IR-002`, `IR-006`）：新增 Project Workspace bind/read API endpoints 或 handlers，并提供按 `workspace_id` 读取历史 Workspace 的 endpoint。
- [x] T013（`IR-003`）：新增 Issue create/list/read API endpoints 或 handlers。
- [x] T014（`IR-004`）：新增 Thread read 和 ThreadEvent list API endpoints 或 handlers。
- [x] T015（`IR-005`）：新增 validation 和 not-found 场景的结构化 API error mapping，包括 `ISSUE_PRIORITY_INVALID` 和 `WORKSPACE_NOT_FOUND`。

## Phase 4：前端 UI

- [x] T016（`UX-001`）：新增 Project list/switcher UI 和 create Project flow。
- [x] T017（`UX-002`, `UX-003`, `NFR-003`）：新增 Workspace binding UI，包含 loading 和 error states。
- [x] T018（`UX-004`, `UX-007`）：新增 coding Issue creation UI，不开放非 coding Issue Types。
- [x] T019（`UX-005`, `FR-009`, `FR-010`）：Issue 创建后导航到或展示 primary Thread。
- [x] T020（`UX-006`）：在 Settings 或 Project Inspector 中展示 Project / Workspace 关系。
- [x] T021（`UX-001` - `UX-007`）：新增 no Project、no Workspace、no Issue selected 的空态。

## Phase 5：测试

- [x] T022 [P]（`FR-001`, `FR-002`）：新增 Project validation 和 service behavior 的单元测试。
- [x] T023 [P]（`FR-003`, `FR-004`, `FR-005`, `NFR-003`）：新增 Workspace path validation、normalize/comparable key 和 git detection wrappers 的单元测试，覆盖 Windows 大小写不敏感比较。
- [x] T024 [P]（`FR-006`, `FR-008`）：新增 Issue priority validation 和 initial status derivation 的单元测试。
- [x] T025 [P]（`TR-001`, `TR-002`, `TR-004`）：新增 `issue.created` payload creation 和 `event_sequence` ordering 的单元测试。
- [x] T026（`DR-001` - `DR-007`, `NFR-002`, `TR-004`）：新增 database initialization 的 migration/integration test，验证默认 workflow/policy seed 记录和 ThreadEvent `event_sequence` 存在。
- [x] T027（`FR-003`, `FR-004`, `FR-005`, `DR-002`, `IR-006`）：新增 Workspace binding 集成测试，覆盖非 git path、等价 path 复用、替换 default Workspace、历史 Workspace 按 id 读取。
- [x] T028（`FR-006` - `FR-010`, `DR-006`, `TR-001` - `TR-004`）：新增 Issue creation transaction、primary Thread creation、event persistence 的集成测试。
- [x] T029（`DR-006`）：新增 failure-path 集成测试，证明部分 Issue 创建会回滚。
- [x] T030（`FR-011`, `NFR-002`）：新增 restart/reopen persistence test，覆盖 Project / Workspace / Issue / Thread / ThreadEvent 关系。
- [x] T031（`UX-001` - `UX-007`）：新增 UI 测试，覆盖 Project 创建、Workspace 绑定/替换、Issue 创建和 primary Thread 展示。

## Phase 6：手动验证与文档

- [x] T032（`NFR-003`）：手动验证带盘符和反斜杠的 Windows absolute paths。
- [x] T033（`NFR-003`）：手动验证 Windows path 大小写不同但指向同一路径时不会重复创建 Workspace。
- [x] T034（`NFR-004`）：手动验证非 git directory Workspace binding。
- [x] T035（`FR-005`）：手动验证 git repository branch detection。
- [x] T036（`AC-001` - `AC-010`）：完整走查 `spec.md` 中的验收清单。
- [x] T037：如果实现 schema 与当前数据模型草案不同，更新 `docs/personahub-system-design.md`。
- [x] T038：当 F001 从 spec 进入 in-progress / review / done 时，更新 `BACKLOG.md` 状态。

## 依赖关系

- Phase 1 阻塞后端 service 实现。
- T005-T010 阻塞依赖这些 services 的 API handlers。
- T011-T015 阻塞前端集成。
- Phase 5 的测试可以在目标 contract 稳定后，与对应实现任务并行推进。

## 备注

- F001 应以稳定本地基础设施结束，不应包含 agent execution。
- F001 不实现 Agent 配置，因此新 Issue 固定保持 `Inbox`；不要为了让 `Ready` 可达而引入 seeded owner agent。
- 如果 migration tooling 选择会影响更广泛的项目约定，需要记录到 `docs/decisions/`。
