---
feature_ids: [F009]
related_features: [F003, F004, F006, F010]
topics: [artifact, provenance, evidence, typed-ref, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-09
---

# F009：Artifact Foundation & Provenance

> Status: draft | Owner: TBD | Target: v0.3

## 0. 规格元信息

- **PRD 来源**：`docs/personahub-prd.md` 第 5 节 Artifact、Handoff Packet，第 15 节 v0.3。
- **架构来源**：`docs/personahub-architecture.md` 第 7 节。
- **系统设计来源**：`docs/personahub-system-design.md` Artifact 草案。
- **一句话意图**：让阶段成果成为有稳定版本、明确来源、可被统一引用和验证的一级实体。

## 1. 问题与目标

当前协作结果主要存在 ThreadEvent payload、Run final message 和聊天文本中。它们能回放，却没有稳定的成果身份、类型和 revision；下游只能复制上下文，无法证明自己消费了哪一版结果。

本 Feature 建立 Artifact 的最小闭环：登记、版本化、查询、typed ref 解析、evidence 追溯和 Inspector 展示。

### 非目标

- 不自动从 agent 输出生成 artifact（F010）。
- 不实现 Room、Squad、全文搜索、外部 URL、富文本协作、Memory/Skill 自动沉淀。
- 不允许跨 Project 或 workspace 外路径引用。

## 2. 用户场景与独立测试

### US1：登记并查看阶段成果（P1）

用户可在 Issue 下登记 inline Markdown 或受控本地文件 artifact，并查看类型、当前 revision、来源和内容状态。

**独立测试**：不运行 agent，直接创建 artifact；列表与详情返回一致的来源链。

### US2：稳定引用与历史复现（P1）

系统可用 `artifact:<artifact_id>@<revision>` 引用确定内容；创建新 revision 后旧引用仍解析到原内容。

**独立测试**：创建 r1、r2，分别解析并断言内容不漂移。

### US3：Evidence 双向追溯（P2）

用户可从 artifact 查看 evidence refs，也可查询某个 evidence ref 被哪些 artifact revision 引用。

**独立测试**：两个 artifact 引用同一 event ref，反向查询返回两条且受 Project/Issue scope 限制。

## 3. 范围与边界

- 首批类型：`research_findings`、`synthesis_plan`、`implementation_log`、`verification_results`。
- 存储：`inline_markdown`、`local_file_path`；`db_record` 与 `external_url` 延后。
- local file 仅允许 workspace 内 `.personahub/artifacts/` 下的规范化相对路径。
- artifact 采用逻辑实体 + immutable revision；实体可改 title，可归档，不物理删除已引用 revision。
- 未知类型、跨 Issue/Project ref、越界路径、缺失文件、hash 不匹配必须显式失败，不能降级成空内容。

## 4. 需求

### 功能需求

- **FR-001**：系统应创建 Artifact 实体与 revision 1，并验证 Issue、Thread、Room、Run 的归属一致性。
- **FR-002**：更新内容时应追加 revision；已存在 revision 的内容、storage locator、hash 和 evidence refs 不可修改。
- **FR-003**：系统应解析 `artifact:<id>@<revision>`；缺 revision 的 ref 只允许 UI 导航到 latest，不得用于 Run/Handoff 执行上下文。
- **FR-004**：系统应验证 artifact type、内容大小、UTF-8、路径边界和 SHA-256；读取文件时重新校验路径与 hash。
- **FR-005**：用户可列出 Issue artifacts、读取详情/指定 revision、创建 revision、归档实体。
- **FR-006**：系统应提供 artifact → evidence/source 和 evidence → artifact revision 的双向查询。
- **FR-007**：归档只影响默认列表与新引用，不破坏历史 ref 解析。

### 数据需求

- **DR-001**：Artifact 保存 project/issue/thread/room/run 归属、type、title、status、current revision。
- **DR-002**：ArtifactRevision 保存 revision、storage type、content/relative path、content hash、size、evidence refs、creator 与时间。
- **DR-003**：同一 artifact 的 revision 单调递增且唯一；引用目标由 `(artifact_id, revision)` 唯一确定。

### Trace / API / UX

- **TR-001**：创建、修订、归档分别写 `artifact.created`、`artifact.revised`、`artifact.archived` ThreadEvent，payload 不复制完整内容。
- **IR-001**：HTTP 边界使用 zod；错误至少包含 `ARTIFACT_NOT_FOUND`、`ARTIFACT_REF_INVALID`、`ARTIFACT_SCOPE_MISMATCH`、`ARTIFACT_PATH_INVALID`、`ARTIFACT_CONTENT_MISSING`、`ARTIFACT_HASH_MISMATCH`、`ARTIFACT_TOO_LARGE`、`ARTIFACT_REVISION_CONFLICT`。并发 revise 首次 CAS 冲突由服务端基于最新 revision 重试一次；再次冲突返回 409 `ARTIFACT_REVISION_CONFLICT` 并携带 `latest_revision`，不得无限重试或覆盖胜者。
- **UX-001**：Inspector 展示 list/detail/revision/source/evidence，以及 loading/empty/missing/invalid/archived 状态。
- **NFR-001**：inline 单 revision 上限 256 KiB，本地文件上限 2 MiB；列表不得读取正文。
- **NFR-002**：创建 revision 与事件写入同事务；事务提交前不得广播。
- **NFR-003**：Windows 路径必须防绝对路径、盘符切换、UNC、`..`、junction/symlink 越界与大小写绕过。

## 5. 生命周期

```text
active --archive--> archived
active --new revision--> active
archived --resolve historical ref--> archived（允许读取）
archived --new revision--> 拒绝
```

## 6. 成功与验收

- **SC-001**：r1/r2 ref 在重启和源文件变化后仍不漂移；变化时返回 hash mismatch。
- **SC-002**：任意 artifact revision 均能定位来源 Run/Thread 与 evidence。
- **SC-003**：列表 100 个 artifact 时不加载正文，单机本地响应目标小于 200 ms。

- [ ] **AC-001**（FR-001/DR-001）：inline 与 local file 均能创建并显示来源。
- [ ] **AC-002**（FR-002/FR-003）：旧 revision ref 永远解析旧内容。
- [ ] **AC-003**（FR-004/NFR-003）：路径越界、文件替换和超限均被拒绝。
- [ ] **AC-004**（FR-006）：双向追溯在 scope 内正确、跨 scope 不泄露存在性。
- [ ] **AC-005**（TR-001/NFR-002）：事件与数据同提交同回滚且无幽灵 SSE。
- [ ] **AC-006**（FR-007）：归档后历史 Run/Handoff 仍可解析 pinned ref。

## 7. 测试计划

- 单元：ref parser、type/size/hash/path validator、revision allocator。
- 集成：migration、CRUD、三个独立连接同时 revise 的首次/二次 CAS 冲突、归属校验、事务故障注入、反向 evidence 查询。
- UI：列表、详情、revision 切换、五种异常状态。
- 手动：Windows junction/symlink 与大小写路径边界；重启后历史引用回放。

## 8. 依赖、风险与待确认

- 上游：F003 ThreadEvent/Evidence、F004 EvidenceService；F010 消费本 Feature。
- 风险：本地文件可被进程外修改；用受控目录 + pinned hash 检出，不假装文件不可变。
- **Q1 已关闭**：采用 entity + immutable revision。
- **Q2 已关闭**：执行上下文只接受带 revision 的 ref。
- **Q3 已关闭**：首批只开放 inline/local file；local file 限定受控目录。
