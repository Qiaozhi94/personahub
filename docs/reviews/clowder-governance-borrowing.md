---
topics: [clowder-ai, governance, eval, validation, closure, self-evolution, reference]
doc_kind: review
created: 2026-09-03
updated: 2026-09-03
---

# clowder-ai 治理层借鉴核查：四项候选

> **定位**：<a href="concept-mapping.md">`concept-mapping.md`</a> 管的是**概念与页面形态**
> （Artifact ≈ Evidence、Provenance Gate ≈ 审批中心、右栏 Inspector 结构等）。本文管的是
> **治理机制**——评估怎么立、结论怎么关单、能力怎么晋升。两份文件互补，不重复。
>
> **口径**：沿用 <a href="../decisions/0013-memory-borrowing-boundary.md">ADR 0013</a>——
> **先查 clowder 自己的账本，再判要不要抄**。判定不看它文档写得多好，看三件事：
> 有没有代码、有没有真实实例、它自己有没有在用。
>
> **不是产品判断的真相源**。本文只做参考核查与建议；进 PRD 的条目须走 PRD 修订流程，
> 已在第 7 节登记。

## 1. 快照坐标（两次核查）

| 轮次 | `.sync-provenance.json` | source commit | 文件数 |
|---|---|---|---|
| 第 1 轮 | `2026-08-27T06:35:32Z` | `d4acf4bd` | 7931 |
| 第 2 轮 | `2026-09-03T00:17:12Z` | `89b45210` | 8585 |

本地路径 `/root/projects/clowder-ai`，是**公开开源同步快照**（第 1 轮 `excluded_file_count: 11`），
不是完整内部仓。凡涉及"某目录不存在"的判断，均已同时用"零代码引用 + 零脚本校验"交叉验证，
这两条与同步排除无关。

四项候选（使用者 2026-09-03 提出）：

1. 元认知路由（评估标准可被质疑）
2. eval contract（harness 带退役信号）
3. verdict closure（复验才能关单）
4. skill 晋升门槛（L0–L4）

## 2. 结论总表

| # | 候选 | clowder 成熟度 | 判定 | 落点 |
|---|---|---|---|---|
| ① | 元认知路由（三信号加权） | 纸面，零代码 | **不借** | — |
| ①' | 评估标准可被质疑（归因分层 + 干预门） | **已落地，7 千行控制面里的一道硬门** | **借契约形状** | 产品（validation） |
| ② | eval contract 轻量四项（含 Sunset Signal） | 49 份 feature doc 在用 | **已落地 2026-09-03** | 流程（`checkEvalContract` + `docs/features/README.md`） |
| ②' | 重型指标出生证（9+ 字段） | 3 份实例 | **不借** | — |
| ③ | verdict closure（逐 finding 四态） | 已落地，有真实样本 | **借四态与闭环链** | 产品 + 流程 |
| ④ | L0–L4 五级阶梯 | 纸面，零产出 | **不借** | — |
| ④' | 回合 + 裁决（keep/tune/rollback/sunset/no_change/insufficient） | 已落地 | **借 `insufficient` 与 holdout 判据** | 产品（validation） |

一句话：**四项里没有一项能按原样抄。两项要换成 clowder 自己后来做出的替代品，一项只能抄轻量版，
一项直接可用。**

## 3. 8-27 → 9-03 的更正

> 单列本节的原因：第 1 轮的部分结论**已被第 2 轮推翻**。任何人只读到第 1 轮结论都会判错，
> 因此 delta 必须显式可见，不埋进正文。

### 3.1 这一周新增了什么

| 新增 | 内容 | 命中 |
|---|---|---|
| **F311** Capability Evolution Workspace（立项 2026-08-28，P0 双旗舰之一） | 自进化产品控制面，Phase 1–3 已合入 main | ①④ |
| **F313** Analysis-to-Outcome Closure Command | 分析结论→审批→真实修复→新鲜复验→回链原始信号 | ③ |
| **F312** Memory Initiative Closure Command | 记忆链路的同款闭环责任田 | ③ |
| **F314** Development Episode Alignment Experiment（2026-09-02） | 把自进化用在**开发流程本身**的单变量实验 | ①②④ |
| `packages/*/capability-evolution/**` | 约 **8.6k 行** TypeScript（含测试），含 `intervention-gate.ts` / `rubric-comparability.ts` / `attribution-explanation.ts` | ①④ |

### 3.2 逐条更正

