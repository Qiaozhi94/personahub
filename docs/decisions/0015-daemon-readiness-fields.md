---
topics: [decision, runtime, daemon, data-model, evidence, scope-control]
doc_kind: decision
status: accepted
created: 2026-08-31
---

# 0015: daemon 化的提前准备——现在只加字段，不动运行时

## 背景

使用者在对照三个项目的对接方式后提出：v0.7 如果要加 daemon 能力，现在最好提前做什么。

三者的对接方式核查如下：

| 项目 | 执行发生在哪 | 靠什么对接 | 能否远程 |
| --- | --- | --- | --- |
| multica | 装了 daemon 的那台机器 | 云端 + 每台机器跑 `multica` daemon CLI；桌面端 `apps/desktop/src/main/daemon-manager.ts` 管本机 daemon 的启停、profile、健康端口与鉴权；运行时页按**电脑**分组 | 是，天生多机 |
| clowder-ai | API server 所在机器 | 服务内直接 spawn（`CodexAgentService`、ACP client 等） | 否。`API_SERVER_HOST=0.0.0.0` + `CORS_ALLOW_PRIVATE_NETWORK` 放开的是**界面访问**，不是远程执行 |
| PersonaHub | API server 所在机器 | 三个 adapter 各自 `import { spawn } from "node:child_process"` | 否 |

PersonaHub 走的是 clowder 那条路。但和 clowder 不同，daemon 化在 `docs/personahub-architecture.md` 第 2 节是**已写进基线的 v0.7 演进路径**，`docs/decisions/0008-capability-seam-convention.md` 第 3 条还专门命名了「执行世界 seam」并列出了远程主机执行这个 Provider 候选。

也就是说，问题不是「要不要做」，而是**现在做多少**。

### 核查：现状的四个约束点

1. **`AdapterConfig` 没有机器维度。** `shared/src/types/index.ts:263` 的字段是 `project_id` / `cli_provider` / `command` / `args` / `auth_type` / `model_provider` / `api_key`（投影为 `has_api_key`）。没有 host、没有 endpoint、没有 runtime id。adapter 在**类型层面**就只能指向本机。
2. **Run 的身份快照不含执行位置。** `AdapterIdentitySnapshot`（`shared/src/types/validation.ts:66`）是 `{adapter_config_id, name, cli_provider, default_model}`，冻结在每个 Run 上，并被 `evidence_summaries.implementation_identity_json` / `validator_identity_json` 落库（`server/src/repositories/evidence-summary.ts`）。它回答「这次是谁执行的」，但答不了「在哪执行的」。
3. **启动恢复依赖单进程假设。** `StaleRecoveryService.recoverStaleRuns()` 把所有 `running` 的 Run 一律转成 `interrupted` + `FailureReason.ServerRestarted`。这条规则的**唯一依据**是「新进程启动这一事实说明旧进程已不存在」。多实例下这条推断直接失效——另一台 daemon 上正在跑的 Run 会被本机重启误判为中断。
4. **明文 key 直接进 run input。** `AgentRunInput.adapterConfig.api_key`（`server/src/runtime/types.ts`）携带原始密钥，源头是 SQLite 的明文列 `agent_configs.api_key`（`server/src/db/schema-v6.ts:6`）。目前的实际消费点只有 `opencode-adapter.ts:118-122` 一处。

## 决策

**现在只做数据模型上的加字段，不动运行时代码。** 代码结构的改造按 ADR 0008 第 3 条已定的触发信号推进，本决策不提前它。

### 1. `AdapterConfig` 增加执行位置维度

新增 `runtime_id: string`，DB 列为 `TEXT NOT NULL DEFAULT 'local'`。v0.3–v0.6 期间这个值恒为 `'local'`，不产生任何行为差异。

**不留「未绑定」第三态。** 当前没有「这个配置不绑定任何机器」的概念，现在造出来就是预支一个没人用的语义。

### 2. `AdapterIdentitySnapshot` 增加同一个 `runtime_id`

在派工时把**实际执行位置**一起冻结进快照——注意是执行时的实际值，不是回查配置得到的当前值，配置改了历史记录不能跟着变。它以 JSON 形式落在 `evidence_summaries` 里，加字段不需要 schema 迁移；v0.3–v0.6 恒为 `'local'`。

同样**不可空**。理由见下方「为什么用 `'local'` 而不是 `null`」。

### 3. 「旧进程已死」这个推断收成一个具名函数

把 `StaleRecoveryService` 里的这条判断从扫描循环中提出来，写成一个单独的判定函数（例如 `isRunOwnerDead(run): boolean`），当前实现体就是 `return true` 并在注释里写明依据是单进程假设。不改行为，只把假设变成一个有名字、可被替换的点。

### 4. `api_key` 保持单一消费点

