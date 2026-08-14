---
report_type: doc-review
round: 4
date: 2026-08-15
prior_report: 第 1 轮 commit e5740b5、第 2 轮 commit d09c772、第 3 轮 commit 992eac3（同一文件）
scope: diff-only
stop_condition_met: true
severity_counts: { critical: 0, high: 3, medium: 6, low: 5 }
issues:
  - id: JRN2-001
    title: Issues 列表行的信息需求未定义，拼装 issue list 与验收指标 9 都无断言点
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: missing-list-level-requirements
    status: fixed
    fix_summary: 新增 §6.4.1 行级信息需求表（目标/状态/是否需要我/执行者/最后活动），排序沿用注意力优先级，明确列表不承载动作、不引入团队字段
    regression_test: docs/personahub-user-journeys.md::6.4.1-issue-list-row-requirements
    location: docs/personahub-user-journeys.md:376-404
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-002
    title: 第一屏默认落点（最近 Project / 最近 active Issue）未收进旅程
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: prd-requirement-not-carried-into-journey
    status: fixed
    fix_summary: §6.1 补「重新进入应用的默认落点」表，四个位置各定默认与例外；明确冲突时以需要用户的任务优先，不按最近时间
    regression_test: docs/personahub-user-journeys.md::6.1-default-landing
    location: docs/personahub-user-journeys.md:262-276
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-003
    title: Done evidence summary 复制/下载被降级为 P1，与 PRD §10 必须项冲突
    severity: high
    category: correctness
    root_cause: root-cause
    origin: spec-drift
    pattern_tag: cross-feature-contract-drift
    status: fixed
    fix_summary: 用户 2026-08-15 裁决——查看/追溯 P0，复制/下载/导出同属「带出应用」归 P1；§7.2/§7.4 改写并显式记录与 PRD §10 的差异，同步登记进 reset-plan §7 待 PRD 修订
    regression_test: docs/reviews/product-experience-reset-plan.md::section-7-prd-impact
    location: docs/personahub-user-journeys.md:462,472-484
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-004
    title: 信息需求矩阵缺已中断/已取消/正在修复三个状态
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: state-matrix-coverage-gap
    status: fixed
    fix_summary: §6.4 补三行，并写明已中断/已取消不并入 Blocked（三者默认下一步与主操作不同）
    regression_test: docs/personahub-user-journeys.md::6.4-state-information-matrix
    location: docs/personahub-user-journeys.md:351-364
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-005
    title: 右栏是否分 tab 三份文档结论冲突，且旅程越界给出形态判断
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: spec-drift
    pattern_tag: cross-feature-contract-drift
    status: fixed
    fix_summary: 旅程推论 3 改为只说「右栏承载快照」，分区方式交 M4-T02 裁决；concept-mapping §5.4 补澄清段说明其「照搬堆叠」属优先级链第 4 层，被 PRD §13 第 2 层否决
    regression_test: docs/reviews/concept-mapping.md::5.4-layout-conclusion
    location: docs/personahub-user-journeys.md:369-372
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-006
    title: 指派的两个入口（交接卡片按钮 / composer @）主次未定
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: dual-entry-priority-undefined
    status: fixed
    fix_summary: §6.5 改为两入口分工表——交接卡片按钮是等待指派的主路径（对应指标 6），@ 是任意时刻的常驻快捷入口；J3.2 同步点明主路径
    regression_test: docs/personahub-user-journeys.md::6.5-assignment-entry-priority
    location: docs/personahub-user-journeys.md:275,406-411
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-007
    title: Room 列为用户必须理解的概念，但四条旅程无任何步骤涉及
    severity: medium
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: concept-without-journey-step
    status: fixed
    fix_summary: §3.1 Room 标 [P1] 并指向空白区；§2.3 补一段——P0 不承载 Room 区块，但左/中栏不得做出排斥 Room 的结构假设
    regression_test: docs/personahub-user-journeys.md::2.3-room-p0-handling
    location: docs/personahub-user-journeys.md:107-114,150
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-008
    title: 左栏 Automations 占位入口未在跨旅程导航能力中登记
    severity: low
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: prd-requirement-not-carried-into-journey
    status: fixed
    fix_summary: §2.4 补一行，注明占位、P0 无功能、指向 PRD §15 v0.4，且不得因当前无用而从导航删除
    regression_test: docs/personahub-user-journeys.md::2.4-cross-journey-navigation
    location: docs/personahub-user-journeys.md:118
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-009
    title: PRD §10 右栏 Message/event stats 在旅程无对应需求且未显式裁决
    severity: low
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: concept-without-journey-step
    status: fixed
    fix_summary: §6.4 补显式裁决段——P0 不进右栏，需要时按 M4-T05 回流本文再定，不得直接补进页面；同步登记进 reset-plan §7
    regression_test: docs/personahub-user-journeys.md::6.4-prd-right-panel-exclusion
    location: docs/personahub-user-journeys.md:374-376
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-010
    title: NOTE-001/002 旅程步骤仍为占位，实际已由 J1.4 覆盖
    severity: low
    category: quality
    root_cause: root-cause
    origin: process-gap
    pattern_tag: marked-done-not-recorded
    status: fixed
    fix_summary: 两行状态改 adopted、旅程步骤填 J1.4、去向填显式添加/编辑入口；J1.4 因此累计 2 条，按自测试体系 §7.2 触发「重复即升级」
    regression_test: docs/reviews/dogfooding-notes.md::note-001-002-journey-mapping
    location: docs/reviews/dogfooding-notes.md:14-15
    first_seen_round: 1
    resolved_round: 2
  - id: JRN2-011
    title: 第一屏中间默认落点改按注意力优先级，与 PRD §6 分叉却未登记影响面
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: cross-feature-contract-drift
    status: fixed
    fix_summary: §6.1 补「与 PRD §6 的差异」段说明分叉条件（仅多任务并存时），并登记进 reset-plan §7 的 PRD 重估清单，与 JRN2-003 同规格处理
    regression_test: docs/reviews/product-experience-reset-plan.md::section-7-prd-impact
    location: docs/personahub-user-journeys.md:272-278
    first_seen_round: 2
    resolved_round: 4
  - id: JRN2-012
    title: 默认落点表右栏行写「收起或显示项目级摘要」，既是形态判断又未裁决
    severity: low
    category: quality
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: journey-writes-page-form
    status: fixed
    fix_summary: 改为行为语言「无选中任务时不呈现空壳区块」，具体呈现方式交 M4-T02，与本轮 JRN2-005 刚确立的边界一致
    regression_test: docs/personahub-user-journeys.md::6.1-default-landing
    location: docs/personahub-user-journeys.md:268
    first_seen_round: 2
    resolved_round: 4
  - id: JRN2-013
    title: 指派入口表使用 composer 组件名，越出行为层用语
    severity: low
    category: quality
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: journey-writes-page-form
    status: fixed
    fix_summary: 改为「指令输入处」，不指定具体控件
    regression_test: docs/personahub-user-journeys.md::6.5-assignment-entry-priority
    location: docs/personahub-user-journeys.md:412
    first_seen_round: 2
    resolved_round: 4
