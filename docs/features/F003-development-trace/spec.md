---
feature_ids: [F003]
related_features: [F001, F002]
topics: [development-trace, evidence, command-events, file-change-events, handoff, validation-events, markdown-export, v0.1.2]
doc_kind: spec
created: 2026-07-12
updated: 2026-07-12
---

# F003：Development Trace

> Status: draft | Owner: TBD | Target: v0.1.2

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 4.1 节 P0 目标、第 5 节核心概念、第 7 节 workflow / evidence / artifact 相关概念、第 10 节 UI 需求、第 12 节 MVP 验收、第 15 节 v0.1.2 Development Trace。
- **架构来源**：`docs/personahub-architecture.md` 第 4 节事件系统、第 5 节 Workflow / Validation 执行引擎、第 7 节 Artifact 落点、第 8 节扩展性边界。
- **系统设计来源**：`docs/personahub-system-design.md` 中的 ThreadEvent、Run、EvidenceSummary、Artifact、WorkflowTemplate、ValidationPolicy。
- **上游决策**：`docs/decisions/0002-first-agent-adapter.md`、`docs/decisions/0003-backend-runtime.md`。
- **功能类型**：backend / data-model / runtime / workflow / validation / user-facing / docs。
- **规格模式**：full，因为本 feature 第一次把 Run 日志升级为可验证 development trace，并为后续 autonomous validation 与 evidence summary 建立证据基础。
- **变更类型**：ADDED。
- **一句话意图**：让 PersonaHub 能记录一次 coding Run 中发生的命令、测试、文件变更、handoff 和 validation trace，使用户可以复盘 agent 做了什么、凭什么说完成、下一步该交给谁。

## 1. 问题与目标

### 问题

F002 已经让用户可以从 Thread 中启动本地 coding agent，并看到 Run 状态和 stdout/stderr 日志。但仅有日志不足以证明任务可信完成：

- 用户无法快速知道 agent 实际运行了哪些命令。
- 用户无法看出 workspace 中哪些文件发生了变化。
- 用户无法把测试输出、diff、风险提示和 validation finding 作为结构化证据追溯。
- 后续 validator agent 无法基于稳定 evidence refs 接手，只能重新读聊天和原始日志。
- Thread 虽然有 run events，但还没有形成可导出的开发过程记录。

F003 要解决的是“可追踪开发过程”的问题，而不是自动判定完成。自动 validation pass/fail 和 Issue Done 仍由 F004 负责。

### 目标

- 记录 command/test/file-change evidence，并将其挂到 ThreadEvent 或轻量 Artifact 引用上。
- 在 Thread 中展示 handoff events 和 validation events 的结构化 trace。
- 支持 evidence refs 从 ThreadEvent 追溯到 Run、Issue、Workspace 和相关文件。
- 支持将单个 Issue 的 development trace 导出为 Markdown。
- 为 F004 Autonomous Validation 提供 validator 可读取的 evidence 基础。

### 非目标

- 本 feature 不实现自动 Validation Loop，不根据 validation pass/fail 自动把 Issue 置为 Done。
- 本 feature 不实现复杂 Artifact manifest、Room、多阶段 artifact-centered collaboration。
- 本 feature 不实现完整 diff viewer 或代码 review UI。
- 本 feature 不强制拦截所有命令；危险操作 escalation 的运行边界仍以 F002 为准。
- 本 feature 不实现长期 Memory / Skill 写入。

## 2. 用户场景与独立测试

### US1：查看 agent 实际执行过的命令（Priority: P1）

作为用户，我希望在 Thread 中看到 agent run 期间执行过的关键命令，以便判断执行过程是否可信。

**为什么是这个优先级**：command trace 是 development trace 的最小可信切片，也是后续 test evidence 和 validation 的前置。

**独立测试**：使用 FakeAgentAdapter 或可控 adapter 模拟命令事件，验证 Thread 中出现 `command.started` 和 `command.completed`。

