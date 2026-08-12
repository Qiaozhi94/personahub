# clowder-ai 项目分析报告

分析日期：2026-07-08  
分析对象：https://github.com/zts212653/clowder-ai  
用途：为 `PersonaHub` 项目提炼可借鉴的设计理念、运行架构、页面效果与实现逻辑。

## 1. 项目概览

`clowder-ai` 的核心定位是：

> Build AI teams, not just agents.

它不是单纯的 agent 调用框架，而是一个“AI 团队平台层”。它试图解决的问题是：当用户同时使用 Claude、GPT/Codex、Gemini、OpenCode 等多个 agent CLI 时，用户会被迫充当“人工路由器”，不停复制上下文、分配任务、追踪谁说了什么、手动协调审阅与交接。

`clowder-ai` 的回答是：把这些 agent 放进一个有共同愿景、有长期身份、有共享记忆、有协作纪律的团队空间里。

公开资料显示，它支持的核心能力包括：

- 多 agent 编排
- 持久身份
- 跨模型审阅
- A2A agent-to-agent 通信
- 共享记忆与证据库
- Skills Framework
- MCP 集成
- SOP 自动治理
- Chat、Hub、Mission Hub、多平台入口、语音、研究 feed、游戏模式等体验层功能

## 2. 设计理念

### 2.1 平台层，而不是模型层

`clowder-ai` 的架构叙事非常清晰：模型、agent CLI、平台层三者职责分离。

| 层级 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Model | 推理、生成、理解 | 长期记忆、纪律、团队协作 |
| Agent CLI | 工具调用、文件操作、命令执行 | 团队协调、审阅、长期治理 |
| Clowder Platform | 身份、路由、协作、纪律、审计、记忆 | 模型推理本身 |

这点是 `clowder-ai` 最值得借鉴的地方。它没有把平台做成“另一个大模型壳”，而是把自己定义为多个强 agent 之间的组织层。

对 `PersonaHub` 的启发：

- 不要重新发明 agent 能力。
- 专注在任务路由、上下文压缩、交接、审阅、证据和记忆。
- 把 Claude/Codex/Gemini/OpenCode 看成可插拔成员，而不是被封装掉的后端 provider。

### 2.2 Hard Rails + Soft Power

`clowder-ai` 使用“硬约束 + 软力量”的理念：

- Hard Rails：不可违反的安全底线，例如不能删除自己的数据库、不能杀父进程、运行时配置只读、不能碰别人的端口。
- Soft Power：在硬约束之上，让 agent 自协作、自审阅、自改进。

这套设计把 agent 治理从“限制 agent 不要犯错”升级成“形成团队文化”。它不是只有安全策略，而是把约束、愿景、角色和复盘都放进系统。

对 `PersonaHub` 的启发：

- 第一版就可以有少量明确的底线规则。
- 规则不必多，但要和执行层绑定，例如禁止危险文件操作、保护配置、任务完成必须有验证证据。
- 不要只把规则写在 README，要让运行时和 workflow 真正执行。

### 2.3 CVO Mode：人类是愿景负责人

`clowder-ai` 引入 CVO，即 Chief Vision Officer。人类不是普通“操作员”，而是：

- 表达愿景
- 在关键节点做决策
- 通过反馈塑造团队文化
- 与 agents 共同创作

这个设计把人类的位置从“给 prompt 的人”提升为“团队方向制定者”。它也解释了为什么 `clowder-ai` 会有 Mission Hub、Need Audit、设计 gate、review gate 等流程。

对 `PersonaHub` 的启发：

- 可以吸收“人类在关键 gate 做决策”的逻辑。
- 但不一定沿用 CVO 这个称呼。对更克制的产品，可以叫 `Owner`、`Lead`、`Operator`。
- 人类确认点应该出现在需求澄清、方案确认、执行授权、审阅通过、记忆沉淀等节点。

### 2.4 Persistent Identity：agent 不是临时函数

`clowder-ai` 给不同 agent 设计了持续身份、性格、记忆和角色。这使它的多 agent 协作不是“同一个聊天机器人切换模型”，而是“多个成员共同工作”。

它的身份系统和项目叙事绑定很深，例如 Claude、GPT/Codex、Gemini、OpenCode 都被具象化为固定成员。

对 `PersonaHub` 的启发：

