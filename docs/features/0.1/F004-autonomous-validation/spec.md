---
feature_ids: [F004]
related_features: [F001, F002, F003]
topics: [autonomous-validation, validator-agent, validation-loop, evidence-summary, issue-status, workflow, v0.1.3]
doc_kind: spec
created: 2026-07-12
updated: 2026-07-18
---

# F004：Autonomous Validation

> Status: ready-for-development | Owner: TBD | Target: v0.1.3

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 4.1 节 P0 目标、第 7.5 节 Agent Validation Loop、第 7.6 节 Evidence Summary、第 9 节 Issue 状态机、第 10 节 UI 需求、第 11 节自动化与安全边界、第 12 节 MVP 验收、第 15 节 v0.1.3 Autonomous Validation。
- **架构来源**：`docs/personahub-architecture.md` 第 4 节事件系统、第 5 节 Workflow / Validation 执行引擎、第 7 节 Artifact 落点、第 9 节执行权限模型。
- **系统设计来源**：`docs/personahub-system-design.md` 中的 Issue、Run、ThreadEvent、ValidationPolicy、EvidenceSummary、Artifact。
- **上游决策**：`docs/decisions/0002-first-agent-adapter.md`、`docs/decisions/0003-backend-runtime.md`。
- **功能类型**：backend / runtime / workflow / validation / user-facing / data-model。
- **规格模式**：full，因为本 feature 完成 v0.1 coding workflow 的端到端闭环，涉及 Issue 状态机、validator agent、validation loop、evidence summary 和失败收敛。
- **变更类型**：ADDED。
- **一句话意图**：让 PersonaHub 在 implementation Run 完成后自动进入 validator 检查，基于 evidence trace 输出 pass/fail，并驱动 Issue 到 Done、Running 或 Blocked。

## 1. 问题与目标

### 问题

F001-F003 已经建立了 Project/Issue/Thread、agent Run、run events 和 development trace，但用户仍然要人工判断“这件事到底完成了吗”。这会让 PersonaHub 退回到普通 agent runner：

- Agent 可以声称完成，但没有自动 validator 检查。
- 测试、文件变更、handoff 和 evidence refs 没有被用于自动决策。
- Issue 无法从 `Running` 自动推进到 `Validating` 和 `Done`。
- Validation fail 后没有结构化 findings 回流，用户仍需手动组织下一轮修复。
- 多轮验证无法收敛时，如果不自动 Blocked，系统可能无限循环。

F004 要完成 v0.1 的最小可信闭环：实现完成后自动验证，验证通过后 Done，验证失败后带 findings 回流，本次失败计入后达到上限即 Blocked。

### 目标

- 在 implementation Run 完成后自动触发 validator Run。
- 将 Issue 状态从 `Running` 推进到 `Validating`。
- Validator 基于 F003 evidence refs 和 handoff packet 输出结构化 findings。
- Validation pass 时，Issue 自动进入 `Done`，并生成 Evidence Summary。
- Validation fail 时，Issue 回到 `Running`，findings 成为下一轮修复输入。
- 本次失败计入后达到 `max_validation_rounds`，或证据不足无法自行补齐时，Issue 进入 `Blocked`。
- UI 在 Thread / Inspector 中展示 validation result、findings、round count 和 Done evidence summary。

### 非目标

- 本 feature 不实现 v0.2 Coordinator Agent 自动选 workflow / topology / agent roster。
- 本 feature 不实现 v0.3 Room、复杂 Artifact manifest 或 artifact-centered collaboration。
- 本 feature 不实现 v0.5 validator capability / trust scoring；validator 仍来自 Coding Workflow Template 的固定角色。
- 本 feature 不实现跨多个 validator 的 parallel_validation。
- 本 feature 不自动写入长期 Memory 或 Skill candidate。
- 本 feature 不要求所有真实 CLI 都具备 validator 能力；只有能提供可靠 final agent message 的 adapter 才可作为 validator。Validator 结果只接受约定的严格 JSON envelope（允许外包一层单独的 `json` fence），不从普通日志、command output 或自由 Markdown 推断结论；无法取得或解析时必须 Blocked。

## 2. 用户场景与独立测试

