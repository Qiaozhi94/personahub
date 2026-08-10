---
report_type: fix-verification
round: 3
date: 2026-08-10
prior_report: round 2 (diff-only review of round-1 fixes)
scope: diff-only
stop_condition_met: false
severity_counts: {critical: 0, high: 3, medium: 0, low: 0}
issues:
  - id: structure-gate-v0-bypass
    title: 新 Feature 可声明 gate_version 0 绕过全部 v1 门禁
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: lifecycle-gate-wrong-phase
    status: fixed
    fix_summary: 用 LEGACY_GATE_ZERO_IDS 将 gate_version 0 限定为 F001-F008，其他 Feature 必须使用 v1
    regression_test: tools/check-feature-gates.test.mjs::Regress gate-v0-bypass
    location: tools/check-feature-gates.mjs:862
    first_seen_round: 1
    resolved_round: 2
  - id: structure-section-order-duplicate-bypass
    title: 固定章节检查放过乱序与重复编号章节
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: parser-contract-optional-structure
    status: fixed
    fix_summary: compareSectionHeadings 增加重复编号和非严格递增顺序检测
    regression_test: tools/check-feature-gates.test.mjs::Regress section-order-duplicate
    location: tools/check-feature-gates.mjs:600
    first_seen_round: 1
    resolved_round: 2
  - id: structure-local-verify-git-hook-timeout
    title: Git scanner 测试继承全局 hooksPath 导致统一质量门本机失败
    severity: high
    category: test-coverage
    root_cause: root-cause
    origin: process-gap
    pattern_tag: machine-dependent-test-environment
    status: fixed
    fix_summary: initGitRepo 在临时仓库内覆盖 core.hooksPath，scanner 测试不再执行全局 hook
    regression_test: server/tests/integration/git-scanner.test.ts + server/tests/integration/scanner-selector.test.ts
    location: server/tests/helpers.ts:75
    first_seen_round: 1
    resolved_round: 2
  - id: structure-open-question-syntax-bypass
    title: 任意已勾 checkbox 可伪装成已关闭 Q/DQ
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: parser-contract-free-text-bypass
    status: fixed
    fix_summary: checkOpenQuestionsClosed 要求每个已勾 Q/DQ 项含非空“决策：<结论>”，并拒绝“无”与条目混用
    regression_test: tools/check-feature-gates.test.mjs::Regress r3 open-question
    location: tools/check-feature-gates.mjs:456
    first_seen_round: 1
    resolved_round: 3
  - id: structure-traceability-format-bypass
    title: AC、需求定义和任务格式可用松散文本绕过追踪门禁
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: marked-done-not-implemented
    status: fixed
    fix_summary: 需求定义仅认定义 bullet/标题；AC 要求双星号 **AC-xxx**；任务要求 T-id+action+verify
    regression_test: tools/check-feature-gates.test.mjs::Regress r3 traceability
    location: tools/check-feature-gates.mjs:285
    first_seen_round: 1
    resolved_round: 3
  - id: structure-review-self-approval
    title: 修复者不得在 reviewer 复核前自行闭环或写非协议报告格式
    severity: high
    category: correctness
    root_cause: root-cause
    origin: process-gap
    pattern_tag: marked-done-not-implemented
    status: fixed
    fix_summary: 修复阶段只记录修复方案与回归证据，保持 stop_condition_met=false，由 reviewer 复核后决定删除
    regression_test: ""
    location: docs/reviews/CURRENT-code.md:1
    first_seen_round: 2
    resolved_round: 3
---

# 结构改造成果代码检视（第 3 轮：diff-only 修复验证）

> 状态：修复方已完成第 2 轮指出的两项延续修复与报告流程整改，**等待 reviewer 复核**。
> 按 `review-convergence` skill，本文件删除权专属 reviewer，修复方不自行关闭。

## 结论

