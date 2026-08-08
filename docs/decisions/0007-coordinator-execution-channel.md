---
topics: [decision, coordinator, execution-channel, llm, routing, v0.2]
doc_kind: decision
status: accepted
created: 2026-08-01
updated: 2026-08-08
---

# 0007: Coordinator 的执行通道——v0.2 用确定性规则，推迟引入第二条执行路径

## 背景

`docs/personahub-prd.md` 第 15 节 v0.2 要求引入 Coordinator Agent：用户输入自然语言目标，系统自动创建/补全 Issue，识别 Issue Type，推荐 Workflow Template / Collaboration Topology / Agent Team，并**能说明为什么这么选**。

自然的第一反应是"Coordinator 也是个 agent，所以走现有 adapter 路径"。对照实际代码核实后，这条路走不通，且"到底要不要 LLM"这个前提本身没有被检验过。现状确认如下：

- **Coordinator 的第一份工作发生在 Issue 存在之前**，而 `runs` 表的 `issue_id` / `thread_id` / `workspace_id` 三个外键**全是 `NOT NULL`**（`server/src/db/schema-v2.ts:23-25`）。一次"把自然语言目标分类并推荐模板"的调用没有 Issue、没有 Thread，且不需要 workspace 文件访问或排他锁（下一条详述——它仍需要知道是哪个 workspace，只是不碰这个 workspace 的文件系统或队列）——它在结构上无法成为一个 Run，除非先造占位 Issue/Thread 行，而那会污染 Issue 列表并让 workspace 锁队列出现没有真实工作的条目。
- **Coordinator 不需要 workspace 文件访问与排他锁**（2026-08-08 检视修正原表述"不需要 workspace"，该说法过宽）。它的输入是 Issue 文本 + adapter 注册表，不读文件、不改代码；但它**需要一个 workspace id**——`agent_roster` 推荐必须按 `effectiveAdapterStatus()` 的 workspace 级覆盖判定 adapter 可用性（F007 `design.md` 第 3 节），没有目标 workspace 就无法算出这个维度。现有 dispatch 路径无条件为每个 Run 获取 workspace 排他锁（`run-dispatch.ts:91`、`:313`），并挂上完整的 trace 管道与 30 分钟执行超时（`runtime/types.ts:124`）。让一次纯文本的路由判断去抢工作区排他锁，会让它和真实的代码工作互相排队——这才是"不需要 workspace"想表达的意思：不持锁、不进队列，不是不知道 workspace 是哪个。
- **凭据隔离的形状与"直连 API"无关**。F005 的 `buildChildEnv()`（`runtime/workspace-context.ts:104-214`）是一份显式允许清单，其存在理由写在文件头部注释里：一个有 shell 能力的 agent 子进程能读取并外泄自己 env 里的任何东西。直连 API **没有子进程**，不存在需要保护的子环境。所以"直连 API 会破坏 F005 凭据隔离"这个担心不成立——真正新增的是另一回事：PersonaHub 自身要持有一个 API key，这是当前只对 OpenCode api_key 模式存在的一类秘密。
- **v0.2 的推荐候选集大小是 1**。`IssueType` 枚举当前只有 `Coding` 一个值（`shared/src/types/index.ts:114-116`）；`workflow_templates` 只有一行种子数据 `wft_coding_default`，`validation_policies` 同样只有一行（`schema-v1.ts:105-109`）。也就是说"识别 Issue Type""推荐 Workflow Template"这两项在 v0.2 是从单元素集合里选一个——不需要任何模型推理。真正存在判断空间的只有 collaboration topology（sequential vs orchestrator_subagent）和 agent roster。

最后一条推翻了"Coordinator 必须是 LLM"这个未经检验的前提。

## 决策

### 1. v0.2 的 Coordinator 是确定性规则引擎，不引入 LLM 执行通道

推荐逻辑全部由显式规则实现，规则本身即解释来源：

- `issue_type`：当前恒为 `coding`（候选集为 1）。
- `workflow_template`：按 issue_type 取激活模板（候选集为 1）。
- `collaboration_topology`：按目标文本是否需要多视角独立分析判定 `orchestrator_subagent`，否则 `sequential`。
- `agent_roster`：按 Node 的 `required_capabilities` 与**workspace 级** effective availability 筛选（`effectiveAdapterStatus()`，schema v7）。
- **解释**：每条推荐附带命中的规则名、候选集、以及被排除项及其排除原因（例如"OpenCode 在本 workspace 不可用"）。这比 LLM 生成的自然语言理由更可复核——它是判断过程本身，不是对判断的事后叙述。