- 可以保留“稳定角色 + 能力画像 + 偏好记忆”。
- 不必保留强拟人或强角色皮肤。
- 最小设计可以是：`architect`、`coder`、`reviewer`、`researcher` 四类 agent profile。

## 3. 运行架构

### 3.1 仓库结构观察

公开仓库目录显示，`clowder-ai` 是 pnpm monorepo 风格，关键目录包括：

- `packages/api`
- `packages/web`
- `packages/shared`
- `packages/mcp-server`
- `packages/finance`
- `desktop`
- `docs`
- `guides`
- `scripts`
- `sop-definitions`
- `cat-cafe-skills`

这表明它不是单页 demo，而是一个较完整的平台工程：

- Web 前端
- API 服务
- shared 类型/逻辑
- MCP server
- 桌面封装
- SOP 定义
- 技能包
- 安装、启动、检查、同步、Redis 管理等脚本

### 3.2 启动与运行依赖

README 中的 source setup 依赖：

- Node.js 20+
- pnpm 9+
- Redis 7+，可选，支持 `--memory` 跳过
- Git

典型启动流程：

```bash
pnpm install
pnpm build
cp .env.example .env
pnpm start
```

启动后访问：

```text
http://localhost:3003
```

桌面 installer 方案会打包 app runtime、portable Node.js 和 Redis，让普通用户不必手动安装依赖。

### 3.3 运行时组成

根据公开架构图和目录推断，`clowder-ai` 的核心运行时可以拆成：

```text
用户/CVO
  ↓
Web UI: Chat / Hub / Mission Hub / Signals / Voice / Game
  ↓
API 服务
  ↓
平台层服务
  - Identity Manager
  - A2A Router & Threads
  - Skills Framework & Manifest
  - Memory & Evidence
  - SOP Guardian
  - MCP Callback Bridge
  ↓
Agent CLI Adapters
  - Claude Code
  - Codex CLI
  - Gemini / Antigravity
  - OpenCode
  - other providers
  ↓
本地/远程工具、文件系统、MCP 工具
```

### 3.4 Agent Adapter 逻辑

`clowder-ai` 强调 agent CLI/adapter 通过统一消息层接入。公开 README 中列出的适配对象包括：

| Agent CLI | 输出格式 | MCP 状态 |
| --- | --- | --- |
| Claude Code | stream-json | 支持 |
| Codex CLI | json | 支持 |
| Antigravity CLI | plain text | CLI-managed |
| Gemini CLI | stream-json / ACP | 支持 |
| Antigravity Desktop | cdp-bridge | callback bridge |
| OpenCode | ndjson | 支持 |

这说明它的实现逻辑大概率不是把所有 agent 抹平为同一种 API，而是通过 adapter 层把不同 CLI 的输出格式标准化，再交给平台层处理路由、线程、记忆和审阅。

对 `PersonaHub` 的启发：

- 需要尽早设计 `AgentAdapter` 接口。
- 每个 adapter 至少需要处理：启动命令、输入格式、输出解析、状态事件、错误事件、工具事件、完成事件。
- 不同 CLI 输出格式差异很大，统一事件模型比统一字符串输出更重要。

### 3.5 Memory 与 Evidence

`clowder-ai` 将共享记忆描述为 evidence store、lessons learned、decision logs。这是它区别于普通多模型聊天器的关键。

它的记忆不是“聊天记录搜索”这么简单，而更像团队知识库：

- 任务证据
- 决策记录
- 经验教训
- SOP 执行状态
- 审阅结论

对 `PersonaHub` 的启发：

- 记忆要有来源、时间、任务、生成者。
- 证据要和任务完成状态绑定。
- lessons learned 应该由用户确认或在 review 后沉淀，避免自动污染知识库。

## 4. 页面效果与信息架构

### 4.1 总体风格

`clowder-ai` 的页面效果从公开截图和 README 描述看，偏“团队空间 + 命令中心 + 功能治理平台”。它不是极简 issue board，而是有明显情感化和团队角色感的产品。

页面气质：

- 温暖、人格化
- 功能丰富
- 多工作面
- 强调团队存在感
- 同时承载工作、研究、语音、陪伴、游戏等场景

这套风格很有辨识度，但对 `PersonaHub` 来说应选择性吸收，避免早期 UI 复杂化。

### 4.2 Chat：AI 团队主入口

Chat 是 `clowder-ai` 的核心入口之一。

核心效果：

