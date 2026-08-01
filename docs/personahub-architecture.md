---
topics: [architecture, runtime, module-design, agent-team-os, validation, workflow]
doc_kind: design
created: 2026-07-12
updated: 2026-07-29
---

# PersonaHub 软件架构设计

> Status: draft | Owner: TBD

## 修订记录

| 日期 | 来源提交 | 修订目的 | 修订内容 |
| --- | --- | --- | --- |
| 2026-07-29 | `docs/decisions/0006-executable-work-graph.md` | 第三至五轮复核依次发现：第 5 节 Slice 1 完成判据遗漏 ADR 0006 要求的"可恢复"语义；`orchestrator_subagent` 的并行范围未说明与第 2 节"Agent Runner"行 v0.1 workspace 排他锁基线的关系；对照 `server/src/runtime/types.ts` 与三个 adapter 实现代码核实后确认"只读 Node 不持锁并行"当前无运行时强制手段；随后又发现"用 `git worktree`/目录拷贝做隔离"这个缓解方案本身不成立——`cwd` 不是文件系统权限边界，`git worktree` 还与主仓库共享 `.git` 管理元数据，均已修正 | 第 5 节"实际实现"补充"可恢复"语义指向 ADR 0006；第 2 节"Workspace 执行边界"行改为如实描述 `WorkspaceContext` 当前字段、注明无访问模式字段；"从 v0.1 到 v0.7 的平滑路径"末尾及第 5 节并行范围描述均改为指向 ADR 0006 定义的强制隔离条件（操作系统层面不可访问活 workspace），明确普通 worktree/拷贝不满足该条件，未落地验证前只读 Node 也须留在串行队列 |
| 2026-07-28 | `docs/decisions/0006-executable-work-graph.md` | 两轮代码/文档检视发现第 5 节描述的 `TopologyExecutor`/`SequentialTopologyExecutor` 从未实现、且第一轮修正仍把 `steps_json` 顺序切换误述为已实现逻辑、第 11 节仍引用已过期的 `TopologyExecutor` 作为未来扩展点，均已修正为与实际代码及 ADR 0006 一致 | 第 5 节原设计草图标注为"未实现，仅存档"；新增"实际实现"小节，如实描述 `collaboration_topology`/`steps_json` 是不驱动执行的描述性字段（澄清 `steps_json` 顺序切换从未实现，不是"实现了但没走 TopologyExecutor"）、真正顺序硬编码在 `ValidationWorkflowService`；`orchestrator_subagent` 等非 sequential topology 的目标架构改为指向 ADR 0006，并注明 Slice 1 是能力验收而非预先约定新建运行时表；第 11 节移除对 `TopologyExecutor` 作为有效扩展点的引用 |
| 2026-07-22 | F005 Phase 0-13 | 同步 F005（Manual Multi-Agent Routing）落地后架构层的实际变化，第 3 节 P0-only 描述和第 5.2 节单阶段 validator 创建描述均已过期 | 第 3 节改写为 Codex/Claude Code/OpenCode 三个真实落地 adapter（非预留占位），接口补充 `validate()`/`auth_type`/`model_provider`/`api_key`/`onTrace`；第 5.2 节补充 F005 两阶段（grace window + `ManualRoutingService`/`ValidationDispatchScheduler` 互斥）validator dispatch 流程；第 5.7 节 schema 版本 v5→v6；第 1 节分层图同步三 adapter |
| 2026-07-18 | `4d13cab` | 同步 PRD 对 v0.4 渐进式多场景扩展和 AgentOps 前置数据采集的产品调整 | 明确非 coding Workflow 按任务范式逐个做垂直切片，不能把场景差异压成模板 JSON；补充 Windows 排障、knowledge/research、writing 三类执行与证据边界；明确 v0.1–v0.3 先保存可派生的最小原始信号，v0.5 再建设完整 AgentOps 聚合与评价能力 |
| 2026-07-17 | `4829752` | 让 F003 Development Trace 的事件回放和 evidence 引用契约与真实实现一致，并为 v0.3 Artifact 扩展保留兼容路径 | 将事件 cursor 从“全局递增 id”修正为稳定 ULID `id` 去重、Thread 内 `event_sequence` 排序；统一 v0.1 typed evidence refs（`event:` / `file-change-set:`），并约定 v0.3 通过新增 `artifact:` 前缀扩展而无需迁移已有引用 |
| 2026-07-12 | `9c79555` | 同步前端样式与代码目录决策，降低业务逻辑和 UI 组件耦合 | 引用决策 0004，明确 `lib` / `hooks` / `types` 与 `components` 分层，组件不直接内嵌 API 调用，为后续桌面打包和可能的多端业务逻辑复用保留边界 |
| 2026-07-12 | `4af80c1` | 建立支撑第一阶段产品路线的整体软件架构基线 | 创建分层架构，定义单进程本地运行模型、Workspace 锁恢复、Run 生命周期、Agent Adapter、SSE cursor/replay、Workflow/Validation、SQLite 存储、Artifact/Evidence 引用、前端边界、执行权限与 v0.7 daemon 演进路径 |

## 与 PRD / 数据模型文档的关系

本文档承载"整体怎么搭"的实现级设计：模块划分、运行时/进程模型、存储与通信层、agent adapter 抽象。产品判断、范围和路线仍以 `docs/personahub-prd.md` 为唯一真相源（PRD 第 16 节）；字段级数据模型以 `docs/personahub-system-design.md` 为准，本文档不重复定义表结构，只在必要处引用。

本版本已根据 `docs/personahub-architecture-review.md` 的评审意见修订，重点补齐了 CLI agent 执行权限模型、workspace 锁崩溃恢复、事件流 cursor/replay 契约、Agent Adapter 会话模型、Artifact 落点五处此前遗漏的实质缺口。

