---
topics: [decision, plugin, extensibility, architecture, seam, scope-control]
doc_kind: decision
status: accepted
created: 2026-08-31
---

# 0014: 插件贡献点清单——先定「能插什么」，再谈「怎么插」

## 背景

使用者希望 PersonaHub 后续做到与 DeepSeek Harness 类似的**「一切接插件」**。为此调研了 dsh 和 clowder-ai 两个项目的插件实现机制，事实记录在 `../research/plugin-architecture-dsh-clowder.md`。

调研结论有一条是硬约束：**dsh 的「一切皆插件」不是加上去的能力，是运行时本身。** 它的插件框架 Cordis 从第一行代码就在——服务容器、`inject` 依赖排序、类型化事件、`ctx.effect()` 可逆注册，是整个进程的装配方式。PersonaHub 的 `server/src` 是常规的路由/服务/仓储分层 + `index.ts` 手工装配；把 Cordis 塞进来等于重写运行时的装配与生命周期，而不是加一个模块。

clowder-ai 的形态与 PersonaHub 同源（Fastify + 本地存储 + 单进程），它的答案是**声明式 manifest + 宿主逐项准入**：`plugins/<id>/plugin.yaml` 声明 config 和 resources，`PluginRegistry` 扫描校验，`PluginResourceActivator` 是四类资源的唯一激活路径，schedule 只能引用白名单 `factoryId` 而不能提供任意脚本。

### 核查：PersonaHub 当前的可扩展位置长什么样

在写清单之前对着代码逐项核实，结果如下（这是本决策的事实基础）：

| 位置 | 当前形态 | 证据 |
| --- | --- | --- |
| Agent Adapter | **真 seam**，运行时注册表 + 4 个 Provider，Consumer 无身份分支 | `server/src/runtime/adapter-registry.ts`；已在 `0008-capability-seam-convention.md` 核实 |
| Graph Definition | **模块私有 Map，无注册函数**，只有一条 `WGD_CODING_DUAL_REVIEW_V1`，只导出 `getDefinition(id, version)` | `server/src/runtime/graph/definitions.ts:120-133` |
| Node 输出契约 | **闭合字符串联合** `"findings_v1" \| "synthesis_v1"` + 一张查表 `OUTPUT_CONTRACT_SCHEMAS` | `server/src/runtime/graph/types.ts:10`、`instruction-builder.ts:13,71` |
| Workflow Template | **数据**，落 SQLite，`steps_json` 由 `WorkflowTemplateAdminService` 管理版本与激活 | `server/src/services/workflow-template-admin.ts` |
| Evidence typed ref | **单一收敛点** `parseEvidenceRef()`，`kind` 是闭合联合 `"event" \| "file_change_set" \| "unknown"`；构造侧是散在 8+ 处的模板字符串 | `server/src/services/evidence.ts:15-18,33`；构造侧见 `handoff-builder.ts:223`、`development-trace.ts:266` 等 |
| 路由推荐规则 | **导出的纯函数 + 模块常量**，关键词表 `MULTI_PERSPECTIVE_KEYWORDS` 硬编码在源码里 | `server/src/services/routing/rules.ts:18-31` |
| 验证策略 | **纯函数集合**，被 snapshot 参数化，无注册表无 key | `server/src/services/validation/policy-gate.ts`；ADR 0008 已判定「不是 seam」 |
| 执行世界 | **未开缝**，`WorkspaceContext` 是纯数据结构，6 处 adapter/protocol 各自 `spawn` | `server/src/runtime/types.ts:4`；ADR 0008 已核实 |

也就是说：**PersonaHub 现在有 1 个真 seam、2 个收敛点、1 个只差一个 `register()` 的私有注册表，其余都是硬编码。** 这不是缺陷，是当下正确的取舍。

### 张力

`../personahub-architecture.md` 把 MCP/A2A 协议层列在 v0.8「方向性设想」，且明确写了「v0.8 及以后不在本文档范围内……现在设计过细价值有限」；PRD 第 13 节把**「过度平台化」**列为明确风险。同时 v0.3（F009-F012）因 dogfood 暴露的用户旅程缺口已暂停，执行顺序以 `../reviews/product-experience-reset-plan.md` 为准。

在这个时点建一套插件框架，会同时踩中「过度平台化」和「为不存在的第二实现预先抽接口」两个已知坑。

---

## 决策

### 1. 现在只交付清单，不建插件框架

本决策的交付物是**下面第 2 节的贡献点清单**和第 3、4 节的准入公理，不是代码。