**验收场景**：

1. Given 一个 coding Run 正在执行，when agent 执行命令，then 系统写入 `command.started` ThreadEvent。
2. Given 命令执行结束，when 系统收到 exit code 和输出摘要，then 系统写入 `command.completed` ThreadEvent。
3. Given 命令执行失败，when exit code 非 0，then command event 标记失败，并关联到当前 Run。

### US2：记录测试结果证据（Priority: P1）

作为用户，我希望测试、lint、build 等验证命令被识别为 test evidence，以便后续 reviewer 或 validator 可以基于证据判断质量。

**为什么是这个优先级**：PRD 要求 Done 必须有 validation pass + evidence trace；F003 先建立 evidence trace。

**独立测试**：模拟 `npm test` / `pytest` / `cargo test` 等命令事件，验证系统生成 `test.completed` 或等价 evidence event。

**验收场景**：

1. Given agent 执行被识别为测试类的命令，when 命令结束，then 系统写入 test evidence。
2. Given 测试命令 exit code 为 0，when 用户查看 Thread，then UI 展示测试通过摘要。
3. Given 测试命令 exit code 非 0，when 用户查看 Thread，then UI 展示测试失败摘要和失败输出引用。

### US3：查看文件变更 trace（Priority: P1）

作为用户，我希望看到 Run 前后 workspace 中哪些文件发生变化，以便确认 agent 的实际修改范围。

**为什么是这个优先级**：文件变更是 coding workflow 的核心证据，没有它就很难复盘 agent 是否改对地方。

**独立测试**：在测试 workspace 中运行 FakeAgentAdapter 修改文件，验证 Run 完成后生成 `file.changed` 或 `file.change_summary` event。

**验收场景**：

1. Given Run 开始前记录 workspace baseline，when Run 结束，then 系统计算文件变更摘要。
2. Given 文件被新增、修改或删除，when 用户查看 Thread，then UI 展示对应 path 和 change type。
3. Given 文件变更列表过长，when 系统生成摘要，then UI 展示截断提示，并保留完整 evidence 引用或可恢复摘要。

### US4：生成 handoff packet（Priority: P2）

作为后续 agent 或 validator，我希望读取结构化 handoff packet，以便接手时不依赖完整聊天历史。

**为什么是这个优先级**：handoff 是 v0.1 sequential workflow 的关键连接点，但 F003 只记录结构，不自动编排下一步。

**独立测试**：在 Run 完成后生成 handoff packet，验证事件 payload 包含 summary、changed files、evidence refs 和 next suggested action。

**验收场景**：

1. Given Run 已完成，when 系统生成 handoff，then Thread 中写入 `handoff.created`。
2. Given handoff 引用了 evidence，when 用户点击或查询引用，then 可以追溯到对应 command/test/file-change event。
3. Given Run 失败，when 生成 handoff，then handoff 标记当前阻塞点或建议修复方向。

### US5：展示 validation trace 占位事件（Priority: P2）

作为用户，我希望能在 Thread 中看到 validation request、finding 和 result 事件，以便 F004 接入 validator 前 UI 和数据模型已经准备好。

**为什么是这个优先级**：F003 不做自动验证，但需要为 F004 的 validation events 留出稳定 contract。

**独立测试**：通过 API 或测试 helper 写入 validation events，验证 Thread / Inspector 能展示结构化 finding。

**验收场景**：

1. Given 系统或测试 helper 创建 validation request，when Thread 展示事件，then 用户能看到验证目标和 evidence refs。
2. Given validator 产生 finding，when Thread 展示事件，then 用户能看到 severity、message、file refs 和建议。
3. Given validation result 被写入，when 用户查看 Inspector，then UI 能展示 pass/fail/blocked 的结果摘要，但不自动改变 Issue 到 Done。

### US6：导出 Issue Development Trace Markdown（Priority: P2）

