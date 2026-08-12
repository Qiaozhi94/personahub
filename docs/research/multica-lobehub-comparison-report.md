---
topics: [research, competitive-analysis, multica, lobehub, personahub, agent-team, workflow, validation, evidence]
doc_kind: research
created: 2026-07-18
updated: 2026-07-18
---

# Multica 与 LobeHub 源码拆解、对比及 PersonaHub 启示

分析日期：2026-07-18  
分析对象：本地 `D:\Projects\multica`、`D:\Projects\lobehub`  
对比对象：PersonaHub 当前 PRD、架构和已实现能力

> 本报告是基于本地源码的竞品调研归档，不是 PersonaHub 产品需求的真相源。正式产品判断以 `docs/personahub-prd.md` 为准。

## 1. 基线与方法

本报告以本地 checkout 为准，不把官网宣传或未来路线当成已实现能力。

| 项目 | 本地 commit | commit 日期 | 规模快照 |
| --- | --- | --- | --- |
| Multica | `270fb6aa` | 2026-05-28 | 2,305 tracked files；459 Go；1,202 TS/TSX；约 371 个测试文件 |
| LobeHub | `5b1937aad6` | 2026-07-18 | 13,016 tracked files；10,318 TS/TSX；约 2,271 个测试文件 |
| PersonaHub | 当前工作区 | 2026-07-18 | F001–F003 已实现；F004/F005 尚未完成 |

分析覆盖产品对象、进程与存储、任务队列、CLI runtime、实时事件、协作、验证、证据、Memory、Skill、自托管复杂度和 PersonaHub 路线。没有读取项目的本地 `.env` 内容，也没有运行会改变仓库状态的安装或构建命令。

## 2. 一页结论

```text
Multica
  Issue / board first
  Coding agents as teammates
  Server dispatches work to local/cloud daemon
  Strong task queue, runtime and team operations

LobeHub
  Agent / conversation first, Task increasingly important
  General-purpose agent operating platform
  Strong content, knowledge, memory, tools and delivery verification

PersonaHub
  Issue / workflow / evidence first
  Local personal agent team workbench
  Intended edge: typed handoff + event-level evidence + safe automatic Done
```

核心判断：

1. **Multica 是 PersonaHub 当前最直接的同类参考。** 两者都以 Issue 为中心，接入本地 coding CLI，追踪运行，并试图让 Agent 像团队成员一样接活、汇报和沉淀 Skill。
2. **LobeHub 是能力边界更广、工程体量更大的平台型参考。** 它覆盖通用 Agent、模型供应商、多模态、知识库、Memory、Task、Agent Group、远程设备、IM、Desktop 和云端执行。
3. **LobeHub 当前已经有成形的 Verify/Acceptance 域。** Criteria、rubric、check result、evidence、repair round、acceptance aggregate 和 task verify config 都已进入源码；原有“缺少自动验证/修复闭环”的判断已经过时。
4. **LobeHub 仍把最终 acceptance 明确交给用户。** 自动检查与修复可以运行，但 `accepted` 是用户事件。PersonaHub 计划让低风险 Issue 在验证和证据满足后自动 Done，这是一项产品政策差异。
5. **Multica 的 runtime、队列、重试、daemon、CLI 兼容性和本地任务环境已经很成熟。** PersonaHub 不应低估复制这些基础设施的成本。
6. **PersonaHub 不能只靠“Issue + coding agent + trace”差异化。** Multica 已覆盖这组能力，LobeHub 也在快速补齐 Task、CLI Agent 和 Verify。
7. **PersonaHub 剩余机会更窄但清晰：** 单用户本地优先、显式 Workflow、结构化 Handoff、原始事件级 Evidence refs、凭据隔离、有限轮次自动验证和无需人工放行的低风险完成策略。

## 3. 项目定位对比