### 设计深度边界

按 PRD 第 15 节的版本路线，本文档的设计深度分两档，避免"过度平台化"（PRD 第 13 节风险）：

- **主干做到能撑住 v0.7**：运行时/进程模型、agent adapter 抽象、事件流、存储访问层、workspace 执行边界、artifact/evidence 引用层——这些是一旦按"临时脚本"心态写死、后续很难无痛升级的部分，因为 v0.7（Runtime / Daemon / Self-host）要做的 daemon 化、multi-workspace、workspace isolation、background queue 本质上是运行时模型的改变，而不是加功能；artifact/evidence 引用层则因为属于 v0.1–v0.3 近期承诺范围（PRD 第 15 节），也需要现在就定好格式，避免 v0.3 落地时做数据迁移。这一档现在就设计清楚。
- **v0.4–v0.6 只做到扩展边界 + 接口占位**：新增 Issue Type / Workflow（v0.4）、AgentOps Evaluation / Provenance Gate（v0.5）、Skill Compounding（v0.6）会复用既有 Issue/Workflow/Memory/Skill 模型，但新任务范式可能引入不同执行环境、证据语义和权限模型，不能预设为只加表或 JSON 策略；本文档只保证扩展边界存在，不提前展开对应算法。为支持 v0.5 评价，v0.1–v0.3 已有 Run / ThreadEvent 应保留可派生的最小原始信号（见第 10 节）。
- **v0.8 及以后不在本文档范围内**：MCP/A2A 协议层、adaptive topology selection 等，PRD 自身已标注为"方向性设想"，会随 v0.1–v0.3 的使用反馈调整，现在设计过细价值有限。

### 前置决策

- `docs/decisions/0001-frontend-stack.md`：前端 Vite + React。
- `docs/decisions/0002-first-agent-adapter.md`：P0 首个 agent adapter 是 Codex CLI。
- `docs/decisions/0003-backend-runtime.md`：本地 API 后端是 Node.js + TypeScript。

## 1. 整体分层

```text
Frontend (Vite + React)
  三栏工作台 UI（PRD "信息架构"小节）
  通过本地 HTTP API 读写 + SSE 订阅事件流

Local API Server (Node.js + TypeScript)
  HTTP API：Project/Workspace/Issue/Thread/Agent 等 CRUD
  SSE endpoint：按 thread_id / issue_id 订阅 ThreadEvent 流（支持 cursor/replay，见第 4 节）
  Workflow Engine：按 WorkflowTemplate 推进 sequential steps（v0.1 只有这一种 topology 实现）
  Agent Runner：管理 CLI agent 子进程的生命周期，落实执行权限模型（见第 9 节）
  Repository 层：封装对 SQLite 的读写
  Artifact Service：封装 artifact 的存取和引用校验（见第 7 节）

Agent Adapter Layer
  CodexCliAdapter / ClaudeCodeAdapter / OpenCodeAdapter（F005：三者均为真实落地，非预留占位）
  子进程 stdout/stderr -> 结构化 run events
  ManualRoutingService：Run 创建统一入口，AdapterResolver 解析 default/explicit adapter
  ValidationDispatchScheduler：validator grace 到期自动派发（详见第 5.2 节）

Storage
  SQLite（WAL 模式，本地文件）
```

前端与后端是两个独立进程（开发期 Vite dev server + Node server；打包后可以是本地 Node 进程 + 静态资源，或未来 Tauri 壳 + Node sidecar），通过 `localhost` 固定端口通信，不依赖云账号（PRD "非功能验收"小节）。

## 2. 运行时与进程模型

### v0.1–v0.6：单进程本地模式

- 后端是一个用户手动启动（`npm run dev` / 打包后的可执行文件）的 Node.js 进程，监听本地固定端口（避开 PRD "非功能验收"小节列出的 3003/3004，Redis 避开 6399）。
- 该进程内部持有：
  - 一个 SQLite 连接（WAL 模式）。
  - Workspace 写锁：通过 SQLite 中的 `lock_state` / `locked_by_run_id` / `locked_at` 原子更新获取和释放；当前没有第二套内存锁状态（见下方"崩溃恢复"）。
  - Agent Runner：子进程注册表 + 执行队列（见下）。
- 单机单用户，不需要 auth/session（与 PRD "自动化与安全边界"小节一致）。

### Workspace 锁的崩溃恢复（stale lock 处理）

当前实现采用单进程启动恢复，而不是 lease/heartbeat：

- `Workspace` 实际持久化 `lock_state`、`locked_by_run_id`、`locked_at`；schema 和 public type 中没有 `lease_expires_at` / `runner_instance_id`。
- API server 启动时，`StaleRecoveryService` 扫描所有 `status = running` 的 Run。新进程启动这一事实说明旧进程已不存在，因此这些 Run 一律标记为 `interrupted`，随后释放其持有的 workspace 锁并写入 `run.interrupted`；terminal-but-unfinalized Run 和无有效 owner 的遗留锁也在同一启动恢复阶段收敛。
- 正常运行期间的子进程僵死由 adapter/Runner execution timeout 收敛，不存在独立的 workspace lock lease 续期与过期回收。
- lease / heartbeat / `runner_instance_id` 只作为 v0.7 多实例 daemon 的候选设计；引入前必须另做 schema、owner fencing、时钟与恢复语义设计，不能视为当前保证。

### Run 生命周期

```text
queued -> running -> completed
                   -> failed        （agent 自身返回失败 / 命令报错）
                   -> interrupted   （宿主进程异常终止导致的中断，见上）
                   -> cancelled     （用户主动取消）
```

