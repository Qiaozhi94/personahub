---
feature_ids: []
related_features: []
topics: [prd, product, agent-team-os, issue-managed-workflow, room-collaboration, graph-orchestrated-work, evidence-grounded, artifact-centered]
doc_kind: prd
created: 2026-07-11
updated: 2026-07-29
---

# PersonaHub PRD: Personal AI Agent Team OS

> Status: draft | Owner: qiaozhi

## 修订记录

| 日期 | 来源提交 | 修订目的 | 修订内容 |
| --- | --- | --- | --- |
| 2026-08-01 | `docs/decisions/0007-coordinator-execution-channel.md` | v0.2 拆成 F006/F007/F008 三个 Feature 后，逐条比对第 15 节范围清单与三份 spec 的实际覆盖，发现四处分叉：范围清单把 Coordinator 描述为可配置 agent、要求写入 `default_coordinator_agent_id`、要求 Agent Team Template 推荐、以及"自动推荐和分派"；而 ADR 0007 已裁定 v0.2 用确定性规则引擎且只推荐不派工，`agent_team_template_id` 又是指向不存在的表的悬空列。另发现 Structured Handoff Packet 实际已在 v0.1.4 交付，仍列在 v0.2 范围内 | 第 15 节 v0.2 范围清单逐条改为如实描述：Coordinator 明确为进程内确定性规则引擎并指向 ADR 0007；`default_coordinator_agent_id` 标注推迟及理由；Agent Team Template 收窄为每次现算的 roster 推荐并说明悬空列成本；自动分派改为推荐 + 用户确认并给出保留人工闸门的理由；Structured Handoff Packet 标注已由 v0.1.4 交付。完成判据第一条补充"自然语言成分很弱"的诚实限定，禁止把 v0.2 描述为语义理解能力 |
| 2026-07-29 | `docs/decisions/0006-executable-work-graph.md` | 第三至五轮文档/代码交叉复核依次发现：v0.2 完成判据缺少 ADR 0006 Slice 1 要求的"可恢复"语义；"并行执行子任务"与现有 workspace 排他锁矛盾未说明边界；"只读子任务可不持锁并行"缺少运行时强制手段（代码核实 `WorkspaceContext` 无访问模式字段，三个 adapter 均无强制只读能力）；随后又发现第四轮给出的"缓解方案"本身不成立——普通 `git worktree`/目录拷贝只是换了个 cwd，不构成操作系统层面的访问隔离，`git worktree` 还与主仓库共享 `.git` 管理元数据——均已修正；同时补齐 frontmatter `updated` 与修订记录不一致 | 第 15 节 v0.2 完成判据补充"可恢复"最小语义（定义以 ADR 0006 为准）；并行边界改为以 ADR 0006 定义的强制隔离条件（操作系统层面不可访问活 workspace，非仅换 cwd）或跨 adapter 一致的强制只读能力为前提，明确普通 worktree/拷贝不满足该条件，默认基线是全部串行，"并行"退化为图上的逻辑 fan-out；写入子任务始终串行不变；frontmatter `updated` 同步为 2026-07-29 |
| 2026-07-28 | `docs/decisions/0006-executable-work-graph.md` | 把二级定位表达从 topology-aware 升级为 graph-orchestrated，与 v0.2+ Executable Work Graph 目标架构方向对齐；经两轮文档一致性复核发现首版改动把 v0.1 元数据误述为已具备可执行图能力、`orchestrator_subagent` 拓扑定义缺少可验证的最小场景、且未说明 v0.2 完成判据与该决策 Slice 1 触发条件的关系，本行合并记录修正后的最终改动 | 更新第 2 节"一句话"中英文定位表述，并明确 v0.1 当前只有描述性元数据、不构成可执行图，同时给出 Executable Work Graph 与 Collaboration Topology 的层级关系；第 5 节 `orchestrator_subagent` 拓扑定义补充"至少两个可独立调度子任务 + 显式边回传 + 收敛"的最小场景，排除单一子 agent 顺序接力也算数的歧义；第 13 节差异化描述、第 15 节版本路线引言同步措辞并指向 0006 号决策，不再声称 v0.1 已由 Collaboration Topology 承担 graph-orchestrated collaboration；第 15 节 v0.2 完成判据改为要求至少一次真实 fan-out → fan-in，并把 Slice 1 的验收标准改为"以显式 Node/Edge 语义可执行、可追踪"而非预先约定必须新建运行时表；frontmatter topics 标签同步更新 |
| 2026-07-19 | （F004 final review） | 统一 Autonomous Validation 的轮次、安全恢复和 Evidence Summary 验收口径 | 明确 Issue 累计 failed count / Run round 的职责、第三次 failed 即 Blocked、普通 unblock 保留轮次、round-limit 只能通过独立带 note 的 reset action 清零，以及 Done Evidence Summary 支持复制/下载已持久化 Markdown |
| 2026-07-18 | `4d13cab` | 避免 v0.4 在 Workflow 抽象尚未经过跨场景验证时，同时铺开多个浅层非 coding workflow；让后续自动编排有可评价的数据基础 | 将 v0.4 调整为“扩展契约 + 按任务范式逐个验证的垂直切片”，优先做 Windows Troubleshooting，再按实测进入 knowledge/research 与 writing；明确多种 Issue Type 可以保留为方向，但不承诺同一版本全部成熟交付；将最小 AgentOps 原始信号前置到 v0.1–v0.3，v0.5 仍负责完整评价、分析 UI 与 trust scoring |
| 2026-07-12 | `9c79555` | 在 Coordinator 自动编排前增加一条可独立交付的多 Agent 协作路径 | 新增 v0.1.4 手动多 Agent 路由：补齐 Codex / Claude Code / OpenCode adapter 与鉴权范围，在 Thread 中手动选择下一位 Agent，并通过 Handoff Packet 和 evidence refs 避免复制上下文；相应调整 v0.1 完成判据和 v0.2 Coordinator 边界 |
| 2026-07-12 | `4af80c1` | 建立 PersonaHub 第一版正式产品真相源 | 创建完整 PRD，确定个人优先的 Agent Team OS 定位，以及 Project / Workspace / Issue / Thread / Room、Workflow Template、Validation、Evidence、Memory、Skill 等核心概念；给出 v0.1–v0.9 路线、信息架构、安全边界与 MVP 验收标准 |

## 1. 背景

多个 AI agents / AI CLI 已经具备较强的独立执行能力，例如 Claude Code、Codex、OpenCode，以及面向研究、阅读、系统诊断的通用 agent。但在真实个人工作流中，用户仍然被迫承担大量“人工协调器”工作：

- 手动拆分任务。
- 在多个 agent / CLI 之间复制上下文。
- 追踪哪个 agent 做了什么。
- 判断实现是否可信。
- 手动整理日志、证据、决策和经验。
- 反复在聊天、终端、文档和项目管理工具之间切换。

`PersonaHub` 要解决的不是“再做一个聊天壳”，也不是只服务代码开发场景，而是提供一个个人优先、可自托管、自动化运行的 AI Agent Team OS。第一阶段的交付形态是本地工作台，但底层产品模型应能逐步覆盖代码开发、Windows 系统问题、论文/书籍拆解、资料研究、写作整理等个人任务，并纳入同一套 Issue / Thread / Agent 自动化模型。

核心产品判断：

- 以 Thread 承载 agent 协作、handoff、自动 validation、证据和记忆。
- 以 Project / Issue 管理工作对象、状态、归属和自动化。
- 以 Issue Type / Workflow Template / Collaboration Topology 决定参与哪些 agents、采用什么协作方式、如何验证完成。
- 第一版以个人工程工作台作为入口形态，不做语音、陪伴、游戏模式。
- 第一版默认入口是 Issue list + 当前 Thread，不把多人看板作为主界面。

## 2. 产品定位

`PersonaHub` 是一个个人优先、开源可自托管的 AI Agent Team OS。它以本地工作台作为第一阶段入口形态，让用户用 Project / Issue 管理各种个人任务，用 Issue Type / Workflow Template / Collaboration Topology 选择合适的 agent team 和协作方式，多个 agents 在 Thread / Room 中自主执行、交接、验证、沉淀证据和记忆。

一句话：

> A personal Agent Team OS for issue-managed, graph-orchestrated, evidence-grounded work.

中文：

> 以 Issue 管理目标，以可执行 Work Graph 组织 Agent 协作，以 Evidence 验证结果，并从真实运行中持续改进。

v0.1 已跑通一条由领域服务驱动的 Implementation → Validation 工作流，并具备 Workflow Template / Collaboration Topology 等描述预期 agent 团队和协作方式的元数据，但这些元数据目前不驱动执行顺序，尚不构成通用可执行图——`collaboration_topology` 只做存储映射，实际流转顺序硬编码在 service 里，详见 `docs/decisions/0006-executable-work-graph.md` 的代码审计记录。把它升级为通用、可版本化的 Executable Work Graph，是 v0.2 落地 `orchestrator_subagent` 拓扑（第一个非简单串行的真实协作场景）时启动的目标架构方向，具体范围和触发条件见该决策，不是 v0.1 已具备的能力。

Executable Work Graph 是长期的运行时核心模型；Collaboration Topology 是 Graph Definition 里的高层协作形态/模板分类，是该模型的一个组成部分，不是与之并列或竞争的另一套概念。

### 2.1 多 Agent 协作形态判断

PersonaHub 对多 Agent 协作的基本判断是：协作形态会从"人类手动调度多个工具"逐步演进为"系统根据任务自动选择协作拓扑并组建临时团队"。