| # | 8-27 结论 | 9-03 更正 | 更正依据 |
|---|---|---|---|
| ① | `rubric_reopen_trigger` **零实例**，只存在于 SKILL 与宪法文本 | **已成立为可执行门禁**。它是 `intervention-gate.ts` 19 个封闭 blocker code 之一，缺它就不放行写回 | `packages/api/src/infrastructure/capability-evolution/intervention-gate.ts`（260 行） |
| ① | 建议 PersonaHub「在 validation fail 时加第三个用户动作」 | **升级**为借三样：归因四层枚举 / `whyNotChange` 人话清单 / "放行证据不能自证" | 同上 + `attribution-explanation.ts` + `EvolutionAttributionPanel.tsx` |
| ① | 三信号路由与 E2「禁止单一总分」冲突 | **仍然成立**，且 clowder 自己也没实现它——落地的是"不信自证"（查 ref 归谁持有），不是"不信自报"（把信心量化） | `self-evolution/SKILL.md:250` 一字未改；`domain_reliability` 仍零 `.ts` 引用 |
| ② | 轻量契约 48 份 / Sunset Signal 42 份，无脚本门禁 | **基本没动**：49 / 43，仍无脚本门禁；重型出生证 2 → 3 例 | 重新计数 |
| ③ | 建议 PersonaHub 做 finding 级**三态** closure | **改为四态**，对齐 clowder 已落地的取值 | `friction-finding-artifact.ts:45` |
| ③ | — | **新增一条方法论教训**：闭环不能按 owner 拆成多条 Feature 线 | F313 Why 段 + operator 原话 |
| ④ | L0–L4 是「一张没开过账的表」 | **仍然成立**，一字未改、产出目录仍全部不存在 | 重新核查 |
| ④ | 结论「不借」 | **改为「不借这张表，借它的替代品」**：`insufficient` 一等结论 + holdout 污染判据 + 换尺必须 2×2 复判 | `capability-evolution.ts:53-61`、`rubric-comparability.ts` |

### 3.3 第 1 轮判错的原因（留给下次核查）

第 1 轮把「SKILL.md 里写了但没代码」直接读成「这个想法在 clowder 没落地」。**实际情况是它落地了，
但换了个名字、换了个 Feature、换了种形状**——这正是 `concept-mapping.md` 第 2 版开头写过的同一个坑
（"原判四项无对应是错的，其中三项 clowder 都有实现，只是不叫这个名字"）。

**下次核查的动作项**：核查一个想法时，除了搜它的原词，还要搜**它要解决的问题**在代码里的落点
（本轮的正确搜法是搜 `gate` / `holdout` / `comparability`，而不是搜 `domain_reliability`）。

## 4. 逐项分析

### 4.1 ① 元认知路由 —— 拆两半，一半不要，一半要

**不要的一半：三信号加权。** `cat-cafe-skills/self-evolution/SKILL.md:250` 定义
`domain_reliability = (successes+1)/(trials+2)` / `evidence_completeness` /
`self_reported_confidence`，高风险域 `action_confidence < 0.85` 只做分析不给结论。三条理由：

1. **与它自己的宪法冲突**。三信号如何合成 `action_confidence` 未定义，而 `eval-philosophy.md`
   的 E2 形状公理明令「禁止跨量纲相乘/加权成单一总分」。
2. **样本量不成立**。PersonaHub 本地单机，每个 adapter 的 `trials` 是个位数，Laplace 平滑在
   n<10 时基本等于先验——数字好看但不携带信息。
3. **PRD 已定死顺序**。trust scoring 属 v0.5+，前提是"先有 AgentOps metrics 和历史成功率数据"
   （PRD §7.5 Validator 角色边界）。倒过来做就是拿假想数据建门禁。

顺带记一笔：PersonaHub 的 Memory 三轴硬规则（`reference_count` 不得写入 `verified_at`、
不得提升 `stance`）**已经是"不信自报"的同一条思想，而且更硬**——clowder 是提示词，
PersonaHub 是写入白名单拒绝。

**要的一半：评估标准可被质疑。** clowder 把它做成了 Change Review 的唯一入口
（`intervention-gate.ts` 注释原文 *"the only door into Change Review"*）。缺任何一项 →
Program 留在 `observe` / `insufficient` 零审批车道，不产生可批准的写回。封闭 blocker 文案表节选：