`interrupted` 与 `failed` / `cancelled` 分开建模，是为了让"进程崩溃导致的中断"和"agent 主动判断失败"、"用户主动取消"在 evidence trace 里可区分，不互相掩盖原因。

### 从 v0.1 到 v0.7 的平滑路径

v0.7 要做的 daemon 化、multi-workspace、workspace isolation、background queue，如果 v0.1 按"一次性脚本"心态写，后续基本要重写。以下几处现在就按"未来会 daemon 化"的形态设计，但 v0.1 阶段只启用最简单的行为：

| 关注点 | v0.1 实际行为 | 为 v0.7 预留的设计 |
| --- | --- | --- |
| 进程启动方式 | 用户手动 `npm run dev` / 双击可执行文件 | API server 代码本身不关心"谁启动了我"；v0.7 换成 systemd / Windows Service / 自带 supervisor 接管启动，server 代码不用改 |
| Workspace 锁 | 锁状态存 DB，按 `workspace_id` 原子获取；启动时恢复遗留 running Run/锁，无 lease/heartbeat | v0.7 多实例需要新增 owner fencing（候选：`runner_instance_id` + lease/heartbeat），不能直接假设当前单进程锁可无修改扩展 |
| Agent Runner | 注册表 + 队列，但队列长度实际上恒为 1（同一 workspace 同一时刻只有一个 run） | v0.7 background queue 只是把"队列长度恒为 1"的限制放开为"跨 workspace 并行，同一 workspace 内仍串行"，排队逻辑本身不用重写 |
| Workspace 执行边界 | Runner 通过一个 `WorkspaceContext`（`workspaceId`/`localPath` 作为 cwd/`gitBranch`/`pushCredentialsEnabled`）传给 adapter，adapter 不直接拼路径字符串；**当前没有访问模式或允许写入路径字段**，无法约束/证明某次执行是只读的（`server/src/runtime/types.ts`） | v0.7 workspace isolation（容器/进程级隔离）需要先补上访问模式字段，再替换 `WorkspaceContext` 的执行方式（例如改成在容器里跑命令）；这个缺口在 v0.2 orchestrator_subagent 只读并行 Node 场景下已提前暴露，见下方说明和 ADR 0006 |
| 存储访问 | SQLite，业务代码只通过 Repository 层读写，不直接写 SQL | v0.7 "Postgres/pgvector 可选迁移"只需新增一套 Repository 实现，业务逻辑不用改 |
| 前后端事件传输 | SSE（单向、够用、比 WebSocket 简单，带 cursor/replay，见第 4 节） | 事件本体（event envelope：`{id, type, thread_id, issue_id, payload, created_at}`）与传输方式解耦；v0.7 若需要多端/远程访问，可切到 WebSocket 或 daemon 内部 pub/sub，不需要改事件模型本身 |

这一节是本文档设计投入最重的部分：目标不是在 v0.1 就实现 daemon / multi-workspace / isolation，而是让 v0.1 的代码结构不会在 v0.7 时被推倒重来。

上表"Agent Runner"一行"同一 workspace 同一时刻只有一个 run"描述的是 v0.1 的写锁基线。v0.2 `orchestrator_subagent`（见第 5 节、`docs/decisions/0006-executable-work-graph.md`）对这条基线的影响需要分两半说：写 Run 仍然一次只有一个，这条不变量不变；但"只读 Node 可以不持锁并行执行"确实是对"队列长度恒为 1"这个字面模型的一个例外（不是对"同一时刻只有一个写者"这条安全不变量的例外）。这个例外目前**不能**直接落地——当前运行时没有任何机制强制一个 Node 真的只读（见上表"Workspace 执行边界"一行），一个自称"只读分析"的 Node 实际执行时和写 Node 拥有完全相同的写权限。因此 v0.2 要开放这个例外，必须先落地并验证 ADR 0006 定义的强制隔离条件（活 workspace 在操作系统层面对子进程不可访问，不是仅仅换一个 `cwd`——普通 `git worktree`/目录拷贝本身不满足，因为子进程仍可通过相对/绝对路径或调用工具触达原 workspace，`git worktree` 还与主仓库共享 `.git` 管理元数据），或证明三个 adapter 有一致的强制只读能力；两者都不具备时，只读 Node 也必须留在排他锁串行队列里，不能仅凭 Node 角色/prompt 自称只读、或仅仅换了个工作目录就跳过锁。具体方案见 ADR 0006。

## 3. Agent Adapter 抽象

### 会话模型：一条 Thread 指令 = 一个新 Run

在定义接口前先回答一个更根本的问题：Thread 里每条用户指令，对应的是"新开一个 Run"还是"复用同一个长会话进程"？这个问题不回答清楚，前端、Runner、Workflow Engine 会对"一个 agent run 到底是什么"产生不同理解。

v0.1 决定：**每条 Thread 指令对应一个新 Run（one-shot invocation 模型）**。

- P0 唯一 adapter 是 Codex CLI（决策 0002），多数 coding CLI 的默认模式是"给一次任务描述、执行到退出"，而不是保持进程常驻、后续继续 `sendInput()`。F005（Manual Multi-Agent Routing）在此模型上新增 Claude Code、OpenCode 两个真实落地的第二/三 adapter，三者共用同一套 one-shot Run 语义，均未引入长会话/resume。
- 每次新 Run 的 prompt/context 由 Workflow Engine 从 Thread 历史（近期消息、上一轮 Handoff Packet、evidence refs）重新组装喂给 adapter，而不是依赖 CLI 进程自己记住上下文——这与 Handoff Packet"比复制聊天记录更可靠"的设计判断（PRD "核心概念"小节）一致。F005 新增 `context_source_run_id`（见 `system-design.md` Run 实体）显式记录这次组装引用的是哪个上游 Run，而不是隐式约定"最近一个"。