典型演进路径：

```text
Single Agent
  一个 agent 直接理解目标并执行。适合低风险、短任务，但容易出现上下文膨胀、自我验证和能力混杂。

Sequential Workflow
  多个 agent 按固定顺序交接，例如 architect -> coder -> reviewer。适合 SOP 明确的任务，是 PersonaHub v0.1 的起点。

Orchestrator-Subagent
  一个 Coordinator Agent 理解目标、拆解任务、选择 worker，并汇总结果。适合复杂但仍需可控交付的任务，是 PersonaHub 的主线形态。

Coordinator / Room
  系统按阶段创建 research、synthesis、implementation、validation 等 Room。可并行研究、串行综合、并行实施、并行验证。适合大型 coding、研究和重构任务。

Council / MoA
  多个 agent 或模型提出候选意见，由 synthesizer / aggregator 收敛。适合架构取舍、产品方案、写作和高质量决策。

Self-improving Agent Team OS
  系统不只完成任务，还评估过程、沉淀 memory 和 skill，并在未来相似任务中自动选择更有效的协作方式。这是 PersonaHub 的长期愿景。
```

因此，PersonaHub 不把多 Agent 协作理解为"把多个 agent 放进同一个聊天室"，而是把它产品化为：

- Issue Type 决定任务类别。
- Workflow Template 定义阶段和规则。
- Collaboration Topology 定义协作结构。
- Room 承载阶段性协作。
- Handoff Packet 负责责任转移。
- Evidence / Artifact 负责可验证结果。
- Memory / Skill 负责长期进化。

### 2.2 长期愿景

`PersonaHub` 的成熟形态不是停留在第一阶段的本地工作台，也不是管理一组静态 agent 或把多个聊天窗口合并到一起，而是一个能自动组队、自动选择协作方式、自动验证和自动沉淀经验的个人 AI Agent Team OS。

目标形态：

```text
Human intent
  -> Coordinator Agent
  -> Issue / Goal clarification
  -> Collaboration topology selection
  -> Room assembly
  -> Agent execution
  -> Artifact / Evidence collection
  -> Validation
  -> Summary to human
  -> Memory / Skill compounding
```

用户通过自然语言表达目标；Coordinator Agent 负责理解需求、创建 Issue、选择合适的协作拓扑、组建临时 agent team、监督执行、收集证据、汇总结果，并在需要人类判断时触发 escalation。PersonaHub 管理的核心资产不是 agent 列表，而是个人工作中 agent 如何协作、如何验证、如何沉淀、如何进化。

## 3. 目标用户

`PersonaHub` 的目标用户需要按阶段理解：第一阶段先服务个人高频 AI 用户和独立开发者，以最小复杂度跑通本地 agent team 闭环；长期目标是成为开源可自托管的 Agent Team OS，让更多开发者、开源项目和小团队都能用它高效构建、维护和演进自己的项目。

### 3.1 第一阶段目标用户

- 独立开发者。
- 同时使用多个 AI agents / AI CLI 的重度用户。
- 有多个项目、多个上下文，需要长期记忆和复盘的人。
- 希望让不同角色的 agents 按任务类型自动协作和验证的人。
- 希望自动处理 Windows 系统问题、环境排障、软件配置问题的人。
- 希望系统性拆解论文、书籍、报告并沉淀长期笔记的人。
- 希望把 AI 从“聊天窗口”升级为“个人自动化工程团队”的用户。

第一阶段选择个人优先，不是因为团队不重要，而是为了避免一开始陷入 auth、权限、组织管理、审计合规和云端托管 runtime 的复杂度。P0 必须先证明单用户本地闭环可信、可验证、可复用。

### 3.2 长期目标用户

- 开源项目维护者：希望把 issue triage、代码修复、文档更新、测试补齐、release note 等工作交给可验证的 agent team。
- 小型开发团队：希望用自托管方式让 agents 参与项目构建、review、排障、研究和文档协作。
- 个人创业者 / indie hacker：希望用有限人力同时推进产品、工程、研究、运营和内容工作。
- 内部工具团队：希望在本地或私有环境中运行 agent workflow，沉淀组织内的 project memory、workflow skill 和 evidence trail。
- 研究型团队：希望让多个 agents 协作完成论文阅读、资料综合、实验记录和报告生成。
- AI power users / builders：希望定制自己的 Coordinator Agent、Workflow Template、Collaboration Topology、Skill library 和 runtime。

### 3.3 开源采用路径

PersonaHub 应支持从个人到团队的渐进采用：

```text
个人本地工作台
  -> 多项目个人 Agent Team OS
  -> 自托管 server / daemon
  -> 小团队共享 workspace
  -> 开源项目协作自动化
```

这意味着第一版的数据模型、workflow、event、memory、skill 和 runtime 抽象不能只为单人 demo 服务，而要为未来多 workspace、多 runtime、多 agent team 和自托管部署预留边界。

暂不优先：

- 大型企业多人协作平台。
- 复杂组织权限、审计合规、SSO、细粒度 RBAC。
- 云端托管 runtime / SaaS 计费。
- 主要诉求是语音陪伴、娱乐或社交型 AI 体验的用户。

## 4. 产品目标

### 4.1 P0 目标

第一阶段目标是：用户可以把日常代码开发工作流完整迁移到 `PersonaHub` 中，不再需要在多个 CLI 工具之间反复切换、复制上下文和手动下发工作指令。

P0 只完整实现 coding workflow：只有 Coding Issue Type 拥有可运行的 Workflow Template、Agent Team Template 和 Validation Policy。Windows / Paper / Book / Research / Writing 等 Issue Type 在 P0 阶段只保留数据模型边界（Issue Type 枚举、Workflow Template / Validation Policy 的可扩展字段结构），不提供可运行模板或占位 UI——多场景同时铺开会稀释 P0 焦点，也会把还不成熟的 workflow 抽象过早产品化。这些候选 workflow 从第 15 节 v0.4 起按任务范式逐个做垂直切片和真实验证，不承诺一次全部实现。

P0 要跑通的开发工作流闭环：

1. 用户创建 Project。
2. 用户绑定本地 Workspace（local workspace path）。
3. 用户在 Project 下创建 coding Issue。
4. 系统自动为 Issue 创建 primary Thread。
5. 系统根据 Coding Workflow Template 和默认 sequential topology 选择 coding agent roster。
6. 用户在 PersonaHub 中下发需求、实现、修复、验证等指令，而不是切到各个 CLI。
7. 系统通过 local runner 启动对应 coding agent adapter。
8. Agents 在 Thread 中执行开发任务。
9. 系统流式记录 run events、logs、file changes、decisions、evidence。
10. 实现完成后，validator / reviewer agent 自动检查 diff、测试、风险和证据。
11. Validation 通过且 evidence trace 存在时，Issue 自动进入 Done。
12. 系统沉淀 evidence summary、decisions、lessons。

P0 成功标准：一个真实开发 Issue 可以从创建、执行、验证到 Done 全程在 PersonaHub 内完成，Thread 是唯一协作入口。具体可勾选的功能级验收条件见第 12 节，此处不重复列出。

### 4.1.1 结果指标

功能验收只能回答"功能是否都做完了"，回答不了"这对我个人是否真的有用"。P0 之外，还需要观察这些使用层面的信号：

- 一个真实 Issue 从创建到 Done，用户手动复制上下文、切换终端窗口的次数趋近于 0。
- 用户愿意把日常真实开发任务而不是测试性任务交给 PersonaHub，并持续使用，而不是体验一次后回到原有 CLI 工具链。
- 因为 Blocked 而需要 operator 介入的比例，没有高到让"自动执行"名不副实。

这些信号不是正式 KPI（个人项目不需要），而是自查 PersonaHub 是否只是把复杂度从"多个终端窗口"搬进了"一个更复杂的界面"，呼应第 13 节"同质化""过度平台化"风险。

### 4.2 非目标

第一版不做：

- 多人 workspace / 企业权限。
- 默认看板作为主界面。
- 云端托管 runtime / SaaS 计费。
- GitHub issue / PR 双向同步。
- voice / 陪伴 / game 模式。
- 大型 SOP 引擎。
- 完整 MCP marketplace。
- 自动把所有经验写入长期 memory，避免污染。

## 5. 核心概念

### Project

PersonaHub 的逻辑管理空间，用于归档相关 Issues、Threads、Agents、Memory、Skills、Workflow Settings 和 Evidence Summary。

Project 不等于 Workspace：

- Project 负责“这件事如何被 PersonaHub 组织和管理”。
- Workspace 负责“agents 在哪里读写文件、运行命令和执行验证”。

v0.1 默认一个 Project 绑定一个 Workspace（即一个本地路径）。未来可扩展为一个 Project 绑定多个 Workspaces，或多个 Projects 共享同一个 Workspace，但第一版不开放复杂映射。Project 本身不直接存路径，路径归属 Workspace（见下一节），Project 通过 `default_workspace_id` 引用。

最小字段：

- name
- description
- default_workspace_id
- default agents
- default_coordinator_agent_id
- created_at / updated_at

### Workspace

Workspace 是真实文件和执行环境所在的位置，通常是本地代码仓库、文档目录、研究资料目录，或未来由 daemon 管理的隔离执行目录。

Workspace 负责：

- 文件读取 / 写入边界。
- agent run 的当前工作目录。
- 命令、测试、lint、build 等执行位置。
- git repository / branch 状态。
- workspace 写锁和并发控制。

