---
feature_ids: [F002]
related_features: [F001]
topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, v0.1.1]
doc_kind: spec
created: 2026-07-12
updated: 2026-07-12
---

# F002：Agent Command Center

> Status: spec | Owner: TBD | Target: v0.1.1

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 4.1、7.3、8、10、11、12、15 节。
- **架构来源**：`docs/personahub-architecture.md` 第 2、3、4、8、9 节；第 5 节仅引用 workflow dispatch / context 组装相关判断，不引用 validation loop。
- **系统设计来源**：`docs/personahub-system-design.md` 中的 Agent、Workspace、Issue、Thread、ThreadEvent、Run。
- **上游决策**：`docs/decisions/0002-first-agent-adapter.md`、`docs/decisions/0003-backend-runtime.md`。
- **上游 feature**：F001 Workspace & Issue Foundation。
- **功能类型**：user-facing / backend / runtime / workflow。
- **规格模式**：full，因为本 feature 第一次接入真实 CLI agent，并落地 Run lifecycle、workspace 写锁、event stream 和 escalation 边界。
- **变更类型**：ADDED。
- **一句话意图**：让用户可以从 Issue primary Thread 中向本地 Codex CLI agent 下发指令，并在 PersonaHub 内观察 Run 状态、日志和事件。

## 1. 问题与目标

### 问题

F001 建立了 Project / Workspace / Issue / Thread 地基，但用户仍然需要切换到 Codex CLI 终端里手动下发开发指令。这意味着 PersonaHub 还没有兑现 v0.1 的核心承诺：用户不再需要复制上下文、切换终端、手动追踪 agent 做了什么。

同时，真实 CLI agent 会引入新的 runtime 问题：Run 生命周期、workspace 并发写入、进程崩溃恢复、stdout/stderr 事件持久化、危险操作 escalation。这些问题必须在 F002 开始落地，而不是留到 validation 阶段才补。

### 目标

用户可以在 Issue primary Thread 中输入一条开发指令，PersonaHub 创建 Run，调用本地 Codex CLI adapter，在 Thread 中持久化并展示 run events，在 Inspector 中展示 agent status 和 run logs。同一 workspace 的写操作被串行化；重启后遗留 running Run 可以被回收；git push / force push 默认因为 agent 执行环境缺少 push 凭据而无法发生（凭据隔离是主要防线），并在 Thread 中生成清晰的 escalation 事件说明原因（可观测性补充），而不依赖 CLI 是否提供可靠的执行前 approval 钩子。

### 非目标

- 本 feature 不实现结构化 Handoff Packet；它属于 v0.1.2 Development Trace。
- 本 feature 不实现 Agent Validation Loop；它属于 v0.1.3 Autonomous Validation。
- 本 feature 不生成 Evidence Summary 或 Markdown export。
- 本 feature 不实现 Room、Artifact Service、Memory、Skill 或 Coordinator Agent。
- 本 feature 不接入 Claude Code / OpenCode；P0 只接入 Codex CLI。
- 本 feature 不承诺完整 sandbox/isolation；v0.1 只实现 workspace 写锁和可实现的 escalation 边界。

## 2. 用户场景与独立测试

### US1：配置 Codex CLI Adapter（Priority: P1）

作为用户，我希望在 Project 中配置本地 Codex CLI adapter，以便 PersonaHub 能从 Thread 启动对应 agent。

**为什么是这个优先级**：没有可用 adapter，就无法从 PersonaHub 发送指令到本地 agent。

**独立测试**：配置一个有效 Codex CLI 可执行文件或命令，系统校验可用后在 Project 中显示 adapter 可用状态。

**验收场景**：

1. Given Project 已存在，when 用户配置有效的 Codex CLI adapter，then 系统保存 adapter 配置并显示可用。
2. Given 用户配置的 Codex CLI 路径或命令不可用，when 用户保存配置，then 系统拒绝请求并返回清晰错误。
3. Given adapter 已配置，when 用户打开 Project 设置或 Agent 区域，then 系统展示该 adapter 的 provider、role/capability 和可用状态。

### US2：从 Thread 下发 Agent 指令（Priority: P1）

作为用户，我希望直接在 Issue primary Thread 中输入开发指令，以便无需切换到 Codex CLI 终端。

**为什么是这个优先级**：这是 v0.1 “Thread 是唯一协作入口”的最小可见闭环。

**独立测试**：在一个 F001 创建的 coding Issue primary Thread 中输入指令，系统创建 Run，调用 Codex CLI adapter，并把 run 状态和输出写回 Thread。

**验收场景**：

