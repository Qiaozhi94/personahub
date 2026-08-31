---
topics: [decision, memory, provenance, stance, research, scope-control]
doc_kind: decision
status: accepted
created: 2026-08-30
---

# 0013: Memory 的借鉴边界——抄它的失败记录，不抄它的架构

## 背景

`zts212653/clowder-ai` 在记忆系统上投入极深：`docs/architecture/` 下有记忆思想纲领、系统全景、检索管线深潜和两份事故复盘，另有二十余个 Feature（F102、F152、F186、F200、F209、F221、F227、F231、F255、F256、F260、F263、F271、F281、F282、F287 等）。它把记忆定义为「共同成长的代谢器官」，不是工具箱里的一件工具。

使用者提出希望**全盘借鉴**这套设计。本决策是核查后的答复。

结论是**不全盘借鉴**，但理由不是「太复杂」或「我们不需要」——而是**按它自己的账本，这套系统的写入侧与效用侧尚未闭合**。同时，它最有价值的部分恰恰不是架构，而是用真实事故换来的失败分类，那部分应当立刻抄。

### 核查一：它自己的闭环账本

`docs/architecture/memory-system-overview.md` 的「当前闭环账本（2026-08-04）」：

| 环节 | 它自己的判定 |
| --- | --- |
| 检索与下钻 | ✅ 基本闭 |
| Typed truth + revision | ✅ 主链闭 |
| F281/F282 生产与反馈基础 | ✅ 工程闭 |
| F287 Cue Plane | main + Alpha UAT 闭；**production dormant/unverified** |
| F271 session-close | ✅ 有真实产物 |
| F271 daily | 🟡 **尚无合法 daily outcome** |
| F152 durable supply | ❌ **产品链未闭**（external bootstrap 写 project collection，distillation route 读 root store，generalizable mark 返回 404） |
| F256 search guidance | 🟡 health 闭 / **utility 未闭，`follow/use` 仍为零** |
| F263 lifecycle | 🟡 D1 未闭 |
| 通用 soft-forget | ❌ 未立项 |

`follow/use = 0` 是最关键的一条：**它至今没有证据证明这套记忆真的被消费了**。

### 核查二：写侧尸检 12 条路径 9 条红

`docs/architecture/memory-write-side-autopsy-2026-07.md`，其 operator 的原话是「先不着急实现，把写的那侧来个解剖尸检大报告！没准烂的比你想的更多」。结果：

```text
A1  EntityRegistry 供给   🔴 词表死于出生日
A2  画像 / primer 更新链   🔴 三重分裂，生效副本旧于真相源
A3  taste lane vignette   🔴 close 后 35 天零新增
A4  event memory          🔴 写入工具从未实现
A5  distillation 晋升链    🔴 批准物直写生成索引，且会被 rebuild 删除
A7  日记本                 🔴 private 双盲
A8  zero-hit query 记录    🔴 零设施
A9  关系词典               🔴 per-cat 私产 + 全套拓扑病
A10 digest / summary 链    🔴 失败三处静默
A6 / A11 / A12            🟢
```

也就是说：**读侧机器完备地运转，写侧大面积失灵。**这个不对称本身是本决策最重要的输入——一个记忆系统看起来完整，可能只是因为读的那半做完了。

### 核查三：stance collapse 事故

`docs/architecture/cloud-memory-stance-collapse-postmortem-2026-07.md` 记录了一起云端记忆把语用身份压平的事故，其一句话结论是：系统把「聊过、帮领导交付过、为了批判引用过」的概念压缩成「用户认可的观点」，再以高权重记忆喂给模型。

它给出的五条判别：

```text
提到过     ≠ 认可
改写过     ≠ 信仰
帮领导写过 ≠ 我们家的理论
更好听的替代表述 ≠ 用户自己的观点
没有 origin / stance / status / scope / evidence 的摘要画像
   → 会把脏语境熬成高权重假事实
```

## 决策

### 1. A 档：立刻采纳，成本近零

这三样不依赖 clowder 的任何实现，是可直接复用的判断工具。

**1.1 写侧五类病，作为新增写入路径的自检表**

