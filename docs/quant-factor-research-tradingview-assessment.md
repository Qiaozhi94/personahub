---
topics:
  [
    quant-research,
    factor-mining,
    backtesting,
    tradingview,
    architecture-assessment,
    product-extension,
  ]
doc_kind: review
created: 2026-09-04
updated: 2026-09-04
---

# PersonaHub 量化因子研究与 TradingView 回测承载能力评估

> 本文是专题评估与方案建议，不是产品范围、架构或 Feature 状态的真相源。正式产品判断仍以
> [`personahub-prd.md`](personahub-prd.md) 为准，架构和数据模型分别以
> [`personahub-architecture.md`](personahub-architecture.md) 与
> [`personahub-system-design.md`](personahub-system-design.md) 为准。本文中的建议只有经过确认并回写
> PRD、ADR 和 Feature Spec 后，才构成实施承诺。

## 1. 执行摘要

### 1.1 总体结论

当前 PersonaHub **可以承载“AI 协助量化研究”的任务编排和证据管理，但不能直接承载完整的因子挖掘与回测平台**。

合理的目标定位是：

> PersonaHub 负责研究任务编排、Agent 协作、实验记录、证据追踪和结果沉淀；专业研究计算引擎负责数据处理、因子计算与组合回测；TradingView 负责 Pine 策略展示、单标的验证和实时告警。

当前能力按场景判断如下：

| 场景 | 当前可行性 | 判断 |
| --- | --- | --- |
| Agent 提出因子假设、读论文、写 Python/Pine 代码 | 高 | 现有 Issue、Thread、Agent Adapter、Workspace 已能支撑 |
| 单因子、单品种、少量参数、人工操作 TradingView | 中 | 可作为验证性垂直切片，但需补实验与结果对象 |
| 多资产横截面因子、参数扫描、Walk-forward | 低 | 缺数据平面、计算任务、实验模型和批量分析界面 |
| 服务端提交 Pine 并自动拉取 Strategy Tester 结果 | 低 | 官方公开集成面未提供此通用链路，不应据此立项 |
| TradingView 作为单标的验证、展示和告警出口 | 中高 | Pine 导出、CSV 回流、Webhook 均有清晰落点 |
| 面向真实资金的自动交易 | 极低 | 当前无交易账户、订单、风控、鉴权、密钥治理和审计边界 |

### 1.2 三条必须提前冻结的架构边界

1. **Agent Run 与 Experiment Attempt 分离**：Agent Run 表达“哪个 Agent 接受了什么指令”；Experiment Attempt 表达“哪个固定实验配置在什么计算环境中运行并产生了什么结果”。
2. **SQLite 元数据与列式研究数据分离**：SQLite 保留为控制面；K 线、因子矩阵、持仓、成交和净值序列进入 Parquet/DuckDB 等研究数据层。
3. **PersonaHub 自有回测与 TradingView 验证分离**：TradingView 不作为因子挖掘和组合回测的唯一计算后端。

若这三条不先冻结，后续很容易把实验塞进 `runs`、把行情塞进 SQLite、把 TradingView UI 自动化误当成稳定 API，最终形成难以迁移的耦合。

## 2. 评估对象与事实边界

本次评估区分三种状态，避免把目标原型误认为已实现能力：

| 层次 | 当前事实 |
| --- | --- |
| 已实现产品 | `web/`、`server/`、`shared/`，当前 schema version 11，coding-first |
| 已实现编排底座 | Project / Workspace / Issue / Thread / Run / Validation / Graph Run / Node Run / Event / Evidence Summary |
| 目标形态设计 | `ui-reference/personahub-draft/personahub-v3.1/` 的静态交互原型，不是可交付 React 实现 |
| 规划中能力 | F009–F012 的 Artifact / Artifact-centered coding / Room / Squad，仍处于规格与设计阶段 |

目标原型自己也明确声明“不进 `web/`，不作为实现代码”，见
`ui-reference/personahub-draft/README.md`。因此本文对“当前能否承载”的判断以实际源码为底线，以 V3 原型判断未来交互方向是否合适。