### US1：实现完成后自动进入验证（Priority: P1）

作为用户，我希望 implementation Run 完成后系统自动启动 reviewer / validator，而不是让我手动判断是否完成。

**为什么是这个优先级**：这是从 agent runner 变成可信 workflow 的最小跃迁。

**独立测试**：使用 FakeAgentAdapter 模拟 implementation Run completed，验证 Issue 进入 `Validating`，并创建 validator Run。

**验收场景**：

1. Given Issue 处于 `Running` 且 implementation Run `completed`，when workflow engine 处理终态，then Issue 进入 `Validating`。
2. Given validation policy 和 validator agent 可用，when Issue 进入 `Validating`，then 系统创建 validator Run。
3. Given validator agent 不可用，when 需要进入验证，then Issue 进入 `Blocked`，并写入 blocker。

### US2：验证通过后自动 Done（Priority: P1）

作为用户，我希望 validator 通过后 Issue 自动进入 Done，并带有证据摘要。

**为什么是这个优先级**：PRD 明确 Done 必须绑定 validation pass + evidence trace。

**独立测试**：模拟 validator 输出 pass，验证 `validation.passed`、Evidence Summary 和 Issue `Done`。

**验收场景**：

1. Given validator 输出 pass，when validation result 被解析，then 系统写入 `validation.passed`。
2. Given validation pass 且 evidence refs 存在，when 系统完成验证，then Issue 进入 `Done`。
3. Given Issue 进入 Done，when 用户查看 Inspector，then UI 展示 Done evidence summary。

### US3：验证失败后 findings 回流（Priority: P1）

作为用户，我希望 validator 失败时系统给出结构化 findings，并让下一轮修复能读取这些 findings。

**为什么是这个优先级**：没有 fail 回流，自动验证只会变成一次性 gate，不能形成闭环。

**独立测试**：模拟 validator 输出 fail findings，验证 Issue 回到 `Running` 或可重新运行状态，findings 写入 Thread，并进入下一轮 Run 输入。

**验收场景**：

1. Given validator 输出 fail，when validation result 被解析，then 系统写入 `validation.failed` 和至少一条 `validation.finding`。
2. Given validation failed，when 本次失败计入后仍低于最大轮数，then Issue 回到 `Running`，并允许创建下一轮修复 Run。
3. Given 下一轮修复 Run 被创建，when adapter input 被组装，then validation findings 被包含为修复上下文。

### US4：多轮验证不收敛后 Blocked（Priority: P1）

作为用户，我希望系统不要无限循环修复和验证，而是在失败次数达到上限时明确阻塞并提示我介入。

**为什么是这个优先级**：失败收敛是 PRD 的安全边界，不是体验优化。

**独立测试**：设置 `max_validation_rounds = 2`，连续模拟两次 validation fail；每次 fail 先计入 round count，第二次计入后达到上限并验证 Issue 进入 `Blocked`。

**验收场景**：

1. Given 本次 fail 计入后的 `validation_round_count` 达到 `max_validation_rounds`，when 系统提交该结果，then Issue 进入 `Blocked`。
2. Given Issue 进入 Blocked，when 用户查看 Inspector，then UI 展示 blocked reason 和最近 findings。
3. Given Issue 已 Blocked，when 系统有 queued 自动修复动作，then 不应继续自动执行。

### US5：证据不足时阻塞而不是伪通过（Priority: P2）

作为用户，我希望缺少测试、文件变更或 evidence refs 时系统不要假装完成。

**为什么是这个优先级**：可信度比“看起来自动完成”更重要。

**独立测试**：模拟 validator 输出 evidence_missing 或无法找到 test evidence，验证 Issue Blocked 或 validation failed。

**验收场景**：

1. Given validation policy 要求 test evidence，when Issue 没有 test evidence，then validator 不得输出可信 pass。
2. Given 证据不足且 agent 无法自行补齐，when validation 结束，then Issue 进入 `Blocked` 或 validation failed。
3. Given Issue 被 Blocked，when Thread 展示 blocker，then 用户能看到缺少哪些证据。

### US6：处理同源验证标记（Priority: P2）

作为用户，我希望如果 implementation agent 和 validator 使用完全相同 provider/model，系统如实标记同源验证。

