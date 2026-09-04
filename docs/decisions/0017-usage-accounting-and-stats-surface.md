---
topics: [decision, usage, token, cost, accounting, statistics, surface, quota]
doc_kind: decision
status: accepted
created: 2026-09-02
---

# 0017: 用量记账的口径与统计模块的形状

## 背景

v0.3 交互设计推进到「用量模块」时，出现的第一个问题不是画什么图，而是**按什么维度统计**。两个参考项目都按「智能体」统计，而本项目在 ADR 0012 里刚刚把这个对象取消掉了。

四条来自核查的事实：

1. **multica 与 clowder 的统计维度都锚在一个持久实体上。** multica 的 dashboard rollup 键是 `(bucket_date, workspace_id, agent_id, project_id, model)`（`server/migrations/084_task_usage_dashboard_rollup.up.sql`），前端主表是「智能体排行榜」（`packages/views/dashboard/components/leaderboard.tsx`、`locales/zh-Hans/usage.json` 的 `leaderboard.*`）；clowder 聚合到 `CatDailyUsage`，键是猫（`packages/api/src/domains/cats/services/usage-aggregator.ts`）。这两个维度之所以成立，是因为 agent / cat 是**可治理的对象**：读完排行榜可以去关掉它、换它的模型、改它的预算。排行榜的每一行都对应一个动作。

2. **本项目没有这个对象，且是刻意没有的。** ADR 0012 取消 Agent，执行单位改为 `adapter + 配置 + 模型 + 深度`；同一决策的第 5 条写明 **Squad 不产生持久身份，历史表现记在组合上**，理由是「用久了一个『架构师 Squad』就变成了一个成员，取消的固定角色会从后门回来」。因此照抄智能体维度会得到**一张每行都没有对应动作的表**，而按 Squad 归因会直接违反那条防护条款。

3. **订阅制下的「费用」不是账单。** clowder 的价表在 Kimi 条目上写了原话：subscription/OAuth 模式按额度计费而非按 token，这些数字是「按官方 API 价折算的等价成本」，*never present them as actual billing*（`packages/api/src/config/model-pricing.ts`）。multica 则用 `cost_usd_ticks` + `uncosted_*_tokens` 两半来处理「同一个桶里混着 provider 自报成本与本地估算」的情况，并在迁移注释里指出只 sum 权威侧会**静默低报**（`server/migrations/213_task_usage_authoritative_cost.up.sql`）。

4. **本项目当前零采集。** 三个 normalizer 都不解析 usage：`server/src/runtime/adapters/claude-code-normalizer.ts` 的 `ResultLine` 已经在读 result 行，却把 `usage` 与 `total_cost_usd` 丢掉；codex 与 opencode 的 protocol/normalizer 里 `token` 一次都没出现。所以这是一块**没有历史包袱、但也没有任何既有事实**的地方。

5. **原型把「用量面」做成了额度面。** `ui-reference/personahub-draft/personahub-v3.1` 的用量面通篇是「还能派几次」，而 ADR 0012 第 3 条新增 Runtime 时明确把**剩余额度**定义为 Runtime 的字段。也就是说额度当时被放错了地方，而真正的 token 账本一直不存在。

## 决策

### 1. 主维度是「去向」，不是执行者

| 层 | 维度 | 回答 | 可执行动作 |
| --- | --- | --- | --- |
| 主 | **Issue / Project** | 单个任务的实际消耗 | 判断该类任务是否值得继续、是否需要拆分 |
| 主 | **派工用途**（实现 / 验证 / 返工重试 / 上下文重传） | 消耗落在产出还是落在返工 | 调整验证策略、修改轮次上限 |
| 次 | **执行组合**（adapter × 配置 × 模型 × 深度） | 单价基准 | 派工前预估本次消耗 |
| 次 | **上下文范围** | 「只给结果」减少的 input 量 | 调整派工的默认上下文档位 |
| 事实字段 | 模型、adapter 配置、深度 | 计价与归池 | — |

**Token 在界面上拆成缓存命中 / 未命中。** 事实表已有 `input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_write_tokens` 四列，界面按两列呈现：**缓存命中** = `cache_read_tokens`（按折扣价计费）；**未命中** = `input_tokens` + `cache_write_tokens` + `output_tokens`。输出永远不进缓存，因此计入未命中——两列相加等于该行全部 token，与 KPI 的 Token 总量对得上。拆这一刀的理由是它对应一个可调的旋钮：resume 的键是（执行组合，Issue，上下文范围），命中率掉下来就说明冷启动发生了；而「上下文重传」这一类用途的未命中量，正是把上下文范围从「全部」收窄到「只给结果」能省下的上限。