- 多线程聊天
- 每个 thread 是独立上下文
- `@opus`、`@codex`、`@gemini` 等 @mention 路由
- agent 回复以不同身份呈现
- rich blocks 展示代码 diff、checklist、interactive decisions，而不只是纯文本

实现逻辑推断：

1. 用户输入消息。
2. 前端识别或提交 @mention。
3. API 将消息写入 thread。
4. A2A Router 根据 mention、routing policy 或任务阶段选择 agent。
5. adapter 启动对应 CLI 或发送任务。
6. 平台层将流式输出解析为统一消息事件。
7. 前端按 agent 身份和 rich block 类型渲染。
8. 重要结论进入 memory/evidence。

对 `PersonaHub` 的借鉴：

- thread isolation 很重要。
- rich block 比纯 Markdown 更适合工作台。
- 但第一版可以先做结构化 Markdown + 状态卡，不必一次实现复杂 interactive blocks。

### 4.3 Hub：浮动命令中心

Hub 是一个浮动 command center，包含：

- Capability：每个 agent 的能力、工具、上下文预算
- Skills：按需加载的技能
- Quota Board：token 使用与成本
- Routing Policy：任务路由规则
- Account Configuration：模型 API key、OAuth、provider profile

这个设计的优点是把“系统配置”和“团队状态”集中到一个地方，不污染主聊天流。

对 `PersonaHub` 的借鉴：

- 可以设计一个右侧 inspector 或 command palette，承载 agent capability、routing、settings。
- 早期不建议做完整 Hub，容易超范围。
- 最关键的是：用户需要随时看见“谁能做什么”和“当前任务为什么分给它”。

### 4.4 Mission Hub：功能治理工作台

Mission Hub 是 `clowder-ai` 的 feature governance 页面。

核心效果：

- feature lifecycle：idea -> spec -> in-progress -> review -> done
- Need Audit：粘贴 PRD 后自动抽取 intent cards、识别风险、生成 slice plan
- Bulletin Board：展示 SOP 状态、当前 baton holder、阶段、阻塞点

实现逻辑推断：

1. 用户创建 feature/mission。
2. 系统生成或导入需求。
3. Need Audit 模块结构化需求。
4. SOP Guardian 根据流程定义推进阶段。
5. 不同 agent 在不同阶段接棒。
6. Mission Hub 汇总状态、风险和阻塞。

对 `PersonaHub` 的借鉴：

- 这是任务看板和聊天系统之间的桥。
- `PersonaHub` 可以把它简化为 `Task Board + Thread + Trace`。
- 关键不是复制 Mission Hub，而是复制“任务生命周期可见、交接责任可见、阻塞可见”。

### 4.5 Signals：研究 feed

Signals 是内置 AI/tech 文章研究区：

- RSS/blog crawler 聚合
- Tier 1-4 优先级
- 阅读、收藏、标注、笔记
- 多 agent 研究报告
- podcast 生成

这是 `clowder-ai` 功能面很宽的体现。它适合重度个人工作空间，但不适合 `PersonaHub` 第一阶段照搬。

对 `PersonaHub` 的建议：

- 研究 feed 放到后期。
- 第一版只需要支持“把链接/文档作为 task context 输入”。

### 4.6 Voice 与 Game Modes

Voice Companion 和 Game Modes 强化“AI 团队不是工具，而是关系”的理念。

从工程角度，它们也用于验证：

- A2A 消息
- 身份持久化
- turn-based coordination
- 多 agent 策略差异

对 `PersonaHub` 的建议：

- 不作为早期核心。
- 可以学习它用非工作场景压力测试 agent 协作协议的思路。

## 5. 实现逻辑拆解

### 5.1 请求路由

`clowder-ai` 的路由大致分两类：

- 显式路由：用户通过 @mention 指定 agent。
- 策略路由：根据 agent capability、routing policy、任务阶段或 SOP 自动分配。

核心实现要点：

- message parser：识别 mention、命令、上下文引用
- routing policy：映射任务类型和 agent 能力
- thread manager：确定消息属于哪个上下文
- adapter dispatcher：把任务交给对应 CLI

### 5.2 跨模型审阅

跨模型审阅是 `clowder-ai` 的代表性能力。

典型流程：