| 病 | 断点位置 | 自查问题 |
| --- | --- | --- |
| 一、触发器缺失 | 写入从未发起 | 读侧完备，但写入侧有没有门？靠不靠自觉？ |
| 二、拓扑分裂 | 写到分裂的 store | truth / runtime / index 是不是同一份？有没有 sync 与 freshness 守护？ |
| 三、索引盲区 | 写了但检索面看不见 | 有没有整片区域在检索视界之外？ |
| 四、易失写入 | 写「成功」但活不过进程或重建 | 批准的产物会不会被普通 rebuild 删掉？ |
| 五、失败无观测 | 没写成但没人知道 | 有没有 `catch{continue}`、fail-open、只 log 不计数？ |

第五类对本项目最直接：`catch{continue}` 与 fail-open 是任何代码库都会自然长出来的写法。

**1.2 Memory 必须携带 `stance`，且与 `type` 正交**

采纳 stance collapse 的判别：**同一句话，来源不同则强度不同**。

`stance` 只有三个取值，回答「谁背书」：

| stance | 何时写入 | 含义 |
| --- | --- | --- |
| `claimed` | 成员在对话里给出的判断 | 未经核对的说法 |
| `verified` | 主张被独立验证通过；或两轮独立验证得出同一根因 | 有独立证据支撑 |
| `confirmed` | 用户明确确认（如批准基线变更、认可某条结论） | 人类背书 |

**`stance` 与 PRD 第 5 节已有的 `type` 是两个正交维度**，不可合并：

```text
type    project fact | decision | lesson | user preference | workflow note
stance  claimed | verified | confirmed
```

一条 `lesson` 可以是 `claimed`（某个成员总结的教训，未验证）也可以是 `confirmed`（用户确认过的教训）。把 `lesson` 塞进 `stance` 会让两个维度互相污染——这是本决策初稿的错误，已修正。

**但两个维度不是自由组合。** 有些类型的名字本身就蕴含了强度要求，组合出来会自相矛盾：

| type | 允许的 stance | 禁止的组合与理由 |
| --- | --- | --- |
| `project fact` | `verified` / `confirmed` | **禁 `claimed`**——未经核对的断言不是事实。「成员说这个模块没有并发问题」是一个说法，把它记成 fact 就是用类型名给它背书 |
| `decision` | `confirmed` | **禁 `claimed` / `verified`**——决定需要决策者。成员的建议不是决定；验证也不能替人做决定（本项目 P0 是完全手动指派，见 PRD 第 15 节修订记录） |
| `lesson` | 三者皆可 | 教训本质上是归纳与解释，可以先作为候选存在，后被验证或确认 |
| `user preference` | `confirmed` | 偏好只能来自用户本人 |
| `workflow note` | `confirmed` | 组内约定只能由人确立 |

也就是说，`claimed` 只允许出现在**本质上是主观判断**的类型上（当前只有 `lesson`）。客观断言（`fact`）必须有证据，行为（`decision`）必须有主体。

**写入时直接拒绝，不静默丢弃。** 违反上表的写入请求被拒绝，并记录一条拒绝事件（类型、被拒的 stance、来源、时间）。这是本决策 A 档第五类病（失败无观测）在自身上的应用——**我们自己的写入路径也不许 `catch{continue}`**。

被拒绝的内容不会丢失：它本来就在 Thread 与轨迹里有完整记录。**Memory 不是「所有说过的话」，是「经确认或高置信沉淀的长期知识」**（PRD 第 5 节原文）。想保留一个未验证的判断，就用 `lesson + claimed`，或者等它被验证后再入库。

**`stance` 可升级，但必须留痕。** 一条 `claimed` 后来被独立验证，应升到 `verified`；升级走 B 档的 revision 机制，不原地覆盖，需记录升级依据（哪次验证、何时、由谁触发）。否则「它什么时候变成 verified 的」无法回答，等于没有 stance。降级同理（例如支撑它的验证后来被推翻）。

没有 stance 的 Memory 会把「实现者说过 worktree 不满足隔离」和「这条已被独立验证」熬成同一条高权重事实。这与本项目的信源分层（design.md §4.2.4：机器事实与 Agent 的说法不混同）是同一条原则在记忆层的延伸——**问题不是要不要引入新概念，而是要不要在这里破例**。