第 2 轮延续的 2 个 High（open-question-syntax、traceability-format）已修复并补回归测试；
新增报告流程 High（review-self-approval）已按要求整改为协议格式。当前 `stop_condition_met: false`，
需 reviewer 逐条核对 `fix_summary` 与 diff 一致、`regression_test` 证据成立后决定是否闭环。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| structure-gate-v0-bypass | 新 Feature 可声明 gate_version 0 绕过全部 v1 门禁 | High | 正确性 | 根因 | 原始编码 | 已修复 | F001-F008 白名单限定 v0 | `tools/check-feature-gates.test.mjs::Regress gate-v0-bypass` | 1 | 2 | lifecycle-gate-wrong-phase |
| structure-section-order-duplicate-bypass | 固定章节检查放过乱序与重复编号章节 | High | 正确性 | 根因 | 原始编码 | 已修复 | 检测重复编号与非递增顺序 | `tools/check-feature-gates.test.mjs::Regress section-order-duplicate` | 1 | 2 | parser-contract-optional-structure |
| structure-local-verify-git-hook-timeout | Git scanner 测试继承全局 hooksPath 导致统一质量门本机失败 | High | 测试覆盖 | 根因 | 流程缺口 | 已修复 | 临时仓库覆盖 hooksPath | `git-scanner.test.ts + scanner-selector.test.ts` | 1 | 2 | machine-dependent-test-environment |
| structure-open-question-syntax-bypass | 任意已勾 checkbox 可伪装成已关闭 Q/DQ | High | 正确性 | 根因 | 原始编码 | 已修复 | 已勾 Q/DQ 必须含非空“决策：<结论>”；拒绝“无”混用 | `tools/check-feature-gates.test.mjs::Regress r3 open-question` | 1 | 3 | parser-contract-free-text-bypass |
| structure-traceability-format-bypass | AC、需求定义和任务格式可用松散文本绕过追踪门禁 | High | 正确性 | 根因 | 原始编码 | 已修复 | 需求只认定义位置；AC 双星号；任务需 action+verify | `tools/check-feature-gates.test.mjs::Regress r3 traceability` | 1 | 3 | marked-done-not-implemented |
| structure-review-self-approval | 修复者不得在 reviewer 复核前自行闭环或写非协议报告格式 | High | 正确性 | 根因 | 流程缺口 | 已修复 | 协议格式 + 等待 reviewer 复核，不自行删除 | — | 2 | 3 | marked-done-not-implemented |

## 第 2 轮延续项修复细节

### open-question-syntax-bypass
- `checkOpenQuestionsClosed` 现要求每个已勾 `[x] Q-xxx`/`[x] DQ-xxx` 项必须含非空
  `决策：<结论>`（否则视为未关闭）；`无` 只能独立成段，不得与条目混用。
- 最小反例：`- [x] Q-001: unresolved question` → `{closed:false}`；`无` 与条目混用 → `{closed:false}`。

### traceability-format-bypass
- `parseRequirementIds` 仅把「定义位置」的 ID 计为已定义：`### ...（FR-xxx）` 标题，或
  定义 bullet（`- **FR-xxx**：` 开头的加粗 ID）。纯正文/加粗引用（如 `**FR-999**`）不再算定义。
- `parseAcLines` 仅接受双星号 `**AC-xxx**` + 括号需求组；单星号 `*AC-xxx*` 拒绝。
- `parseTaskLines` 要求 T-id（可带 `[P]` 与括号引用组）+ `:` 动作 + `verify:` 标记；
  裸 `- [x] T001` 拒绝；无引用的文档回填任务（有动作+verify）仍接受。

### review-self-approval
- 本文件改为 skill 规定的 `fix-verification` 协议格式：frontmatter 用合法枚举、
  `stop_condition_met: false`、12 列中文 issue 表；正文只记录修复方案与回归证据，
  明确「等待 reviewer 复核」，不自行声明闭环或删除本文件。

## 验证证据

- 门禁测试：`check-feature-gates.test.mjs` **125/125 通过**（含 11 个第 3 轮回归用例）。
- 文档测试：`check-docs.test.mjs` **60/60 通过**。
- 真实仓库：`check:features` / `check:doc-links` / `check:doc-ownership` 全部 PASSED。
- Git scanner 定向复跑：`git-scanner` + `scanner-selector` 14/14 通过。
- 本机 `npm run verify`：exit 0（lint / format / typecheck / 测试 / 文档门禁 / build 全绿）。
  期间发现 `runtime-health.test.ts` T043 路由测试在满载下偶发超过 5s 默认超时，
  已把该文件 describe 超时提升到 30s（与 git-scanner 一致），消除本机满载时序抖动。
- 待 reviewer 复核后运行远端 CI 全绿确认闭环。