v0.1 规则：

- 只支持 local workspace path。
- 一个 Project 默认绑定一个 Workspace。
- 同一 Workspace 同一时刻只能有一个 agent 进程执行写操作。
- 跨 workspace 写入必须触发 escalation。

最小字段：

- id
- project_id
- local_path
- git_branch
- lock_state: idle / locked
- locked_by_run_id
- created_at / updated_at

### Coordinator Agent

Coordinator Agent 是一种特殊职责的 Agent role，而不是独立于 Agent 之外的新实体。它接受用户自然语言目标，不直接承担所有执行工作，而是负责将目标转化为可管理、可协作、可验证的 Issue / Workflow / Room。

Coordinator Agent 的存在是为了把用户从“人工路由器”角色中解放出来：用户不需要手动判断该叫哪个 agent、复制哪些上下文、何时交给 reviewer，而是由 Coordinator Agent 根据目标、Issue Type、Workflow Template 和 Collaboration Topology 进行初始编排，并在关键风险点升级给用户。

默认情况下，每个 Project 可以配置一个 `default_coordinator_agent_id`。系统提供内置 Coordinator Agent 作为开箱即用默认值；高级用户可以创建、修改或替换 Coordinator Agent，也可以为 coding、research、writing、ops 等不同场景配置不同 coordinator。Coordinator 不是“主 Agent”，也不拥有其他 agents；它只是某个 Project / Workflow / Issue 中被选中承担编排职责的 agent。

核心职责：

- intent parsing：理解用户目标、约束和期望输出。
- issue creation：创建或补全 Issue。
- issue type detection：识别任务类型。
- workflow / topology selection：选择 Workflow Template 和 Collaboration Topology。
- agent team assembly：选择参与 agents。
- room creation：按阶段创建临时 Room。
- phase orchestration：推进 research / synthesis / implementation / validation 等阶段。
- escalation detection：识别权限、风险、预算、目标冲突和不收敛情况。
- result synthesis：收集 artifacts、evidence、validation result，并汇总给用户。
- memory / skill candidate extraction：从 Done Issue 中提取可复用经验候选。

### Issue

工程化管理对象，属于某个 Project，用来描述要完成的工作。

Issue 不等于 Thread。Issue 负责管理，Thread 负责协作。

最小字段：

- title
- goal
- issue_type
- workflow_template_id
- validation_policy_id
- project_id
- workspace_id
- status: Inbox / Ready / Running / Validating / Done / Blocked
- owner_agent_id
- priority
- labels
- primary_thread_id
- created_at / updated_at

### Thread

Thread 是围绕 Issue 的纵向记录链，负责把一条任务链路上发生的用户输入、agent 消息、handoff、run events、validation events、decisions、evidence 和 logs 按时间顺序保存下来。它回答的是“这件事如何一路发生、谁在什么时候做了什么、依据是什么”。

Thread 不是普通聊天记录，也不是临时 agent 群本身；它必须绑定 Issue、状态、参与 agents 和证据链。可以简单理解为：Thread 记录事情怎么一路发生，Room 组织谁一起解决其中某一段问题。

v0.1 规则：

- 每个 Issue 必须有且只有一个 primary Thread。
- primary Thread 是 Issue 级主控制线，记录从创建、执行、验证到完成的完整生命周期。
- 自动 validation 作为 Thread 内部事件存在。
- Review / Validation 不作为独立一级模块。

未来扩展：

- 一个 Issue 可拥有多个 Threads，例如 room_thread、incident_thread、council_thread。
- Room 可以绑定自己的 Thread，用于记录该临时协作室内部的讨论、执行和阶段产出。

### Room（Work Room / 协作室）

Room 是围绕某个 Issue 阶段临时创建的结构化会话室 / agent 协作室，也是用户可见、可介入的 AI 协作现场。它回答的是“这个阶段需要谁一起解决、采用什么协作模式、交付什么结果”。Room 可以由 Coordinator Agent 自动创建，也可以由 Human Lead 手动开房间、拉入或移除成员、直接参与。

Room 不是自由聊天房间，而是有明确目标、成员、协作拓扑、输入输出契约、证据要求和终止条件的工作单元。问题解决后，Room 应进入 archived 状态，而不是物理删除；其 thread、artifacts、evidence 和决策仍然可追溯。

用户在 Room 中应具备 Human Lead 能力：

- 查看 Coordinator Agent 为什么创建该 Room，以及为什么选择这些 agents。
- 旁听各 agents 的讨论、分工、执行进展和阶段结论。
- 随时打断、纠正方向、补充约束或要求暂停。
- 手动拉入新 agent、移除不合适的 agent，或指定某个 agent 接手。
- 要求某个 agent 提供证据、重做、总结或进入 validation。
- 在 Room 结束后查看归档 thread、artifacts、evidence 和决策。

推荐归属关系：

```text
Issue
  primary_thread_id
  rooms[]

WorkRoom
  issue_id
  thread_id
  phase
  goal
  topology
  member_agent_ids
  output_contract_json
  status

Thread
  issue_id
  room_id nullable
  thread_type: primary / room / incident / council
```

最小字段：

- issue_id
- thread_id
- phase: research / synthesis / implementation / validation / council / memory
- goal
- topology
- leader_agent_id
- member_agent_ids
- input_contract_json
- output_contract_json
- evidence_requirements_json
- budget_policy_json
- termination_condition_json
- status: active / archived / failed / blocked

示例：

```text
Research Room
  topology: orchestrator_subagent
  members: codebase_researcher, dependency_researcher, test_coverage_researcher
  output: research_findings.md

Validation Room
  topology: parallel_validation
  members: reviewer, test_runner, verifier
  output: verification_results.md
```

### Issue Type

Issue Type 表示任务类别，用来帮助系统选择默认 workflow、agent team 和验证方式。

内置候选类型：

- coding：代码开发、修 bug、重构、脚本编写。
- windows_troubleshooting：Windows 系统问题、软件配置、环境排障。
- paper_reading：论文拆解、方法/实验/贡献/局限分析。
- book_breakdown：书籍拆解、章节结构化、观点提炼。
- research：资料调研、多来源证据综合。
- writing：文档、文章、报告写作。
- custom：用户自定义任务。

### Workflow Template

Workflow Template 定义某类 Issue 的默认 agent roster、步骤、handoff 规则、validation policy 和 evidence 要求。

它解决的问题是：不同任务不应该默认调用同一组 agents。代码开发可能需要 architect / coder / reviewer；Windows 排障可能只需要 diagnostician / fixer / verifier；论文拆解可能需要 reader / critic / note_writer。

Workflow Template 还必须声明 `collaboration_topology`。协作拓扑不是实现细节，而是决定 agents 如何组织、如何交接、如何验证、如何收敛的核心产品属性。

Workflow Template 可以选择使用 Project default coordinator，也可以为某类 workflow 指定特定 coordinator role / coordinator_agent_id。这样同一个 Project 内可以存在 coding coordinator、research coordinator、writing coordinator 等不同编排风格。

内置候选 topology：

- sequential：顺序式，适合固定 SOP 和低风险任务。
- orchestrator_subagent：Coordinator Agent 把任务拆解成至少两个可独立调度的子任务分派给子 agent 执行，子任务结果通过显式边回传并由 Coordinator 或 synthesis 收敛（区别于单一子 agent 顺序接力），适合大多数需要交付和审计的复杂任务；v0.2 完成判据里的验证范围见第 15 节。
- coordinator：Research 并行 -> Synthesis 串行 -> Implementation 并行 -> Verification 并行，适合大型 coding / refactor / research。
- parallel_validation：多个 validator 从测试、diff、风险、证据等角度并行检查，适合高风险交付的验证阶段。
- council：多 agent 受控讨论，由 synthesizer 收敛，适合产品方案、架构取舍、写作方向。
- moa：多个模型/agent 产出候选解，由 aggregator 聚合，适合质量优先的文档、报告和决策。
- swarm：动态创建更多子 agent，仅作为远期高成本模式，用于超大任务。

以下示例展示的是 Workflow Template 的目标形态，用来说明不同 Issue Type 应该配不同 agent roster 和 topology；具体哪些在 P0 就有可运行实现，以第 4.1 节的结论为准——P0 只有 Coding Workflow 可运行，其余示例对应的 Issue Type 在 P0 阶段仅保留数据模型边界。

示例：

```text
Coding Workflow
  topology: sequential
  agents: architect -> coder -> reviewer
  validation: tests / diff review / verification trace

Windows Troubleshooting Workflow
  topology: sequential
  agents: diagnostician -> fixer -> verifier
  validation: symptom resolved / command output normal / no error logs

Paper Reading Workflow
  topology: orchestrator_subagent
  agents: reader -> summarizer -> critic -> knowledge_curator
  validation: research question / method / evidence / contribution / limitation covered

Book Breakdown Workflow
  topology: orchestrator_subagent
  agents: reader -> synthesizer -> note_writer
  validation: chapter structure / core ideas / useful takeaways covered
```

### Agent Team Template

Agent Team Template 是某个 workflow 的默认角色组合。它不是多人组织，也不是全局固定团队，而是按 Issue Type 动态选择的 agent roster。

示例：

- Coding Team: architect, coder, reviewer。
- Troubleshooting Team: diagnostician, fixer, verifier。
- Reading Team: reader, critic, note_writer。

### Handoff Packet

