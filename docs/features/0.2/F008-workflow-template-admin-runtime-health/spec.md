---
feature_ids: [F008]
related_features: [F004, F005, F007]
topics: [workflow-template, admin-ui, runtime-health, observability, v0.2]
doc_kind: spec
created: 2026-08-01
updated: 2026-08-01
---

# F008：Workflow Template Admin & Runtime Health

> Status: ready-for-development | Owner: TBD | Target: v0.2

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 15 节 v0.2 范围中的 "Workflow Template 管理 UI 初版" 与 "Runtime health check"。
- **相关**：F004 的 validation 依赖 `steps_json`；F007 的推荐依赖模板的 active 版本。
- **功能类型**：user-facing / admin / observability。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：让用户能看懂并安全地改动 workflow 模板，并能一眼看出运行时现在是否健康。

## 1. 问题与目标

### 问题

- `WorkflowTemplateRepository` 目前**只有 `getDefault()` 和 `getById()`**，没有任何写方法；模板只能靠 schema 种子数据存在，用户看不到也改不了。
- `steps_json` 决定 validation 要不要跑（`validator-selector.ts` 的 `hasValidationStep()`），但这个事实对用户完全不可见。
- 运行时状态分散在多处——adapter 可用性、workspace 锁、排队 Run、后台 probe、schema 版本——出问题时没有一个地方能看出"现在卡在哪"。

### 目标

- 用户可以查看模板内容，理解每个字段的实际作用（尤其是"哪些改动会关掉验证"）。
- 模板改动以**新版本**形式落地，进行中的 Issue 不受影响。
- 提供一个只读的 runtime health 视图，覆盖 adapter、workspace 锁、Run 队列、后台任务、schema 版本。

### 非目标

- 不做可视化流程编辑器/拖拽画布。
- 不做模板的导入导出、跨 Project 共享。
- 不做告警、通知、指标持久化与历史趋势。
- 不做自动修复（health 视图只诊断，不代为操作）。

## 2. 用户场景与独立测试

### US1：看懂模板（Priority: P1）

作为用户，我希望看到当前 workflow 模板的步骤与含义，以便知道系统为什么会在实现后触发验证。

**独立测试**：查询模板详情，断言返回步骤列表、各步骤角色，以及 `validation_enabled` 这一由 `hasValidationStep()` 推导的显式布尔投影。

### US2：安全地改模板（Priority: P1）

作为用户，我希望改模板时不会影响正在跑的 Issue，也不会在无意中关掉验证。

**独立测试**：对已被某个进行中 Issue 引用的模板发起编辑，断言原版本行未被修改、新版本以更高 `version` 落库，且该 Issue 的 `workflow_template_id` 仍指向原版本。

**验收场景**：

1. Given 编辑内容移除了 validator 步骤，when 提交，then 必须带显式确认标记，否则拒绝并说明"该改动将关闭新 Issue 的验证"。
2. Given 停用当前唯一的 active 模板，when 提交，then 拒绝——否则 `IssueService.create()` 会因取不到默认模板而失败。

### US3：一眼看出运行时是否健康（Priority: P2）

作为用户，我希望有一个页面显示当前运行时状态，以便判断"卡住了"是系统问题还是我的问题。

**独立测试**：构造一个持锁的 workspace 与两个排队 Run，断言 health 响应正确报告锁持有者、锁持续时长与队列深度。

## 3. 范围

### 范围内

- 模板只读查询 + 版本化写入（新增版本、停用版本）。
- `validation_enabled` 等派生投影与风险提示。
- Runtime health 只读聚合接口与视图。
- 模板管理 UI 与 health UI。

### 范围外

- 流程可视化编辑、模板共享、指标历史。
- Validation Policy 的编辑（本 feature 只读展示其关联）。
- 自动修复动作。

### 边界场景

- 模板被进行中 Issue 引用时的编辑与停用。
- `steps_json` 非法或为 NULL（`parseWorkflowSteps` 已定义 `invalid_steps_json` 错误）。
- 停用最后一个 active 模板。
- health 采集期间某个后台 probe 正在运行。

## 4. 初始需求边界

- **FR-001**：模板详情应返回步骤列表与 `validation_enabled` 派生字段，后者必须由 `hasValidationStep()` 同源推导，不得另写一套判断。
- **FR-002**：模板编辑一律创建新版本；已存在的版本行不可变。
- **FR-003**：进行中 Issue 的 `workflow_template_id` 不因编辑而改变。
- **FR-004**：移除 validator 步骤必须要求显式确认，并在响应与事件中记录该确认。
- **FR-005**：不得停用最后一个 active 模板。
- **FR-006**：health 接口只读，不得触发 probe、不得获取锁、不得修改任何状态。
- **TR-001**：health 应覆盖 adapter effective 可用性、workspace 锁（含持有者与持续时长）、Run 队列深度、进行中后台任务、schema 版本。

## 5. 成功标准

- **SC-001**：用户能从 UI 判断当前模板是否启用验证，以及改动会带来什么后果。
- **SC-002**：模板编辑不影响进行中的 Issue，由测试证明。
- **SC-003**：health 视图能定位"卡住"的直接原因（锁被谁持有、队列多深、哪个 adapter 不可用）。

## 6. 验收清单

- [ ] **AC-001**（`FR-001`）：`validation_enabled` 与 `hasValidationStep()` 同源。
- [ ] **AC-002**（`FR-002`、`FR-003`）：版本不可变；进行中 Issue 不受影响。
- [ ] **AC-003**（`FR-004`、`FR-005`）：关闭验证需显式确认；最后一个 active 模板不可停用。
- [ ] **AC-004**（`FR-006`、`TR-001`）：health 只读且覆盖五类状态。
- [ ] **AC-005**：F001-F007 全量回归通过。

## 7. 待确认问题（全部已关闭，2026-08-01）

- **Q1**（已关闭 → `design.md` 第 3 节）：模板编辑用原地修改还是版本化？版本化，行不可变。
- **Q2**（已关闭 → `design.md` 第 4 节）：`getDefault()` 的选取规则会不会让新版本悄悄接管？会，因此新增版本必须显式声明是否设为 active。
- **Q3**（已关闭 → `design.md` 第 5 节）：health 采集哪些状态、从哪里读？五类，全部来自既有仓储的只读查询。

## 8. 实现备注

- 本 feature 是 v0.2 的收尾项，建议在 F006、F007 之后实施。
- 模板编辑的破坏面集中在 `steps_json`——它是 validation 是否启用的唯一开关，UI 必须把这一点讲明白，而不是当成一个普通 JSON 字段。
