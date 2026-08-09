---
feature_ids: [F009]
related_features: [F003, F004, F006, F010]
topics: [artifact, provenance, evidence, typed-ref]
doc_kind: tasks
created: 2026-08-09
updated: 2026-08-09
---

# F009：Artifact Foundation & Provenance - 任务

> Status: draft | Owner: TBD | Spec: `spec.md` | Design: `design.md`

## Phase 1：Contract 与 migration

- [ ] T001（DR-001~003）：新增 shared Artifact 类型、状态、storage、resolution DTO 与事件枚举。
- [ ] T002（DR-001~003）：新增 schema v11 migration、索引/CHECK、migration 注册与升级测试；F008=v10、F010=v12、F011=v13、F012=v14，已应用版本不得修改或追加。
- [ ] T003（FR-003）：扩展 typed ref parser，区分 pinned execution ref 与 floating UI ref，覆盖 malformed/overflow。
- [ ] T004（FR-004/NFR-003）：实现 inline/hash/size/path guard 和 Windows containment/junction 测试。

## Phase 2：Repository 与 Service

- [ ] T010（FR-001/002）：实现 ArtifactRepository 的 create/get/list/revise-CAS/archive。
- [ ] T011（FR-001/002/TR-001）：实现 ArtifactService 事务、归属复核与 pending event 提交后广播。
- [ ] T012（FR-004）：实现受控目录 temp→hash→transaction→atomic rename，覆盖每个故障点清理。
- [ ] T013（FR-003/006）：EvidenceService 扩展 artifact resolution 与反向 evidence 查询。
- [ ] T014（NFR-002）：事件写入/DB/文件故障注入，断言无孤儿 revision、无幽灵 SSE。
- [ ] T015（FR-002/IR-001）：三个独立连接同时 revise，确定性触发首次冲突与重试后再次冲突；断言胜者 revision 唯一单调、旧 ref 不漂移，败者收到 409 `ARTIFACT_REVISION_CONFLICT` 与最新 revision。

## Phase 3：API 与 UI

- [ ] T020（IR-001）：实现六条 Artifact API、zod schema、scope-safe 404 与错误映射。
- [ ] T021（UX-001）：新增 API client/hook，列表请求不含/不读取正文。
- [ ] T022（UX-001）：Artifact Inspector 列表、详情、revision selector、source/evidence 链。
- [ ] T023（UX-001）：穷尽渲染 loading/empty/missing/invalid/hash-mismatch/archived。

## Phase 4：恢复与验收

- [ ] T030（FR-007）：archive/历史 ref/重启回放集成测试。
- [ ] T031（NFR-003）：真实 Windows 手动验证绝对路径、UNC、`..`、大小写和 junction 越界。
- [ ] T032（AC-001~006）：完成 API/UI/集成验收矩阵，回归 F001-F008。
- [ ] T033：运行 lint、format check、typecheck、全量测试、生产构建；新增文件纳入 format targets。
- [ ] T034：回写 spec AC、BACKLOG 与全局 architecture/system-design 的最终模型。

## 依赖关系

- Phase 1 → Phase 2 → Phase 3 → Phase 4。
- T012 与 T013 可在 T010 后并行；UI 依赖 API DTO 冻结。
- F010 必须等待 T003、T011、T013 完成。