作为用户，我希望把一个 Issue 的开发过程导出为 Markdown，以便保存、分享或手动复盘。

**为什么是这个优先级**：Markdown export 是 PRD v0.1.2 明确范围，也是 evidence 可用性的外部验证。

**独立测试**：对包含 run、command、test、file-change、handoff 事件的 Issue 调用导出接口，验证生成 Markdown 包含关键 trace。

**验收场景**：

1. Given Issue 有完整 ThreadEvents，when 用户导出 Markdown，then 文件包含 Issue 信息、Run 列表、命令摘要、测试结果、文件变更和 handoff。
2. Given Issue 没有 test evidence，when 导出 Markdown，then 文档明确显示未记录测试证据。
3. Given 事件中存在被截断日志，when 导出 Markdown，then 文档包含截断提示和可追溯 event id。

## 3. 范围

### 范围内

- command started/completed events。
- test/lint/build command evidence 识别和摘要。
- Run 前后文件变更摘要。
- evidence refs 与 ThreadEvent / Run / Issue 的关联。
- handoff.created 事件和最小 handoff packet。
- validation request/finding/result 事件 contract 和 UI 展示占位。
- Issue development trace Markdown export。
- Thread / Inspector 中的 development trace 展示。

### 范围外

- 自动运行 reviewer / validator agent。
- Validation pass 后 Issue 自动进入 Done。
- Validation fail 后自动创建修复 Run。
- 多 agent sequential executor 的完整编排。
- 完整 Artifact manifest、Room thread、Artifact directory 管理。
- 长期 Memory / Skill candidate 生成。
- GitHub PR / issue export。

### 边界场景

- 如果 adapter 无法提供结构化 command events，系统可以从 run output 中尽力识别，但必须标记 `source = output_inferred`。
- 如果无法可靠识别测试命令，系统仍应保留普通 command event，不得伪造 test passed。
- 如果文件变更检测失败，Run 不应因此被改为 failed；系统应写入 `file.change_scan_failed` 事件。
- 如果导出时事件引用的 evidence 缺失，Markdown 应保留 event id 并标记 evidence missing。
- 如果输出或变更列表过大，系统应截断展示，但保留可追溯摘要和截断说明。

## 4. 需求

### 功能需求

### Requirement: Command Trace（`FR-001`）

系统应当记录 Run 期间执行的关键命令。

#### Scenario: 命令开始和结束

- GIVEN Run 正在执行
- WHEN agent 执行命令
- THEN 系统写入 `command.started`
- WHEN 命令结束
- THEN 系统写入 `command.completed`
- AND payload 包含 command、cwd、exit_code、duration_ms、run_id

### Requirement: Test Evidence（`FR-002`）

系统应当把测试、lint、build 等验证命令识别为 test evidence。

#### Scenario: 测试证据生成

- GIVEN command 被识别为 test/lint/build
- WHEN command completed
- THEN 系统写入 `test.completed`
- AND payload 包含 command_event_id、result、exit_code、summary

### Requirement: File Change Trace（`FR-003`）

系统应当记录 Run 前后 workspace 文件变更摘要。

#### Scenario: 文件变更扫描

- GIVEN Run 即将启动
- WHEN workspace baseline 可读取
- THEN 系统记录 baseline
- WHEN Run 进入终态
- THEN 系统写入 `file.change_summary`
- AND payload 包含 changed_files、added_count、modified_count、deleted_count

### Requirement: Evidence Refs（`FR-004`）

系统应当为 command/test/file-change/handoff/validation 事件提供可追溯 evidence refs。

#### Scenario: Evidence 引用

- GIVEN event 产生结构化证据
- WHEN 系统持久化 ThreadEvent
- THEN ThreadEvent 包含 evidence_refs
- AND evidence refs 可以追溯到 Issue、Thread、Run 和原始 event

### Requirement: Handoff Packet（`FR-005`）

系统应当在 Run 完成或失败后支持生成最小 handoff packet。

