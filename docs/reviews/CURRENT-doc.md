---
report_type: doc-review
round: 4
cycle: 2
cycle_round: 2
date: 2026-08-11
prior_report: CURRENT-doc.md (cycle 1 round 3)
scope: diff-only
stop_condition_met: false
severity_counts: {critical: 0, high: 0, medium: 0, low: 0}
issues:
  - id: F009-DOC-001
    title: SQLite 与文件系统之间缺少可恢复的一致性协议
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: cross-resource-atomicity-gap
    status: fixed
    fix_summary: 明确 rename-then-commit、失败补偿、启动时孤儿隔离及提交后广播语义，不再宣称跨资源真原子。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/design.md::5.1
    location: docs/features/0.3/F009-artifact-foundation-provenance/design.md:144
    first_seen_round: 1
    resolved_round: 2
  - id: F009-DOC-002
    title: revise CAS 没有定义调用方提交的基线 revision
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: optimistic-concurrency-without-precondition
    status: fixed
    fix_summary: revise 强制 expected_revision，单条 CAS 失败立即 409，服务端不再自动重放陈旧编辑。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/spec.md::IR-001
    location: docs/features/0.3/F009-artifact-foundation-provenance/spec.md:139
    first_seen_round: 1
    resolved_round: 2
  - id: F009-DOC-003
    title: local_file_path 同时被定义为输入源路径和不可变归档路径
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: storage-source-identity-conflation
    status: fixed
    fix_summary: source/archive locator 已拆分；source 采用 open-then-verify-then-read，并新增静态与竞态路径测试任务。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/spec.md::AC-003
    location: docs/features/0.3/F009-artifact-foundation-provenance/design.md:148
    first_seen_round: 1
    resolved_round: 3
  - id: F009-DOC-004
    title: archived ref 的历史解析与新引用限制缺少可判定边界
    severity: high
    category: correctness
    root_cause: root-cause
    origin: original-coding
    pattern_tag: lifecycle-context-missing
    status: fixed
    fix_summary: 拆分 resolvePinned 与 validateAttachableRef，并定义重复 archive 不追加事件。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/spec.md::AC-006
    location: docs/features/0.3/F009-artifact-foundation-provenance/spec.md:123
    first_seen_round: 1
    resolved_round: 2
  - id: F009-DOC-005
    title: 验收与任务门禁未覆盖完整公开契约
    severity: medium
    category: test-coverage
    root_cause: root-cause
    origin: process-gap
    pattern_tag: acceptance-contract-gap
    status: fixed
    fix_summary: CAS 测试改为一 stale 加两 current writer；新增 T016，并在 F010 assembler/fan-in 任务中接入 attach 校验与阻塞断言。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/tasks.md::T015-T016
    location: docs/features/0.3/F009-artifact-foundation-provenance/tasks.md:51
    first_seen_round: 1
    resolved_round: 3
  - id: F009-DOC-006
    title: 确定性归档路径在并发 revise 下发生写入碰撞
    severity: high
    category: correctness
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: pre-cas-shared-side-effect
    status: fixed
    fix_summary: archived locator 改为 artifact 内按 content_sha256 寻址；CAS 败者不盲删，延迟孤儿扫描按所有 revision 引用判定。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/spec.md::AC-007
    location: docs/features/0.3/F009-artifact-foundation-provenance/design.md:150
    first_seen_round: 2
    resolved_round: 3
  - id: F009-DOC-007
    title: inline_markdown 被错误纳入文件归档协议
    severity: high
    category: correctness
    root_cause: root-cause
    origin: fix-regression
    pattern_tag: storage-branch-contract-collapse
    status: fixed
    fix_summary: inline_markdown 与 local_file 拆成纯 DB 与文件系统加 DB 两条独立协议，并补充双分支故障注入任务。
    regression_test: docs/features/0.3/F009-artifact-foundation-provenance/spec.md::FR-004
    location: docs/features/0.3/F009-artifact-foundation-provenance/design.md:151
    first_seen_round: 3
    resolved_round: 4
---

# F009 开发前文档检视

结论：**新周期第 2 轮通过，当前无 open finding；文档正确性与本地验证已收敛。** F009-DOC-007 已按 storage type 拆成两条独立协议，本轮定向复核未发现 fix-regression。外部 CI 尚未执行，因此报告继续保留，不能标记最终关闭。