### 接口（F005 实际实现，`server/src/runtime/types.ts`）

```ts
interface AgentAdapter {
  provider: string   // "codex" | "claude-code" | "opencode"
  capabilities: {
    provider: string
    supportsApprovalHook: boolean     // 仅 Claude Code 为 true（PreToolUse hook，见第 9 节）
    supportsStructuredTrace: boolean
    supportsFinalMessage: boolean
    executionTimeoutMs: number
  }
  // config 是 secret-safe 的 public DTO（永远不含 api_key）；apiKey 单独传递，
  // 只有真正需要原始 secret 探测的 provider（OpenCode api_key 模式）才会用到。
  validate(config: AdapterConfig, apiKey?: string | null): Promise<AdapterValidationResult>
  start(input: AgentRunInput): Promise<RunHandle>
}

interface AgentRunInput {
  runId: string; issueId: string; threadId: string
  workspace: WorkspaceContext
  instructions: string
  context: string
  // model_provider/default_model/auth_type/api_key 只对 OpenCode 有意义
  // （§5.1 provider/auth 矩阵）；Codex/Claude 是纯 OAuth，adapter 忽略这些字段。
  adapterConfig: { command: string; args: string[]; model_provider: string | null; default_model: string | null; auth_type: AdapterAuthType; api_key: string | null }
}

interface RunHandle {
  runId: string
  onOutput(cb: (event: RunOutputChunk) => void): void
  onTrace(cb: (event: RunTraceSignal) => void): void
  onExit(cb: (result: RunExitResult) => void): void
  cancel(): Promise<void>
}
```

- 三个 adapter（`CodexCliAdapter`/`ClaudeCodeAdapter`/`OpenCodeAdapter`）均已真实落地并在 `server/src/index.ts` 里同时注册到 registry，不再是"预留占位"——F005 之前本节描述的"P0 只实现 Codex"已过期。
- `validate()` 是各 provider 自己的真实 auth probe（Codex/Claude 走 CLI 自带的 auth status 类命令，OpenCode api_key 模式走一次真实最小 probe run），不是通用的 `--version` 检查——不同 provider 的"能不能用"判定标准不同，不能用同一套启发式代替。
- `supportsApprovalHook` 是三个 provider 里唯一有真实差异的能力位：只有 Claude Code 提供 PreToolUse 钩子（第 9 节"前置拦截"），Codex 和 OpenCode 都没有，凭据隔离仍是三者共同的主防线。
- Adapter 只负责"如何和某个 CLI 子进程交互、如何把它的输出转成结构化事件"，不负责 workflow 顺序、validation 判断、routing 分类（role/purpose/dispatch_source 的推导是 `ManualRoutingService`/`run-routing-classifier` 的职责，见第 5.2 节）——这些不应该耦合进 adapter 实现里。

### 3.1 Auth 架构（F005）

| Provider | OAuth | API key | 默认 command |
| --- | --- | --- | --- |
| codex | 支持 | 不支持 | `codex` |
| claude-code | 支持 | 不支持 | `claude` |
| opencode | 支持 | 支持 | `opencode` |

- `agent_configs.api_key` 是唯一持有原始 secret 的地方（internal-only `AgentConfigRecord`），public DTO（`AdapterConfig`）永远只暴露 `has_api_key`（布尔投影）与 `auth_status_message`（经清洗的探测失败原因），从不回显原值。
- OpenCode api_key 模式下，key 只在 spawn 时通过 env var（`model_provider` -> env var 名的白名单映射，例如 `openai` -> `OPENAI_API_KEY`）注入子进程环境，不落盘、不进 argv、不进日志（`server/src/runtime/auth-material.ts`）。
- OAuth 模式下 PersonaHub 完全不读取/保存 token，只持久化 `auth_type=oauth`；"是否已登录"完全依赖 `validate()` 的真实 probe 结果（`last_checked_at` + `auth_status_message`），UI 明确标注这是"最近一次验证结果"而非实时状态。
- 非法组合（如 OAuth adapter 同时提交 api_key，或 API-key adapter 缺 `model_provider`/`api_key`）在 service 层 `validateAuthState()` 统一拒绝，create/update 两条路径共用同一份校验，不允许出现"创建时校验、更新时漏校验"的分叉。

## 4. 事件与 Trace 层

- `ThreadEvent` 是唯一的事件真相源（与 `system-design.md` 一致），类型覆盖 PRD "Trace Events"小节列表（`issue.created`、`run.started`、`run.completed`、`handoff.created`、`validation.passed` 等）。
- 进程内事件流：Runner / Workflow Engine 产生事件 -> 先写 SQLite -> 再通过进程内 EventEmitter 广播 -> SSE 订阅该 `thread_id` 的连接收到后推给前端。先写库后广播，保证前端断线重连时可以从 DB 补历史事件。

### Cursor / replay 契约

原设计只说"断线重连可从 DB 补历史"，但没有定义具体契约，导致排序、去重、补发都没有依据。补充：

- 每条 `ThreadEvent` 拥有稳定且不透明的 ULID `id`，用于 cursor 和去重；排序使用同一 Thread 内的 `event_sequence`，`created_at` 只用于展示。当前实现可全局分配 sequence，但对外 contract 只保证 Thread 内顺序，客户端不得依赖跨 Thread 单调性。
- SSE 推送使用标准 `id:` 字段，前端断线重连时浏览器按 `Last-Event-ID` 自动携带；同时提供显式 query 参数 `?after_event_id=` 作为退化路径（例如非浏览器客户端）。
- 订阅接口必须支持按 `after_event_id` 补发遗漏事件，覆盖"先写库、广播失败"的场景。
- 前端按 `event.id` 去重、按 `event_sequence` 排序渲染，不依赖到达顺序。

