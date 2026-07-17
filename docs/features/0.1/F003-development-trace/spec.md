---
feature_ids: [F003]
related_features: [F001, F002, F004, F005]
topics: [development-trace, evidence, command-events, file-change-events, handoff, validation-events, markdown-export, v0.1.2]
doc_kind: spec
created: 2026-07-12
updated: 2026-07-17
---

# F003：Development Trace

> Status: ready-for-development | Owner: TBD | Target: v0.1.2

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 5 节 Handoff Packet / Trace Events、第 7.3-7.6 节 Agent 执行 / Handoff / Validation / Evidence Summary、第 10 节 UI、第 15 节 v0.1.2。
- **架构来源**：`docs/personahub-architecture.md` 第 3-8 节 Adapter、事件、Workflow、存储、Artifact 和前端边界。
- **已实现基线**：F001/F002 当前代码已具备 SQLite `ThreadEvent`、`evidence_refs`、Run lifecycle、Codex `app-server` JSON-RPC adapter、先持久化再 SSE 广播、基于 `event_sequence` 的 Thread 内排序与 replay，以及三栏 UI。
- **功能类型**：backend / data-model / runtime / user-facing / docs。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：把一次 coding Run 的命令、验证命令、文件变更和交接结果沉淀为可追溯、可查询、可导出的 development trace，为 F004 自动验证和 F005 跨 agent 接力提供稳定证据。

## 1. 问题与目标

### 问题

F002 已允许用户从 primary Thread 启动 Codex Run，并查看状态和日志；但日志是面向实时观察的文本流，不是可复核的证据模型：

- 看不出 agent 具体执行了哪些命令、命令是否成功。
- 测试、lint、typecheck、build 结果无法被 validator 稳定消费。
- workspace 在一轮 Run 中实际新增、修改、删除了哪些文件没有可恢复记录。
- 下一位 agent 只能重新阅读原始日志，缺少结构化 handoff。
- Issue 的执行过程不能以稳定格式导出复盘。

### 目标

- 从 adapter 的结构化协议事件记录 command evidence，并保留来源和可信度。
- 保守识别 test/lint/typecheck/build 命令，生成 verification evidence；无法确认时不伪造通过结果。
- 对所有实际进入 `running` 的 Run 记录前后文件状态，终态后生成可分页的文件变更证据。
- 自动生成最小 Handoff Packet，引用本 Run 的关键 evidence。
- 预先稳定 F004 所需的 validation event contract 和 UI 展示。
- 提供 Issue trace、Run evidence 查询和 Markdown 导出。
- 保持 ThreadEvent 为事件真相源，并复用 F002 的 SSE/replay 机制。

### 非目标

- 不自动启动 validator，不执行 Validation Loop，不因 validation event 改变 Issue 状态；这些属于 F004。
- 不实现完整 diff viewer、逐行 patch 存储或代码 review UI。
- 不实现完整 Artifact manifest、Room 或 artifact directory；这些属于 v0.3。
- 不实现多 agent 自动/手动路由；F003 只准备 handoff 数据，路由属于 F004/F005。
- 不从任意 stdout/stderr 文本猜测命令并把它当作 confirmed evidence。
- 不改变 F002 的凭据隔离、approval 和 escalation 安全边界。
- 不生成 Evidence Summary，不写入长期 Memory / Skill。

## 2. 用户场景与独立测试

### US1：查看 agent 实际执行的命令（Priority: P1）

作为用户，我希望在 Thread 中看到 agent 执行过的结构化命令及结果，以判断过程是否可信。

**独立测试**：FakeAgentAdapter 发出一对结构化 command started/completed 信号，验证 ThreadEvent 的顺序、关联和 UI 摘要。

**验收场景**：

1. Given Run 正在执行且 adapter 发出结构化命令开始信号，when 系统接收该信号，then 写入 `command.started`，并关联当前 Issue、Thread、Run 和 adapter item。
2. Given 已有对应的 `command.started`，when adapter 发出命令结束信号，then 写入 `command.completed`，包含 outcome、exit code（可得时）、耗时和输出摘要。
3. Given 命令失败或被拦截，when 命令结束，then UI 明确展示 failed/blocked/unknown，不把它显示为成功。
4. Given adapter 没有结构化 command 能力，when Run 执行，then Run 仍可完成，但 trace 明确显示 command evidence unavailable，不从普通日志伪造命令。

