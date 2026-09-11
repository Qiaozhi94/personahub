---
report_type: fix-verification
round: 4
date: 2026-09-11
prior_report: CURRENT-code.md (round 3 @ 6dee56e)
scope: diff-only
baseline_commit: 6dee56eabc1a3ec038a4a524ac9e2ff753985b7a
reviewed_commit: d2ecc740737b8d4e4202453f1cd3e7cf69dfead9
stop_condition_met: false
severity_counts: {critical: 0, high: 3, medium: 2, low: 0}
issues:
  - {id: F009-CODE-R1-001, title: 主区域不可滚动, severity: high, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: scroll-container-missing, status: fixed, fix_summary: main 成为纵向滚动 owner, regression_test: "e2e/tests/f009-shell.spec.ts::R1-001", location: "web/src/app/ApplicationShell.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-002, title: Composer 状态在缓存任务间串用, severity: high, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: route-scoped-state-leak, status: fixed, fix_summary: 草稿与 adapter/consult 状态按 task key 隔离, regression_test: "web/src/f009-execution-host.test.tsx::keeps adapter and consult selection per task key", location: "web/src/components/thread/ThreadView.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-003, title: 生产界面无显式丢弃草稿动作, severity: high, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: marked-done-not-implemented, status: fixed, fix_summary: 增加 pending 状态可用的丢弃动作, regression_test: "web/src/f009-execution-host.test.tsx::offers a production discard action", location: "web/src/components/thread/ThreadView.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-004, title: 历史工作流页不可发现, severity: high, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: route-exists-but-undiscoverable, status: fixed, fix_summary: 设置目录只列真实可达子页, regression_test: "e2e/tests/f009-shell.spec.ts::BC-097", location: "web/src/pages/settings-catalog.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-005, title: 黄金旅程未执行冻结关键动作, severity: high, category: test-coverage, root_cause: root-cause, origin: original-coding, pattern_tag: test-simulates-itself, status: fixed, fix_summary: J1-J9 通过确定性 fixture 真实执行冻结写动作并写后读, regression_test: "e2e/tests/f009-golden-journey.spec.ts::J1-J9", location: "e2e/tests/f009-golden-journey.spec.ts", first_seen_round: 1, resolved_round: 3}
  - {id: F009-CODE-R1-006, title: adapted 行未锁住全部生产交互实例, severity: high, category: test-coverage, root_cause: root-cause, origin: original-coding, pattern_tag: acceptance-subset-without-denominator, status: carried-forward, fix_summary: 多数 dialog 已补焦点归还但 Adapter Edit 触发分支仍不受回归测试保护, regression_test: "e2e/tests/f009-a11y.spec.ts::BC-049 remaining M1 dialogs（证据不足）", location: "e2e/tests/f009-a11y.spec.ts:167", first_seen_round: 1, resolved_round: null}
  - {id: F009-CODE-R1-007, title: 错误与空状态恢复合同不完整, severity: high, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: partial-symmetric-fix, status: fixed, fix_summary: 五个剩余 query surface 均接入真实 retry/refetch, regression_test: "web/src/f009-pages.test.tsx and adjacent F009 recovery tests", location: "web/src", first_seen_round: 1, resolved_round: 3}
  - {id: F009-CODE-R1-008, title: 未覆盖真实 server 首启迁移, severity: medium, category: test-coverage, root_cause: root-cause, origin: original-coding, pattern_tag: integration-seam-not-exercised, status: fixed, fix_summary: v10 fixture 由真实 server 首启迁移, regression_test: "e2e/tests/f009-golden-journey.spec.ts::J1 schema head", location: "e2e/tests/support/f009-fixture-db.ts", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-009, title: popstate 监听生命周期错误, severity: medium, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: shared-listener-lifetime, status: fixed, fix_summary: 首订阅注册且末订阅注销, regression_test: "web/src/f009-shell.test.tsx::keeps remaining subscribers updating", location: "web/src/app/router.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-010, title: Graph 弹窗提前关闭, severity: medium, category: correctness, root_cause: root-cause, origin: original-coding, pattern_tag: async-dialog-closes-before-outcome, status: fixed, fix_summary: 失败保留弹窗且仅成功关闭, regression_test: "web/src/f009-execution-host.test.tsx::keeps the graph dialog open on failure", location: "web/src/components/thread/ThreadView.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-011, title: 完成标记与执行证据不一致, severity: medium, category: test-coverage, root_cause: root-cause, origin: process-gap, pattern_tag: marked-done-not-recorded, status: carried-forward, fix_summary: tasks 与 journey matrix 改写了 T031 口径但未同步上游 spec/design 且 FIX-log 计数失真, regression_test: "tools/check-v03-plan-contracts.test.mjs::F009-CODE-R1-011（只验 commit hash）", location: "docs/features/0.3/F009-v344-frontend-foundation-migration/design.md:196", first_seen_round: 1, resolved_round: null}
  - {id: F009-CODE-R1-012, title: format 门禁漏掉 F009 文件, severity: medium, category: quality, root_cause: root-cause, origin: original-coding, pattern_tag: gate-coverage-gap, status: fixed, fix_summary: 扩展增量 format targets, regression_test: "npm run format:check", location: "package.json", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R1-013, title: DataTable 字符串化 ReactNode, severity: low, category: quality, root_cause: root-cause, origin: original-coding, pattern_tag: render-contract-stringifies-node, status: fixed, fix_summary: custom ReactNode 原样渲染, regression_test: "web/src/f009-primitives.test.tsx::renders a custom ReactNode as-is", location: "web/src/components/primitives/data-table.tsx", first_seen_round: 1, resolved_round: 2}
  - {id: F009-CODE-R2-014, title: tabs 只切选中态不切面板, severity: medium, category: correctness, root_cause: root-cause, origin: fix-regression, pattern_tag: control-state-not-bound-to-content, status: fixed, fix_summary: 可见 tabpanel 与 active tab 绑定, regression_test: "e2e/tests/f009-a11y.spec.ts::BC-052", location: "web/src/pages/legacy-workflows-page.tsx", first_seen_round: 2, resolved_round: 3}
  - {id: F009-CODE-R2-015, title: 新回归测试未等待 React 更新仍绿, severity: medium, category: test-coverage, root_cause: root-cause, origin: fix-regression, pattern_tag: unawaited-react-update, status: fixed, fix_summary: 手工 popstate dispatch 由 act 包裹, regression_test: "web/src/f009-execution-host.test.tsx and web/src/f009-shell.test.tsx", location: "web/src/f009-execution-host.test.tsx", first_seen_round: 2, resolved_round: 3}
  - {id: F009-CODE-R3-016, title: 测试 FakeAgentAdapter 可重新进入生产启动路径而测试不红, severity: high, category: test-coverage, root_cause: symptom-patch, origin: fix-regression, pattern_tag: test-double-in-production-wiring, status: carried-forward, fix_summary: 当前代码用环境变量 opt-in 但测试只验证 helper 参数未锁定 index 生产调用点, regression_test: "server/tests/unit/register-adapters.test.ts（证据不足）", location: "server/src/index.ts:78", first_seen_round: 3, resolved_round: null}
  - {id: F009-CODE-R3-017, title: E2E invocation 生命周期未被回归锁定且 teardown 实际泄漏目录, severity: high, category: correctness, root_cause: symptom-patch, origin: fix-regression, pattern_tag: shared-fixed-temp-path, status: carried-forward, fix_summary: 当前 mkdtemp 已消除互删库但测试绕过入口且 globalTeardown 未清理实际目录, regression_test: "server/tests/integration/f009-v02-fixture.test.ts::keeps two concurrent fixture builds fully isolated（证据不足）", location: "e2e/tests/support/invocation-dir-teardown.ts:8", first_seen_round: 3, resolved_round: null}
  - {id: F009-CODE-R3-018, title: CI 与发布门禁一致性没有可失败的契约测试, severity: medium, category: test-coverage, root_cause: symptom-patch, origin: fix-regression, pattern_tag: release-gate-diverges-from-ci, status: carried-forward, fix_summary: 当前 workflow 已添加 empty-db step 但删除该 step 后所有 docs 契约测试仍绿, regression_test: "", location: ".github/workflows/ci.yml:61", first_seen_round: 3, resolved_round: null}
