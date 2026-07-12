# PersonaHub 竞品分析与项目切入点报告

分析日期：2026-07-11  
目标：为个人使用的 AI Agent Team 开源项目 `PersonaHub` 找到清晰切入点、产品独特点和第一阶段路线。

## 1. 执行摘要

`clowder-ai` 和 `multica` 都在做“把多个 AI coding agents 组织成团队”的事情，但它们的产品气质和系统重心明显不同：

- `clowder-ai` 更像一个“有身份、有记忆、有文化、有治理流程的 AI 团队空间”。它强调多 agent 协作、跨模型审阅、共享记忆、SOP、CVO 模式、聊天线程、Hub、Mission Hub 和跨平台入口。
- `multica` 更像一个“面向工程任务交付的托管 agent 工作台”。它强调 issue board、agent assignee、runtime daemon、任务生命周期、实时进度、skills 复用、squads、autopilot、self-hosting 和云/本地 runtime 管理。

`PersonaHub` 的机会不在于复制其中任何一个，而在于做一个更适合个人长期使用的“轻量 agent 编织层”：

> 用 Multica 的工程化项目/Issue 管理方法组织工作，用 Clowder 的 Thread 协作内核承载会话、交接、审阅、证据和记忆，但降低叙事复杂度、部署复杂度和 UI 噪音。

建议定位：

> PersonaHub 是一个个人优先、开源可自托管的 AI Agent Team 自动化工作台：把 Claude、Codex、Gemini、OpenCode 等 CLI agents 编织成可分工、可自主执行、可自动审阅、可记忆、可复盘的长期协作网络。

## 2. 竞品概览

| 维度 | clowder-ai | multica | PersonaHub 可取方向 |
| --- | --- | --- | --- |
| 核心口号 | Build AI teams, not just agents | Open-source managed agents platform | Weave your personal AI agent team |
| 产品重心 | 团队人格、长期记忆、协作纪律、CVO 共创 | issue 分配、runtime 执行、进度追踪、技能沉淀 | 个人工作流中的 agent 编排、Issue 管理、上下文织网 |
| 主要入口 | Chat、Hub、Mission Hub、多平台聊天 | Board、Issues、Agents、Runtimes、CLI daemon | Projects / Issues / Thread / Agents / Automations |
| 协作模型 | @mention routing、A2A、跨模型 review、线程隔离 | issue assignee、squad leader、daemon claim/execute | “Project 下管理 Issue，Issue 内承载 Thread，Thread 中完成 handoff/review/evidence” |
| 部署形态 | Node/pnpm/Redis，可桌面 installer，可 source start | Next.js + Go + PostgreSQL/pgvector + daemon，Docker/Helm/self-host | 优先本地单机，后续支持 server/daemon |
| 风格 | 强叙事、强人格、功能丰富 | 简洁工程化、团队任务管理感 | 克制、专注、个人生产力优先 |
| 风险 | 功能面广、品牌个性强、学习成本较高 | 更偏团队/SaaS/云托管，个人使用略重 | 先做小而硬的核心闭环 |

补充取舍：Clowder 的语音、陪伴和游戏模式可以证明其平台层可扩展，但 `PersonaHub` 当前诉求更偏个人工程工作台，这些能力不进入早期路线，也不作为 P2 默认方向。

### 2.1 重要特性与模块方案对照

这张表把“多 Agent 协同工作台”拆成可落地模块：不是看谁功能更多，而是判断每个模块在两个开源项目里承担什么职责，以及 `PersonaHub` 第一版应该怎么取舍。

