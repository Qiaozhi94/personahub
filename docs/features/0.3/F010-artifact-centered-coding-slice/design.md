---
feature_ids: [F010]
related_features: [F004, F006, F007, F009]
topics: [artifact, coding-workflow, graph, handoff, validation]
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# F010：Artifact-Centered Coding Slice - 设计

> Status: draft | Owner: TBD | Spec: `spec.md`

## 1. 技术概要

增加 `ArtifactProductionService` 与 `ArtifactContextAssembler`，把 F009 接到三个已有完成边界：Graph node result processor、implementation finalize、validation result processor。F006 definition v1 原样保留；新增 `artifact_coding_v1` definition version 1（独立 id）以 pinned refs 为边输入。

## 2. 数据模型

F010 固定使用 schema v12（F008=v10、F009=v11），新增 link 表，不把 JSON refs 塞回 Run；后续 F011/F012 依次使用 v13/v14。若尚未落地前实施顺序改变，整体重新编号，绝不追加进已应用版本：

```sql
CREATE TABLE artifact_run_links (
  artifact_id TEXT NOT NULL,
  artifact_revision INTEGER NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_run_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('consumed','produced')),
  purpose TEXT NOT NULL,
  producer_slot TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, artifact_revision, run_id, direction, purpose),
  CHECK ((direction='produced' AND producer_slot IS NOT NULL) OR direction='consumed')
);
CREATE UNIQUE INDEX idx_artifact_one_production_slot
  ON artifact_run_links(run_id, producer_slot)
  WHERE direction='produced';
```

FK `(artifact_id, artifact_revision)` 指向 artifact revisions（migration 建 composite FK 前确认 SQLite foreign_keys 开启）。produced 方向以 `(run_id, producer_slot)` 作为唯一幂等键；`purpose` 只描述 `synthesis_output` / `validation_result` 等消费和展示语义，不参与 produced 唯一性。查询既有 produced link 后还必须复核 artifact type/hash 与 output policy 一致；retry 是新 run id，因此可生成新 artifact。

## 3. Definition 与产出策略

`GraphNodeDefinition` 增加 versioned 可选字段：

```ts
artifactOutput?: { type: ArtifactType; producerSlot: string; schemaVersion: 1 };
artifactInputs?: Array<{ slot: string; acceptedTypes: ArtifactType[]; cardinality: "one"|"many" }>;
```

新图：两个 research 节点输出 `research_findings`，synthesis 接受两个并输出 `synthesis_plan`。result envelope 仍按 output contract 解析；生产服务把规范 JSON/Markdown 序列化为 F009 inline revision。`graph.node_result` v2 payload 固定为 `{payload_schema:"graph.node_result.v2", artifact_ref, content_sha256, output_contract, output_contract_version, ...identity}`；ArtifactContextAssembler 先校验 discriminator，再用 NodeRun→GraphRun 的冻结 definition id/version 交叉验证。没有 `payload_schema` 的事件只允许属于 F006 legacy definition/version 并走原有 payload handler；未知/错配 schema 不得猜测，统一 `artifact_invalid`。`resolveTrustedPayload()` 仍只负责 trusted event/scope，不负责 payload 版本判别。

F007 推荐规则在新 definition 可用且各节点有 capable adapter 时选择它；token premise 固定 definition id/version。确认仍调用 `prepareGraph/createGraph`，不新增事务或执行入口。

## 4. Context 与 Handoff

`ArtifactContextAssembler.assemble(refs, scope, budget)` 逐项：parse pinned → scope/type/link 校验 → resolve/hash → 确定性排序/预算 → 返回 sections + consumed links + omitted refs。排序为 required type/slot、producer node key、ref；不得按 DB 返回偶然顺序。

新增 `HandoffPayloadV2`，保留 v1 字段并加入：

```ts
artifact_refs: string[];
consumed_artifact_refs: string[];
artifact_refs_truncated: boolean;
```

implementation Run 的输入 refs 在创建 Run 时冻结并写 consumed links；instructions 只包含 ref 摘要，正文由 context builder 装配。完成时 `implementation_log` 从 `buildHandoff()`、file-change-set 和 verified events 构建，不直接接受 agent 返回的日志字段。

validator context assembler加入 synthesis/log refs。每个成功解析出规范 result 的 validator Run，无论 pass、要求修改还是 round-limit blocked，都创建一个新的 `verification_results` Artifact 实体 revision 1；`source_run_id` 指向该 validator Run，轮次从可信 `runs.validation_round` 投影，producer slot 恒为 `verification_results`。非 pass artifact 写入下一轮 implementation 的 consumed links；最终 Evidence Summary 以最终轮 ref 为主，并按 round 升序附上此前所有 verification refs。validator 进程失败/result unparsable 不创建伪 artifact。任一应产出 artifact 的事务失败时 policy gate 不允许 Done。

## 5. 原子性与恢复

- graph node：解析、artifact create、links、node_result event、NodeRun CAS 在同一 DB 事务；提交后 drain/broadcast。
- implementation/validator：终态 processor 在既有 finalize 事务内调用 db-only production primitive；禁止内层自开事务。
- `createArtifactFromRun(tx, input)` 是自由函数/DB-only primitive；`ArtifactService.create()` 的 HTTP 包装不能在 runtime 事务里调用。
- 重复 finalize 先按 `(run_id, producer_slot)` 查 existing，验证 hash/type 后返回既有 ref；`purpose` 变化不能生成第二份产物，不一致则 `ARTIFACT_IDEMPOTENCY_CONFLICT` 并阻塞。
- startup recovery 扫描“Run terminal 但必需 produced link 缺失”的记录，进入 repair queue；只从可信持久化 trace 重建，不重新执行 agent。

## 6. API/UI/事件

- Graph projection、Run detail、Handoff trace card 增加 consumed/produced refs。
- `GET /api/runs/:id/artifacts` 返回 links + summaries；正文仍走 F009 detail。
- Issue Artifact timeline 按阶段而非仅创建时间分组，显示 producer、consumers、validation result。
- `artifact.consumed` 与 link 同事务；重复消费幂等不重复事件。

## 7. 错误映射

新增图/工作流原因：`artifact_invalid`、`artifact_unavailable`、`artifact_type_mismatch`、`artifact_budget_exceeded`、`artifact_idempotency_conflict`。图节点映射为 failed + 可 retry；implementation/validator 映射 Issue Blocked，恢复入口复核 refs/trace 后执行 artifact repair 或新 Attempt，绝不直接跳 Done。

## 8. 测试与设计决策

- v1/v2 definition 同库恢复测试；context snapshot/golden；事务故障每一阶段；production slot 幂等；validation pass/non-pass；预算边界。
- 真实 CLI probe 验证 envelope 遵从，产品路径 E2E 验证四 artifacts。

| 决策                               | 理由                               |
| ---------------------------------- | ---------------------------------- |
| 新 definition id，不改 v1          | 历史 graph 可恢复                  |
| link 表而非 Run JSON               | 双向查询、唯一约束、幂等           |
| 可信 trace 派生 implementation log | 防 agent 自报伪造                  |
| DB-only runtime primitive          | 保持外层事务与 commit 后副作用边界 |

## 9. 待确认设计问题

全部关闭。F009 ref/revision 契约若在评审中改变，本设计必须退回 draft 并同步更新第 2–5 节。