---

# F009 代码修复全面复核（第 4 轮）

## 结论

**本轮仍不通过，F009 不满足检视闭环条件。** 当前为 Critical 0、High 3、Medium 2、Low 0。

五项修复都已落盘，当前实现相较上轮明显改善：生产 fake 默认关闭、fixture 使用唯一目录、主/空库 E2E 都进 CI、主要 dialog 已补焦点归还、T031 文档也尝试区分自动化事实与主观体验。但独立变异表明三项 High 的回归测试没有锁住真正入口；R3-017 还存在可直接观察到的 teardown 失效。R1-011 的完成口径继续与上游规格矛盾，FIX-log 的门禁计数也与实跑不符。High 未清零，因此不触发最终 CI、不写 RETROSPECTIVE、不清理过程报告。

## 基线与有限范围

- 基线：`f009-v344-frontend-foundation@6dee56e`
- 复核 HEAD：`d2ecc740737b8d4e4202453f1cd3e7cf69dfead9`
- 受影响规格：`docs/features/0.3/F009-v344-frontend-foundation-migration/{spec,design,tasks}.md`
- 修复差异：24 个文件，新增 423 行、删除 148 行，共 571 行；相对上一轮目标差异 2940 行约 19.4%，未超过 30%，故继续执行 diff-only。
- 有限清单：5 个既有 open finding、各修复提交的直接调用方、失败变异、fixture 生命周期、CI/发布门禁一致性、T031 上下游文档一致性、轮末完整本地门禁。
- 排除：用户既有未提交文件 `docs/quant-factor-research-tradingview-assessment.md`，未修改、未纳入结论。

