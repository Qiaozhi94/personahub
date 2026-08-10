---
report_type: fix-verification
round: 4
date: 2026-08-10
prior_report: round 3 (diff-only review of round-2 fixes)
scope: diff-only
stop_condition_met: false
severity_counts: {critical: 0, high: 0, medium: 0, low: 0}
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
    fix_summary: 需求定义/AC/任务 parser 与文档唯一格式对齐：定义仅认定义位置；AC 双星号；任务采用 T001 [P] 顺序并要求非空 verify 值
    regression_test: tools/check-feature-gates.test.mjs::Regress r4 task-format
    location: tools/check-feature-gates.mjs:285
    first_seen_round: 1
    resolved_round: 4
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

# 结构改造成果代码检视（第 4 轮：diff-only 修复验证）

> 状态：修复方已按 reviewer 第 3 轮结论修复任务格式契约，补回归测试；
> 等待 reviewer 复核。按 `review-convergence` skill，本文件保留，不执行删除与复盘归档。

## 结论

第 3 轮延续的 traceability-format（任务格式与文档契约相反、空 verify 值）已修复。
任务 parser 现与 `docs/features/README.md` / TEMPLATE 的唯一格式 `T001 [P] (...)` 对齐。
`severity_counts` 现为 0 个 High，但闭环仍由 reviewer 判定，`stop_condition_met: false`。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| structure-gate-v0-bypass | 新 Feature 可声明 gate_version 0 绕过全部 v1 门禁 | High | 正确性 | 根因 | 原始编码 | 已修复 | F001-F008 白名单限定 v0 | `tools/check-feature-gates.test.mjs::Regress gate-v0-bypass` | 1 | 2 | lifecycle-gate-wrong-phase |
| structure-section-order-duplicate-bypass | 固定章节检查放过乱序与重复编号章节 | High | 正确性 | 根因 | 原始编码 | 已修复 | 检测重复编号与非递增顺序 | `tools/check-feature-gates.test.mjs::Regress section-order-duplicate` | 1 | 2 | parser-contract-optional-structure |
| structure-local-verify-git-hook-timeout | Git scanner 测试继承全局 hooksPath 导致统一质量门本机失败 | High | 测试覆盖 | 根因 | 流程缺口 | 已修复 | 临时仓库覆盖 hooksPath | `git-scanner.test.ts + scanner-selector.test.ts` | 1 | 2 | machine-dependent-test-environment |
| structure-open-question-syntax-bypass | 任意已勾 checkbox 可伪装成已关闭 Q/DQ | High | 正确性 | 根因 | 原始编码 | 已修复 | 已勾 Q/DQ 必须含非空“决策：<结论>”；拒绝“无”混用 | `tools/check-feature-gates.test.mjs::Regress r3 open-question` | 1 | 3 | parser-contract-free-text-bypass |
| structure-traceability-format-bypass | AC、需求定义和任务格式可用松散文本绕过追踪门禁 | High | 正确性 | 根因 | 原始编码 | 已修复 | 需求只认定义位置；AC 双星号；任务采用 `T001 [P]` 顺序并要求非空 verify 值 | `tools/check-feature-gates.test.mjs::Regress r4 task-format` | 1 | 4 | marked-done-not-implemented |
| structure-review-self-approval | 修复者不得在 reviewer 复核前自行闭环或写非协议报告格式 | High | 正确性 | 根因 | 流程缺口 | 已修复 | 协议格式 + 等待 reviewer 复核，不自行删除 | — | 2 | 3 | marked-done-not-implemented |

## 第 3 轮延续项修复细节

### traceability-format-bypass（任务格式）
- 任务 parser 与 `docs/features/README.md` / TEMPLATE 的唯一格式对齐：
  规范顺序为 `T001 [P] (...)`（`[P]` 在 T-id 之后）。
- `parseTaskLines` 与 gate 的 `taskContractRe` 现要求：
  - T-id 打头，可选 `[P]`（位于 T-id 之后），可选括号引用组，然后 `:` 动作；
  - `verify:` 必须带非空值（反引号包裹且有内容，或非反引号文本）。空 `verify:` /
    `` verify: `` `` 均拒绝。
- 最小反例（已修复）：
  - `- [ ] T001 [P] (\`FR-001\`, \`AC-001\`): do - verify: \`x.ts\`` → 接受；
  - `- [ ] [P] T001 (\`FR-001\`): do - verify: \`x.ts\`` → 拒绝（`[P]` 位置错误）；
  - `- [ ] T001: do - verify:` / `- [ ] T001: do - verify: \`\`` → 拒绝（空 verify 值）。

### review-self-approval
- 本文件保持 skill 规定的 `fix-verification` 协议格式：合法枚举、`stop_condition_met: false`、
  12 列中文 issue 表；正文只记录修复方案与回归证据，明确「等待 reviewer 复核」，
  不自行声明闭环或删除本文件。

## 验证证据

- 门禁测试：`check-feature-gates.test.mjs` **129/129 通过**（含 4 个第 4 轮回归用例）。
- 文档测试：`check-docs.test.mjs` **60/60 通过**。
- 真实仓库：`check:features` / `check:doc-links` / `check:doc-ownership` 全部 PASSED。
- Git scanner 定向复跑：`git-scanner` + `scanner-selector` 14/14 通过。
- 本机 `npm run verify`：exit 0（lint / format / typecheck / 测试 / 文档门禁 / build 全绿）。
- 待 reviewer 复核后确认远端 CI 全绿并决定闭环。

## 待 reviewer 复核

- 任务格式反例（`T001 [P]` 接受、`[P] T001` 拒绝、空 verify 拒绝）已由回归用例锁定。
- `severity_counts` 已清零，但闭环判定权在 reviewer；确认后由 reviewer 删除本文件。