**1.2.1 硬规则：`claimed` 不进验证类上下文**

> **`claimed` 强度的 Memory 不得进入任何验证类派工的上下文。**

理由是它绕开了已经堵住的两道门。本项目为「验证者不能看见实现者的自述」修了三道围栏：

1. 冷启动与上下文范围（ADR 0009、ADR 0012 第 4 条）
2. 关闭 agent 原生 memory（ADR 0011）
3. **本条**——否则实现者的自述会经由 Memory 绕回来，而且这次是以「项目事实」的身份进来的，比原话更有权威

不加这条会产生**证据洗白**：一句 `claimed` 的自述被下游任务引用，产出新结论，新结论又被沉淀——库里出现两条互相支持的记忆，根子上却是同一句没验证的话。

实现上：验证类派工装配上下文时，Memory 查询强制附加 `stance != 'claimed'`；被过滤掉的条数在派工记录里可见，不静默丢弃。

**1.3 生命周期词汇区分**

```text
active     当前可召回、参与任务
retired    可逆移出召回，保留 provenance / audit
forgotten  经授权删除或脱敏 payload
tombstone  证明它曾存在及为何不可再取回的最小审计事实，不偷偷保留 payload
archive    容器状态，不自动等于其中每条记忆被遗忘
```

最后一条与 ADR 0012 取消 Room 归档动作相互印证：容器状态与其内容的可召回性是两件事。

**1.4 四条硬边界**

- Producer ≠ truth owner：发现「这值得记」的一方，不等于有权批准它入库
- 索引 ≠ 真相源：投影可重建，重建不得改写 truth
- 观测 ≠ 干预：看见生命周期的模块，不顺手成为删除执行器
- Owner memory 不以模型权重作 truth store：provenance、纠正、授权遗忘在参数里执行不了

### 2. B 档：结构上采纳，实现按本项目规模

| 采纳 | 本项目现状 |
| --- | --- |
| typed truth + revision：每类记忆有 owner，可 conflict / replace / retire / forget | 无，需建 |
| 提议与批准分离 | 无；但与 ADR 0010「未支撑的主张显式在场」同构，可复用同一套交互 |
| 索引可重建、重建不改写 truth | 无 |
| provenance 零失真回原文 | **PRD 第 5 节已有**：`source_issue_id` / `source_thread_id` / `source_event_ids` / `author agent` |

B 档的实现规模按本项目的 SQLite 单用户形态定，不引入 clowder 的 lane / collection / projection 分层。

### 3. C 档：明确不采纳

| 不采纳 | 理由 |
| --- | --- |
| 14 层检索管线 | 规模与本地单用户形态不匹配 |
| Cue Plane（执行时主动投喂线索） | 它自己 production `dormant/unverified` |
| 主动写入（F271 daily） | 至今无合法 daily outcome |
| 向量检索 / pgvector | PRD 第 15 节明确：个人版第一阶段不上 Postgres/pgvector |
| 私人主动性、拟人身份 | PRD 第 5 节明确「**不做强拟人包装**」 |

### 4. 本项目的写入触发器是现成的——这是与 clowder 最大的结构差异

clowder 写侧三条红（A1 / A3 / A4）的共同根因是「触发器缺失」：记忆来自聊天，「这值得记吗」难以判断，只能靠自觉，于是 A3 在 lane 关闭后 35 天零新增。

**本项目不会踩这个坑**，因为记忆来自**有验收的任务**而非聊天，触发器由 ADR 0010 的主张生命周期天然提供：

```text
主张被独立验证通过   → decision / project fact
两轮验证同一根因     → lesson
用户批准了基线变更   → decision
用户拒绝了基线变更   → lesson（连同理由）
```

因此 clowder 花最大力气解决的问题（如何发现值得记的东西），本项目不需要解决；剩下的是「怎么存得对、怎么不腐烂」，那正好是 A 档与 B 档的内容。

**这条同时是一条约束**：Memory 只能由**已收敛的验收事件**触发，不得从对话里自动摘取。从对话摘取就会重演 stance collapse。

### 5. 明确不做的事