**为什么是这个优先级**：PRD 要求避免伪装跨模型独立验证，但 P0 可能只有一个 CLI adapter。

**独立测试**：配置 implementation 和 validator 使用同一 provider/model，验证 Done summary 标记 `same_origin_validation = true`。

**验收场景**：

1. Given implementation agent 和 validator agent 的 `cli_provider` 与 `default_model` 完全一致，when validation passed，then Evidence Summary 标记同源验证。
2. Given 至少 provider 或 model 不同，when validation passed，then Evidence Summary 标记为独立性满足最低要求。
3. Given 同源验证，when UI 展示 Done summary，then 不把它展示成跨模型独立验证。

## 3. 范围

### 范围内

- Coding Workflow 的最小 sequential validation loop。
- Validator agent / reviewer role 的配置读取和可用性校验。
- Implementation Run completed 后自动触发 validator Run。
- Issue 状态流转：`Running -> Validating -> Done / Running / Blocked`。
- ValidationPolicy 的 `max_validation_rounds` 生效。
- validator 输出结构化 pass/fail/blocked/finding。
- Evidence Summary 生成和展示。
- Validation findings 回流到下一轮修复上下文。
- 同源验证标记。
- Thread / Inspector 中 validation result、findings、round count、Done summary 展示。

### 范围外

- 自动 issue creation / workflow recommendation / coordinator orchestration。
- 多 validator 并行验证。
- Room / Artifact manifest / research-synthesis-implementation-validation 多阶段房间。
- AgentOps metrics、validator trust scoring、历史成功率。
- Memory / Skill candidate 自动写入。
- GitHub PR review 或外部 CI 集成。
- 完整权限审批 UI；Blocked 恢复只定义最小操作。

### 边界场景

- 如果 validator Run 失败退出，Issue 应进入 `Blocked` 或保持 `Validating` 后转 Blocked，不得 Done。
- 如果 validator 输出无法解析，系统应写入 `validation.blocked`，并提示输出解析失败。
- 如果 evidence refs 缺失，系统不得把 Issue 自动置 Done。
- 如果 validation fail 计入后仍低于上限，系统可回到 `Running`，但不得自动无限创建 Run；下一轮修复是否自动启动由 design 决定，P0 推荐需要用户确认或明确 action。
- 如果 Issue 已 Done，不应再自动触发 validation。
- 如果 Issue 已 Blocked，必须由 operator 显式处理后回到 `Ready`，不会自动回到 Running。
- 如果同一 Issue 的旧 implementation Run 仍在排队，但 Issue 已因另一条 implementation 完成而进入 `Validating`，queue drain 必须取消该 stale Run 并继续查找下一条 eligible Run，不得在 `Validating` 状态启动它。

## 4. 需求

### 功能需求

### Requirement: 自动触发 Validator Run（`FR-001`）

当 implementation Run 正常完成时，系统应当根据 Coding Workflow Template 和 Validation Policy 自动触发 validator Run。

#### Scenario: Implementation 完成

- GIVEN Issue 处于 `Running`
- AND implementation Run 进入 `completed`
- WHEN workflow engine 处理该 Run
- THEN Issue 状态变为 `Validating`
- AND 系统创建 validator Run

### Requirement: Validator 输入组装（`FR-002`）

系统应当为 validator Run 组装包含 goal、handoff、changed files、test evidence 和 prior findings 的上下文。

#### Scenario: Validator context

- GIVEN Issue 有 F003 development trace
- AND validator Run 明确绑定一个 `implementation_run_id`
- WHEN validator Run 被创建
- THEN adapter input 包含 Issue goal，以及该 `implementation_run_id` 对应的 handoff、evidence refs、file change summary、test results
- AND 不得因后续 consult Run 产生了更新的 handoff 而改变被验证对象

### Requirement: Validation Result 解析（`FR-003`）

系统应当解析 validator 输出为结构化 validation result。

#### Scenario: 解析 pass/fail

- GIVEN validator Run 输出结果
- WHEN 系统解析 validation result
- THEN 得到 `passed` / `failed` / `blocked`
- AND findings 包含 severity、message、evidence_refs、optional file refs
- AND result 同时包含有界的 `key_decisions` 与 `lessons_candidate` 数组（允许为空），供 Done Evidence Summary 确定性生成