1. Given Project 已绑定 Workspace，Issue 已有 primary Thread，Codex CLI adapter 可用，when 用户在 Thread 中输入开发指令，then 系统创建新的 Run。
2. Given Run 被创建，when 系统持久化排队状态，then Run 进入 `queued`，并写入 `run.queued` ThreadEvent。
3. Given Run 获得 workspace 写锁，when 系统开始执行，then Run 进入 `running`，并写入 `run.started` ThreadEvent。
4. Given Codex CLI 输出内容，when adapter 收到 stdout/stderr，then 系统把输出持久化为 `run.output` ThreadEvent。
5. Given Codex CLI 正常退出，when Run 完成，then Run 进入 `completed`，并写入 `run.completed` ThreadEvent。
6. Given Codex CLI 失败退出，when Run 结束，then Run 进入 `failed`，并写入 `run.failed` ThreadEvent。

### US3：观察 Run 状态与日志（Priority: P1）

作为用户，我希望在 Thread 和 Inspector 中看到 agent status 与 run logs，以便知道 agent 是否正在执行、输出了什么、是否失败。

**为什么是这个优先级**：没有可观察性，用户仍然需要回到终端确认 agent 状态。

**独立测试**：启动一个 Run，观察 Inspector 状态变化，并验证 Thread 中按顺序出现 run events。

**验收场景**：

1. Given Run 已排队，when 用户查看 Inspector，then UI 展示 `queued` 状态。
2. Given Run 正在执行，when 用户查看 Inspector，then UI 展示 `running` 状态和持续更新的 logs。
3. Given Run 已完成或失败，when 用户查看 Inspector，then UI 展示终态和对应 exit 信息。
4. Given 用户刷新页面或重新打开 Issue，when Thread events 被加载，then 历史 run events 仍然按稳定顺序展示。

### US4：同一 Workspace 串行执行（Priority: P1）

作为用户，我希望同一 workspace 内不会有多个 agent run 同时写文件，以免 agent 互相覆盖修改。

**为什么是这个优先级**：Workspace 写锁是 PRD 第 11 节定义的 P0 安全底线。

**独立测试**：对同一 workspace 同时提交两个 Run，第一个执行时第二个进入 `queued`，直到第一个释放锁后才开始。

**验收场景**：

1. Given workspace 已有一个 `running` Run 持有写锁，when 用户再次提交同一 workspace 的指令，then 新 Run 进入 `queued`。
2. Given 第一个 Run 完成或失败，when workspace 锁释放，then 队列中的下一个 Run 可以进入 `running`。
3. Given 多个 Project 指向同一 workspace，when run dispatch 发生，then 写锁仍按 workspace 维度生效。
4. Given queued Run 所属 Issue 在等待期间进入 `Blocked`，when workspace 锁释放并轮到该 Run，then 系统将该 Run 置为 `cancelled` 并写入原因，不启动 adapter。

### US5：重启后回收遗留 Run（Priority: P2）

作为用户，我希望 PersonaHub 重启后不会因为旧 Run 或旧 workspace lock 永久卡住。

**为什么是这个优先级**：这是本地 runtime 可信度要求，但可在基本 dispatch 跑通后实现。

**独立测试**：模拟 backend 在 Run `running` 时退出，重启后系统将遗留 Run 标记为 `interrupted`，释放 workspace lock。

**验收场景**：

1. Given backend 启动时发现上次遗留的 `running` Run，when 无法确认该 Run 仍被当前 runner 管理，then 系统将其标记为 `interrupted`。
2. Given 遗留 Run 持有 workspace lock，when Run 被回收为 `interrupted`，then 对应 workspace lock 被释放。
3. Given Run 被回收，when 用户查看 Thread，then 系统写入或展示可追踪的 interrupted/recovery 信息。

### US6：危险 Git Push Escalation（Priority: P1，凭据隔离部分优先于其余 Priority: P2 场景）

作为用户，我希望 agent 默认没有能力执行 `git push` 或 force push，并在尝试时进入 escalation，以免自动化越过本地安全边界。

**为什么是这个优先级**：PRD 第 11 节明确要求 git push / force push 默认禁止并需 operator 显式授权。凭据隔离（场景 1）不依赖任何 CLI 内部协议，是确定性的主要防线，优先级等同于基本 run dispatch；执行前 approval 钩子（场景 2、3）只是可观测性增强，取决于 Codex CLI 是否提供可靠钩子，优先级低于凭据隔离。

**独立测试**：验证 agent run 的执行环境默认不包含可用于 push 的 git 凭据，push 命令因此自然失败；再用真实 Codex CLI 验证是否能额外做到执行前拦截，如果不能，则至少事后检测并明确告知用户能力边界。

**验收场景**：