---

# 用户旅程文档检视（M4 页面拼装前复核）· 第 4 轮（已闭环）

## 结论先行

**旅程作为行为真相源的骨架成立，但作为 M4 拼装的输入还差三处硬依据。** 四条旅程的
步骤表、状态矩阵（§8，15 个状态）、可观察验收指标（§9，9 条）结构完整，NOTE-003~007
五条 dogfood 发现全部有落点，P0 完全手动指派（§6.2.1）的论证与
`concept-mapping.md` §9.3 一致，不需要重开。

本轮 10 条发现全部属于「拼装需要、旅程没写」或「与 PRD/概念映射口径不一致」，
没有一条是旅程写错了行为。3 条 High 均会在 M4-T02/M4-T03 当场卡住：拼 Issues 列表
没有行级信息需求（JRN2-001）、拼第一屏没有默认落点（JRN2-002）、拼 Done 视图不知道
要不要放下载入口（JRN2-003）。

**10 条已全部在第 1 轮修复。**

## 第 2 轮（diff-only）结论

只审第 1 轮修复的 diff（commit `e5740b5`）及相邻步骤，未重新通读全文，diff 未超过旅程
文档 30%，不升级为 full-scan。

**第 1 轮 10 条修复全部成立，resolved_round = 2。** 复核逐条确认：§6.4.1 引用的
`concept-mapping.md` §2「团队字段按旅程重判」措辞属实；§2.4 新增行对 PRD §15
「Scheduled Issue 在至少一个非 coding 垂直切片稳定后按需引入」的引述属实；
§6.4 三个新增状态行与 §8 的「默认下一步/主操作」逐条对得上。

**但第 1 轮修复自身引入 3 条新问题（JRN2-011/012/013，均 `fix-regression`）**，
已在第 2 轮修复，待第 3 轮独立复核。其中 JRN2-011 是实质问题：修 JRN2-002 时把 PRD §6
的「最近 active Issue」改成了「注意力优先级最高」，这是与 PRD 的第二处分叉，却没有像
JRN2-003 那样登记影响面——同一轮里对同类问题采取了不同规格的处理。
JRN2-012/013 同属一个模式：**刚在 JRN2-005 立下「旅程不写页面形态」的边界，转身在自己
新写的段落里越了两次界**（「右栏收起」「composer」）。