理由：dsh 那张「新行为归属位置」映射表的价值，**不在于它背后有 Cordis，而在于它把「插件能贡献什么」变成了一份可查、可评审、随实现更新的清单**。这份清单不依赖任何框架就能先存在，而且它本身会决定框架长什么样。反过来先建框架再找贡献点，必然造出半个 seam。

**建框架的触发条件（满足任意两条即可重新评估）**：

1. 出现第一个真实的、由 PersonaHub 之外的人编写的扩展需求（不是「将来可能有人要」）；
2. B 档贡献点中至少 3 个已经因为真实需求各自开出了 seam，装配点开始重复；
3. v0.4 非 coding 场景垂直切片落地，确认新 Issue Type 确实需要独立的执行环境或证据语义；
4. MCP 集成进入实际排期（当前在 v0.8）。

在此之前，**新增可替换点仍按 ADR 0008 逐个判断**：有第二 Provider 的真实需求就配齐三角色，没有就写成函数。

### 2. 贡献点清单

档位定义：

- **A 档（已开缝）**：已经是完整 seam，插件化时只需补一个外部装配入口，不改结构。
- **B 档（已收敛，待开缝）**：已有唯一收敛点或私有注册表，第二实现出现时按 ADR 0008 开缝，代价可控。
- **C 档（暂不开）**：无第二实现需求，或所属产品范围未定。列在这里是为了**明确它现在不是贡献点**，避免被顺手做掉。

| # | 贡献点 | 档 | 当前形态 | 开缝时的目标机制 |
| --- | --- | --- | --- | --- |
| P1 | **Agent Adapter**（新 CLI/模型提供方） | A | `AgentAdapterRegistry` + `AgentAdapter` 词汇 + 4 Provider | 已具备。补外部注册入口 + `capabilities` 词汇扩展即可 |
| P2 | **Graph Definition**（新协作图拓扑） | B | `definitions.ts` 私有 `Map`，单条目，无 `register()` | 把 `REGISTRY` 提升为可注入的注册表对象，Definition 由外部按 `id@vN` 注册；`getDefinition` 保持唯一读取口 |
| P3 | **Node 输出契约**（新 `*_v1` schema） | B | 闭合联合 + `OUTPUT_CONTRACT_SCHEMAS` 查表 | 契约 = { schema 文本, 解析器, 校验器 } 三元组注册；未注册契约在 preflight 阶段硬失败，不进执行 |
| P4 | **Evidence / Artifact typed ref 种类** | B | 构造侧已于 2026-08-31 收敛：`server/src/evidence-ref.ts` 唯一拥有 `REF_PREFIX_BY_KIND`，`buildEvidenceRef` / `parseEvidenceRef` 从同一张表派生 | kind 表现在是单点；出现第二个来源需要贡献 kind 时再把它做成注册表。F009 的 `artifact:` 是第一个真实的新 kind，届时改表一行 |
| P5 | **Workflow Template** | A（数据） | SQLite 记录 + `steps_json` + 版本/激活治理 | **已经是可扩展的，且不该做成代码插件**。插件若要贡献 workflow，产出的是模板数据，走既有 `WorkflowTemplateAdminService` 校验与审计 |
| P6 | **Squad 定义**（F012） | A（数据） | 尚未实现；设计上是静态 agent 分组 | 同 P5，数据不是代码。插件贡献 squad 模板即可 |
| P7 | **路由推荐规则** | B | 纯函数 + 硬编码关键词表 | 关键词表先外置为配置数据；规则本身有第二实现需求（非 coding 场景）时才开缝 |
| P8 | **验证策略 / policy gate** | C | 纯函数，被 snapshot 参数化 | ADR 0008 已判定不是 seam。**只有一种验证策略时不开**，参数化优先于插件化 |
| P9 | **执行世界**（workspace 执行方式） | C→B | `WorkspaceContext` 纯数据；6 处各自 `spawn` | ADR 0006 已承诺 v0.7 替换（容器化）。这是**已知会出现第二实现**的位置，开缝优先级高于本清单其他 B 档，但触发条件是 ADR 0006 的隔离验证，不是插件需求 |
| P10 | **后台任务 / 调度** | C | 有 `stale-recovery`、`validation-dispatch-scheduler` 等具体调度器，无统一注册表 | 参考 clowder 的白名单 `factoryId` 模型：**插件只能引用宿主注册的 factory，永不提供可执行脚本** |
| P11 | **MCP tools** | C | 未实现，v0.8 方向性设想 | 不在当前范围。届时按 clowder 的外部进程模型评估 |
| P12 | **UI 面板 / Inspector 视图** | C | 前端 `web/` 常规组件 | 本地单用户工具，无第三方 UI 扩展需求 |