#### Scenario: Handoff 创建

- GIVEN Run 已进入终态
- WHEN 系统生成 handoff
- THEN 写入 `handoff.created`
- AND payload 包含 summary、status、changed_files、evidence_refs、next_suggested_action

### Requirement: Validation Event Contract（`FR-006`）

系统应当支持 validation request、finding 和 result 的事件 contract。

#### Scenario: Validation Trace 展示

- GIVEN validation event 被写入 Thread
- WHEN 用户查看 Thread 或 Inspector
- THEN UI 展示 validation 目标、finding、result 和关联 evidence refs
- AND 不自动改变 Issue 到 Done

### Requirement: Markdown Export（`FR-007`）

系统应当支持导出单个 Issue 的 development trace Markdown。

#### Scenario: 导出开发过程

- GIVEN Issue 有 ThreadEvents 和 evidence refs
- WHEN 用户触发 Markdown export
- THEN 系统生成 Markdown
- AND Markdown 包含 Issue 信息、Run 记录、command/test/file-change/handoff/validation 摘要

### Requirement: Trace UI（`FR-008`）

UI 应当在 Thread 和 Inspector 中展示 development trace。

#### Scenario: 用户复盘

- GIVEN Issue 包含 development trace events
- WHEN 用户打开 Thread
- THEN UI 按时间顺序展示关键 trace
- AND Inspector 展示 evidence summary、changed files、test results 和 export action

### 数据 / 实体需求

- **DR-001**：ThreadEvent 应当支持新增 event types：`command.started`、`command.completed`、`test.completed`、`file.change_summary`、`file.change_scan_failed`、`handoff.created`、`validation.requested`、`validation.finding`、`validation.passed`、`validation.failed`、`validation.blocked`。
- **DR-002**：ThreadEvent 的 `evidence_refs` 应当支持引用同 Issue / Thread / Run 下的 command、test、file-change、handoff 和 validation 证据。
- **DR-003**：如实现 Artifact 表，Artifact 应支持 `inline_markdown` / `db_record` / `local_file_path` 中至少一种 P0 可用存储类型。
- **DR-004**：Run 应当能关联 development trace events，并能查询该 Run 产生的 command/test/file-change evidence。
- **DR-005**：File change evidence 至少记录 path、change_type、是否截断；P0 不要求存储完整 diff。
- **DR-006**：Handoff packet 应当绑定 issue_id、thread_id、run_id，并引用 evidence_refs。

### 事件 / Trace 需求

- **TR-001**：命令开始时写入 `command.started`，payload 包含 `run_id`、`command`、`cwd`、`source`。`source` 应为固定枚举：`adapter_structured`（adapter 提供的结构化 command event）、`approval_hook`（来自 escalation 前置拦截钩子观察到的命令）、`runner_observed`（Runner 自己包装/监控到的命令执行）、`output_inferred`（从 stdout/stderr 文本推断），不是自由文本；validator（F004）判断证据可信度时必须能按这个枚举过滤，只有非 `output_inferred` 的证据默认视为 confirmed。
- **TR-002**：命令结束时写入 `command.completed`，payload 包含 `run_id`、`command_event_id`、`exit_code`、`duration_ms`、`summary`。
- **TR-003**：测试类命令结束时写入 `test.completed`，payload 包含 `result`、`test_kind`、`exit_code`、`summary`。
- **TR-004**：Run 终态后写入 `file.change_summary` 或 `file.change_scan_failed`。
- **TR-005**：handoff 生成时写入 `handoff.created`。
- **TR-006**：validation contract 应支持 `validation.requested`、`validation.finding`、`validation.passed`、`validation.failed`、`validation.blocked`。
- **TR-007**：所有 F003 事件 payload 应至少包含 `issue_id`、`thread_id`、`run_id`，不适用 run 的事件必须说明原因。
- **TR-008**：所有 F003 events 应复用 F001/F002 的 ThreadEvent cursor、持久化和 SSE replay 机制。

