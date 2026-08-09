---
feature_ids: [F010]
related_features: [F004, F006, F007, F009]
topics: [artifact, coding-workflow, graph, handoff, validation, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F010：Artifact-Centered Coding Slice

> Status: draft | Owner: TBD | Target: v0.3

## 0. 元信息与意图

- **PRD 来源**：第 15 节 v0.3 完成判据。
- **上游**：F006 executable graph、F007 intake、F009 artifact contract、F004 validation。
- **一句话意图**：让真实复杂 coding Issue 用 pinned artifact refs 完成研究、综合、实现和验证交接。

## 1. 问题、目标与非目标

F009 只有管理能力仍可能成为“附件 CRUD”。本 Feature 把 artifacts 接入唯一真实工作流：agent 输出经契约校验后成为阶段 artifact，下游 Run 的输入记录确定 revision，handoff/validation 可回溯消费链。

不做：自然语言 Graph 编译、Graph Canvas、非 coding workflow、写 workspace 的物理并行、Room/Squad UI、自动 Memory/Skill。

## 2. 用户场景

### US1：研究与综合（P1）

复杂 coding 图的两个研究节点分别产出 `research_findings`；synthesis 只从 pinned refs 装配输入并产出 `synthesis_plan`。

### US2：实现交接（P1）

implementation Run 消费 synthesis plan，完成后由可信 trace 派生 `implementation_log`，记录文件变化、命令、风险与输入 refs。

### US3：验证交接（P1）

validator 消费 synthesis plan、implementation log 与 evidence，产出 `verification_results`；Evidence Summary 引用它们。

### US4：失败与重试（P2）

缺失、类型错、scope 错、过大或 unparsable artifact 会阻塞对应节点/Run；retry 产生新 Attempt 和新 revision，不篡改旧结果。

## 3. 需求

- **FR-001**：新增 versioned `artifact_coding_v1` graph definition；不得修改 F006 已存在 definition/version。
- **FR-002**：每个 graph node 的 output contract 声明 artifact type；节点逻辑成功要求 result envelope 与 artifact 创建同事务成功。
- **FR-003**：fan-in 只接受来自声明前驱、同 Issue/graph、类型匹配的 pinned refs，并记录实际消费 revision。
- **FR-004**：implementation instructions 必须包含 synthesis plan ref；完成时以 Handoff/trace 派生 `implementation_log`，不能信任 agent 自报命令或文件变化。
- **FR-005**：validator context 必须包含 plan/log pinned refs；每个成功解析出规范 pass/non-pass result 的 validator Run（包括非最终轮）都创建一个独立的 `verification_results` Artifact 实体 revision 1，并通过 `source_run_id`/`validation_round` 追溯轮次。非 pass 结果由下一轮 implementation 消费；最终 Evidence Summary 引用最终轮 artifact，并同时列出此前各轮的 pinned refs。进程失败或 result unparsable 不伪造 artifact，只保留既有失败 trace。
- **FR-006**：HandoffPayload 增加 `artifact_refs` 与 `consumed_artifact_refs`，均去重、限额、保持 pinned。
- **FR-007**：Run/NodeRun 应能查询其 consumed/produced artifact refs；同一 Attempt 幂等 finalize 不得重复 revision。
- **FR-008**：Issue 页面按阶段展示 artifact 产出/消费链和缺失原因。

### Trace / 非功能

- **TR-001**：新增 `artifact.consumed` 事件 `{artifact_ref, consumer_run_id, node_run_id?, purpose}`；产出沿用 F009 事件。
- **TR-002**：`graph.node_result` v2 payload 必须保存 discriminator `payload_schema: "graph.node_result.v2"`，以及 `artifact_ref`、hash、output contract/version；不把正文复制进新定义的边输入。缺少 discriminator 只允许在冻结为 F006 legacy definition/version 的图中按 v1 解析，其他组合一律 `artifact_invalid`。
- **NFR-001**：Run 上下文总预算沿用现有限额；超预算按类型优先级确定性截断并列出 omitted refs。
- **NFR-002**：graph/node/run 状态与 artifact 创建同事务；commit 前无 drain/broadcast。
- **NFR-003**：重启恢复不得重新生成已存在的 Attempt artifact；produced link 的唯一幂等键统一为 `(source_run_id/run_id, producer_slot)`。`purpose` 是消费/展示语义，不属于 produced 唯一键；artifact type 必须通过目标 revision 与 output policy 复核，不能靠改变 purpose 绕过幂等。

## 4. 状态与边界

```text
Attempt process completed
  -> parse/validate output
  -> create artifact revision + consumed links + node result event
  -> NodeRun completed

任一步失败 -> NodeRun failed(result_unparsable|artifact_invalid|artifact_unavailable)
```

implementation/validator 的 artifact 派生失败不得把证据不足的 Issue 标 Done；进入明确 Blocked，并允许修复原因后重试 finalize。

## 5. 成功与验收

- [ ] **AC-001**：两个 research artifacts → 一个 synthesis plan，fan-in 输入只有 refs。
- [ ] **AC-002**：implementation log 的命令/文件数据与可信 trace 一致，agent 文本无法伪造。
- [ ] **AC-003**：每个成功解析的 validation round 均有独立 verification artifact；下一轮实现消费上一轮，最终轮与 Evidence Summary 相互可追溯且保留此前轮 refs。
- [ ] **AC-004**：跨 Issue/type/unpinned/missing/hash mismatch 均阻塞且不创建部分状态。
- [ ] **AC-005**：retry/restart 不重复 revision，旧 Attempt 链保持可回放。
- [ ] **AC-006**：真实 CLI 完成四类 artifact 旅程；隐藏早期聊天事件正文后仍能完成后续阶段。

## 6. 测试、依赖与风险

- 单元：output contract parser、artifact policy、budget、idempotency key。
- 集成：graph fan-in、implementation finalize、validation pass/non-pass、事务故障、restart/retry。
- UI/E2E：阶段链、missing/blocked、revision/source navigation。
- 手动：真实 Codex/Claude/OpenCode 至少各验证一个支持的节点；完整旅程至少一次。

风险：一次性重写 F006 会破坏历史恢复。**已关闭决策**：保留 graph definition v1，v2 才启用 artifact input/output；历史图始终按冻结 version 回放。