**模型是计价键，不是归因单位。** token 单价只能挂在模型上，不记模型就算不出钱；但把它放主位没有价值——单用户本机场景下「opus 占 70%」在打开页面之前就知道，而看完之后唯一导向的动作（换个便宜模型）恰恰是本项目明确拒绝的：**换组合会改变结果质量，那是使用者的判断，不是系统省钱的手段**（原型 §3.4 已有此条，本决策沿用）。

**组合维度的正确用途是单价基准而非排行榜**：这个组合平均每次派工多少 token、多少钱，用于派工前给出预估。深度是 token 的主要驱动因子，这是组合三元组里唯一值得单独看的轴。

**按用途统计是本项目相对两个参考项目的增量。** 本项目已有 Dispatch、Graph/NodeRun、`validation_round_count`，因此能回答它们回答不了的问题：「38% 的 token 花在验证轮上，其中 78% 集中在三个没收敛的任务」。这类结论直接对应一个可改的设置，而排行榜不对应任何东西。

### 2. 三个口径分开呈现，永不相加

| 口径 | 是什么 | 归属 |
| --- | --- | --- |
| **额度** | 约束。上游给的时限额与周限额各用掉了多少、几时重置（见下方 2026-09-04 补记） | Runtime（ADR 0012 第 3 条），不进统计模块 |
| **订阅等价** | 按公开 API 价折算的等价成本，**不是账单** | 统计模块，必须标注非账单 |
| **实付** | 走 API Key 的 adapter 配置的真实支出 | 统计模块 |

走订阅的 adapter 配置跑掉的 token 不产生新支出、只消耗额度；走 API Key 的配置不消耗额度、但每个 token 都是真钱。把两者加成一个数字就同时谎报了两件事。

### 3. 成本来源分权威与估算，混桶时分开存

`cost_source` 取 `authoritative`（adapter / provider 自报，如 Claude Code 的 `total_cost_usd`）/ `estimated`（本地价表折算）/ 空。一个聚合桶里可能同时存在两种来源，此时**必须分别保存已权威计价的金额与仍待估算的 token 数**，读取侧报「权威 + 估算(未计价 token)」。这条直接抄 multica 213 迁移的结论，理由同样成立：只 sum 权威侧会静默低报，且不会报错。

### 4. 没回报就不计入，但存 NULL 不存 0；界面不为它造视觉语言

adapter 没有回报 usage 时，token 与成本列存 NULL，界面渲染成 `—`。

**不做**：不为「未计量」设 KPI、不在占比图里留一段、不在热力图上加第六种记号、不在明细表里排一行。这是本决策唯一一处**刻意偏离**本项目「未知不填 0、未计入单独成段」原则（V3.11 轨迹条）的地方，理由是：三个 adapter 里已确认 Claude Code 会回报，后续只会适配更多 CLI，为一个可能不出现的情况造一整套视觉语言，成本大于它防的问题。

保留 NULL 而不是 0 的成本是一列可空，收益是 0 与「没测到」在库里始终可分——这个区分一旦在写入时丢掉就再也补不回来。若日后未计量确实成规模，再补界面提示；那时数据是齐的。

#### 补记（2026-09-04）：额度只报上游口径，不折算成「还能派几次」

**本决策的结论不变**（额度属 Runtime、不进统计模块、三个口径永不相加）；变的是**额度在界面上长什么样**，因此在这里补记而不另开 ADR。

原表述是「当前还可派出几次 high」，落到界面上就是「剩 214 次 low ／ 42 次 high」——那是拿一个固定的深度换算系数从剩余百分比反推出来的整数。使用者提出不需要这个数字：**「我大概能评估出来，只需要给我时限额和周限额即可。」**

采纳，理由与本决策第 3 条同源：真实消耗按任务差异极大（同样一次 high，读三个文件和跑一轮全量验证不是一个量级），**反推出的整数带着一种它没有的精确感**。本决策已经引用 clowder 的原话要求订阅等价成本 *never present them as actual billing*——**把折算值呈现成计数，和把折算成本呈现成账单，是同一类错误**。

改为每份 adapter 配置报两行上游自己给的口径：

| | |
| --- | --- |
| **时限额** | 滚动窗口（例如 5 小时）的已用百分比 + 重置时间 |
| **周限额** | 本周已用百分比 + 重置时间 |