### US2：记录验证命令证据（Priority: P1）

作为用户或后续 validator，我希望测试、lint、typecheck、build 的结果可被稳定查询和引用。

**独立测试**：以 Windows/Unix 常见命令样例测试分类器，并验证只有已完成且可保守分类的 command 才生成 `test.completed`。

**验收场景**：

1. Given command 被保守识别为 test/lint/typecheck/build，when command completed，then 系统写入 `test.completed` 并引用对应 `command.completed`。
2. Given exit code 为 0，when 用户查看 trace，then result 展示为 `passed`。
3. Given exit code 非 0，when 用户查看 trace，then result 展示为 `failed`，并可追溯到命令和可用输出。
4. Given 命令分类或退出结果无法确认，when 系统处理该命令，then 不生成虚假的 passed evidence；必要时 result 为 `unknown`。

### US3：查看本轮文件变更（Priority: P1）

作为用户，我希望知道一轮 Run 相对其启动时 baseline 实际改变了哪些文件。

**独立测试**：在临时 git workspace 和非 git workspace 中分别新增、修改、删除文件，验证终态证据和分页查询。

**验收场景**：

1. Given Run 已取得 workspace 锁但尚未启动 adapter，when baseline 可读取，then 系统持久化 baseline。
2. Given Run 曾进入 `running`，when Run 进入 completed/failed/cancelled/interrupted，then 系统在释放锁前生成 `file.change_summary` 或 `file.change_scan_failed`。
3. Given 文件被新增、修改或删除，when 用户查看 trace，then 展示 workspace-relative path 和 change type。
4. Given 变更数量超过 Thread 展示上限，when 生成摘要，then event 显示 totals 和 truncated，完整的已记录变更仍可通过 Run evidence 接口分页读取。
5. Given queued Run 在启动前被取消，when 用户查看 trace，then 不生成误导性的文件变更或 handoff evidence。

### US4：获得可接力的 Handoff Packet（Priority: P1）

作为后续 agent 或 validator，我希望直接读取本轮的结构化结果和证据引用，不必复制完整日志。

**独立测试**：让 Run 以成功、失败和取消三种方式终止，验证自动生成的 `handoff.created` 内容及引用解析。

**验收场景**：

1. Given Run 曾进入 `running` 且已终止，when trace finalization 完成，then 自动写入一个 `handoff.created`。
2. Given 本 Run 有 command/test/file-change evidence，when handoff 创建，then packet 引用这些 evidence，且引用可解析。
3. Given Run 失败、取消或 evidence 不完整，when handoff 创建，then packet 明确记录 known risks、missing evidence 和建议下一步。
4. Given 同一 Run 的 finalization 被重复调用，when 系统重试，then 不重复生成 file summary 或 handoff。

### US5：展示 Validation Trace Contract（Priority: P2）

作为用户，我希望 Thread 和 Inspector 已能正确展示 F004 将写入的 validation request、finding 和 result。

**独立测试**：通过 service/test helper 写入各类 validation event，验证 payload 校验、引用解析和 UI；F003 不提供任意客户端写 validation event 的公共接口。

**验收场景**：

1. Given `validation.requested` 被内部服务写入，when 用户查看 Thread，then 展示验证目标、round 和 evidence refs。
2. Given `validation.finding` 被写入，when 用户查看 Thread，then 展示 severity、message、可选 file/line 和建议。
3. Given pass/fail/blocked result event 被写入，when 用户查看 Inspector，then 展示结果，但 F003 不自动改变 Issue 状态。
4. Given validation event 引用了其他 Issue/Thread 的 evidence，when 服务尝试写入，then 引用校验失败，不持久化越界引用。

### US6：导出 Issue Development Trace Markdown（Priority: P2）

作为用户，我希望下载单个 Issue 的 Markdown trace，用于保存、分享和复盘。

**独立测试**：对多 Run、缺少测试、扫描失败、引用缺失和长文件列表等 fixture 生成 Markdown，并验证响应 headers 和内容。

**验收场景**：

