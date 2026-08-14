---
report_type: doc-review
round: 3
date: 2026-08-14
prior_report: docs/reviews/CURRENT-doc.md@round-2
scope: diff-only
stop_condition_met: false
severity_counts: {critical: 0, high: 0, medium: 0, low: 0}
issues:
  - id: JRN-DOC-004
    title: P0 manual assignment conflicts with PRD automatic handoff
    severity: high
    category: correctness
    root_cause: root-cause
    origin: spec-drift
    pattern_tag: cross-feature-contract-drift
    status: fixed
    fix_summary: Unified current product truth sources on manual stage assignment while preserving automatic Handoff Packet generation.
    regression_test: docs/personahub-prd.md::manual-stage-state-machine
    location: docs/personahub-prd.md:776
    first_seen_round: 1
    resolved_round: 2
  - id: JRN-DOC-005
    title: Validation failure both auto-starts repair and waits for assignment
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: contradictory-state-transition
    status: fixed
    fix_summary: Validation failure now returns to Ready/waiting for assignment and never starts a repair Run in P0.
    regression_test: docs/personahub-user-journeys.md::J3.4
    location: docs/personahub-user-journeys.md:260
    first_seen_round: 1
    resolved_round: 2
  - id: JRN-DOC-006
    title: Onboarding requires two adapters while declaring only one mandatory
    severity: medium
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: contradictory-onboarding-gate
    status: fixed
    fix_summary: One AI member is now sufficient; a second independent member is a clearly optional recommendation, with adapter terminology hidden.
    regression_test: docs/personahub-user-journeys.md::J1.4-J1.5
    location: docs/personahub-user-journeys.md:187
    first_seen_round: 1
    resolved_round: 2
  - id: JRN-DOC-007
    title: Manual flow lacks a re-entry attention priority
    severity: medium
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: missing-attention-routing
    status: fixed
    fix_summary: Added needs-user-first task ordering, an in-app attention signal, and a five-task timed acceptance check.
    regression_test: docs/personahub-user-journeys.md::observable-acceptance-metric-9
    location: docs/personahub-user-journeys.md:348
    first_seen_round: 1
    resolved_round: 2
  - id: JRN-DOC-008
    title: Completed-task journey asks what next but provides no P0 next action
    severity: medium
    category: quality
    root_cause: root-cause
    origin: original-coding
    pattern_tag: incomplete-journey-endpoint
    status: fixed
    fix_summary: Added immutable Done follow-up actions that reuse the existing task-creation path without requiring a new relation model.
    regression_test: docs/personahub-user-journeys.md::J4.4
    location: docs/personahub-user-journeys.md:429
    first_seen_round: 1
    resolved_round: 2
  - id: JRN-DOC-009
    title: Current M3 task wording and progress lag behind the four-journey draft
    severity: medium
    category: quality
    root_cause: root-cause
    origin: process-gap
    pattern_tag: marked-done-not-recorded
    status: fixed
    fix_summary: Updated four-journey wording, recorded the manual-mode decision, and marked completed M3-T01 through M3-T06 work.
    regression_test: docs/reviews/product-experience-reset-plan.md::M3-progress
    location: docs/reviews/product-experience-reset-plan.md:717
    first_seen_round: 1
    resolved_round: 2
  - id: JRN-DOC-010
    title: Round-two fix rewrites a historical three-journey record as four journeys
    severity: medium
    category: quality
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: historical-record-rewrite
    status: fixed
    fix_summary: Restored the dated three-journey fact and added a separate sentence for the later four-journey expansion.
    regression_test: docs/reviews/product-experience-reset-plan.md::M1-decision-record
    location: docs/reviews/product-experience-reset-plan.md:678
    first_seen_round: 2
    resolved_round: 3
  - id: JRN-DOC-011
    title: Unversioned automatic mode conflicts with the old P1-to-version mapping
    severity: medium
    category: correctness
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: cross-feature-contract-drift
    status: fixed
    fix_summary: Reframed priority tiers for the product reset and kept automatic continuation unversioned until P0 dogfood.
    regression_test: docs/personahub-prd.md::priority-to-version-boundary
    location: docs/personahub-prd.md:894
    first_seen_round: 2
    resolved_round: 3
  - id: JRN-DOC-012
    title: Done follow-up fix implies a new task-relation model in P0
    severity: medium
    category: quality
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: fix-expands-scope
    status: fixed
    fix_summary: Reused the existing create-task entry with a prefilled summary and explicitly excluded a new P0 relation model.
    regression_test: docs/personahub-user-journeys.md::J4.4
    location: docs/personahub-user-journeys.md:429
    first_seen_round: 2
    resolved_round: 3
