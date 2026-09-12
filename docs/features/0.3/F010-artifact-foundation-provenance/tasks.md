---
topics: [artifact, revision, provenance, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-12
---

# F010：Artifact & Provenance Foundation - 任务

## 0. 来源与执行规则

行为以 `spec.md` 为准，结构与失败协议以 `design.md` 为准。开始前读取真实 schema 版本并回填任务中的 migration 文件。

## 1. 前置条件

F009 新壳层和前端接入边界已冻结；ADR 0010 已接受；Evidence ref 构造入口已收敛；当前数据库 migration 全绿。

## 2. 实现任务

### Phase 1：Contract 与存储

- [ ] T001 (`FR-001`, `FR-002`): 定义 Artifact / revision / consumption 共享类型与校验。 — verify: `npm run typecheck`
- [ ] T002 (`FR-001`, `FR-002`, `NFR-001`): 增加顺延 migration、Repository、`(artifact_id, idempotency_key)` 唯一约束、source/archive locator 分离、maintenance lease 与不变量测试；证明 forward-only 升级不破坏既有查询。 — verify: `npm test --workspace server`
- [ ] T003 (`FR-003`, `NFR-002`): 在 `server/src/evidence-ref.ts` 实现统一 ref parser / builder 的可选 revision，增加 `resolveForRead` / `resolveForDispatch`，覆盖路径、SHA-256 与 floating ref 拒绝。 — verify: `npm test --workspace server`

### Phase 2：服务、事件与读取面

- [ ] T010 (`FR-001`, `FR-002`, `TR-001`): 实现 content-addressed archive 先行、DB 可见性 commit 后置的 create / revise 唯一写入口、CAS、事务内 `pendingEvents` + commit 后广播、带 DB 租约与宽限期的 orphan sweep；不引入持久化 outbox。 — verify: `npm test --workspace server`
- [ ] T011 (`FR-004`, `FR-005`): 提供幂等 `recordConsumption(dispatch_id, run_id, revision_ref)` 公共契约与双向 provenance 查询；不接入尚未存在的上下文组装器。 — verify: `npm test --workspace server`
- [ ] T012 [P] (`FR-005`): 增加 API client、共享类型与只读 hooks，区分 loading / empty / ready / missing / invalid / hash mismatch；不注册 `SurfaceRegistry` 槽位、不交付可见组件。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-002`): 通过 ArtifactService 命名 `testHooks` 覆盖每个发布步骤 crash、丢弃实例后同 dbPath restart、同 / 异内容并发 CAS、Win32 目标已存在、junction / symlink 越界、宽限期 orphan 清理、source 变化和 hash mismatch；测试不得自行编排发布步骤，逐点断言不可观察半成品。 — verify: `npm test`
- [ ] T021 (`AC-003`): 完成 Run / Artifact / Evidence 双向追溯集成测试。 — verify: `npm test`
- [ ] T022 (`AC-001`, `AC-002`, `AC-003`): 运行全量质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

F009 完成后进入本 Feature；T001→T002/T003→T010/T011；T012 可在 API contract 冻结后并行。F010 关闭条件只包含 Artifact core、resolver 和 `recordConsumption` contract；F012 是上下文组装调用 `recordConsumption` 的最终集成 owner，F011 只读取其结果。两者不得在 ref 和 consumption 契约前自行造临时字段。

## 5. 明确后移

全文搜索、外部存储、Memory / Skill 沉淀移交 v0.4；跨工作区 Artifact 共享不排期。
