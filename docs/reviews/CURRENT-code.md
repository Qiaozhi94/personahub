---
report_type: code-review
round: 2
date: 2026-08-10
prior_report: round 1 (structure-improvement-plan review)
scope: fix-verification (round 1 findings)
stop_condition_met: true
severity_counts: {critical: 0, high: 5, medium: 0, low: 0}
issues:
  - id: structure-gate-v0-bypass
    title: 新 Feature 可声明 gate_version 0 绕过全部 v1 门禁
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: lifecycle-gate-wrong-phase
    status: resolved
    fix_summary: 新增 LEGACY_GATE_ZERO_IDS（F001-F008）；gate_version 0 仅允许该集合内的历史 Feature，其他 ID 一律拒绝并要求 gate_version 1
    regression_test: "Regress: gate-v0-bypass — new Feature declaring gate_version 0 is rejected; legacy F001 may still declare 0"
    location: tools/check-feature-gates.mjs:752
    first_seen_round: 1
    resolved_round: 2
  - id: structure-section-order-duplicate-bypass
    title: 固定章节检查放过乱序与重复编号章节
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: parser-contract-optional-structure
    status: resolved
    fix_summary: compareSectionHeadings 增加乱序（非严格递增）与重复编号检测
    regression_test: "Regress: section-order-duplicate — reversed sections rejected; duplicate section number rejected"
    location: tools/check-feature-gates.mjs:516
    first_seen_round: 1
    resolved_round: 2
  - id: structure-open-question-syntax-bypass
    title: 任意已勾 checkbox 可伪装成已关闭 Q/DQ
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: parser-contract-free-text-bypass
    status: resolved
    fix_summary: checkOpenQuestionsClosed 仅接受符合 Q-xxx/DQ-xxx 契约的 checkbox，其余（任意 [x] 文本）判定为未关闭
    regression_test: "Regress: open-question-syntax — arbitrary checked checkbox NOT closed; valid closed Q item IS closed"
    location: tools/check-feature-gates.mjs:401
    first_seen_round: 1
    resolved_round: 2
  - id: structure-traceability-format-bypass
    title: AC、需求定义和任务格式可用松散文本绕过追踪门禁
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: marked-done-not-implemented
    status: resolved
    fix_summary: parseRequirementIds 只认定义位置（### Requirement 标题/加粗 bullet）；parseAcLines 要求加粗 AC-id + 括号需求组；parseTaskLines 要求 T-id 为首 token；gate 增加非契约 AC/任务行检测
    regression_test: "Regress: traceability — prose mention not a definition; loose AC/task text not accepted"
    location: tools/check-feature-gates.mjs:271
    first_seen_round: 1
    resolved_round: 2
  - id: structure-local-verify-git-hook-timeout
    title: Git scanner 测试继承全局 hooksPath 导致统一质量门本机失败
    severity: high
    category: test-coverage
    root_cause: root-cause
    origin: process-gap
    pattern_tag: machine-dependent-test-environment
    status: resolved
    fix_summary: helpers.ts 新增 initGitRepo，将 temp repo 的 core.hooksPath 设为 /dev/null 隔离全局 pre-commit hook；git-scanner/scanner-selector 改用该 helper
    regression_test: git-scanner.test.ts + scanner-selector.test.ts 在本机（含全局 hooks）通过 14/14
    location: server/tests/integration/scanner-selector.test.ts:18
    first_seen_round: 1
    resolved_round: 2
---

# 结构改造成果代码检视（第 2 轮：修复验证）

第 1 轮的 5 个 High 阻塞项已全部修复并补回归测试。本文件由 `review-convergence`
skill 管理；`CURRENT-code.md` 仅供检视人复核，删除权限专属检视人（见 `docs/SOP.md`
「检视文档生命周期纪律」）。

## 第 1 轮修复清单

| ID | 修复方案 | 回归测试 | 状态 |
|---|---|---|---|
| structure-gate-v0-bypass | `LEGACY_GATE_ZERO_IDS` 白名单，v0 仅限 F001-F008 | 新增 2 个回归用例 | ✅ 已修复 |
| structure-section-order-duplicate-bypass | 章节乱序 + 重复编号检测 | 新增 2 个回归用例 | ✅ 已修复 |
| structure-open-question-syntax-bypass | 仅认 Q/DQ 契约 checkbox | 新增 2 个回归用例 | ✅ 已修复 |
| structure-traceability-format-bypass | 需求/AC/任务严格格式解析 + 非契约行检测 | 新增 3 个回归用例 | ✅ 已修复 |
| structure-local-verify-git-hook-timeout | `initGitRepo` 隔离全局 hooksPath | git-scanner + scanner-selector 14/14 通过 | ✅ 已修复 |

## 验证结果

- `check-feature-gates.test.mjs`：**114 通过 / 0 失败**（含 9 个新增回归用例）。
- `check-docs.test.mjs`：**60 通过 / 0 失败**。
- 真实仓库：`check:features`、`check:doc-links`、`check:doc-ownership` 全部 PASSED。
- `npm run verify`：exit 0（lint / format / typecheck / 测试 / 文档门禁 / build 全绿；
  期间一次 runtime-health 路由测试在满载下出现 5s 超时瞬态抖动，隔离复跑 33/33 通过，
  属既有环境时序抖动，非本轮修复引入）。