Handoff Packet 是 agent 之间转移责任和上下文的结构化交接包。它比复制聊天记录更可靠，也比自然语言总结更适合审计和复用。

最小内容：

- from_agent_id
- to_agent_id / to_room_id
- issue_goal
- current_phase
- completed_work
- key_decisions
- artifacts
- evidence_refs
- known_risks
- open_questions
- next_expected_output

每次 handoff 必须写入 ThreadEvent，并可追溯到 artifacts 和 evidence。

### Validation Policy

Validation Policy 定义某类任务如何判断完成。

不同 Issue Type 的验证方式不同：

| Issue Type | Validation Policy |
| --- | --- |
| coding | tests pass、diff review、lint/build、verification trace |
| windows_troubleshooting | 问题现象消失、命令输出正常、日志无关键错误 |
| paper_reading | 研究问题、方法、实验、贡献、局限和可复用结论完整 |
| book_breakdown | 章节结构、关键观点、论证脉络、行动启发完整 |
| research | 来源足够、结论有证据、分歧和不确定性被标注 |
| writing | 目标读者、结构、论点、证据和风格符合要求 |
| custom | 用户自定义 pass/fail 条件 |

### Agent

可执行工作的 AI 成员。第一版以 agent adapter 为核心；代码开发场景可接 CLI agent，阅读、研究、排障等场景可接不同能力的 agent。Agent 的参与由 Workflow Template / Collaboration Topology / Room 决定，不全局参与所有 Issue。

Agent 是长期成员，不是一次性函数。PersonaHub 保留稳定 role、capability tags、默认模型和历史表现，用于后续 routing、validation trust、workflow recommendation 和 skill compounding，但不做强拟人包装。

最小字段：

- name
- role: coordinator / architect / coder / reviewer / verifier / researcher / reader / writer / curator / custom
- cli_provider: codex / claude-code / opencode
- runtime_id
- capability_tags
- default_model
- system_instructions

### Memory

经确认或高置信沉淀的长期知识，不是所有聊天记录。

类型：

- project fact
- decision
- lesson
- user preference
- workflow note

每条 memory 必须有：

- source_issue_id
- source_thread_id
- source_event_ids
- author agent
- timestamp
- confidence
- evidence reference
- originating_input_trust_level
- human_confirmed / auto_saved

### Skill

可复用 workflow / prompt / operating procedure。长期看，Skill 不只是单 agent prompt，而是从成功 Issue 中沉淀出的可复用协作资产。Done Issue 结束后，系统可以评估执行过程，提取 skill candidate；用户接受后，后续相似 Issue 可推荐或加载该 skill，而不是每次从零推理。

第一版可以用 Markdown 或 YAML 表达，不需要复杂 marketplace。

Skill 可逐步扩展为：

- trigger
- issue_type
- topology
- roles
- phase_plan
- input_contract
- output_contract
- handoff_schema
- evidence_requirements
- validation_policy
- budget_policy
- termination_policy
- improvement_notes
- provenance

### Artifact

Artifact 是 Issue / Thread / Room / agent run 产生的结构化中间成果或最终成果，用于避免所有信息都只通过聊天上下文传递，降低信息损耗和 token 成本。

Artifact 不是新的 workspace，也不改变 Workspace 的含义。Workspace 仍然表示真实文件和执行环境；Artifact 表示 PersonaHub 需要长期引用、汇总、验证或导出的阶段产物。小 Issue 可以没有独立 artifact；复杂 Issue 可以产生 research_findings、synthesis_plan、implementation_log、verification_results、generated_doc、screenshot、report 等 artifacts。

最小字段：

- artifact_id
- issue_id
- thread_id
- room_id nullable
- run_id nullable
- artifact_type
- title
- storage_type: inline_markdown / local_file_path / external_url / db_record
- uri_or_content_ref
- evidence_refs
- created_by_agent_id
- created_at / updated_at

可选实现结构：

```text
.personahub/artifacts/{issue_id}/
  research_findings.md
  synthesis_plan.md
  implementation_log.md
  verification_results.md
  evidence_refs.json
```

Thread 负责纵向协作记录，Room 负责横向临时协作组织，Artifact 负责阶段成果，Evidence 负责验证证据，Memory / Skill 负责长期沉淀。

### Provenance Gate

Provenance Gate 是 Memory / Skill / Scheduled Issue 写入长期状态前的来源校验机制。

它的目标是让 PersonaHub 能自我沉淀但不自我污染：长期记忆、可执行 skill 和 scheduled job 必须知道自己来自哪里、可信度如何、是否经过用户确认。

规则：

- 外部输入默认 untrusted。
- untrusted 内容不能直接生成可执行 skill 或 scheduled job。
- high-risk memory 必须人工确认。
- skill candidate 必须绑定 source issue/thread/event 和 evidence refs。
- scheduled job 必须有 owner attestation 或明确的低风险模板来源。
- provenance 不完整的长期状态只能作为 candidate，不能自动参与后续执行。

### Trace Events

Trace 不是一级产品概念，而是 Thread 内部自动生成的证据事件流。

以下为示例、非穷尽列表，实现时以覆盖各验收标准要求的事件为准（例如 7.3 节要求持久化 `run.completed` / `run.failed`）：

- issue.created
- coordinator_agent.selected
- workflow.recommended
- topology.selected
- room.created
- agent.assigned
- run.started
- run.output
- run.completed
- run.failed
- command.executed
- file.changed
- test.passed
- artifact.created
- handoff.created
- handoff.to_validator
- validation.finding
- validation.passed
- validation.failed
- validation.round_reset
- memory.candidate_created
- skill.candidate_created
- provenance_gate.required
- provenance_gate.passed
- provenance_gate.failed
- escalation.triggered
- owner.decision
- issue.blocked
- issue.done

## 6. 信息架构

第一版采用三栏工作台。

```text
左侧：工程导航
  Projects
  Issues
  Automations
  Agents
  Skills
  Settings

中间：当前协作现场
  Primary Thread / Room Thread switcher
  Messages
  Agent responses
  Room members
  Agent discussion
  Handoff events
  Run events
  Validation events
  Decisions

右侧：Context Inspector
  Issue info
  Agent status
  Message stats
  Evidence
  Run logs
  Audit / trace events
  Blockers
```

### 第一屏

打开应用后直接进入工作台，不做 landing page。

默认状态：

- 左侧选中最近 Project。
- 中间默认显示最近 active Issue 的 primary Thread，或空状态引导创建 Issue。
- 当 Issue 存在 active Room 时，中间区域可切换或展开为 Room 协作现场，用户可以旁听、打断、纠偏和调整参与 agents。
- 右侧显示当前 Issue 的状态、参与 agents、run logs、evidence 和 blockers。

### Board View

第一版不默认做 board。

Issue list 是 P0，Board view 是 P2，用于未来多人协作或大量并行任务。

## 7. 核心用户流程

### 7.1 创建 Project

用户创建 Project，并绑定一个本地 Workspace。v0.1 中 Workspace 只是一个本地路径（`local_path`），通常是一个本地代码仓库或文档目录。

系统行为：

- 校验 workspace path 是否存在且可读。
- 识别 workspace 基本信息，例如 git repo、当前 branch、可用 package manager / test command 候选。
- 将 Project 与 Workspace 绑定。
- 后续 Issue 默认在该 Workspace 中执行 agent run。

验收：

- 用户可以创建、查看、切换 Project。
- 用户可以为 Project 绑定本地 Workspace。
- Project 下能看到 Issues、Agents、Memory 摘要。
- Project / Workspace 关系可在 Settings 或 Project Inspector 中查看。
- Project 数据持久化在本地。

### 7.2 创建 Issue

用户在 Project 下创建 Issue，并选择或接受默认 Issue Type / Workflow Template。

输入：

- title
- goal / description
- issue type
- workflow template
- optional labels / priority
- optional owner agent

系统行为：

- 自动创建 primary Thread。
- 根据 Issue Type 应用默认 Workflow Template、Agent Team Template 和 Validation Policy。
- Issue 初始状态为 Inbox 或 Ready。
- Thread 中生成 issue.created 事件。

验收：

- Issue 创建后立即可进入 Thread。
- 右侧 Inspector 展示 Issue 信息。
- Issue 创建后必须有 primary Thread；未来复杂 Issue 可继续创建 Room thread / incident thread 等辅助 Thread。

### 7.3 Agent 执行

用户或系统将 Issue 分配给 owner agent。Workflow Template / Collaboration Topology 决定后续是否需要 architect、coder、reviewer、diagnostician、reader、critic 等角色参与；P0 阶段先按 sequential workflow 执行，不创建独立 Room。

系统行为：

- Issue 进入 Running。
- Local runner 启动对应 agent adapter。
- 输出被转换为 run events 并写入 Thread。
- 右侧实时显示 agent status 和 run logs。

验收：

- 能启动至少一个 agent。
- run.started / run.output / run.completed / run.failed 被持久化。
- Thread 中能看到执行摘要。

### 7.4 自动 Handoff

实现 agent 完成后，系统自动生成 handoff packet。

handoff packet 包含：

- issue goal
- implementation summary
- changed files / artifacts
- commands / tests
- known risks
- evidence refs
- next action

验收：

- handoff 事件写入 Thread。
- 下一个 workflow step 的 agent 能读取 handoff packet。
- 用户无需手动复制上下文。

### 7.5 Agent Validation Loop

Validator agent 根据当前 Workflow Template 自动验证任务结果。

Validation 是 Thread 内事件，不是一级产品模块。代码开发 workflow 中的 reviewer agent，是 validator agent 的一种具体角色。

