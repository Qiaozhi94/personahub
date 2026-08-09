---
feature_ids: [F009]
related_features: [F003, F004, F006, F010]
topics: [artifact, provenance, evidence, typed-ref]
doc_kind: design
created: 2026-08-09
updated: 2026-08-09
---

# F009：Artifact Foundation & Provenance - 设计

> Status: draft | Owner: TBD | Spec: `spec.md`

## 1. 技术概要与影响面

新增 `ArtifactRepository` + `ArtifactService`，内容版本单独持久化；`EvidenceService` 扩展 artifact ref 解析，但不把 artifact 事件加入 trusted payload 旁路。前端在既有 Inspector 增加 Artifact 面板。

- shared：Artifact DTO、枚举、ref result/error discriminated unions、ThreadEventType。
- server：schema、repository/service、path guard、API、Evidence resolver 扩展。
- web：API/hook/ArtifactInspector。
- runtime：F009 不自动挂接 Graph/Run 完成钩子。

## 2. Migration

按既定实施顺序 F008 = schema v10，F009 固定使用 schema v11。F010/F011/F012 依次使用 v12/v13/v14；若实施顺序在任何 migration 落地前改变，必须整体重新编号，已应用 migration 永不修改或追加。

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  issue_id TEXT NOT NULL REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  room_id TEXT,
  source_run_id TEXT REFERENCES runs(id),
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  current_revision INTEGER NOT NULL,
  created_by_actor_type TEXT NOT NULL,
  created_by_actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE artifact_revisions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  revision INTEGER NOT NULL,
  storage_type TEXT NOT NULL,
  inline_content TEXT,
  relative_path TEXT,
  content_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  created_by_actor_type TEXT NOT NULL,
  created_by_actor_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, revision)
);
CREATE INDEX idx_artifacts_issue_status ON artifacts(issue_id, status, updated_at);
```

CHECK 约束保证 storage type 与 content/path 二选一、status/type 合法、revision/size 正数。`room_id` 先保留 nullable 字段但在 F011 migration 建 rooms 后再加服务层归属校验；SQLite 不追加一个尚不存在的 FK。

## 3. Ref 与内容契约

规范格式为 `artifact:<ULID>@<positive-integer>`。`parseEvidenceRef()` 扩展 kind=`artifact`；执行 resolver 拒绝 unpinned ref，UI navigation resolver 可把 `artifact:<id>` 投影为 latest 并明确 `floating: true`。

```ts
type ArtifactResolution =
  | { status: "resolved"; artifact: ArtifactSummary; revision: ArtifactRevisionMeta; content: string }
  | { status: "missing" | "invalid" | "scope_mismatch" | "hash_mismatch"; ref: string };
```

scope 至少带 `projectId`、`issueId`；传入 thread/run 时进一步约束。对 scope mismatch 与 not found 的 HTTP 外观都返回 404，日志内部保留不同 code，避免枚举其他 Project 数据。

inline 内容以规范 UTF-8 字节算 hash/size。本地文件只保存相对 `.personahub/artifacts/` 的 POSIX 化路径；读取时 `realpath` 基目录与目标，做 case-insensitive Windows containment 校验，再读限定字节并核对 hash。创建 revision 时把文件复制进受控目录，而不是登记任意现有路径。

## 4. Service 与事务

```ts
ArtifactService.create(input): { artifact, revision, pendingEvent }
ArtifactService.revise(id, input): { artifact, revision, pendingEvent }
ArtifactService.archive(id): { artifact, pendingEvent }
ArtifactService.resolvePinned(ref, scope): ArtifactResolution
ArtifactService.listByIssue(issueId, includeArchived): ArtifactSummary[]
ArtifactService.findConsumersByEvidence(ref, scope): ArtifactRevisionRef[]
```

create/revise 在一个 `db.transaction()` 内：复核归属 → 校验/写 DB → 更新 current_revision → 写事件。local file 的文件写入不能随 SQLite 回滚，因此采用 temp file → hash → DB transaction → atomic rename；DB 失败清理 temp，rename 失败则事务回滚。提交后统一 broadcast。并发 revise 由 `(artifact_id, revision)` PK + `current_revision` compare-and-set 保护：首次冲突重新读取 latest 并重试一次；若第二次仍冲突，终止本次请求并返回 409 `ARTIFACT_REVISION_CONFLICT { latest_revision }`。服务端不得继续无界重试，客户端必须刷新后重新提交。

## 5. API

| Route                                                  | 行为                               |
| ------------------------------------------------------ | ---------------------------------- |
| `GET /api/issues/:issueId/artifacts?include_archived=` | metadata 列表，不含正文            |
| `POST /api/issues/:issueId/artifacts`                  | 创建实体+r1                        |
| `GET /api/artifacts/:id?revision=`                     | 详情；省略 revision 仅供 UI latest |
| `POST /api/artifacts/:id/revisions`                    | 新 revision                        |
| `POST /api/artifacts/:id/archive`                      | 幂等归档                           |
| `GET /api/artifacts/:id/evidence-consumers?ref=`       | scope 内反向引用                   |

创建请求使用 `{thread_id, source_run_id?, type, title, storage:{type, content|relative_path}, evidence_refs[]}`；服务端不接受 project/room/creator 等只读字段。所有 ids 从父资源推导和复核。

## 6. UI 与事件

Inspector 列表按 updated_at 倒序，显示 type/title/revision/status/source run。详情按 revision 切换，正文采用纯文本/Markdown 安全渲染，不解释 HTML。local missing/hash mismatch 显示诊断与路径，不自动接受新 hash。

事件 payload：

- `artifact.created`: `{artifact_id, revision, artifact_type, storage_type, content_sha256, source_run_id}`
- `artifact.revised`: 同上 + `previous_revision`
- `artifact.archived`: `{artifact_id, current_revision}`

`evidence_refs` 字段保存该 revision 的 evidence refs；payload 不保存正文或本地绝对路径。

## 7. 失败与恢复

- 输入错误 400；不存在/跨 scope 404；revision CAS 第二次冲突返回 409 `ARTIFACT_REVISION_CONFLICT` + `latest_revision`。
- 启动时清理 `.personahub/artifacts/.tmp/` 中超过 24h 且无 DB revision 的 temp 文件；不自动删除正式文件。
- DB 有 revision 但文件 missing/hash mismatch 时返回明确状态，不改 DB、不生成新 revision。
- archive 幂等；revise archived 返回 409。

## 8. 测试与决策

- migration/invariant、路径 fuzz、Windows junction、hash/size、并发 revise、故障注入、SSE commit 边界。
- API contract 与跨 Project 404；UI exhaustive states；100 项 metadata 查询不读内容。

| 决策                | 理由              | 未采用             |
| ------------------- | ----------------- | ------------------ |
| entity + revision   | 历史输入可复现    | 原地 UPDATE        |
| pinned ref 进入执行 | latest 会漂移     | 仅 artifact id     |
| 复制到受控目录      | 可约束路径与 hash | 引用任意绝对路径   |
| metadata 与内容分表 | 列表不加载正文    | 单表 JSON manifest |

## 9. 待确认设计问题

全部关闭：revision、ref pinning、storage/path 边界按第 2–4 节执行。评审若改变其中任一项，必须先同步 F010 的消费契约。