| 特性 / 模块 | clowder-ai 方案 | multica 方案 | PersonaHub 建议方案 |
| --- | --- | --- | --- |
| 产品主入口 | Chat + Hub + Mission Hub。以多线程对话承载协作，以 Hub 承载能力/配置，以 Mission Hub 承载功能治理。 | Board / Issues 作为第一入口。用户创建 issue、分配 agent、查看进度和状态。 | 三栏工作台：左侧 `Projects / Issues / Automations / Agents / Teams`，中间打开当前 Issue 的 primary Thread，右侧展示状态、审计、日志和证据。 |
| 核心工作对象 | Thread / Mission / Feature。强调上下文隔离、协作纪律和长期团队记忆。 | Issue / Agent / Runtime。强调可分配、可执行、可追踪的工程任务。 | `Thread` 是底层协作容器，`Issue` 是上层管理对象。第一版一个 Issue 默认拥有一个 primary Thread，后续可扩展多个 thread。 |
| Agent 身份模型 | Persistent Identity：agent 有稳定角色、人格、记忆和团队关系。 | Agent Profile：agent 像 teammate 一样出现在 board、comments、assignments 中。 | 克制版 Agent Profile：`name`、`role`、`CLI/provider`、`runtime`、`capability tags`、`instructions`。保留稳定角色，不做强 IP 化包装。 |
| 任务路由 | @mention routing + A2A router + routing policy + SOP 阶段分配。 | issue assignee / squad assignee；runtime 根据可用 CLI 接任务。 | P0 支持显式 assign 和 `@agent`；P1 加 capability-based routing；P2 再做 squad/group。 |
| 协作协议 | A2A async messaging、thread isolation、structured handoff、跨模型 review。 | issue comments、activity timeline、agent blocker/status update。 | 定义 `handoff packet`：目标、当前结论、关键证据、阻塞、下一步；每次 handoff 写入 trace。 |
| 执行运行时 | 平台层调用各 Agent CLI adapter；统一消息层标准化不同输出格式。 | 本地 daemon 自动检测 CLI、注册 runtime、claim task、创建隔离目录、启动 agent、回传进度。 | 先做本地 process runner + adapter registry；数据模型保留 `Runtime`。v0.2 再拆 `PersonaHub daemon`。 |
| Agent CLI 适配 | 支持 Claude Code、Codex、Gemini/Antigravity、OpenCode 等；关注输出格式与 MCP 状态。 | daemon 检测 PATH 中 Claude、Codex、OpenCode、Cursor Agent、Kimi、Antigravity、Qoder 等 CLI。 | 第一批只做 3 个高频 adapter：Codex、Claude Code、OpenCode。adapter 输出统一为 run events。 |
| 实时进度 | 流式 agent 消息进入 Chat / Thread / rich blocks。 | WebSocket progress streaming，issue activity 实时更新。 | P0 用 SSE 或 WebSocket 均可，但事件模型先定：`run.started`、`run.output`、`tool_call`、`blocked`、`completed`、`failed`。 |
| 任务生命周期 | Mission lifecycle：idea -> spec -> in-progress -> review -> done，配 SOP gate。 | Issue lifecycle：enqueue -> claim -> start -> complete/fail，支持 blocker。 | 状态简化为 `Inbox / Ready / Running / Reviewing / Blocked / Done`；Done 必须有 verification trace。 |
| 审阅机制 | Cross-model review 是核心能力：一个 agent 实现，另一个 agent 审阅；结果进 evidence。 | 更偏执行状态和任务完成；review 不是最强叙事中心。 | Autonomous Agent Review Loop：实现完成后自动 handoff 给 reviewer；review pass + verification trace 后自动 Done，fail 则回到 Running 修复。 |
| 记忆与证据 | Shared Memory：evidence store、lessons learned、decision logs、SOP 结果。 | PostgreSQL/pgvector 为 skills、历史、语义检索留空间；更偏任务/技能复用。 | `Memory` 分层：decision、lesson、preference、project fact；每条都必须有 source issue/thread、author、timestamp、confidence。 |
| Skills / 复用 | Skills Framework：按需 prompt loading，TDD/debugging/review 等技能由 agent 在需要时加载。 | Reusable Skills：部署、迁移、review 等解决方案沉淀为团队能力。 | skill 不是纯 prompt：包含触发条件、步骤、输入、输出格式、验证方式、关联证据；P0 先用 Markdown/YAML。 |
| SOP / 治理 | SOP Guardian、Iron Laws、design gates、quality checks、vision guardianship、merge protocols。 | lifecycle 和 runtime 管理更强，治理更多体现在 task execution 和 self-host infra。 | 默认自动化 gate：Agent Review Passed、Verified Done、Escalation Required。只有权限、不可逆风险或阻塞才打断 operator。 |
| UI 信息架构 | 功能面丰富：Chat、Hub、Mission Hub、Signals、Voice、Game 等多个工作面。 | 工程化工作台：Board、Issues、Agents、Runtimes、Settings、activity timeline。 | 三栏布局：左侧 Multica 式工程导航，中间 Clowder 式 Thread 会话，右侧 Inspector 展示 Context / Agents / Logs / Audit / Evidence。Board 作为后期可选视图；voice/陪伴/game 暂不纳入路线。 |
| Runtime / 机器管理 | 依赖本地 Node/pnpm/Redis 或桌面 installer；更像平台应用本身管理运行环境。 | Unified Runtimes：本地 daemon + cloud runtime；Settings -> Runtimes 可看心跳和可用 CLI。 | P0 做本机 CLI health check；P1 做 runtime registry；P2 支持多机器 daemon。 |
| 存储方案 | Node/pnpm monorepo，Redis 可选；重点是 memory/evidence/SOP 运行状态。 | PostgreSQL 17 + pgvector，Go backend + sqlc + migrations。 | 第一版 SQLite 本地存储 + Markdown export；schema 预留迁移到 Postgres/pgvector 的边界。 |
| 部署形态 | Source setup + desktop installer；默认端口 3003；Redis 可 bundled。 | Cloud + self-host；Docker Compose、GHCR images、Helm/Kubernetes；CLI daemon 本地跑。 | Local-first：单机桌面/Web 本地应用优先；暂缓 auth、cloud、Helm。后续再支持 Docker Compose。 |
| 自动化任务 | 有 Signals、Mission、SOP 等更广工作流延展。 | Autopilots：cron、webhook、manual run 自动创建 issue 并路由 agent。 | P1 加 `Scheduled Issue`：定时创建 issue；P2 支持 webhook/autopilot 模板。 |
| 多人 / 多工作区 | 更像个人与 AI 团队的长期空间，也有多平台入口。 | Multi-workspace 是明确能力，适合团队隔离 agents、issues、settings。 | 第一阶段只做单用户多项目；workspace/auth 放到后期。 |
| MCP / 外部工具 | MCP Integration + callback bridge，是平台层能力之一。 | 重点不在 MCP，而在 runtime/daemon 执行各种本地 CLI。 | P0 不把 MCP 做成主线；adapter 层预留 tool event，P1 再接 MCP server registry。 |
| 人类角色 | CVO：人类负责愿景、关键决策和反馈。 | 人类像工程 manager/teammate 一样创建 issue、分配任务、监督进度。 | 使用更中性的 `Owner / Operator`：主要配置目标、边界和自动化规则；默认不参与每个 review 放行，只处理 escalation。 |
| 产品气质 | 有强情感和团队文化，辨识度高但学习成本高。 | 清爽、工程化、低心智成本，但长期记忆与审阅深度较弱。 | “Multica 的工作台骨架 + Clowder 的协作/记忆/审阅内核”，视觉克制、流程可靠。 |