```text
rubric_reopen_trigger_missing:  缺少 rubric reopen trigger：说不出"什么结果说明是尺子的问题"。
intervention_falsifier_missing: 缺少 intervention falsifier：说不出"什么结果算这次干预失败"。
promotion_holdout_contaminated: promotion holdout 已被 replay cohort 复用或被优化过程看过。
gate_evidence_not_owner_held:   这份放行证据由 F311 自持；干预授权不能自证。
```

**关键在于它换了思路**：从"不信自报置信度"（量化信心）换成**"不信自证"**（检查证据由谁持有）。
gate 全程不看任何分数，只看 ref 的 owner。

**给 PersonaHub 的三条**：

**(a) 归因分层枚举**（`capability-evolution-diagnosis.ts:19`）：

```ts
EVOLUTION_ATTRIBUTION_LAYERS = ['execution', 'harness', 'rubric', 'observation']
```

validation fail 可归到：代码写错 / 工具环境 / **验收标准本身错** / 证据没采到。一个四值枚举，
就把"第三岔"变成产品里可选的一个值。PersonaHub 现在 `validation.finding` 只有 severity，没有这一层。

**(b) `whyNotChange: string[]`——直接命中当前交互体验重构主线。**
`attribution-explanation.ts` 产出人话句子数组，`EvolutionAttributionPanel.tsx:137` 直接渲染。
实际文案（测试 fixture）：

> 「归因还没确诊（多层并列或证据无法区分），现在改就是碰运气。」

**"现在为什么还不动"是一等界面内容，不是空状态。** dogfooding NOTE-003/004/005 的共同根因是
"不知道现在该谁动、在等什么"；clowder 的 `hold_ball` 解了"在等什么"，这条解了"为什么不动"。
blocker code 是封闭词表、文案随 code 持久化，重启后重渲染同样的句子——这个做法本身也值得抄，
避免提示语散在组件里。

**(c) 放行证据不能自证。** PersonaHub 已有这条思想的一半——validator 独立性
（`cli_provider` / `default_model` 至少一项不同，否则标"同源验证"，PRD §7.5）。
扩到"谁能宣布 finding 关闭"是零新概念的延伸。

### 4.2 ② eval contract —— 性价比最高，唯一可以当天做的

**最有价值的发现不是契约本身，是同一想法的两个版本一死一活**：

| 版本 | 载体 | 实例数（9-03） |
|---|---|---|
| 重型指标出生证（`utility_claim` / `estimator` / `validity_bounds` / 四角色 / `calibration_runway` / `exhaustion_action` / 纵向触发契约…） | `cat-cafe-skills/eval-design/SKILL.md` | **3** |
| 轻量四项 | `cat-cafe-skills/feat-lifecycle/SKILL.md` 的 Eval Contract 门禁 | **49**（Sunset Signal 43） |

差别只有三点，值得逐字抄：

1. **只有 4 个字段**：Primary Users + Activation Signal / Friction Metric /
   Regression Fixture（1 条起，建议 2–5）/ **Sunset Signal**。
2. **条件触发，两问都 yes 才填**：会改变行为模式吗？+ 存在效用不确定、且有明确 consumer 的 claim 吗？
   并明令「不触发时不要创建空白或 N/A Eval 节」。
3. **Sunset Signal 空填 = 不通过，不设 reviewer 签字降级**（其 KD-4）。没有这条就退化成 N/A 农场。

一周新增 5 个 Feature、轻量契约只加 1 份，说明**它的采纳靠强制触发而非自发**——反过来印证
上面三条缺一不可。

**PersonaHub 落点**：流程层，不进产品。已于 2026-09-03 落地为
`tools/check-feature-gates.mjs::checkEvalContract`，规范见
<a href="../features/README.md">`docs/features/README.md`</a>「Eval / Tracking Contract（第 6 节条件子节）」。

实现时相对 clowder 做了三处收紧，都是为了让门禁**机械可判**而不依赖 reviewer 记性：

1. **触发要显式声明**。clowder 靠 reviewer 按两问判断；PersonaHub 要求 frontmatter 写
   `eval_contract: required | exempt`，`exempt` 必须附具体理由（沿用 clowder `tips_exempt` 的形状）。
   门禁判不了「效用是否不确定」，但能强制这个问题被回答一次。
2. **绑定在 Design Gate，不在立项**。`draft` 可不声明——用户场景没定稿时写出的契约是虚构的；
   `ready-for-development` 起声明与内容都必填。但 draft 若写了子节，四字段照样全校验：
   半填的比不填更糟。
3. **`gate_version: 0` 不追溯**（F001-F008 历史批次）。

