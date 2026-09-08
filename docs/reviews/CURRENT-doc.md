---
report_type: doc-review
round: 1
date: 2026-09-08
prior_report: none
scope: full-scan
stop_condition_met: false
severity_counts: {critical: 0, high: 5, medium: 2, low: 0}
issues:
  - id: F009-DOC-R1-001
    title: 迁移矩阵尚未成为开发前设计输入
    severity: high
    category: correctness
    root_cause: root-cause
    origin: process-gap
    pattern_tag: readiness-prerequisite-unowned
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md:87
    first_seen_round: 1
    resolved_round:
  - id: F009-DOC-R1-002
    title: canonical route 的身份和阶段语义未闭合
    severity: high
    category: correctness
    root_cause: root-cause
    origin: spec-drift
    pattern_tag: route-id-contract-drift
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/design.md:28
    first_seen_round: 1
    resolved_round:
  - id: F009-DOC-R1-003
    title: M1 生产 SurfaceRegistry 没有枚举
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: surface-registry-boundary-underspecified
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/design.md:20
    first_seen_round: 1
    resolved_round:
  - id: F009-DOC-R1-004
    title: 既有写动作在 transitional-host 间归属不完整
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: migration-action-disposition-missing
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md:29
    first_seen_round: 1
    resolved_round:
  - id: F009-DOC-R1-005
    title: v0.2 schema fixture 前置条件当前不可执行
    severity: high
    category: test-coverage
    root_cause: root-cause
    origin: process-gap
    pattern_tag: readiness-prerequisite-unowned
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/tasks.md:16
    first_seen_round: 1
    resolved_round:
  - id: F009-DOC-R1-006
    title: 125 条 V3.44 browser checks 缺少适用性分母
    severity: medium
    category: test-coverage
    root_cause: root-cause
    origin: process-gap
    pattern_tag: acceptance-subset-without-denominator
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/spec.md:131
    first_seen_round: 1
    resolved_round:
  - id: F009-DOC-R1-007
    title: 未提交草稿的保存边界不明确
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: transient-state-owner-missing
    status: open
    tracked_task:
    fix_summary:
    regression_test:
    location: docs/features/0.3/F009-v344-frontend-foundation-migration/design.md:32
    first_seen_round: 1
    resolved_round:
---

# F009 开发前设计检视

## 1. 检视结论与基线

- **report_type**: doc-review
- **round**: 1
- **date**: 2026-09-08
- **baseline**: `main@48088cf`
- **scope**: full-scan
- **review target**: `docs/features/0.3/F009-v344-frontend-foundation-migration/` 三件套、
  V3.44 交互基线与当前 `web/src` 影响面
- **severity counts**: Critical 0 / High 5 / Medium 2 / Low 0
- **stop condition met**: false

F009 暂不应从 `draft` 推进到 `ready-for-development`。当前没有 Critical finding，但有 5 个
High 级设计问题需要先关闭；`design.md` 第 10 节目前不应写“无”。

本轮只读检视，不修改 Feature 三件套与产品代码。工作树中既有的
`docs/quant-factor-research-tradingview-assessment.md` 改动与 F009 无关，已排除在范围外。

## 2. 有限检查清单

- F001–F008 已交付页面、动作、API 与测试是否都有明确去向。
- M1 生产导航、route registry 与后续 F011–F013 对象身份是否连续。
- transitional-host 是否只有一个写入口，并有明确替换 owner、删除条件和期限。
- 当前 Thread / Run / Graph / validation / adapter 行为是否会在换壳时静默丢失。
- v0.2 历史数据、根入口、新 deep link 与浏览器门禁是否具备可执行 fixture。
- V3.44 共享交互、草稿保存、错误恢复和可访问性契约是否可验证。

## 3. 正确性通道

### F009-DOC-R1-001 · 迁移矩阵尚未成为开发前设计输入

- **severity**: High
- **category**: correctness
- **root_cause**: root-cause
- **origin**: process-gap
- **status**: open
- **location**: `spec.md:87`、`design.md:48`、`tasks.md:22`
- **pattern_tag**: readiness-prerequisite-unowned

`spec.md` 和 `design.md` 都把迁移矩阵当作范围边界与防止兼容层长期化的依据，但仓库当前
不存在该矩阵，`tasks.md::T001` 到编码阶段才创建它。没有这份输入，开发前无法证明
F001–F008 的页面、动作、API 和测试已经完整纳入，也无法核对 `FR-003` 所称的“既有能力”
具体包括什么。