## Issue 总表

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F009-CODE-R1-001 | 主区域不可滚动 | High | 正确性 | 根因 | 初始实现 | 已修复 | main 成为纵向滚动 owner | f009-shell R1-001 | 1 | 2 | scroll-container-missing |
| F009-CODE-R1-002 | Composer 状态在缓存任务间串用 | High | 正确性 | 根因 | 初始实现 | 已修复 | 按 task key 隔离状态 | f009-execution-host task-key 回归 | 1 | 2 | route-scoped-state-leak |
| F009-CODE-R1-003 | 生产界面无显式丢弃草稿动作 | High | 正确性 | 根因 | 初始实现 | 已修复 | 增加丢弃动作 | f009-execution-host discard 回归 | 1 | 2 | marked-done-not-implemented |
| F009-CODE-R1-004 | 历史工作流页不可发现 | High | 正确性 | 根因 | 初始实现 | 已修复 | 增加真实设置目录 | f009-shell BC-097 | 1 | 2 | route-exists-but-undiscoverable |
| F009-CODE-R1-005 | 黄金旅程未执行冻结关键动作 | High | 测试覆盖 | 根因 | 初始实现 | 已修复 | 真实执行 J1-J9 写动作 | f009-golden-journey | 1 | 3 | test-simulates-itself |
| F009-CODE-R1-006 | adapted 行未锁住全部生产交互实例 | High | 测试覆盖 | 根因 | 初始实现 | 延续 | 已补主要 dialog，但 Edit 触发分支仍未被测试 | f009-a11y BC-049，证据不足 | 1 | — | acceptance-subset-without-denominator |
| F009-CODE-R1-007 | 错误与空状态恢复合同不完整 | High | 正确性 | 根因 | 初始实现 | 已修复 | 五个 query surface 均可真实重试 | 相邻 F009 recovery tests | 1 | 3 | partial-symmetric-fix |
| F009-CODE-R1-008 | 未覆盖真实 server 首启迁移 | Medium | 测试覆盖 | 根因 | 初始实现 | 已修复 | server 首启迁移 v10 fixture | golden journey J1 | 1 | 2 | integration-seam-not-exercised |
| F009-CODE-R1-009 | popstate 监听生命周期错误 | Medium | 正确性 | 根因 | 初始实现 | 已修复 | 首订阅注册、末订阅注销 | f009-shell subscriber 回归 | 1 | 2 | shared-listener-lifetime |
| F009-CODE-R1-010 | Graph 弹窗提前关闭 | Medium | 正确性 | 根因 | 初始实现 | 已修复 | 失败保留、成功关闭 | f009-execution-host graph dialog | 1 | 2 | async-dialog-closes-before-outcome |
| F009-CODE-R1-011 | 完成标记与执行证据不一致 | Medium | 测试覆盖 | 根因 | 流程缺口 | 延续 | tasks/matrix 已改写，但上游规格和实跑记录仍矛盾 | 当前只锁 commit hash | 1 | — | marked-done-not-recorded |
| F009-CODE-R1-012 | format 门禁漏掉 F009 文件 | Medium | 质量 | 根因 | 初始实现 | 已修复 | 扩展 format targets | npm run format:check | 1 | 2 | gate-coverage-gap |
| F009-CODE-R1-013 | DataTable 字符串化 ReactNode | Low | 质量 | 根因 | 初始实现 | 已修复 | ReactNode 原样渲染 | f009-primitives custom render | 1 | 2 | render-contract-stringifies-node |
| F009-CODE-R2-014 | tabs 只切选中态不切面板 | Medium | 正确性 | 根因 | 修复回归 | 已修复 | panel 与 active tab 绑定 | f009-a11y BC-052 | 2 | 3 | control-state-not-bound-to-content |
| F009-CODE-R2-015 | 回归测试未等待 React 更新 | Medium | 测试覆盖 | 根因 | 修复回归 | 已修复 | popstate 由 act 包裹 | 两个目标 web test | 2 | 3 | unawaited-react-update |
| F009-CODE-R3-016 | Fake adapter 生产入口未被测试锁定 | High | 测试覆盖 | 症状补丁 | 修复回归 | 延续 | 当前有 opt-in，但生产 call site 可无声退化 | register-adapters unit，证据不足 | 3 | — | test-double-in-production-wiring |
| F009-CODE-R3-017 | E2E invocation 生命周期与清理不完整 | High | 正确性 | 症状补丁 | 修复回归 | 延续 | 当前隔离有效，但入口测试和 teardown 失效 | fixture builder concurrency，证据不足 | 3 | — | shared-fixed-temp-path |
| F009-CODE-R3-018 | CI/发布门禁一致性未锁定 | Medium | 测试覆盖 | 症状补丁 | 修复回归 | 延续 | workflow 当前已补 step，但无契约测试 | — | 3 | — | release-gate-diverges-from-ci |