三条约束：**取更紧的那一个**作为「够不够」的判断依据；**重置时间必须给**（只有百分比时，「等一会儿就好了」判断不出来，而它决定这一刻是该等还是该换配置）；走 API Key 的配置两个都没有，写「不设上限 · 按 token 计费」，它的成本归统计模块。

告警阈值（20% / 10%）随之改口径：指的是两者中更紧的那一个的剩余量。深度换算系数不再出现在界面上——把它印出来只会让人拿它当真。

### 5. 额度不进统计模块

统计模块只回答「过去这段时间发生了什么」，全屏不出现实时数字。额度回到它的三个消费点：状态栏提醒、派工弹层的预估行、设置 · 运行时的配置（V3.21 起运行时不再是一级面，V3.24 起它按执行机器分 tab，见 design.md §3.5.4）。「因额度不足未执行」的记录留在自动化面，与「已执行但失败」分开记录的口径不变。

理由是口径隔离：统计模块有周期筛选，若同屏并列一个固定的实时余量，页面上就有两个时间口径的数字。

### 6. 统计模块的形状：无列表 + 两个 tab

本项目的页面已形成两类规律：**任务模块**是「列表 → 单个任务的 tab → tab 下内容 + 右框补充」，因为任务是实体，有实体就有列表；**记忆模块**是「无统一列表 → 三个 tab 信息页 → 每个 tab 下内容板块」，因为选的不是哪一条，而是看哪一类问题。

统计模块属于后者：

```text
统计（一级工作面）
├─ 用量 tab   KPI 四格 → 趋势卡 → 详情表（四个维度）
└─ 失败 tab   KPI 三格 → 失败构成 → 失败分布（按执行组合）
```

控件位置即作用域（照 multica `dashboard-page.tsx` 的语法）：**tab 行左边切视图、右边放页级筛选**（时间范围、项目），**每张卡自带自己的形态/维度切换**。

**第三级明细不在统计模块里造。** 点任务行跳回任务模块的**轨迹 tab**——那里已经逐条记着每次调用的 token 和「未计入」分段条。统计模块只负责聚合与入口。

**只做两个 tab。** 质量/收敛类指标（返工率、验证轮分布）当前完全落在「用途」维度里，不单开第三个 tab。

**详情表分页，但分页不得破坏对账。** 任务维度会长到上百行，按主指标降序每页 10 条。分页最容易翻掉的正是对账关系，因此**合计行置顶**：紧贴表头、不带页码、不随翻页变化，读者第一眼看到的是整个周期的总量，往下才是这一页的明细。不设「本页合计」——页内小计不回答任何问题，只是把表撑高。行数为个位数的维度（项目 / 组合 / 用途）不分页，但同样带置顶合计行：四个维度的每一列都必须能加回上方 KPI，这是本模块数字可信的唯一凭据。不使用「其余 N 个」聚合行代替：它点不动、不可下钻，只是为了让列能加起来而存在。

**指标不进状态列。** 任务行的「返工占比」是算出来的指标，必须独立成列并写明口径：**该任务 `step_kind='返工重试'` 的派工所消耗的 token ÷ 该任务全部 token**。分母是**拆分前的总量**（缓存命中 + 未命中），不排除缓存命中——否则命中率高的任务会显得返工更严重。按 token 加权后必须等于「用途」维度的返工重试占比。把它塞进状态列会得到一个既非状态、又无从核对来源的值——本决策的第一版原型犯过这个错。

### 7. 年度热力图是趋势卡的第三种形态，不是常驻横幅

GitHub 式热力图（53 周 × 7 天，0 单独一档 + 非零天四分位分四档，月份在上、周几在左、图例在右下）用于回答「这一年消耗怎么分布」。它挂在趋势卡上，由时间范围决定是否可用：

| 时间范围 | 可用形态 |
| --- | --- |
| 近 7 天 | 按天 |
| 近 30 天 | 按天、按周 |
| 近一年 | 按周、**热力图**（默认） |

不做成页首常驻横幅：那样它固定显示一年，而同屏 KPI 跟随周期筛选，页面上会并列两个时间口径的数字。挂在趋势卡上它自动跟随周期，不会打架。热力图跟随卡内已有的指标切换（默认 Token），形态 × 指标正交，不新增控件。

### 8. 一张事实表，不做 rollup

```text
run_usage   一行 = 一次 attempt × model
  attempt_id / run_id / dispatch_id / issue_id / project_id / account_id
  adapter / model / depth / context_scope / step_kind
  input_tokens / output_tokens / cache_read_tokens / cache_write_tokens   （可空）
  cost_micro_usd / cost_source / billing_mode / priced_at
  started_at / ended_at
```