优先级结论：

- P0：Project、Issue、Primary Thread、Agent Profile、Local Runner、Run Events、Agent Review Loop、Evidence Summary、SQLite。
- P1：@mention routing、Memory snippets、Skills、Runtime health check、Scheduled Issue、Markdown export。
- P2：daemon、多机器 runtime、squads、Postgres/pgvector、GitHub 双向同步、cloud/self-host server。

## 3. clowder-ai 深度分析

### 3.1 项目定位

`clowder-ai` 自称是把孤立 AI agents 变成真实团队的平台层。README 中列出的核心能力包括 multi-agent orchestration、persistent identity、cross-model review、A2A communication、shared memory、skills framework、MCP integration、SOP discipline 等。

它的关键思想不是“多调用几个模型”，而是把模型、agent CLI、平台层分工拆开：

- 模型负责推理和生成。
- Agent CLI 负责工具使用、文件操作和命令执行。
- 平台负责身份、协作、纪律、审计、记忆和路由。

这对 `PersonaHub` 很重要：如果你要做个人 AIAgentTeam，平台层不应该再造模型能力，而应该专注于“谁来做、怎么交接、怎么保留证据、怎么复用经验”。

### 3.2 产品与页面逻辑

`clowder-ai` 的界面逻辑大致是：

- `Chat`：多线程团队聊天，每个 thread 对应一个 feature、bug 或主题；用 @mention 路由到不同 agent；通过 thread isolation 保持上下文清洁。
- `Hub`：浮动命令中心，包含 agent capability、skills、quota、routing policy、account configuration。
- `Mission Hub`：功能治理工作台，用 idea -> spec -> in-progress -> review -> done 管理 feature lifecycle。
- `Multi-Platform`：飞书、GitHub PR review、slash commands、语音和文件传输。
- `Signals`、`Voice Companion`、`Game Modes`：扩展到研究、语音和娱乐等非核心工作场景。