保留的两条原样照抄：**退役信号空填即不通过、不设签字降级**（KD-4），以及**不触发时禁止写空节或 N/A**。

**现成的思想钩子**：`concept-mapping.md` §2.1.1 引的 multica 反面证据——迁移 058 删掉
`autopilot.project_id`，注释写明 "never exposed in the UI"，进而写进 PRD §15
「预留没有消费者的字段就是下次要删的东西」。**Sunset Signal 就是这句判断的可执行版本。**

**本地化三点**：

- 触发条件改写。clowder 是"harness / skill / MCP / shared-rules 类"；PersonaHub 的对应物是
  "改变用户旅程或 agent 行为的 Feature"。
- **必须按条件触发抄**。PersonaHub 现在只有 4 个 active Feature，没有 49 份文档的规模效应；
  变成全员必填第一天就是 N/A 农场。
- 加一条 clowder 没有的：Sunset Signal 在 `docs/features/releases/` 收口摘要里**复检一次**，
  否则它自己就是个没有 consumer 的字段。

**F314 附带的一条做法**（第一个把出生证用在开发流程本身的 Feature）：

> Baseline window 冻结为 kickoff 至 anchor PR 合入前；窗口内复用既有记录，
> **缺失部分保持 typed `insufficient`，不补造样本**。

"缺的就标缺"正是 `dogfooding-bugs.md` 里"回归测试 `—`"该有的处理方式：合法的 typed 缺失，
而不是空格。

### 4.3 ③ verdict closure —— 借四态与闭环链，不借控制面

**clowder 的两层实现**：

- **case 级**（F266，done 2026-07-19）：11 态 canonical lifecycle
  （`reeval-closure-schema.ts:6-18`：`open / acknowledged / action_planned / fix_landed /
  main_landed / live_active / monitoring / reeval_pending / resolved / suppressed_with_reason /
  escalated`）+ append-only 事件日志 + 幂等 reconciler + SLA 只升级一次 + 权限边界
  （自动化不许 merge / fix / suppress）。`reeval-*.ts` 约 1.6k 行 + hub projection 约 1.3k 行。
- **finding 级**（F313 Phase B，已合入 main）：
  `friction-finding-artifact.ts:45`

  ```ts
  analysisDisposition: z.enum(['repair', 'no_repair', 'observe', 'insufficient'])
  ```

  配 `friction-repair-target-resolver.ts` 把每条 finding 解析到可信修复目标，解不出是 typed
  `blocked` 而不是空。

**值得搬的四条**：

1. **closure 只能来自三种来源**：后续复验通过 / 明确 accept 或 suppress / sunset。
   **"修了"这句话不算 closure。**
2. **`suppressed_with_reason` 是一等公民**——不处理也要留理由，不能静默消失。
3. **逐 finding 四态**，且 `no_repair`（看过了，有意不修）与 `insufficient`（证据不足以判定）
   必须分开。
4. **repair debt 与 cadence debt 是同一 case 的两类独立债务**，不能用一项的完成掩盖另一项。

**PersonaHub 现状对照**：

- Issue 级已有（validation pass → Done + 绑定 evidence summary，PRD §7.5 / §7.6），不用借。
- **缺口 A（流程层）——已于 2026-09-03 落地**：原先 `tools/dogfood-bugs.mjs` 只校验了
  `open ⇒ 无 fix commit`，反向没有，`fixed` 不要求「回归测试」列非空。现在：
  `fixed` 必须同时有非 `—` 的回归测试与修复 commit；新增 `wontfix` 状态，必须在详情块写
  `不修理由`、且不得带修复 commit。**并且把 `npm run bug:log` 接进了 `npm run verify`**
  ——此前它只在有人手动敲时才跑，等于一条没有 consumer 的门禁，正是本文 §4.2 要防的东西。
  新增 21 条工具测试（`tools/dogfood-bugs.test.mjs`），已入 `test:docs`。
- **缺口 B（产品层，P1）**：`shared/src/types/validation.ts` 有 `ValidationFindingRecord`
  （`finding_index` / `latest_findings`），但 **finding 没有生命周期**。第 2 轮与第 1 轮的
  findings 怎么对齐、哪些重复、哪条是"带理由不修"，目前无对象承载；PRD §7.5 只写了
  "findings 成为下一轮修复输入"，`concept-mapping.md` §5.1 已把"哪些重复"放进中间栏，
  但没有数据结构支撑。

  最小切片：finding 四态 + closure 只能由下一轮 validator 对同一 finding 的判定驱动，
  或用户显式 `suppressed_with_reason`。**顺带修掉 PRD §7.5 一个更粗的问题**——轮次上限
  应该只数**未关闭的 blocking finding**，同一问题被重复报三次不该等于"三轮没修好"。

