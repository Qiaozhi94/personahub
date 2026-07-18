---
topics: [architecture, runtime, module-design, agent-team-os]
doc_kind: design
created: 2026-07-12
updated: 2026-07-18
---

# PersonaHub 软件架构设计

> Status: draft | Owner: TBD

## 修订记录

| 日期 | 修订目的 | 修订内容 |
| --- | --- | --- |
| 2026-07-18 | 同步 PRD 对 v0.4 渐进式多场景扩展和 AgentOps 前置数据采集的产品调整 | 明确非 coding Workflow 按任务范式逐个做垂直切片，不能把场景差异压成模板 JSON；补充 Windows 排障、knowledge/research、writing 三类执行与证据边界；明确 v0.1–v0.3 先保存可派生的最小原始信号，v0.5 再建设完整 AgentOps 聚合与评价能力 |

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
  CodexCliAdapter（P0 唯一实现）
  子进程 stdout/stderr -> 结构化 run events

Storage
  SQLite（WAL 模式，本地文件）
```

前端与后端是两个独立进程（开发期 Vite dev server + Node server；打包后可以是本地 Node 进程 + 静态资源，或未来 Tauri 壳 + Node sidecar），通过 `localhost` 固定端口通信，不依赖云账号（PRD "非功能验收"小节）。

## 2. 运行时与进程模型

### v0.1–v0.6：单进程本地模式

- 后端是一个用户手动启动（`npm run dev` / 打包后的可执行文件）的 Node.js 进程，监听本地固定端口（避开 PRD "非功能验收"小节列出的 3003/3004，Redis 避开 6399）。
- 该进程内部持有：
  - 一个 SQLite 连接（WAL 模式）。
  - Workspace 写锁：内存态判断 + DB 持久化字段（见下方"崩溃恢复"）。
  - Agent Runner：子进程注册表 + 执行队列（见下）。
- 单机单用户，不需要 auth/session（与 PRD "自动化与安全边界"小节一致）。

### Workspace 锁的崩溃恢复（stale lock 处理）

原设计只说"锁状态存 DB，重启后可恢复"，但没有回答"恢复成什么"——如果 Runner 进程在某个 run 执行中崩溃，DB 里会永久留下一条 `locked` 记录，后续 run 无限排队。补充设计：

- `Workspace` 增加 `locked_at`、`lease_expires_at`、`runner_instance_id` 三个字段（`runner_instance_id` 同时是 v0.7 多实例场景下区分"锁属于哪个 daemon 实例"的预留字段）。
- Runner 对正在执行的 run 定期 heartbeat，刷新 `lease_expires_at`。
- API server 启动时，扫描所有 `status = running` 的 Run——新进程启动这一事实本身就说明旧进程已不存在，这些 Run 一律标记为 `interrupted`，释放对应 workspace 锁，写入 `run.interrupted` / `workspace.lock_recovered` 事件。
- 正常运行期间，若某个 run 的 lease 超过 `lease_expires_at` 仍未续期（例如子进程僵死但父进程未崩溃），同样触发上述回收流程。

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
| Workspace 锁 | 单 workspace，锁状态存 DB，带 lease + heartbeat | v0.7 multi-workspace 时，锁判断逻辑不变，只是并发检查的维度从"全局一把锁"变成"按 workspace_id 判断"；`runner_instance_id` 字段从 v0.1 起就存在，为多实例场景预留 |
| Agent Runner | 注册表 + 队列，但队列长度实际上恒为 1（同一 workspace 同一时刻只有一个 run） | v0.7 background queue 只是把"队列长度恒为 1"的限制放开为"跨 workspace 并行，同一 workspace 内仍串行"，排队逻辑本身不用重写 |
| Workspace 执行边界 | Runner 通过一个 `WorkspaceContext`（cwd + env + 允许写入的路径）传给 adapter，adapter 不直接拼路径字符串 | v0.7 workspace isolation（容器/进程级隔离）只需替换 `WorkspaceContext` 的执行方式（例如改成在容器里跑命令），上层 Workflow / Runner 逻辑不用动 |
| 存储访问 | SQLite，业务代码只通过 Repository 层读写，不直接写 SQL | v0.7 "Postgres/pgvector 可选迁移"只需新增一套 Repository 实现，业务逻辑不用改 |
| 前后端事件传输 | SSE（单向、够用、比 WebSocket 简单，带 cursor/replay，见第 4 节） | 事件本体（event envelope：`{id, type, thread_id, issue_id, payload, created_at}`）与传输方式解耦；v0.7 若需要多端/远程访问，可切到 WebSocket 或 daemon 内部 pub/sub，不需要改事件模型本身 |

这一节是本文档设计投入最重的部分：目标不是在 v0.1 就实现 daemon / multi-workspace / isolation，而是让 v0.1 的代码结构不会在 v0.7 时被推倒重来。

## 3. Agent Adapter 抽象

### 会话模型：一条 Thread 指令 = 一个新 Run

在定义接口前先回答一个更根本的问题：Thread 里每条用户指令，对应的是"新开一个 Run"还是"复用同一个长会话进程"？这个问题不回答清楚，前端、Runner、Workflow Engine 会对"一个 agent run 到底是什么"产生不同理解。

v0.1 决定：**每条 Thread 指令对应一个新 Run（one-shot invocation 模型）**。

- P0 唯一 adapter 是 Codex CLI（决策 0002），多数 coding CLI 的默认模式是"给一次任务描述、执行到退出"，而不是保持进程常驻、后续继续 `sendInput()`。
- 每次新 Run 的 prompt/context 由 Workflow Engine 从 Thread 历史（近期消息、上一轮 Handoff Packet、evidence refs）重新组装喂给 adapter，而不是依赖 CLI 进程自己记住上下文——这与 Handoff Packet"比复制聊天记录更可靠"的设计判断（PRD "核心概念"小节）一致。
- 是否可行仍取决于 Codex CLI 的实际行为，需要在 v0.1.1 Agent Command Center 落地时用真实 CLI 验证；如果验证后发现不成立（例如 Codex CLI 更适合长会话），届时更新本节而非现在假设。

### 接口

```ts
interface AgentAdapter {
  capabilities: {
    supportsInteractiveInput: boolean
    supportsResume: boolean
    supportsStructuredOutput: boolean
  }
  start(input: {
    issueId: string
    workspace: WorkspaceContext
    instructions: string
    contextPacket: HandoffPacket | null
  }): RunHandle
}