**检视问题**：迁移矩阵究竟是设计评审输入，还是编码后的实现产物？

**建议关闭条件**：在进入开发前建立并冻结矩阵；每行至少包含旧页面/组件、动作、API、测试、
`migrated / deferred / retired`、`stable-shell / final-surface / transitional-host`、新入口、
canonical 写 API、replacement owner、删除条件与最晚里程碑。T001 改为维护和校验已冻结矩阵，
而不是首次发现范围。

### F009-DOC-R1-002 · canonical route 的身份和阶段语义未闭合

- **severity**: High
- **category**: correctness
- **root_cause**: root-cause
- **origin**: spec-drift
- **status**: open
- **location**: `spec.md:89`、`design.md:28`、`F012 tasks.md:28-29`
- **pattern_tag**: route-id-contract-drift

F009 同时承诺 `/tasks/:taskId/:view?`、`/projects/:projectId/:tab?`、
`/sessions/:sessionId`，但没有定义 M1 实际支持的 `view / tab` 白名单、默认值、非法值结果、
History 前进后退与 canonicalization。当前领域只有 Thread；真正的 Session/Room schema、身份与
迁移由 F012 创建。任务四视图由 F011 接管，项目最终 tabs 由 F013 接管。

**检视问题**：F009 的 `sessionId` 指 Thread ID 还是未来 Session ID？F012 建立 Session 后，
F009 生成的链接如何保证永久有效？非法 `view / tab` 是重定向、带诊断回默认页，还是 not-found？

**建议关闭条件**：在设计中给出逐里程碑 route manifest。推荐 M1 只把当前确有稳定身份的
`/tasks/:id`、`/projects/:id` 作为 canonical object route；`/sessions/:id` 延至 F012。若必须在
F009 发布 session route，则需要钉死 Thread→Session 的 ID/alias 迁移与刷新恢复契约，并为
默认值、非法值、前进后退和异步对象加载写出唯一结果。

### F009-DOC-R1-003 · M1 生产 SurfaceRegistry 没有枚举

- **severity**: High
- **category**: correctness
- **root_cause**: root-cause
- **origin**: original-design
- **status**: open
- **location**: `spec.md:77`、`design.md:20,36`
- **pattern_tag**: surface-registry-boundary-underspecified

规格一方面要求未交付工作面不进入生产导航，另一方面允许为了稳定槽位显示未开放状态；设计
只说 `SurfaceRegistry` 注册达到生产条件的工作面，没有列出确切 registry。当前 runtime health
混合 adapter、workspace lock、队列和 schema 健康，V3.44 却把执行资源放“运行时”、应用基础
设施放“设置 → 系统诊断”；项目最终四 tabs 又归 F013。

**检视问题**：F009 完成时，九个一级槽位中哪些可见且可用、哪些可见但禁用、哪些完全不注册？
adapter 配置、runtime health、代码目录绑定和 Workflow Template 只读证据分别放在哪个工作面？

**建议关闭条件**：增加 M1 surface manifest，逐项写明导航状态、route、真实数据来源、允许动作、
transitional-host、后续接管 Feature 和替换时是否保持 URL。没有页面的工作面不注册；必须保留的
禁用槽位需要给出不会被误解为可用的文案和可访问性行为。

### F009-DOC-R1-004 · 既有写动作在 transitional-host 间归属不完整

- **severity**: High
- **category**: correctness
- **root_cause**: root-cause
- **origin**: original-design
- **status**: open
- **location**: `tasks.md:29-31`、`web/src/components/inspector/IssueInspector.tsx:508-545`、
  `web/src/components/thread/ThreadView.tsx:457-472`
- **pattern_tag**: migration-action-disposition-missing

T011 将“执行启动、人工介入、Graph 状态”放入一个最小 transitional-host；T012 又把 Trace、
Evidence 与 validation 定义为只读宿主。当前生产 UI 实际包含 Run cancel、Graph cancel/retry/
resolve executors、手动触发 validation、unblock、reset validation rounds 和 trace/evidence export。
现有文档没有逐项说明这些动作是 migrated、retired 还是 deferred，也没有说明保留动作落入 T011
还是 T012。

**检视问题**：上述每个动作在 M1 的唯一入口和生命周期分别是什么？“validation 只读”是否仍
允许 trigger、unblock 与 reset rounds？

