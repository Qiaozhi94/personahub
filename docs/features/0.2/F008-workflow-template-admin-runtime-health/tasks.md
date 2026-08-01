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

- [ ] T010：`WorkflowTemplateRepository` 补 `listByIssueType(issueType)` 与 `listVersions(issueType)`。
- [ ] T011：`WorkflowTemplateAdminService.detail(id)`——步骤列表 + `validation_enabled`，**复用 `parseWorkflowSteps()` / `hasValidationStep()`**，禁止另写解析（AC-001）。
- [ ] T012：`steps_json` 非法时返回 `validation_enabled: null` + 解析错误信息，详情请求本身不失败（`design.md` 第 6 节）。
- [ ] T013：同源性回归测试——构造若干 `steps_json`，断言 admin 投影与 `validator-selector` 判断逐个一致。

## Phase 2：版本化写入（FR-002、FR-003、FR-005）

- [ ] T020：`insertVersion({..., activate})`——新 id、`version = max+1`；**从不 UPDATE 既有行的内容字段**。
- [ ] T021：`activate: true` 时在同一事务内停用同 issue_type 的其他 active 版本，避免出现两个 active（`design.md` 第 4 节）。
- [ ] T022：不可变性测试——编辑被进行中 Issue 引用的模板后，断言原行内容逐字段未变、该 Issue 的 `workflow_template_id` 未变（AC-002）。
- [ ] T023：`setStatus()` + 拒绝停用最后一个 active 模板；断言错误是明确的用户级拒绝，而非 `IssueService.create()` 的 `INTERNAL_ERROR`（AC-003）。
- [ ] T024：`getDefault()` 行为回归——新增 inactive 版本不改变默认模板；`activate` 后才改变。

## Phase 3：破坏性改动闸门（FR-004）

- [ ] T030：移除 validator 步骤时要求 `acknowledge_validation_disabled: true`，否则 400 + 后果说明。
- [ ] T031：确认值写入审计事件，可事后追溯是谁在什么时候关掉了验证。
- [ ] T032：端到端断言——关闭验证的模板启用后，新建 Issue 的实现 Run 完成时确实不再触发验证（与 F004 行为一致，不是只改了个标志位）。

## Phase 4：Runtime Health（FR-006、TR-001）

- [ ] T040：`RuntimeHealthService.collect(projectId)`——五类状态的只读聚合（`design.md` 第 5 节表格）。
- [ ] T041：三条派生判断——`stale_lock_suspected`、`queue_starved`、`no_available_adapter`，各附建议动作。
- [ ] T042：只读性测试——调用 health 后断言无 probe 被触发、无锁被获取、无任何表被写入（AC-004）。
- [ ] T043：`GET /api/health/runtime`，zod 边界校验。

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

- 无 schema 变更；`workflow_templates` 的 `version` / `status` 列已存在。
- 模板编辑的破坏面集中在 `steps_json`——它是 validation 是否启用的唯一开关。