## 3. 当前可复用能力

### 3.1 Project / Issue / Thread 适合做研究控制面

现有对象可以自然映射为：

| PersonaHub 对象 | 量化场景映射 |
| --- | --- |
| Project | 一个策略研究项目、市场或组合研究空间 |
| Issue / 任务 | 一个研究目标，例如“验证低波动因子在港股是否稳定” |
| Thread / 会话 | 假设、约束、指派、决策和结果解释的纵向记录 |
| Room / 协作现场 | 数据审计、因子研究、综合、实现、验证等阶段性协作 |
| Agent Run | 研究员、实现者或验证者的一次 AI 执行 |
| Artifact | 研究结论、因子定义、实验报告、Pine 脚本、验证报告 |
| Evidence | 命令、文件、数据版本、实验结果和外部验证的依据 |

这种映射符合 PersonaHub 当前“Issue 管理目标、Thread 保存过程、Evidence 验证结果”的产品判断，不需要推翻顶层对象模型。

### 3.2 Agent Adapter 与路由可以承担研究分工

Codex、Claude Code、OpenCode 已经作为真实 CLI adapter 落地。它们可以分别承担：

- 文献和策略思路调研；
- 数据清洗与因子代码实现；
- 回测结果分析；
- 数据泄漏和偏差检查；
- Pine Script 翻译；
- 独立验证。

现有 capability tags、显式用户确认、adapter identity snapshot 和同源验证约束，对研究场景仍有价值。尤其是“实现者与独立验证者分离”的原则，可以迁移为“因子实现与统计验证分离”。

### 3.3 Event、Evidence 与 Artifact 方向适合可复现研究

当前 ThreadEvent 具备稳定顺序、SSE replay 和 evidence refs；F009 又规划了 Artifact entity、immutable revision 和 pinned ref。这个方向特别适合量化研究，因为研究结论不能只指向“最新版”：

```text
factor:momentum@3
dataset:cn_equity_daily@2026-08-31
experiment:exp_01@2
backtest:bt_01@1
pine-strategy:tv_momentum@4
```

一个历史结论必须永久解析到当时使用的精确内容，而不是随着因子或数据更新漂移。F009 的 revision/CAS/hash/provenance 设计可以复用，见
[`features/0.3/F009-artifact-foundation-provenance/spec.md`](features/0.3/F009-artifact-foundation-provenance/spec.md)。

### 3.4 V3 成果面适合作为量化研究的外壳

V3 目标原型把主舞台定义为“现在做成什么样、可不可信”，并把任务、协作、产物、证据、记忆和执行计划组织在同一个工作台中。这个信息架构适合量化研究的决策过程。

可保留的结构是：

```text
任务列表
  -> 研究成果主舞台
  -> 任务会话 / 协作现场
  -> 数据、实验、产物与证据
```

但它只能作为壳，不能把净值曲线、IC、参数矩阵等全部压成 Markdown 或右侧详情栏。量化任务需要专门的主舞台 surface，详见第 8 节。

## 4. 现有架构无法直接承载的部分

### 4.1 当前 Run 不是实验

当前 `runs` 主要保存：

- Issue、Thread、Workspace；
- adapter config；
- instructions；
- queued/running/completed 等进程状态；
- exit code、error message、final message；
- role、workflow step、validation round；
- adapter identity snapshot。

它表达的是“一次 Agent 调用”，不是“一个可比较、可复现的量化实验”。

量化实验至少需要固定以下内容：

| 类别 | 必须固定的内容 |
| --- | --- |
| 数据 | 数据源、数据 snapshot、标的池、频率、复权、交易日历、时区 |
| 因子 | 因子 revision、依赖字段、参数、lag、缺失值策略 |
| 预处理 | 去极值、标准化、中性化、行业分类版本 |
| 回测 | 时间区间、调仓频率、权重、benchmark、成本、滑点、容量假设 |
| 计算 | 代码 commit、依赖锁文件、容器/虚拟环境、随机种子 |
| 输出 | 指标、净值、回撤、持仓、成交、日志、result hash |