## 本轮检查清单（有限，走完即通过）

1. 四条旅程每步是否都有「此刻最关心的问题」与「概念披露」——M4 剪贴规则的唯一依据
2. §8 每个用户可见状态是否在 §6.4 信息需求矩阵有对应行
3. PRD §6 / §10 明列的 UI 必须项能否逐条指回旅程某一步（反向覆盖）
4. 旅程是否越界写了页面形态与布局（违反 reset-plan §4.3 边界）
5. 跨文档口径一致性：PRD / concept-mapping / product-experience-reset-plan / dogfooding-notes
6. §9 验收指标能否落到具体 fixture 与断言（ST-T03 旅程—测试映射可行性）
7. 每条旅程是否都有空状态 / 错误 / 恢复路径
8. 不可逆操作与危险动作是否覆盖且默认拒绝

清单第 1、7、8 项通过，无发现；第 2、3、4、5、6 项产生下表 10 条。

## 发现

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JRN2-001 | Issues 列表行的信息需求未定义 | High | 正确性 | 根因 | 初稿 | fixed | 新增 §6.4.1 行级信息需求表与三条规则 | `docs/personahub-user-journeys.md::6.4.1-issue-list-row-requirements` | 1 | 2 | missing-list-level-requirements |
| JRN2-002 | 第一屏默认落点未收进旅程 | High | 正确性 | 根因 | 初稿 | fixed | §6.1 补默认落点表，冲突时以需要用户者优先 | `docs/personahub-user-journeys.md::6.1-default-landing` | 1 | 2 | prd-requirement-not-carried-into-journey |
| JRN2-003 | Done 摘要复制/下载被降级 P1，与 PRD §10 冲突 | High | 正确性 | 根因 | 契约漂移 | fixed | 查看/追溯 P0、复制/下载/导出 P1；差异登记进 reset-plan §7 | `docs/reviews/product-experience-reset-plan.md::section-7-prd-impact` | 1 | 2 | cross-feature-contract-drift |
| JRN2-004 | 信息需求矩阵缺已中断/已取消/正在修复 | Medium | 正确性 | 根因 | 初稿 | fixed | §6.4 补三行并声明不并入 Blocked | `docs/personahub-user-journeys.md::6.4-state-information-matrix` | 1 | 2 | state-matrix-coverage-gap |
| JRN2-005 | 右栏是否分 tab 三文档冲突，旅程越界写形态 | Medium | 正确性 | 根因 | 契约漂移 | fixed | 旅程移除形态断言，分区交 M4-T02；concept-mapping 补优先级链澄清 | `docs/reviews/concept-mapping.md::5.4-layout-conclusion` | 1 | 2 | cross-feature-contract-drift |
| JRN2-006 | 指派两个入口主次未定 | Medium | 正确性 | 根因 | 初稿 | fixed | 卡片按钮为主路径、`@` 为常驻快捷入口，J3.2 同步 | `docs/personahub-user-journeys.md::6.5-assignment-entry-priority` | 1 | 2 | dual-entry-priority-undefined |
| JRN2-007 | Room 是必须理解概念但无旅程步骤 | Medium | 质量 | 根因 | 初稿 | fixed | Room 标 [P1]；P0 不承载但不得做排斥性结构假设 | `docs/personahub-user-journeys.md::2.3-room-p0-handling` | 1 | 2 | concept-without-journey-step |
| JRN2-008 | Automations 占位入口未登记 | Low | 质量 | 根因 | 初稿 | fixed | §2.4 补占位行并指向 PRD §15 | `docs/personahub-user-journeys.md::2.4-cross-journey-navigation` | 1 | 2 | prd-requirement-not-carried-into-journey |
| JRN2-009 | 右栏 Message/event stats 未显式裁决 | Low | 质量 | 根因 | 初稿 | fixed | §6.4 显式裁决不进右栏，回流走 M4-T05 | `docs/personahub-user-journeys.md::6.4-prd-right-panel-exclusion` | 1 | 2 | concept-without-journey-step |
| JRN2-010 | NOTE-001/002 旅程步骤仍为占位 | Low | 质量 | 根因 | 流程缺口 | fixed | 回填 J1.4 与 adopted，触发自测试体系 §7.2 重复升级 | `docs/reviews/dogfooding-notes.md::note-001-002-journey-mapping` | 1 | 2 | marked-done-not-recorded |
| JRN2-011 | 默认落点与 PRD §6 分叉未登记影响面 | Medium | 正确性 | 根因 | 修复引入 | fixed | §6.1 补差异段并登记进 reset-plan §7，与 JRN2-003 同规格 | `docs/reviews/product-experience-reset-plan.md::section-7-prd-impact` | 2 | 3 | cross-feature-contract-drift |
| JRN2-012 | 默认落点表写「右栏收起」，越界写形态 | Low | 质量 | 根因 | 修复引入 | fixed | 改为「不呈现空壳区块」，呈现方式交 M4-T02 | `docs/personahub-user-journeys.md::6.1-default-landing` | 2 | 3 | journey-writes-page-form |
| JRN2-013 | 指派入口表用 composer 组件名 | Low | 质量 | 根因 | 修复引入 | fixed | 改为「指令输入处」 | `docs/personahub-user-journeys.md::6.5-assignment-entry-priority` | 2 | 3 | journey-writes-page-form |

