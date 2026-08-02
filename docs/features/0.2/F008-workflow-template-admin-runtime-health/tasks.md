---
feature_ids: [F008]
related_features: [F004, F005, F007]
topics: [workflow-template, admin-ui, runtime-health, observability]
doc_kind: tasks
created: 2026-08-01
updated: 2026-08-02
---

# F008：Workflow Template Admin & Runtime Health - 任务

> Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：模板读取与派生投影（FR-001）

- [ ] T009：新建 `server/src/db/schema-v10.ts`——`admin_audit_events` 表 + `idx_workflow_templates_issue_type_version` / `idx_workflow_templates_one_active` 两个唯一索引 + `migrations.ts` 分支 + 迁移测试。版本号按实际落地顺序取，**不得追加进已应用版本**（`design.md` 第 4、7 节）。
- [ ] T010：`WorkflowTemplateRepository` 补 `listByIssueType(issueType)` 与 `listVersions(issueType)`。
- [ ] T011：`WorkflowTemplateAdminService.detail(id)`——步骤列表 + `validation_enabled`，**复用 `parseWorkflowSteps()` / `hasValidationStep()`**，禁止另写解析（AC-001）。
- [ ] T012：`steps_json` 非法时返回 `validation_enabled: null` + 解析错误信息，详情请求本身不失败（`design.md` 第 6 节）。
- [ ] T013：同源性回归测试——构造若干 `steps_json`，断言 admin 投影与 `validator-selector` 判断逐个一致。

## Phase 2：版本化写入（FR-002、FR-003、FR-005）

- [ ] T020：`insertVersion(sourceId, {..., activate})`——新 id、`version = max+1`（**与 INSERT 同一事务**）；**从不 UPDATE 既有行的内容字段**。请求体只接受 `name` / `steps_json`，其余内容字段出现即 400 `TEMPLATE_FIELD_NOT_EDITABLE`。**`issue_type` 与四个不可编辑字段一律取自 `sourceId` 那一行**，路由为 `POST /api/workflow-templates/:sourceId/versions`——全局路由没有来源标识，多版本并存时服务端无从判断在改哪一行（`design.md` 第 8 节）。
- [ ] T020b：并发建草稿测试——两个请求同时算 `max+1`，断言唯一索引拦下重复版本号且映射为用户级错误/重试，不逃逸成 500。
- [ ] T020c：不可编辑字段回归——断言 `collaboration_topology`、`validation_policy_id`、`handoff_policy_json`、`evidence_requirements_json` 在 v0.2 无运行时消费者，UI 标注"不影响运行时行为"（AC-008）。
- [ ] T021：`activate: true` 时在同一事务内停用同 issue_type 的其他 active 版本，避免出现两个 active（`design.md` 第 4 节）。
- [ ] T022：不可变性测试——编辑被进行中 Issue 引用的模板后，断言原行内容逐字段未变、该 Issue 的 `workflow_template_id` 未变（AC-002）。
- [ ] T023：`activate(id)` / `deactivate(id)` 两个命令**取代通用 `setStatus()`**；`deactivate` 拒绝停用最后一个 active 模板，断言错误是明确的用户级拒绝而非 `IssueService.create()` 的 `INTERNAL_ERROR`（AC-003）。
- [ ] T023b：单 active 不变量测试——`activate()` 旧版本、两次 `activate()` 不同版本、`activate()` 与 `insertVersion({activate:true})` 交错，断言任一时刻同 `issue_type` 至多一个 active 行（`design.md` 第 4 节；初稿的通用 `setStatus` 会造出两个 active）。
- [ ] T023c：新增**严格**校验器 `validateStepsSchema()`——拒绝不支持的 `schema_version`、未知 role、畸形/空 steps、重复 step id、非预期字段。**不得用 `parseWorkflowSteps()` 充当写入闸门**：它忽略 `schema_version`、接受任意 role、且静默过滤畸形条目（`validator-selector.ts:25-58`），会把部分损坏内容洗成合法内容。运行时解释路径继续用宽松的 `parseWorkflowSteps()`，一字不改（`design.md` 第 6 节）。
- [ ] T023d：`activate()` 硬拒绝目标 `steps_json` 为 NULL / 非法；inactive 草稿仍允许保存非法内容。每一类拒绝各一条测试。
- [ ] T023e：**源版本非法的逃生口**——当前 active 模板非法时，允许启用一个合法的修复版本，但要求 `acknowledge_validation_disabled: true` 且审计里前值记为 `unknown`。断言用户不会被永久锁在一个已损坏的默认模板上（`design.md` 第 6 节）。
- [ ] T024：`getDefault()` 行为回归——新增 inactive 版本不改变默认模板；`activate` 后才改变。