## 未闭合的独立证据

1. **R1-006（High）**：生产代码 `AdapterSettings.tsx:34-37` 为 Edit 分支捕获焦点，但新增 E2E 在 `f009-a11y.spec.ts:167-172` 只点击 “Configure adapter”。临时删除 `openEdit()` 的焦点捕获后，目标 BC-049 用例仍 1/1 通过。测试注释声称 “create + edit” 共用覆盖，实际没有执行 Edit 分支。该 finding 已连续超过三轮未闭合，下一步不能继续补散点断言，应先把 dialog/trigger 实例清单做成可执行分母，再参数化覆盖每个分支。

2. **R3-016（High）**：`server/src/index.ts:78,131` 当前确实仅在 `ENABLE_FAKE_ADAPTER=1` 时 opt-in；但测试仅直接调用 `registerAgentAdapters(... false)`。临时把生产常量改成恒真后，`register-adapters.test.ts` 与 fixture 定向测试仍 11/11 通过。因此原生产装配错误可以在真正 call site 原样复发而不红。应把环境解析与 registry construction 收进一个可导入的 production composition 函数，并直接断言默认环境构造出的 registry 不含 fake。

3. **R3-017（High）**：当前两次同配置、不同端口的真实并发 smoke 均通过，证明 `mkdtemp` 行为已消除互删库；但回归测试在 `f009-v02-fixture.test.ts:324-355` 自己预先创建两个不同目录，只验证 builder 接受两个目录，完全绕过 `createInvocationDir()`。临时把 `createInvocationDir()` 改回固定共享路径后，该测试仍通过。此外，每次成功 Playwright 运行后，`/tmp/personahub-e2e-*` 仍留下 SQLite 与 graph workspace；本轮 a11y、主库、空库及两次并发 smoke 均各自留下目录，时间戳与运行一一对应，说明 `invocation-dir-teardown.ts:8-9` 实际未清理创建目录。主 config 的 `test-results` 与 HTML report 也仍是并发共享固定路径。应以真实 invocation lifecycle 做并发回归，并断言运行结束后目录消失；路径应显式传给 teardown，不能依赖 config/globalTeardown 跨执行上下文共享可变环境变量。