你喜欢它的页面布局和使用逻辑，合理的原因是：它不是单一聊天框，而是把“对话、任务、治理、配置、研究”拆成不同工作面，让 agent team 更像一个能长期工作的组织。

### 3.3 优点

- 协作范式完整：不仅有 agent 调用，还有 @mention、A2A、thread、handoff、review、SOP。
- 人格和记忆强：persistent identity 与 shared memory 让 agent team 有持续性。
- 产品想象力强：CVO、Mission Hub、Signals 等模块让它不只是 coding dashboard。
- 质量意识强：Iron Laws、Five Principles、pre-merge gate、evidence/verified 等设计强调底线和审计。
- 适合长期个人工作空间：尤其适合把 AI 当作固定团队成员，而不只是一次性工具。

### 3.4 短板与可避坑点

- 叙事和品牌个性很强，开源用户不一定都接受“猫猫团队”这一层设定。
- 功能范围较大，初学者可能不知道先从哪里开始。
- 同时覆盖聊天、任务治理、研究、语音、游戏、多平台，会拉高维护成本。
- UI 可能会被功能密度和人格元素拉向“热闹”，而你明确想要 Multica 那种简洁风格。

### 3.5 对 PersonaHub 的启发

保留：

- thread isolation
- @mention routing
- cross-model review
- shared memory / evidence store
- skills on-demand loading
- mission/feature lifecycle
- human-as-vision-owner 的边界设定和高风险 escalation

弱化：

- 强角色拟人包装
- 游戏、陪伴、语音等非首要场景
- 过度丰富的 Hub 项目

转译成 `PersonaHub` 语言：

- 不叫 CVO，可以叫 `Owner` 或 `Human Lead`。
- 不叫 cats，可以叫 `agents`、`roles`、`members`。
- 不强调“家园”，强调“workspace memory”和“decision trail”。

## 4. multica 深度分析

### 4.1 项目定位

`multica` 自称 open-source managed agents platform，核心是把 coding agents 变成真实队友：给 agent 分配 issue，agent 自动认领、执行、汇报 blocker、更新状态，并且让 skills 随着工作积累。

它支持多种 CLI agent，包括 Claude Code、Codex、OpenCode、Cursor Agent、Kimi、Antigravity、Qoder CLI 等。对于更大团队，它提供 Squads：把 work assign 给一个 squad，由 leader agent 决定谁处理。

### 4.2 产品与页面逻辑

`multica` 的主逻辑更像工程协作系统：

- Board / Issues：人像给同事派任务一样给 agent 派 issue。
- Agent profiles：agent 作为一等 teammate 出现在 board、comments、assignments 中。
- Runtime daemon：本地机器或云 runtime 执行 agent task，自动检测 CLI。
- Progress streaming：通过 WebSocket 实时流式更新进度。
- Autopilots：cron、webhook、manual run 触发 recurring work。
- Skills：把解决方案沉淀为可复用能力。
- Multi-workspace：按团队/项目隔离 agents、issues、settings。

你喜欢它的简洁风格，核心原因是它把 agent 协作翻译成非常熟悉的工作管理语言：issue、assignee、runtime、status、comment、board。这个方向对 `PersonaHub` 很值得借鉴。

### 4.3 技术架构

公开 README 中的架构是：

- Frontend：Next.js 16
- Backend：Go + Chi + WebSocket
- Database：PostgreSQL 17 + pgvector
- Agent Runtime：local daemon 执行本地 agent CLI
- 部署：Docker Compose、self-host、Helm/Kubernetes

这个架构适合多人团队和自托管服务，但对个人项目的第一版偏重。`PersonaHub` 可以先做更轻的本地-first 架构，再逐步演进到 daemon/server。

### 4.4 优点