1. Given Project 未显式为该 Workspace 开启 push 凭据，when agent 在 Run 中尝试 `git push` 或 force push，then 命令因为缺少凭据而失败，系统触发 escalation、将 Issue 置为 `Blocked`，并说明是凭据隔离阻止而非 CLI 拦截。
2. Given Codex CLI 支持执行前 approval/权限钩子，when agent 尝试 `git push` 或 force push，then 系统在执行前触发 escalation，并阻止继续自动执行（在凭据隔离之上的额外可观测性）。
3. Given Codex CLI 不支持执行前 approval/权限钩子且凭据隔离因某种原因未生效，when 系统事后检测到 `git push` 或 force push 行为，then 系统触发 escalation、将 Issue 置为 `Blocked`，并明确说明这是事后检测而非前置阻止。
4. Given escalation 被触发，when 用户查看 Thread / Inspector，then 可以看到 blocker 原因（凭据隔离 / 前置拦截 / 事后检测）和需要 operator 处理的事项。

## 3. 范围

### 范围内

- Codex CLI adapter 配置和可用性校验。
- Agent adapter registry 的 P0 最小实现，只注册 Codex CLI。
- 从 Issue primary Thread 下发 agent 指令。
- 创建并持久化 Run。
- Run lifecycle：`queued`、`running`、`completed`、`failed`、`interrupted`、`cancelled`。
- CLI stdout/stderr 转换为 ThreadEvents。
- `run.queued`、`run.started`、`run.output`、`run.output_truncated`、`run.completed`、`run.failed`、`run.cancelled`、`run.interrupted`、`escalation.triggered`、`issue.blocked` 事件持久化。
- Thread / Inspector 展示 run status 和 run logs。
- 同一 workspace 写锁和排队行为。
- backend 重启后的 stale running Run 回收和 workspace lock 释放。
- Git push 凭据隔离：agent 执行环境默认不下发 push 凭据（主要防线）。
- Codex CLI 危险 git push / force push 的执行前 approval 拦截能力实测与落地（凭据隔离之上的可观测性增强）。

### 范围外

- Claude Code / OpenCode adapter。
- 多 agent roster 或 orchestrator workflow。
- Handoff Packet 结构化生成。
- Validation Loop 和 validator agent 判定。
- command/test/file-change evidence 的完整 trace。
- Artifact manifest / Artifact Service。
- 完整 process/container isolation。
- GitHub issue / PR 同步。

### 边界场景

- Codex CLI 未安装或不可执行。
- Codex CLI 执行失败或返回非 0 exit code。
- CLI 输出大量日志或长时间无输出。
- 用户取消正在执行或排队的 Run。
- 同一 workspace 同时提交多个 Run。
- 已排队 Run 的 Issue 在启动前进入 `Blocked`。
- backend 在 Run 执行中重启。
- workspace lock 残留。
- Codex CLI 不支持前置危险命令拦截。
- Project 显式为 Workspace 开启了 push 凭据后，agent 仍尝试 push 到受保护分支。
- Thread events 广播时前端断线。

## 4. 需求

### 功能需求

### Requirement: Codex CLI Adapter 配置（`FR-001`）

系统应当允许用户为 Project 配置至少一个本地 Codex CLI adapter。

#### Scenario: 有效 Adapter

- GIVEN Project 已存在
- WHEN 用户配置有效 Codex CLI adapter
- THEN 系统保存 adapter 配置
- AND adapter 状态显示为可用
- AND adapter config 可以包含安全 argv 参数 `args`

#### Scenario: 无效 Adapter

- GIVEN Codex CLI 路径或命令不可用
- WHEN 用户保存 adapter 配置
- THEN 系统拒绝请求并返回结构化错误

#### Scenario: 更新或删除 Adapter

- GIVEN Project 已有 Codex CLI adapter
- WHEN 用户修正 command、args 或 default_model
- THEN 系统更新并重新校验 adapter
- GIVEN adapter 不再需要
- WHEN 用户删除 adapter
- THEN 系统不再将该 adapter 用于新 Run

### Requirement: Adapter Registry（`FR-002`）

系统应当通过 agent adapter registry 查找可用于 coding Issue 的 Codex CLI adapter。

#### Scenario: 查找 Codex Adapter

- GIVEN Project 已配置 Codex CLI adapter
- WHEN coding Issue 发起 agent command dispatch
- THEN 系统从 registry 中选择 Codex CLI adapter

### Requirement: Thread Command Dispatch（`FR-003`）

用户在 Issue primary Thread 输入 agent 指令时，系统应当创建一个新的 Run 并调用 Codex CLI adapter。

#### Scenario: Dispatch Thread 指令

- GIVEN Issue 有 primary Thread 和 Workspace
- AND Codex CLI adapter 可用
- WHEN 用户在 Thread 中输入开发指令
- THEN 系统创建 Run
- AND 将指令和必要上下文传给 Codex CLI adapter
- AND server 使用 `Issue.primary_thread_id` 作为 `Run.thread_id`

### Requirement: Run Lifecycle 持久化（`FR-004`）

系统应当持久化 Run 的生命周期状态。

#### Scenario: Run 排队