这不假装是"自然语言理解"。v0.2 的自然语言成分很弱（标题/goal 从输入文本直接取用），产品文档不得把它描述成语义理解能力。

### 2. 不新建第二条执行路径

不实现 `OneShotAgentInvoker` 这类"无 workspace 短任务"通道，也不直连 Messages API。理由：现在没有需要它的真实工作负载——唯一的候选（Coordinator）已经被证明不需要模型。凭空建一条与 Run 路径并行的执行路径，意味着凭据隔离、超时、取消、失败归因、可观测性这几套语义要各自维护两份，而收益要等真正需要模型判断的场景出现才能兑现。

### 3. Coordinator 只推荐，不自动派工

Coordinator 产出推荐与理由并展示，由用户确认后才创建 Issue 与 Run。这与既有的 `resolveAdapter()` 纪律一致——它明确"永不回退到列表里第一个可用 adapter，无法解析的默认值是硬错误而不是猜测"（`services/adapter-resolver.ts` 文件头注释）。推荐必须走同一条纪律：Coordinator 给候选和理由，真实 dispatch 仍然用用户确认后的显式 adapter id 经 **`resolveEligibleAdapter()`** 解析（2026-08-08 检视修正：确认路径不能只用 `resolveAdapter()`——它没有 capability 参数，只证明 adapter 可用、不证明它具备节点/topology 所需的能力；`resolveEligibleAdapter()` 组合了 `resolveAdapter()` 的可用性判定与 capability 校验，同时继承其"永不猜测"纪律），**不得成为绕过该纪律的猜测型后门**。

## 触发条件：什么时候重新考虑 LLM 执行通道

以下任一条件出现时，本决策应被重新评估（并通过补充或 superseding ADR 记录），而不是在某个 feature 的 design.md 里悄悄引入：

- `IssueType` 或 `workflow_templates` 的候选集大于 1，且选择依据无法用显式规则表达（即真的需要语义判断，而不是关键词匹配）。
- 出现需要模型生成**内容**（而非做选择）的 Coordinator 职责，例如把一段模糊目标改写成结构化验收标准。
- v0.4 扩展非 coding workflow 时，Issue Type 分类面临真实的多类别歧义。

届时要先回答本 ADR 已经整理好的两个问题：这次调用有没有 Issue/Thread/workspace 上下文（决定能不能是 Run），以及它需不需要工作区访问（决定要不要持锁）。

## 理由

- **为什么不现在建**：唯一已知的调用方不需要它。在没有真实调用方的情况下设计一条执行路径，就是 ADR 0006 在图运行时上已经论证过的同一类支出——需要维护，但要等第二个场景出现才有回报。
- **为什么确定性版本不是敷衍**：v0.2 完成判据要求的是"系统能说明为什么选择某个 workflow / topology / agent roster"。规则引擎对这一条的满足度**高于**LLM：规则的解释就是它的判断依据本身，可复核、可测试、可回归；LLM 的解释是对自身输出的事后叙述，与真实判断过程之间没有强制一致性。
- **为什么把这个决策写下来**：本 ADR 的核心价值不是"选了规则引擎"，而是把三条不易重新推导的事实钉住——runs 的三个 NOT NULL 外键使 pre-Issue 调用不能是 Run、凭据隔离保护的是子进程 env 因而与直连 API 无关、v0.2 的推荐候选集大小是 1。没有这些，下一个人会从"Coordinator 当然是个 agent"重新开始推导。

## 影响

- `docs/features/0.2/F007-coordinator-routing-recommendation/` 以本决策为设计起点，不再讨论执行通道选型。
- PRD 第 15 节 v0.2 的 Coordinator 范围措辞需注意：不得把 v0.2 的能力描述为自然语言语义理解。
- 本决策不改变 F006 的任何结论；两者相互独立（F006 是图的**执行**，F007 是图的**选择**）。
- `AgentCapability` 词汇表当前只有 `implementation` / `validator` 两个值，roster 推荐的粒度受此限制，与 F006 `design.md` 第 5 节记录的取舍一致。
