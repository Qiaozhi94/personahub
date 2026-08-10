---
kind: feature
id: F009
version: "0.3"
related_features: [F003, F004, F006, F010]
topics: [artifact, provenance, evidence, typed-ref]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-11
---

# F009：Artifact Foundation & Provenance - 任务

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

不适用：`spec.md` 第 8 节与 `design.md` 第 10 节的待确认问题已全部关闭；上游 F003/F004 已 done，无待验证 Contract。实现任务从 T001 连续编号。

## 2. 实现任务

### Phase 1：Contract 与 migration

- [ ] T001 (`DR-001`, `DR-002`, `DR-003`): 新增 shared Artifact 类型、状态、storage、resolution DTO 与事件枚举。 - verify: `shared/src/artifact/types.ts`
- [ ] T002 (`DR-001`, `DR-002`, `DR-003`): 新增 schema v11 migration、索引/CHECK、migration 注册与升级测试；F008=v10、F010=v12、F011=v13、F012=v14，已应用版本不得修改或追加。 - verify: `server/tests/integration/migration-v11.test.ts`
- [ ] T003 (`FR-003`): 扩展 typed ref parser，区分 pinned execution ref 与 floating UI ref，覆盖 malformed/overflow。 - verify: `server/tests/unit/artifact-ref-parser.test.ts`
- [ ] T004 (`FR-004`, `NFR-003`): 实现 inline/hash/size/path guard，source locator 按 open-then-verify-then-read（打开句柄->基于句柄核实边界->同一句柄读取）实现；覆盖 Windows containment/junction 静态越界测试，以及"校验通过后、读取前把路径换成 workspace 外目标"的竞态测试。 - verify: `server/tests/unit/artifact-path-guard.test.ts`

### Phase 2：Repository 与 Service

- [ ] T010 (`FR-001`, `FR-002`): 实现 ArtifactRepository 的 create/get/list/revise-CAS/archive。 - verify: `server/tests/integration/artifact-repository.test.ts`
- [ ] T011 (`FR-001`, `FR-002`, `TR-001`): 实现 ArtifactService 按 `storage.type` 分派两条互不共用的持久化路径（design.md §5.1/§5.2）：inline_markdown 在单一 `db.transaction()` 内直接写 `inline_content`+CAS+事件；local_file 委托 T012 的文件协议后再进事务；两条路径共用归属复核与 pending event 提交后广播，断言 inline 路径完全不调用 T012 的任何文件系统函数。 - verify: `server/tests/integration/artifact-service-tx.test.ts`
- [ ] T012 (`FR-004`): 实现受控目录 open-then-verify-then-read->temp->hash->atomic rename->DB transaction 写入协议（仅 `storage.type = "local_file"`），archived locator 目标名按内容 `content_sha256` 派生（非 revision 号），以及启动时孤儿文件隔离/清理扫描（design.md §5.2），覆盖每个故障点的清理与幂等性、以及两个不同内容的并发写入天然落在不同目标名不互相覆盖。 - verify: `server/tests/integration/artifact-local-file.test.ts`
- [ ] T013 (`FR-003`, `FR-006`): EvidenceService 扩展 artifact resolution 与反向 evidence 查询。 - verify: `server/tests/integration/artifact-evidence-query.test.ts`
- [ ] T014 (`NFR-002`, `AC-005`): 事件写入/DB/文件故障注入，inline 与 local file 分开两组用例——inline 只需覆盖单一 DB 事务失败（断言不产生任何 `.tmp/`/`archive/` 文件）；local file 覆盖 design.md §5.2 每个崩溃点；均断言无孤儿 revision、无幽灵 SSE。 - verify: `server/tests/integration/artifact-transaction-fault.test.ts`
- [ ] T015 (`FR-002`, `IR-001`, `AC-007`): 三个独立连接同时 revise：一个使用落后 `expected_revision` 的 stale writer，两个共享同一个（等于当时 latest）`expected_revision` 的真实竞争者；断言 stale writer 立即收到 409 `ARTIFACT_REVISION_CONFLICT` 与最新 revision，两个真实竞争者中败者按 CAS 判负同样收到 409、胜者 revision 唯一单调且两者互不覆盖或删除对方已 rename 的归档文件，服务端全程不做业务重试，旧 ref 不漂移。不依赖实现时序偶然性，用显式的 `expected_revision` 输入区分三者角色。 - verify: `server/tests/integration/artifact-revise-cas.test.ts`
- [ ] T016 (`FR-007`, `AC-006`): 实现 `ArtifactService.resolvePinned` 与 `ArtifactService.validateAttachableRef` 两个方法本身的单元/集成测试——覆盖 active/archived 实体、resolved/missing/invalid/scope_mismatch/hash_mismatch/attachable/archived_rejected 各返回分支，与 T030 的 archive 场景集成测试互补。 - verify: `server/tests/integration/artifact-attach-validation.test.ts`