interface RunHandle {
  runId: string
  onOutput(cb: (chunk: RunOutputEvent) => void): void
  onExit(cb: (result: { exitCode: number }) => void): void
  cancel(): void
}
```

- `capabilities` 是为后续 adapter（Claude Code、OpenCode，或未来支持真正长会话的 CLI）预留的能力声明位，不是 v0.1 就要实现的功能。`CodexCliAdapter`（P0）目前三项能力先假定为 `false`，具体值待 v0.1.1 实测确认。
- P0 只实现 `CodexCliAdapter`（决策 0002），registry 预留 `ClaudeCodeAdapter` / `OpenCodeAdapter` 扩展点，不要求 P0 同时支持三个。
- Adapter 只负责"如何和某个 CLI 子进程交互、如何把它的输出转成结构化事件"，不负责 workflow 顺序、validation 判断——那些是 Workflow Engine 和 Validation Policy 的职责，二者不应该耦合进 adapter 实现里。

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

v0.1 只需要支持 sequential topology，设计上不引入过重的通用编排引擎：

```ts
interface TopologyExecutor {
  run(issue: Issue, template: WorkflowTemplate): void
}

class SequentialTopologyExecutor implements TopologyExecutor { ... }
```

- v0.1 只实现 `SequentialTopologyExecutor`：按 `WorkflowTemplate.steps_json` 顺序把 Issue 交给下一个 agent 角色，validator 角色只是 steps 中的一步，不是独立引擎（与 PRD "Agent Validation Loop"小节一致——validation 是 Thread 内事件，不是一级模块）。
- `orchestrator_subagent` / `coordinator` / `council` / `moa` / `swarm` 等 topology（v0.2 及以后）只保留 `TopologyExecutor` 接口和 `WorkflowTemplate.collaboration_topology` 字段占位，不在本阶段实现，避免为还未验证的协作形态设计具体机制。
- 失败收敛：`validation_round_count` 由 Workflow Engine 在每次 validation fail 回流时自增，超过 `max_validation_rounds` 由 Engine 直接把 Issue 置 Blocked 并写 escalation 事件（PRD "Agent Validation Loop"/"自动化与安全边界"小节），这条规则在 v0.1 就要实现，不属于"轻量占位"范畴，因为它是安全边界而非功能扩展。

## 6. 存储层

- v0.1–v0.6：本地 SQLite 文件，WAL 模式。业务代码只通过 Repository 接口访问（每个 `system-design.md` 里的实体对应一个 repository），不直接拼 SQL 字符串在业务逻辑里。
- schema 演进用迁移脚本管理（具体工具留到 v0.1.0 实现阶段选型，例如 Drizzle / Knex migrations），不在本文档里预先绑定。
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

这些留到对应版本临近、v0.1–v0.3 的实际使用反馈落地之后再设计，现在只需保证 `AgentAdapter` / `TopologyExecutor` 接口不会把这些方向堵死。
