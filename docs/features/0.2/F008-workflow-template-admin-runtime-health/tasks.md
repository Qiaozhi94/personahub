---
feature_ids: [F008]
related_features: [F004, F005, F007]
topics: [workflow-template, admin-ui, runtime-health, observability]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-01
---

# F008：Workflow Template Admin & Runtime Health - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：模板读取与派生投影（FR-001）

- [ ] T009：新建 `server/src/db/schema-v10.ts` 的 `admin_audit_events` 表 + `migrations.ts` 分支 + 迁移测试。版本号按实际落地顺序取，**不得追加进已应用版本**（`design.md` 第 7 节）。
- [ ] T010：`WorkflowTemplateRepository` 补 `listByIssueType(issueType)` 与 `listVersions(issueType)`。
- [ ] T011：`WorkflowTemplateAdminService.detail(id)`——步骤列表 + `validation_enabled`，**复用 `parseWorkflowSteps()` / `hasValidationStep()`**，禁止另写解析（AC-001）。
- [ ] T012：`steps_json` 非法时返回 `validation_enabled: null` + 解析错误信息，详情请求本身不失败（`design.md` 第 6 节）。
- [ ] T013：同源性回归测试——构造若干 `steps_json`，断言 admin 投影与 `validator-selector` 判断逐个一致。

## Phase 2：版本化写入（FR-002、FR-003、FR-005）

- [ ] T020：`insertVersion({..., activate})`——新 id、`version = max+1`；**从不 UPDATE 既有行的内容字段**。
- [ ] T021：`activate: true` 时在同一事务内停用同 issue_type 的其他 active 版本，避免出现两个 active（`design.md` 第 4 节）。
- [ ] T022：不可变性测试——编辑被进行中 Issue 引用的模板后，断言原行内容逐字段未变、该 Issue 的 `workflow_template_id` 未变（AC-002）。
- [ ] T023：`activate(id)` / `deactivate(id)` 两个命令**取代通用 `setStatus()`**；`deactivate` 拒绝停用最后一个 active 模板，断言错误是明确的用户级拒绝而非 `IssueService.create()` 的 `INTERNAL_ERROR`（AC-003）。
- [ ] T023b：单 active 不变量测试——`activate()` 旧版本、两次 `activate()` 不同版本、`activate()` 与 `insertVersion({activate:true})` 交错，断言任一时刻同 `issue_type` 至多一个 active 行（`design.md` 第 4 节；初稿的通用 `setStatus` 会造出两个 active）。
- [ ] T023c：`activate()` 硬拒绝 `steps_json` 为 NULL / 非法 / 未知 step 版本 / 未知 role，错误码 `TEMPLATE_STEPS_INVALID`；inactive 草稿仍允许保存非法内容（`design.md` 第 6 节）。
- [ ] T024：`getDefault()` 行为回归——新增 inactive 版本不改变默认模板；`activate` 后才改变。

## Phase 3：破坏性改动闸门（FR-004）

- [ ] T030：启用移除了 validator 步骤的版本时要求 `acknowledge_validation_disabled: true`，否则 400 + 后果说明。
- [ ] T030b：源或目标 `steps_json` 非法导致无法可靠计算验证开关变化时，**一律拒绝启用**，不得当作"未关闭验证"放行（`design.md` 第 6 节）。
- [ ] T031：写操作记入 `admin_audit_events`（action / target / version / `acknowledge_validation_disabled` / 前后 `validation_enabled` / 时间）。**`actor_id` 恒为 NULL**——本应用无鉴权，审计回答"何时对哪个版本做了什么、确认了什么"，不回答"是谁"（`design.md` 第 7 节）。
- [ ] T032：端到端断言——关闭验证的模板启用后，新建 Issue 的实现 Run 完成时确实不再触发验证（与 F004 行为一致，不是只改了个标志位）。

## Phase 4：Runtime Health（FR-006、TR-001）

- [ ] T040：`RuntimeHealthService.collect(projectId, workspaceId?)`——五类状态的只读聚合（`design.md` 第 5 节表格）。
- [ ] T040b：`AdapterConfigService.healthSnapshot()` 与 `RunDispatchService.healthSnapshot()` 两个只读快照访问器；**不得暴露 Set 的可变引用**（它们参与 shutdown 等待）。`AdapterFailureReprobe` 是 `RunDispatchService` 的私有字段，只给它自己加访问器够不着（`design.md` 第 5 节）。
- [ ] T041：`stale_lock` 分级——持有者缺失/终态 → `stale_lock_confirmed`（**不看时长**，与 `cleanupStaleLocks()` 的实际行为一致）；running 且超时长+宽限 → `stale_lock_suspected`。附持有者 run id、`locked_at`、已持有时长。
- [ ] T041b：`queue_starved` 复用与 drain **共享的无副作用资格判定器**，分报 `eligible_but_not_running` / `waiting_for_recovery` / `waiting_for_validation_due` / `invalid_queued_run`；只有存在当前合格的 queued Run 且锁空闲才标 `queue_starved`。
- [ ] T041c：误报回归测试——F006 的 Issue `Blocked` 保留图节点排队、validation 未到 due time 两种正常状态，断言**不被**标为 `queue_starved`。
- [ ] T041d：`no_available_adapter` 判断 + 各条判断的建议动作文案。
- [ ] T042：只读性测试——调用 health 后断言无 probe 被触发、无锁被获取、无任何表被写入（AC-004）。
- [ ] T043：`GET /api/projects/:projectId/health/runtime?workspace_id=`，zod 边界校验 + Project 归属校验；非法/跨 Project `workspace_id` → `WORKSPACE_NOT_FOUND`（`design.md` 第 5b 节）。

## Phase 5：UI

- [ ] T050：模板列表与版本历史面板。
- [ ] T051：模板详情——步骤、`validation_enabled` 显著展示，讲清 `steps_json` 是验证开关而非普通字段。
- [ ] T052：保存与启用拆成两个动作；启用时提示影响范围（`design.md` 第 4 节）。
- [ ] T053：关闭验证的二次确认对话框。
- [ ] T054：Health 面板——五类状态 + 三条派生判断 + 建议动作。

## Phase 6：验收

- [ ] T060：US1-US3 独立测试通过。
- [ ] T061：F001-F007 全量回归（AC-005）。
- [ ] T062：门禁——`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`；新增文件纳入 Prettier format targets。
- [ ] T063：回写 `spec.md` 验收清单与 `BACKLOG.md` 状态。

## 依赖关系

- Phase 1 → Phase 2 → Phase 3 顺序执行；Phase 4 与前三者独立，可并行。
- Phase 5 依赖 Phase 1-4 的接口。
- 建议整体排在 F006、F007 之后实施（`spec.md` 第 8 节）。

## 备注

- `workflow_templates` 本身无变更（`version` / `status` 列已存在），但新增 `admin_audit_events` 表——初稿"无 schema 变更"因 FR-004 的审计载体需要而修正。
- 模板编辑的破坏面集中在 `steps_json`——它是 validation 是否启用的唯一开关。
- 模板管理与 health 的 API 契约见 `design.md` 第 8、5b 节；HTTP 任务按其错误码矩阵实现。