如果把这些全部塞进 `instructions` 或 `ThreadEvent.payload_json`，短期可以演示，但后续无法可靠地：

- 比较两个实验；
- 搜索某个参数；
- 判断结果是否来自同一数据版本；
- 对失败任务断点恢复；
- 防止 Agent 文本自报结果；
- 重建历史实验。

因此需要独立的 `ExperimentSpec` 与 `ExperimentAttempt`，不能继续扩充 `runs` 使其兼任实验表。

### 4.2 当前 Issue 创建和验证仍硬编码为 coding

数据库虽然有 `issue_type`、Workflow Template 和 Validation Policy，但实际创建路径仍使用默认 coding workflow 和 coding validation policy，见
`server/src/services/issue.ts` 与 `server/src/db/schema-v1.ts`。

现有 validation evidence 重点是：

- handoff；
- file trace；
- test / lint / typecheck / build；
- 实现者与验证者身份。

量化研究的验证要求完全不同，至少包括：

- look-ahead bias；
- survivorship bias；
- selection bias；
- corporate action；
- 时间戳和交易日历一致性；
- 样本内 / 样本外隔离；
- 因子覆盖率和缺失率；
- IC、Rank IC、ICIR；
- 因子衰减；
- 分层收益单调性；
- 换手和交易成本；
- 参数稳定性；
- regime robustness；
- Walk-forward / rolling validation。

这不是增加几个 `accepted_verification_kinds` 就能解决，需要独立的 Quant Research Validation Policy 和输出契约。

### 4.3 当前 Graph Definition 与输出契约是 coding-specific

当前可执行图只有一条 `wgd_coding_dual_review`，节点是并发/一致性审查、契约审查和 findings synthesis；输出契约也是封闭的 `findings_v1 | synthesis_v1`，见
`server/src/runtime/graph/definitions.ts` 与 `server/src/runtime/graph/types.ts`。

量化研究需要新的节点和输出契约，例如：

```text
hypothesis_v1
dataset_audit_v1
factor_definition_v1
factor_exposure_v1
ic_analysis_v1
portfolio_backtest_v1
robustness_report_v1
pine_strategy_v1
external_validation_v1
```

ADR 0014 已把 Graph Definition、Node output contract、typed ref 列为待真实需求开缝的位置。量化垂直切片会构成第一个真实的非 coding 需求，但应按既有 seam 纪律逐项开缝，而不是一次建通用插件框架。参见
[`decisions/0014-plugin-contribution-points.md`](decisions/0014-plugin-contribution-points.md)。

### 4.4 当前 Workspace 不等于研究数据与计算环境

当前 Workspace 的职责是本地代码目录、Git 分支、Agent cwd、文件边界和写锁。量化研究还需要：

```text
代码目录
数据目录 / Dataset Store
Research Compute Runtime
Result / Artifact Store
Market Data Connection
External Validation Connection
```

这些概念不能都压进 Workspace：

- 数据集可能被多个 Project 共享；
- 数据下载和因子计算不一定修改 Git workspace；
- 同一套代码会对多个 dataset snapshot 并发计算；
- 结果可能是大型列式文件，不是普通源码变化；
- 计算环境需要独立版本和资源限制；
- 数据连接和 TradingView 连接有自己的密钥与健康状态。

Workspace 仍应保留为代码与执行权限边界，但研究数据和计算 runtime 必须独立建模。

### 4.5 当前串行锁与 one-shot Agent Run 不适合批量实验

PersonaHub 当前同一 Workspace 的执行基线是排他串行，且没有跨 adapter 一致的强制只读能力。这个设计对代码修改是安全的，但会限制：

```text
因子参数 A × 市场 1
因子参数 A × 市场 2
因子参数 B × 市场 1
因子参数 B × 市场 2
```