- GIVEN Run 被创建
- WHEN Run 等待 workspace 锁
- THEN Run 状态为 `queued`
- AND 系统写入 `run.queued`

#### Scenario: Run 开始执行

- GIVEN Run 已获得 workspace 写锁
- WHEN Run 开始执行
- THEN Run 状态为 `running`

#### Scenario: Run 正常完成

- GIVEN Run 正在执行
- WHEN Run 正常结束
- THEN Run 状态为 `completed`

#### Scenario: Run 执行失败

- GIVEN Run 正在执行
- WHEN Run 失败
- THEN Run 状态为 `failed`

#### Scenario: Run 中断

- GIVEN Run 正在执行
- WHEN backend 重启或 runner 失联且无法确认结果
- THEN Run 状态为 `interrupted`

#### Scenario: Run 取消

- GIVEN Run 处于 `queued` 或 `running`
- WHEN 用户取消该 Run
- THEN Run 状态为 `cancelled`

### Requirement: Run Output 持久化为 ThreadEvent（`FR-005`）

系统应当把 Codex CLI 的 stdout/stderr 输出转换并持久化为 ThreadEvent。

#### Scenario: 输出事件

- GIVEN Codex CLI 输出一段内容
- WHEN adapter 接收到 stdout/stderr chunk
- THEN 系统写入 `run.output` ThreadEvent

### Requirement: Run 终态事件（`FR-006`）

Run 开始、完成或失败时，系统应当写入对应 ThreadEvent。

#### Scenario: Run Events

- GIVEN Run 开始执行
- WHEN 状态变为 `running`
- THEN 系统写入 `run.started`
- GIVEN Run 正常退出
- WHEN 状态变为 `completed`
- THEN 系统写入 `run.completed`
- GIVEN Run 异常退出
- WHEN 状态变为 `failed`
- THEN 系统写入 `run.failed`

### Requirement: Workspace 写锁（`FR-007`）

系统应当保证同一 workspace 同一时刻只有一个 Run 执行写操作。

#### Scenario: 同 Workspace 排队

- GIVEN workspace 已有 `running` Run
- WHEN 用户提交第二个同 workspace Run
- THEN 第二个 Run 进入 `queued`
- AND 不会与第一个 Run 并发执行

### Requirement: Stale Run Recovery（`FR-008`）

backend 启动时，系统应当回收无法确认仍活跃的遗留 `running` Run，并释放其 workspace lock。

#### Scenario: 回收遗留 Run

- GIVEN backend 启动时发现遗留 `running` Run
- WHEN 当前 runner 无法确认该 Run 仍活跃
- THEN 系统将 Run 标记为 `interrupted`
- AND 释放关联 workspace lock

### Requirement: Run Cancel（`FR-009`）

系统应当允许用户取消 queued 或 running Run。

#### Scenario: 取消 Run

- GIVEN Run 处于 `queued` 或 `running`
- WHEN 用户取消该 Run
- THEN 系统将 Run 标记为 `cancelled`
- AND 如果该 Run 持有 workspace lock，则释放 lock

#### Scenario: Blocked Issue 取消排队 Run

- GIVEN Run 处于 `queued`
- AND Run 所属 Issue 已进入 `Blocked`
- WHEN 系统准备启动该 Run
- THEN 系统将 Run 标记为 `cancelled`
- AND 写入 `run.cancelled`，reason 为 `issue_blocked_before_start`

### Requirement: Run Status And Logs UI（`FR-010`）

UI 应当在 Thread 和 Inspector 中展示 Run 状态和日志。

#### Scenario: Inspector 展示 Run

- GIVEN Run 已创建
- WHEN 用户查看 Issue Inspector
- THEN UI 展示 Run status 和 run logs

### Requirement: Git 凭据隔离（`FR-013`）

Agent run 的执行环境默认不应具备可用于 `git push` 的凭据；push 凭据只有在 Project 设置里为对应 Workspace 显式开启后才下发。

#### Scenario: 默认无 push 凭据

- GIVEN Project 未为该 Workspace 显式开启 push 凭据
- WHEN 系统为 Run 准备 `WorkspaceContext`
- THEN 该 Run 的执行环境不包含可用于 push 的 git 凭据（不继承用户日常 SSH agent / cached HTTPS credential）

#### Scenario: 因缺少凭据而阻止 push

- GIVEN Run 的执行环境不包含 push 凭据
- WHEN agent 在 Run 中尝试 `git push` 或 force push
- THEN push 命令失败
- AND 系统触发 escalation，payload 说明是凭据隔离导致失败，而不是 CLI 拦截或事后检测

### Requirement: Git Push Escalation（`FR-011`）

当 agent 尝试 `git push`、force push 或直接写入受保护分支时，系统应当进入 escalation 路径。凭据隔离（`FR-013`）是主要防线，本需求描述凭据隔离之上的可观测性增强路径。