### Phase 3：API 与 UI

- [ ] T020 (`IR-001`): 实现六条 Artifact API、zod schema、scope-safe 404 与错误映射。 - verify: `server/tests/integration/artifact-routes.test.ts`
- [ ] T021 (`UX-001`): 新增 API client/hook，列表请求不含/不读取正文。 - verify: `web/src/artifact/api.test.ts`
- [ ] T022 (`UX-001`): Artifact Inspector 列表、详情、revision selector、source/evidence 链。 - verify: `web/src/artifact/inspector.test.tsx`
- [ ] T023 (`UX-001`, `AC-008`): 穷尽渲染 loading/empty/missing/invalid/hash_mismatch/archived 六种状态。 - verify: `web/src/artifact/inspector-states.test.tsx`
- [ ] T024 (`NFR-001`, `AC-009`): 灌入 100 个 artifact 后请求列表接口，断言响应不含正文字段且本地响应 < 200 ms。 - verify: `server/tests/integration/artifact-list-perf.test.ts`

## 3. 验证与验收任务

- [ ] T030 (`FR-007`, `AC-006`): archive/历史 ref/重启回放集成测试，覆盖 `resolvePinned` 对归档实体任意 revision 可读、`validateAttachableRef` 对归档实体一律拒绝新挂接、重复 archive 幂等不追加事件。 - verify: `server/tests/integration/artifact-archive-replay.test.ts`
- [ ] T031 (`AC-003`): 真实 Windows 手动验证绝对路径、UNC、`..`、大小写和 junction 静态越界，以及"open-then-verify-then-read 校验通过后、读取前用 junction/symlink 把路径换成 workspace 外目标"的竞态场景。 - verify: 真实 Windows 环境手动验证
- [ ] T032 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`, `AC-008`, `AC-009`): 完成 API/UI/集成验收矩阵，回归 F001-F008。 - verify: `npm test`
- [ ] T033 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`, `AC-008`, `AC-009`): 运行统一质量门禁；新增文件纳入 format targets。 - verify: `npm run verify`
- [ ] T034 (`AC-001`, `AC-002`, `AC-003`, `AC-004`, `AC-005`, `AC-006`, `AC-007`, `AC-008`, `AC-009`): 回写 spec 验收清单勾选状态、`tests:` 路径、BACKLOG 与全局 architecture/system-design 的最终模型。 - verify: `docs/features/0.3/F009-artifact-foundation-provenance/spec.md`

## 4. 依赖与并行关系

- `T001 -> T010`：shared 类型/DTO 落地后 Repository 才能引用。
- `T002 -> T010`：schema v11 migration 落地后 Repository 才能操作 `artifacts`/`artifact_revisions` 表。
- `T003 -> T013`、`T003 -> T020`：ref parser 落地后 EvidenceService 的 artifact resolution（T013）与 API route 的 ref 校验（T020）才能引用。
- `T004 -> T011`、`T004 -> T012`：path guard 落地后 Service 的归属/路径复核（T011）与本地文件 temp->hash->rename 写入（T012）才能引用。
- `T012 -> T011`：`ArtifactService`（T011）的 local_file 分支委托调用 T012 的发布协议，T012 先落地。inline 分支不依赖 T012，可与 T012 并行开发。
- `T010 -> T020`：Repository/Service 完成后进入 API/UI。
- `T011 -> T016`：`ArtifactService` 落地后才能测试 `resolvePinned`/`validateAttachableRef`。
- `T013` 可在 `T010`、`T004`/`T003` 后与 `T012` 并行，原因是修改不同文件且无共享状态。
- UI（`T021`/`T022`/`T023`）依赖 `T020` 的 API DTO 冻结。
- `T020 -> T024`：列表 API 落地后才能跑性能测试。
- `T016 -> T030`：`validateAttachableRef` 方法本身验证通过后，再进入归档场景的集成测试。
- `T020` -> `T030` -> `T032` -> `T033` -> `T034`：验收链按序推进。
- F010 必须等待 `T003`、`T011`、`T013`、`T016` 完成——`T016` 是 F010 在写 Run/Handoff link 前调用 `validateAttachableRef` 的前置契约。

## 5. 明确后移

- 自动从 agent 输出生成 artifact -> `F010`：本 Feature 只建立 artifact 实体与引用契约，不接入工作流产出。
- Room/Squad、全文搜索、外部 URL、Memory/Skill 自动沉淀 -> `v0.3` 其它 Feature / 后续版本：不在本切片范围。