- 任务模型清晰：issue -> assign -> execute -> progress -> complete/fail。
- UI 风格更工程化、更克制，容易被开源用户理解。
- Runtime 抽象扎实：daemon 检测本地 CLI，后端统一管理执行环境。
- Self-hosting 路线完整：Docker、Helm、CLI setup 都覆盖。
- Autopilot 和 Squads 很适合从个人扩展到小团队。

### 4.5 短板与可避坑点

- 更偏团队任务系统，个人“长期上下文、偏好、决策记忆”的表达不如 Clowder 强。
- issue board 是好入口，但如果缺少深层 memory/review/context graph，agent 容易变成任务执行器。
- 技术栈较重：Go backend + Postgres + daemon + Next.js + Docker 对个人项目启动成本高。
- Cloud/self-host 双路线容易让产品早期关注点分散。

### 4.6 对 PersonaHub 的启发

保留：

- issue list / board 作为主要工作入口
- agent assignee / squad assignment
- runtime registry
- progress streaming
- autopilot recurring tasks
- skills compounding
- 简洁、低噪音、工程化 UI

弱化：

- 早期多人 workspace
- 复杂 cloud account / auth
- Kubernetes / Helm
- 过早追求完整 SaaS 化

## 5. PersonaHub 的定位建议

### 5.1 一句话定位

`PersonaHub` 是一个个人优先的开源 AI Agent Team 工作台，把多个 coding agents 编织成可分工、可记忆、可审阅、可复盘的长期协作网络。

### 5.2 核心价值主张

1. 个人优先：先服务一个高频使用者，而不是一上来做企业协作平台。
2. Agent 编织：不是简单并发调用，而是让 agent 在任务、记忆、审阅和交接中形成关系。
3. 清爽克制：学习 Multica 的简洁 UI，不做强装饰、强拟人、强品牌噪音。
4. 长期记忆：学习 Clowder 的 identity、shared memory、evidence、decision log。
5. 本地可信：优先本地运行、本地存储、本地 CLI，个人数据不离开机器。
6. 可渐进开源：先做小闭环，保留演进到 daemon/server/cloud 的空间。

### 5.3 推荐目标用户

第一阶段不要面向“所有团队”，而是面向：

- 独立开发者
- 使用多个 AI coding CLI 的重度用户
- 有多个项目、多个上下文，需要长期记忆和复盘的人
- 想让 Claude/Codex/Gemini/OpenCode 互相审阅的人
- 希望把 AI 从“聊天窗口”升级为“个人工程团队”的用户

## 6. 产品切入点

### 6.1 MVP 主线：Issue-managed Thread + Agent Handoff

第一版只做一个闭环：

1. 用户在某个 project 下创建一个 issue。
2. 系统自动为 issue 创建一个 primary thread。
3. 用户给 issue 选择 owner agent，例如 `architect`、`coder`、`reviewer`、`researcher`。
4. agent 在 primary thread 中协作、执行、交接和审阅。
5. 执行过程产生 progress events、artifacts、decisions、blockers、logs 和 evidence。
6. 系统自动把当前 thread handoff 给 reviewer agent 做 review 或 follow-up。
7. reviewer 通过后，系统自动生成 evidence summary 和 lessons learned，并将 issue 推进到 Done。

这条主线结合了：

- Multica 的 project / issue / assignee / lifecycle 管理方法。
- Clowder 的 thread isolation / handoff / cross-model review / evidence 协作内核。

核心原则：

> Thread-first collaboration, Issue-based management.

中文可以写成：

> 底层以 Thread 承载协作，上层以 Issue 管理工作。

### 6.2 第一屏建议

不要做 landing page。打开就是工作台：

- 左侧：Projects / Issues / Automations / Agents / Teams / Skills / Settings
- 中间：当前 Issue 的 primary Thread
- 右侧：Context Inspector

右侧 Context Inspector 是 `PersonaHub` 的独特点：

- 当前 issue 目标、状态、优先级和归属 project
- 参与 agents
- agent 状态和消息统计
- 已做决策
- 审计记录
- 运行日志
- 关键文件/链接/证据
- 可复用 lessons
- 下一步建议

这样左侧吸收 Multica 的工程化目录，中央保留 Clowder 的会话核心，右侧提供面向个人 operator 的状态、审计和运行真相。

第一阶段不建议把 Board 做成默认主视图。个人使用时，Issue list + 当前 Thread 的效率更高；未来扩展到多人协同时，再把 `Issues` 增加 Board 视图。

