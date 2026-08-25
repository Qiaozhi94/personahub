---
topics: [decision, architecture, code-structure, extensibility, adapter]
doc_kind: decision
status: accepted
created: 2026-08-25
---

# 0008: Capability Seam 命名约定——给已有的可替换点一个判断标准

## 背景

研究 DeepSeek Harness（`D:\Projects\deepseek-harness`，MIT，227 包 / 56.5 万行 TS）时，发现它把"可替换能力"产品化成了一个有名字、有纪律的结构，称为 **capability seam**。其 `docs/glossary.zh.md` 的定义要点是：

> **seam**：一种包含三种角色的*可替换能力*：**Service Definition**（拥有自身 `ctx.<key>` 和词汇类型的 Cordis `Service`——绝不是 TypeScript `interface`）、一个或多个 **Service Provider**，以及一个或多个注入该服务的 **Consumer**。……**seam 是完整能力，绝不是其中一个角色**。

对照 PersonaHub 实际代码核实后，结论是：**这套结构 PersonaHub 已经在用，只是没有名字，因此也没有判断标准。** 现状确认如下：

- `server/src/runtime/adapter-registry.ts:3` 的 `AgentAdapterRegistry` 是一个持有 `provider` 字符串为 key 的运行时注册表类，提供 `register` / `registerUnique` / `getByProvider` / `getForConfig`。
- `server/src/runtime/types.ts:84` 的 `AgentAdapter` 是接口，只承担**词汇**（`provider` / `capabilities` / `validate()` / `start()`）。
- 四个实现（`runtime/adapters/` 下的 `codex-cli-adapter.ts`、`claude-code-adapter.ts`、`opencode-adapter.ts`、`fake-adapter.ts`）在 `server/src/index.ts:128-131` 统一装配进注册表。
- **没有任何 Consumer import 具体 adapter**：`runtime/adapters/` 之外引用具体实现类的只有两类合法位置——装配点 `server/src/index.ts:45-48`，以及针对某个 adapter 自身的测试（`server/tests/` 下 `FakeAgentAdapter` 等）。业务路径上的文件一个都没有。
- **消费方不做 provider 名分支**：`runtime/agent-runner.ts:100` 与 `:108`、`services/run-dispatch.ts:145` 一律读 `adapter.capabilities.supportsStructuredTrace` / `executionTimeoutMs`，而不是判断"是不是 codex"。`runtime/adapters/` 之外仅剩 3 处 provider 字面量，全是默认值或映射（`api/routes/adapters.ts:74` 的 `?? "codex"`、`db/schema-v2.ts:7` 的 `DEFAULT 'codex'`、`runtime/provider-metadata.ts`），没有行为分支。

作为对照，`server/src/services/validation/policy-gate.ts`（215 行）导出的全部是纯函数（`buildPolicySnapshot`、`checkEvidenceRequirements`、`checkRoundLimit` 等），没有注册表、没有 key、没有可替换的 Provider。它是**被 snapshot 参数化的确定性逻辑**，不是 seam。在只有一种验证策略的当下这是正确取舍，但它和 adapter 的结构差异此前没有被显式命名过。

同时核实了另一处**已被承诺、但尚未开缝**的可替换点——执行世界：

- `runtime/types.ts:4` 的 `WorkspaceContext` 只有 `workspaceId` / `localPath` / `gitBranch` / `pushCredentialsEnabled` 四个字段，是纯数据结构，**不携带任何执行能力**。
- 进程启动散落在 6 处：`adapters/` 下 `codex-cli-adapter.ts:1`、`claude-code-adapter.ts:1`、`opencode-adapter.ts:1` 各自 `import { spawn } from "node:child_process"`，`codex-protocol.ts:1`、`claude-protocol.ts:1`、`opencode-protocol.ts:1` 各自 `spawnSync`。**每个 adapter 自己起进程。**
- 而 `docs/personahub-architecture.md` 第 2 节 v0.7 表已明确承诺"**替换 `WorkspaceContext` 的执行方式**（例如改成在容器里跑命令）"，`docs/decisions/0006-executable-work-graph.md` 进一步要求只读 Node 并行必须先有操作系统层面的隔离。

也就是说，这份决策要解决的不是"代码写得不对"，而是两件事：**（一）**每写一个新的可替换点，"配三角色还是写成函数"这道题目前全靠现场感觉回答；**（二）**已经写进路线的执行世界替换，目前没有开缝的位置。

## 决策

### 1. 采纳 seam 三角色作为术语

一个 **capability seam** 由三个角色构成，三者齐备才叫 seam：

| 角色 | 职责 | PersonaHub 范例 |
| --- | --- | --- |
| **Service Definition** | 持有查找 key 的**运行时对象**，Provider 向它注册、Consumer 从它取用 | `AgentAdapterRegistry`（`runtime/adapter-registry.ts`） |
| **Service Provider** | Definition 声明的词汇的具体实现 | `CodexCliAdapter` / `ClaudeCodeAdapter` / `OpenCodeAdapter` / `FakeAgentAdapter` |
| **Consumer** | 通过 Definition 取用能力，不 import 任何 Provider | `agent-runner.ts`、`run-dispatch.ts`、`adapter-resolver.ts` |