#### Scenario: 前置拦截

- GIVEN Codex CLI 支持执行前 approval/权限钩子
- WHEN agent 尝试危险 git 操作
- THEN 系统在执行前触发 escalation
- AND 相关 Run 进入 `failed`

#### Scenario: 事后检测

- GIVEN Codex CLI 不支持执行前 approval/权限钩子
- AND 凭据隔离因故未生效（例如 Project 已显式开启 push 凭据）
- WHEN 系统检测到危险 git 操作已经发生或被尝试
- THEN 系统触发 escalation
- AND 相关 Run 进入 `failed`
- AND 在 Blocked 提示中明确说明能力边界

### Requirement: Issue Blocked On Escalation（`FR-012`）

触发 escalation 时，系统应当将相关 Issue 置为 `Blocked` 并记录 blocker。

#### Scenario: Escalation Blocks Issue

- GIVEN Run 触发 escalation
- WHEN escalation event 写入 Thread
- THEN Issue status 变为 `Blocked`
- AND Inspector 展示 blocker 原因
- AND 同一 Issue 下尚未启动的 queued Runs 不得继续执行

### 数据 / 实体需求

- **DR-001**：Agent 或 adapter config 应当存储 provider、command/path、`args`、role/capability、可用状态和所属 Project；`args` 是字符串数组，不经 shell 拼接执行。
- **DR-002**：Run 应当存储 `id`、`issue_id`、`thread_id`、`workspace_id`、`agent_id` 或 adapter reference、`status`、`failure_reason`、`started_at`、`completed_at`、`exit_code`。
- **DR-003**：Run status 应支持 `queued`、`running`、`completed`、`failed`、`interrupted`、`cancelled`；状态更新必须使用 CAS（按当前状态条件更新），不允许无条件覆盖。`failure_reason` 应为固定枚举（`adapter_exit_nonzero`/`spawn_failed`/`execution_timeout`/`credential_isolation_blocked`/`pre_execution_approval_rejected`/`post_hoc_escalation`/`server_restarted`/`output_parse_failed`），不是自由文本。
- **DR-004**：Workspace lock 应当能关联到当前持锁 Run，并能在 Run 完成、失败、中断或取消时释放。
- **DR-005**：ThreadEvent 应当能记录 run 相关事件，并能关联到 `run_id`。
- **DR-006**：Run 创建、状态更新、ThreadEvent 写入和 workspace lock 变更必须保持可恢复的一致性；不能留下永久 locked workspace。
- **DR-007**：Run 输出持久化上限 P0 为 stdout + stderr 合计 1 MiB；超过上限后写入 `run.output_truncated` 并停止保存后续 output chunk。
- **DR-008**：Workspace（或 Project）应当存储 `push_credentials_enabled`（默认 `false`），决定 Run 的执行环境是否下发 git push 凭据。

### 事件 / Trace 需求

- **TR-001**：Run 被创建并进入 queued 时，系统应写入 `run.queued`。
- **TR-002**：Run 开始时，系统应写入 `run.started`。
- **TR-003**：Codex CLI 输出时，系统应写入 `run.output`。
- **TR-004**：Run 输出超过上限时，系统应写入 `run.output_truncated`。
- **TR-005**：Run 正常完成时，系统应写入 `run.completed`。
- **TR-006**：Run 失败时，系统应写入 `run.failed`。
- **TR-007**：Run 被取消时，系统应写入 `run.cancelled`，payload 应能表达用户取消或 `issue_blocked_before_start` 等原因。
- **TR-008**：遗留 Run 被回收时，系统应写入 `run.interrupted`。
- **TR-009**：触发 escalation 时，系统应写入 `escalation.triggered`。
- **TR-010**：Issue 因 escalation 进入 Blocked 时，系统应写入 `issue.blocked`。
- **TR-011**：所有 run 相关 ThreadEvents payload 应至少包含 `run_id`、`issue_id`、`thread_id`、`workspace_id` 和 `status`。
- **TR-012**：ThreadEvents 应先写入 SQLite，再广播给前端。
- **TR-013**：ThreadEvents 应支持基于 F001 `event_sequence` cursor 的稳定排序和断线后重读。

### API / 接口需求

- **IR-001**：后端应提供创建、读取、更新、删除、校验 Codex CLI adapter 的接口。
- **IR-002**：后端应提供从 Issue primary Thread 创建 Run 的接口；P0 由 server 根据 `Issue.primary_thread_id` 解析 thread，不要求 client 传 `thread_id`。
- **IR-003**：后端应提供读取 Run 状态和 logs 的接口。
- **IR-004**：后端应提供取消 Run 的接口。
- **IR-005**：后端应提供读取 Thread run events 的接口。
- **IR-006**：后端应提供前端订阅或轮询 run events 的接口，优先遵循架构文档中的 SSE event stream。
- **IR-007**：非法请求或运行时错误应返回结构化错误。