---

# 用户旅程文档检视

结论：第 3 轮 diff-only 复核通过。P0 行为已经统一为“阶段完成或 validation fail 后等待用户
指派”，自动 Handoff Packet 生成与自动派发已明确分开；自动继续作为 P0 dogfood 后再定版本的
候选。Critical/High 已清零，文档门禁通过后仍需用户明确批准完整旅程，故
`stop_condition_met` 保持 `false`。

检查清单：P0 范围、PRD/旅程状态机一致性、手动指派主路径、validation fail 恢复、首次配置
门槛、重新进入时的注意力路由、Done 后续动作、自动模式后移边界、文档计划进度。

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| JRN-DOC-004 | P0 手动指派与 PRD 自动 handoff 冲突 | High | 正确性 | 根因 | 契约漂移 | fixed | 当前真相源统一为手动阶段指派，保留自动生成交接包 | `docs/personahub-prd.md::manual-stage-state-machine` | 1 | 2 | cross-feature-contract-drift |
| JRN-DOC-005 | 验证失败同时被写成自动修复和等待指派 | High | 正确性 | 根因 | 初稿 | fixed | fail 回 Ready/等待指派，P0 不自动创建修复 Run | `docs/personahub-user-journeys.md::J3.4` | 1 | 2 | contradictory-state-transition |
| JRN-DOC-006 | 首次配置同时要求两个 adapter 又声明只需一个 | Medium | 质量 | 根因 | 初稿 | fixed | 一个 AI 成员即可开始，第二个仅为独立验证建议 | `docs/personahub-user-journeys.md::J1.4-J1.5` | 1 | 2 | contradictory-onboarding-gate |
| JRN-DOC-007 | 手动流程缺少重新进入后的注意力优先级 | Medium | 质量 | 根因 | 初稿 | fixed | 增加需用户优先排序、应用内提示和五任务计时验收 | `docs/personahub-user-journeys.md::observable-acceptance-metric-9` | 1 | 2 | missing-attention-routing |
| JRN-DOC-008 | 完成旅程提出“然后呢”但没有 P0 后续动作 | Medium | 质量 | 根因 | 初稿 | fixed | Done 保持不可变，复用现有创建入口承接后续工作 | `docs/personahub-user-journeys.md::J4.4` | 1 | 2 | incomplete-journey-endpoint |
| JRN-DOC-009 | 当前 M3 任务措辞与进度落后于四旅程草稿 | Medium | 质量 | 根因 | 流程缺口 | fixed | 当前任务改为四旅程并回写 M3-T01 至 T06 进度；历史三旅程记录保持原样 | `docs/reviews/product-experience-reset-plan.md::M3-progress` | 1 | 2 | marked-done-not-recorded |
| JRN-DOC-010 | 第 2 轮修复把历史三旅程记录改写成四旅程 | Medium | 质量 | 根因 | 修复引入 | fixed | 恢复当时三旅程事实，另记后续扩展为四旅程 | `docs/reviews/product-experience-reset-plan.md::M1-decision-record` | 2 | 3 | historical-record-rewrite |
| JRN-DOC-011 | 未定版本的自动模式与旧 P1—版本映射冲突 | Medium | 正确性 | 根因 | 修复引入 | fixed | 重置期优先级不再与历史版本机械绑定，自动模式保持未分配版本 | `docs/personahub-prd.md::priority-to-version-boundary` | 2 | 3 | cross-feature-contract-drift |
| JRN-DOC-012 | Done 后续动作修复暗含新增 P0 任务关系模型 | Medium | 质量 | 根因 | 修复引入 | fixed | 复用现有创建入口并自动带摘要，明确不新增关系模型 | `docs/personahub-user-journeys.md::J4.4` | 2 | 3 | fix-expands-scope |