## 5. Workflow / Validation 执行引擎

> 本节曾把下面这段 `TopologyExecutor` 接口写成"v0.1 只实现 `SequentialTopologyExecutor`"，但实际实现从未落地这个接口/类。更准确地说：原草图声称的"按 `steps_json` 顺序切换"这件事本身就没有被实现过（`steps_json` 从未驱动过执行顺序，见下方"实际实现"）；真正实现的是 validator 角色判定和 failure round 计数这两块逻辑，且是直接写在 `ValidationWorkflowService`（`server/src/services/validation/workflow-service.ts`）和 `RunDispatchService`（`server/src/services/run-dispatch.ts`）等 service 里的，没有经过任何 `TopologyExecutor` 抽象层。以下保留原设计草图仅作历史参照，标注为**未实现**；当前实际执行路径见下方"实际实现"。原设计草图预留的 `orchestrator_subagent` 等非 sequential topology 扩展点，其目标架构已由 `docs/decisions/0006-executable-work-graph.md`（Executable Work Graph）取代，不再沿用 `TopologyExecutor` 这个具体接口形状；本文档中所有引用 `TopologyExecutor` 作为未来扩展点的地方（包括第 11 节）均已过期，以 ADR 0006 为准。

<details>
<summary>原设计草图（未实现，仅存档）</summary>

v0.1 只需要支持 sequential topology，设计上不引入过重的通用编排引擎：

```ts
interface TopologyExecutor {
  run(issue: Issue, template: WorkflowTemplate): void
}

class SequentialTopologyExecutor implements TopologyExecutor { ... }
```

`orchestrator_subagent` / `coordinator` / `council` / `moa` / `swarm` 等 topology（v0.2 及以后）曾计划只保留 `TopologyExecutor` 接口和 `WorkflowTemplate.collaboration_topology` 字段占位。

</details>

### 实际实现

- `WorkflowTemplate.collaboration_topology` 目前只在 `server/src/repositories/workflow-template.ts` 做行映射，没有任何分支逻辑读取它；`steps_json` 唯一的实际用途是 `server/src/services/validation/validator-selector.ts` 里判断"当前 workflow 是否存在 validator 角色"的布尔门禁。二者都是描述性字段，不驱动执行顺序。
- 真正的 Issue → implementation agent → validator agent 顺序流转，硬编码在 `ValidationWorkflowService` 及相关 service 里；validator 角色只是这条硬编码流程里的一步，不是独立引擎，与 PRD "Agent Validation Loop" 小节一致——validation 是 Thread 内事件，不是一级模块。
- 失败收敛：`validation_round_count` 在每次 validation fail 回流时自增，超过 `max_validation_rounds` 直接把 Issue 置 Blocked 并写 escalation 事件（PRD "Agent Validation Loop"/"自动化与安全边界"小节），这条规则在 v0.1 就已实现，属于安全边界而非功能扩展。
- `orchestrator_subagent` 等 v0.2 及以后的非 sequential topology，目标架构见 `docs/decisions/0006-executable-work-graph.md`：v0.2 承诺的 `orchestrator_subagent` 拓扑（至少一次真实 fan-out → fan-in）是该决策 Slice 1 的具体触发场景，实现时机和范围以该决策为准，不在 v0.1 阶段展开。Slice 1 是"显式 Node/Edge 语义可执行、可追踪、可恢复"这一能力验收（"可恢复"的最小语义见该决策），不预先约定是否需要新建独立运行时表——是否新建由 v0.2 `design.md` 判断。该拓扑的并行范围同样受下方"Workspace 锁"一行约束：只读分析/审查 Node 只有在满足 ADR 0006 定义的强制隔离条件（操作系统层面不可访问活 workspace，普通 `git worktree`/目录拷贝不满足）时才可并行，未满足时和写 Node 一样进入 workspace 排他锁串行队列；写 Node 在任何情况下都串行持有 workspace 排他锁，不因为这条完成判据而隐含放宽锁粒度。

### 5.1 Terminal Finalization 顺序（F004）

F003 的 `finalizeAndDrain()` 出口顺序调整为：

```text
trace finalize (F003 file changes + handoff, lock still held)
  -> release workspace lock
  -> workflow hook (ValidationWorkflowService)
  -> drain next queued Run
```

Workflow hook 必须早于 queue drain：否则旧队列中的 implementation/consult Run 可能先启动，validator 创建顺序会漂移；若 validator 结果需把 Issue 置 Blocked，也来不及在 drain 前取消不再 eligible 的 queued Run。Hook 无论成功或收敛为 Blocked，最外层 `finally` 都必须继续执行 queue drain。

### 5.2 Validation 工作流（F004 单阶段基线 + F005 两阶段 grace/互斥）

**F004 原始设计是单阶段**：implementation 完成即同步创建 validator Run。**F005 引入两阶段 dispatch**，把"进入 Validating"和"选定 validator adapter 并创建 Run"拆成两个独立事务，中间留一个可配置的 grace window 供人工介入：