**一条方法论教训**（F313 Why 段，operator 原话）：

> 「想要把这件事情闭环的话，最好直接一个 Feature 来闭环，然后 link 其他的这些 Feat；
> 不然这个东西永远写不完。」

F313 明确说旧设计的错误是：把"canonical truth 留在原 owner"误译成"实施也要拆成各自的
Feature 线"，结果**每条线都能局部完成，却没有任何一条的完成声明必须证明整条链走通**。

PersonaHub 的 F009 / F010 / F011 / F012 是同一种拆法——四条线各自可以"完成"，
但没有一条的验收必须证明"用户从派活到验证关单走通了"。**v0.3 重启时值得按这条重判：
留一个 Feature 持续对整条旅程负责，其余作为 linked contract。**

### 4.4 ④ skill 晋升门槛 —— 不借 L0–L4，借它的替代品

**L0–L4 的核查（两轮结论一致）**：

- `docs/episodes` / `docs/methods` / `docs/evolution-proposals` / `evals/` /
  `docs/scope-guard-log.md` —— 两次快照里**全部不存在**；
- 全仓无一份文档带 `level:` 或 `knowledge:` 块（除 ADR-015 与 F100 里的字段定义本身）；
- `scripts/` 下无任何晋升条件校验（只有 skill manifest / reference integrity /
  first-party surfaces 三类检查）；
- F100 Status 仍 `in-progress`，Phase 3 可观测层 blocked on F102。

**它是一张没开过账的表。**

**clowder 实际做出来的替代品**（`capability-evolution.ts:53-61`）：

```ts
EVOLUTION_PROGRAM_STAGES = ['constituting','instrumenting','observing','evaluating','attributing',
                            'awaiting_intervention','awaiting_approval','writing_back','revalidating','deciding']
EVOLUTION_CYCLE_DECISIONS = ['keep','tune','rollback','sunset','no_change','insufficient']
```

**不是等级，是回合 + 裁决。** 晋升判据也换了，从"用了几次、成功率多少"换成两条不依赖样本量的条件：

1. **promotion holdout 必须 sealed 或 time-fresh，且未被 candidate/rubric 的选择过程看过**
   （F311 硬约束 7）。没有隔离证明即 `insufficient`；未声明是否被看过按未知处理、不放行
   （`holdout_exposure_status_missing`）。
2. **改了尺子必须做 2×2 复判**——`rubric-comparability.ts`（181 行）要求在同一冻结 cohort 上跑
   旧尺/新尺 × 旧候选/新候选四格，缺格即 `incomparable`，**拼接新旧分数永远禁止**
   （`spliceAllowed` 只在尺子没动过时为 true）。注释原文：*"a rubric that changed hands is a
   different ruler even if the asset id and version happen to match"*。

这两条比计数阈值好，且**绕开了"个人单机 trials 是个位数"的问题**。

**PersonaHub 现有设计在这一点上本来就更好**：Memory 用**正交三轴**
（`stance` × `verified_at` × `reference_count`）而不是线性等级。按 clowder 自己的 E2 形状公理
（多维保留向量、禁止压成单一总分），**正交三轴严格优于把成熟度/背书/使用量压成一个 `level` 标量**。
抄 L0–L4 是拿更差的形状换更好的形状。

**立刻可用的一条：把 `insufficient` 变成一等结论。**

现在 PersonaHub 的 validation 只有 pass / fail，第三次 fail 直接 Blocked。加入 `insufficient` 后：

| 情形 | 结论 | 是否消耗轮次 |
|---|---|---|
| validator 拿不到证据 | `insufficient` | **否**，界面提示缺什么证据 |
| 归因层是 `rubric`（标准写错了） | 走标准修订 | **否** |
| 归因层是 `execution` 的真 fail | fail | 是 |

这一条同时修掉 PRD §7.5 把三种完全不同的失败压进同一个 `round_limit_reached` 出口的问题。

**其余不借**：use_count 阈值、90% 成功率（样本量不足 + PRD 已把 AgentOps metrics 定为前置）。
时机也不对——PersonaHub 的 Skill 目前是 P2（`Skill candidates from Done Issue`，candidate only，
不参与执行），**现在做晋升门槛是给一条还没有产出的管道装闸门**。

