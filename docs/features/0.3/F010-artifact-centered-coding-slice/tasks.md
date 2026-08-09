---
feature_ids: [F010]
related_features: [F004, F006, F007, F009]
topics: [artifact, coding-workflow, graph, handoff, validation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# F010：Artifact-Centered Coding Slice - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：Link 与 definition contract

- [ ] T001（FR-007/NFR-003）：新增 schema v12 `artifact_run_links` migration、repository、唯一/归属/方向测试；produced 唯一索引固定为 `(run_id, producer_slot)`，断言改变 `purpose` 不能绕过幂等。
- [ ] T002（FR-001/002）：扩展 Graph definition 类型但保持旧字段兼容；新增独立 `artifact_coding_v1` definition。
- [ ] T003（FR-001）：历史 v1 definition snapshot/restart 回归，证明未被新字段改变。
- [ ] T004（FR-002）：实现 output policy/parser/serializer 与每种 artifact type contract tests。

## Phase 2：Graph artifact flow

- [ ] T010（FR-002/NFR-002/003）：实现 DB-only `createArtifactFromRun(tx, ...)` 与 `(run_id, producer_slot)` 幂等；命中既有 link 时复核 type/hash，purpose 不参与唯一性。
- [ ] T011（FR-002/TR-002）：接入 node result processor；artifact/link/event/NodeRun CAS 同事务。v2 事件必须带 `payload_schema`，并与冻结 definition id/version 交叉校验；覆盖 legacy 无 discriminator、v2 正常、未知/错配 schema 四类。
- [ ] T012（FR-003）：ArtifactContextAssembler 完成 pinned/scope/type/slot/budget 校验。
- [ ] T013（FR-003）：synthesis instruction builder 改为 v2 refs 输入；v1 路径保持原样。
- [ ] T014（FR-003/007）：fan-in missing/type/scope/hash/重复 finalize/retry/restart 集成矩阵。
- [ ] T015（FR-001）：F007 premise/recommend/confirm 使用冻结 definition id/version，过期返回 stale。

## Phase 3：Implementation 与 Validation

- [ ] T020（FR-004/006）：HandoffPayloadV2 与 context builder 加 produced/consumed pinned refs、限额和 omitted 标记。
- [ ] T021（FR-004）：implementation Run 创建时冻结 plan ref，完成时从可信 trace 派生 implementation_log。
- [ ] T022（FR-005）：validator context 装配 plan/log refs，写 consumed links/events。
- [ ] T023（FR-005/AC-003）：每个成功解析的 validation round 分别生成独立 verification_results 实体 revision 1；下一轮 implementation 消费上一轮，最终 EvidenceSummary 引用最终轮并列出此前轮 refs。覆盖 pass、需修改、多轮后 pass、round-limit blocked、unparsable 不产出五类。
- [ ] T024（NFR-002/003）：artifact 失败阻止 Done；repair queue 从可信 trace 幂等补产物。

## Phase 4：Projection 与 UI

- [ ] T030（FR-007/008）：Run/Graph API 投影 links；新增 `GET /api/runs/:id/artifacts`。
- [ ] T031（FR-008）：Issue Artifact timeline 按 research/synthesis/implementation/validation 展示。
- [ ] T032（FR-008）：Graph/Run/Handoff 卡片显示 produced/consumed/missing/omitted refs。

## Phase 5：验收

- [ ] T040（AC-001~005）：自动化覆盖完整链、事务故障、retry/restart、v1 兼容。
- [ ] T041（AC-006）：真实 CLI 完成四类 artifact 旅程，并在不读取早期聊天正文时继续执行。
- [ ] T042：F001-F009 回归 + lint/format/typecheck/test/build。
- [ ] T043：回写 spec、BACKLOG、architecture/system-design 与 graph ADR 的 v2 扩展说明。

## 依赖关系

- F009 完成后 Phase 1；Phase 1 → 2 → 3 → 4 → 5。
- T021 与 T022 在 T020/T012 完成后可并行。
- F011 依赖 T030 的统一 artifact/graph projection。