### UX 需求

- **UX-001**：UI 应允许用户配置 Codex CLI adapter，并看到可用/不可用状态。
- **UX-002**：UI 应允许用户在 Issue primary Thread 中输入 agent 指令。
- **UX-003**：UI 应展示 Run `queued`、`running`、`completed`、`failed`、`interrupted`、`cancelled` 状态。
- **UX-004**：UI 应在 Thread 中展示 run events。
- **UX-005**：UI 应在 Inspector 中展示 agent status 和 run logs。
- **UX-006**：UI 应允许用户取消 queued/running Run。
- **UX-007**：UI 应在 escalation 触发时展示 blocker 原因和能力边界说明。

### 非功能需求

- **NFR-001**：本 feature 应本地优先运行，不依赖 cloud account。
- **NFR-002**：同一 workspace 的写操作必须串行化。
- **NFR-003**：backend 重启后不得留下永久 locked workspace。
- **NFR-004**：ThreadEvents 写入必须先于前端广播，以支持断线重连后的历史补齐。
- **NFR-005**：Codex CLI 不可用、失败退出或输出异常时，系统应保持可恢复状态。
- **NFR-006**：危险 git push / force push 的处理能力边界必须如实展示，不得把凭据隔离、前置拦截、事后检测这三种不同来源的阻止效果混为一谈或伪装成更强的保证。
- **NFR-007**：Run 应有最大执行时长（P0 默认 30 分钟，可配置）；超过后系统应按取消兜底逻辑将其转为终态，不得让一个卡住但存活的 adapter 进程无限占用 workspace 锁。

## 5. 关键实体 / 概念

- **Codex CLI Adapter**：P0 唯一 agent adapter，负责启动本地 Codex CLI、接收输出、处理退出和取消。
- **Agent Adapter Registry**：根据 provider/role/capability 找到可用于当前 Issue 的 adapter。
- **Run**：一次 agent 执行记录，绑定 Issue、Thread、Workspace 和 adapter。
- **Run Event**：Run 生命周期和输出对应的 ThreadEvent。
- **Workspace Write Lock**：按 workspace 维度串行化写操作的锁。
- **Escalation**：遇到危险操作或能力边界时触发的硬阻塞事件。
- **Inspector**：右侧上下文面板，用于展示 Run status、logs 和 blockers。

## 6. 状态、工作流或生命周期

### Run Lifecycle

```text
queued      -> running      获取 workspace 写锁并启动 adapter
running     -> completed    adapter exitCode = 0
running     -> failed       adapter exitCode != 0 或启动/执行失败
running     -> interrupted  backend 重启 / runner 失联 / stale recovery
queued      -> cancelled    用户取消排队 Run
running     -> cancelled    用户取消运行中 Run
running     -> failed       危险操作或权限边界触发 escalation
```

规则：

- Run 创建后必须持久化，不能只存在于内存。
- Run 开始执行前必须获得 workspace 写锁。
- Run 进入终态后必须释放 workspace 写锁。
- 同一 workspace 的 queued Runs 按可解释顺序执行。
- `escalation` 不是 Run status。触发 escalation 时，Run 进入 `failed`，Thread 写入 `escalation.triggered` 和 `run.failed`，Issue 进入 `Blocked`，不会自动恢复 Running。
- 用户取消 Run 时，只有 Run 仍处于 `queued` 或 `running` 才能转为 `cancelled`；如果 Run 已经是终态，取消请求应返回当前终态，不重复释放锁。

### Escalation 联动

```text
Run running -> Run failed       危险操作或权限边界触发
Thread      -> escalation.triggered
Thread      -> run.failed
Issue       -> Blocked
```

事件顺序固定为：

```text
escalation.triggered -> run.failed -> issue.blocked
```

## 7. 成功标准

- **SC-001**：用户可以从 Issue primary Thread 启动一次真实 Codex CLI agent run，无需切换到 Codex CLI 终端。
- **SC-002**：Run status、run logs 和 run events 在 PersonaHub 中可见、可持久化、可重读。
- **SC-003**：同一 workspace 并发 run 不会同时执行写操作。
- **SC-004**：backend 重启不会导致 running Run 或 workspace lock 永久卡死。
- **SC-005**：危险 git push / force push 触发 escalation，且能力边界表达真实。

## 8. 验收清单