1. Given Issue 有多个 Run，when 用户导出，then Markdown 按 Run 分组包含命令、验证结果、文件变更、handoff 和 validation trace。
2. Given 某类证据不存在或扫描失败，when 导出，then Markdown 明确写出 `not recorded` / `unavailable` 及相关 event id。
3. Given evidence ref 缺失，when 导出，then 保留原始 ref 并标记 missing，不静默删除。
4. Given 导出成功，when 浏览器接收响应，then 以 UTF-8 Markdown attachment 下载，后端不写入 workspace。

## 3. 范围与边界

### 范围内

- `command.started` / `command.completed`。
- `test.completed`，其中 `test_kind` 支持 test/lint/typecheck/build。
- Run baseline、`file.change_summary` / `file.change_scan_failed` 和完整文件变更分页读取。
- typed evidence refs 及同 Issue/Thread/Run 边界校验。
- 自动 `handoff.created` 和最小 Handoff Packet。
- validation event 类型、payload contract、内部写入校验和 UI renderer。
- Issue trace、Run evidence API 和 Markdown export。
- Thread / Inspector 的 trace 展示、缺失/截断/可信度状态。

### 范围外

- 自动 validation 和 Issue `Validating`/`Done` 流转。
- validator output parser 和 findings 回流。
- 独立 HandoffPacket/Artifact/EvidenceSummary 表。
- 完整命令输出复制、完整 diff/patch 保存。
- 非 Codex adapter 的结构化 trace 实现。
- 用户手工伪造 validation event 的 API。

### 边界规则

- P0 command evidence 只接受 adapter structured event 或 approval hook 直接观察到的命令；普通 `run.output` 不升级为 confirmed command evidence。
- 文件证据描述的是 Run baseline 与 final snapshot 的净变化，不宣称能证明每一个中间写入动作。
- 文件扫描失败只降低 trace 完整性，不改变 Run 的 completed/failed/cancelled/interrupted 结果。
- 任何读取 workspace 的 finalization 必须在 workspace 锁仍由该 Run 持有时执行；无论 finalization 成败都必须最终释放锁并继续队列。恢复时若 ownership 已丢失，只允许在不读取 workspace 的前提下持久化 scan failure/handoff missing evidence 并收敛状态。
- finalization DB 提交失败且锁已释放后，除非系统能证明 workspace 尚未推进，否则恢复流程不得重新扫描并归因给旧 Run；必须以稳定 reason code 收敛为 unavailable/missing evidence。
- 所有 path 对外使用 workspace-relative 形式；越出 workspace、无法规范化或包含 NUL 的 path 不进入 evidence。
- 展示可截断，持久化的文件变更可分页；达到扫描安全上限时必须标记 `scan_truncated`，且只有能由 snapshot coverage 证明的变化才可持久化，不能把“未扫描到”当作新增或删除。

## 4. 需求

### 功能需求

### Requirement: Command Trace（`FR-001`）

系统应把 adapter 直接观察到的命令生命周期转换为可关联的 ThreadEvents。

#### Scenario: 结构化命令生命周期

- GIVEN Run 为 `running`
- WHEN adapter 发出 command started/completed
- THEN 系统按顺序写入 `command.started` / `command.completed`
- AND completed event 引用 started event
- AND payload 标明 source 和 confidence

### Requirement: Verification Evidence（`FR-002`）

系统应从已确认的 command evidence 中保守识别验证命令并记录结果。

#### Scenario: 验证结果生成

- GIVEN 一个已完成的 confirmed command
- WHEN classifier 将其识别为 test/lint/typecheck/build
- THEN 写入 `test.completed`
- AND 引用 `command.completed`
- AND result 由明确的 exit code/status 得出

### Requirement: File Change Trace（`FR-003`）

系统应为所有实际开始执行的 Run 记录相对 baseline 的净文件变化。

#### Scenario: 锁内 finalization

- GIVEN Run 已取得 workspace 锁并持久化 baseline
- WHEN Run 进入终态
- THEN 在释放锁和启动下一 Run 之前计算 final snapshot
- AND 写入 `file.change_summary` 或 `file.change_scan_failed`
- AND 该流程可幂等重试

### Requirement: Evidence Refs（`FR-004`）

