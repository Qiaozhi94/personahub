---
kind: feature
id: F010
version: "0.3"
status: draft
gate_version: 1
related_features: [F004, F006, F007, F009]
topics: [artifact, coding-workflow, graph, handoff, validation, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F010：Artifact-Centered Coding Slice

> Owner: TBD | Target: v0.3

## 0. 来源与意图

- **PRD 来源**：`docs/personahub-prd.md` 第 15 节 v0.3 完成判据。
- **架构来源**：`docs/personahub-architecture.md` Graph/Run/Handoff 章节。
- **系统设计 / Research / Contract 来源**：`docs/personahub-system-design.md` Graph、Handoff、Artifact 草案；F009 artifact ref/revision 契约。
- **上游决策**：v0.3 评审决策 Q1（以 F009+F010 为最小发布切片）、Q2（artifact 采用 immutable revision），见 `docs/features/0.3/README.md` 第 6 节。
- **功能类型**：runtime / workflow / backend / ui。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：让真实复杂 coding Issue 用 pinned artifact refs 完成研究、综合、实现和验证交接。

## 1. 问题、目标与非目标

### 问题

F009 只有管理能力仍可能成为“附件 CRUD”。artifact 必须接入唯一真实工作流才能真正减少上下文损耗：agent 输出经契约校验后成为阶段 artifact，下游 Run 的输入记录确定 revision，handoff/validation 可回溯消费链。

### 目标

把 F006 的三节点图与既有 validation/handoff 串成首个 artifact-first 垂直切片。Feature 完成后，真实 CLI 跑完一个复杂 coding Issue；隐藏早期聊天文本后，下游仍能仅凭 handoff + artifact/evidence refs 完成 synthesis 和 validation，并能回放完整消费链。

### 非目标

- 本 feature 不把 artifact 体系扩展到非 coding workflow（留给后续版本）。
- 本 feature 不实现 Room/Squad 交互（分别留给 `F011`、`F012`）。
- 本 feature 不做自动 Memory/Skill 沉淀。

## 2. 用户场景

每个用户场景都应该能独立交付价值，并能独立验证。按优先级排序，确保只完成 P1 时也能形成一个有意义的最小切片。

### US-001：研究与综合（Priority: P1）

作为 `复杂 coding Issue 的协作图`，我希望 `两个研究节点分别产出 research_findings，synthesis 只从 pinned refs 装配输入并产出 synthesis_plan`，以便 `综合阶段不依赖复制聊天历史`。

**为什么是这个优先级**：研究->综合是 artifact-first 交接的最小闭环，验证 pinned ref fan-in 是否可行。

**独立测试**：只运行研究+综合节点，断言 synthesis 输入只含 pinned refs。

**验收场景**：

1. Given `两个研究节点各自产出 research_findings artifact`，when `synthesis 节点执行`，then `其输入只含两个 pinned refs 并产出 synthesis_plan`。

### US-002：实现交接（Priority: P1）

作为 `implementation Run`，我希望 `消费 synthesis plan，完成时由可信 trace 派生 implementation_log`，以便 `记录文件变化、命令、风险与输入 refs 而不信任 agent 自报`。

**为什么是这个优先级**：实现交接验证 artifact 可从可信 trace 派生，防止 agent 文本伪造。

**独立测试**：运行 implementation Run，断言 log 的命令/文件数据与可信 trace 一致。

**验收场景**：

1. Given `implementation Run 完成`，when `派生 implementation_log`，then `命令/文件数据与可信 trace 一致，agent 文本无法伪造`。

### US-003：验证交接（Priority: P1）

作为 `validator Run`，我希望 `消费 synthesis plan、implementation log 与 evidence，产出 verification_results`，以便 `Evidence Summary 引用它们并保留各轮 refs`。

**为什么是这个优先级**：验证交接闭环证明多轮 artifact 消费链可回溯。

**独立测试**：运行一轮 validation，断言产出独立 verification_results 且 Evidence Summary 引用最终轮并列出此前轮。

**验收场景**：

1. Given `validator Run 成功解析 result`，when `产出 verification_results`，then `下一轮 implementation 消费上一轮，最终 Evidence Summary 引用最终轮并列出此前轮 refs`。

### US-004：失败与重试（Priority: P2）

作为 `协作图`，我希望 `缺失、类型错、scope 错、过大或 unparsable artifact 阻塞对应节点/Run，retry 产生新 Attempt 和新 revision`，以便 `不篡改旧结果`。

**为什么是这个优先级**：失败与重试依赖前三场景的产出契约先稳定。

**独立测试**：注入缺失/类型错 artifact，断言节点 blocked/failed；retry 后断言旧 revision 不变。

**验收场景**：

1. Given `artifact 缺失/类型错/过大/unpinned`，when `节点执行`，then `阻塞且不创建部分状态`。
2. Given `retry/restart`，when `重新 finalize`，then `不重复 revision，旧 Attempt 链保持可回放`。

## 3. 范围与边界

### 范围内

- 新增 versioned `artifact_coding_v1` graph definition；不修改 F006 已存在 definition/version。
- 每个 graph node 的 output contract 声明 artifact type；节点逻辑成功要求 result envelope 与 artifact 创建同事务成功。
- fan-in 只接受来自声明前驱、同 Issue/graph、类型匹配的 pinned refs，并记录实际消费 revision。
- implementation/validator 从可信 trace 派生 artifact；HandoffPayload 引用 artifact refs 与 consumed refs。
- Issue 页面按阶段展示 artifact 产出/消费链和缺失原因。

### 范围外

- 自然语言 Graph 编译、Graph Canvas、非 coding workflow。
- 写 workspace 的物理并行。
- Room/Squad UI（`F011`/`F012`）。
- 自动 Memory/Skill。

### 边界场景

- 当 artifact 跨 Issue、类型不匹配、unpinned、missing 或 hash mismatch 时会发生什么？阻塞对应节点/Run，不创建部分状态。
- 如果 retry/restart 重新 finalize，系统应如何处理？不重复 revision，旧 Attempt 链保持可回放。
- 在一次性重写 F006 的情况下，哪些事情绝不能发生？不破坏历史 graph 恢复；保留 v1 definition 原样回放。

## 4. 需求

使用稳定 ID，方便 design、tasks、code review 和 tests 引用。

### 功能需求

- **FR-001**：新增 versioned `artifact_coding_v1` graph definition；不得修改 F006 已存在 definition/version。
- **FR-002**：每个 graph node 的 output contract 声明 artifact type；节点逻辑成功要求 result envelope 与 artifact 创建同事务成功。
- **FR-003**：fan-in 只接受来自声明前驱、同 Issue/graph、类型匹配的 pinned refs，并记录实际消费 revision。
- **FR-004**：implementation instructions 必须包含 synthesis plan ref；完成时以 Handoff/trace 派生 `implementation_log`，不能信任 agent 自报命令或文件变化。
- **FR-005**：validator context 必须包含 plan/log pinned refs；每个成功解析出规范 pass/non-pass result 的 validator Run（包括非最终轮）都创建一个独立的 `verification_results` Artifact 实体 revision 1，并通过 `source_run_id`/`validation_round` 追溯轮次。非 pass 结果由下一轮 implementation 消费；最终 Evidence Summary 引用最终轮 artifact，并同时列出此前各轮的 pinned refs。进程失败或 result unparsable 不伪造 artifact，只保留既有失败 trace。
- **FR-006**：HandoffPayload 增加 `artifact_refs` 与 `consumed_artifact_refs`，均去重、限额、保持 pinned。
- **FR-007**：Run/NodeRun 应能查询其 consumed/produced artifact refs；同一 Attempt 幂等 finalize 不得重复 revision。
- **FR-008**：Issue 页面按阶段展示 artifact 产出/消费链和缺失原因。

### 事件 / Trace 需求

- **TR-001**：新增 `artifact.consumed` 事件 `{artifact_ref, consumer_run_id, node_run_id?, purpose}`；产出沿用 F009 事件。
- **TR-002**：`graph.node_result` v2 payload 必须保存 discriminator `payload_schema: "graph.node_result.v2"`，以及 `artifact_ref`、hash、output contract/version；不把正文复制进新定义的边输入。缺少 discriminator 只允许在冻结为 F006 legacy definition/version 的图中按 v1 解析，其他组合一律 `artifact_invalid`。

### 非功能需求

- **NFR-001**：性能：Run 上下文总预算沿用现有限额；超预算按类型优先级确定性截断并列出 omitted refs。
- **NFR-002**：可靠性 / 恢复：graph/node/run 状态与 artifact 创建同事务；commit 前无 drain/broadcast。
- **NFR-003**：兼容性：重启恢复不得重新生成已存在的 Attempt artifact；produced link 的唯一幂等键统一为 `(source_run_id/run_id, producer_slot)`。`purpose` 是消费/展示语义，不属于 produced 唯一键；artifact type 必须通过目标 revision 与 output policy 复核，不能靠改变 purpose 绕过幂等。

## 5. 生命周期与不变量

```text
Attempt process completed
  -> parse/validate output
  -> create artifact revision + consumed links + node result event
  -> NodeRun completed

任一步失败 -> NodeRun failed(result_unparsable|artifact_invalid|artifact_unavailable)
```

不变量：

- 节点逻辑成功要求 result envelope 与 artifact 创建同事务成功（FR-002）。
- implementation/validator 的 artifact 派生失败不得把证据不足的 Issue 标 Done；进入明确 Blocked，并允许修复原因后重试 finalize（FR-004/FR-005）。
- produced link 唯一幂等键为 `(source_run_id/run_id, producer_slot)`；retry 是新 run id，因此可生成新 artifact，但不重复旧 revision（FR-007、NFR-003）。
- graph/node/run 状态与 artifact 创建同事务，commit 前无 drain/broadcast（NFR-002）。

## 6. 成功与验收

### 成功标准

- **SC-001**：真实复杂 coding Issue 能以 pinned artifact refs 完成研究->综合->实现->验证交接，下游不依赖复制聊天历史。
- **SC-002**：artifact 产出/消费链可从 Thread 和 Inspector 完整回放，隐藏早期聊天正文不影响后续阶段。
- **SC-003**：retry/restart 不篡改旧 revision，历史 Attempt 链可回放。

### 验收清单

验收清单每项引用第 4 节真实存在的需求 ID。本 Feature 处于 `draft`，`tests:` 路径暂缺，进入 `review` 前回填。

- [ ] **AC-001** (`FR-002`, `FR-003`): 两个 research artifacts -> 一个 synthesis plan，fan-in 输入只有 refs。
- [ ] **AC-002** (`FR-004`): implementation log 的命令/文件数据与可信 trace 一致，agent 文本无法伪造。
- [ ] **AC-003** (`FR-005`): 每个成功解析的 validation round 均有独立 verification artifact；下一轮实现消费上一轮，最终轮与 Evidence Summary 相互可追溯且保留此前轮 refs。
- [ ] **AC-004** (`FR-003`, `FR-004`, `FR-005`): 跨 Issue/type/unpinned/missing/hash mismatch 均阻塞且不创建部分状态。
- [ ] **AC-005** (`FR-007`, `NFR-003`): retry/restart 不重复 revision，旧 Attempt 链保持可回放。
- [ ] **AC-006** (`FR-006`, `FR-008`): 真实 CLI 完成四类 artifact 旅程；隐藏早期聊天事件正文后仍能完成后续阶段。

## 7. 测试、依赖与决策

### 测试策略

- 单元测试：output contract parser、artifact policy、budget、idempotency key。
- 集成测试：graph fan-in、implementation finalize、validation pass/non-pass、事务故障、restart/retry。
- UI / E2E：阶段链、missing/blocked、revision/source navigation。
- 真实环境 / 手动验证：真实 Codex/Claude/OpenCode 至少各验证一个支持的节点；完整旅程至少一次。

### 依赖

- 上游 Feature / Contract：F006 executable graph、F007 intake、F009 artifact contract、F004 validation。
- 下游消费者：F011 依赖本 Feature 的统一 artifact/graph projection。
- 外部 / 环境依赖：真实 CLI（Codex/Claude/OpenCode）需真实环境验证。

### 决策与风险

| 决策 / 风险 | 结论或缓解 | 理由 | 后续 |
|---|---|---|---|
| graph definition 演进 | 保留 v1 definition 原样，新增 `artifact_coding_v1` definition version 1 | 历史 graph 可恢复，不破坏 F006 | 不一次性重写 F006 |
| link 表而非 Run JSON | 双向查询、唯一约束、幂等 | produced 唯一键可约束 | 不塞回 Run JSON |
| 可信 trace 派生 implementation log | 防 agent 自报伪造 | 命令/文件数据可信 | 不信任 agent 返回日志 |
| DB-only runtime primitive | 保持外层事务与 commit 后副作用边界 | runtime 事务一致性 | HTTP 包装不在 runtime 事务调用 |
| 一次性重写 F006 会破坏历史恢复（风险） | 保留 v1，v2 才启用 artifact input/output | 历史图按冻结 version 回放 | 无 |

## 8. 待确认问题

- [x] Q-001: 是否一次性重写 F006 graph definition 以接入 artifact？ - 决策：保留 graph definition v1 原样，新增 `artifact_coding_v1` definition version 1 以 pinned refs 为边输入；历史图始终按冻结 version 回放。