4. **R1-011（Medium）**：`tasks.md:48` 和 journey matrix 现将主观走查改为持续性、非阻塞活动；但上游 `spec.md:136`、`design.md:177-181,196-200` 仍明确要求 T031 人工确认并要求“不把未执行写成通过”。journey matrix `:137-138` 还保留 production index 注册 fake 与固定 `/tmp/f009-graphok-workspace` 的旧叙述。Round 8 FIX-log 声称主 E2E 30/30、server 1695 tests，独立实跑分别为 31/31、1692 passed。原“完成标记与证据不一致”仍成立。该 finding 已超过三轮，按不收敛协议需要规格裁决：要么同步修改 spec/design 并明确批准新验收口径，要么执行原定人工记录，不能只改下游 tasks/matrix。

5. **R3-018（Medium）**：CI 当前已运行 `test:e2e:empty-db`，行为修复成立；但临时删除该 step 后，`npm run test:docs` 仍 129/129 通过，仓库没有任何测试约束 CI 必须覆盖 `verify:release` 的两套 E2E。按“门禁必须做失败变异”的项目规则仍不能关闭。建议增加一个静态契约测试，解析根 scripts 与 workflow，断言两者包含相同 E2E 集合；同时让 empty-db 失败时上传对应 report/trace。

所有变异均已恢复；formatter 已恢复实验触及文件的 CRLF，最终 `git diff --quiet HEAD` 确认无检视实验残留。

## 验证记录

- `npm run verify`：通过。
  - server：129 files passed、11 skipped；1692 tests passed、29 skipped。
  - web：31 files / 268 tests passed。
  - lint、format、typecheck、feature/docs/link/ownership/e2e-fixme/bug-log 门禁全部通过。
- `npm run build`：通过；Vite 1771 modules transformed。
- BC-049 完整 a11y spec：7/7 通过。
- 主 Playwright：31/31 通过。
- empty-db Playwright：4/4 通过。
- 两个真实主配置并发 smoke：1/1 + 1/1 通过；隔离有效，但两者均留下 invocation 目录。
- `git diff --check`：通过；工作树仅保留用户原有量化研究文档改动。
- 全量 web test 仍从本轮 diff 外的 `f009-primitives.test.tsx`、`f009-routes.test.tsx` 输出 React `act()` 告警，`f009-pages.test.tsx` 输出 undefined query data 告警；按 diff-only 作为既有质量观察，不新增 finding。
- 最终 CI：未触发。Critical/High 未清零，不满足收敛候选轮前置条件。

## 下一步与不收敛升级

R1-006、R1-011 已连续至少三轮未闭合，触发 `review-convergence` 的不收敛升级协议：停止继续做同形态散点补丁。R1-006 应先建立“生产 dialog × 触发分支”的可执行 inventory，再让一条参数化回归覆盖完整分母；R1-011 需要在 spec/design 与 tasks/matrix 之间作一次明确规格裁决并同步全部证据。

R3-016、R3-017、R3-018 则应分别从 production composition、真实 invocation lifecycle、CI/release script parity 三个入口锁定不变量。完成后再运行定向失败变异、`npm run verify`、build 与两套 E2E；只有 High 清零且本地全绿，才进入最终 CI 候选轮。