系统应提供稳定、可解析且有作用域校验的 evidence refs。

#### Scenario: 引用解析

- GIVEN trace event 包含 evidence refs
- WHEN Issue trace、Run evidence、handoff 或 export 解析引用
- THEN 返回引用类型、目标和 `resolved/missing/truncated`
- AND 禁止跨 Issue/Thread 越界引用

### Requirement: Handoff Packet（`FR-005`）

系统应在 started Run 终止后自动生成一个最小 handoff packet。

#### Scenario: 自动交接

- GIVEN terminal Run 的文件扫描已结束或明确失败
- WHEN finalization 提交
- THEN 写入一个 `handoff.created`
- AND packet 包含 issue goal、run status、completed work、commands/tests、changed files、known risks、missing evidence、evidence refs 和 next expected action

### Requirement: Validation Event Contract（`FR-006`）

系统应支持 F004 所需 validation event 的持久化 contract 和展示，但不执行 validation workflow。

#### Scenario: 结果仅展示

- GIVEN 合法 validation event 已由内部服务写入
- WHEN 用户查看 Thread 或 Inspector
- THEN UI 展示 request/finding/result 和 evidence refs
- AND F003 不自动改变 Issue 状态

### Requirement: Trace Query And Export（`FR-007`）

系统应支持查询 Issue trace、Run evidence，并导出 Issue Markdown。

#### Scenario: 可恢复查询与导出

- GIVEN Issue 含一个或多个 Run
- WHEN 客户端查询或导出 trace
- THEN 数据按 Run 和 Thread `event_sequence` 稳定排序
- AND 缺失、截断和失败状态显式返回

### Requirement: Trace UI（`FR-008`）

Thread 和 Inspector 应提供适合实时观察与复盘的 trace 视图。

#### Scenario: 三栏 UI 中复盘

- GIVEN 当前 Issue 有 development trace
- WHEN 用户打开 Issue
- THEN 中栏按事件顺序展示 command/test/file/handoff/validation cards
- AND 右栏汇总最近 Run 的 tests、changed files、handoff、完整性和 export action

### 数据 / 实体需求

- **DR-001**：新增 ThreadEvent 类型：`command.started`、`command.completed`、`test.completed`、`file.change_summary`、`file.change_scan_failed`、`handoff.created`、`validation.requested`、`validation.finding`、`validation.passed`、`validation.failed`、`validation.blocked`。
- **DR-002**：Run trace baseline/finalization 状态必须持久化，以支持终态收尾幂等和重启恢复。
- **DR-003**：完整 file change record 至少包含 `run_id`、workspace-relative `path`、`change_type`；同一 Run/path 唯一，并可分页查询。
- **DR-004**：F003 复用现有 `ThreadEvent.evidence_refs: string[]`，采用可版本化的 typed ref，不新增 Artifact 表。
- **DR-005**：Handoff Packet P0 内联在 `handoff.created.payload_json`，绑定 `issue_id`、`thread_id`、`run_id`。
- **DR-006**：Run、Issue、Thread 的既有状态枚举不因 F003 增加新状态。

### 事件 / Trace 需求

- **TR-001**：所有 F003 Run 事件 payload 包含 `issue_id`、`thread_id`、`run_id`、`workspace_id`。
- **TR-002**：`command.started` 包含 command、cwd、adapter item id、source、confidence；敏感片段经统一 redaction，字段有长度上限。
- **TR-003**：`command.completed` 包含 started event ref、outcome、exit_code、duration_ms、summary、output truncation 状态。
- **TR-004**：`test.completed` 包含 command ref、`test_kind`、result、exit_code、summary。
- **TR-005**：`file.change_summary` 包含 scanner、totals、preview、scan_truncated 和完整 file-change-set ref；失败事件包含 phase 和稳定 reason code。
- **TR-006**：`handoff.created` 在 file event 之后写入；同一 Run 最多一个。
- **TR-007**：validation contract 支持 requested/finding/passed/failed/blocked；finding severity 为固定枚举，file refs 可选。
- **TR-008**：所有事件先写 SQLite 再广播，沿用 Thread 内 `event_sequence` 排序、event id cursor 和 SSE replay。
- **TR-009**：event payload 不复制完整 command output 或完整 diff；使用摘要和 evidence ref 避免重复存储。Trace/evidence query 与 export 解析 `run.output` ref 时只返回最小目标 metadata，不内联原始 output payload。