### 6.3 信息架构

建议第一版模块：

- `Projects`：长期工作空间，归档相关 issues、threads、agents、memory。
- `Issues`：工程化管理对象，状态为 Inbox / Ready / Running / Reviewing / Done / Blocked。
- `Threads`：底层协作容器。v0.1 中每个 issue 默认一个 primary thread；自动审阅作为 thread 内事件存在。未来复杂任务可扩展多个 threads，但不把 Review 做成独立一级模块。
- `Agents`：角色配置、CLI adapter、能力标签、默认模型。
- `Automations`：定时或事件触发的 recurring issues，后续再做。
- `Memory`：项目记忆、用户偏好、决策日志、经验片段。
- `Skills`：可复用 prompt/workflow，后续再做自动沉淀。
- `Settings`：provider、CLI、runtime、本地存储。

### 6.4 数据关系建议

`PersonaHub` 的数据层不要把 Issue 和 Thread 混成一个对象。推荐关系：

```text
Project
  └─ Issue
       ├─ primaryThread
       ├─ runs
       ├─ evidence
       ├─ decisions
       └─ status / assignee / priority / labels

primaryThread
  ├─ messages
  ├─ handoff events
  ├─ review events / findings
  ├─ run logs
  └─ evidence refs
```

v0.1 可以强约束：

```text
每个 Issue 必须有且只有一个 primary Thread。
```

但模型上预留未来扩展：

```text
Issue may own multiple Threads in future.
```

未来复杂任务可以拆成：

- `researchThread`
- `implementationThread`
- `incidentThread`

### 6.5 关键交互

- `@agent`：在 thread 中召唤特定 agent。
- `auto handoff to reviewer`：实现 agent 完成后，系统把当前上下文压缩后交给 reviewer。
- `ask for plan`：让 architect 输出方案。
- `run implementation`：让 coder 执行。
- `review with evidence`：让 reviewer 只输出 findings、文件位置、风险和通过/不通过结论。
- `save lesson`：把本次经验写入 memory。
- `promote to skill`：把成功流程提升为 skill。
- `schedule autopilot`：把 recurring issue 变成定时任务。

## 7. PersonaHub 的独特点设计

### 7.1 Context Weaving：上下文织网

竞品都有记忆或技能，但 `PersonaHub` 可以把“上下文结构化”作为独特点。

每个 issue 的 primary thread 自动维护：

- Goal：用户真实目标
- Constraints：边界、技术限制、偏好
- Decisions：已确认决策
- Evidence：命令输出、测试结果、链接、截图
- Artifacts：代码、文档、PR、报告
- Lessons：可复用经验
- Open Questions：未决问题

这不是普通聊天历史，也不是单纯 issue comments，而是可以被不同 agent 读取、压缩、继承的工作上下文图。Issue 负责“这件事如何被管理”，Thread 负责“这件事如何被协作完成”。

### 7.2 Issue-managed Thread：工程管理壳 + 协作内核

`PersonaHub` 最核心的产品结构应是：

```text
Multica-style management shell
  Project -> Issue -> assignee / status / priority / automation

Clowder-style collaboration core
  Thread -> messages / handoff events / review events / decisions / evidence / logs
```

这个分层带来三个好处：

- 个人第一版足够轻：左侧只需要 issue list，不必默认做完整 board。
- 多人协作可渐进：未来 Issue 可以进入 board、squad、workspace、GitHub sync。
- Thread 不被弱化：会话、审阅、记忆、证据仍是系统最有辨识度的底层能力。

### 7.3 Personal Team OS：个人团队操作系统

Multica 更像团队 issue 平台，Clowder 更像 AI 团队家园。`PersonaHub` 可以选择中间路线：

- 像团队一样分工
- 像个人工具一样轻
- 像知识库一样记得住
- 像审计系统一样可追溯

### 7.4 Agent Review Loop：会话内自动审阅闭环

本文档中的 `Review` 默认指 thread 内的 agent-to-agent 自动审阅流程，而不是人类手动放行阶段。`PersonaHub` 的目标是纯自动化自主运行：实现 agent 完成后，reviewer agent 在同一个 issue/thread 里审阅；review 通过后，系统可以自动把 issue 推进到 `Done`。