## 逐条问题与修复依据

### JRN2-001（High）Issues 列表行的信息需求未定义

§6.4 的作用域是「打开某个任务之后」，而 PRD §6 明列 Issues 列表是 P0（Board 才是 P2）。
M4-T03 必然要拼一张 issue list，旅程没定义每一行必须一眼回答什么，拼装只能照搬 multica
的团队字段。同时 §9 验收指标 9（5 个不同状态任务中 10 秒定位最高优先级）没有断言点，
ST-T03 无法映射成 Playwright 断言。

**修复**：新增 §6.4.1，定死五列（任务目标 / 用户可见状态 / 是否需要我 / 当前执行者 /
最后活动时间），默认排序沿用注意力优先级，并显式禁止引入指派人、优先级、里程碑、标签
等团队字段。

### JRN2-002（High）第一屏默认落点未收进旅程

PRD §6「第一屏」已定死默认状态，旅程 §6.1 只写了触发条件不含落点。M4 拼的第一张页面
就是第一屏，缺这条只能猜。

**修复**：§6.1 补四行默认落点表，并写明「默认落点 ≠ 最近打开」的理由——手动指派下停住
的任务不会自己前进，按最近排序会让用户每次自己去找停住的那个。

### JRN2-003（High）Done 摘要复制/下载与 PRD §10 冲突

PRD §10 把「复制/下载已持久化 Markdown」列为右栏必须项，旅程 J4.5 标 P1。

**修复（用户 2026-08-15 裁决）**：复制、下载、导出属同一类能力（把结果带出应用），统一
P1；P0 只保证应用内查看与逐条追溯。§7.2 措辞同步，§7.4 显式记录与 PRD 的差异并声明
「PRD 改掉之前以本文为拼装依据」，差异登记进 reset-plan §7 走产品级修订流程。

### JRN2-004（Medium）信息需求矩阵缺三个状态

§8 有 15 个用户可见状态，§6.4 只有 7 行。J1/J2 的四个状态不属于执行中视图，缺席合理；
但正在修复、已中断、已取消属于执行中视图，且 §8 里三者的默认下一步各不相同。

**修复**：补三行，并声明已中断/已取消不并入 Blocked——合并会让用户误以为要先解某个
blocker 才能重启。

### JRN2-005（Medium）右栏分 tab 三份文档冲突

PRD §13 要求分 tab；concept-mapping §5.4 结论是照搬 clowder 固定堆叠；旅程 §6.4 推论 3
写「布局不必重排」。且推论 3 本身越过了 reset-plan §4.3「旅程不写页面布局」的边界。

**修复**：旅程只保留「右栏承载快照、不承载动作」这条行为规则，分区方式交 M4-T02 裁决；
concept-mapping §5.4 补一段说明它的结论位于拼装优先级链第 4 层，被第 2 层的 PRD §13 否决。

### JRN2-006（Medium）指派两个入口主次未定

§6.5 写「以 `@` 为主入口」，J3.2 写「指派说明与可选成员在同一视区」。拼装无法判断等待
指派时卡片上有没有成员按钮。若主入口是 composer 的 `@`，§9 验收指标 6 的「不需要翻找
入口、15 秒完成指派」很难成立。

**修复**：§6.5 改为分工表——交接卡片内的成员按钮是等待指派状态的主路径，`@` 是任意时刻
（运行中改派、补充约束）的常驻快捷入口；J3.2 同步点明。

### JRN2-007（Medium）Room 是必须理解概念但无旅程步骤