### API / 接口需求

- **IR-001**：`GET /api/issues/:issue_id/trace` 返回 Issue、Runs、trace events、evidence resolution 和完整性摘要。
- **IR-002**：`GET /api/runs/:run_id/evidence` 返回该 Run 的 trace events，并支持 file changes 分页。
- **IR-003**：`GET /api/issues/:issue_id/trace/export` 返回 UTF-8 Markdown attachment；后端不落盘。
- **IR-004**：不存在的 Issue/Run 返回既有结构化 `ISSUE_NOT_FOUND` / `RUN_NOT_FOUND`；非法 cursor/page 参数返回结构化校验错误。
- **IR-005**：查询和导出显式表达 `resolved`、`missing`、`truncated`、`unavailable`，不静默丢证据；Issue trace 同时返回逐 Run completeness，queued 且从未 running 的 Run 明确为 not applicable，不参与 Issue 聚合；聚合规则固定且不受 event 分页影响。
- **IR-006**：F003 不新增公开 validation event 写接口；F004 通过内部 service contract 写入。

### UX 需求

- **UX-001**：command card 展示命令、cwd、outcome、duration、source/confidence；默认不展开长输出。
- **UX-002**：test card 区分 test/lint/typecheck/build 与 passed/failed/unknown。
- **UX-003**：file summary 展示 totals 和有限 preview；存在更多记录时明确提示并允许分页/展开。
- **UX-004**：handoff card 展示结果、风险、缺失证据和 next action。
- **UX-005**：validation card 明确区分 finding severity 和 pass/fail/blocked；F003 阶段不把它包装成 Issue Done。
- **UX-006**：Inspector 汇总最近 Run evidence，并提供 Markdown export action。
- **UX-007**：command unavailable、scan failed、scan truncated、missing ref、output truncated 均有可见状态。
- **UX-008**：SSE 到达新 trace event 时刷新 trace/Run evidence query，不破坏 F002 的日志实时展示、连续 output 合并/截断标记、Run cancel、composer 发送护栏与 mutation 成功/失败反馈，以及三类 escalation blocker 能力边界文案。

### 非功能需求

- **NFR-001（可靠性）**：trace finalization 幂等；进程重启后能发现 terminal 且未 finalization 的 Run 并补做收尾。
- **NFR-002（锁与队列）**：started Run 的 finalization 完成或失败收敛前不得释放 workspace 锁；失败不得永久阻塞队列。
- **NFR-003（性能）**：文件扫描有时间、文件数、单文件大小和 event preview 上限；长列表通过分页读取。
- **NFR-004（安全）**：命令/摘要应用凭据 redaction；文件路径规范化在 workspace 内；evidence ref 做作用域校验。
- **NFR-005（可信度）**：不把 output inference、缺失 exit code 或不确定分类表示为 confirmed pass。
- **NFR-006（本地优先）**：evidence 和导出均来自本地 SQLite/workspace，不依赖云服务，导出不污染 workspace。
- **NFR-007（兼容性）**：支持 Windows path 和常见 PowerShell/cmd/npm 命令形态，不假设 Unix shell。
- **NFR-008（可维护性）**：遵循 `routes -> services -> repositories -> db` 与 `components -> hooks -> apiClient` 分层，单文件 350 行硬上限。
- **NFR-009（归因安全）**：file-change record 必须可由 baseline/final workspace view 或明确 coverage 证明；workspace 可能在锁释放后推进时 fail closed，不把当前状态归因给旧 Run。

## 5. 关键实体 / 概念

- **Development Trace**：围绕 Issue/Run 的结构化过程记录，不等同于原始日志。
- **Command Evidence**：adapter 直接观察到的命令生命周期及结果。
- **Verification Evidence**：由 confirmed command 保守派生的 test/lint/typecheck/build 结果。
- **Run Trace Baseline**：Run 启动前、持有 workspace 锁时记录的文件状态。
- **File Change Set**：baseline 与 final snapshot 之间的净变化集合；event 只放摘要，完整记录可分页。
- **Evidence Ref**：可解析的 typed string，P0 指向 ThreadEvent 或某 Run 的 file-change set。
- **Handoff Packet**：terminal Run 的结构化交接摘要；F003 生成但不自动路由。
- **Trace Completeness**：对 command、verification、file scan、refs 分别标识 complete/partial/unavailable，而不是一个模糊的“有证据”。