Validator 角色边界：v0.1 的 validator 是 Workflow Template 中固定声明的角色（例如 Coding Workflow 里的 reviewer），不是任意 Agent 都能通过 capability 自行声明的能力。允许任意 Agent 以 validator capability 参与验证、并引入 trust scoring，是 v0.5+ 的扩展范围（见第 15 节），前提是先有 AgentOps metrics 和历史成功率数据支撑这类信任判断。

Validator 独立性：默认策略下，validator agent 的 `cli_provider` 与 `default_model` 至少有一项必须与被验证的 implementation agent 不同（即不允许 provider 和 model 两者完全一致），避免同一模型自我验证、自我通过。如果 implementation 和 validator 的 `cli_provider` / `default_model` 完全相同，该 Issue 的 Done 状态需要标记为"同源验证"，不享受与跨模型验证同等的自动信任等级。

P0 影响：P0 阶段按第 8 节约定只接入一个 coding CLI adapter。为避免单 adapter 下所有 Done Issue 都被标记为"同源验证"，Project 设置应支持为同一 `cli_provider` 配置至少两个不同的 `default_model`，implementation agent 与 validator agent 分别使用不同 model，以满足"至少一项不同"的最低独立性要求。若用户环境下确实只有一个可用 model，则如实标记"同源验证"，不额外伪装成跨模型验证。

失败收敛上限：Issue 记录已形成 failed 结果的累计 `validation_round_count`，每条 validator Run 记录自身不可变的 `validation_round`。Workflow Template / Validation Policy 可配置 `max_validation_rounds`（默认建议 3）；本次 failed 计入后 `validation_round_count >= max_validation_rounds` 即视为“多轮 agent validation 无法收敛”，因此默认第三次 failed 直接使 Issue 转 Blocked，不允许第四次自动验证。

状态流转：

```text
Running -> Validating -> Done
Running -> Validating -> Running
Running -> Validating -> Blocked
Blocked -> Ready
```

Blocked 恢复：Blocked 是需要 operator escalation 处理的暂停态，不是终态。operator 在 Thread / Inspector 中完成 escalation 处理（例如授权、补充信息、人工解决需求冲突）后，Issue 回到 Ready，等待用户重新触发 Running。普通 unblock 保留 `validation_round_count`，不会隐式清零。若 blocker 是 `round_limit_reached` 且 operator 决定授予新的完整验证预算，必须先执行独立、显式、带说明且可追溯的 round reset action；reset 后 Issue 仍保持 Blocked，再由 operator 另行 unblock。系统不会自动把 Blocked 直接推回 Running。

通过条件：

- validator 输出 pass。
- evidence / verification trace 满足当前 Validation Policy。
- 没有 blocking findings。

失败条件：

- validator 输出 fail。
- 有 P1/P0 finding。
- 缺少验证证据。

系统行为：

- pass：Issue 自动进入 Done。
- fail：Issue 回到 Running，findings 成为下一轮修复输入。
- blocked：Issue 进入 Blocked，并提示 operator escalation。

验收：

- validator 输出结构化 findings。
- validation findings 写入 Thread。
- pass/fail 能驱动 Issue 状态变化。
- Done 状态必须绑定 evidence summary。

### 7.6 Evidence Summary

Issue 完成后，系统自动生成 evidence summary。

内容：

- goal
- final result
- implementation summary
- key decisions
- commands / tests
- changed artifacts
- validation result
- lessons candidate

存储：Evidence summary 默认持久化在本地 SQLite，导出 Markdown 是用户手动触发的操作。P0 不默认把 evidence summary 自动写入 workspace 文件系统，避免污染 workspace 的 git diff；自动导出可作为后续 Project 设置项按需开放。

验收：

- Done Issue 有 evidence summary。
- Evidence summary 可导出 Markdown。
- Evidence refs 可追溯到 Thread events。

### 7.7 Memory 沉淀

系统从 Done Issue 中提取 memory candidates。

P0 / P1 规则：

- 自动生成 candidates。
- 默认不直接写长期 Memory，必须用户确认后才写入。
- 高风险或偏好类 memory 需要 operator escalation。
- 低风险 lesson 的自动保存（无需逐条确认）不在 P0 / P1 开放，因为其安全前提——Provenance Gate——要到 v0.5 才落地（见第 15 节）；在 Provenance Gate 具备来源校验能力之前，自动保存无从判断可信度。

验收：

- Memory 有来源和证据。
- 用户可以查看 memory 来源。
- Memory 不污染 Thread 原始记录。

## 8. 功能优先级

P0 / P1 / P2 与第 15 节版本路线一一对应，不是独立的第二套排期：**P0 = v0.1**，**P1 = v0.2–v0.3**，**P2 = v0.4 及以后**。P 分层只是版本路线的粗粒度摘要，具体交付顺序、完成判据以第 15 节为准；两处出现分歧时以第 15 节为准。

### P0（v0.1 Sequential Workflow）

- Project 创建 / 切换。
- 本地代码 workspace 绑定。
- Issue 创建 / 状态流转。
- Coding Issue Type / Coding Workflow Template。
- Issue 自动创建 primary Thread。
- Thread 消息流。
- Agent Profile 配置。
- Local runner。
- Coding agent adapter registry: P0 首个接入的本地 coding CLI 是 Codex CLI（决策见 `docs/decisions/0002-first-agent-adapter.md`），registry 设计预留多 adapter 扩展点。
- Agent command dispatch: 用户从 Thread 中下发实现、修复、验证等指令，由 PersonaHub 转发给对应 CLI agent。
- Run events 持久化。
- File change / command / test evidence 记录。
- Agent Validation Loop。
- Evidence Summary。
- 本地 SQLite 存储。
- Markdown export。
- Claude Code CLI adapter、OpenCode CLI adapter 接入，三者（含 Codex）均支持 OAuth 登录，OpenCode 额外支持单独配置 API key 等模型信息；Thread 内手动多 agent 路由（见第 15 节 v0.1.4）。

### P1（v0.2 Orchestrator Workflow + v0.3 Artifact-Centered Collaboration）

- Coordinator Agent 初版：作为可配置 agent role，提供 Issue Type / Workflow Template / Collaboration Topology 推荐。
- Agent Team Template 推荐。
- Structured Handoff Packet。
- @agent routing：多 agent 并存后，用户手动指定由哪个 agent 接手。
- Agent capability tags。
- 多 agent adapter 补齐。
- Runtime health check。
- Workflow Template 管理 UI 初版。
- Project profile / Issue filters / Command palette：一般性工作台易用性提升。
- Memory snippets：只读展示，不含自动写入 / Skill 沉淀的完整链路（见 P2）。
- Artifact model / artifact-centered collaboration。
- Room 初版：用户可见、可旁听、可打断、可纠偏、可调整成员的临时协作现场。
- Squads / Agent groups：静态、可复用的 agent 分组，与 Room 的临时协作室互补。
- HandoffPacket 引用 artifacts / evidence refs。

### P2（v0.4 及以后）

- Workflow 扩展契约：输入/输出、capability、artifact、evidence、validation、权限与 Done policy 的扩展边界。
- 按任务范式逐个交付非 coding 垂直切片，优先内置 Windows Troubleshooting Workflow。
- Paper / Research、Writing / Book Breakdown 作为后续候选切片，根据前一个切片的实测结果依次评估，不承诺在同一版本并行完成。
- Scheduled Issue。
- Reusable Skill 文件加载 / 手动使用。
- AgentOps Evaluation（最小原始信号从 v0.1–v0.3 开始记录；完整聚合、评价 UI 与 trust scoring 在 v0.5 落地）。
- Provenance Gate 初版落地。
- Skill candidates from Done Issue（candidate only，不自动参与执行）。
- Issue board view。
- Multi-workspace。
- Daemon 化。
- GitHub issue / PR 双向同步。
- Webhook automations。
- Research feed。
- Mobile / remote access。

云端托管 runtime / SaaS 计费不在此列：它与 PersonaHub"个人优先、本地优先、可自托管"的当前定位冲突。长期服务开源项目和小团队时，优先路径是 self-host server / daemon / multi-workspace，而不是由 PersonaHub 提供云端托管 runtime。

## 9. 状态机

### Issue 状态

Done 和 Blocked 都不是从对方转移过去的，以下按转移对列出，避免线性画法造成"Done 之后会进入 Blocked"之类的误解：

```text
Inbox      -> Ready       用户补全 goal / issue type / workflow template / owner agent
Ready      -> Running     agent run 启动
Running    -> Validating  workflow run completed
Validating -> Done        validation pass + evidence trace
Validating -> Running     validation fail，findings 回流
Validating -> Blocked     多轮不收敛 / 需要 operator escalation
Running    -> Blocked     执行中触发 escalation（新权限、不可逆风险等）
Blocked    -> Ready       operator 完成 escalation 处理
```

Done 为终态；Blocked 只能回到 Ready，不会自动跳回 Running。

### 状态说明

| Status | 含义 | 进入条件 |
| --- | --- | --- |
| Inbox | 未准备执行 | 用户新建但未分配 agent 或信息不足 |
| Ready | 可执行 | 有 goal、Issue Type、Workflow Template 和 owner agent |
| Running | Agent 正在执行或修复 | run started / validation fail 后回流 |
| Validating | Validator agent 正在按当前 Validation Policy 自动验证 | workflow run completed |
| Done | 自动验证通过，证据完整 | validation pass + evidence trace |
| Blocked | 需要 operator escalation | 权限、不可逆风险、多轮不收敛、需求冲突 |