### Requirement: Validation Pass To Done（`FR-004`）

Validation pass 且 evidence trace 存在时，系统应当将 Issue 置为 Done。

#### Scenario: 通过验证

- GIVEN validation result 是 `passed`
- AND evidence refs 满足 ValidationPolicy 最低要求
- WHEN 系统提交 validation 结果
- THEN 写入 `validation.passed`
- AND 创建 Evidence Summary
- AND Issue 状态变为 `Done`

### Requirement: Validation Fail 回流（`FR-005`）

Validation fail 且本次 fail 计入后仍低于轮次上限时，系统应当把 findings 回流为下一轮修复输入。

#### Scenario: 失败回流

- GIVEN validation result 是 `failed`
- AND 本次 fail 计入后的 validation_round_count 仍低于上限
- WHEN 系统提交 validation 结果
- THEN 写入 `validation.failed` 和 `validation.finding`
- AND Issue 状态回到 `Running`
- AND 下一轮修复上下文包含 findings

### Requirement: Validation Round Limit（`FR-006`）

系统应当在本次 validation fail 计入后使 `validation_round_count >= max_validation_rounds` 时将 Issue 置为 Blocked；默认 `max_validation_rounds=3` 表示第三次 failed 直接 Blocked，不允许第四次。

#### Scenario: 多轮不收敛

- GIVEN 本次 validation fail 计入后 validation_round_count 达到 ValidationPolicy 上限
- WHEN 系统提交该次失败
- THEN 系统写入 `validation.blocked`
- AND Issue 状态变为 `Blocked`
- AND 不再自动启动下一轮 Run

### Requirement: Evidence Summary（`FR-007`）

系统应当为 Done Issue 生成 Evidence Summary。

#### Scenario: Done summary

- GIVEN Issue validation passed
- WHEN Issue 进入 Done
- THEN 系统创建 Evidence Summary
- AND summary 包含 goal、final result、implementation summary、key decisions、commands/tests、changed files、handoff、validation result、lessons candidate、双方 identity、same_origin_validation 与 policy snapshot 标记

### Requirement: Same-Origin Validation 标记（`FR-008`）

系统应当识别 implementation agent 和 validator agent 是否同源。

#### Scenario: 同源验证

- GIVEN implementation agent 和 validator agent 的 cli_provider 与 default_model 完全一致
- WHEN validation passed
- THEN Evidence Summary 标记 `same_origin_validation = true`
- AND UI 明确展示该结果

### Requirement: Blocked 恢复到 Ready（`FR-009`）

系统应当支持 operator 处理 validation blocker 后将 Issue 从 Blocked 恢复到 Ready，并要求 operator 说明处理原因。

#### Scenario: Operator 处理 blocker

- GIVEN Issue 因 validation blocked
- WHEN operator 标记 blocker 已处理，并提供 `operator_note`
- THEN 系统写入 `issue.unblocked`，payload 包含 `operator_note`
- AND Issue 状态变为 `Ready`
- AND 系统不会自动恢复 Running

#### Scenario: 缺少处理说明

- GIVEN Issue 因 validation blocked
- WHEN operator 尝试恢复但未提供 `operator_note`
- THEN 系统拒绝请求并返回结构化错误

### Requirement: Validation UI（`FR-010`）

UI 应当展示 validation 状态、findings、round count、blocker 和 Done evidence summary。

#### Scenario: 用户查看验证结果

- GIVEN Issue 有 validation events
- WHEN 用户打开 Thread 或 Inspector
- THEN UI 展示当前 validation status、findings、round count、evidence refs 和 summary

### 数据 / 实体需求