第一阶段的 Review 重点是代码/工程任务完成后的自动检查：

- 实现 agent 完成工作后，系统自动 handoff 给 reviewer agent。
- reviewer agent 检查 bug、风险、测试缺口和验收证据。
- reviewer 不重复实现，除非 review finding 明确要求 follow-up fix。
- review 必须引用 evidence，例如 diff、日志、测试结果、文件位置。
- review 通过且 verification trace 存在时，issue 自动进入 `Done`。
- review 不通过时，issue 回到 `Running`，并把 findings 作为下一轮修复输入。

只有以下情况才需要 operator escalation：

- 需要访问新权限、凭据或外部账号。
- 涉及不可逆操作或高风险文件/数据变更。
- reviewer 和 implementation agent 多轮后仍无法收敛。
- agent 明确标记需求不清或目标冲突。

后续可以扩展两类自动 review，但不进入 P0：

- `Plan Review`：执行前检查方案是否合理。
- `Doc Review`：重要文档或 spec 完成后检查结构、遗漏和风险。

这个方向让 `PersonaHub` 更像一个自主运行的 agent 工作台，而不是需要人类持续盯着每一步的项目管理工具。

### 7.5 Local Runtime First：本地运行优先

个人项目第一阶段建议：

- 先支持本地 CLI adapter。
- 本地 SQLite 或 LiteFS/DuckDB 存储。
- 可选向量索引，后续再上 Postgres/pgvector。
- 先不做 cloud account。

这会显著降低开源用户试用成本。

### 7.6 Minimal Team Aesthetic：克制团队感

UI 风格建议：

- 使用类似 Linear / GitHub Projects / Raycast 的克制界面。
- 不做强 IP 化角色皮肤。
- agent 可以有头像和颜色，但不要喧宾夺主。
- 把视觉重心放在任务状态、上下文、证据和下一步。

## 8. 推荐技术路线

### 8.1 第一阶段：单机本地版

目标：最快跑通个人使用闭环。

- Frontend：Next.js 或 Vite + React
- Backend：Node.js/Fastify 或 Next.js API routes
- Storage：SQLite
- Realtime：Server-Sent Events 或 WebSocket
- Agent adapters：先支持 Codex CLI、Claude Code、OpenCode
- Local runner：本地子进程队列
- Memory：SQLite tables + markdown export

优点：

- 部署简单
- 容易贡献
- 适合个人使用
- 不需要一开始维护 Go/Postgres/Docker 全家桶

### 8.2 第二阶段：daemon 化

当本地任务执行稳定后，再拆出 daemon：

- `PersonaHub daemon start`
- runtime auto-detect
- CLI adapter registry
- job queue
- workspace sync

这时再借鉴 Multica 的 runtime model。

### 8.3 第三阶段：自托管 server

后续再支持：

- Docker Compose
- PostgreSQL + pgvector
- 多 workspace
- 多设备访问
- 多用户协作
- webhook / GitHub integration

## 9. MVP 功能优先级

### P0：必须有

- 创建 project
- 创建 issue
- issue 自动拥有 primary thread
- agent 配置
- 运行本地 CLI agent
- issue 状态流转
- progress log
- 自动 handoff/review
- decision log
- evidence summary
- 本地持久化

### P1：强烈建议

- @mention routing
- agent capability tags
- memory snippets
- project profile
- issue list filters
- reusable skills
- recurring issues
- simple command palette
- markdown export

### P2：后续再做

- squads
- multi-workspace
- issue board view
- cloud runtime
- GitHub issue/PR 双向同步
- mobile
- research feed

## 10. 与竞品的差异化叙事

可以这样描述 `PersonaHub`：

> Clowder shows what an AI team can feel like. Multica shows how agents can be managed like teammates. PersonaHub focuses on the personal operator: a quiet workspace where projects and issues manage the work, while threads, agents, memory, review events, and evidence carry the collaboration.

中文开源介绍可用：

> PersonaHub 不是另一个聊天壳，也不是完整企业 agent 平台。它是给个人开发者使用的 AI Agent Team 工作台：你用 Project / Issue 管理工作，用 Thread 承载多个 agents 的分工、交接、审阅、记忆和证据链。

## 11. 项目命名与概念体系

