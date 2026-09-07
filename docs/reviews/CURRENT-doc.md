---
report_type: doc-review
round: 1
date: 2026-09-06
prior_report: null
scope: full-scan
stop_condition_met: false
severity_counts: { critical: 0, high: 5, medium: 0, low: 0 }
issues:
  - id: UX-BL-R1-001
    title: 新建任务丢失用户目标并绕过推荐确认主路径
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: journey-contract-not-exercised
    status: open
    tracked_task: null
    fix_summary: ""
    regression_test: ""
    suggested_fix: 让提交逻辑读取 data-task-goal，按 J2.1-J2.3 补齐建议生成、调整与确认步骤，并用唯一目标文本锁定端到端回归。
    disposition_reason: ""
    location: ui-reference/personahub-draft/personahub-v3.1/assets/app.js:2409
    first_seen_round: 1
    resolved_round: null
  - id: UX-BL-R1-002
    title: 首次设置页面存在但没有任何可达入口
    severity: high
    category: correctness
    root_cause: root-cause
    origin: spec-drift
    pattern_tag: route-id-contract-drift
    status: open
    tracked_task: null
    fix_summary: ""
    regression_test: ""
    suggested_fix: 统一 start/setup 路由标识，提供首次启动的真实入口，并以 J1.1-J1.6 的连续可点击路径作为回归门禁。
    disposition_reason: ""
    location: ui-reference/personahub-draft/personahub-v3.1/index.html:2145
    first_seen_round: 1
    resolved_round: null
  - id: UX-BL-R1-003
    title: 异常恢复状态覆盖不完整且设计文档仍描述已取消结构
    severity: high
    category: correctness
    root_cause: root-cause
    origin: spec-drift
    pattern_tag: source-of-truth-prototype-drift
    status: open
    tracked_task: null
    fix_summary: ""
    regression_test: ""
    suggested_fix: 对齐用户旅程状态矩阵，补齐中断、取消、失败、排队和验证中状态的主操作与恢复结果，并删除 design.md 中已取消的任务 tab 契约。
    disposition_reason: ""
    location: ui-reference/personahub-draft/personahub-v3.1/docs/design.md:927
    first_seen_round: 1
    resolved_round: null
  - id: UX-BL-R1-004
    title: 弹层、数据表与页签未达到基础键盘和读屏契约
    severity: high
    category: test-coverage
    root_cause: root-cause
    origin: process-gap
    pattern_tag: structural-check-misses-behavior
    status: open
    tracked_task: null
    fix_summary: ""
    regression_test: ""
    suggested_fix: 建立统一 Dialog、Tabs、DataTable 语义与键盘模型，把焦点约束、Esc、aria-selected 和单元格语义加入浏览器门禁。
    disposition_reason: ""
    location: ui-reference/personahub-draft/personahub-v3.1/index.html:4479
    first_seen_round: 1
    resolved_round: null
  - id: UX-BL-R1-005
    title: 密钥与全局暂停没有使用一致的高风险操作保护
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: risk-tier-affordance-missing
    status: open
    tracked_task: null
    fix_summary: ""
    regression_test: ""
    suggested_fix: API Key 默认遮罩并提供显式查看；为暂停全部派工补影响预览、确认与恢复状态，同时裁决它是否属于运行时的动作边界。
    disposition_reason: ""
    location: ui-reference/personahub-draft/personahub-v3.1/index.html:3681
    first_seen_round: 1
    resolved_round: null
---

# PersonaHub V3.44 交互设计基线检视

## 结论

**当前不可基线。** 首轮全量检视发现 5 条 High，全部 open；Critical 为 0。现有
`browser-check.mjs` 的 111 条断言全部通过且控制台错误为 0，但它主要证明既有结构判断没有
被改丢，尚未覆盖首次设置、新建任务提交、异常恢复、完整键盘路径和高风险操作保护。

停止条件未满足：Critical/High 未清零，不进入 CI 收敛候选轮。

## 基线与范围

| 项目 | 当前基线 |
|---|---|
| 分支 | `main` |
| HEAD | `16cbd97` |
| 设计稿 | `ui-reference/personahub-draft/personahub-v3.1` |
| 产物版本 | `V3.44` |
| 检视轮次 | Round 1 |
| 检视范围 | `full-scan` |
| 候选基线状态 | 9 个用户已有未提交文件；本轮仅取证，不修改、不归因 |

## 有限检查清单

1. [x] J1-J4 核心旅程是否存在连续、可点击且不会丢数据的主路径。
2. [x] 状态矩阵中的空、错、阻塞、恢复和完成状态是否有明确主操作与结果。
3. [x] 一级导航、页签、弹层和表单是否满足基础键盘与读屏交互。
4. [x] 密钥、权限、全局暂停等高风险动作是否提前说明影响并要求恰当确认。
5. [x] PRD、用户旅程、设计说明、实现说明、原型和自动验收是否使用同一契约。