不加密、不换存储，但**不允许出现第二处读 `AgentRunInput.adapterConfig.api_key` 的代码**。新增 adapter 需要密钥时，通过同一条路径取。

## 理由

### 为什么这四条现在做，其余不做

分界线是**「能不能事后补」**：

- **代码可以重构，历史数据不能回填。** 第 1、2 条是加列/加字段，今天做是一列加一个默认值，所有查询不用改；等 Run 记录和 evidence summary 写满之后再加，历史行只能是空值——而这些恰恰是最需要解释的那批记录。
- **第 3 条不是重构，是给假设起名字。** 现在这条推断散在扫描逻辑里，读代码的人看不出它是个假设。写成具名函数之后，将来换成 owner fencing 只改这一个函数体，且改动点在 code review 里一眼可见。成本接近零。
- **第 4 条是纪律，不是代码改动。** 明文 key 跨进程/跨网络传递是 daemon 化时必然要处理的事；今天多一处读它的地方，将来就多一处要改传输方式。

### 第 2 条最容易被低估：它牵动「实现与验证不能同源」

PRD 第 7.5 节的独立验证约束，判定依据就是这两个 identity snapshot。daemon 化之后会立刻冒出一个产品问题：**同一个模型跑在两台不同机器上，算不算同源？**

不管答案是什么，它的输入结构里都必须有执行位置。如果等到 v0.7 才加这个字段，那时候要同时做三件事——重新定义 7.5 的语义、改判定逻辑、面对一批**无法回填**的历史证据。而历史证据不可回填这一条，意味着旧记录永远解释不了「那次验证到底独不独立」。证据链的价值在于事后能追，追不动就等于没有。

先把字段留出来，语义可以到 v0.7 再定。

### 为什么不现在抽 `ExecutionProvider`

ADR 0008 第 3 条已经答过，这里不重复论证，只重申其结论与触发信号：

- 当前只有本机一个 Provider，提取出来的缝**无法被验证真能剖开**；
- 触发信号是「第 4 个 adapter 落地」或「ADR 0006 的并行只读 Node 进入实现」，谁先到算谁；
- 抽象必须容纳的三处真实差异（Windows `.cmd` shim 解析、`shell:false` 不回退、Claude `PreToolUse` hook 依赖本地文件路径注入）在提取时一并处理。其中第三条直接说明了远程 Provider 做不到什么，因此 `AgentAdapterCapabilities.supportsApprovalHook` 届时不能再是静态常量。

本决策不改变这个判断，也不提前它的时间点。

### 为什么不现在做 lease / heartbeat

`docs/personahub-architecture.md` 第 2 节已明确：lease / heartbeat / `runner_instance_id` 只是 v0.7 多实例 daemon 的**候选**设计，引入前必须另做 schema、owner fencing、时钟与恢复语义设计，不能视为当前保证。第 3 条只做「给假设起名字」，不越过这条线。

### 为什么用 `'local'` 而不是 `null`

起草时的初稿倾向 `null`，理由是「`AdapterConfig` 里可空字段多，风格一致」。这个类比是错的——那几个可空字段（`model_provider` / `api_key` / `auth_status_message`）都是**真会缺席**的东西，而执行位置永远存在。改判理由五条：

1. **`null` 的语义是「不知道」，不是「在这里」。** 这恰恰是本决策要消除的歧义。三态必须分得开：JSON 里**没有这个键** = 这条记录早于字段存在；`'local'` = 明确记录为本机；其他 id = 明确记录为某台远端。用 `null` 会把前两种合并，而它们的区别正是第 2 条存在的理由。
2. **仓库已有先例。** `server/src/db/schema-v6.ts:4` 的 `auth_type TEXT NOT NULL DEFAULT 'oauth'` 就是同类枚举维度的写法。
3. **SQL 三值逻辑会静默吃掉行。** daemon 化后第一个要写的查询就是「找出不在本机跑的」，`WHERE runtime_id != 'local'` 会漏掉全部 NULL 行，`NOT IN` 同理，且不报错。
4. **同源判定不能静默失效。** 「实现与验证不能同源」的比较若下沉到 SQL，`NULL = NULL` 结果是 NULL 而非 true——一条安全约束以「看起来通过了」的方式失效，是最糟的失败模式。这与 `docs/SOP.md`「结构性隔离与安全边界声明纪律」是同一条判断。
5. **UNIQUE 把多个 NULL 视为互不相等。** 将来若要 `UNIQUE(project_id, name, runtime_id)` 防重名，`null` 那版约束等于不存在。

### 落地顺序

第 1、2 条**同批落地**。两者虽然独立可用，但分两次改 `AdapterIdentitySnapshot` 会让 `evidence_summaries` 出现两种历史形状，而这份决策的全部价值就在于历史记录的可解释性。

### 不需要动的部分