- [ ] **AC-001**（`FR-001`, `UX-001`）：用户可以创建、更新、删除至少一个本地 Codex CLI adapter，并获得路径/命令/args 可用性校验。
- [ ] **AC-002**（`FR-002`, `FR-003`, `IR-002`, `UX-002`）：用户可以在 Issue primary Thread 中输入开发指令，系统创建 Run 并调用 Codex CLI adapter。
- [ ] **AC-003**（`FR-004`, `DR-002`, `DR-003`, `UX-003`）：Run 状态按 `queued -> running -> completed/failed/interrupted/cancelled` 持久化，并能在 Inspector 中查看。
- [ ] **AC-004**（`FR-005`, `FR-006`, `TR-001` - `TR-006`, `UX-004`）：`run.queued` / `run.started` / `run.output` / `run.output_truncated` / `run.completed` / `run.failed` 被持久化为 ThreadEvent，并能按稳定顺序展示。
- [ ] **AC-005**（`FR-007`, `DR-004`, `NFR-002`）：同一 workspace 同一时刻只有一个 Run 执行写操作；后续 Run 排队。
- [ ] **AC-006**（`FR-008`, `TR-006`, `NFR-003`）：backend 重启后，遗留 `running` Run 被回收为 `interrupted`，对应 workspace lock 被释放。
- [ ] **AC-007**（`FR-009`, `TR-005`, `UX-006`）：用户可以取消 queued/running Run，状态和锁都被正确处理。
- [ ] **AC-008**（`FR-010`, `IR-003`, `UX-005`）：右侧 Inspector 实时展示 agent status 和 run logs。
- [ ] **AC-009**（`FR-011`, `FR-012`, `TR-009`, `TR-010`, `UX-007`, `NFR-006`）：`git push` / force push 触发 escalation；如果只能事后检测，UI 必须明确说明。
- [ ] **AC-010**（`TR-012`, `TR-013`, `NFR-004`）：run events 先写 SQLite 再广播，前端断线重连后可通过 `event_sequence` cursor 补读历史事件。
- [ ] **AC-011**（`FR-007`, `FR-012`, `TR-007`, `NFR-006`）：Issue 进入 `Blocked` 后，同 Issue 尚未启动的 queued Runs 被取消并记录原因，不会继续执行。
- [ ] **AC-012**（`FR-013`, `DR-008`）：Project 未显式开启 push 凭据时，Run 的执行环境不包含可用于 push 的 git 凭据，`git push` 因此自然失败并触发 escalation。

## 9. 测试计划

### 单元测试

- Adapter config validation。
- Adapter config update/delete。
- Adapter registry lookup。
- Run status transition。
- Workspace lock acquire/release。
- Run event payload builder。
- Escalation decision builder。

### 集成测试

- Thread command dispatch 创建 Run 并调用 fake Codex adapter。
- fake adapter stdout/stderr 被写入 `run.output` ThreadEvent。
- fake adapter exit 0 写入 `run.completed`。
- fake adapter exit non-zero 写入 `run.failed`。
- 同 workspace 两个 Run 串行执行。
- Issue Blocked 后 queued Run 不再启动。
- stale running Run recovery 释放 workspace lock。
- cancel queued/running Run。

### UI / 端到端测试

- 配置 Codex CLI adapter。
- 从 Thread 输入指令并看到 Run 状态变化。
- Inspector 展示 queued/running/completed/failed 状态和 logs。
- 刷新或重开 Issue 后仍能看到历史 run events。
- escalation blocker 展示。

### 手动验证

- 使用真实 Codex CLI 执行一个低风险指令。
- 验证 Codex CLI 是否支持长会话、resume、structured output 和 approval hook。
- 验证危险 git push / force push 能否前置拦截；如果不能，验证事后检测提示是否准确。
- 模拟 backend 在 Run 执行中重启。

## 10. 依赖

### 上游依赖

- F001 已完成 Project / Workspace / Issue / Thread / ThreadEvent 基础。
- `docs/decisions/0002-first-agent-adapter.md`：P0 首个 adapter 是 Codex CLI。
- 本地 backend runtime 使用 Node.js + TypeScript。

### 下游依赖

- v0.1.2 Development Trace 依赖 F002 的 Run 和 run events。
- v0.1.3 Autonomous Validation 依赖 F002 的 command dispatch、Run lifecycle 和 event stream。
- 后续多 adapter 支持依赖本 feature 的 adapter registry 边界。

### 外部 / 环境依赖