## Findings

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复建议 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UX-BL-R1-001 | 新建任务丢失用户目标并绕过推荐确认主路径 | High | 正确性 | 根因 | 原方案 | open | 读取真实目标，恢复 J2 推荐与确认路径，并用唯一目标文本做端到端断言 | — | — | 1 | — | journey-contract-not-exercised |
| UX-BL-R1-002 | 首次设置页面存在但没有任何可达入口 | High | 正确性 | 根因 | 规格漂移 | open | 统一 `start/setup` 路由并跑通 J1.1-J1.6 | — | — | 1 | — | route-id-contract-drift |
| UX-BL-R1-003 | 异常恢复状态覆盖不完整且设计文档仍描述已取消结构 | High | 正确性 | 根因 | 规格漂移 | open | 补齐恢复状态与主操作，清理任务 tab 等过期契约 | — | — | 1 | — | source-of-truth-prototype-drift |
| UX-BL-R1-004 | 弹层、数据表与页签未达到基础键盘和读屏契约 | High | 测试覆盖 | 根因 | 流程缺口 | open | 统一 Dialog/Tabs/DataTable，并新增键盘与语义门禁 | — | — | 1 | — | structural-check-misses-behavior |
| UX-BL-R1-005 | 密钥与全局暂停没有使用一致的高风险操作保护 | High | 正确性 | 根因 | 原方案 | open | 遮罩密钥；为全局暂停补影响预览、确认、恢复并裁决归属 | — | — | 1 | — | risk-tier-affordance-missing |

## 复现证据与关闭条件

### UX-BL-R1-001

`index.html:4521` 的唯一目标输入是 `data-task-goal`，但 `assets/app.js:2412` 读取不存在的
`data-task-title`，因此提交值必然退化为“新任务”；随后固定打开 `issue-running`。实际浏览器中输入
唯一字符串后提交，当前任务没有保留该字符串。与此同时，弹层只有“创建并开始”，没有
`docs/personahub-user-journeys.md:236-238` 要求的推荐方案、调整和确认阶段。

关闭条件：新增浏览器测试，输入唯一目标文本后确认新任务目标、原文和执行上下文都保留；确认前不产生
Issue/Run；重复提交不重复创建。

### UX-BL-R1-002

首次设置面使用 `data-surface-view="setup"`，入口使用 `data-surface="start"`；`setSurface()` 只接受存在
的同名 surface。另一个“开始中心”按钮位于被 `v3-layout.css:19-22` 强制隐藏的旧 activity rail。
浏览器核对结果：setup 面存在但不可见，start 入口共 2 个、可见入口 0 个。

关闭条件：从首次启动状态进入 J1.1，在不修改地址或调用开发者接口的前提下连续完成 J1.1-J1.6，最后
进入同一个新建任务入口；路径校验、CLI 检查须包含 loading、失败和重试。

### UX-BL-R1-003

`docs/personahub-user-journeys.md:333-348` 与状态矩阵要求区分 failed、interrupted、cancelled、
validation fail 等恢复路径；当前 `design.md:931-939` 的七态和原型没有已中断、已取消、实现失败、已排队、
验证中页面。`design.md:907-925` 仍要求任务 tab，而 `README.md:1059` 与 `assets/app.js:98-99` 已声明
任务 tab 取消、切换回左栏。

关闭条件：状态矩阵每个 P0 状态都有可进入的代表画面、唯一主操作、影响预览和恢复后保证；设计说明与
原型只保留一份现行导航契约。

### UX-BL-R1-004

浏览器结构与键盘核对得到：8 个 `.command-overlay.center` 均没有 `role="dialog"`、`aria-modal` 或
可访问标题；从新建任务弹层最后一个按钮按 Tab 后焦点离开弹层到 `body`；账号弹层按 Esc 不关闭，因为
`assets/app.js:2442-2446` 只关闭命令、新建任务和自动化弹层。41 个 `role="table"` 容器虽有命名和 row，
但 cell/columnheader 总数为 0；多组 `role="tab"` 缺 `aria-selected` 且没有方向键/单一 tab stop 模型。

关闭条件：为所有弹层、表格、页签建立统一语义；以键盘完成打开、循环聚焦、提交、取消、Esc 关闭和焦点
归还；读屏能读出表头与单元格关系。上述断言进入 `browser-check.mjs`，并做一次破坏性变异验证确保门禁会红。

### UX-BL-R1-005

`index.html:4564` 的 API Key 使用 `type="text"`，输入时明文显示；同文件 `:4699` 的插件密钥已使用
`type="password"`，说明同类凭据没有统一控件。`index.html:3681` 把“暂停全部派工”作为普通页脚按钮，
但 `docs/implementation-notes.md:37` 又规定运行时不做任务控制；当前只有 toast 文案，没有影响预览、确认态
或持久恢复态。

关闭条件：所有密钥默认遮罩且不会在保存后回显；暂停全部派工在执行前明确“正在运行的不打断、新派工全部
阻止”的影响，确认后产生持久状态和唯一恢复入口；设计文档明确记录其归属或例外理由。

## 正确性与质量通道

正确性通道有 4 条 High（UX-BL-R1-001、002、003、005），均阻塞基线。测试覆盖通道有 1 条 High
（UX-BL-R1-004）；它直接对应 M4-T06 的“基础可访问性”退出条件，同样阻塞。当前没有仅风格性质的
Medium/Low finding。

## 下一轮协议

Round 2 只复核修复 diff 与相邻契约，不重新全量扫描；仅当修复覆盖目标产物超过 30% 时，显式升级为一次
`full-scan`。修复方只能把声明追加到 `docs/reviews/FIX-log.md`，不得修改本文件中的状态。每条 finding
需要独立修复证据、对应回归断言和轮末 `node browser-check.mjs` 结果；检视方独立复现后，才会原子更新
`status`、`fix_summary`、`regression_test` 与 `resolved_round`。

## 裁决记录

暂无。