- **DR-001**：Issue 应当持久化 `validation_round_count`，并在 validation fail 回流时递增。
- **DR-002**：ValidationPolicy 应当提供 `max_validation_rounds`，P0 默认值为 `3`。
- **DR-003**：Run 应当能区分 implementation Run 和 validator Run，至少通过 role / purpose / adapter_config_id / workflow_step 表达；role/workflow step/dispatch source 必须由服务端按创建路径派生，客户端不能伪造。每个新 Run 在创建时固化不含凭据的 adapter identity snapshot（config id/name/provider/model），后续配置修改不得改变历史 same-origin 判定。
- **DR-004**：EvidenceSummary 应当绑定 `issue_id`、`thread_id`、`validation_result`、`evidence_refs`、`summary_markdown`、`same_origin_validation`、implementation/validator identity snapshot、`policy_id`、`policy_version`、当轮 policy snapshot/hash、`created_at`。Summary 内容覆盖 PRD 的 goal、final result、implementation summary、key decisions、commands/tests、changed artifacts、validation result、lessons candidate。缺少 identity/policy snapshot 会让以后复盘“这次 Done 是按哪套 policy、哪两个实际 Run identity 判的”变得不可追溯。
- **DR-005**：ThreadEvent 应当支持 `validation.requested`、`validation.finding`、`validation.passed`、`validation.failed`、`validation.blocked`、`issue.done`、`issue.unblocked`。
- **DR-006**：Blocked reason 应当持久化，至少能从 Issue 或 latest blocker event 查询。

### 事件 / Trace 需求

- **TR-001**：Issue 进入 Validating 时，系统应写入 `validation.requested`。
- **TR-002**：validator 输出 finding 时，系统应写入 `validation.finding`，payload 包含 severity、message、evidence_refs、optional file refs。
- **TR-003**：validation pass 时，系统应写入 `validation.passed`。
- **TR-004**：validation fail 时，系统应写入 `validation.failed`。
- **TR-005**：validation 因轮次上限、证据不足或输出无法解析而阻塞时，系统应写入 `validation.blocked`。
- **TR-006**：Issue 进入 Done 时，系统应写入 `issue.done`，payload 引用 Evidence Summary。
- **TR-007**：Issue 从 Blocked 恢复到 Ready 时，系统应写入 `issue.unblocked`，payload 必须包含 operator 提供的 `operator_note`（恢复原因），不允许为空。
- **TR-008**：所有 validation events 应复用 F001/F002 的 ThreadEvent cursor、持久化和 SSE replay 机制。

Validation event 的执行来源和证据目标必须分开表达：`validator_run_id` 标识产生判断的 Run，`implementation_run_id` 标识被验证对象；implementation evidence refs 必须按后者做 Run scope 校验，不能以 validator Run scope 校验，也不能为兼容两者而取消 Run scope。

### API / 接口需求

- **IR-001**：后端应提供读取 Issue validation status / round count / latest result 的接口。
- **IR-002**：后端应提供读取 Evidence Summary 的接口。
- **IR-003**：后端应提供处理 validation blocker 并将 Issue 恢复到 Ready 的接口；请求必须包含非空 `operator_note`，缺失时拒绝请求。
- **IR-004**：后端应提供触发或重试 validation 的接口；是否允许用户手动触发由 design 明确。
- **IR-005**：非法状态转换应返回结构化错误：Done Issue 不允许重验或创建新 Run；Validating Issue 不允许用户创建普通 implementation Run；Blocked Issue 未处理前不允许继续执行。公开 Run 创建请求不得接受或伪造 validator role、workflow step、validation round、dispatch source。

### UX 需求

- **UX-001**：Thread 应展示 validation requested / finding / passed / failed / blocked / done events。
- **UX-002**：Inspector 应展示 Issue 当前 validation status、round count、max rounds、latest findings。
- **UX-003**：Done Issue 应展示 Evidence Summary。
- **UX-004**：Blocked Issue 应展示 blocker reason 和 operator action。
- **UX-005**：UI 应区分独立验证与同源验证。
- **UX-006**：UI 不应在 evidence 缺失或 validation blocked 时展示 Done。

### 非功能需求

- **NFR-001**：可靠性：Issue 状态更新、validation event、Evidence Summary 创建必须保持事务一致性。
- **NFR-002**：安全 / escalation 边界：本次 fail 计入后达到 validation round limit、证据不足无法补齐、validator 不可用时必须 Blocked，不得无限循环。
- **NFR-003**：可追溯性：Done 必须能追溯到 validation.passed、Evidence Summary、创建 Run 时固化的双方 adapter identity，以及 request 时固化的 policy snapshot/hash。
- **NFR-004**：本地优先：validation 和 evidence summary 默认本地持久化，不依赖外部云服务。
- **NFR-005**：兼容性：validator context 和 findings 中的 file refs 必须兼容 Windows path。