### API / 接口需求

- **IR-001**：后端应提供查询 Issue development trace 的接口，返回按 cursor 排序的 trace events 和 evidence refs。
- **IR-002**：后端应提供查询单个 Run evidence 的接口。
- **IR-003**：后端应提供导出 Issue trace Markdown 的接口或本地导出 action。
- **IR-004**：非法 Issue / Run / Thread 引用应返回结构化错误。
- **IR-005**：如果 evidence 缺失或已截断，接口响应应显式标记，不应静默丢失。

### UX 需求

- **UX-001**：Thread 应展示 command/test/file-change/handoff/validation events 的可读摘要。
- **UX-002**：Inspector 应展示当前 Issue 的 changed files、test results、handoff 和 evidence refs。
- **UX-003**：UI 应区分 confirmed evidence 和 inferred evidence。
- **UX-004**：UI 应展示 trace 缺失、扫描失败、截断等状态。
- **UX-005**：UI 应提供 Markdown export action。
- **UX-006**：UI 不应把 validation event 展示成自动通过，除非存在明确 `validation.passed`。

### 非功能需求

- **NFR-001**：性能：文件变更扫描和 trace 汇总不应明显阻塞 Thread 事件展示；大输出和大变更列表必须截断或分页。
- **NFR-002**：可靠性：ThreadEvent 仍然是事件真相源，trace 事件必须先持久化再广播。
- **NFR-003**：安全 / escalation 边界：不得把 inferred command/test evidence 当作安全拦截依据；危险操作处理仍遵循 F002 escalation。
- **NFR-004**：本地优先：所有 evidence 和 export 默认保存在本地，不依赖外部云服务。
- **NFR-005**：兼容性：文件路径展示和 export 必须兼容 Windows path；命令识别不应只假设 Unix shell。

## 5. 关键实体 / 概念

- **Development Trace**：围绕一个 Issue / Run 的结构化开发过程记录，包括 command、test、file-change、handoff、validation events。
- **Evidence Ref**：从 ThreadEvent 指向可复核证据的引用，可以指向另一个 event、轻量 Artifact、Run 输出摘要或本地文件路径。
- **Command Evidence**：一次命令执行的结构化摘要，包含命令、cwd、exit code、耗时、输出摘要和来源。
- **Test Evidence**：被识别为测试、lint 或 build 的命令结果，是后续 validation 判断的重要输入。
- **File Change Summary**：Run 前后 workspace 文件变化摘要，P0 只要求 path + change type，不要求完整 diff。
- **Handoff Packet**：一次 Run 结束后提供给后续 agent / validator 的最小交接信息。
- **Validation Trace Event**：validation 相关事件 contract，占位支持 F004 接入自动 validator。

## 6. 状态、工作流或生命周期

F003 不新增 Issue 终态，但补充 Running 后的 trace 生成生命周期：

```text
Run queued/running       -> command events       agent 执行命令
Run running              -> test evidence        command 被识别为 test/lint/build
Run terminal             -> file change summary  Run 完成/失败/取消/中断后扫描 workspace
Run terminal             -> handoff.created      系统生成最小 handoff packet
validation requested     -> validation finding   validator 或测试 helper 写入 finding
validation result event   -> no Issue Done change F003 不自动改变 Issue 到 Done
```

规则：

- command/test/file-change evidence 都必须绑定 Run。
- handoff 必须引用当前 Run 的关键 evidence refs。
- validation events 可以存在，但 F003 不负责自动触发 validator。
- `validation.passed` 在 F003 中只是 trace event，不自动把 Issue 置为 Done。
- 如果文件变更扫描失败，应写入 failure event，而不是隐藏失败。

## 7. 成功标准