| 维度 | Multica | LobeHub |
| --- | --- | --- |
| 核心定位 | Managed coding agents platform | Chief Agent Operator / 通用 Agent 平台 |
| 第一入口 | Workspace / Project / Issue board | Agent / Chat / Task / Workspace |
| 核心工作单元 | Issue，底层由 task queue 执行 | Agent session/topic；长工作提升为 Task |
| 主要 Agent | Claude Code、Codex、OpenCode 等 coding CLI | 模型 Agent、平台 Agent、异构 CLI Agent |
| 典型用户 | 软件团队和开发者 | AI power user、知识工作者和多端团队 |
| 核心优势 | Issue 调度、daemon、队列、runtime、团队运营 | Agent/Tool 生态、知识/内容、多端、Verify/Acceptance |
| 主要协作抽象 | Agent、Squad、Issue、Comment、Task Queue | Agent、Group、Topic、Task、Subtask、Page、Brief、Acceptance |
| 自托管 | Next.js + Go + PostgreSQL + daemon | Next.js/Node + PostgreSQL + 可选 Redis/QStash/S3 + Desktop/CLI |

一句话理解：Multica 更像“Linear/Jira + coding agent runtime”；LobeHub 更像“Agent operating suite + Chat/Task/Knowledge/Execution platform”。

## 4. Multica 详细拆解

### 4.1 核心对象与双状态机

Multica 把 Agent 定义成正式 teammate：有 profile、出现在 board、接收 Issue、发表评论、更新状态、报告 blocker，并通过 Skill 复用经验。

| 对象 | 作用 | 主要源码 |
| --- | --- | --- |
| Workspace / Member | 团队、权限和资源边界 | `server/migrations/001_init.up.sql` |
| Agent | runtime、状态、并发限制和 owner | 同上 |
| Issue | status、priority、assignee、parent、acceptance criteria、context refs | 同上 |
| Comment | 人与 Agent 的 Issue 协作记录 | 同上 |
| Agent Task Queue | 把 Issue 映射为可 claim/start/complete/fail 的执行尝试 | 同上 |
| Runtime / Daemon | 连接执行机器和可用 CLI | `server/internal/daemon/`、`handler/runtime*.go` |
| Skill / Skill File | Workspace 级结构化 Skill，可挂到 Agent | `server/migrations/008_structured_skills.up.sql` |
| Squad | Agent/成员组成的静态团队，由 leader 路由 | `server/migrations/084_squad.up.sql` |
| Autopilot | 定时、Webhook 或手动触发周期工作 | `server/migrations/042_autopilot.up.sql` |

业务 Issue 与一次执行尝试是两层状态机：

```text
Issue:
backlog -> todo -> in_progress -> in_review -> done
                                      \-> blocked / cancelled

Agent task queue:
queued -> dispatched -> running -> completed
                            \-> failed -> retry (new queued row)
                            \-> cancelled
```

这种分层允许一个 Issue 有多次运行、评论触发和重试，而不把业务状态与进程状态混在一起。

### 4.2 总体架构

```text
Next.js Web / Electron Desktop / Expo Mobile
                    |
               HTTP + WebSocket
                    v
Go Backend (Chi + services + sqlc)
       |                    |
       v                    +--> realtime hub / optional Redis relay
PostgreSQL 17 + pgvector
       ^
       |
Agent Daemon on local/cloud runtime
       +--> Claude Code / Codex / Copilot / OpenCode / Gemini / ...
       +--> per-task workdir, logs, outputs and provider config
```

主要分层：

- `apps/web`：Next.js 16 Web。
- `apps/desktop`：Electron，复用 core/ui/views，并打包 CLI。
- `apps/mobile`：Expo/React Native。
- `packages/core`、`packages/views`、`packages/ui`：跨端共享逻辑和界面。
- `server/cmd/server`：服务入口、router、listeners、scheduler 和 health。
- `server/cmd/multica`：CLI 命令面。
- `server/internal/handler`：HTTP/WebSocket transport。
- `server/internal/service`：Task、Autopilot 等业务逻辑。
- `server/internal/daemon`：轮询、环境准备、CLI 调用、状态回传。
- `server/data` + sqlc：数据访问。

Go 服务与 daemon 适合进程管理、长连接和并发；PostgreSQL 面向多 Workspace 与持久任务队列。这也是它比 PersonaHub 当前单进程 SQLite 更重的根源。

### 4.3 任务执行链路

```text
创建/更新/评论/提及 Issue
  -> TaskService.Enqueue...
  -> agent_task_queue: queued
  -> daemon 按 runtime、并发和优先级 claim
  -> dispatched
  -> 获取完整上下文
  -> execenv.Prepare / Reuse
  -> 启动 coding CLI
  -> progress/message/usage 实时回传
  -> completed 或 failed
  -> 更新 Issue、Agent、Activity、Autopilot 状态
  -> 必要时创建新 queued row 重试
```

