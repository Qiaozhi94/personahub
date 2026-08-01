---
feature_ids: [F007]
related_features: [F005, F006]
topics: [coordinator, routing-recommendation, issue-intake, explainability, v0.2]
doc_kind: spec
created: 2026-08-01
updated: 2026-08-01
---

# F007：Coordinator Agent & Routing Recommendation

> Status: ready-for-development | Owner: TBD | Target: v0.2

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 15 节 v0.2 前两条完成判据（自然语言目标 → Issue；系统能说明为什么这么选）。
- **上游决策**：`docs/decisions/0007-coordinator-execution-channel.md`（v0.2 用确定性规则，不引入 LLM 执行通道，只推荐不派工）。
- **相关**：F006 提供 `orchestrator_subagent` 的执行能力；本 feature 决定何时选它。
- **功能类型**：workflow / user-facing。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：用户描述一个目标，系统给出可复核的 Issue 与执行方案建议，用户确认后才开工。

## 1. 问题与目标

### 问题

当前创建 Issue 必须手工填表（title / goal / priority），执行时还要手动 `@` 指定下一个 agent。用户需要自己知道有哪些 workflow、哪个 adapter 在当前 workspace 可用、什么时候该用多节点协作——这些判断依据系统全都有，却没有呈现给用户。

### 目标

- 用户输入一段目标描述，系统产出一份**完整的执行方案建议**：Issue 字段 + workflow template + collaboration topology + agent roster。
- 每一条建议都附带**判断依据**：命中的规则、候选集、被排除项及排除原因。
- 用户可以整体接受、逐项调整或放弃；确认后系统创建 Issue 并发起第一个 Run。
- 建议不可用时（例如无可用 adapter）给出明确的、可操作的阻塞说明，而不是静默降级。

### 非目标

- 不引入 LLM 执行通道，不做语义理解（见 ADR 0007）。
- 不自动派工——推荐与执行之间必须有用户确认。
- 不做 Agent Team Template 的持久化管理（roster 是每次推荐算出来的，不落库为可复用模板）。
- 不做 Workflow Template 的编辑（属于 F008）。

## 2. 用户场景与独立测试

### US1：从一句目标得到可执行方案（Priority: P1）

作为用户，我希望描述目标后直接拿到一份带理由的方案，以便不必自己记住有哪些模板和哪个 agent 现在能用。

**独立测试**：给定一个 Project、一个绑定 workspace 和两个可用 adapter，提交一段目标文本，断言返回的推荐包含 issue 字段、template、topology、roster 四部分，且每部分都带 `rule` 与 `candidates`。

**验收场景**：

1. Given 目标文本描述单一实现任务，when 请求推荐，then topology 为 `sequential` 且理由指明未命中多视角规则。
2. Given 目标文本要求多个独立视角的分析，when 请求推荐，then topology 为 `orchestrator_subagent` 并指向 F006 的图定义。

### US2：推荐可复核、可调整（Priority: P1）

作为用户，我希望看到系统排除了哪些选项以及为什么，以便判断该不该接受这份建议。

**独立测试**：构造一个 adapter 在 Project 级 Available 但在目标 workspace 被覆盖为 Unavailable 的场景，断言该 adapter 出现在 `excluded` 中且 `reason` 指明是 workspace 级不可用。

### US3：确认后才执行（Priority: P1）

作为用户，我希望在方案变成真实执行之前有一次确认机会。

**独立测试**：请求推荐后不确认，断言没有创建任何 Issue、Thread、Run；确认后断言按推荐值创建 Issue 且首个 Run 使用用户确认的 adapter id。

### US4：阻塞时说清楚（Priority: P2）

作为用户，我希望在系统无法给出可执行方案时知道缺什么。

**独立测试**：无任何 Available adapter 时请求推荐，断言返回明确的阻塞原因与建议动作，且不创建 Issue。

## 3. 范围

### 范围内

- 推荐服务：输入目标文本 + projectId，输出结构化推荐与解释。
- 确认接口：把推荐落成 Issue + 首个 Run。
- Intake UI：输入框、推荐结果展示、逐项调整、确认/取消。
- 规则集与解释模型的定义和测试。

### 范围外

- LLM 调用、语义理解、Coordinator 自身作为 agent 执行（ADR 0007）。
- 自动派工、误判回滚路径。
- Workflow Template 编辑与 runtime health（F008）。
- Agent Team Template 持久化。

### 边界场景

- 目标文本为空、超长、或只有空白字符。
- Project 未绑定 workspace（现有 `create()` 已对此抛 `PROJECT_WORKSPACE_REQUIRED`）。
- 无 Available adapter，或只有一个 adapter 但推荐的 topology 需要两个执行者。
- 用户在确认前修改了 adapter 配置，导致确认时推荐已失效。

## 4. 初始需求边界

- **FR-001**：推荐服务应输出 issue 字段、workflow template、collaboration topology、agent roster 四部分，每部分带 `rule`、`candidates`、`excluded[]{id, reason}`。
- **FR-002**：推荐逻辑必须完全确定性——相同输入与相同系统状态必须产出相同推荐（可测试）。
- **FR-003**：推荐不得创建任何持久化实体；只有确认接口才写库。
- **FR-004**：确认时必须重新校验推荐前提，前提已变则拒绝并要求重新推荐，不得按过期推荐执行。
- **FR-005**：adapter 选择必须经 `resolveAdapter()`，不得绕过其"永不猜测"纪律（ADR 0007 第 3 节）。
- **FR-006**：无可执行方案时返回结构化阻塞原因，不得静默降级为任意可用项。
- **TR-001**：推荐结果与用户最终选择的差异应写入 ThreadEvent，供事后复核。
- **NFR-001**：推荐为纯内存计算，不得获取 workspace 锁、不得创建 Run。

## 5. 成功标准

- **SC-001**：一段目标文本可在一次交互内得到完整方案，确认后进入执行。
- **SC-002**：每条推荐的依据在 UI 上可见，包含被排除项及原因。
- **SC-003**：推荐的确定性由测试保证；相同状态重复请求结果一致。

## 6. 验收清单

- [ ] **AC-001**（`FR-001`、`FR-002`）：四部分推荐齐全且确定性。
- [ ] **AC-002**（`FR-003`、`FR-004`）：推荐无副作用；过期推荐被拒绝。
- [ ] **AC-003**（`FR-005`、`FR-006`）：adapter 解析纪律未被绕过；阻塞可解释。
- [ ] **AC-004**（`TR-001`）：推荐与实际选择的差异可追溯。
- [ ] **AC-005**（`NFR-001`）：推荐路径不触碰 workspace 锁与 Run 表。

## 7. 待确认问题（全部已关闭，2026-08-01）

- **Q1**（已关闭 → ADR 0007）：Coordinator 走哪个执行通道？确定性规则，不引入第二条执行路径。
- **Q2**（已关闭 → ADR 0007 第 3 节）：推荐后是否自动派工？只推荐，用户确认后才执行。
- **Q3**（已关闭 → `design.md` 第 4 节）：`coordinator_agent_id` / `default_coordinator_agent_id` 两个既有列如何处置？v0.2 保持 NULL 并在文档中如实说明。
- **Q4**（已关闭 → `design.md` 第 5 节）：推荐失效如何判定？确认接口按前提快照复核。

## 8. 实现备注

- PRD v0.2 范围里的 "Structured Handoff Packet" **已由 v0.1.4 交付**（`server/src/services/handoff-builder.ts` 的 `HandoffPayload`），不在本 feature 重复实现。
- v0.2 的"自然语言"成分很弱，产品文案不得描述为语义理解能力（ADR 0007 第 1 节）。