- **SC-001**：用户可以从 Thread 中看懂一次 coding Run 做了哪些关键操作。
- **SC-002**：测试结果和文件变更可以作为 evidence refs 被后续 feature 读取。
- **SC-003**：Run 完成后可以生成 handoff packet，供后续 validator / agent 接手。
- **SC-004**：Issue development trace 可以导出为 Markdown。
- **SC-005**：F004 可以在不重做事件模型的前提下接入 Autonomous Validation。

## 8. 验收清单

- [ ] **AC-001**（`FR-001`, `TR-001`, `TR-002`）：Run 期间的命令开始/结束被记录为 ThreadEvent。
- [ ] **AC-002**（`FR-002`, `TR-003`）：测试类命令生成 test evidence，并展示 pass/fail 摘要。
- [ ] **AC-003**（`FR-003`, `TR-004`）：Run 结束后生成文件变更摘要；扫描失败时有明确事件。
- [ ] **AC-004**（`FR-004`, `DR-002`）：evidence refs 可以从 ThreadEvent 追溯到 Issue、Thread、Run 和相关事件。
- [ ] **AC-005**（`FR-005`, `TR-005`）：Run 终态后可以生成 `handoff.created`，并包含 evidence refs。
- [ ] **AC-006**（`FR-006`, `TR-006`, `UX-006`）：validation events 可以展示，但不会自动改变 Issue 到 Done。
- [ ] **AC-007**（`FR-007`, `UX-005`）：Issue development trace 可以导出 Markdown。
- [ ] **AC-008**（`FR-008`, `UX-001` - `UX-004`）：Thread / Inspector 可以展示 trace 摘要、截断状态和 inferred/confirmed 区分。
- [ ] **AC-009**（`NFR-001`）：大输出或大量文件变更不会导致 UI 明显卡死。
- [ ] **AC-010**（`NFR-002`）：断线重连后 trace events 可通过 ThreadEvent cursor 重读。

## 9. 测试计划

### 单元测试

- Command event payload builder。
- Test command 识别规则。
- File change summary builder。
- Evidence refs resolver。
- Handoff packet builder。
- Markdown export renderer。

### 集成测试

- FakeAgentAdapter 产生 command/test events，并写入 ThreadEvent。
- Run 修改测试 workspace 文件后生成 file change summary。
- evidence refs 查询可以解析到源事件。
- validation events 写入后可被 Thread 查询。
- Markdown export 包含完整 trace 摘要。

### UI / 端到端测试

- Thread 中展示 command/test/file-change/handoff events。
- Inspector 展示 changed files 和 test results。
- validation finding 在 UI 中以非 Done gate 形式展示。
- 用户触发 Markdown export 并看到生成结果。

### 手动验证

- Windows path 文件变更展示。
- 非 git workspace 的 file change scan。
- 大量文件变更的截断展示。
- 测试命令失败时的 evidence 展示。
- Markdown export 的可读性和可复盘性。

## 10. 依赖

### 上游依赖

- F001 已完成 Project / Workspace / Issue / Thread / ThreadEvent 基础。
- F002 已完成 Run lifecycle、ThreadEvent event stream、workspace lock、adapter dispatch。
- F002 已确定 ThreadEvent cursor 和 run output truncation 策略。

### 下游依赖

- F004 Autonomous Validation 依赖 F003 的 test evidence、handoff 和 validation event contract。
- v0.3 Artifact-Centered Collaboration 依赖 F003 的 evidence refs 和 artifact 引用边界。
- Evidence Summary / Markdown export 后续可扩展为 Done summary。

### 外部 / 环境依赖