```text
implementation Run completed
  -> F003 finalizeRun -> release lock
  -> ValidationWorkflowService.requestValidation()   [Phase A]
       Issue Running -> Validating
       固化 round / implementation_run_id / policy snapshot+hash（不含任何 validator 身份）
       写 validation.dispatch_pending 事件，设置 Issue.validation_dispatch_due_at = now + MANUAL_VALIDATOR_GRACE_MS（默认 10s，可注入）
       *不* 创建 validator Run，*不* 写 validation.requested（该事件仍是 validator-bound，语义未变）

  grace window 内二选一（先到先得）：
    (a) 用户在 composer 显式选一个 validator-capable adapter
        -> ManualRoutingService.dispatchValidator() -> claimValidatorSlot(mode="explicit", adapterConfigId)
    (b) grace 到期，ValidationDispatchScheduler（每秒 tick，扫描 idx_issues_validation_due）
        -> claimValidatorSlot(mode="auto") -> 始终用 ValidatorSelector（capability_tags 含 validator 的 available adapter），
           与 Project 的 default adapter 是两个概念，不得合并（AdapterResolver 只服务省略 adapter_id 的普通 Run）

  claimValidatorSlot()（Phase B，winner 唯一执行）：
       清 validation_dispatch_due_at
       create queued validator Run (role=validator, workflow_step=validation,
         dispatch_source=user_explicit|system 取决于谁赢)
         instructions = buildValidatorContext()：同 F004（目标 implementation 的 handoff/命令/验证/
         文件证据 + 固化 policy + prior findings + 严格 JSON envelope 契约，scoped 到该 implementation_run_id）
       写 validation.requested（此时才携带真实 validator 身份，语义与 F004 完全一致）
       loser（同一 round 的另一路尝试）按冲突类型分流：
         active 冲突（本轮已有 queued/running validator）：手动方 409 VALIDATOR_RUN_CONFLICT，scheduler 幂等结束
         per-round 冲突（本轮已有 validator 但已终态）：同样拒绝，不允许同轮重试，必须走 fail->Running->下一轮
  -> normal workspace queue dispatch
```

`MANUAL_VALIDATOR_GRACE_MS` 注入为 0 时，Phase A 提交后立即级联执行 Phase B（同步），事件序列退化为与 F004 原始"立即创建"完全等价——这是自动化测试保持零延迟的手段，不是运行时的真实生产路径（生产默认 10s）。

**Validator terminal -> outcome submission：**

```text
validator Run completed
  -> F003 finalizeRun -> release lock
  -> ValidationWorkflowService.processValidatorResult()
       1. Parse strict JSON final message
       2. Deterministic policy gate (evidence requirements from requested snapshot)
       3. Round limit check (nextCount = validation_round_count + 1)
       passed  -> validation.passed + EvidenceSummary + issue.done -> Done
       failed  -> findings + validation.failed + round++ -> Running（下一条用户发起的
                  implementation Run 由 buildRepairContext() 注入上一轮 findings，F004 T090）
       blocked -> validation.blocked + blocker columns -> Blocked
```

Validator `failed/cancelled/interrupted` 不过 parser，直接 `validator_run_failed` -> Blocked（不增加 failed round count）。

### 5.3 Strict Validation Gate（F004）

Validation pass 不能仅信任 validator agent 声明，必须经过 deterministic policy gate：

- 使用 `validation.requested` 事件固化的 policy snapshot（而非当前可能已修改的 policy 行）。
- 检查 handoff/file trace/verification evidence 满足 `ValidationEvidenceRequirements`。
- Same-origin 标记比较双方 Run 创建时固化的 `adapter_identity_json`（`cli_provider` + `default_model`），不读后续可能变化的 adapter config。
- Gate 不通过时，即使 validator 输出 `passed`，仍按 `evidence_missing` -> Blocked。

### 5.4 Queue Drain Eligibility（F004 §6.1.1）

每次从 workspace FIFO 取出 queued Run 时，重新读取 Issue 并校验 role/status：

```text
implementation -> Inbox / Ready / Running
validator      -> Validating，且 validation_round 等于当前 round
```

同一 Issue 的 Run 若因状态推进不再 eligible，使用 CAS 将其从 `queued` 置为 `cancelled`（`issue_state_changed_before_start`），继续扫描下一条；不得让 stale implementation 阻塞其后 validator。其他 Issue 中仍 eligible 的更早 Run 继续遵守 workspace FIFO，validator 不获得跨 Issue 插队权。

### 5.5 Startup Recovery 顺序（F004 §6.7）

API server 启动时的恢复顺序扩展为：

1. **F003 stale Run recovery**：`status = running` 的 Run -> `interrupted`，释放 workspace 锁。
2. **F004 validation recovery**（`ValidationRecoveryService.reconcile()`，F005 扩展为按 due timestamp 判定）：
   - Finalized completed implementation + Issue Running 且无 result -> 幂等 `requestValidation()`（Phase A）。
   - Terminal validator + Issue Validating 且无 result -> 幂等 `processValidatorResult()`（从固化 `validation.requested` 读取 implementation/policy scope）。
   - **F005**：`validation_dispatch_due_at` 已过期 -> 立即 `claimValidatorSlot(mode="auto")`（重启即完成 Phase B，同时覆盖"手动 pick 提交后响应丢失"场景，两者在 recovery 视角不可区分）；未过期 -> 原样跳过，grace window 合法未到期；为 `null` 且无 active/terminal validator -> 判 `recovery_inconsistent` 并 Blocked（真正的不一致，正常运行中该字段在 Validating 期间必然非空）。
   - Done 缺 validation.passed 或 summary -> 记录 diagnostic，停止该 Issue 自动化。
3. **listen / drain queue**：开始正常服务。

### 5.6 显式 Round Reset（F004 FR-011）

`round_limit_reached` 到达 Blocked 后，运营者可显式重置轮次（`POST /api/issues/:id/reset-rounds`，要求非空 note）：

- 仅 `round_limit_reached` blocker 可用；其它 blocker 拒绝。
- 同事务将 `validation_round_count` 置 0 并写 `validation.round_reset` 事件，但 **Issue 仍保持 Blocked** —— 需另行 `unblock` 才恢复 Ready，使"授予更多轮次"成为显式两步操作。
- 与普通 `unblock` 的区别：unblock 清 blocker -> Ready 但保留 round count；reset 清 count 但保留 Blocked。