## 10. UI 需求

### 左侧导航

必须支持：

- Project 切换。
- Issues 列表入口。
- Agents 入口。
- Automations 入口占位。
- Skills 入口。
- Settings 入口。

第一版左侧不需要完整 board。

### 中间协作现场

必须支持：

- 显示用户消息。
- 显示 agent 消息。
- 在 primary Thread 和 active Room Thread 之间切换。
- 展示 Room 目标、阶段、成员、leader、协作拓扑和当前状态。
- 展示 Room 内部 agent 讨论、分工、阶段结论和待解决问题。
- 显示 run events。
- 显示 handoff events。
- 显示 validation events / findings。
- 显示 decisions。
- 支持输入新指令或 @agent。
- 支持用户作为 Human Lead 打断讨论、纠正方向、补充约束、暂停 Room。
- 支持用户手动拉入 agent、移除 agent、指定 agent 接手或要求某个 agent 总结 / 重做 / 提供证据。

### 右侧 Inspector

必须支持：

- Issue 信息。
- 当前状态。
- Issue Type / Workflow Template。
- Owner agent / workflow agents / validator agent。
- Active Room 信息和成员状态。
- Run logs。
- Evidence refs。
- Message / event stats。
- Blockers。
- Done evidence summary，以及复制/下载其已持久化 Markdown 的操作。

## 11. 自动化与安全边界

`PersonaHub` 默认自动运行，但必须有 escalation 边界。

自动执行允许：

- 读取 workspace 文件。
- 运行配置允许的 agent adapter。
- 写入本地 PersonaHub 数据库。
- 写入 issue/thread 事件。
- 生成 evidence summary。

需要 escalation：

- 新权限、凭据、账号登录。
- 不可逆文件或数据删除。
- 跨 workspace 写入。
- 多轮 agent validation 无法收敛（超过 Validation Policy 配置的 `max_validation_rounds`）。
- 需求目标冲突。
- agent 判断证据不足但无法自行补齐。
- git commit：默认允许 agent 在 workspace 本地分支自动 commit；是否允许由 Project 设置决定。
- git push、强制推送（force push）、直接写入受保护分支：默认禁止，需 operator 显式授权。

危险操作 escalation 的范围收敛为 git push / force push、跨 workspace 写入和不可逆删除这几类，不追求覆盖任意危险命令的黑名单——动作面越宽，误报和维护成本越高，性价比递减。

### 凭据与执行环境隔离

git push 类风险的首要防线不是"在命令执行前判断并拦截它"，而是"agent 执行环境本身默认不具备 push 权限"：

- Agent run 的执行环境默认不继承用户日常使用的完整 git 凭据（SSH agent、cached HTTPS credential）。push 所需凭据由 Project 设置显式开启才下发。
- 这一层防线是确定性的，不依赖任何 agent CLI adapter 的内部协议细节（例如是否提供 approval hook、协议是否稳定），因此不会随 CLI 版本变化而失效，比"事前拦截危险命令"更可靠。
- 本地文件写入、本地 commit 默认放行是合理的，因为 git 本身已经提供了撤销能力（`checkout`/`reset`）；真正需要额外防线的只有离开本地沙箱、影响远端/协作者/CI 的操作。

### Escalation 机制

Escalation 是硬阻塞，不是软提示，但对不同风险类型，"硬阻塞"依赖的防线不同：

- 对 git push / force push：凭据隔离是硬阻塞的主要防线；escalation 事件是这层防线之上的可观测性补充——即使 push 已经因为缺少凭据被环境层挡住，Thread 中仍应生成清晰的 escalation 事件说明"agent 尝试 push 被环境隔离挡住"，而不是让用户只看到一个语焉不详的 git 认证失败。若 agent adapter 恰好提供可靠的执行前 approval 钩子（例如 Codex CLI 的 app-server 协议），可以在凭据隔离之上再叠加一层前置拦截，进一步提升可观测性，但这不是安全底线本身。
- 对不可逆删除、跨 workspace 写入等无法通过凭据隔离防住的风险，escalation 机制（暂停/终止 run、Issue 置 Blocked）本身就是主要防线，触发上述条件时相关 agent run 暂停或终止，不会绕过 escalation 继续自动执行。
- Issue 状态置为 Blocked，Thread 中生成 escalation 事件，Inspector 的 Blockers 区块展示待处理事项。
- Issue 停留在 Blocked，直到 operator 在 Thread / Inspector 中显式处理（批准 / 拒绝 / 补充信息 / 解决冲突）。
- operator 处理完成后 Issue 回到 Ready（见第 9 节状态机），由用户重新触发 Running，系统不自动恢复执行。

### 并发与 workspace 锁

同一 workspace 如果同时存在多个 Running 状态的 Issue，系统必须保证同一时刻只有一个 agent 进程对该 workspace 执行写操作（本地串行排队），避免多个 agent 并发修改同一份代码互相覆盖。这是 v0.1 的强约束，而不是等到 v0.7 workspace isolation 阶段才处理。P0 不做容器级 / 进程级 workspace isolation——完整 isolation 会显著增加 runtime 复杂度，不适合作为 v0.1 阻塞能力——但 workspace 写锁、跨 workspace escalation 和危险操作 escalation（不可逆删除、危险 git 操作）必须在 P0 落地，是安全性和可信度的底线。

## 12. 验收标准

### MVP 验收

- [ ] 用户可以创建 Project。
- [ ] 用户可以为 Project 绑定本地 Workspace（local workspace path）。
- [ ] 用户可以创建 Issue。
- [ ] 用户可以创建 coding Issue，并应用 Coding Workflow Template。
- [ ] Issue 自动创建 primary Thread。
- [ ] 用户可以配置至少一个本地 coding CLI agent adapter。
- [ ] 用户可以在 Thread 中下发开发指令，无需切换到对应 CLI。
- [ ] 系统可以启动本地 coding agent 执行 Issue。
- [ ] Thread 可以实时展示 run events。
- [ ] Thread / Inspector 可以展示 run logs、file changes、command/test evidence。
- [ ] Workflow step 完成后系统自动 handoff 给 validator agent。
- [ ] Validator 输出 structured findings 和 pass/fail。
- [ ] Validation pass 后 Issue 自动进入 Done。
- [ ] Validation fail 后 Issue 回到 Running，并携带 findings。
- [ ] Done Issue 有 evidence summary。
- [ ] 一个真实代码开发 Issue 可以从创建到 Done 全程在 PersonaHub 内完成。
- [ ] 数据持久化在本地。
- [ ] Evidence summary 可导出 Markdown。

### 非功能验收

- [ ] 本地优先运行，不依赖 cloud account。
- [ ] 不使用项目保留端口 3003 / 3004（与用户本机其他在跑项目冲突，仅为本机环境约束，不代表通用规范）。
- [ ] 不连接 Redis 6399（同上，避免与本机其他项目共用的 Redis 实例互相干扰）。
- [ ] UI 不以 landing page 开场，打开即工作台。
- [ ] Board view 不阻塞 MVP。
- [ ] Voice / 陪伴 / game 不进入 MVP。

## 13. 风险与应对

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| 过度平台化 | 一开始做 daemon、cloud、auth、multi-user | v0.1 只做 local runner + SQLite |
| 聊天壳化 | Thread 只是普通聊天记录 | 所有 Thread 必须绑定 Issue、状态和 evidence |
| Validation 变成人工 gate | 用户仍需手动放行 | Validation 作为 agent loop 自动推进状态 |
| Agent 团队误配 | 日常任务也拉起 architect / coder / reviewer | Issue Type + Workflow Template + Collaboration Topology 决定 agent roster 和协作方式 |
| Memory 污染 | agent 随意写长期知识 | Memory 必须有 source issue/thread/event、confidence 和 provenance |
| UI 过重 | Board / Hub / Logs / 多协作室同时抢中心 | 中间只承载当前协作现场（primary Thread 或 active Room），右侧 Inspector 分 tab |
| 执行不可信 | Agent 自称完成但无证据 | Done 必须有 validation pass + evidence trace |
| 同质化 | 看起来像普通聊天壳或普通 issue runner | 主打 Issue-managed Thread + evidence-grounded execution；从 v0.2 `orchestrator_subagent` 起，以 Collaboration Topology 为起点逐步实现 graph-orchestrated collaboration（v0.1 仅有 Collaboration Topology 描述性元数据，尚不驱动执行，见 `docs/decisions/0006-executable-work-graph.md`）+ evidence / skill compounding |
| git push escalation 曾经过度依赖 CLI 能力（风险已下调） | 早期设计假设"硬阻塞"必须靠 CLI 的执行前 approval/权限钩子实现，一旦 CLI 不提供该钩子就只能事后检测，达不到第 11 节"硬阻塞"的要求 | 已改为凭据/执行环境隔离为主要防线（见第 11 节"凭据与执行环境隔离"）：agent 执行环境默认不下发 push 凭据，push 会因缺少凭据自然失败，不依赖 CLI 内部协议；CLI 的 approval 钩子（若存在）只作为可观测性增强，不再是安全底线本身 |

## 14. Open Questions

当前没有待拍板的产品级问题。上一轮的 7 个问题已全部拍板：