`server/internal/service/task.go` 已提供 `EnqueueTaskForIssue`、`EnqueueTaskForMention`、`EnqueueTaskForSquadLeader`、`ClaimTaskForRuntime`、`StartTask`、`CompleteTask`、`FailTask` 和 `MaybeRetryFailedTask`。它还处理 heartbeat、stale task、lease、并发上限、comment trigger、WebSocket progress、Autopilot 同步和运行目录 GC。

### 4.4 CLI runtime 与任务环境

`server/internal/daemon/execenv/execenv.go` 为每个任务创建：

```text
{workspacesRoot}/{workspaceId}/{shortTaskId}/
  workdir/
  output/
  logs/
  codex-home/       # Codex 专用
  .gc_meta.json
```

关键设计：

- 默认独立 workdir，repo 按需 checkout；也可绑定用户的 `local_directory`。
- 对本地目录有“GC 永不删除用户目录”的显式不变量。
- sidecar manifest 记录系统写入文件，退出时可清理。
- Codex 使用 per-task `CODEX_HOME`，受控复制用户配置并注入 Workspace Skills。
- OpenClaw 使用 per-task wrapper config，把 workspace 锁到当前 workdir。
- 上下文包含 Issue、Comments、Acceptance Criteria、Workspace Context、Project Resources、Repos、Agent Instructions 和 Skills。
- 清理时可删除 workdir、保留 output/logs，再由 GC 回收。

这比“在 repo cwd 中 spawn CLI”成熟得多。它把上下文注入、隔离、Skill hydration、恢复和垃圾回收都产品化了。

安全上仍有边界：PersonaHub 架构调研已记录，Multica 对 Codex app-server approval request 偏向自动放行，因此环境隔离和可观察性较强，但不等于对任意危险命令的强前置阻断。

### 4.5 Squad、Autopilot 与 Skill

Squad 是稳定路由层：一个固定 leader agent，加若干 Agent/Human member；Issue 可直接分配给 Squad，由 leader 决定谁接手或 no-action。它解决 `@FrontendTeam` 这类入口稳定性，但没有 phase、I/O contract、evidence requirement 和 termination condition，不等同 PersonaHub 的 Room/Topology。

Autopilot 支持 schedule、Webhook、手动/API 触发；每次运行有 `autopilot_run`，可 create-issue-then-run 或 run-only，并处理 dedupe、签名、filter、skip、失败和 GC。

Skill 是 Workspace 级正文加多文件实体，与 Agent 多对多；daemon 在任务环境中写入 provider-native 路径。它已实现集中维护、按 Agent 装载和运行时物化，但没有 PersonaHub 规划的 verified Issue -> candidate -> provenance review -> accept gate。

### 4.6 Multica 的优势与边界

优势：

- Issue-first，贴合软件团队工作方式。
- coding CLI 覆盖广，vendor-neutral。
- daemon、queue、retry、runtime health 和执行环境完成度高。
- Human 与 Agent 共享 Issue、Comment、Inbox 和 Squad 心智模型。
- Skills、Autopilots、Projects、Workspaces 已形成运营闭环。

边界：

- 场景高度偏 coding/team operations，通用知识工作弱于 LobeHub。
- Squad 是 leader routing，不是丰富 Workflow/Topology engine。
- Acceptance Criteria 是 Issue 字段，不等于一等 validator/check/evidence domain。
- Postgres、daemon、实时 relay 和多端带来较高部署成本。
- 本地目录的最终安全仍取决于底层 CLI 和凭据环境。

## 5. LobeHub 详细拆解

### 5.1 从 Chat 前端到 Agent operating suite

当前 LobeHub 同时覆盖多模型/多模态 Chat、Agent Builder、Market、Skills、MCP、Agent Group、Task/Subtask、Schedule/Heartbeat、Page、Notebook、Knowledge Base、Memory、异构 coding agents、本机/远程设备、Cloud Sandbox、IM、Workspace 与 Verify/Acceptance。

它的核心资产不是单一 Task，而是 Agent 与用户的长期关系、可组合工具和多端运行环境。

### 5.2 总体架构