## 6. 生命周期与不变量

```text
workspace lock acquired
  -> capture + persist baseline
  -> Run running / adapter start
  -> command.started -> command.completed -> optional test.completed
  -> Run terminal event
  -> final file scan while lock held
  -> file.change_summary | file.change_scan_failed
  -> handoff.created
  -> mark trace finalized
  -> release workspace lock
  -> start next eligible queued Run
```

不变量：

- queued 且从未 running 的 Run 不生成 file summary/handoff。
- 同一 Run 最多一个 final file event 和一个 handoff。
- command completed 必须关联同一 Run 的 command started；test 必须关联同一 Run 的 command completed。
- file scan 和 handoff 失败不重写 Run terminal status。
- finalization 的任何异常都必须进入显式 failure evidence，并在收敛后释放锁。
- validation events 在 F003 中不驱动 Issue 状态。

## 7. 成功标准

- **SC-001**：用户能从 Thread 看懂一轮 Run 做了哪些已确认命令、验证是否通过、改了哪些文件。
- **SC-002**：后续 agent 可通过一个 handoff 和 evidence refs 接手，无需解析整段日志。
- **SC-003**：文件证据在大列表下仍可分页恢复，并明确扫描/截断边界。
- **SC-004**：Issue trace 可稳定导出为可读 Markdown，缺失证据不被掩盖。
- **SC-005**：F004 可直接复用 validation events、evidence resolver 和 Run evidence API，不重做 F003 模型。
- **SC-006**：F003 不破坏 F002 的 Run 队列、锁释放、SSE replay 和 escalation 语义。

## 8. 验收清单

- [ ] **AC-001**（`FR-001`, `TR-001` - `TR-003`）：Codex/Fake adapter 的结构化命令信号按序持久化并显示，缺失能力不伪造 evidence。
- [ ] **AC-002**（`FR-002`, `TR-004`, `NFR-005`）：常见验证命令被保守分类，pass/fail/unknown 与 exit 状态一致。
- [ ] **AC-003**（`FR-003`, `DR-002`, `NFR-002`）：baseline 在 adapter 前获取；终态扫描/handoff 在释放锁和启动下一 Run 前完成。
- [ ] **AC-004**（`FR-003`, `DR-003`, `NFR-003`, `NFR-009`）：新增/修改/删除正确；dirty 内容被原样 commit 不误报；大列表 event 截断但已确认数据可分页，未覆盖路径不产生虚假 added/deleted。
- [ ] **AC-005**（`FR-004`, `NFR-004`）：refs 可解析、缺失可见、跨 Issue/Thread 引用被拒绝。
- [ ] **AC-006**（`FR-005`, `TR-006`, `NFR-001`）：started Run 自动且幂等地产生一个 handoff；失败/取消/恢复路径包含风险和缺失证据。
- [ ] **AC-007**（`FR-006`, `IR-006`）：validation events 可由内部 contract 写入和展示，但 F003 不改变 Issue 状态，也无公开写接口。
- [ ] **AC-008**（`FR-007`, `IR-001` - `IR-005`, `TR-009`）：Issue trace、Run evidence 和 Markdown export 在多 Run、缺失、截断场景下结果稳定；逐 Run/Issue 聚合 completeness 明确，响应和导出不含 raw `run.output` payload。
- [ ] **AC-009**（`FR-008`, `UX-001` - `UX-008`）：Thread/Inspector 可读展示 trace、完整性和 export，且 SSE 新事件能刷新；F002 日志、取消、composer 护栏/反馈和 escalation blocker 展示回归通过。
- [ ] **AC-010**（`NFR-001`, `NFR-002`, `NFR-009`）：重复 finalization、服务重启、scan failure、DB finalization failure 后 workspace 推进均不产生重复/错误归因证据或永久锁。
- [ ] **AC-011**（`NFR-004`, `NFR-007`）：敏感 command 片段被 redaction；Windows path/PowerShell/cmd 命令样例通过。
- [ ] **AC-012**（`TR-008`）：刷新/断线重连后 trace 仍按 Thread `event_sequence` 去重排序。

