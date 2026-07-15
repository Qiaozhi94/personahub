---
feature_ids: [F002]
related_features: [F001]
topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, api, ui, v0.1.1]
doc_kind: design
created: 2026-07-12
updated: 2026-07-16
---

# F002：Agent Command Center - 设计

> Status: done | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

F002 在 F001 的 Project / Workspace / Issue / Thread 基础上，加入最小可运行 agent runtime：

```text
Thread user instruction
  -> Run created
  -> Workspace write lock acquired
  -> CodexCliAdapter started
  -> stdout/stderr persisted as ThreadEvents
  -> Inspector shows status/logs
  -> Run terminal state
  -> Workspace lock released
```

设计采用分层方式：

- **Adapter Registry** 负责根据 provider / capability 找到 Codex CLI adapter。
- **Run Service** 负责创建 Run、状态流转、取消、恢复。
- **Workspace Lock Service** 负责按 workspace 串行化执行。
- **Agent Runner** 负责子进程生命周期。
- **ThreadEvent Service** 负责先写 SQLite、再广播事件。
- **Inspector / Thread UI** 负责展示 Run 状态和日志。

真实 Codex CLI 能力未实测前，设计必须支持一个 `FakeAgentAdapter` 用于自动化测试。Codex CLI 的 session model、approval hook 和输出结构在实现初期通过 probe 关闭。

## 2. 影响面

- **前端**：Project/Agent 设置中的 Codex CLI adapter 配置；Thread 输入框 agent 指令提交；Thread run events 展示；Inspector Run status/logs/blockers；Run cancel action。
- **后端 / API**：adapter config API、thread command dispatch API、Run read/cancel API、ThreadEvent read/SSE API。
- **存储 / migration**：Agent/adapter config、Run 表、Workspace lock recovery 字段补充、ThreadEvent payload 扩展。
- **Runtime / agent adapter**：AdapterRegistry、CodexCliAdapter、FakeAgentAdapter、AgentRunner、WorkspaceLockService、stale recovery、`WorkspaceContext` 的 git 凭据隔离。
- **事件 / evidence**：`run.queued`、`run.started`、`run.output`、`run.output_truncated`、`run.completed`、`run.failed`、`run.cancelled`、`run.interrupted`、`escalation.triggered`、`issue.blocked`。
- **文档 / 配置**：Codex CLI probe 结果需要回填本 design；如 escalation 能力低于 PRD 承诺，需要回写架构或风险记录。

## 3. 数据模型 / Migration

### Agent / Adapter Config

F002 需要能保存 Project 级 Codex CLI adapter 配置。可复用 `Agent` 表，也可新增 adapter config 表；实现时选择一种并保持与 `system-design.md` 对齐。

最小字段：

- `id`
- `project_id`
- `name`
- `role`
- `cli_provider` = `codex`
- `command` 或 `executable_path`
- `args`
- `capability_tags`
- `default_model`
- `status`: `unknown` / `available` / `unavailable`
- `last_checked_at`
- `created_at`
- `updated_at`

约束：

- P0 只要求一个可用 Codex CLI adapter。
- `status` 来自 backend 可用性校验，不只来自用户输入。
- `command` / `executable_path` 与 `args` 必须按 executable + argv 建模，不允许直接把用户输入拼成 shell string 执行。
- `args` 默认是空数组；只允许存储单个 argv token，不做 shell 展开。
- `default_model` 可为空；未配置时由 Codex CLI 默认配置决定，避免把模型名写死为运行前置条件。

### Run

在 F002 中新增或补全 Run 持久化。

最小字段：

- `id`
- `issue_id`
- `thread_id`
- `workspace_id`
- `agent_id` 或 `adapter_config_id`
- `status`
- `failure_reason`
- `instructions`
- `started_at`
- `completed_at`
- `exit_code`
- `error_message`
- `created_at`
- `updated_at`

状态枚举：

- `queued`
- `running`
- `completed`
- `failed`
- `interrupted`
- `cancelled`

`failure_reason` 枚举（`status = failed` 或 `interrupted` 时填写，参考 clowder-ai/multica 源码对照分析中"failure_reason 应该是枚举而不是只有自由文本 error_message"的建议）：

- `adapter_exit_nonzero`：adapter 进程正常退出但 exit code 非 0。
- `spawn_failed`：子进程启动失败（命令不存在、权限不足等）。
- `execution_timeout`：Run 运行超过最大执行时长（见下方"执行超时"）。
- `credential_isolation_blocked`：因缺少 push 凭据导致操作失败触发 escalation（`FR-013`）。
- `pre_execution_approval_rejected`：CLI 的 approval hook 拒绝了危险操作（若可用）。
- `post_hoc_escalation`：事后检测到危险操作。
- `server_restarted`：backend 重启导致的 stale recovery（对应 `interrupted`）。
- `output_parse_failed`：无法解析 adapter 结构化输出。

约束：

- Run 必须绑定 Issue、Thread、Workspace。
- Run 创建后必须先持久化，再尝试启动 adapter。
- Run 进入终态后不可再回到 running，所有状态更新必须走 CAS（`UPDATE ... WHERE status = <expected>`），不允许无条件覆盖 `status` 列——这是 Run 状态机的全局不变量，不是 cancel 操作专属的处理方式（参考 clowder-ai `invocation-state-machine.ts` 显式转换表 + CAS 更新的模式，已核实其 CAS 逻辑落在 store 层而非状态机定义文件本身，PersonaHub 同样应该把转换合法性判断和 CAS 更新分开放在 RunService/Repository 层）。
- 合法转换：`queued -> running/cancelled`；`running -> completed/failed/interrupted/cancelled`；其余组合一律拒绝。
- `escalation` 不是 Run status；危险操作触发 escalation 时，Run 进入 `failed`，Issue 进入 `Blocked`。
- P0 中所有 Run 都按 workspace write run 处理，必须获取 workspace lock 后才能启动 adapter。