1. Claude 或某个 agent 完成实现。
2. GPT/Codex 或 reviewer agent 接收 diff、任务目标、上下文和验证结果。
3. reviewer 按结构输出风险、bug、测试缺口。
4. 审阅结果回写 thread 和 evidence store。
5. 后续修复或合并通过 SOP gate 管理。

对 `PersonaHub` 的建议：

- 把 review 做成一等对象。
- review 不只是聊天回复，而应有结构：severity、file、line、reason、suggestion、verification。

### 5.3 Skills Framework

`clowder-ai` 的 skills 是按需 prompt loading。agent 只有在需要时加载 TDD、debugging、review 等专业技能。

实现意义：

- 降低上下文污染。
- 避免所有 agent 永远携带巨大系统 prompt。
- 让技能可版本化、可审计、可复用。

对 `PersonaHub` 的建议：

- 第一版可以把 skill 定义为 Markdown 文件或 YAML manifest。
- 每个 skill 有 trigger、instructions、allowed tools、output schema。

### 5.4 SOP Guardian

SOP Guardian 是 `clowder-ai` 的流程纪律层。它把“应该怎么协作”变成系统机制。

可能包含：

- 阶段 gate
- review requirement
- evidence requirement
- merge protocol
- safety checks
- follow-up tracking

对 `PersonaHub` 的建议：

- 不要一开始做复杂 SOP 引擎。
- 先做三个硬 gate：Plan Approved、Review Passed、Verified Done。

## 6. 优势、短板与风险

### 6.1 优势

- 产品愿景完整：从工具调用上升到团队协作。
- 协作抽象强：identity、thread、A2A、handoff、review、memory 都覆盖。
- 情感化体验强：适合长期个人使用。
- 质量意识强：硬约束、SOP、证据、verified done。
- 功能探索丰富：Chat、Hub、Mission、Voice、Signals、Game 都在同一套平台层上延展。

### 6.2 短板

- 功能范围大，学习成本和维护成本高。
- 强品牌叙事不一定适合所有开源用户。
- 页面可能偏热闹，不适合追求极简工程工作台的人。
- 早期模仿容易被带偏，陷入语音、研究、游戏、陪伴等非主线功能。

### 6.3 对 PersonaHub 的取舍建议

应该吸收：

- 平台层三分法
- thread isolation
- @mention routing
- agent identity / capability profile
- cross-model review
- memory/evidence/decision log
- verified done
- light SOP gate

暂缓吸收：

- 强拟人品牌
- 游戏模式
- voice companion
- signals feed
- 大型 Hub
- 多平台聊天入口

## 7. 可落地到 PersonaHub 的设计提案

### 7.1 最小 Clowder 式能力

`PersonaHub` 可以先实现：

- `Task Thread`：每个任务一个隔离线程。
- `Agent Profile`：每个 agent 有角色、命令、能力标签、上下文预算。
- `Handoff`：把当前 thread summary 交给另一个 agent。
- `Review`：跨模型审阅输出结构化 findings。
- `Trace`：保存命令、测试、diff、结论。
- `Memory`：保存经确认的 decisions 和 lessons。

### 7.2 UI 转译

不要照搬 Clowder 的强叙事 UI。建议转译为：

- 左侧：Projects / Tasks / Agents
- 中间：Task Thread
- 右侧：Trace / Decisions / Participants / Next Action
- 顶部：当前 task 状态和 reviewer gate

这样保留 Clowder 的协作逻辑，但视觉上更接近 Multica 的克制风格。

## 8. 结论

`clowder-ai` 最值得学习的是“AI 团队平台层”的完整想象：它把 agent 从一次性工具变成有身份、有协作、有记忆、有纪律的长期成员。

但 `PersonaHub` 不应复制它的全部功能面。更好的路线是：

> 把 Clowder 的团队协作内核拆出来，去掉过强的角色包装和非核心玩法，用更简洁的产品形态承载 thread、handoff、review、memory 和 evidence。

这会让 `PersonaHub` 同时拥有长期协作深度和个人工具的轻盈感。

## 9. 来源

- GitHub 仓库：https://github.com/zts212653/clowder-ai
- README：https://raw.githubusercontent.com/zts212653/clowder-ai/main/README.md
- SETUP：https://raw.githubusercontent.com/zts212653/clowder-ai/main/SETUP.md
- docs 目录：https://github.com/zts212653/clowder-ai/tree/main/docs
- packages 目录：https://github.com/zts212653/clowder-ai/tree/main/packages