## 9. 测试计划

### 单元测试

- Codex protocol command normalizer 与 adapter item correlation。
- verification command classifier（npm/pnpm/yarn/bun、pytest/vitest/jest、cargo/go/dotnet、lint/typecheck/build；含 PowerShell/cmd wrapper）。
- command redaction、长度限制和 workspace-relative path 规范化。
- git/filesystem snapshot diff、change type、dirty 内容原样 commit、coverage/frontier、limits 和 failure reason。
- typed evidence ref parser/resolver/scope validator。
- Handoff builder、completeness builder、Markdown renderer。

### 集成测试

- FakeAgentAdapter -> command/test ThreadEvents -> SSE replay。
- git/non-git workspace baseline 与 terminal scan。
- completed/failed/cancelled/interrupted/escalation 的 finalization 顺序。
- 同 workspace 两个 Run：前一 Run handoff 提交后才释放锁并启动下一 Run。
- finalization 重试与重启恢复无重复 event；DB finalization failure 后下一 Run 推进时旧 Run fail closed，不重新归因 file records。
- Run evidence 分页、Issue trace、逐 Run/Issue completeness、missing refs、raw output 非内联和 Markdown headers/content。

### UI 测试

- 各 trace card 的 pass/fail/blocked/unavailable/truncated/missing 状态。
- Inspector 最近 Run 汇总、文件分页/展开和 export action。
- SSE 触发 query invalidation，现有 Run logs/Cancel UI 不回归。

### 手动验证

- 使用真实 Codex CLI 执行包含普通命令、失败测试和文件修改的 Run。
- Windows workspace path（空格、反斜杠）与 PowerShell/cmd 命令识别。
- pre-existing dirty git workspace、agent commit、non-git workspace。
- 服务在 Run terminal 与 finalization 之间退出后的恢复。
- 大 repository 扫描上限、Markdown 可读性和导出文件名。

## 10. 依赖

### 上游依赖

- F001：Project/Workspace/Issue/Thread/ThreadEvent、SQLite、primary Thread。
- F002：Run lifecycle、workspace lock/queue、AgentAdapter/Runner、Codex app-server、EventBus/SSE、output truncation、escalation。

### 下游依赖

- F004：Run evidence、validation event contract、resolver 和 handoff。
- F005：上一 Run handoff/evidence 作为下一 adapter 的 context。
- v0.3：可把 typed refs 扩展到 Artifact，而无需改写已有 event refs。

### 环境依赖

- 本地 filesystem 读权限；workspace 写权限由 F001/F002 保证。
- git 可选：git workspace 优先使用 git snapshot；不可用或非 git 时使用有界 filesystem snapshot。
- Codex app-server structured item notification；具体字段兼容通过 adapter fixture/probe 验证。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Codex protocol 字段随版本变化 | command trace 丢失或解析错误 | adapter normalizer 隔离协议版本；保存 capability unavailable 状态；fixture + 真实 CLI probe |
| 终态扫描时锁已释放 | 下一 Run 污染前一 Run 文件证据 | 把 lock release 从 Run 状态转换中移到统一 finalization finally；增加双 Run 顺序测试 |
| dirty workspace / agent commit 让 git diff 不直观 | 漏报或归因错误 | 记录 baseline HEAD + status/fingerprint，比较净状态；标明 scanner/confidence，不宣称中间操作历史 |
| 非 git 大目录扫描昂贵 | terminal 收尾慢、队列等待 | ignore 规则、时间/文件/大小上限、hash 策略和 scan_truncated；不无限扫描 |
| 命令含 token/secret | DB/UI/export 泄密 | 写事件前统一 redaction + 长度限制；不复制完整环境变量和原始 protocol 消息 |
| finalization 崩溃或重复回调 | 重复 handoff、锁遗留 | 持久化 trace state，事务内 claim/finalize，启动恢复与幂等测试 |
| finalization DB 失败后解锁并继续队列 | 恢复扫描把下一 Run 的修改归到旧 Run | 有界重试；无法证明 workspace 未推进时只生成稳定 scan failure/missing evidence，不重建旧 Run file records |
| baseline/final snapshot 在不同位置截断 | 未扫描路径被误判为 added/deleted | 保存 deterministic coverage/frontier；只持久化 coverage 可证明的变化，其他差异标 unknown/truncated |
| evidence ref 越界 | F004/F005 读取错误 Issue 的证据 | typed resolver 以当前 Issue/Thread/Run 做 scope validation |
| validation UI 被误解为自动 Done | 产品语义超前 | F003 只显示 trace，明确“recorded result”；状态流转留给 F004 |