## 5. 明确不要抄的东西

| 不抄 | 理由 |
|---|---|
| 三信号加权成 `action_confidence` | 与 E2 冲突；样本量不足；clowder 自己也没实现 |
| L0–L4 线性五级阶梯 | 零产出；且现有正交三轴更优 |
| 重型指标出生证（9+ 字段） | 两年 3 例，自己就没扩散 |
| F266 的 11 态 + reconciler + SLA 值班 | PersonaHub 是本地单进程 SQLite，无多域 registry、无轮值 owner；Inbox 在 PRD 里排到 v0.4+ |
| F311 控制面本体 | 8.6k 行 + 13 条硬约束 + 一整张 Owner Matrix |

**F311 自己的两条硬约束就是给我们的警告**：

> 硬约束 11：不造玩具纵切片，也不把普通 bug 包装成自进化；确定契约/运行健康问题按机制选择
> 直接进 canonical owner 的 test/guard/telemetry 修复线。
> 硬约束 12：Phase 只按终态能力器官拆，不按首个对象或依赖 bug 拆。

它的 v4/v5 两次被 operator 用"脚手架"拉闸重排 Phase，就是没守住这两条的代价。

**PersonaHub 要取的是契约形状（枚举、blocker 文案表、gate 判据），不是控制面。**
本文每条建议都能落在"一个枚举 + 一段文案表 + 一个校验函数"的量级；一旦开始想
"我们也要一个 Program 控制面"，就是踩进 clowder 自己被拉闸两次的坑。

## 6. 建议执行顺序

| 优先级 | 项 | 层 | 规模 | 开发冻结影响 |
|---|---|---|---|---|
| ~~立刻~~ **已完成 2026-09-03** | ② 轻量 Eval Contract 门禁（4 项 + 条件触发 + 空填拒绝） | 流程 | `checkEvalContract` + 15 条门禁测试 + README 规范 | 不受影响（tooling/文档，非业务代码） |
| ~~立刻~~ **已完成 2026-09-03** | ③-A bug log「复验才能关单」+ `wontfix` 带理由 | 流程 | 校验规则 + 21 条工具测试；并把 `bug:log` 接进 `verify` | 不受影响（tooling/文档，非业务代码） |
| 进 P1 设计 | ④' validation 结论加 `insufficient`；只有 `execution` 类 fail 消耗轮次 | 产品 | 枚举 + 状态流转 | 仅设计层 |
| 进 P1 设计 | ①' 归因四层 `execution / harness / rubric / observation` | 产品 | 一个枚举 | 仅设计层 |
| 进 P1 设计 | ①'' `whyNotChange` 人话清单 + 封闭 blocker code 表 | 产品 | 文案表 + 渲染 | 仅设计层 |
| 进 P1 设计 | ③-B finding 四态 `repair / no_repair / observe / insufficient` | 产品 | finding 表 + 事件 + 两个 UI 状态 | 仅设计层 |
| 不做 | ① 三信号加权、④ L0–L4、②' 重型出生证 | — | — | — |

**开发冻结（2026-08-12，见 `BACKLOG.md`）仍然生效**：产品层四项只能推进到设计层，不写业务代码。

## 7. 影响面登记（本轮只登记，不修改）

| 受影响对象 | 影响 |
|---|---|
| `docs/personahub-prd.md` §7.5 Agent Validation Loop | validation 结论枚举加 `insufficient`；归因分层；轮次预算只由 `execution` 类 fail 消耗；`round_limit_reached` 拆分 |
| `docs/personahub-prd.md` §5 Validation Policy | 「标准本身可被质疑」需要有承载字段 |
| `docs/features/README.md` + `tools/check-feature-gates.mjs` | spec §6 新增条件必填子节 |
| `docs/reviews/dogfooding-bugs.md` + `tools/dogfood-bugs.mjs` | 表头与校验规则 |
| `shared/src/types/validation.ts` | `ValidationFindingRecord` 加生命周期字段 |
| v0.3 Feature 拆分方式 | F009–F012 是否留一个 Feature 对整条旅程负责（见 §4.3 末） |
| <a href="product-experience-reset-plan.md">`product-experience-reset-plan.md`</a> 第 7 节 | 上述 PRD 级改动应登记进「需要重新评估的现有文档」 |

**产品级修改须走 PRD 修订流程**，惯例见 <a href="concept-mapping.md">`concept-mapping.md`</a> §7.3。
