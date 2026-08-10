---
kind: feature
id: F010
version: "0.3"
related_features: [F004, F006, F007, F009]
topics: [artifact, coding-workflow, graph, handoff, validation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-11
---

# F010：Artifact-Centered Coding Slice - 任务

> Owner: TBD | Spec: `spec.md` | Design: `design.md`

## 0. 来源与执行规则

- 行为与验收真相源：`spec.md`。
- 技术方案与边界：`design.md`。
- 每项任务只描述一个可验证动作，并引用合法的 US/需求/AC ID。
- 完成且验证后立即把 `[ ]` 改为 `[x]`，不得最后统一补勾。
- `[P]` 只用于修改不同文件、没有显式前置依赖且不会争用同一状态的任务。
- 实现中若任务顺序或契约失效，先修订三件套，再继续编码。

统一任务格式：

```markdown
- [ ] T001 [P] (`US-001`, `FR-001`, `AC-001`): <一个可验证动作> - verify: `path/to/test.ts`
```

## 1. 前置条件

不适用：F009 artifact ref/revision 契约已冻结（见 `docs/features/0.3/F009-artifact-foundation-provenance/spec.md`）；`design.md` 第 10 节待确认设计问题已全部关闭。本 Feature 在 F009 完成后实施，实现任务从 T001 连续编号。

## 2. 实现任务

### Phase 1：Link 与 definition contract

- [ ] T001 (`FR-007`, `NFR-003`): 新增 schema v12 `artifact_run_links` migration、repository、唯一/归属/方向测试；produced 唯一索引固定为 `(run_id, producer_slot)`，断言改变 `purpose` 不能绕过幂等。 - verify: `server/tests/integration/artifact-run-links.test.ts`
- [ ] T002 (`FR-001`, `FR-002`): 扩展 Graph definition 类型但保持旧字段兼容；新增独立 `artifact_coding_v1` definition。 - verify: `shared/src/graph/definition.ts`
- [ ] T003 (`FR-001`): 历史 v1 definition snapshot/restart 回归，证明未被新字段改变。 - verify: `server/tests/integration/graph-v1-restart.test.ts`
- [ ] T004 (`FR-002`): 实现 output policy/parser/serializer 与每种 artifact type contract tests。 - verify: `server/tests/unit/artifact-output-contract.test.ts`

### Phase 2：Graph artifact flow

- [ ] T010 (`FR-002`, `NFR-002`, `NFR-003`): 实现 DB-only `createArtifactFromRun(tx, ...)` 与 `(run_id, producer_slot)` 幂等；命中既有 link 时复核 type/hash，purpose 不参与唯一性。 - verify: `server/tests/integration/artifact-production-service.test.ts`
- [ ] T011 (`FR-002`, `TR-002`): 接入 node result processor；artifact/link/event/NodeRun CAS 同事务。v2 事件必须带 `payload_schema`，并与冻结 definition id/version 交叉校验；覆盖 legacy 无 discriminator、v2 正常、未知/错配 schema 四类。 - verify: `server/tests/integration/node-result-processor-v2.test.ts`
- [ ] T012 (`FR-003`): ArtifactContextAssembler 完成 pinned/scope/type/slot/budget 校验，并在 resolve 前对每个 ref 调用 F009 `ArtifactService.validateAttachableRef()`；archived 命中 `archived_rejected` 计入 omitted refs（非静默丢弃），覆盖断言。 - verify: `server/tests/unit/artifact-context-assembler.test.ts`
- [ ] T013 (`FR-003`): synthesis instruction builder 改为 v2 refs 输入；v1 路径保持原样。 - verify: `server/tests/integration/synthesis-instruction-v2.test.ts`
- [ ] T014 (`FR-003`, `FR-007`, `AC-004`): fan-in missing/type/scope/hash/来源已归档（`validateAttachableRef` 命中 `archived_rejected`）/重复 finalize/retry/restart 集成矩阵。 - verify: `server/tests/integration/fan-in-matrix.test.ts`
- [ ] T015 (`FR-001`): F007 premise/recommend/confirm 使用冻结 definition id/version，过期返回 stale。 - verify: `server/tests/integration/intake-definition-stale.test.ts`

### Phase 3：Implementation 与 Validation

- [ ] T020 (`FR-004`, `FR-006`): HandoffPayloadV2 与 context builder 加 produced/consumed pinned refs、限额和 omitted 标记。 - verify: `server/tests/integration/handoff-payload-v2.test.ts`
- [ ] T021 (`FR-004`): implementation Run 创建时冻结 plan ref，完成时从可信 trace 派生 implementation_log。 - verify: `server/tests/integration/implementation-log-trace.test.ts`
- [ ] T022 (`FR-005`): validator context 装配 plan/log refs，写 consumed links/events。 - verify: `server/tests/integration/validator-context-assembly.test.ts`
- [ ] T023 (`FR-005`, `AC-003`): 每个成功解析的 validation round 分别生成独立 verification_results 实体 revision 1；下一轮 implementation 消费上一轮，最终 EvidenceSummary 引用最终轮并列出此前轮 refs。覆盖 pass、需修改、多轮后 pass、round-limit blocked、unparsable 不产出五类。 - verify: `server/tests/integration/validation-round-artifacts.test.ts`
- [ ] T024 (`NFR-002`, `NFR-003`): artifact 失败阻止 Done；repair queue 从可信 trace 幂等补产物。 - verify: `server/tests/integration/artifact-repair-queue.test.ts`

### Phase 4：Projection 与 UI

- [ ] T030 (`FR-007`, `FR-008`): Run/Graph API 投影 links；新增 `GET /api/runs/:id/artifacts`。 - verify: `server/tests/integration/run-artifacts-routes.test.ts`
- [ ] T031 (`FR-008`): Issue Artifact timeline 按 research/synthesis/implementation/validation 展示。 - verify: `web/src/issue/artifact-timeline.test.tsx`
- [ ] T032 (`FR-008`): Graph/Run/Handoff 卡片显示 produced/consumed/missing/omitted refs。 - verify: `web/src/graph/artifact-cards.test.tsx`

## 3. 验证与验收任务

- [ ] T040 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`): 自动化覆盖完整链、事务故障、retry/restart、v1 兼容。 - verify: `npm test`
- [ ] T041 (`AC-006`): 真实 CLI 完成四类 artifact 旅程，并在不读取早期聊天正文时继续执行。 - verify: 真实 CLI 环境手动验证
- [ ] T042 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`): F001-F009 回归 + lint/format/typecheck/test/build。 - verify: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
- [ ] T043: 回写 spec、BACKLOG、architecture/system-design 与 graph ADR 的 v2 扩展说明。 - verify: `docs/features/0.3/F010-artifact-centered-coding-slice/spec.md`

## 4. 依赖与并行关系

- F009 完成后进入 Phase 1；`T001` -> `T010` -> `T020` -> `T030`：主链按序推进。
- `T021` 与 `T022` 在 `T020`/`T012` 完成后可并行，原因是修改不同文件且无共享状态。
- UI（`T031`/`T032`）依赖 `T030` 的统一 projection。
- `T030` -> `T040` -> `T041` -> `T042` -> `T043`：验收链按序推进。
- F011 依赖 `T030` 的统一 artifact/graph projection。

## 5. 明确后移

- Room/Squad UI -> `F011` / `F012`：本 Feature 不实现协作现场与可复用分组 UI。
- 非 coding workflow、Graph Canvas、自然语言 Graph 编译 -> `v0.4` 及以后：不在本切片范围。
- 自动 Memory/Skill 沉淀 -> `v0.6`：按 PRD 排期。