- 本地 filesystem 访问。
- 可选 git，用于更准确的 file change summary；没有 git 时应使用 fallback scan。
- 首个 coding adapter 是否能提供结构化 command events；如不能，需要 output inference 或 runner-level command wrapper。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| CLI 无结构化 command event | command trace 只能从日志推断，可信度下降 | evidence 标记 `source = inferred`，不伪装成 confirmed |
| 文件变更扫描成本高 | 大仓库 Run 结束后卡顿 | P0 优先 git diff/status；非 git 使用文件 mtime scan 并设置数量上限 |
| 测试命令识别误判 | 错把普通命令当验证证据 | 使用保守规则；不确定时仅记录 command，不生成 test evidence |
| Evidence refs 设计过重 | F003 变成完整 artifact 系统 | P0 只做轻量 refs 和可选 inline/db artifact，不做 manifest |
| Markdown export 内容过长 | 导出不可读 | 按 Run / Evidence 分组，长日志只放摘要和 event id |
| validation events 被误解为 Done gate | 用户以为 F003 已自动验证 | UI 文案和状态机明确：F003 只展示 trace，不自动 Done |

## 12. 待确认问题

- **Q1**：Command trace 的主要来源是 adapter structured event，还是从 stdout/stderr 推断？  
  **推荐**：优先 adapter structured event；没有能力时允许 inferred trace，但必须显式标记来源。

- **Q2**：File change summary 是否强依赖 git？  
  **推荐**：git workspace 使用 git status/diff summary；非 git workspace 使用 fallback scan，但只提供 path + change type 的保守摘要。

- **Q3**：F003 是否创建 Artifact 表？  
  **推荐**：如果 F001/F002 已有 Artifact 基础，则复用；否则先用 ThreadEvent.evidence_refs + inline/db record 轻量实现，不阻塞完整 Artifact manifest 到 v0.3。

- **Q4**：Markdown export 是写入本地文件还是返回内容？  
  **推荐**：P0 先由后端生成 Markdown 内容并由 UI 触发下载/保存；是否落本地文件由具体应用壳能力决定。

## 13. 可追踪性

| 规格项 | 来源 | 验证方式 |
| --- | --- | --- |
| `FR-001`, `TR-001`, `TR-002` | PRD v0.1.2 Development Trace、MVP run evidence | `AC-001`，command event tests |
| `FR-002`, `TR-003` | PRD Done 需要 validation pass + evidence trace | `AC-002`，test evidence tests |
| `FR-003`, `TR-004` | PRD file changes / command / test evidence 记录 | `AC-003`，file change scan tests |
| `FR-004`, `DR-002` | 架构第 7 节 artifact/evidence 引用边界 | `AC-004`，evidence resolver tests |
| `FR-005`, `TR-005` | PRD Thread 承载 handoff | `AC-005`，handoff tests |
| `FR-006`, `TR-006` | PRD Thread 展示 validation events / findings | `AC-006`，validation event UI tests |
| `FR-007` | PRD v0.1.2 Markdown export | `AC-007`，export tests |
| `NFR-002` | 架构第 4 节 ThreadEvent 真相源与 replay | `AC-010`，cursor replay tests |

## 14. 实现备注

- F003 应尽量复用 F002 的 ThreadEvent 写库再广播机制，不新增第二套事件通道。
- F003 的 validation events 是 contract，不是 F004 的自动 validator 执行。
- F003 的 handoff packet 是最小交接数据，不要求实现完整 sequential workflow executor。
- evidence refs 设计要避免绑定单一存储形态，为 v0.3 Artifact manifest 留扩展点。
- file change summary P0 不要求完整 diff；完整 diff viewer 可以后置。
- 不引入 multica 风格的 "sidecar manifest"（管理临时运行产物清理的 manifest 文件）：`clowder-multica-source-reference.md` 提到过这个概念，但它属于 v0.3 Artifact-Centered Collaboration 的范围，F003 的非目标已经明确"不实现复杂 Artifact manifest"，现在引入会直接违反这条边界，留到 v0.3 一并设计。

## 15. 参考

- GitHub Spec Kit `spec-template.md`：用户场景、独立测试、功能需求、关键实体、可衡量结果。
- Kiro 风格 SDD 流程：requirements -> design -> tasks。
- Specification by Example / BDD：用 Given/When/Then 场景作为共享、可测试需求。