```text
Next.js Web / PWA / Electron / CLI / IM channels
                         |
                         v
Main Next.js app + apps/server (Hono/workflows/services)
       |             |              |
       |             |              +--> agent/device gateway
       |             +--> QStash or local scheduler / Redis queue
       v
PostgreSQL + Drizzle
       +--> S3-compatible files/traces/evidence
       +--> model providers, search and connectors

Desktop / remote device
       +--> heterogeneous agent transport
       +--> Claude Code / Codex / OpenCode
       +--> local file, terminal, browser and device control
```

关键区域：

- `src/`：主产品 routes、services、stores 和 UI。
- `apps/server`：Task、Agent Runtime、Verify、Gateway、搜索和文件服务。
- `apps/desktop`：Electron 主进程、本地文件/浏览器/网关和二进制管理。
- `apps/cli`：Device、Agent、Task、Memory 命令。
- `packages/database`：Drizzle schema/models。
- `packages/agent-*`、`tool-runtime`：Agent 与 Tool runtime。
- `packages/heterogeneous-agents`：Codex/Claude Code/OpenCode 的统一 transport、stream 和 subagent 协调。
- `packages/builtin-tool-*`：内置工具拆成大量独立包。
- `packages/device-control`：远程设备与项目文件控制。

与 Multica 相比，LobeHub 模块更细、能力面更宽，但依赖和运行模式也显著复杂。

### 5.3 Task 与异构 Agent

Task 状态为 `backlog | scheduled | running | paused | completed | failed | canceled`，支持 assignee、parent/subtask、dependency graph、schedule/heartbeat、checkpoint、Topic run、operation id、错误审计、连续失败 fuse、Workspace 文档、Brief，以及把结果 bridge 回创建它的 Agent 会话。

`packages/heterogeneous-agents` 将 Claude Code、Codex 和 OpenCode 纳入统一 UI：处理 spawn、resume、stream、intervention、错误和 subagent；Codex 有专门 file-change tracker。Desktop 另提供本地文件、terminal、git、browser 和 IPC；Remote Device 可把操作路由到另一台设备。

Multica 以 server -> daemon -> CLI task 为主；LobeHub 同时兼容模型 Agent、工具 Agent、Desktop CLI Agent 和远程 Device，并把它们统一到 Conversation/Task/Tool runtime 中。

### 5.4 Verify 与 Acceptance：源码中的真实能力

`packages/database/src/schemas/verify.ts` 定义了完整验证域：

| 实体 | 作用 |
| --- | --- |
| `verify_criteria` | 原子 pass/fail 标准，带 verifier type、required、onFail 和文档说明 |
| `verify_rubrics` | 可挂载的 criteria 组合与运行策略 |
| `verify_check_results` | 状态、verdict、confidence、Toulmin 判断、suggestion 和 repair operation |
| `verify_evidence` | screenshot、video、text、DOM snapshot、transcript 及 capturedBy provenance |
| `acceptances` | 针对 task/topic/document 的业务验收聚合 |
| `verify_reports` | 每轮验证的 verdict、统计和叙述报告 |
| `verify_runs` | plan snapshot、状态、上下文和 round chain |

Task 的 `TaskVerifyConfig` 包含 `enabled`、`maxIterations`、自然语言 requirement、`verifierAgentId`、`verifyCriteriaIds` 和 `verifyRubricId`。

```text
Task topic 完成
  -> 解析 task verify config
  -> 创建/关联 Acceptance
  -> 生成 Verify Plan snapshot
  -> rule / LLM / agent verifier
  -> Check Result + Evidence
  -> 聚合 Report
  -> 失败项按 policy 进入 repair
  -> 新 operation 修复并产生下一 verification round
  -> 达到 maxIterations 后停止自动修复
  -> delivered / errored 等待用户 accept/reject
  -> 用户 accept 后 Task completed
```

关键细节：

- 检查项用稳定 id，而不是数组下标。
- Evidence 是独立表，支持文件/内联内容和 captured provenance。
- Verify 多轮保存，最新 snapshot 反映修复后的判断。
- 失败项可关联 suggestion 和 repair operation。
- `maxIterations` 限制 repair/re-run。
- 人工可覆盖单项 check，并记录 false positive/false negative。
- `accepted` 是 terminal 且 user-owned；自动 recompute 不覆盖用户接受。
- 用户 accept 后，task subject 才 completed。

因此准确结论是：**LobeHub 已有完整度很高的自动验证、证据和修复基础设施，但把最终业务 acceptance 保留为用户事件。**