## 5. 关键实体 / 概念

- **Validator Agent**：Coding Workflow Template 中固定声明的 reviewer / validator 角色。v0.1 不允许任意 Agent 通过 capability 自行成为 validator。
- **Validation Run**：用于验证 implementation result 的 agent Run，绑定同一个 Issue / Thread / Workspace。
- **Validation Result**：validator final message 中唯一、严格的 JSON envelope，最小 outcome 为 `passed` / `failed` / `blocked`，并携带 findings、key decisions 和 lessons candidate；不得从自由 Markdown 或混合输出猜测。
- **Validation Finding**：validator 输出的问题项，包含 severity、message、evidence refs 和可选 file refs。
- **Validation Round**：一次 implementation -> validation 的验证轮次。validation fail 回流会增加 `validation_round_count`。
- **Evidence Summary**：Done Issue 的确定性证据摘要，汇总 goal、final/implementation/validation result、key decisions、测试与关键命令、文件变更、handoff、lessons candidate、双方 identity、policy snapshot 和同源验证标记。
- **Same-Origin Validation**：implementation agent 和 validator agent 的 provider/model 完全一致时的验证独立性标记。

## 6. 状态、工作流或生命周期

F004 落地 v0.1 coding workflow 的状态闭环：

```text
Running    -> Validating  implementation Run completed
Validating -> Done        validation passed + evidence trace exists
Validating -> Running     validation failed + round count below max
Validating -> Blocked     本次 fail 计入后达到 max rounds / evidence missing / validator unavailable / result unparsable
Blocked    -> Ready       operator handled blocker
```

规则：

- Issue 进入 `Validating` 前必须有 completed implementation Run。
- Validation pass 必须绑定 evidence refs；没有 evidence 不得 Done。
- Validation fail 回流时递增 `validation_round_count`。
- 本次 fail 计入后 `validation_round_count >= max_validation_rounds` 即进入 Blocked。
- Done 是终态；F004 不定义 Done 后重新打开。
- Blocked 不是终态，但只能由 operator action 回到 Ready。
- F004 P0 推荐不自动启动下一轮修复 Run，而是将 findings 放入上下文并等待用户触发，避免无人值守无限循环。

## 7. 成功标准

- **SC-001**：一个 coding Issue 可以从 implementation Run 完成自动进入 validation。
- **SC-002**：Validation pass 后 Issue 自动 Done，并生成 Evidence Summary。
- **SC-003**：Validation fail 后 findings 可见，并能作为下一轮修复输入。
- **SC-004**：多轮不收敛时 Issue 自动 Blocked，不会无限循环。
- **SC-005**：用户可以从 Thread / Inspector 追溯 Done 的证据链。

## 8. 验收清单

- [ ] **AC-001**（`FR-001`, `TR-001`）：implementation Run completed 后自动创建 validator Run，Issue 进入 `Validating`。
- [ ] **AC-002**（`FR-002`, `DR-003`）：validator Run 输入包含 goal，以及其目标 `implementation_run_id` 对应的 handoff、evidence refs、changed files、test results；后续其他 Run 的 handoff 不得串入。
- [ ] **AC-003**（`FR-003`, `TR-002`）：validator final message 的 strict JSON 被解析为 result、findings、key decisions 与 lessons candidate；自由 Markdown、混合 output 和非法 envelope 必须 Blocked。
- [ ] **AC-004**（`FR-004`, `FR-007`, `TR-003`, `TR-006`, `DR-004`）：validation pass 后 Issue 进入 `Done`，创建覆盖 PRD 内容的 Evidence Summary，并包含双方 Run identity snapshot 与当轮 policy snapshot/hash。
- [ ] **AC-005**（`FR-005`, `TR-004`）：validation fail 后写入 findings，Issue 回到 `Running`，下一轮上下文包含 findings。
- [ ] **AC-006**（`FR-006`, `TR-005`, `NFR-002`）：本次 fail 计入后达到 max validation rounds 时 Issue 立即进入 `Blocked`（默认第三次），不再自动执行。
- [ ] **AC-007**（`FR-008`, `UX-005`）：同源验证被识别并展示。
- [ ] **AC-008**（`FR-009`, `TR-007`, `IR-003`）：operator 处理 blocker 后 Issue 从 `Blocked` 回到 `Ready`，不会自动 Running；`issue.unblocked` 必须包含非空 `operator_note`，缺失时请求被拒绝。
- [ ] **AC-009**（`FR-010`, `UX-001` - `UX-004`）：Thread / Inspector 展示 validation events、findings、round count、blocker 和 Done summary。
- [ ] **AC-010**（`NFR-001`, `NFR-003`, `IR-005`）：Issue 状态、validation events、Evidence Summary 保持事务一致且可追溯；Done/Validating/Blocked 的公开 Run 创建护栏和系统字段防伪有效。