## Phase 3：破坏性改动闸门（FR-004）

- [ ] T030：启用移除了 validator 步骤的版本时要求 `acknowledge_validation_disabled: true`，否则 400 + 后果说明。
- [ ] T030b：启用闸门按 `design.md` 第 6 节的**四行矩阵**实现，不得简化为"非法一律拒绝"（那会与 T023e 直接冲突，并重新造出"当前模板已损坏就永远修不好"的死锁）。**表中的"源"一律指事务内读取的当前 active 版本，不是 `:sourceId` 继承来源**：
  - 目标非法 / 为 NULL → **拒绝**（无条件）
  - 当前 active 合法、目标关闭了验证 → 要求 `acknowledge_validation_disabled`
  - 当前 active 非法、目标合法 → 要求 `acknowledge_validation_disabled`，审计前值记 `unknown`，**允许启用**
  - 两者均非法 → 拒绝（被第一行覆盖）
- [ ] T030c：`inheritanceSource` 与 `currentlyActive` 分离测试——当前 active v3 有 validator，从无 validator 的 inactive v1 克隆出 v4 并激活，断言**仍然要求 `acknowledge_validation_disabled`**。按 `sourceId` 比较会认为"没变化"从而绕过本 feature 最重要的确认闸门（`design.md` 第 6 节）。
- [ ] T030d：激活事务内**重新读取**当前 active 行，不复用请求发起时的快照；两个并发激活各自基于最新前值判断。
- [ ] T031：写操作记入 `admin_audit_events`（action / target / version / `acknowledge_validation_disabled` / 前后 `validation_enabled` / 时间），**与模板变更同一事务**。**`actor_id` 恒为 NULL**——本应用无鉴权，审计回答"何时对哪个版本做了什么、确认了什么"，不回答"是谁"（`design.md` 第 7 节）。
- [ ] T031b：审计原子性测试——对审计插入注入失败，断言模板变更一并回滚；不存在"验证被关掉但没有审计记录"的状态（FR-004 把审计列为正确性要求）。
- [ ] T032：端到端断言——关闭验证的模板启用后，新建 Issue 的实现 Run 完成时确实不再触发验证（与 F004 行为一致，不是只改了个标志位）。

## Phase 4：Runtime Health（FR-006、TR-001）

- [ ] T040：`RuntimeHealthService.collect(projectId, workspaceId?)`——五类状态的只读聚合，响应形状按 `design.md` 第 5b 节：**adapter 挂在 workspace 分组下**（有效状态本就是 workspace 级的，扁平化会让聚合视图对可路由性说谎），schema 同时给出 `actual_version` / `expected_version` / `status`。
- [ ] T040d：`schema_version_mismatch` 诊断——`behind`（迁移没跑）与 `ahead`（库被更新版本的程序打开过）都要报出。
- [ ] T040e：workspace 覆盖回归——同一 adapter 在 workspace A 可用、B 不可用时，断言聚合响应里两者各自呈现，不被合并成一个状态（F005 核心不变量）。
- [ ] T040b：`AdapterConfigService.healthSnapshot()` 与 `RunDispatchService.healthSnapshot()` 两个只读快照访问器；**不得暴露 Set 的可变引用**（它们参与 shutdown 等待）。`AdapterFailureReprobe` 是 `RunDispatchService` 的私有字段，只给它自己加访问器够不着（`design.md` 第 5 节）。
- [ ] T041：`stale_lock` 分级——持有者缺失/终态 → `stale_lock_confirmed`（**不看时长**，与 `cleanupStaleLocks()` 的实际行为一致）；running 且持有时长 **严格大于** `DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS`（后者新增，60 秒）→ `stale_lock_suspected`。**另加一条断言测试：全部 v0.2 adapter 的 `capabilities.executionTimeoutMs` 均等于 `DEFAULT_EXECUTION_TIMEOUT_MS`**——实际超时是 per-adapter 的（`agent-runner.ts:107`），该断言是 health 能安全使用默认值的前提，不能只在文档里声称同源；`locked_at` 为空或晚于当前时间 → 归入 confirmed 并注明时间戳异常。附持有者 run id、`locked_at`、已持有时长。测试覆盖阈值前 1 毫秒、恰等于、超过、`locked_at` 非法四类。
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
- [ ] T054：Health 面板——五类状态 + **对 `RuntimeHealthSnapshot.diagnostics.code` 判别联合穷尽渲染**（当前 9 个取值），每个 code 各有建议动作文案与至少一条 UI 测试。用 `assertNever` 兜底，保证将来新增 code 时**编译期**报漏项。旧表述"三条派生判断"已不成立——DTO 里 stale lock 两类、queue 四类、外加 adapter 与 schema，按三类验收会让其余 code 落进空白 UI。

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