PersonaHub 与它的差异不再是“有没有 Verify”，而是最终 Done 的所有权、Evidence 是否强制引用不可变 run event、Handoff 是否以 evidence refs 为输入输出契约，以及低风险任务是否允许无人验收完成。

### 5.5 Memory、Knowledge、Skill 与部署

LobeHub 的 Resource/Knowledge Base 处理文件、网页和检索；Page/Notebook 承担长文档；Memory 从 Topic 提取 persona、偏好和经验；Skill 支持导入、维护、存储并由 Agent 调用；Tool Runtime 统一内置工具、MCP 与外部能力。

完整自托管通常涉及 Next.js/Node、PostgreSQL、对象存储、可选 Redis queue、QStash workflow/scheduler、Desktop/CLI/Gateway、多供应商 API、认证和 Workspace 权限。源码有 local scheduler 和部分 fallback，但整体仍是平台架构，不适合作为 PersonaHub v0.1 整体复制。

### 5.6 LobeHub 的优势与边界

优势：

- 通用 Agent 产品能力非常完整。
- Model、Tool、MCP、Skill、Knowledge、Memory、多模态生态强。
- Task、Subtask、Schedule、Heartbeat、Brief 形成长期工作系统。
- Verify/Acceptance 的数据建模、证据和修复轮次先进。
- Desktop、Remote Device、IM 和云端覆盖多入口。

边界：

- 巨型 TypeScript monorepo，概念、包和运行模式很多。
- 多端、多模型、多存储与 Gateway 提高自托管和二开门槛。
- Agent/Conversation-centric 历史仍深，Task/Acceptance 是后来扩展的重要域。
- 最终 acceptance 默认需要用户决策。
- 通用产品不会只围绕 coding workflow 优化。

## 6. 逐项对比

| 维度 | Multica | LobeHub |
| --- | --- | --- |
| 用户入口 | Issue/board | Agent/chat，也有 Task |
| Agent 心智 | 工程团队成员/coding CLI | 模型+prompt+memory+tools+knowledge+device |
| 调度 | Go 持久队列 | Task scheduler/workflow + Agent Gateway |
| 本地执行 | 独立 daemon | Electron/Desktop 或 remote device |
| CLI 广度 | 十余种 coding CLI | 统一异构层重点为 Claude Code/Codex/OpenCode |
| 工作目录 | per-task env 或 local directory | Topic/Project/Device context |
| 静态团队 | Squad + leader | Group + Moderator |
| 显式 topology | 无正式 topology 类型 | sequential/parallel/iterative/debate |
| Acceptance criteria | Issue JSON 字段 | 独立 criteria/rubric/config |
| Verify run | 未见同等级一等域 | `verify_runs` |
| Check result/evidence | 依赖 activity/result/logs | 一等 check/evidence/report schema |
| Auto repair | 通用 task retry | finding/policy-driven repair rounds |
| Final gate | Issue/task 状态流 | 用户 acceptance |
| Skill | Workspace skill + files | Skill store/maintainer/builtin/MCP |
| Personal Memory | 非重点 | 核心能力 |
| 数据库 | PostgreSQL + sqlc | PostgreSQL + Drizzle |
| 复杂度 | 中高、domain 集中 | 很高、平台面广 |

## 7. 与 PersonaHub 的关系

### 7.1 概念映射

| PersonaHub | Multica | LobeHub |
| --- | --- | --- |
| Project | Project / Workspace | Project / Workspace |
| Issue | Issue | Task |
| Thread | Comment/activity/task messages | Topic + Task activity |
| Agent | Coding CLI Agent | General/Heterogeneous Agent |
| Squad | Squad | Agent Group |
| Workflow Template | 无同等正式对象 | Task template、Group mode、Agent/Tool config 的组合 |
| Room | 无 | Group/Topic 部分接近，但 contract 较弱 |
| Handoff Packet | Context/result，非正式一等对象 | Topic handoff/Brief，已经较接近 |
| Validation Policy | Acceptance criteria，较弱 | Criteria/rubric/config，强 |
| Evidence Summary | Activity/result/logs | Verify report + evidence，强 |
| Memory | 非核心 | Personal Memory，强 |
| Skill | Structured Workspace Skill | 完整 Skill/Tool/MCP 生态 |
| Local Runtime | Go daemon | Desktop/Remote Device/Gateway |