**明确不抄 multica 的聚合层。** 它有 5 张 rollup 表 + pg_cron + dirty queue + 两个 backfill 命令，那是多租户 Postgres 的规模问题。本机 SQLite、单用户、一年几万行，直接 `GROUP BY` 加两个索引即可。这条与 ADR 0008 是同一个判断的两个方向：没有第二个 Provider 就不抽接口，没有规模就不建物化视图。

`project_id` 不做快照，join 现值。multica 快照后要处理重归因（迁移 084 的注释与 backfill 命令），个人项目里 Issue 换 project 极少，选简单那一侧。

### 9. 价表随代码走，历史行固化

价表带 `source` 与 `verifiedAt`（clowder 的做法）。**已写入的行保存当时算出的成本，不随价表变化重算**——否则改一次价表就改写了历史账。

## 不做什么

- **不做按 Squad / 按角色归因**（ADR 0012 第 5 条的防护条款）。
- **不做预算上限与自动降级。** 额度不足时停止执行并记录，不自动更换更低成本的执行组合。
- **不做多租户 rollup、cron 与 dirty queue**（第 8 条）。
- **不上传、不云端聚合。** 统计全部来自本机。
- **不在统计模块里做实时余量**（第 5 条）。

## 已知未闭合项

- **Codex CLI 与 OpenCode 是否回报 usage，未核实。** 实现前需要一次 probe，照 F004 codex final-message probe 的做法，产出「adapter × 能报什么」的能力矩阵。在此之前不得对外承诺三个 adapter 都有精确成本。
- **`step_kind`（实现 / 验证 / 返工重试 / 上下文重传）的判定规则未定。** 前三者可从 Dispatch 与验证轮推出，「上下文重传」如何与 `cache_read_tokens` 区分尚无定义——两者可能是同一批 token 的两种叫法。这一列的定义必须在实现前定死，否则占比图会重复计算。
- **订阅等价价表会漂移。** 官方价格变化时历史行不重算（第 9 条），因此跨长周期的「订阅等价」是分段价格的和，不是任一时点的重置价。界面不解释这一点。
- **日界与时区未定。** 本机单时区，暂按本机时区切日；热力图跨年时的周起点未定。

## 后果

- **收益一**：用量从「不知道该按什么维度看」变成一张事实表加四个 group by，可以直接排 Feature。
- **收益二**：「花在返工上多少」成为可回答的问题，且它对应一个可改的设置（验证策略）。这是本模块存在的理由——只能看不能动的账单不值得做。
- **收益三**：额度与账本分家后，两边的定位都清楚了：Runtime 管前瞻，统计管回顾。原型里那个既像账单又像余量的用量面消失。
- **成本**：三个 adapter 的 usage 采集要各写一遍，且各自格式不同；probe 是前置工作量。价表是需要人工维护并定期核对的静态数据。
- **不承诺**：本决策不声称统计数字精确。订阅等价是折算、估算成本来自静态价表、未回报的部分直接缺失。它承诺的是**口径不混**：实付、等价、额度三者永远不相加。
- **对 PRD 的影响**：第 15 节 v0.5 AgentOps 的 `cost` 指标需指向本决策的口径定义；埋点要求（v0.1–v0.3 前置事实）需补 `run_usage` 一项。本决策不代改 PRD。

## 关联

- 依赖：`0012-object-model-simplification.md`（取消 Agent、执行组合三元组、Runtime 承载剩余额度、Squad 不产生持久身份、上下文范围三档）
- 依赖：`0008-capability-seam-convention.md`（没有第二实现就不抽象——第 8 条的同源判断）
- 依赖：`0009-agent-session-lifecycle.md`（resume 键与冷启动，决定 `context_scope` 与 cache 行为）
- 约束：`0015-daemon-readiness-fields.md`（daemon 化后额度按「机器 × adapter 配置」分层，届时不影响本决策的账本侧）
- 约束：`../personahub-prd.md` 第 15 节 v0.5 AgentOps & Evaluation
- 证据：`multica` 的 `server/migrations/084_task_usage_dashboard_rollup.up.sql`（rollup 键与重归因成本）、`server/migrations/213_task_usage_authoritative_cost.up.sql`（权威成本与未计价 token 分半）、`packages/views/dashboard/components/dashboard-page.tsx`（控件位置即作用域、per-tab loading/empty、`dimsForDays`）
- 证据：`zts212653/clowder-ai` 的 `packages/api/src/config/model-pricing.ts`（订阅模式的等价成本不得呈现为账单）、`packages/api/src/domains/cats/services/usage-aggregator.ts`（按持久实体聚合）