### 执行超时

F002 目前只在用户主动取消时处理"Run 卡住"的情况，没有覆盖"adapter 进程存活但长时间无输出、也不退出"的场景（例如 Codex CLI 挂起）。补充：

- `AgentAdapterCapabilities` 或 Run 创建时应记录一个 P0 默认执行超时（建议默认 30 分钟，可按 adapter 配置覆盖）。
- Run 超过该时长仍未进入终态时，按 cancel 的兜底逻辑处理：调用 `RunHandle.cancel()`，超时未响应则强制终止子进程，`failure_reason = execution_timeout`，释放 workspace lock。
- 这不是 P0 的阻塞项（用户仍可手动 cancel 卡住的 Run），但应在 design 中占位，避免无人值守时一个卡住的 Run 永久占着 workspace 锁。

### Issue 状态流转

F002 接管 F001 创建的 coding Issue 的执行态。P0 不要求单独的 owner agent 选择，因此只要 Project 有可用 adapter，`Inbox` Issue 也允许直接创建 Run。

状态约定：

- 创建 Run 成功后，如果 Issue 当前是 `Inbox` 或 `Ready`，立即将 Issue 置为 `Running`。
- Issue 为 `Blocked` 时禁止创建新 Run，返回 `409 ISSUE_BLOCKED`。
- Issue 为 `Running` 时允许继续排队创建 Run，但同 workspace 仍由 lock 串行执行；UI 可提示已有运行中/排队 Run。
- Run `completed` 后，F002 不做 validation，也不自动把 Issue 置为 `Done`；Issue 保持 `Running`，等待 F003/F004 的验证和完成语义接管。
- Run `failed`、`cancelled`、`interrupted` 默认不改变 Issue 状态；只有 escalation 会把 Issue 置为 `Blocked`。
- escalation 流程中必须写入 `issue.blocked` 事件，表示 Issue 状态已从 `Running` 或原状态进入 `Blocked`。

### Workspace Lock

复用 F001 的 `Workspace.lock_state` / `locked_by_run_id`，并建议补充：

- `locked_at`
- `lock_owner_instance_id`（可选）

P0 最低要求：

- `locked_by_run_id` 足以指向当前持锁 Run。
- backend 启动时可根据 `locked_by_run_id` 和 Run status 回收 stale lock。

### Git 凭据隔离字段

在 F001 的 `Workspace` 表上补充：

- `push_credentials_enabled`（boolean，默认 `false`）：是否为该 Workspace 下发 git push 凭据。

约束：

- 默认 `false`；只能由用户在 Project/Workspace 设置里显式改为 `true`。
- Run 启动 adapter 前，`WorkspaceContext` 根据这个字段决定是否把 push 凭据（SSH agent socket、cached credential）暴露给子进程环境；具体隔离机制见第 5 节"Git 凭据隔离实现"。

### ThreadEvent Payload

Run 相关 ThreadEvent payload 至少包含：

- `run_id`
- `issue_id`
- `thread_id`
- `workspace_id`
- `status`

`run.output` 额外包含：

- `stream`: `stdout` / `stderr`
- `chunk`
- `sequence`

输出约束：

- 单个 `run.output` chunk 建议上限 8 KiB UTF-8 文本。
- 单个 Run 默认最多保留 stdout + stderr 合计 1 MiB 输出；超过后继续更新 Run 状态，但写入 `run.output_truncated` 事件并停止持久化后续输出。
- `sequence` 在单个 Run 内从 1 开始递增，stdout/stderr 共用一个序列。

`escalation.triggered` 额外包含：

- `reason`
- `detected_operation`
- `blocked_by`: `credential_isolation` / `pre_execution_approval` / `post_hoc_detection`
- `pre_execution_blocked`: boolean（`credential_isolation` 和 `pre_execution_approval` 都为 `true`；只有 `post_hoc_detection` 为 `false`）
- `capability_note`

`issue.blocked` 额外包含：

- `issue_id`
- `run_id`
- `previous_status`
- `status`: `Blocked`
- `reason`

## 4. API / Contract 设计

F002 API 延续 F001 的本地 backend HTTP contract。以下 path 是设计 contract，具体框架实现可以调整 handler 名称，但 request / response / error shape 应保持稳定。Codex CLI probe 可能影响 adapter config 字段，但不应改变 Run / ThreadEvent 的核心 contract。

### Adapter Config

#### `POST /api/projects/:project_id/adapters`

保存 Codex CLI adapter config。

Request:

```json
{
  "cli_provider": "codex",
  "name": "Local Codex",
  "role": "implementation",
  "command": "codex",
  "args": [],
  "default_model": "gpt-5-codex"
}
```

Response `201`:

```json
{
  "adapter": {
    "id": "adp_...",
    "project_id": "prj_...",
    "name": "Local Codex",
    "role": "implementation",
    "cli_provider": "codex",
    "command": "codex",
    "args": [],
    "capability_tags": ["coding", "workspace-write"],
    "default_model": "gpt-5-codex",
    "status": "available",
    "last_checked_at": "2026-07-12T00:00:00.000Z",
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `400 ADAPTER_PROVIDER_UNSUPPORTED`
- `400 ADAPTER_COMMAND_REQUIRED`
- `400 ADAPTER_COMMAND_UNAVAILABLE`
- `404 PROJECT_NOT_FOUND`

#### `GET /api/projects/:project_id/adapters`

列出 Project adapters。

Response `200`:

```json
{
  "adapters": [
    {
      "id": "adp_...",
      "project_id": "prj_...",
      "name": "Local Codex",
      "role": "implementation",
      "cli_provider": "codex",
      "command": "codex",
      "args": [],
      "status": "available",
      "last_checked_at": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

#### `PATCH /api/adapters/:adapter_id`

更新 Codex CLI adapter config，并重新校验可用性。

Request:

```json
{
  "name": "Local Codex",
  "command": "codex",
  "args": [],
  "default_model": "gpt-5-codex"
}
```

Response `200`:

```json
{
  "adapter": {
    "id": "adp_...",
    "status": "available",
    "last_checked_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `404 ADAPTER_NOT_FOUND`
- `400 ADAPTER_COMMAND_UNAVAILABLE`

#### `DELETE /api/adapters/:adapter_id`

删除或停用 adapter config。P0 可以采用 soft delete / disabled 标记；删除后不再用于新 Run。

Response `204`。

Errors:

- `404 ADAPTER_NOT_FOUND`
- `409 ADAPTER_IN_USE`

#### `POST /api/adapters/:adapter_id/validate`

重新校验 adapter 可用性。

Response `200`:

```json
{
  "adapter": {
    "id": "adp_...",
    "status": "available",
    "last_checked_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `404 ADAPTER_NOT_FOUND`
- `400 ADAPTER_COMMAND_UNAVAILABLE`

### Thread Command Dispatch

#### `POST /api/issues/:issue_id/runs`

从 Issue primary Thread 创建 Run。

Request:

```json
{
  "instructions": "Implement the requested change.",
  "adapter_id": "adp_..."
}
```

Response `202`:

```json
{
  "run": {
    "id": "run_...",
    "issue_id": "iss_...",
    "thread_id": "thr_...",
    "workspace_id": "wsp_...",
    "adapter_config_id": "adp_...",
    "status": "queued",
    "started_at": null,
    "completed_at": null,
    "exit_code": null,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

行为：

- 校验 Issue / primary Thread / Workspace / Adapter；`thread_id` 由 server 从 `Issue.primary_thread_id` 解析，P0 不要求 client 传入。
- `adapter_id` P0 必填；后续如果引入 Project default adapter，可再放宽为可选。
- `instructions` trim 后不能为空。
- 创建持久化 Run。
- 创建 Run 的同一事务中，将 Issue 从 `Inbox` / `Ready` 更新为 `Running`；如果 Issue 已是 `Running`，保持不变。
- 写入 `run.queued` 事件，保证 Thread trace 中有完整生命周期。
- 如果 workspace lock 可用，可以很快转为 `running`，但 API 初始响应允许返回 `queued`。
- 后续状态通过 Run read API、Thread events 或 SSE 观察。

Errors:

- `404 ISSUE_NOT_FOUND`
- `400 RUN_INSTRUCTIONS_REQUIRED`
- `409 ISSUE_BLOCKED`
- `409 WORKSPACE_REQUIRED`
- `409 ADAPTER_REQUIRED`
- `409 ADAPTER_UNAVAILABLE`

### Run Read / Cancel

#### `GET /api/runs/:run_id`

读取 Run。

Response `200`:

```json
{
  "run": {
    "id": "run_...",
    "issue_id": "iss_...",
    "thread_id": "thr_...",
    "workspace_id": "wsp_...",
    "adapter_config_id": "adp_...",
    "status": "running",
    "started_at": "2026-07-12T00:00:00.000Z",
    "completed_at": null,
    "exit_code": null,
    "error_message": null,
    "created_at": "2026-07-12T00:00:00.000Z",
    "updated_at": "2026-07-12T00:00:00.000Z"
  }
}
```

Errors:

- `404 RUN_NOT_FOUND`

#### `GET /api/issues/:issue_id/runs`

列出 Issue Runs。

Response `200`:

```json
{
  "runs": [
    {
      "id": "run_...",
      "issue_id": "iss_...",
      "thread_id": "thr_...",
      "workspace_id": "wsp_...",
      "status": "completed",
      "started_at": "2026-07-12T00:00:00.000Z",
      "completed_at": "2026-07-12T00:01:00.000Z",
      "exit_code": 0
    }
  ]
}
```

排序：按 `created_at desc`。

#### `POST /api/runs/:run_id/cancel`

取消 queued/running Run。

Response `200`:

```json
{
  "run": {
    "id": "run_...",
    "status": "cancelled",
    "completed_at": "2026-07-12T00:00:00.000Z"
  }
}
```

行为：

- 使用状态 CAS。
- 如果 Run 已是终态，返回当前 Run，不改变状态。
- 如果 Run 是 `queued`，直接置为 `cancelled`，写 `run.cancelled`，不触碰 workspace lock。
- 如果 Run 是 `running`，调用 `RunHandle.cancel()`；取消成功后置为 `cancelled`，写 `run.cancelled`，并释放 workspace lock。
- 如果 `RunHandle.cancel()` 在超时时间内未完成，尝试强制终止子进程；强制终止成功仍置为 `cancelled`，失败则置为 `interrupted` 并释放 workspace lock。
- P0 cancel 超时时间建议为 5 秒。

Errors:

- `404 RUN_NOT_FOUND`

### Thread Events / SSE

#### `GET /api/threads/:thread_id/events`

读取 Thread events。F002 复用 F001 endpoint，并要求支持 run events 和 cursor。

Query:

- `after_event_id` optional

Response `200`:

```json
{
  "events": [
    {
      "id": "evt_...",
      "thread_id": "thr_...",
      "type": "run.output",
      "actor_type": "agent",
      "actor_id": "adp_...",
      "payload_json": {
        "run_id": "run_...",
        "issue_id": "iss_...",
        "thread_id": "thr_...",
        "workspace_id": "wsp_...",
        "status": "running",
        "stream": "stdout",
        "sequence": 1,
        "chunk": "..."
      },
      "created_at": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```

#### `GET /api/threads/:thread_id/events/stream`

SSE 订阅 Thread events。

Query / headers:

- `after_event_id` optional
- `Last-Event-ID` optional

行为：

- 先按 cursor 从 SQLite 补历史 events。
- 再订阅新 events。
- SSE event id 使用 F001 定义的 ThreadEvent `event_sequence` cursor。

### 错误结构

复用 F001 的结构化错误：

```json
{
  "error": {
    "code": "ADAPTER_UNAVAILABLE",
    "message": "Codex CLI adapter is unavailable.",
    "field": "adapter_id",
    "details": {}
  }
}
```

## 5. Runtime / Workflow 设计

### Adapter Capability Probe

**Probe 已完成。本地 Codex CLI 版本：codex-cli 0.144.1（Windows）。**

probe 不是从零摸索--参考开源项目 multica（本机路径 `D:\Projects\multica`，实现见 `server/pkg/agent/codex.go`）对同一个 Codex CLI 的真实生产实现，已经给出了一套具体假设，probe 的任务是验证这套假设对本地安装的 Codex CLI 版本是否成立。以下为逐条验证结果：

- **启动方式（✅ 已确认）**：`codex app-server --listen stdio://`，建立 JSON-RPC 2.0 连接。`--listen` 默认值就是 `stdio://`，也支持 `unix://`、`ws://IP:PORT`。`codex exec --json` 是更简单的 JSONL 一次性模式，但拿不到 approval hook，F002 不采用。
- **one-shot invocation（✅ 已确认）**：每次任务 spawn 一个新的 `app-server` 进程，走 `initialize -> thread/start -> turn/start -> 等待 turn/completed`，结束后关闭 stdin + cancel context 让进程自行退出。`initialize` 需要 `clientInfo`（`name` + `version`）+ 可选 `capabilities`。`thread/start` 可传入 `cwd`、`approvalPolicy`、`sandboxPolicy`、`baseInstructions`。`turn/start` 接收 `input: UserInput[]`（text/image/localImage/skill/mention），并可覆盖 `model`、`cwd`、`sandboxPolicy`、`approvalPolicy`、`outputSchema`。
- **session resume（✅ 已确认）**：`thread/resume` 方法存在（`ThreadResumeParams` schema 36KB），可携带上一次任务的 thread id 延续上下文。F002 P0 采用 one-shot，session resume 留作后续增量优化。
- **pre-command approval / permission hook（✅ 已确认，比假设更丰富）**：Codex app-server 在执行命令/改文件前会发送 server request（JSON-RPC 2.0 `id` 字段非空，需要 response 回复）：
  - 新协议：`item/commandExecution/requestApproval`（`CommandExecutionRequestApprovalParams`：含 `command`、`cwd`、`commandActions`、`threadId`、`turnId`、`itemId`），调用方回复 `{"decision": "accept"|"acceptForSession"|"decline"|"cancel"}`。
  - 新协议：`item/fileChange/requestApproval`（`FileChangeRequestApprovalParams`：含 `threadId`、`turnId`、`itemId`、`grantRoot`、`reason`），调用方回复 `{"decision": "accept"|"acceptForSession"|"decline"|"cancel"}`。
  - 旧协议仍存在：`execCommandApproval` / `applyPatchApproval`。
  - 还有 `permissions/requestApproval`（`PermissionsRequestApprovalParams`）用于权限升级请求。
  - **`decline` 让 agent 继续当前 turn（不中断），`cancel` 同时中断 turn**--escalation 场景应使用 `cancel`。
- **structured output（✅ 已确认）**：输出是 JSON-RPC 通知，包括 `thread/started`、`turn/started`、`turn/completed`（含结构化 `Turn` 对象）、`item/started`、`item/completed`（37KB schema，包含 text/tool_use/tool_result/status 等结构化类型）、`agent_message_delta`、`command_exec_output_delta`、`file_change_output_delta`、`process_output_delta`、`plan_delta`、`error` 等。
- **cancellation（✅ 已确认，比假设更好）**：**有**单独的"取消当前 turn"RPC 调用：`turn/interrupt`（`TurnInterruptParams`：`threadId` + `turnId`，返回 `TurnInterruptResponse`）。这比假设的"只能关闭 stdin + cancel context"更优雅。实现时先调 `turn/interrupt`，超时未响应再 fallback 到关闭 stdin + kill 进程。

probe 结果已回填本节。如有出入以本地实测为准。

在 probe 结束前，自动化测试使用 `FakeAgentAdapter` 覆盖 runtime 流程。

### Adapter 接口

建议接口：

```ts
interface AgentAdapter {
  provider: "codex"
  capabilities: AgentAdapterCapabilities
  validate(config: AdapterConfig): Promise<AdapterValidationResult>
  start(input: AgentRunInput): Promise<RunHandle>
}

interface AgentRunInput {
  runId: string
  issueId: string
  threadId: string
  workspace: WorkspaceContext
  instructions: string
  context: string
}

interface RunHandle {
  runId: string
  onOutput(cb: (event: RunOutputChunk) => void): void
  onExit(cb: (result: RunExitResult) => void): void
  cancel(): Promise<void>
}
```

P0 推荐默认采用 **one-shot invocation**：每条 Thread 指令创建一个 Run，由 Run Service 组装当前上下文传给 Codex CLI。若 probe 证明 session resume 稳定，再在 design 中更新。

可选增强（非 P0 要求）：如果 probe 确认 Codex 支持 `thread/resume`，后续可以在 `Run` 上记录 Codex 自己返回的 thread id，下一次同 Issue 的 Run 通过 `thread/resume` 携带同一 id，让 Codex 自己延续上下文，而不是完全依赖 Run Service 手工拼接 Thread 历史。这能减少对 `context: string` 拼接质量的依赖，但不是 F002 的阻塞项，可以作为 F002 之后的增量优化。

该接口是架构文档第 3 节 `AgentAdapter` 的 F002 落地版：新增 `validate()` 是为了支持 Project 级 adapter 配置校验；`start()` 使用 `Promise<RunHandle>` 是为了适配真实子进程启动失败；`context: string` 是 F002 的简化形式，因为结构化 `HandoffPacket` 要到 v0.1.2 才进入范围。F002 实现稳定后，需要回写 `docs/personahub-architecture.md` 第 3 节。

**不变量：`instructions`/`context` 不得进入子进程 argv。** 参考 clowder-ai `CodexAgentService` 的做法——prompt 通过 stdin 或协议 message 传入，argv 只放 flags——这不是新决定，而是 F002 选择 `app-server` JSON-RPC 协议本身已经隐含的结果（`instructions`/`context` 走 `turn/start` 请求参数，不是命令行参数），这里只是把它显式写成一条不允许违反的约束：任何 adapter 实现都不能为了图省事把 instructions 拼进 `args` 传给 `child_process.spawn`，否则 prompt 会出现在进程列表（`ps`/任务管理器）里，属于信息泄露。

### Dispatch Workflow

```text
validate Issue / primary Thread / Workspace
resolve required Codex adapter from registry
begin transaction
  create Run(status = queued)
  set Issue status = Running when current status is Inbox or Ready
  write run.queued
commit transaction
enqueue Run by workspace_id in FIFO order
try acquire workspace lock
  if lock acquired:
    set Run running and Workspace locked in one transaction
    write run.started
    start adapter process
    stream output -> write run.output -> broadcast
    on exit:
      set completed/failed
      write terminal event
      release lock
      start next eligible queued Run for workspace
```

队列顺序：同一 workspace 内按 `Run.created_at asc, Run.id asc` FIFO 启动。不同 workspace 的 Run 可以并行。

启动 queued Run 前必须重新读取该 Run 所属 Issue：

- 如果 Issue 已是 `Blocked`，Run 不得启动 adapter。
- 系统应将该 queued Run CAS 更新为 `cancelled`，写入 `run.cancelled`，payload reason 为 `issue_blocked_before_start`。
- 然后继续检查同 workspace 的下一条 queued Run。
- 这条检查必须同时用于正常 lock release、cancel release 和 stale recovery 后的 queue drain。

Context 组装：

- P0 `context` 至少包含 Issue title、Issue goal、workspace path、当前 thread id、run id。
- 可以附加同 Thread 最近事件摘要，但不得依赖未实现的 HandoffPacket。
- 用户本次输入的 `instructions` 必须原样进入 adapter input。

### Workspace Lock

最低实现：

- 获取锁：在 repository transaction 中检查 Workspace 是否 idle 且 Run 仍为 `queued`；若成立，同时写 `Workspace.lock_state = locked`、`Workspace.locked_by_run_id = run_id`、`Run.status = running`、`Run.started_at = now`。
- 释放锁：Run 进入终态后，将 Workspace 写回 `idle` 并清空 `locked_by_run_id`。
- 排队：同 workspace 新 Run 保持 `queued`，由 backend 在锁释放后启动下一条。

避免：

- 只用内存 mutex，不写 DB。
- 先启动子进程再抢锁。
- Run 失败后忘记释放锁。

### Stale Recovery

backend 启动时：

```text
find Runs where status = running
for each Run:
  mark interrupted
  write run.interrupted ThreadEvent
  if Workspace.locked_by_run_id = run.id:
    release Workspace lock
find Workspaces where lock_state = locked and locked_by_run_id points to terminal/missing Run:
  release stale lock
```

P0 不需要恢复旧子进程继续执行；直接标记 interrupted 更清楚。

### Git 凭据隔离实现

这是 git push 风险的主要防线（`FR-013`），优先级和可靠性都高于下面的 approval hook 拦截——它不依赖任何 CLI 内部协议，因此不会随 Codex CLI（或未来的 Claude Code / OpenCode adapter）版本变化而失效。参考 multica 和 clowder-ai 的交叉验证：两个项目都没有做到"执行前拦截任意危险命令"，multica 有拦截通道但选择永远 accept，clowder-ai 干脆让 Codex 跑在 `danger-full-access` 沙箱模式下没开这个通道——这说明"事前拦截"本身投入产出比不高，凭据隔离才是更值得投入的防线。

**决定：方案 (c)——默认不暴露任何凭据源。** 已排查 multica 和 clowder-ai 的子进程环境构造代码（`buildChildEnv()`/`ENV_VARS_TO_STRIP`、`isFilteredChildEnvKey()`），两者 spawn agent CLI 时都是完整继承父进程环境变量（包括 `SSH_AUTH_SOCK`、`HOME`），只过滤了 LLM provider 认证相关的变量（API key、OAuth token、CLI 嵌套检测标记），**没有一个项目对 git/SSH 凭据做任何隔离**。这意味着这里没有可以直接复用的现成实现，PersonaHub 是在建立新的实践，不是照抄一个已验证的模式。

不过两个项目过滤环境变量的**代码形状**可以复用：`WorkspaceContext` 构造子进程环境时，采用同样的"从完整环境变量里按黑名单剔除"模式（对应 clowder `buildChildEnv()` / multica `isFilteredChildEnvKey()`），黑名单里加入 `SSH_AUTH_SOCK`，并且不把 `HOME`/`USERPROFILE` 指向用户真实主目录（避免子进程通过 `~/.ssh`、`~/.git-credentials` 或系统级 credential store 拿到凭据）。`push_credentials_enabled = false` 时，push 会因为完全没有可用凭据源而失败，不需要专门识别"这是不是 push 命令"。

其余候选机制降级为方案 (c) 验证失败时的备选：

- **(a) `GIT_SSH_COMMAND` 覆盖**：指向无 push 权限 key（或 `/bin/false`/等价命令），SSH 协议的 push 会因为认证失败而失败。
- **(b) 专用 credential helper**：PersonaHub 提供自己的 git credential helper，push 请求经过它时按 `Workspace.push_credentials_enabled` 决定是否放行凭据。

由于没有先例可循，实现前必须在 Windows 环境下专门验证子进程默认不会意外继承父进程的凭据缓存（例如 Git for Windows 的 credential manager 是否走系统级存储、是否绕过环境变量隔离）；如果验证发现方案 (c) 在 Windows 下难以控制，再切换到 (a)/(b)。

`Workspace.push_credentials_enabled = true` 时，`WorkspaceContext` 正常暴露用户配置的 push 凭据，不做额外拦截——这是 operator 显式做出的信任决定。

### Escalation Path

凭据隔离是主要防线，下面两条是它之上的可观测性 / 兜底路径，不是安全底线本身。Codex CLI 能否前置拦截危险命令由 probe 决定，但已有高置信度的具体实现路径可参考（见 multica `server/pkg/agent/codex.go` 对 `item/commandExecution/requestApproval` / `item/fileChange/requestApproval` 的处理）：

- **凭据隔离阻止（主要防线）**：`push_credentials_enabled = false` 时，push 因为缺少凭据失败，adapter 捕获到这个失败（进程 exit code 或 stderr 匹配 git 认证失败的特征），写 `escalation.triggered`（`blocked_by = credential_isolation`，`pre_execution_blocked = true`），Run 标记为 `failed`，Issue 置 `Blocked`。
- **支持 approval hook（✅ probe 已确认）**：CodexCliAdapter 作为 JSON-RPC 客户端接住 Codex 发来的 `item/commandExecution/requestApproval` / `item/fileChange/requestApproval`（或旧协议 `execCommandApproval` / `applyPatchApproval`）请求，解析其中的命令/文件变更内容，套用 escalation 策略（命中 `git push`、force push、受保护分支写入等黑名单）：命中则回复 `{"decision": "cancel"}`（同时中断 turn） 并写 `escalation.triggered`（`blocked_by = pre_execution_approval`，`pre_execution_blocked = true`），未命中则回复 `{"decision": "accept"}` 放行。这是 multica 本身没有使用、但协议已确认支持的路径——multica 出于"全自动执行"的产品定位选择无条件 accept，PersonaHub 需要反过来在这里做真正的判断。凭据隔离作为独立防线始终生效，两层互不依赖。
- **事后检测（兜底路径，仅覆盖凭据隔离未生效的场景，例如 `push_credentials_enabled = true` 但仍需要审计）**：通过输出、git 状态、命令记录或可用日志做事后检测；一旦发现，写 `escalation.triggered`（`blocked_by = post_hoc_detection`），将 Run 标记为 `failed`，释放 workspace lock，Issue 置 `Blocked`，payload 中 `pre_execution_blocked = false`，UI 明确说明不是前置阻止。

`escalation` 不是 Run status。事件顺序固定为：

```text
escalation.triggered -> run.failed -> issue.blocked
```

`issue.blocked` payload 必须包含触发的 `run_id`、`previous_status` 和 `reason`。写入 `issue.blocked` 后，Issue 状态必须已经持久化为 `Blocked`，避免 UI 看到事件和状态不一致。

本 feature 不应假装具备不可验证的 sandbox 能力。

## 6. UI 设计说明

### Adapter Settings

- 显示 Codex CLI adapter 配置状态。
- 支持保存/重新校验 adapter。
- 无效配置显示明确错误。

### Thread Command Input

- 在 Issue primary Thread 中允许用户输入 agent 指令。
- 提交后显示 Run 创建状态。
- 当 Issue Blocked 或 adapter unavailable 时禁用提交并显示原因。

### Thread Event List

- 展示 `run.queued`、`run.started`、`run.output`、`run.output_truncated`、`run.completed`、`run.failed`、`run.cancelled`、`run.interrupted`、`escalation.triggered`、`issue.blocked`。
- `run.output` 可折叠或按 chunk 合并展示，避免日志刷屏。

### Inspector

- 展示当前/最近 Run status。
- 展示 queued/running/completed/failed/interrupted/cancelled 状态。
- 展示 run logs。
- 对 queued/running Run 提供 cancel action。
- escalation 时展示 blocker、原因和能力边界。

## 7. Event / Trace 设计

### `run.queued`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "queued"
}
```

### `run.started`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "running",
  "adapter_provider": "codex"
}
```

### `run.output`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "running",
  "stream": "stdout",
  "sequence": 1,
  "chunk": "..."
}
```

### `run.output_truncated`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "running",
  "max_bytes": 1048576
}
```

### `run.completed`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "completed",
  "exit_code": 0
}
```

### `run.failed`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "failed",
  "exit_code": 1,
  "error_message": "...",
  "failure_reason": "adapter_exit_nonzero"
}
```

### `run.cancelled`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "cancelled",
  "reason": "user_cancelled"
}
```

### `run.interrupted`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "status": "interrupted",
  "reason": "server_restarted"
}
```

### `escalation.triggered`

```json
{
  "run_id": "...",
  "issue_id": "...",
  "thread_id": "...",
  "workspace_id": "...",
  "reason": "dangerous_git_operation",
  "detected_operation": "git push",
  "blocked_by": "credential_isolation",
  "pre_execution_blocked": true,
  "capability_note": "Push failed: no push credentials provisioned for this workspace."
}
```

`blocked_by` 为 `pre_execution_approval` 或 `post_hoc_detection` 时的 payload 示例见第 5 节"Escalation Path"。

### `issue.blocked`

```json
{
  "issue_id": "...",
  "run_id": "...",
  "previous_status": "Running",
  "status": "Blocked",
  "reason": "dangerous_git_operation"
}
```

所有事件流程：

```text
create ThreadEvent in SQLite
commit
broadcast through in-process event bus / SSE
```

## 8. 失败处理

- **校验错误**：adapter 命令不可用、Issue/Thread 不匹配、Workspace 缺失、Issue 已 Blocked 时返回结构化错误。
- **权限 / escalation 失败**：危险 git 操作触发 `escalation.triggered`；Run 进入 `failed`；Issue 置 `Blocked`；系统释放 workspace lock。
- **Blocked 后排队 Run**：启动 queued Run 前如果发现 Issue 已 `Blocked`，将该 Run 置为 `cancelled`，写 `run.cancelled`，reason 为 `issue_blocked_before_start`，不得启动 adapter。
- **取消竞态**：取消请求必须使用状态 CAS；只有 `queued` / `running` 可以转为 `cancelled`。如果 Run 已经进入 `completed` / `failed` / `interrupted` / `cancelled`，取消请求返回当前状态，不再次释放锁。running Run 取消超时后按 cancel 兜底策略转为 `cancelled` 或 `interrupted`。
- **持久化失败**：Run 状态更新与事件写入失败时，不启动新子进程；若子进程已运行，尝试取消并记录 server error。
- **进程 / runtime 失败**：spawn 失败 -> Run `failed`（`failure_reason = spawn_failed`）；exit code 非 0 -> Run `failed`（`failure_reason = adapter_exit_nonzero`）；父进程重启 -> stale Run `interrupted`（`failure_reason = server_restarted`）；执行超时 -> Run 转终态（`failure_reason = execution_timeout`）。
- **输出过量**：超过单 Run 输出上限后写 `run.output_truncated`，停止持久化后续 output chunk，但不得中断 Run。
- **恢复行为**：启动时回收 `running` Run 和 stale workspace lock；不尝试复活旧子进程。

## 9. 测试策略

- **单元测试**：adapter config validation、registry lookup、Run transition（含非法转换被拒绝的 CAS 测试）、lock acquire/release、event payload builder、escalation decision、`failure_reason` 枚举赋值、执行超时触发逻辑、`WorkspaceContext` 凭据隔离（`push_credentials_enabled` 为 `false`/`true` 两种情况下环境变量构造是否正确）。
- **集成测试**：使用 `FakeAgentAdapter` 验证 dispatch、stdout/stderr event、completion/failure、queue、cancel、stale recovery。
- **UI / E2E**：配置 adapter、Thread 提交指令、Inspector 状态变化、日志展示、cancel、历史 events 重读、escalation blocker。
- **手动验证**：真实 Codex CLI probe、低风险真实 run、危险 git push / force push 能力边界、backend 中途重启。

## 10. 设计决策

| 决策 | 理由 | 替代方案 |
| --- | --- | --- |
| P0 默认 one-shot invocation | 简化 Run 边界、恢复和测试；每条 Thread 指令对应一个可审计 Run | 长会话复用上下文，但需要可靠 session resume |
| 自动化测试使用 FakeAgentAdapter | 真实 Codex CLI 行为和环境不稳定，不能作为常规测试基础 | 所有测试跑真实 CLI，但会慢且脆 |
| Workspace lock 持久化到 DB | 进程重启后才能发现和回收 stale lock | 只用内存 mutex，重启后不可追踪 |
| stale running Run 重启后标记 interrupted | 本地 CLI 子进程无法可靠恢复归属 | 尝试恢复旧进程，但复杂且不可靠 |
| 事件先写库再广播 | 保证断线重连能补历史 | 先广播再写库会丢 trace |
| escalation 能力以 probe 结果为准 | 不承诺无法技术保证的前置拦截 | 文档宣称硬阻塞，但实现只能事后检测 |
| escalation 触发时 Run 进入 `failed` | 避免新增 `escalation` 伪状态；具体原因由 `escalation.triggered` 事件表达 | 新增第七个 Run status，但会混淆 Run 状态与 Issue 阻塞状态 |
| P0 workspace lock 不做 lease/heartbeat | `locked_by_run_id` + startup recovery 已能覆盖 F002 崩溃恢复底线 | 现在引入 lease/heartbeat，但会增加本地 runtime 复杂度 |
| `adapter_id` P0 必填 | 避免默认 adapter 选择规则不清晰 | 自动选择第一个 available adapter，但多 adapter 时会不可解释 |
| `thread_id` P0 由 server 解析 | F001 保证每个 Issue 有 primary Thread，减少 client 输入和错误路径 | client 显式传 thread_id，但当前多 Thread 尚未进入范围 |
| 创建 Run 时 Issue 进入 `Running` | F001 的 `Inbox` 需要被执行动作推进，否则 UI 状态无处变化 | 继续保持 `Inbox`，但会与 Run 正在执行矛盾 |
| Run 完成后不自动关闭 Issue | validation/done 语义属于后续 feature | Run completed 直接置 Done，但缺少验证闭环 |
| `run.queued` 必须写入事件 | Thread trace 可完整解释用户提交和排队 | 只在 Run 表体现 queued，但事件流不完整 |
| 同 workspace Run FIFO | 行为可解释、测试简单 | priority queue，但 P0 未定义优先级语义 |
| command 不经 shell 拼接执行 | 降低本地命令注入和转义风险 | 接收任意 shell string，但安全边界不清楚 |
| adapter config 支持 `args`、更新和删除 | Codex CLI probe 可能需要 flags，用户也需要修正错误配置 | 每次创建新 adapter，但错误记录会堆积且 schema 扩展性差 |
| Issue Blocked 后取消 queued Runs | escalation 必须硬阻塞，不能让已排队 Run 绕过入口校验 | 只拦截新请求，但已排队 Run 仍可能继续执行 |
| 参考 multica 采用 `app-server` JSON-RPC 协议对接 Codex，而非简单 exec 模式 | 已有真实生产实现证明该协议支持前置 approval 拦截、结构化输出和 thread/resume，降低从零摸索的风险 | 用简单的 `codex exec` 一次性文本模式，实现更简单但拿不到前置拦截和结构化输出能力 |
| Git push 安全性的主要防线改为凭据隔离，而非命令拦截 | multica、clowder-ai 两个参考项目都没有做到执行前拦截任意危险命令，说明这条路投入产出比低；凭据隔离不依赖 CLI 内部协议，更可靠 | 继续只依赖 approval hook 拦截，但 CLI 版本变化或钩子缺失时会直接失去安全底线 |
| Run 状态更新全部走 CAS，转换合法性用显式表定义 | 参考 clowder-ai `invocation-state-machine.ts` 的显式转换表模式（已核实真实存在且被 CAS 更新使用）；防止并发更新或代码疏漏导致非法状态跳转 | 只在 cancel 场景做 CAS，其余更新直接覆盖，实现更简单但状态一致性没有统一保证 |
| Run 新增 `failure_reason` 固定枚举 | 参考 multica `failure_reason` 字段设计；现有 `error_message` 是自由文本，无法用于统计或自动化判断失败类型 | 只保留 `error_message`，但无法区分"CLI 崩了"和"escalation 拦截"等不同处理路径 |
| Run 增加执行超时（默认 30 分钟） | Codex CLI 可能挂起但进程不退出、也不输出，当前只有用户手动 cancel 才能结束，无人值守时会永久占用 workspace 锁 | 不设超时，依赖用户发现并手动 cancel，但不适合"无需人工盯着"的产品定位 |
| adapter/Run 明确不变量：instructions/context 不进入子进程 argv | 参考 clowder-ai `CodexAgentService` 通过 stdin/协议 message 传 prompt 的做法；避免 prompt 出现在进程列表造成信息泄露 | 允许 adapter 自行决定传参方式，但会为未来 adapter 实现留下不一致的风险 |
| Git 凭据隔离选方案 (c)：默认不暴露任何凭据源 | 排查 multica/clowder-ai 的子进程环境构造代码，确认两者都完整继承父进程环境、不做 git/SSH 凭据隔离——没有先例可循，但也没有更优方案；(c) 比 (a)/(b) 实现成本低，只需控制环境变量构造 | 方案 (a) `GIT_SSH_COMMAND` 覆盖或 (b) 专用 credential helper，留作 (c) 在 Windows 下验证失败时的备选 |

## 11. 待确认设计问题

目前没有待确认的设计问题。此前列出的五项已解决或转为实现阶段的验证任务，不再作为设计层面的悬而未决事项：

- Codex CLI 的 approval hook、one-shot 命令格式、cancellation 机制：高置信度假设已写入第 5 节"Adapter Capability Probe"，实测验证作为 `tasks.md` Phase 1（T001-T003）的任务执行，不是设计问题。
- workspace lock 的 `locked_at`/`lock_owner_instance_id`：已决定 P0 不做 lease/heartbeat，字段是否保留属于实现细节，不影响设计。
- Git 凭据隔离机制：已决定方案 (c)，见第 5 节"Git 凭据隔离实现"和第 10 节设计决策；Windows 环境下的验证同样作为实现阶段任务（`tasks.md` T062）。