### 7.2 已不足以构成差异的能力

- Issue/Task 管理 Agent 工作。
- 本地 Codex/Claude Code/OpenCode 接入。
- 结构化 command/file-change/subagent trace。
- Agent Group/Squad。
- 周期任务。
- Skills 和 Workspace。
- 自动验证、证据表和 repair round——LobeHub 已覆盖相当大一部分。

PersonaHub 必须解释这些对象之间的强约束，而不能只强调概念名词。

### 7.3 仍可坚持的组合差异

#### Issue-first + 显式 Workflow contract

```text
Issue Type
  -> Workflow Template
  -> fixed/selected roles
  -> typed Handoff
  -> Validation Policy
  -> Evidence Gate
  -> automatic Done policy
```

Multica 是 Issue-first，但 Workflow/Validation contract 较弱；LobeHub 能力强，但入口与历史更 Agent/Conversation-centric。

#### 原始事件级 Evidence refs

PersonaHub 应兑现每个 completion claim、finding 和 handoff 都引用可解析的原始事实：

```text
event:<thread_event_id>
file-change-set:<run_id>
artifact:<artifact_id>
```

差异不在“有没有截图/日志”，而在业务判断是否被强制绑定到不可变引用。

#### 自动 Done 政策

- 低风险、策略明确、trace 完整：验证通过后自动 Done。
- 高风险、外部写入、证据不足或冲突：升级给用户。
- 多轮验证不收敛：Blocked。

LobeHub 把 acceptance 保留给用户，PersonaHub 可以将可信的低风险自动完成作为明确政策。

#### Handoff 是责任转移，而不是摘要

HandoffPacket 至少应包含 goal/status、changed files、completed/remaining work、findings、unresolved risks、evidence refs、next owner responsibility 和 source run。如果最后只是一段 LLM summary，差异会消失。

#### 小型本地架构与凭据隔离

PersonaHub 当前 Node + Fastify + SQLite + 单用户 local runner 仍有价值：易安装、易备份、不要求 Postgres/Redis/S3/Gateway，并可默认剥离 push 凭据，把外部副作用升级给用户。

### 7.4 路线建议

P0：

1. 把 LobeHub Verify/Acceptance 纳入 F004 的直接竞品基线。
2. F004 不能只实现“validator 跑测试、失败后重试”；这已不领先。
3. 明确 automatic Done policy、trace completeness gate 和 evidence ref invariants。
4. 用同一真实 coding Issue 在 PersonaHub、Multica、LobeHub 实测人工介入次数和证据回溯成本。

借鉴 Multica runtime：

- CLI install/auth/health probe。
- per-run workspace context。
- session/workdir 恢复。
- task lease、stale run recovery、有限重试。
- provider-native Skill 注入。
- 用户目录绝不被 GC 删除的不变量。
- runtime event 标准化。

暂不复制 Postgres 多租户、cloud runtime fleet、Redis relay、Mobile、team invitation 和 billing。

借鉴 LobeHub Verify：

- Criteria 与 Rubric 分层。
- Run plan snapshot 防止历史被后续规则修改污染。
- Check result 稳定 id。
- Evidence 一等化并记录 captured provenance。
- Repair operation 显式关联失败 check。
- 验证轮次独立保存。
- 人工 override 记录 FP/FN，供后续 AgentOps 评价。

Room 只有在展示 phase、goal、topology、成员选择原因、I/O contract、artifact manifest、evidence requirements、budget/termination 和 Human Lead 操作时才值得实现；普通多 Agent 群聊已经被两个竞品覆盖。

Skill Compounding 必须形成：

```text
Done Issue -> verified evidence -> candidate extraction
           -> provenance review -> accept/reject
           -> controlled activation
```

## 8. 场景选择建议