- 技术栈（Vite + React + 本地 API）和首个 agent adapter（Codex CLI）是阻塞项，决策记录见 `docs/decisions/0001-frontend-stack.md` 和 `docs/decisions/0002-first-agent-adapter.md`。
- 其余 5 项（P0 workflow 范围、workspace isolation、evidence summary 存储、memory 自动保存、validator 角色边界）结论已直接并入正文对应小节（第 4.1、7.5、7.6、7.7、11 节）。

后续如出现新的待拍板问题，在此按同样格式记录：先给出推荐倾向和理由，避免长期堆积无方向的不确定性。

## 15. 版本路线

路线图按能力跃迁组织，而不是仅按功能清单组织。`PersonaHub` 的长期演进方向是：从固定 coding workflow，逐步升级为能自动选择协作方式、自动组队、自动验证、自动沉淀经验的个人 AI Agent Team OS。

范围承诺分两层，呼应第 13 节"过度平台化"风险：v0.1–v0.3 是近期承诺范围，目标是先跑通个人闭环、验证 Issue-managed Thread 和 collaboration-topology 驱动的协作这两个核心判断是否成立，而不是先把全部框架搭好；这也是 Executable Work Graph 目标模型（`docs/decisions/0006-executable-work-graph.md`）的早期验证阶段——v0.2 `orchestrator_subagent` 拓扑落地即触发该决策的 Slice 1。v0.4 及以后是方向性设想，用来说明长期演进逻辑自洽，但具体范围、顺序甚至是否要做，会随 v0.1–v0.3 的实际使用反馈调整，不构成当前排期承诺。

### v0.1 Sequential Workflow

目标：把用户日常代码开发工作流迁移到 `PersonaHub`，跑通最小可信闭环。

协作形态：

```text
Issue -> primary Thread -> implementation agent -> validator agent -> Evidence Summary
```

范围：

#### v0.1.0 Workspace & Issue Foundation

- Project / Issue / Thread。
- 本地代码 workspace 绑定。
- Coding Issue Type。
- Coding Workflow Template。
- SQLite 持久化。

#### v0.1.1 Agent Command Center

- Coding agent adapter registry。
- 至少接入一个本地 coding CLI agent。
- 在 Thread 中向 agent 下发开发指令。
- Run events 持久化。
- 右侧 Inspector 展示 agent status 和 run logs。

#### v0.1.2 Development Trace

- 记录 command/test/file-change evidence。
- Thread 内展示 handoff events 和 validation events。
- Evidence refs 可追溯到 run events。
- Markdown export。

#### v0.1.3 Autonomous Validation

- Agent Validation Loop。
- Validation pass / fail 驱动 Issue 状态流转。
- Done Issue 自动生成 evidence summary。
- Validation fail 后 findings 回流为下一轮修复输入。

#### v0.1.4 手动多 Agent 路由

目标：在不引入 Coordinator 自动编排、不引入 Room 协作现场的前提下，让用户可以在同一个 Issue 的 Thread 里手动调度多个不同的 CLI agent 协同完成一个任务，不必离开 PersonaHub、不必手动在多个工具间复制结论。协作拓扑仍然是 `sequential`——区别只是"下一步交给谁"从 Workflow Template 固定的角色顺序，变成用户在 Thread 里手动指定。

范围：

- 在 F002 已接入的 Codex CLI adapter 基础上，补齐 **Claude Code CLI adapter** 和 **OpenCode CLI adapter**，三者同时可用。
- 三个 adapter 的鉴权方式：
  - Codex、Claude Code、OpenCode 均支持 **OAuth 登录**方式（复用各 CLI 自身的登录机制，PersonaHub 负责引导用户完成登录、检测登录状态，不自建 OAuth 流程）。
  - **OpenCode 额外支持单独配置 API key 等模型信息**（provider/model/api key），不强制走 OAuth——因为 OpenCode 定位是可对接多种模型 provider 的通用 CLI，用户可能需要直接指定 key 而不是走某个厂商的登录态。
- Thread composer 增加 agent/角色选择器（例如 @ 提及或下拉），用户下发指令时手动指定由哪个已配置的 adapter 处理这一轮。
- 上一轮的 Handoff Packet 和 evidence refs（F003 已有）自动成为下一个被指定 adapter 的上下文输入，用户不需要手动复制结论。
- 不做：Coordinator 自动推荐该找谁、Workflow/Topology 自动选择、Room 可视化协作现场——这些是 v0.2/v0.3 的范围。

完成判据：

- 用户可以在一个 Issue 的 Thread 里，依次手动指定 Codex、Claude Code、OpenCode 中的任意一个处理某一轮指令，且下一个被指定的 agent 能读到上一轮的结论和证据，不需要用户手动复制。
- 三个 adapter 都能完成登录/鉴权配置并显示可用状态。

v0.1 完成判据：

- 至少一个真实代码开发 Issue 可以端到端在 PersonaHub 内完成。
- 用户不需要手动在多个 CLI 之间复制上下文，包括手动在 Codex / Claude Code / OpenCode 之间切换角色协作时。
- PersonaHub 成为该开发任务的唯一指令入口、状态入口和证据入口。

### v0.2 Orchestrator Workflow

目标：引入 Coordinator Agent 作为可配置 agent role，让用户用自然语言目标启动工作，由系统推荐 Issue Type、Workflow Template、Agent Team 和协作拓扑，把 v0.1.4 里"用户手动 @ 指定下一个 agent"升级为"系统自动推荐/分派"。

范围：

- 内置默认 Coordinator——**v0.2 是进程内的确定性规则引擎，不是一个可配置的 agent**，因为推荐候选集当前大小为 1（`IssueType` 只有 `coding`，`workflow_templates` 只有一行种子数据），不需要模型推理；执行通道选型与重新评估的触发条件见 `docs/decisions/0007-coordinator-execution-channel.md`。
- Project `default_coordinator_agent_id`：**推迟**。该列语义是"指向某个 agent config"，而 v0.2 的 Coordinator 没有对应的 agent config 行；为满足列而造一条不能执行、状态永远 Unknown 的假 adapter 记录弊大于利。列保持 NULL，等 ADR 0007 的触发条件出现时再写入，无需迁移。
- Issue Type 自动识别（v0.2 候选集为 1，规则形状先立住，v0.3 增加类型时只是候选集变大）。
- Workflow Template / Collaboration Topology 推荐。
- Agent Team Template 推荐：**v0.2 只做每次现算的 agent roster 推荐，不做可复用的持久化 Team Template**。`workflow_templates.agent_team_template_id` 目前是一个指向**不存在的表**的悬空列（`schema-v1.ts:32`），落地持久化模板需要先建表与配套管理，成本与当前收益不匹配。
- Structured Handoff Packet：**已由 v0.1.4 交付**（`server/src/services/handoff-builder.ts` 的 `HandoffPayload`），v0.2 不重复实现。
- Workflow Template 管理 UI 初版。
- Coordinator 根据 Issue Type / agent capability，在 v0.1.4 已接入的 Codex / Claude Code / OpenCode 之间**推荐**执行者并说明理由，**由用户确认后才创建 Issue 与 Run**，不再需要用户自己记住有哪些 agent、哪个当前可用（adapter 接入本身已在 v0.1.4 完成）。v0.2 不做无人确认的自动派工：推荐错误会直接变成仓库里的真实执行，保留一次人工闸门；且这与既有 `resolveAdapter()`"永不猜测、无法解析即硬错误"的纪律一致。
- Runtime health check。

完成判据：

- 用户输入自然语言目标后，系统能自动创建或补全 Issue。**v0.2 的"自然语言"成分很弱**——标题/goal 从输入文本直接取用，推荐由关键词与可用性规则驱动，不是语义理解；产品文案不得把它描述为理解能力（见 `docs/decisions/0007-coordinator-execution-channel.md`）。
- 系统能说明为什么选择某个 workflow / topology / agent roster。
- 至少 coding workflow 支持 orchestrator_subagent 拓扑，且至少覆盖一次真实的 fan-out → fan-in：Coordinator 拆出至少两个可独立调度的子任务，子任务结果通过显式边回传，由 Coordinator 或 synthesis node 收敛，并记录每个子任务的执行者、输入来源、结果和收敛决策——单一子 agent 顺序接力不满足此判据。**并行范围受现有 workspace 排他锁约束，不隐含放宽写并发；只读子任务的"不持锁并行"必须有结构性隔离，不能只靠角色/prompt 自称只读**：写入代码库的子任务（含最终落盘的 synthesis/implementation 节点）始终受 `workspace-lock.ts` 保护、串行执行；只读分析/审查子任务只有在满足 `docs/decisions/0006-executable-work-graph.md` 定义的强制隔离条件（活 workspace 在操作系统层面不可访问，不是仅仅换一个 `cwd`——普通 `git worktree`/目录拷贝本身不满足该条件，因为子进程仍能通过相对/绝对路径或调用工具触达原 workspace，`git worktree` 还与主仓库共享 `.git` 管理元数据）时，才允许不持锁并行；当前运行时任何 adapter 都不具备满足该条件的能力（`WorkspaceContext` 无访问模式字段，Codex 以 `workspace-write` 沙箱启动，Claude Code/OpenCode 直接以 workspace 路径为 cwd 启动）。因此**默认基线是全部串行**：v0.2 若未落地并验证该隔离边界，只读子任务也必须进入排他锁串行队列，此时"并行"只体现为图上的逻辑 fan-out（可独立调度、可追踪），不代表物理并行执行；结构性隔离是需要额外设计验证才能解锁的加分项，不是默认路径。独立 worktree 级别的并行**写入**不属于本判据范围，除非 v0.2 `design.md` 另行决策。这是第一个非简单串行的多节点协作场景，即 `docs/decisions/0006-executable-work-graph.md`（Executable Work Graph）Slice 1 的触发点：v0.2 至少要能以显式 Node/Edge 语义**执行、可追踪、可恢复**该拓扑（"可恢复"的最小语义——重启后可重建各 Node 状态、已完成不重复执行、进行中 Attempt 标记 interrupted、可从对应 Node 发起新 Attempt、fan-in 不因重启提前收敛——以该决策为准，不在此重复定义）；是否需要为此新增 `GraphRun`/`NodeRun` 等独立持久化表，还是现有 Run/Event 模型经扩展即可满足，由 `design.md` 按恢复、审计、并发和演进需求判断，不是本判据预先假定的结论。范围严格收窄到 `orchestrator_subagent` 本身需要的能力，不因此展开 Graph Compiler、自然语言 Graph Draft、Canvas UI 等仍然等待各自触发条件的部分。