## 9. 测试计划

### 单元测试

- ValidationPolicy round limit 判定。
- Validation result parser。
- Validation finding payload builder。
- Evidence Summary builder。
- Same-origin validation checker。
- Issue status transition guard。

### 集成测试

- Fake implementation Run completed 后触发 fake validator Run。
- validator pass -> validation.passed -> Evidence Summary -> Issue Done。
- validator fail -> findings -> Issue Running -> round count 增加。
- 本次 fail 计入后达到 max rounds -> validation.blocked -> Issue Blocked。
- validator unavailable / unparsable output -> Issue Blocked。
- operator unblock -> Issue Ready。

### UI / 端到端测试

- Thread 中展示 validation requested / finding / passed / failed / blocked / done。
- Inspector 展示 validation status、round count、evidence summary。
- Same-origin validation 展示。
- Blocked Issue 的 operator action。

### 手动验证

- 一个真实小型 coding Issue 从实现、验证到 Done。
- 一个故意失败测试的 Issue 进入 validation failed，并回流 findings。
- 一个在本次 fail 计入后达到 max rounds 的 Issue 自动 Blocked。
- 缺少 test evidence 时不得 Done。

## 10. 依赖

### 上游依赖

- F001 已完成 Project / Workspace / Issue / Thread / ThreadEvent 基础。
- F002 已完成 Run lifecycle、adapter dispatch、workspace lock 和 event stream。
- F003 已完成 command/test/file-change evidence、handoff、validation event contract、evidence refs。
- Coding Workflow Template 和 ValidationPolicy 至少提供 validator role 和 `max_validation_rounds`。

### 下游依赖

- v0.2 Coordinator Workflow 可基于 F004 的 validation loop 做 workflow recommendation。
- v0.3 Artifact-Centered Collaboration 可将 Evidence Summary 扩展为 artifact-backed summary。
- v0.5 AgentOps & Evaluation 可基于 validation outcome、round count 和 blocker reason 做 metrics。
- v0.6 Skill Compounding 可从 Done Issue 和 Evidence Summary 提取 skill candidates。

### 外部 / 环境依赖

- 至少一个可用 coding CLI adapter。
- P0 若要满足 validator 独立性，建议同一 provider 下配置不同 default_model；无法满足时必须标记同源验证。
- 本地 filesystem / workspace evidence 可读取。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| validator 输出不稳定 | result 解析失败，状态机卡住 | 要求 strict final-message JSON contract；解析失败进入 Blocked，原始 final message 仅保留在内部 Run 记录并禁止通过公共 API/evidence payload 暴露 |
| validation 自动循环失控 | agent 反复修复/验证消耗资源 | `max_validation_rounds` 强制 Blocked；P0 不自动启动下一轮修复 Run |
| 同源验证可信度不足 | Done 看起来比实际更可信 | Evidence Summary 标记 `same_origin_validation`，UI 如实展示 |
| evidence 缺失仍 Done | 破坏 PRD 可信度底线 | Done 前强制检查 evidence refs；缺失则 blocked/failed |
| 状态和事件不一致 | UI 看到 Done 但没有 validation event | 状态更新、event、summary 使用事务或可恢复补偿 |
| validator 不可用 | Issue 卡在 Validating | 明确转 Blocked，提示配置 validator |