### 5.7 Schema Invariant（F004 T095 schema v5 + F005 schema v6/v7）

- `evidence_summaries` CHECK：`validation_result='passed'`、`same_origin_validation IN (0,1)`、`policy_snapshot_hash LIKE 'sha256:%'`。
- `idx_runs_validator_per_round (issue_id, validation_round) WHERE role='validator'`：DB 层强制 per-round validator 唯一，与 §5.2 service 层 double-guard。
- **F005（schema v6）**：`idx_issues_validation_due (status, validation_dispatch_due_at) WHERE status='Validating' AND validation_dispatch_due_at IS NOT NULL`——`ValidationDispatchScheduler` 每秒 tick 的查询索引；`agent_configs` 新增 `auth_type`/`model_provider`/`api_key`/`auth_status_message`（ALTER ADD COLUMN，校验在 service 层 `validateAuthState()`，非 DB CHECK）；`runs` 新增 `purpose`/`context_source_run_id`；`projects` 新增 `default_adapter_config_id`（无列级 FK，由 `AdapterConfigService`/`ProjectRepository.setDefaultAdapter()` 校验同 Project 且 available）。
- **F005 closure（schema v7）**：新增 `adapter_workspace_status(adapter_config_id, workspace_id, status, last_checked_at, auth_status_message, updated_at)` 例外覆盖表。`agent_configs.status` 保持 Project 级保守基线；无覆盖行时回退到基线，所有 workspace-scoped 路由统一经 `effectiveAdapterStatus()` 合并，某 workspace 的探测失败不得污染 sibling workspace。

## 6. 存储层

- v0.1–v0.6：本地 SQLite 文件，WAL 模式。业务代码只通过 Repository 接口访问（每个 `system-design.md` 里的实体对应一个 repository），不直接拼 SQL 字符串在业务逻辑里。
- schema 演进使用项目既定的 versioned inline SQL：`server/src/db/schema-v{N}.ts` 保持不可变，`migrations.ts` 按版本顺序执行；已应用版本不得原地追加字段。
- v0.7 "Postgres/pgvector 可选迁移"：因为访问已经收敛在 Repository 层，迁移时只需新增一套实现并切换配置，不需要改 Workflow Engine / Runner 等上层逻辑。

## 7. Artifact 落点

Artifact-centered collaboration 是 PRD v0.3 的既定范围，属于 v0.1–v0.3 近期承诺（PRD 第 15 节），不应该被当成"v0.4+ 方向性设想"轻描淡写带过——这是本文档上一版遗漏的一处分类错误。现在只需一个轻量边界，不需要现在实现 Room 或完整 artifact manifest：

- Artifact 由一个 `ArtifactService`（Repository 之上的薄封装）管理，`storage_type` 支持 `inline_markdown` / `local_file_path` / `db_record`（`external_url` 留到实际需要外部存储时再启用）。
- v0.1 的 `ThreadEvent`、内联 Handoff Packet 与 Evidence Summary 统一使用可版本化 typed evidence refs：`event:<thread_event_id>` 和 `file-change-set:<run_id>`。v0.3 引入 Artifact 时新增 `artifact:<artifact_id>` 前缀，由同一 resolver 扩展解析；现有 refs 无需格式迁移。
- Artifact 引用必须可追溯到 `issue_id` / `thread_id` / `run_id`（与 `system-design.md` Artifact 字段一致）。
- v0.1 不需要 Room、不需要多阶段 artifact manifest，这些仍然是 v0.3 范围；本节只保证 v0.1 产生的 evidence/handoff 数据在 v0.3 落地 Room 时不需要做格式迁移。

## 8. 前端

前端技术选型已由决策 0001 确定，样式/组件技术栈由决策 0004 确定，本文档不重复设计，只补充与后端交互相关、以及跨 feature 都要遵守的结构约定：

- 通过本地 HTTP API 做 CRUD，通过 SSE 订阅当前打开的 Issue/Thread 的事件流（含 cursor/replay，见第 4 节）。
- 三栏信息架构（左侧导航 / 中间协作现场 / 右侧 Inspector）按 PRD "信息架构"小节实现，状态管理库等前端内部实现细节留给具体 feature 实现阶段决定，不在架构层预先约束。
- **业务逻辑与 UI 组件目录分离**（决策 0004）：`src/lib`（API client）、`src/hooks`（数据获取/状态逻辑）、`src/types`（领域类型）与 `src/components` 分开存放，组件不直接内嵌 API 调用，`lib`/`types` 不 import React 组件。这是为未来多端（v0.7 桌面打包、v0.8 方向性设想里的 mobile/remote access）预留的低成本保险——桌面端（Tauri/Electron）打包的是同一份 Web 构建产物，不需要这条约定也能工作；真正的原生移动端无法复用任何基于 DOM 的 UI 组件，所以这条约定省不下 UI 组件重写的工作量，但能让业务逻辑层（API client、数据模型）在需要时被提取复用，而不必从耦合的组件代码里硬挖出来。不需要现在就搭建完整的多端抽象层，只需要从 F001 开始保持这个目录边界。

## 9. CLI Agent 执行权限模型与 Escalation 落地

原设计写"Runner 发起任何子进程动作前必须先过 escalation 检查"，这句话曾经把一个尚未解决的问题写成了已解决——P0 的 agent 是不透明的 CLI 子进程（Codex CLI），一旦被 spawn 到 workspace 中，它自己决定何时执行 `git push`、删除文件、跨目录写入，仅靠 Runner 的"事前检查"无法可靠拦截这些已经在子进程内部发生的动作。参考本机开源项目 multica（`D:\Projects\multica`）和 clowder-ai（`D:\Projects\clowder-ai`）对同一问题的真实实现后发现：两者都没有做到"执行前拦截任意危险命令"——multica 虽然接入了 Codex `app-server` 协议的 approval 钩子，但选择无条件 accept；clowder-ai 干脆让 Codex 跑在 `danger-full-access` 沙箱模式下，没有开这个通道。这说明"事前拦截任意危险命令"本身是一个投入产出比很低、两个参考项目都没走的方向，架构应该换一条更可靠的主防线，而不是继续把宝押在"CLI 是否恰好提供了合适的钩子"上。