事件传输不用提前处理。`ThreadEvent` 已带 `event_sequence`（`shared/src/types/index.ts:63`）做游标，架构第 2 节「事件本体与传输方式解耦，v0.7 换 WebSocket 或 daemon 内部 pub/sub 不改事件模型」的判断成立，现状不构成障碍。

UI 也不用提前改。设计稿的运行时面已按 **adapter 配置**分额度池（`ui-reference/personahub-draft/personahub-v3.1`；ADR 0012 第 2 条把配置定为携带认证、`base_url` 与可用模型的那一层），daemon 化后加一层「机器 × 配置」即可，multica 的运行时页是现成参照。现在就按机器分组只会多一层空壳。

## 影响

- `shared/src/types/index.ts` 的 `AdapterConfig` 与 `shared/src/types/validation.ts` 的 `AdapterIdentitySnapshot` 各增一个字段；`agent_configs` 增一列。两处都是可空/有默认值的加法，不影响现有查询。
- `server/src/services/stale-recovery.ts` 提出一个具名判定函数，行为不变。
- `docs/personahub-architecture.md` 第 2 节的 v0.1→v0.7 对照表中，「Workspace 锁」与「Agent Runner」两行需要补一句指向本决策，说明哪些字段已经提前留好、哪些仍是候选设计。
- 本决策**不产生**任何 Feature 级排期任务，也不改变 v0.3（F009–F012）的范围。

## 已知未闭合项

- 本决策只覆盖「远程执行需要哪些字段」，**不覆盖** daemon 自身的形态问题：进程如何安装与守护、本机与 daemon 之间用什么协议、鉴权怎么做、密钥如何下发到远端。这些在触发信号到达、`ExecutionProvider` 真正提取时一并设计。
- PRD 第 15 节把 v0.7（Runtime / Daemon / Self-host）列为方向性设想而非排期承诺。本决策不改变这一点，只是让「到时候能做」的成本不因为今天的省略而变高。

### 多设备的形态是「单一 server + 多端访问」，不是双向同步

**来源**：使用者 2026-09-02 提出两个真实痛点——公司做完 vibe coding 回家接不上之前的会话；几台设备上 Claude Code 的配置存在细微差别。

**判断**：这两条都指向多设备，但**不构成「同步」需求**，因此本决策的 daemon 路线不需要为它增加任何数据同步设计。三条理由：

1. **SQLite 双向同步在本产品里无解。** Run 有状态机（`running` / `interrupted` / `done`），两台机器各写一份时冲突没有正确答案；而 Artifact / Evidence 是要当证据用的，一次错误合并会让证据链不可解释。
2. **单一 server 保住了本决策第 3 条的推断。** `StaleRecoveryService` 的「新进程启动 = 旧进程已死」在多实例下失效（见「核查」第 3 条），这也是本决策不做 lease / heartbeat 的前提；**单一 server 模型下这条推断继续成立**，多实例 fencing 因此可以继续留在候选设计里。
3. **参照项目已经这么做。** multica 是「云端 + 每台机器跑 daemon」，运行时页按**电脑**分组（见上方对比表），不是把每台机器的库互相同步。

**因此「会话跨设备」不是同步 CLI 的原生 session。** ADR 0011 的方向是禁用 agent 原生记忆、由 PersonaHub 自己拥有上下文；换台设备打开的应该是同一个 Issue 的完整 Thread，在新设备上起一个新 Run 由 PersonaHub 喂上下文。原生 session 若也要跨设备恢复，等于把三个 CLI 的会话格式各抄一遍——与本决策第 4 条拒绝代管凭据是同一条判断。

**配置差异那一半不属于 PersonaHub。** 「限额显示样式」这类是各 CLI 自己的 settings 文件，归 dotfiles 工具（git / chezmoi / syncthing）。PersonaHub 只拥有 `agent_configs`（认证 / `base_url` / 可用模型 / 额度），而单一 server 模型下它本来就只有一份，不存在同步问题。若日后要做 CLI settings 的跨机一致，那是一个**插件**：它不写核心层真相源，缺失时核心链路照常（判据见 `0018-capability-library-and-packs.md` 第 7 节）。

### 明文 `api_key` 是多端访问的前置条件，不是可延后项

「核查」第 4 条记的是**本机**假设下的现状：`agent_configs.api_key` 是 SQLite 明文列（`server/src/db/schema-v6.ts:6`），直接进 `AgentRunInput`。当前的风险声明也是按本机写的——`ui-reference/personahub-draft/personahub-v3.1/docs/design.md` §3.5.1「把数据目录放进同步盘或 git 仓库等于把 key 一起同步出去」。

**一旦 server 要被第二台设备访问，这句话就不够了**：风险从「别把文件放错地方」变成「这台机器在网络上」。因此上一条的单一 server 形态**必须与密钥处理一起设计**，不能先开访问、后补加密。这一条与「本决策不覆盖 daemon 自身的鉴权与密钥下发」是同一个缺口的两端，届时一并解决。