三条附带约束：

- **Definition 必须是运行时存在的对象（class 实例 / 注册表），不能只是 TS `interface`。** interface 编译后消失，Provider 无处注册、Consumer 无 key 可查。`AgentAdapter` 这个 interface **不是** Definition，它是 Definition 的**词汇**。
- **角色可以合并，seam 不能拆着算。** 同一文件同时是 Definition 和 Consumer 是允许的；但"我抽了个接口"不等于"我做了个 seam"。
- **Consumer 问能力位，不问身份。** 判定一个 seam 有没有做对，最直接的标准就是 Consumer 里有没有 `if (provider === "xxx")`。有则说明词汇不够，应该补 `capabilities` 字段，而不是加分支。

**并与两个近邻概念划清界限**，避免 seam 被滥用：

| 概念 | 触发条件 | 需要什么 | PersonaHub 例子 |
| --- | --- | --- | --- |
| **Seam** | 多个实现**共存**，运行时按 key 选一个 | Definition + Provider + Consumer | Agent Adapter（4 个同时在册） |
| **收敛点（chokepoint）** | **顺序替换**，新实现顶掉旧实现，永不共存 | 一个函数，所有调用走它。**零机制** | `LongTermStateGate`（见下） |
| **装配（assembly）** | 同一堆代码组装出不同**产品形态** | 挂载/接线清单 | 未来的 CLI 模式 / SDK 模式 |

**顺序替换不是 seam**：注册表的全部价值是"选"，永不共存就永远没有"选"这个动作，Map 里永远只有一项，买的是空盒子。**产品形态多样也不是 seam**：它不产生同一能力的第二个实现，只产生不同的组装清单（dsh 用 profile/bundle 解决，不是用 seam 解决）。

### 2. 判断标准：有没有第二个 Provider 的真实需求

新增一个可替换点时：

- **有**（已知或已承诺会出现第二个实现）→ 三角色一次配齐。
- **没有** → 写成函数/确定性逻辑，**不要预先抽接口**。

理由：**半个 seam 比没有 seam 更坏**——它假装可替换，让调用方按"将来能换"的成本去设计，却拿不到对应收益。

按这个标准复核当前全部候选。**注意**：v0.3 四个 Feature 的三件套均标注 `SUPERSEDED PENDING REVIEW（2026-08-13）`、"不得作为开发输入"（`docs/reviews/product-experience-reset-plan.md` 第 7 节），因此下表不以 v0.3 Feature 文档为判定依据，只依据 PRD、架构文档与实际代码。

| 可替换点 | 判定 | 依据 |
| --- | --- | --- |
| Agent Adapter | **已是 seam** | 四个 Provider 同时在册，`index.ts:128-131` 装配，运行时按 `cli_provider` 选 |
| **执行世界（进程启动）** | **应开缝，见第 3 条** | 架构第 2 节承诺"替换 `WorkspaceContext` 的执行方式"；ADR 0006 要求 OS 级隔离才能并行只读。本机执行与沙箱/远程执行会**共存**（日常写操作走本机，并行只读 Node 走隔离环境），按 workspace/node 选 |
| `LongTermStateGate` | **收敛点，不是 seam** | 架构第 10 节的 pass-through(v0.1–v0.4) → 真实校验(v0.5) 是**顺序替换**，两者永不共存。所需的只是"所有长期状态写入走同一个函数"，不需要注册表 |
| Validation Policy | 维持函数形态 | 只有一种策略；`policy-gate.ts` 的确定性逻辑没有第二实现需求 |
| Repository / Storage | 维持现状 | 架构第 2 节"v0.7 换 Postgres 只需新增一套 Repository 实现"是**同构替换**（同一组方法换后端），没有运行时选择动作 |
| CLI 模式 / SDK 模式 | **装配，不是 seam** | 复用现有 HTTP API 或直接调 service 层；不产生同一能力的第二实现。所需纪律是架构第 8 节已有的"业务逻辑与 UI/传输层分离" |

### 3. 执行世界 seam：现在命名边界，触发信号到达时再提取

**Definition 的职责边界**（提取时按此设计）：拥有进程启动（`spawn` / `spawnSync`）、cwd 解析与 env 白名单三件事，即 dsh 的 `ctx.subprocess` 对应物。三个 adapter 从**自己起进程**改为**Consumer**，`WorkspaceContext` 从纯数据结构升级为携带执行能力的句柄（或额外传入执行器）。

**已知的 Provider 候选**：本机执行（现状）、容器/沙箱执行（ADR 0006 要求，用于并行只读 Node）、远程主机执行（架构第 2 节 v0.7 方向）。