## 12. 待确认问题

目前没有遗留的开放问题，以下四项均已关闭：

- **Q1（已关闭）**：只接受严格 final-message JSON（可外包单一 `json` fence），解析失败必须 Blocked，不采纳 clowder-ai 更宽松的自由 Markdown/正则做法——它成立的前提是“始终有人或 agent 在读原始文本兜底解读”，而 F004 的自动 Done/Blocked 判定不能依赖该假设，见 `FR-003`。
- **Q2（已关闭）**：维持 validation fail 后不自动重跑、等待用户触发的现有设计；multica 的 `attempt`/`max_attempts` 重试机制被证实只覆盖基础设施类失败（进程崩溃、超时、runtime 离线），代码注释明确把 agent 自身错误排除在自动重试之外（"real problems the user should see, not infrastructure flakiness"），人工 rerun 还会强制重置 session 避免复现同样的坏状态——与本 feature"不自动开下一轮"的立场一致，见"状态、工作流或生命周期"一节。
- **Q3（已关闭）**：P0 允许同 provider 不同 `default_model`，无法满足时标记同源验证；F005 引入 Claude Code / OpenCode 后可以配置真正跨 provider 的 validator，届时应优先使用真实跨 provider 而非同源 fallback，见 `FR-008`。
- **Q4（已关闭）**：Evidence Summary 复用 F003 的 evidence 数据、escaping/截断约定和 Markdown 风格，但由独立 deterministic builder 生成并作为 Done Issue 的结构化记录持久化，不直接调用 F003 export 的私有 renderer；内容覆盖 PRD 第 7.6 节，见 `DR-004`。

## 13. 可追踪性

| 规格项 | 来源 | 验证方式 |
| --- | --- | --- |
| `FR-001`, `TR-001` | PRD v0.1.3 Autonomous Validation、状态机 Running -> Validating | `AC-001`，workflow integration tests |
| `FR-002`, `FR-003` | PRD Agent Validation Loop、F003 evidence refs | `AC-002`, `AC-003`，validator context/parser tests |
| `FR-004`, `FR-007` | PRD Validation pass -> Done、Evidence Summary | `AC-004`，Done summary tests |
| `FR-005` | PRD Validation fail -> Running，findings 回流 | `AC-005`，fail feedback tests |
| `FR-006`, `NFR-002` | PRD max_validation_rounds 和安全边界 | `AC-006`，round limit tests |
| `FR-008` | PRD validator 独立性 / 同源验证 | `AC-007`，same-origin tests |
| `FR-009` | PRD Blocked -> Ready operator escalation | `AC-008`，unblock tests |
| `TR-002` - `TR-008` | 架构 ThreadEvent 真相源 | `AC-009`, `AC-010`，event replay tests |

## 14. 实现备注

- F004 是 v0.1 闭环收束点，应优先保证状态机正确，而不是追求复杂 validator 智能。
- Validation 是 Thread 内事件和 workflow step，不要做成独立一级产品模块。
- Done 必须同时具备 `validation.passed` 和 Evidence Summary。
- Blocked 恢复必须由 operator action 触发，不自动回到 Running。
- F004 不应提前引入 v0.5 的 trust scoring，只做同源验证标记。
- 同源验证是**允许并如实标记**，不是**禁止**：`clowder-multica-source-reference.md` 曾建议参考 clowder-ai `reviewer-matcher.ts` 的"禁止自审"逻辑改成强制禁止同源验证，但这与 PRD 第 7.5 节的既有判断冲突——P0 阶段大概率只有一个 CLI adapter，强制要求 validator 使用不同 provider 会让单 adapter 场景无法验证任何 Issue。保留现状（同 provider 不同 `default_model` 视为满足最低独立性要求，完全同源则标记 `same_origin_validation`），不采纳"禁止"这条建议。

## 15. 参考

- GitHub Spec Kit `spec-template.md`：用户场景、独立测试、功能需求、关键实体、可衡量结果。
- Kiro 风格 SDD 流程：requirements -> design -> tasks。
- Specification by Example / BDD：用 Given/When/Then 场景作为共享、可测试需求。