- 不为记忆引入独立的检索管线、向量库或 Cue 投影层。
- 不做「主动供给」——不在执行时自动把记忆塞进上下文。记忆的消费走与 Artifact / Evidence 相同的显式引用路径，受 ADR 0012 第 4 条的上下文范围约束。
- 不做跨 Space 的记忆共享。

## 已知未闭合项

**`stance` 的三个取值可能不够。** `claimed` / `verified` / `confirmed` 是按当前主张生命周期归纳的。ADR 0012 第 4 条允许用户把验证类的上下文改回「全部」，此时产生的验证结论既不是 `verified` 也不完全是 `claimed`——是否需要第四个取值（如 `contaminated`），等真实出现再定，不预先造。

**「记忆怎么被消费」只定了一条硬规则，其余未设计。** 第 1.2.1 条限定了 `claimed` 不进验证类上下文；除此之外，具体在哪一步、以什么形式把相关记忆呈现给用户或带进上下文，未定。这也是刻意的——clowder 的教训表明，读侧先做完会掩盖写侧的失灵。

**`type × stance` 白名单可能过严。** 当前只允许 `lesson` 带 `claimed`。若真实使用中出现「有价值但暂时无法验证的客观信息」（例如外部环境的观察），会被这张表挡住。届时的正确做法是新增一个类型（如 `observation`），而不是放开 `fact + claimed`——放开会让类型名重新失去含义。

**A 档的五类病检查表没有强制执行手段。** 它目前是一份判断工具，不是门禁。是否要落成 `npm run verify` 里的一条检查，等真的出现第一条写入路径再定。

## 后果

- **收益一**：避免了一次高成本的错误移植。按 clowder 自己的账本，被移植的核心部分（主动供给、Cue Plane、效用闭环）尚未在生产中验证，`follow/use` 至今为零。
- **收益二**：以近零成本获得一份用真实事故换来的失败分类。写侧五类病与 stance collapse 的五条判别，不依赖任何实现，可直接用作本项目的自检工具。
- **收益三**：明确了本项目相对 clowder 的结构优势——写入触发器由验收事件提供，不靠自觉。这条同时被写成约束（不得从对话自动摘取），防止优势被滥用成 stance collapse。
- **收益四**：`claimed` 不进验证类上下文这条硬规则，补上了上下文围栏的第三道门。前两道（冷启动、关闭原生 memory）堵的是直接通道，这一道堵的是**经由记忆的迂回通道**——它最隐蔽，因为泄漏进来时不像「某人的说法」，像「项目的事实」。
- **收益五**：`type × stance` 白名单让类型名重新可信。库里出现 `project fact` 时，它一定有证据；出现 `decision` 时，它一定有决策者。**类型名不再是自由文本标签，而是一条被写入路径强制执行的断言。**
- **成本**：B 档需要建 typed truth + revision 与提议/批准分离，是真实工作量；A 档接近零。
- **不承诺**：本决策不声称 A/B 档的采纳能让本项目的记忆系统好用。clowder 投入更深尚未拿到效用结论，本项目更没有理由预先声称有效。它保证的只是**不重复已知的失败模式**。
- **对 PRD 的影响**：第 5 节 Memory 需增加 `stance` 字段（与 `type` 正交）、说明触发器限定为验收事件、并记录 `claimed` 的读取限制。本决策不代改 PRD。

## 关联

- 后续：`docs/decisions/0016-memory-state-machine-and-provenance.md`（B 档的具体形状：状态机、来源包、归属列、边表、健康度；并闭掉本文「A 档五类病检查表没有强制执行手段」这条未闭合项——第五类落 lint 门禁）
- 依赖：`docs/decisions/0010-claim-evidence-structure.md`（主张生命周期即写入触发器）
- 依赖：`docs/decisions/0012-object-model-simplification.md`（Memory 的 Project / Space 归属）
- 依赖：`docs/decisions/0011-disable-native-agent-memory.md`（agent 原生 memory 是不受控的第二个记忆来源，须关闭）
- 约束：`docs/personahub-prd.md` 第 5 节 Memory
- 证据：`zts212653/clowder-ai` 的 `docs/architecture/memory-system-overview.md`、`memory-write-side-autopsy-2026-07.md`、`cloud-memory-stance-collapse-postmortem-2026-07.md`、`memory-philosophy.md`