| 场景 | 更适合 | 原因 |
| --- | --- | --- |
| 团队管理多个 coding agents | Multica | Issue、daemon、runtime、Squad 和 queue 直接 |
| 通用 AI 工作台 | LobeHub | 模型、Knowledge、Memory、Task、Page、Tools 和多端广 |
| 论文、书籍、研究、写作 | LobeHub | Resource、Knowledge、Page、Group、多模态成熟 |
| 周期性 coding/ops | Multica | Autopilot + Issue + daemon 控制链清晰 |
| 细粒度交付验证报告 | LobeHub | Verify/Acceptance/Evidence 数据域最强 |
| 极简本地、SQLite、个人单机 | PersonaHub 目标形态 | 两个竞品都较重 |
| 验证通过后无人值守自动 Done | PersonaHub 目标形态 | LobeHub 保留人工 acceptance；Multica 缺同级 Verify |
| 跨 CLI typed evidence handoff | PersonaHub 目标形态 | 仍需真正实现和验证 |

## 9. 最终判断

Multica 是 PersonaHub 的直接竞品：它已实现 Issue-first、coding Agent、local daemon、run trace、Skill、Squad 和 Autopilot。PersonaHub 如果只完成 Board + Codex + trace，会像一个更小、更早期的 Multica。

LobeHub 已覆盖 PersonaHub 验证方向的很大一部分：有独立 Verify/Acceptance/Evidence/Repair 体系。准确差异是 LobeHub 自动验证和修复，但最终 acceptance 由用户决定；PersonaHub 计划在低风险策略下由 validation + evidence 自动推动 Done。

两者目前仍不能完全替代 PersonaHub 的目标，但剩余空间比原先判断更窄：

- Multica 缺显式 Workflow Template、强 Verify/Evidence domain 和 typed Handoff。
- LobeHub 有强 Verify 和广平台能力，但不是小型单机 Issue workflow，且 acceptance policy 不同。
- PersonaHub 的价值必须由真实端到端结果证明，而不是由名词证明。

建议收紧定位为：

> 面向个人本地 CLI Agent 团队的 proof-carrying coding workflow：每次责任转移携带结构化上下文和原始证据引用，低风险任务在有限轮次独立验证通过后自动完成，异常才升级给用户。

## 10. 建议的实测基准

选择同一个本地仓库 Issue，在三个系统中对照：

1. 修改一个有现成测试的中等复杂度功能。
2. 要求 Agent 实现、测试、修复失败并给出证据。
3. 中途追加约束，观察 checkpoint/恢复。
4. 故意制造“测试通过但需求未满足”，观察 verifier。
5. 切换第二个 Agent 继续，记录上下文复制量。

记录启动成功率、手工复制次数、人工放行次数、断线恢复率、结论回溯到原始命令/退出码/文件变化的成本、fail-to-repair 自动化程度、错误 Done/Blocked 次数，以及安装运行所需服务数量。

## 11. 本地源码证据索引

### Multica

- `D:\Projects\multica\README.md`
- `D:\Projects\multica\package.json`
- `D:\Projects\multica\server\migrations\001_init.up.sql`
- `D:\Projects\multica\server\migrations\008_structured_skills.up.sql`
- `D:\Projects\multica\server\migrations\042_autopilot.up.sql`
- `D:\Projects\multica\server\migrations\084_squad.up.sql`
- `D:\Projects\multica\server\internal\service\task.go`
- `D:\Projects\multica\server\internal\service\autopilot.go`
- `D:\Projects\multica\server\internal\daemon\daemon.go`
- `D:\Projects\multica\server\internal\daemon\execenv\execenv.go`
- `D:\Projects\multica\server\internal\realtime\`

### LobeHub

- `D:\Projects\lobehub\README.md`
- `D:\Projects\lobehub\package.json`
- `D:\Projects\lobehub\packages\types\src\task\index.ts`
- `D:\Projects\lobehub\packages\database\src\schemas\verify.ts`
- `D:\Projects\lobehub\packages\heterogeneous-agents\`
- `D:\Projects\lobehub\packages\device-control\`
- `D:\Projects\lobehub\apps\server\src\services\taskLifecycle\`
- `D:\Projects\lobehub\apps\server\src\services\taskRunner\`
- `D:\Projects\lobehub\apps\server\src\services\verify\`
- `D:\Projects\lobehub\apps\server\src\services\agentRuntime\`
- `D:\Projects\lobehub\apps\desktop\src\main\`

### PersonaHub

- `CLAUDE.md`
- `docs/personahub-prd.md`
- `docs/personahub-architecture.md`
- `docs/personahub-system-design.md`
- `docs/features/0.1/F003-development-trace/`
- `docs/features/0.1/F004-autonomous-validation/`
- `docs/features/0.1/F005-multi-agent-manual-routing/`