## 12. 已关闭设计问题

- **Q1：是否从 run.output 推断命令？** 不作为 P0 降级路径。当前 Codex adapter 已使用 app-server JSON-RPC，应扩展结构化 item notifications；协议不可用时如实显示 command evidence unavailable。
- **Q2：文件证据何时计算？** baseline 在取得锁后、adapter 启动前；final snapshot 在 Run terminal 后、仍持锁时。这样才能避免下一 Run 污染归因。
- **Q3：是否引入 Artifact/HandoffPacket 独立表？** F003 不引入。handoff 内联事件；file-change set 使用专用 derived records；typed refs 为未来 Artifact 保留扩展前缀。
- **Q4：大文件列表放哪里？** `file.change_summary` 只放 totals + preview，完整已记录列表放 file-change records，由 Run evidence API 分页。
- **Q5：Markdown 是否落盘？** 后端内存生成并以 attachment 返回，不写 workspace，不产生额外 git diff。
- **Q6：queued cancel 是否生成 handoff？** 不生成。只有曾进入 `running` 的 Run 才拥有 baseline/finalization/handoff 语义。

## 13. 可追踪性

| 规格项 | 来源 | 验证 |
| --- | --- | --- |
| `FR-001`, `FR-002` | PRD command/test evidence；F002 structured Codex adapter | `AC-001`, `AC-002` |
| `FR-003` | PRD file-change evidence；F002 workspace lock | `AC-003`, `AC-004`, `AC-010` |
| `FR-004` | PRD Evidence refs；现有 `ThreadEvent.evidence_refs` | `AC-005`, `AC-008` |
| `FR-005` | PRD 7.4 Handoff；F005 context 输入 | `AC-006` |
| `FR-006` | PRD 7.5；F004 event contract | `AC-007` |
| `FR-007`, `FR-008` | PRD v0.1.2 Markdown export / UI | `AC-008`, `AC-009`, `AC-012` |
| `NFR-001`, `NFR-002` | F002 recovery/lock/queue 不变量 | `AC-003`, `AC-010` |
| `NFR-009` | F003 file evidence 归因与可信度边界 | `AC-004`, `AC-010` |

## 14. 与旧版 spec 相比的修订

- 根据已实现代码，把基线从笼统的“F002 将提供”改为现有 ThreadEvent/Run/Codex/SSE contract。
- 删除“从 stdout/stderr 尽力推断命令”的默认降级承诺，避免把不可靠文本猜测交给 F004 当验证证据。
- 明确 queued cancel 不生成文件/handoff；started Run 的四种终态都要 finalization。
- 明确 terminal event 后仍需持锁完成扫描与 handoff，修复当前实现中 RunService 终态转换过早释放锁的架构冲突。
- 把“大列表截断但可恢复”落实为 event preview + 可分页 file-change records。
- 去掉 spec 中的具体 git 命令序列和外部项目实现备注；这些实现细节移入 `design.md`。
- 增加 redaction、path scope、ref scope、幂等和重启恢复要求。

## 15. 参考

- `docs/personahub-prd.md`
- `docs/personahub-architecture.md`
- `docs/personahub-system-design.md`
- `docs/decisions/0002-first-agent-adapter.md`
- `docs/decisions/0005-code-directory-structure.md`
- `docs/features/0.1/F001-workspace-issue-foundation/`
- `docs/features/0.1/F002-agent-command-center/`
- `docs/features/0.1/F004-autonomous-validation/spec.md`
- `docs/features/0.1/F005-multi-agent-manual-routing/spec.md`