### v0.3 Artifact-Centered Collaboration

目标：减少纯聊天上下文传递带来的信息损耗，让 Room 和 agents 通过结构化 artifacts 协作。

范围：

- Artifact model：支持 Issue / Thread / Room / run 产出的结构化阶段成果。
- 可选 artifact directory：作为本地实现细节存放复杂 Issue 的阶段产物，不作为一级产品概念。
- Room 初版：支持 Coordinator Agent 自动创建，也支持 Human Lead 手动开房间、拉群、打断、纠偏和调整成员。
- Squads / Agent groups：静态、可复用的 agent 分组，与 Room 的临时协作室互补。
- research / synthesis / implementation / validation 阶段 artifacts。
- HandoffPacket 引用 artifacts 和 evidence refs。
- Evidence refs 与 artifact manifest 互相可追溯。

完成判据：

- 一个复杂 coding Issue 可以产生 research_findings、synthesis_plan、implementation_log、verification_results。
- Coordinator Agent / validator 可以基于 artifact refs 汇总和验证，而不是只依赖聊天历史。
- 用户可以进入 active Room 协作现场，查看 agents 讨论和分工，并在需要时打断、纠偏或调整参与 agents。

### v0.4 Daily Workflow Expansion

目标：从 coding 扩展到个人日常 workflow，并通过不同任务范式的真实垂直切片验证 Workflow / Artifact / Evidence / Validation 抽象是否通用，让 PersonaHub 不只是开发工具。

交付原则：

- v0.4 是渐进扩展阶段，不是一次同时发布 Windows 排障、论文、书籍、研究、写作五套成熟 workflow 的功能包。
- 一次优先做深一种新的任务范式；前一个切片完成真实端到端验证、暴露并修正通用抽象后，再决定下一个切片。
- 可以提前保留多种 Issue Type 和 template 的数据模型边界，但“类型存在”不等于“已提供可运行、可验证的内置 Workflow”，UI 不应把未成熟类型展示为已支持能力。
- 新场景优先通过 Workflow Template / Validation Policy / Agent capability 扩展；如果出现新的执行环境、证据语义或权限模型，应如实扩展对应模块，不把所有差异压进通用 JSON 配置。

范围：

以下编号表达建议的验证顺序和候选切片，不代表现在已经拆出的 Feature 或排期承诺；正式拆分仍应等待 v0.1–v0.3 的真实使用反馈。

- **v0.4.0 Workflow 扩展契约**：明确输入/输出 contract、Agent capability、阶段 artifact、evidence requirements、validation policy、权限/escalation policy 和 Done policy 的扩展边界。
- **v0.4.1 Windows Troubleshooting 垂直切片**：作为首个非 coding Workflow，覆盖诊断、受约束修复、修复前后状态证据、权限升级和危险操作 escalation；它与 coding 同样具有较强的客观验证条件，又能检验 Workspace、Runner、Evidence 和安全边界是否过度绑定代码仓库。
- **v0.4.2 Knowledge / Research 候选切片**：在 v0.4.1 实测后，从 Paper Reading 或 Research 中选择一个优先落地，重点验证来源级 provenance、事实/作者观点/Agent 推断区分、多来源冲突和不确定性；不默认同时实现两者。
- **v0.4.3 Writing / Book 候选切片**：根据前两个切片的反馈再决定范围，重点处理事实验证与主观偏好 gate 的边界；可以作为 verified research artifacts 的下游 Workflow，而不是复制一套独立平台。
- Scheduled Issue / Recurring Issue 和 Skill 文件加载仅在至少一个非 coding 垂直切片稳定后按需引入，不作为五类 Workflow 同时交付的理由。

完成判据：

- 至少一个非 coding Issue Type（优先 Windows Troubleshooting）可以用真实任务端到端完成并生成可回溯的 Evidence Summary。
- 能明确区分哪些 contract / artifact / evidence / validation 能力是跨场景通用抽象，哪些属于具体任务范式；不得依赖散落的 `issue_type` 条件分支或无法验证语义的万能 JSON 来伪装通用性。
- 只有已完成真实端到端验证的内置 Workflow 才在 UI 和文档中标记为 supported；其余候选保持 experimental / planned。
- 如果引入 Scheduled Issue，至少一种低风险、验证策略明确的 Workflow 可以按模板安全重复执行。

### v0.5 AgentOps & Evaluation

目标：基于前序版本已经持续记录的最小运行信号，评估的不只是任务是否完成，还包括 agent / workflow / topology 的成本、可靠性和失败模式。v0.5 新增的是完整聚合、评价产品能力和信任决策，不应到此版本才首次开始收集基础数据。

范围：

- v0.1–v0.3 的最小前置埋点/事件不变量：人工介入与 override、手动上下文复制（可观测时）、duration、retry count、validation round、blocked reason、错误 Done / 错误 Blocked 纠正记录，以及证据回溯入口；早期可以只保存原始事件，不要求完整 AgentOps UI。
- AgentOps metrics：cost、duration、retry count、validation_round_count、blocker count、tool efficiency。
- Workflow success rate。
- Drift / ping-pong / blocked reason 记录。
- Validation Policy 与 AgentOps Evaluation 分层。
- Provenance Gate 初版落地。
- Validator capability / trust scoring：允许任意 Agent 通过 capability 声明参与验证，不再局限于 Workflow Template 固定的 validator 角色。

完成判据：

- 用户能看到某个 workflow 为什么失败、在哪个阶段失败、是否值得复用。
- Memory / Skill / Scheduled Issue 写入长期状态前必须有 provenance decision。

### v0.6 Skill Compounding

目标：把 Done Issue 中的成功协作方式沉淀为 reusable multi-agent skill，让 PersonaHub 在后续相似任务中复用已验证的协作经验。

范围：

- Skill Candidate 自动生成。
- Skill provenance。
- Skill review / accept / reject。
- Workflow Template patch candidate。
- Project-specific skill library。

完成判据：

- Done Issue 可以生成 skill candidate。
- 用户接受 skill 后，后续相似 Issue 能推荐或自动加载该 skill。
- Skill 不能在 provenance 不完整时自动参与执行。

### v0.7 Runtime / Daemon / Self-host

目标：提升本地执行可靠性，并为自托管、多设备和后台执行做准备。

范围：

- Daemon 化。
- Agent discovery。
- Workspace isolation。
- Multi-workspace。
- Background queue。
- WebSocket / SSE 稳定化。
- Postgres/pgvector 可选迁移。
- Board view。
- GitHub issue/PR sync 初版。

完成判据：

- PersonaHub 可以作为本机常驻 agent runtime 管理任务队列。
- agent 执行与 Web UI 生命周期解耦。

### v0.8 Protocol Ecosystem

目标：把 PersonaHub 放入更大的 agent 生态，但保持个人工作流和安全边界为核心。

范围：

- MCP 工具 / 数据连接层。
- A2A 外部 agent 通信层。
- External agent capability discovery。
- Research feed：基于 MCP 数据连接层接入的外部资料源。
- Webhook automations。
- Mobile / remote access。

分层原则：

```text
MCP = 工具 / 数据连接层
A2A = 外部 Agent 通信层
PersonaHub Workflow = 本地个人团队编排层
Thread / Event = 可观察协作记录层
Memory / Skill = 长期学习层
```

### v0.9 Adaptive Personal Agent Team OS

目标：根据任务类型、风险、预算、历史成功率自动选择协作拓扑和 agent team。

范围：

- Adaptive topology selection。
- Dynamic Room assembly。
- Cost / quality mode。
- Long-running personal workflows。
- Cross-project memory / skill suggestions。

完成判据：

- 用户只输入目标，PersonaHub 能自动决定采用 sequential、orchestrator_subagent、coordinator、council、moa 或其他 topology。
- 系统能解释选择原因、预算影响、风险和人工升级点。

## 16. 文档关系

本 PRD 是 `PersonaHub` 产品需求的正式交付件和后续设计/实现的产品真相源。

相关项目文档：

- `docs/personahub-system-design.md`：数据模型等实现级设计内容，随实现迭代，不作为产品判断的真相源。
- `docs/SOP.md`：当前项目开发流程约定。
- `BACKLOG.md`：后续功能拆分和执行跟踪入口。
- `docs/features/`：具体功能规格文档目录。
- `docs/decisions/`：本 PRD 第 14 节 Open Questions 一旦拍板，落地为独立决策记录的目录。
- `docs/research/`：前期调研和竞品分析归档，仅作背景材料，不覆盖本 PRD。