典型因子研究需要批量 fan-out、并发计算、任务取消、超时、资源限制、进度、失败重试和部分结果恢复。现有 Agent Runner 可以负责“生成与解释”，但不应负责大规模数值计算。

需要新增独立的 `ResearchJob / ComputeJob` 生命周期，以及 `ComputeRuntime / ComputeAdapter` 边界。

### 4.6 当前 Artifact 设计需要扩展大结果存储

F009 首批 Artifact 偏向 inline Markdown 和受控本地文件，这适合计划、结论和报告，但量化结果还会包含：

- Parquet 因子暴露；
- 每日收益和净值序列；
- 持仓与交易明细；
- 参数网格结果；
- 图表预览；
- 大型日志；
- 模型或缓存文件。

Artifact 的 metadata、revision、hash 和 provenance 可以复用，但正文存储必须允许列式/二进制对象，并对列表读取、局部查询和预览建立独立契约。

## 5. TradingView 能力边界

### 5.1 TradingView 适合承担什么

官方文档确认 Pine Script Strategy 可以在历史和实时 bar 上模拟订单，Strategy Tester 展示假设性回测结果：

- [Pine Script Strategies](https://www.tradingview.com/pine-script-docs/concepts/strategies/)
- [Strategies FAQ](https://www.tradingview.com/pine-script-docs/faq/strategies/)

因此 TradingView 适合：

- 把研究结果翻译为 Pine strategy；
- 单标的、单图表上下文验证；
- 视觉确认信号、持仓和回撤；
- Deep Backtesting；
- 导出 Strategy Report CSV；
- 实时告警与 Webhook；
- 作为策略使用者的展示和观察终端。

### 5.2 TradingView 不适合作为什么

TradingView Pine 策略以当前图表标的为核心。官方 FAQ 明确指出每个策略一次运行在一个 symbol 上，不能为不同资产同时建立组合头寸。因此它不适合作为以下任务的唯一引擎：

- 多资产横截面排序；
- 全市场分层组合；
- 行业/市值中性化；
- 大规模标的池参数扫描；
- 组合容量、成交冲击和组合级约束；
- 数据集自定义和自有基本面数据研究。

这些任务应在 PersonaHub 自有研究计算平面完成，TradingView 只消费已经收敛的单标的策略表达或信号逻辑。

### 5.3 不应假设存在通用 Strategy Tester API

基于目前官方公开文档，可以确认的主要集成面是：

1. Pine Strategy 在 tradingview.com 图表内运行；
2. Strategy Report 手动导出 CSV：
   [How to export strategy data](https://www.tradingview.com/support/solutions/43000613680-how-to-export-strategy-data/)；
3. Alert Webhook 向外部应用发送 HTTP POST：
   [How to configure webhook alerts](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/)；
4. Advanced Charts / Trading Platform 提供 Datafeed API 和 Broker API。

本次未在官方文档中找到“服务端提交任意 Pine Script、执行 Strategy Tester、再以 API 返回完整回测报告”的通用公开接口。这个结论是根据公开集成面作出的推断，不排除 TradingView 面向特定合作方存在未公开能力，但产品架构不能依赖未确认的私有接口。

### 5.4 Advanced Charts 不能替代 Strategy Tester

TradingView 官方明确说明 Advanced Charts / Trading Platform 不支持以下 tradingview.com 服务端能力：

- Pine Script；
- Alerts；
- Strategy Tester；
- Bar Replay。

参见 [Advanced Charts FAQ](https://www.tradingview.com/charting-library-docs/latest/resources/Frequently-Asked-Questions/)。

同时，该库需要申请访问，官方仓库为私有仓库，且不允许随公共仓库再分发，参见
[Advanced Charts Quick Start](https://www.tradingview.com/charting-library-docs/latest/getting_started/quick-start/)。

因此它最多解决 PersonaHub 内的专业图表展示、Datafeed 和未来交易终端 UI，不会自动带来 Pine 或 Strategy Tester。

### 5.5 Webhook 与本地架构冲突

TradingView Webhook 的官方约束包括：

- 目标必须可从公网访问；
- 只接受端口 80 或 443；
- 服务端处理时间超过约 3 秒会被取消；
- 投递可能失败，需要查看 delivery status；
- Webhook 正文不应包含密码或敏感凭据。

PersonaHub 当前是本地 localhost、单用户、无鉴权服务，不能直接暴露为 Webhook endpoint。若引入实时告警回流，需要增加：

```text
TradingView
  -> HTTPS Relay / Reverse Proxy
  -> signature + nonce + timestamp validation
  -> idempotent inbox
  -> enqueue processing
  -> immediate 2xx response
  -> PersonaHub event ingestion
```

后台分析必须异步执行，Webhook handler 只能校验、持久化、入队并快速返回。

## 6. 推荐目标架构

### 6.1 控制面、计算面、数据面、外部验证面分离

```text
Human / Agent Collaboration
        |
        v
PersonaHub Control Plane
  Project / Issue / Thread / Room / Workflow / Evidence
        |
        +-----------------------+
        |                       |
        v                       v
Research Compute Plane     TradingView Adapter
  ResearchJob                Pine export
  ExperimentAttempt          CSV import
  Backtest Engine             Link / status
  Metrics Engine              Webhook ingestion
        |
        v
Research Data Plane
  DatasetSnapshot
  Factor Matrix
  Positions / Trades
  Equity / Metrics
  Parquet + DuckDB
```

各层职责必须单向：

- 控制面决定要做什么、谁做、是否可信；
- 计算面执行确定的实验；
- 数据面保存大规模数据和结果；
- TradingView Adapter 负责格式转换、外部验证与告警回流；
- 外部验证结果不能反向改写原始 Experiment Attempt，只能创建新的验证记录。

### 6.2 建议新增的核心对象

#### Dataset 与 DatasetSnapshot

```text
Dataset
  id
  project_id nullable
  source_type
  name
  schema
  frequency
  timezone
  calendar

DatasetSnapshot
  dataset_id
  revision
  as_of
  content_hash
  row_count
  coverage
  storage_locator
  adjustment_policy
  created_at
```

所有实验只引用 immutable snapshot，不引用“最新数据”。

#### Universe

记录标的集合及其形成规则。对横截面研究必须区分：

- 当前成分股；
- 历史时点成分股；
- 上市/退市状态；
- 流动性过滤；
- 行业分类版本。

不保存历史时点 universe 会直接引入 survivorship bias。

#### Factor 与 FactorRevision

```text
Factor
  id / project_id / name / lifecycle

FactorRevision
  factor_id / revision
  formula_or_code_ref
  parameter_schema
  dependencies
  expected_frequency
  lag_policy
  preprocessing_policy
  content_hash
```

FactorRevision 应是领域对象，而不仅是一份源码文件。否则无法表达同一段代码在不同数据和预处理约束下的语义差异。

#### ExperimentSpec 与 ExperimentAttempt

```text
ExperimentSpec
  factor_revision
  dataset_snapshot
  universe_revision
  date_range
  rebalance
  portfolio_construction
  cost_model
  benchmark
  validation_split
  parameter_set
  spec_hash

ExperimentAttempt
  experiment_spec_id
  attempt_index
  compute_runtime_snapshot
  status
  started_at / completed_at
  exit_code / failure
  result_manifest_ref
  logs_ref
```

同一 ExperimentSpec 可因中断或基础设施失败产生多个 Attempt；Attempt 不应改变 spec。

#### BacktestResult

BacktestResult 至少拆成：

- summary metrics；
- time-series locator；
- positions locator；
- trades locator；
- diagnostics；
- charts/previews；
- result hash；
- computation provenance。

不要把全部结果保存为一个大型 JSON 字段。

#### ExternalValidation

```text
ExternalValidation
  target_factor_revision
  target_experiment_attempt
  provider = tradingview
  pine_artifact_ref
  symbol / timeframe
  tradingview_settings_snapshot
  imported_report_ref
  imported_report_hash
  comparison_result
  performed_at
```

TradingView 结果是外部验证证据，不是自有回测结果的原地更新。

### 6.3 Research Job 不应复用 Agent Run

建议分成两个生命周期：

```text
Agent Run
  queued -> running -> completed / failed / interrupted / cancelled

Research Job
  queued -> provisioning -> running -> materializing
         -> completed / partial / failed / interrupted / cancelled
```

Research Job 还需要：

- progress；
- CPU / memory / duration limits；
- structured logs；
- cancellation fencing；
- retry policy；
- partial result manifest；
- cache key；
- input/output snapshot；
- 并发和队列优先级。

Agent 可以创建或解释 Research Job，但数值计算成功必须由 Job 状态和结果文件验证，不能相信 Agent 最终消息。

## 7. 推荐研究工作流

第一条可验证的 Quant Research Graph 可定义为：

```text
Hypothesis
  -> Dataset Audit
  -> Factor Implementation
  -> Leakage / Bias Validation
  -> Factor Diagnostics
       |- IC / Rank IC / ICIR
       |- Quantile Return
       |- Turnover / Decay
       `- Regime Breakdown
  -> Portfolio Backtest
  -> Robustness / Ablation
  -> Independent Review
  -> Pine Translation
  -> TradingView External Validation
  -> Promotion Decision
```

建议的关键终止条件：

- 数据覆盖不足时不得进入收益评价；
- 检测到未来数据泄漏时整条 Attempt invalid；
- 样本外未通过时不得标记为 validated；
- 交易成本假设缺失时不得声称策略可交易；
- Pine 与 Python 信号对齐失败时，TradingView validation 为 failed，不覆盖原始回测；
- 外部验证必须绑定精确 Pine revision、symbol、timeframe 和策略参数。

## 8. 前端交互承载能力

### 8.1 可以保留的 V3 交互原则

- 任务仍是顶层工作对象；
- Thread 保留为用户下目标、改约束、指派下一步的主控制线；
- Room 用于阶段性多 Agent 协作；
- 主舞台展示结果和可信度，不展示无组织的日志；
- 结论可以下钻到实验、数据、命令和原始结果；
- 右栏承载定位和元数据，不承担复杂分析；
- 需要用户处理的异常优先于最新更新时间。

### 8.2 必须新增 Quant Research Surface

主舞台建议包含以下视图：

| 视图 | 回答的问题 |
| --- | --- |
| Overview | 这个因子现在是否值得继续研究 |
| Definition | 因子怎么算、依赖什么、版本是什么 |
| Data | 数据覆盖、缺失、复权、时区和 universe 是否可信 |
| Experiments | 跑过哪些固定配置、哪些正在运行、哪些失败 |
| Diagnostics | IC、分层收益、衰减、换手、相关性 |
| Backtest | 净值、回撤、风险收益、持仓、成交、成本 |
| Robustness | 样本外、滚动窗口、市场状态、参数稳定性 |
| TradingView | Pine 版本、导出状态、CSV 导入、信号对齐 |
| Provenance | 数据、代码、参数、环境和验证来源 |

复杂图表必须在主舞台，不进入 440px Dock 或窄 Inspector。

### 8.3 一个任务不应对应一个实验

推荐关系是：

```text
一个研究任务
  -> 一个因子假设
  -> 多个 ExperimentSpec
  -> 每个 Spec 多个 Attempt
```

参数扫描时不能为每个参数组合创建一个 Issue，否则任务列表会被运行实例淹没。Issue 管理人的目标；Experiment 管理机器执行。

### 8.4 “只有任务占 tab”可以暂时保留

V3 当前规定只有任务占顶层 tab。量化场景下可以先保持这条规则：Factor、Experiment 和 Backtest 都作为任务内子视图，不占全局 tab。

但需要观察一个信号：如果用户经常跨任务并排比较多个实验，单任务 tab 会成为限制。届时应增加“比较工作区”，而不是让每个 Experiment 都进入全局 tab。

## 9. 数据与统计可信度要求

量化场景的 Evidence 不只是“测试执行了”，而是“这组统计结论是否由合法输入计算出来”。建议最少记录：

```text
dataset_snapshot_hash
universe_revision
factor_revision
code_commit
dependency_lock_hash
runtime_image_hash
parameter_hash
random_seed
timezone
trading_calendar
corporate_action_policy
cost_model_revision
benchmark_revision
output_manifest_hash
```

需要防范的核心问题：

- 未来函数；
- 使用修订后数据回测历史；
- 当前成分股反推历史；
- 非同步时区和交易日历；
- 复权和分红处理不一致；
- 多次试验后的 selection bias；
- 在全样本调参后再宣称样本外；
- 忽略手续费、滑点和换手；
- TradingView 与自有数据源 OHLC 不一致；
- Pine repainting 和 `request.security()` lookahead；
- 非标准图表价格导致不现实成交。

最终成果页不能只显示一个 Sharpe 或年化收益。至少要同时展示样本范围、最大回撤、换手、成本、样本外表现和可信边界。

## 10. 安全与运维缺口

### 10.1 密钥不能继续泛化为 adapter api_key

量化扩展会引入：

- 市场数据 API key；
- TradingView webhook secret；
- 对象存储凭据；
- 未来 broker/exchange 凭据。

这些密钥的风险和权限不同，不能全部放进 `agent_configs.api_key`。需要独立 Secret Reference 模型，并保证：

- API DTO 永不返回原文；
- Event、Artifact 和日志自动脱敏；
- 密钥按用途和连接对象授权；
- 删除/轮换不改写历史身份快照；
- broker credential 与研究数据 credential 隔离；
- 真实交易权限默认不存在。

### 10.2 回测与实盘之间必须有硬边界

本评估只讨论因子研究和回测。任何实盘扩展都应另立 Feature，并新增：

- Account；
- Order / Execution / Position；
- Risk Limit；
- Kill Switch；
- 审批与双重确认；
- 幂等 client order id；
- 时钟和交易所状态；
- 对账；
- 不可抵赖审计。

不得把 TradingView Alert Webhook 直接连接到下单接口并视为“自然扩展”。

## 11. 分阶段落地建议

### Phase 0：边界验证，不改核心架构

目标：验证真实个人工作流是否成立。

- 选择一个单标的技术因子；
- Agent 生成 Python 与 Pine 两份实现；
- Python 本地回测；
- 用户手动在 TradingView 运行 Pine；
- 导出 CSV；
- PersonaHub 以现有文件和 Thread 保存过程；
- 人工比较两边信号与主要指标。

本阶段允许使用脚本和文件，不把临时结构写进正式 schema。成功判据是发现真实需求，而不是把临时流程包装成平台能力。

### Phase 1：Quant Research 最小垂直切片

新增：

- `quant_research` Issue Type；
- DatasetSnapshot；
- FactorRevision；
- ExperimentSpec / Attempt；
- BacktestResult metadata；
- Quant validation policy；
- Quant Research Surface；
- Python 本地 compute runner；
- Pine artifact 导出与 CSV 导入。

范围限制：单机、单用户、日频、有限标的池、无实盘。

### Phase 2：批量研究与可复现性

- Parquet + DuckDB；
- 并发 Research Job；
- 参数扫描；
- cache；
- Walk-forward；
- 实验比较；
- 数据质量报告；
- 结果 manifest 和完整环境 fingerprint。

### Phase 3：TradingView 实时验证

- 公网 HTTPS relay；
- Webhook secret、nonce、timestamp；
- inbox + idempotency；
- 告警与 FactorRevision/PineRevision 绑定；
- 实时信号偏差监控；
- delivery failure 可见和补偿。

### Phase 4：是否进入交易执行，重新立项

必须单独评估 broker API、风控、权限、合规和运行时可靠性。不能把这一阶段预埋在回测 Feature 中。

## 12. 建议的首个验证性用例

建议不要从“自动挖掘所有因子”开始，而用一个足够小、能暴露关键边界的用例：

> 在一个高流动性单标的上研究双均线或波动率过滤策略，使用同一份标准 OHLC 数据生成 Python 回测和 Pine v6 Strategy，比较交易时间、方向、成交价格和成本后的收益差异。

它能同时验证：

- FactorRevision；
- DatasetSnapshot；
- ExperimentSpec；
- Python Research Job；
- Pine generation；
- TradingView CSV import；
- 信号对齐；
- Artifact/Evidence/Provenance；
- V3 成果面是否能表达结果。

首个用例暂不验证横截面、多因子合成和实盘，因为这些会一次引入过多变量。

## 13. 进入正式设计前需要确认的产品决策

### D-001：产品定位

推荐：PersonaHub 是量化研究的 Agent orchestration/control plane，不自称完整 Quant Platform。

### D-002：核心回测引擎

推荐：本地 Python 引擎为 canonical backtest；TradingView 为 external validation。两边不要求指标完全一致，但必须解释数据和撮合差异。

### D-003：因子范围

需要确认首期是：

- 单标的择时因子；还是
- 多资产横截面因子。

推荐先做单标的垂直切片，但数据模型不能把 Factor 写死为 Pine-only。

### D-004：数据来源

需要确认首期市场、频率、数据供应商和授权方式。没有数据 snapshot 与授权边界，因子研究无法达到可复现。

### D-005：Artifact 与结果存储

推荐：Artifact 保存版本、hash、来源和预览；大规模数值数据保存为外部列式对象，不进入 SQLite blob/JSON。

### D-006：自动化程度

推荐首期采用：

```text
AI 提议
  -> 人确认实验设计
  -> 系统执行
  -> AI 解释
  -> 独立验证
  -> 人决定是否进入 TradingView
```

不建议首期让 Agent 自动试验直到找到最高 Sharpe，这会把多重检验和 selection bias 制造成产品默认行为。

## 14. Go / No-Go 门槛

### 可以进入 Quant Research 垂直切片设计，当且仅当

- 已确认 PersonaHub/计算引擎/TradingView 三者边界；
- 已选定首期市场、数据源、频率和研究范式；
- 已同意 Agent Run 与 Experiment Attempt 分离；
- 已同意 SQLite 不存大规模时序数据；
- 已定义最小可复现 fingerprint；
- 已定义 TradingView 结果如何导入和绑定版本；
- 已明确不包含真实资金交易。

### 不应进入实现，如果仍存在以下任一假设

- “TradingView 应该有一个 API 能自动跑 Strategy Tester，之后再确认”；
- “先把实验参数塞进 ThreadEvent JSON”；
- “每个参数组合建一个 Issue”；
- “行情先存 SQLite，以后再迁”；
- “Agent 说回测通过就算 Evidence”；
- “Advanced Charts 嵌入后自然就有 Pine 和 Strategy Tester”；
- “Webhook 收到信号后直接调用交易接口”。

## 15. 最终建议

这个方向与 PersonaHub 并不冲突，反而能检验它是否真的从 coding assistant 走向通用 Agent Team OS。但正确的扩展方式不是给现有 coding workflow 换一套提示词，也不是在 V3 工作台加一张净值图。

推荐的演进路径是：

```text
保留 PersonaHub 控制面
  -> 增加量化领域对象
  -> 增加独立研究计算平面
  -> 扩展 Artifact/Evidence provenance
  -> 增加 Quant Research Surface
  -> 把 TradingView 作为外部验证与告警适配器
```

在这个前提下，当前设计和架构**有能力演进过去，且核心 Project/Issue/Thread/Room/Artifact/Evidence 模型无需推倒重来**；但 Experiment、Dataset、Compute Runtime 和 TradingView Integration 必须作为新的垂直切片正式设计，不能假装已经被通用字段覆盖。