**抽象必须容纳的三处真实差异**（否则会变成漏水的抽象）：

1. Windows 下 `.cmd` / `.bat` shim 解析为真实可执行文件（`claude-code-adapter.ts:88`）。
2. `shell:false` 且失败时**不回退** `shell:true`（`codex-cli-adapter.ts:187`）。
3. Claude 的 `PreToolUse` hook 依赖 spawn 时通过 `--settings` 注入本地文件路径（`claude-pretooluse-hook.ts`）——**远程 Provider 无法实现这一条**，因此 `AgentAdapterCapabilities.supportsApprovalHook` 必须能随执行环境变化，不能是 adapter 的静态常量。

**触发提取的信号（谁先到算谁）**：

- 第 4 个 adapter 落地（当前最可能候选：把 DeepSeek Harness 的 `headless` profile 或其 ACP stdio 接口接成 adapter）——因为它会再复制一份 spawn，提取成本随 adapter 数量线性增长；
- ADR 0006 的并行只读 Node 真正进入实现。

**现在不提取的理由**：PersonaHub 用户旅程正在重做（`docs/reviews/product-experience-reset-plan.md`），此时改动 runtime 会与产品重置撞车；且当前只有本机一个 Provider，提取出来的缝无法被验证真能剖开。

### 4. 明确不做的事

**本决策不包含任何立即执行的重构任务。** 不改名、不挪目录、不把 `AgentAdapter` 拆成独立包；第 3 条的执行世界提取按其触发信号推进，不在本决策中排期。adapter 体系在这里的角色是**范例**，不是被改造对象。dsh 之所以需要 227 个包和一个 DI 容器（Cordis），是它要同时交付 web / headless / CLI / SDK 多种产品形态所致；PersonaHub 当前只有一种形态（本地 Web 工作台），引入插件容器会把 v0.3 的进度换成基础设施。

**引入运行时插件容器的触发条件**：出现第二个真实的产品形态（例如无 UI 的定时后台运行，或某个 Issue Type 需要完全不同的工具集与装配）。在此之前只用命名约定，不用容器。

## 已知未闭合项

`server/src/runtime/provider-metadata.ts` 存在三张按 `CliProvider` 封闭的表：

```text
PROVIDER_SUPPORTED_AUTH_TYPES   :11   Record<CliProvider, AdapterAuthType[]>
PROVIDER_DEFAULT_COMMAND        :17   Record<CliProvider, string>
PROVIDER_CAPABILITY_DESCRIPTION :23   Record<CliProvider, string>
```

按上面第 1 条，这些是 provider 的自述属性，本应挂在各自 adapter 的 `capabilities` 上；现在它们住在 Definition 侧，意味着**加一个 provider 除了写 adapter 还必须回来改这三张表**，`Record<CliProvider, …>` 的穷尽性检查会强制这件事发生。

**当前不修**。该文件头部注释记录了这么做的理由——避免"哪个 provider 支持什么"出现第二份拷贝，`AdapterConfigService`（验证）与 `runtime/auth-material.ts`（env 注入）共享同一份真值。在只有 3 个 provider 时这个取舍划算。

**触发修改的信号**：新增第 4 个 provider 时（当前最可能的候选是把 DeepSeek Harness 的 `headless` profile 或其 ACP stdio 接口接成一个 adapter）。届时第一步就是把这三张表拆进 `AgentAdapterCapabilities`。

这与第 3 条的执行世界提取是**同一个触发信号下的同一件事**：`PROVIDER_CAPABILITY_DESCRIPTION` 里"Claude 有 PreToolUse 前置拦截、OpenCode 没有"这类描述，在执行环境可替换之后就不再是 provider 的静态属性——同一个 Claude adapter 跑在远程执行器上时拿不到 `--settings` 本地文件注入。两处一起改，不要分两次。

## 后果

- **收益一**：新代码有了一道可回答的判断题，且第一次把 seam / 收敛点 / 装配三者分开——此前它们都被笼统称为"扩展点"。按新标准复核的直接结果是**砍掉了一个原本会做的 seam**（`LongTermStateGate` 降为收敛点）。
- **收益二**：执行世界这条已写进 v0.7 路线的替换，有了明确的开缝位置（进程启动）、Provider 候选清单、必须容纳的三处差异，以及"谁先到算谁"的触发信号，不再是架构第 2 节里一句没有落点的承诺。
- **成本**：一份文档，零代码改动。第 3 条的提取工作量随 adapter 数量线性增长，因此触发信号刻意设为"第 4 个 adapter 落地"而非某个版本号。
- **不承诺**：本决策不声称 seam 化能带来性能、可测性或架构上的普遍收益。它唯一保证的是**替换成本可预测**——已知会出现共存实现的地方，替换时不用改调用方。
- **不引入插件容器**：见第 4 条。命名约定与运行时 DI 容器（如 dsh 的 Cordis）是两件事，本决策只采纳前者。