§3.1 把 Room 列入「用户必须理解的概念」，§2.3 却把 Room 内协作列为 P1，四条旅程无任何
步骤涉及。按剪贴规则 Room 区块会被删——但它是 concept-mapping §4.4 认定的唯一真空白区
与竞争力 `graph-orchestrated` 的落点。

**修复**：§3.1 该行标 `[P1]` 并指向 `blank-areas.md`；§2.3 补一段——P0 不承载 Room 区块，
但左/中栏不得做出排斥 Room 的结构假设（如把中间栏写死为单一 primary Thread）。

### JRN2-008（Low）Automations 占位入口未登记

PRD §10 左侧导航必须项含 Automations 占位，§2.4 未列。**修复**：补一行，注明占位、P0 无
功能、指向 PRD §15 v0.4，且不得因当前无用而从导航删掉。

### JRN2-009（Low）右栏 Message/event stats 未显式裁决

PRD §10 明列，旅程 §6.4 无任何一行需要它。按剪贴规则应删，但删 PRD 明列项需要显式裁决。
**修复**：§6.4 下补裁决段，并入 reset-plan §7 的 PRD 重估清单。

### JRN2-010（Low）NOTE-001/002 旅程步骤仍为占位

J1.4 已写「用显式『添加 AI 成员』和『编辑』操作」，正好覆盖这两条，但主表未回填，
M5-T02 会漏判。**修复**：两行改 `adopted`、旅程步骤填 `J1.4`。

**副作用（正确结果，需跟进）**：J1.4 由此累计 2 条 dogfood 发现，按
`self-test-system-plan.md` §7.2「重复即升级」触发，需要补 J1.4 的需求级 spec。
这一项落在 M6 首次设置切片，不在本轮检视范围内，已在此登记以免遗漏。

## 第 3 轮（封顶）结论

scope `diff-only`，只审第 2 轮那三处修改（§6.1 差异段与右栏行、§6.5 入口表一行、
reset-plan §7 新增段）。三处全部成立，**未引入新问题**，JRN2-011/012/013 关闭，
resolved_round = 3。

**停止条件核对**：

1. Critical/High 清零 —— 13 条全部 fixed，剩余无 open ✅
2. 本地门禁 `npm run verify` 全绿（lint / format:check / typecheck / 测试 /
   check:features / check:doc-links / check:doc-ownership / check:e2e-fixme）✅
3. CI 最终门禁 —— 见第 4 轮
4. 图谱工具：本轮为纯文档改动，`detect_changes_tool` 风险分 0.00，无新增未覆盖高风险点 ✅

## 第 4 轮：CI 门禁

第 3 轮触发的 CI run `31820895449`（commit `992eac3`）**首跑红**，按协议本轮重开为第 4 轮，
CURRENT 文件不删除。

**分诊结论：与本次改动无关，且不是产品缺陷。** 依据三条——(1) 本次为纯文档改动，
物理上无法影响 E2E；(2) 红的是 `f005-layout.spec.ts:32` 的**第一条**用例，
`page.goto("/")` 后等首屏 `text=Agent Adapters` 30s 超时，**同文件后 3 条全过**；
(3) 本机 `npm run build && npm run test:e2e` 4/4 通过，该条仅耗时 1.8s。判定为
Windows runner 上 Vite dev + `tsx watch` 未就绪即开测的冷启动竞态。

项目 SOP §「失败分诊」的基线探测规则针对 REAL_* 真实 CLI 测试，不覆盖本条 fake 夹具
用例，故按上述证据链分诊而非套用该规则。

同 SHA 重跑 `--failed` 后**全绿**，停止条件第 3 条满足，本轮闭环。

**但不把它当成"重跑一下就好"**：一个会随机红的最终门禁，会让下一次真实的首屏回归也被
当成 flake 重跑掉。已登记 ST-T17（修法为 webServer 真实就绪探测，明确禁止用 `retries`
盖红），并记为 JRN2-014 `carried-forward`。

## 遗留跟进（不阻塞本次闭环）

- **J1.4 触发「重复即升级」**：JRN2-010 回填后 J1.4 累计 2 条 dogfood 发现，按
  `self-test-system-plan.md` §7.2 需补该步骤的需求级 spec，落在 M6 首次设置切片。
- **PRD 两处待修订**：Done 复制/下载降级（JRN2-003）、第一屏默认落点（JRN2-011），
  均已登记进 `product-experience-reset-plan.md` §7，走产品级修订流程。
- **右栏分区方式**：由 M4-T02 在 PRD §13 约束下裁决并记录（JRN2-005）。
- **E2E 冷启动竞态**：ST-T17（JRN2-014），在修好前 E2E 红必须先排除是不是这条。
