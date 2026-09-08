---
topics: [artifact, revision, provenance, implementation]
doc_kind: tasks
created: 2026-08-09
updated: 2026-09-08
---

# F010：Artifact & Provenance Foundation - 任务

## 0. 来源与执行规则

行为以 `spec.md` 为准，结构与失败协议以 `design.md` 为准。开始前读取真实 schema 版本并回填任务中的 migration 文件。

## 1. 前置条件

F009 新壳层和前端接入边界已冻结；ADR 0010 已接受；Evidence ref 构造入口已收敛；当前数据库 migration 全绿。

## 2. 实现任务

### Phase 1：Contract 与存储

- [ ] T001 (`FR-001`, `FR-002`): 定义 Artifact / revision / consumption 共享类型与校验。 — verify: `npm run typecheck`
- [ ] T002 (`FR-001`, `FR-002`, `NFR-001`): 增加顺延 migration、Repository 与不变量测试。 — verify: `npm test --workspace server`
- [ ] T003 (`FR-003`, `NFR-002`): 实现统一 ref parser / builder / resolver 与路径、hash 拒绝。 — verify: `npm test --workspace server`

### Phase 2：服务、事件与读取面

- [ ] T010 (`FR-001`, `FR-002`, `TR-001`): 实现 create / revise 唯一写入口、CAS 和 commit 后事件。 — verify: `npm test --workspace server`
- [ ] T011 (`FR-004`, `FR-005`): 在上下文组装时记录 consumption，并实现双向 provenance 查询。 — verify: `npm test --workspace server`
- [ ] T012 [P] (`FR-005`): 增加 API client 与资源 / 验收最小读取组件。 — verify: `npm test --workspace web`

## 3. 验证与验收任务

- [ ] T020 (`AC-001`, `AC-002`): 覆盖 restart、并发修订、文件故障注入、越界和 hash mismatch。 — verify: `npm test`
- [ ] T021 (`AC-003`): 完成 Run / Artifact / Evidence 双向追溯集成测试。 — verify: `npm test`
- [ ] T022 (`AC-001`, `AC-002`, `AC-003`): 运行全量质量门。 — verify: `npm run verify:release`

## 4. 依赖与并行关系

F009 完成后进入本 Feature；T001→T002/T003→T010/T011；T012 可在 API contract 冻结后并行。F011/F012 不得在 ref 和 consumption 契约前自行造临时字段。

## 5. 明确后移

全文搜索、外部存储、Memory / Skill 沉淀移交 v0.4；跨工作区 Artifact 共享不排期。