## 有限检查清单

- [x] inline 分支只写 `inline_content`，不触碰文件系统
- [x] local-file 分支独占 open/verify/read、temp/archive 与孤儿恢复
- [x] 两分支分别满足 CAS 与事件提交边界
- [x] CHECK 约束与 storage DTO 一致
- [x] 双分支故障注入和负向文件副作用断言

## 正确性通道

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F009-DOC-001 | SQLite 与文件系统之间缺少可恢复的一致性协议 | High | 正确性 | 根因 | 初始设计 | Fixed | 已明确 local-file 的 rename-then-commit、失败补偿、启动孤儿隔离与提交后广播语义。 | `design.md::5.1` | 1 | 2 | cross-resource-atomicity-gap |
| F009-DOC-002 | revise CAS 没有定义调用方提交的基线 revision | High | 正确性 | 根因 | 初始设计 | Fixed | revise 强制 `expected_revision`；CAS 失败立即 409，不重试。 | `spec.md::IR-001` | 1 | 2 | optimistic-concurrency-without-precondition |
| F009-DOC-003 | local_file_path 同时被定义为输入源路径和不可变归档路径 | High | 正确性 | 根因 | 初始设计 | Fixed | source/archive locator 已拆分；source 使用同一打开句柄完成 identity/containment 校验与读取，并补静态/竞态验证。 | `spec.md::AC-003` | 1 | 3 | storage-source-identity-conflation |
| F009-DOC-004 | archived ref 的历史解析与新引用限制缺少可判定边界 | High | 正确性 | 根因 | 初始设计 | Fixed | `resolvePinned` 与 `validateAttachableRef` 分离；archive 幂等。 | `spec.md::AC-006` | 1 | 2 | lifecycle-context-missing |
| F009-DOC-006 | 确定性归档路径在并发 revise 下发生写入碰撞 | High | 正确性 | 根因 | 修复引入 | Fixed | locator 改为 artifact 内 content-addressed；CAS 败者不盲删共享文件，孤儿判定检查所有 revision 引用。一个 stale + 两个 current writer 的测试锁定胜负文件互不干扰。 | `spec.md::AC-007` | 2 | 3 | pre-cas-shared-side-effect |
| F009-DOC-007 | inline_markdown 被错误纳入文件归档协议 | High | 正确性 | 根因 | 修复引入 | Fixed | design §5.1 将 inline 固定为单一 DB 事务，写 `inline_content` 且 `relative_path=NULL`；§5.2 仅供 local file 使用。T011/T012/T014 分别锁定分派、文件协议与故障注入，断言 inline 不产生文件、local 不写 `inline_content`。 | `spec.md::FR-004` | 3 | 4 | storage-branch-contract-collapse |

## 质量通道

| ID | 标题 | 严重度 | 分类 | 根因/症状 | 来源 | 状态 | 修复方案 | 回归测试 | 首次出现轮次 | 修复轮次 | 模式标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F009-DOC-005 | 验收与任务门禁未覆盖完整公开契约 | Medium | 测试覆盖 | 根因 | 流程缺口 | Fixed | T015 改为一 stale + 两 current writer；T016 明确服务方法测试；F010 spec/design/tasks 将 archived ref 计入 omitted 原因并阻塞节点、不创建部分状态。 | `tasks.md::T015-T016` | 1 | 3 | acceptance-contract-gap |

## 已通过的门禁

- `npm run verify` 的组成门禁（拆分执行；聚合命令两次因 120/300 秒上限中止，非测试失败）
- `npm test`（server：126 files / 1675 tests；web：25 files / 216 tests）
- `npm run test:feature-gates`、`npm run test:docs`
- `npm run check:features`
- `npm run check:doc-links`
- `npm run check:doc-ownership`
- `npm run build`
- `git diff --check`

以上均通过。首次受限环境构建因 `server/dist/**` 写入返回 `EPERM`；授权写入后完整生产构建通过，确认不是文档变更造成的构建失败。

## 剩余关闭门禁

本轮请求仅授权检视，未授权提交或推送；且当前分支含既有未推送提交 `5f819c0`。因此尚未触发外部 CI，也不删除本报告。待 co-creator 确认提交/推送范围后，运行 CI；CI 全绿后归档回顾并由 reviewer 删除 `CURRENT-doc.md`。