**清单纪律**：改动这些位置的结构时，本清单随之更新——这是从 dsh「改动循环本身时，本映射随之更新」抄来的。清单过期比没有清单更糟。

### 3. 三条准入公理（来自 clowder，现在就生效）

即使还没有插件框架，这三条现在就应约束任何「外部可贡献」的设计：

**（一）声明不等于授权。**

> A plugin-declared contribution is a candidate resource, never proof of identity, installation, permission, health, or execution authority.

一份 manifest 说自己提供某能力，只是候选；宿主校验、准入、激活之后它才存在。对应到 P3：未注册的输出契约必须在 preflight 硬失败，不能「先跑跑看」。

**（二）单一激活路径。** 每类资源只能有一个写入口。clowder 的 `PluginResourceActivator` 一个类 1023 行，替代了「skill/mcp/limb/schedule 四个 ad hoc writer」。PersonaHub 若开 P2/P3/P4 任意一处，**不得为它单独开一条写路径**。

**（三）所有权元数据 + 失败局部化。** 任何外部贡献的记录都带来源标识，enable/disable 只动自己拥有的记录，跨来源冲突直接拒绝；单个来源坏掉只 skip 它自己并保留可见错误状态，不影响其余。clowder 的 `envClaims` 冲突检测和「候选先排序再准入」（保证扫描结果与目录遍历顺序无关）是可直接抄的实现细节。

### 4. 两条上下文纪律（来自 dsh，现在就生效）

**（一）agent 可见即已记录。** 任何进入 agent 执行上下文的内容都必须能从持久事件流重建。dsh 用运行时不变量断言这一点；PersonaHub 的对应物是 ThreadEvent 流和 F009 的 artifact provenance。**新增一项 agent 可见输入 ⇒ 必须新增对应的持久事件**，不允许贡献点绕过事件流直接注入上下文。这是插件不能偷偷污染 agent 上下文的唯一保证。

**（二）拦截点用 waterfall 语义。** 若将来出现「多方按序拦截同一决策」的扩展点（例如验证前置检查、派工准入），采用 dsh 的约定：监听器接收 `(...args, next)`，**策略型**在拥有决策权时可短路，**观察型必须调 `next()` 委托**。不要用无返回值的广播事件做策略——那会让「谁做的决定」不可追溯。

### 5. 明确不做的事

| 不做 | 理由 |
| --- | --- |
| 引入 Cordis 或等价插件框架 | 等于重写 `server/src` 装配与生命周期，代价与收益完全不成比例 |
| 同权限任意脚本插件 | clowder 在 F129 明确否决过；本地单用户工具没有沙箱，脚本插件 = 无限权限 |
| 远程 marketplace / 签名 / 安装信任链 | clowder 投入 K-2A~D 四个切片建成后**至今保持 dormant**，不暴露激活路由。这是三个 feature 的量 |
| 为清单里的 C 档预先抽接口 | ADR 0008：半个 seam 比没有 seam 更坏 |
| 把 P5/P6 做成代码插件 | Workflow Template 和 Squad 本来就是数据，做成代码插件是形态错配 |

---

## 后果

**正面**：

- 「一切接插件」这个诉求被翻译成了 12 个具名位置和 3 个档位，从此可以逐项评审、逐项排期，而不是一次性的架构豪赌。
- P4（typed ref 构造侧收敛）**已随本决策一并落地**：7 个文件 18 处模板字符串收敛为 `server/src/evidence-ref.ts` 的 `buildEvidenceRef(kind, id)`，与 `parseEvidenceRef` 共享同一张前缀表，round-trip 由单元测试守住。这个改动与插件无关也值得做，F009 加 `artifact:` 时直接受益。唯一未收敛的残留是 `validation/validator-envelope-contract.ts` 里面向模型的提示词文本仍写着字面前缀——那是模型契约的措辞，不应由代码派生。
- 三条准入公理和两条上下文纪律现在就能约束 F009-F012 的设计，不必等框架。

**负面 / 代价**：

- 短期内不会有「装一个包就多一个能力」的体验。这是刻意的：当前唯一用户就是开发者本人，改代码的成本低于维护一套插件框架的成本。
- 清单需要人工维护，过期风险真实存在。缓解手段是把它绑定到 ADR 0008 的判断流程——每次按 ADR 0008 决定「配三角色还是写函数」时，顺手更新本清单对应行的档位。

**复核触发条件**：第 1 节列出的四条触发条件满足任意两条，或 ADR 0006 的执行世界隔离验证落地（会直接把 P9 从 C 推到 A）。