现在的分层设计：

- **执行边界**：Adapter 启动时把 cwd 限定为 `workspace.local_path`，环境变量白名单化。
- **凭据与执行环境隔离（主要防线，针对 git push / force push 类风险）**：Agent run 的执行环境默认不下发用户日常使用的完整 git 凭据（不继承 SSH agent、不复用 cached HTTPS credential）；push 所需凭据由 `WorkspaceContext` 按 Project 设置显式下发，默认不下发。这一层是确定性的，不依赖任何 CLI 的内部协议细节，因此不会随 CLI 版本变化而失效，是比"事前拦截"更可靠的安全底线。本地文件写入、本地 commit 默认放行是合理的，因为 git 本身已提供撤销能力（`checkout`/`reset`），真正需要额外防线的只有离开本地沙箱、影响远端的操作。
- **前置拦截（可选的可观测性增强，不是安全底线本身）**：若 Codex CLI 暴露"执行前请求批准"的钩子（approval-required hook，例如 multica 验证过的 `app-server` JSON-RPC `item/commandExecution/requestApproval`），Adapter 可以接入该钩子，把一次因凭据隔离而失败的 push 尝试，转化成一条清晰的 `escalation.triggered` 事件，而不是让用户只看到语焉不详的 git 认证失败。这一层锦上添花，但即使拿不到该钩子，凭据隔离这道主防线依然生效。
- **事后检测（仅用于凭据隔离无法覆盖的风险，例如不可逆删除、跨 workspace 写入）**：对这类无法靠"不下发凭据"提前防住的风险，通过 changed files 扫描、workspace 边界检查等方式事后检测，检测到越界行为时标记 escalation、要求 operator 复核。
- **诚实声明**：Codex CLI 是否提供前置 approval 钩子，仍需在 v0.1.1 Agent Command Center 落地 `CodexCliAdapter` 时用真实 CLI 确认，但这已经不是 escalation 硬阻塞能否兑现的前提条件——凭据隔离才是。
- **Workspace 写锁**：与执行权限模型分开的另一层保护——Runner 在 spawn agent 子进程前，必须先在 Repository 层原子性地检查并写入 `Workspace.lock_state`，拿不到锁则该 run 排队等待，不允许两个 run 同时对同一 workspace 执行写操作。这一层不依赖 CLI 的钩子能力，可以完全在架构层保证。
- **不追求覆盖任意危险命令**：危险操作 escalation 的范围收敛为 git push/force push、跨 workspace 写入和不可逆删除，不建立一份试图覆盖所有危险 shell 命令的黑名单——动作面越宽，误报和维护成本越高，两个参考项目也都没有走这条路。

## 10. v0.4–v0.6 扩展点（占位，不展开机制，不预先承诺零改动）

- **新 Issue Type / Workflow（v0.4）**：按任务范式逐个实现和验证垂直切片，不并行铺开多个浅层模板。首个候选 Windows Troubleshooting 会引入主机状态采集、权限提升、危险系统操作和修复前后验证；后续 Knowledge / Research 会引入来源定位、引用 provenance、事实/推断区分和冲突证据；Writing / Book 还需要区分客观事实验证与主观偏好 gate。这些差异优先通过 `WorkflowTemplate` / `ValidationPolicy` / Agent capability 表达，但若出现新的执行边界、证据类型或权限模型，应局部扩展 Runner / Evidence / Adapter 层，不得全部塞进无法形成业务不变量的通用 JSON，也不预先承诺"完全不改 engine"。
- **AgentOps signals（v0.1–v0.3 前置）与 Evaluation（v0.5）**：前序版本的 `Run` / `ThreadEvent` 先保存 duration、retry、validation round、blocked reason、人工 intervention/override、Done/Blocked 纠正等可派生的原始事实；不要求提前实现完整指标面板。v0.5 再对 cost、workflow success rate、tool efficiency、validator FP/FN 等进行稳定定义和聚合，必要时新增 projection 表，不能仅靠给 `Run` 表加列。
- **Provenance Gate（v0.5）**：Memory / Skill / Scheduled Issue 写入长期状态前，统一经过一个 `LongTermStateGate` 服务接口；v0.1–v0.4 阶段该 gate 直接放行（因为这几个版本本就不开放自动写入长期 Memory，PRD "Memory 沉淀"小节），v0.5 只需替换 gate 内部实现为真正的来源校验逻辑，调用方不用改。
- **Skill Compounding（v0.6）**：`Skill` 表和 provenance 字段已在数据模型草案中占位，具体的 skill candidate 提取算法、review/accept 流程留到 v0.6 临近时再设计。

## 11. 不在本文档设计范围内

- v0.8 MCP 工具/数据连接层、A2A 外部 agent 通信协议。
- v0.9 adaptive topology selection 的具体算法、cost/quality mode 的判断逻辑。

这些留到对应版本临近、v0.1–v0.3 的实际使用反馈落地之后再设计，现在只需保证 `AgentAdapter` 接口以及 `docs/decisions/0006-executable-work-graph.md`（ADR 0006）已接受的 graph orchestration 边界不会把这些方向堵死——`TopologyExecutor` 从未实现，不再是需要保留的扩展点（见第 5 节）。