> 编者按：本节是项目早期（曾用名 `crewdesk`）的命名头脑风暴，讨论的 Weave/Loom 系概念最终未被采纳。项目正式定名为 `PersonaHub`，命名过程见 PRD 或后续 `docs/decisions/` 记录，本节仅作历史存档保留。

`crewdesk`（项目曾用名）这个名字很好，可以自然发展出一套概念：

- `Project`：长期工作空间，承载 issues、agents、memory 和 settings
- `Issue`：工程化管理对象，包含目标、状态、负责人、优先级和标签
- `Thread`：底层协作容器，承载消息、handoff、review events、decisions、evidence 和 logs
- `Weave`：多个 thread、agent、memory 交织成的项目网络
- `Loom`：调度/编排层
- `Pattern`：可复用 workflow/skill
- `Knot`：重要决策或阻塞点
- `Trace`：证据链

建议避免过度命名。第一版只保留：

- Project
- Issue
- Thread
- Agent
- Memory
- Skill
- Trace

## 12. 开源 README 第一版建议结构

1. 项目一句话
2. 为什么做：多个 AI CLI 很强，但用户被迫当 router
3. 核心截图或终端 demo
4. 核心概念：Project / Issue / Thread / Agent / Memory / Trace
5. Quick Start
6. 支持的 agents
7. Roadmap
8. 与 Clowder/Multica 的关系：inspired by，但不复制
9. License

## 13. 风险与应对

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| 范围膨胀 | 同时做聊天、看板、语音、研究、云平台 | 第一版只做 issue-managed thread + agent review loop |
| 过度抽象 | adapter、runtime、memory 一开始就平台化 | 从个人本地 CLI 开始，接口留扩展点 |
| UI 变复杂 | Hub、Board、Thread、Memory 全挤在一起 | 三栏布局：左侧工程导航 / 中间 thread / 右侧 inspector；Board 后置 |
| 记忆不可控 | agent 乱写 memory，污染上下文 | memory 必须有来源 issue/thread、时间、置信度和可追溯证据；高风险记忆再升级确认 |
| 执行不可信 | agent 自称完成但无证据 | done 必须绑定 verification trace，并且 agent review 必须通过 |
| 同质化 | 看起来像 Multica 或 Clowder 子集 | 主打 personal context weaving + autonomous agent review loop |

## 14. 建议的第一里程碑

名称：`v0.1 Personal Weave`

验收标准：

- 用户可以创建一个 project。
- 用户可以配置至少两个 agent：例如 coder、reviewer。
- 用户可以在 project 下创建 issue，并自动生成 primary thread。
- 用户可以把 issue assign 给 coder。
- 系统能启动本地 CLI agent 执行任务，并流式保存输出。
- 系统能在实现完成后自动 handoff 给 reviewer。
- reviewer 生成 structured review，并给出 pass/fail。
- reviewer 通过后，系统自动把 issue 标记 done，并保存 decisions/evidence/lessons。
- 所有数据保存在本地，并可导出 Markdown。

这是最小但很有辨识度的一刀：它已经不是普通聊天，也不是完整 team SaaS，而是一个个人 agent team 的工作闭环。

## 15. 资料来源

- clowder-ai GitHub 仓库：https://github.com/zts212653/clowder-ai
- clowder-ai README：项目说明包括 multi-agent orchestration、persistent identity、cross-model review、A2A、shared memory、skills、MCP、SOP、Chat、Hub、Mission Hub、CVO Mode、roadmap 等。
- clowder-ai 最新公开仓库信息：约 2.2k stars、579 forks、396 commits；GitHub 页面核验日期 2026-07-11。
- multica GitHub 仓库：https://github.com/multica-ai/multica
- multica README：项目说明包括 managed agents、issue assignment、squads、autonomous execution、autopilots、skills、runtimes、multi-workspace、CLI daemon、Next.js/Go/Postgres/pgvector 架构等。
- multica 最新公开仓库信息：约 4,019 commits；README/仓库页面核验日期 2026-07-11。
- multica CLI and Agent Daemon Guide：daemon 自动检测本地 agent CLI、注册 runtime、执行任务、查看状态与日志。
- multica Self-Hosting Guide：Docker Compose、CLI daemon、PostgreSQL/pgvector、Helm/Kubernetes 自托管路径。