**建议关闭条件**：把动作级处置写进迁移矩阵。所有仍保留的领域写动作明确归入 T011 或另一个
具名任务，并标出 canonical API；T012 的“只读”限定到具体查询、预览和导出能力。任何 retired
动作都需要产品裁决与替代路径，不能通过组件迁移遗漏而事实退役。

### F009-DOC-R1-005 · v0.2 schema fixture 前置条件当前不可执行

- **severity**: High
- **category**: test-coverage
- **root_cause**: root-cause
- **origin**: process-gap
- **status**: open
- **location**: `tasks.md:16,37`、`docs/features/releases/0.2.md:53-57`、
  `server/src/db/migrations.ts:17`
- **pattern_tag**: readiness-prerequisite-unowned

T021 只负责“使用”v0.2 fixture，前置条件则宣称 fixture 已可用；实际仓库没有可复用的 v0.2
数据库 fixture。release contract 记录 v0.2 收口于 schema v10，而当前 head 已因 BUG-003 修复
推进到 schema v11，“v0.2 latest schema”因此也存在版本歧义。

**检视问题**：fixture 应钉在 release v10，还是使用 v11 bugfix 后的数据库？谁负责生成、审阅和
维护不可漂移的 fixture？加载时是否先运行 v10→v11 迁移？

**建议关闭条件**：新增 Phase 0 fixture 任务，固定来源 schema、升级路径和代表数据。fixture 至少
覆盖顺序 Run、Graph、Trace/FileChange、Evidence、validation 多轮、adapter、Workflow Template
与 runtime health 所需事实；同时证明 fixture 不是只通过公共 API 重新造一份 head 数据。

## 4. 质量与测试通道

### F009-DOC-R1-006 · 125 条 V3.44 browser checks 缺少适用性分母

- **severity**: Medium
- **category**: test-coverage
- **root_cause**: root-cause
- **origin**: process-gap
- **status**: open
- **location**: `spec.md:131`、`tasks.md:43`
- **pattern_tag**: acceptance-subset-without-denominator

规格只要求“提取本 Feature 适用契约”，但 125 条中包含 Memory、自动化、统计、Session、Artifact
等后续能力。若没有完整分类，验收方可以在实现后主观选择一个容易通过的子集。

**检视问题**：哪些断言适用于 F009，哪些由后续 Feature 接管，哪些确实不适用？

**建议关闭条件**：对 125 条逐条标记 `adapted / deferred / not-applicable`，记录理由、生产测试
路径和接管 Feature；分类总数必须等于 125，且新增共享交互形态需要同步扩展生产门禁并做变异验证。

### F009-DOC-R1-007 · 未提交草稿的保存边界不明确

- **severity**: Medium
- **category**: correctness
- **root_cause**: root-cause
- **origin**: original-design
- **status**: open
- **location**: `design.md:32`、`web/src/components/thread/ThreadView.tsx:417-470`
- **pattern_tag**: transient-state-owner-missing

设计要求页面切换保留当前对象与未提交输入，但当前 composer 使用 `ThreadView` 组件本地状态，路由
卸载即可丢失。设计没有说明草稿的 owner、分键方式、保存期限和清除时机。

**检视问题**：草稿按 Task、Session 还是输入框实例分键？切 view、task、project 与浏览器刷新时
分别是否保留？提交成功、取消和对象删除时何时清除？

**建议关闭条件**：明确由 shell 级 draft store 或其他单一机制持有，钉死 key、生命周期、刷新
语义与清理条件，并为跨 view/task 切换、提交成功和错误重试建立浏览器测试。

## 5. 门禁证据与关闭条件

本轮已通过：

- `node tools/check-feature-gates.mjs`
- `node tools/check-doc-links.mjs`
- `node tools/check-doc-ownership.mjs`
- `node --test tools/check-v03-plan-contracts.test.mjs`

这些门禁证明文档结构、链接、所有权和既有 v0.3 计划断言有效，但不覆盖本报告列出的实现语义
缺口。F009 进入 `ready-for-development` 前应满足：

1. 五个 High finding 全部关闭并把裁决回写到 Feature 三件套。
2. `design.md` 第 10 节使用稳定 `DQ-xxx` 记录问题与裁决，不再写“无”。
3. 迁移矩阵、route/surface manifest 与 v0.2 fixture 建设均有具名 owner、任务和验收标准。
4. 文档门禁与 `npm run verify` 全绿。

Medium finding 不单独阻塞状态推进，但必须进入 tasks 或在设计中给出明确裁决，不能无 owner 留白。