- 本地 Codex CLI 可执行文件或命令。
- 本地 Workspace path。
- 本地 SQLite。
- 可选 git executable，用于危险 git 操作检测或验证。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Codex CLI 会话模型未知 | Adapter 抽象可能返工 | F002 实现前先做能力 probe，并将结果回填 design |
| Codex CLI 不支持前置 approval hook（风险已下调，不再是硬阻塞的前提） | 原设计假设"硬阻塞"必须靠 CLI 的执行前 approval 钩子实现 | 已改为凭据隔离（`FR-013`）为主要防线，approval 钩子只是可观测性增强；参考 multica（`D:\Projects\multica\server\pkg\agent\codex.go`）验证协议存在，但即使拿不到该钩子，凭据隔离依然生效 |
| 凭据隔离机制在 Windows 下的行为未经实测（机制本身已选定） | 方案 (c) 依赖"子进程不会意外继承父进程 SSH agent/凭据缓存"，Windows 下 Git 的 credential manager 可能有系统级存储行为，需要专门验证 | 已选定方案 (c)，实现阶段专门做 Windows 验证（`tasks.md` T062）；验证失败则切换到方案 (a)/(b) |
| workspace lock 残留 | 后续 Run 永久排队 | 实现 stale Run recovery 和 lock release |
| CLI 输出量很大 | ThreadEvent 过多或 UI 卡顿 | design 中定义 chunking / truncation / log storage 策略 |
| 取消 running Run 不可靠 | 子进程残留或 lock 未释放 | cancel 后做进程状态确认和 lock cleanup |
| 前端断线丢 events | Thread trace 不可信 | 先写 SQLite 再广播，并支持 cursor 重读 |

## 12. 待确认问题

目前没有遗留的开放问题，以下五项均已关闭：

- **Q1（已关闭，probe 作为实现任务跟踪）**：Codex approval 钩子高置信度存在（依据：multica `codex.go` 对 `app-server` 协议的实现），已不作为设计问题，实测验证见 `tasks.md` T001-T003。
- **Q2（已关闭）**：P0 采用 one-shot invocation，不复用长会话；session resume 留作后续增量优化。
- **Q3（已关闭）**：单 Run stdout+stderr 合计最多持久化 1 MiB，超限写 `run.output_truncated`，不建完整日志存储。
- **Q4（已关闭）**：workspace lock 不做 lease/heartbeat，用 `locked_by_run_id` + 启动时 stale recovery。
- **Q5（已关闭）**：Git push 凭据隔离采用方案 (c)（默认不暴露凭据源）。依据：multica、clowder-ai 的子进程环境构造均未做 git/SSH 隔离，没有更优先例。Windows 兼容性验证见 `tasks.md` T062，失败则切换方案 (a)/(b)。

## 13. 可追踪性

| 规格项 | 来源 | 验证方式 |
| --- | --- | --- |
| `FR-001`, `FR-002` | PRD 8、决策 0002、架构 Agent Adapter | `AC-001`, adapter config tests |
| `FR-003`, `FR-004` | PRD 7.3、15 v0.1.1 | `AC-002`, `AC-003`, dispatch integration tests |
| `FR-005`, `FR-006`, `TR-001` - `TR-006` | PRD run events 验收、架构事件层 | `AC-004`, run event tests |
| `FR-007`, `DR-004`, `NFR-002` | PRD 11 workspace 锁 | `AC-005`, lock integration tests |
| `FR-008`, `NFR-003` | 架构 review 的 stale lock 风险 | `AC-006`, recovery tests |
| `FR-009`, `UX-006` | Run lifecycle 完整性 | `AC-007`, cancel tests |
| `FR-010`, `UX-003` - `UX-005` | PRD 7.3、10 Inspector | `AC-008`, UI/E2E tests |
| `FR-011`, `FR-012`, `TR-007`, `TR-009`, `TR-010`, `NFR-006` | PRD 11 escalation | `AC-009`, `AC-011`, manual Codex CLI verification |
| `FR-013`, `DR-008` | PRD 11 凭据与执行环境隔离、架构第 9 节 | `AC-012`, credential isolation tests |
| `TR-012`, `TR-013` | 架构事件持久化与 SSE | `AC-010`, replay tests |

## 14. 实现备注

- Codex CLI 能力 probe 的结果必须先写入 `design.md`，再最终确定 adapter session model。
- 如果发现 Codex CLI 无法前置拦截危险命令，不要在 UI 中暗示“已阻止执行”；必须说明是事后检测。
- F002 可以为 F003/F004 留出扩展点，但不实现 handoff、validation 或 artifact。

## 15. 参考

- `docs/personahub-prd.md`
- `docs/personahub-architecture.md`
- `docs/personahub-architecture-review.md`
- `docs/personahub-system-design.md`
- `docs/features/0.1/F001-workspace-issue-foundation/spec.md`
- `docs/features/README.md`
- `D:\Projects\multica`（本机开源参考项目，`server/pkg/agent/codex.go` 等文件是 Codex/Claude/OpenCode 等 CLI adapter 的真实实现，用于验证 Q1 及 `design.md` 中的 Adapter Capability Probe 假设；Go 实现，不可直接复用代码，仅供协议/设计参考）
- `D:\Projects\clowder-ai`（本机开源参考项目，用于交叉验证 Codex adapter 实现和"Hard Rails"安全机制的真实落地程度；发现其 Hard Rails 是纯 prompt 文本、无代码强制执行，直接促成了 `FR-013` 凭据隔离这一设计——两个参考项目都没有做到执行前拦截任意危险命令，凭据隔离是比二者都更可靠的防线）
