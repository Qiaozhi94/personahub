---
kind: feature
id: F009
version: "0.3"
related_features: [F003, F004, F006, F010]
topics: [artifact, provenance, evidence, typed-ref]
doc_kind: design
created: 2026-08-09
updated: 2026-08-11
---

# F009：Artifact Foundation & Provenance - 设计

> Owner: TBD | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：`spec.md`。
- **PRD / Architecture / System Design**：`docs/personahub-prd.md` 第 5、15 节；`docs/personahub-architecture.md` 第 7 节；`docs/personahub-system-design.md` Artifact 草案。
- **ADR / 上游 Contract**：F003 ThreadEvent/Evidence、F004 EvidenceService。
- **实现约束**：F008 = schema v10，F009 固定 schema v11；F010/F011/F012 依次 v12/v13/v14；已应用 migration 永不修改或追加。

## 1. 技术概要与影响面

新增 `ArtifactRepository` + `ArtifactService`，内容版本单独持久化；`EvidenceService` 扩展 artifact ref 解析，但不把 artifact 事件加入 trusted payload 旁路。前端在既有 Inspector 增加 Artifact 面板。

- 前端：API/hook/ArtifactInspector。
- 后端 / API：schema、repository/service、path guard、API、Evidence resolver 扩展。
- 存储 / Migration：schema v11，artifacts + artifact_revisions 表。
- Runtime / Agent Adapter：F009 不自动挂接 Graph/Run 完成钩子。
- Event / Evidence：artifact.created/revised/archived ThreadEvent。
- 文档 / 配置：受控目录 `.personahub/artifacts/`。

## 2. 架构与模块边界

- `ArtifactRepository`：DB-only，负责 create/get/list/revise-CAS/archive。
- `ArtifactService`：事务编排、归属复核、pending event 提交后广播；HTTP 包装不得在 runtime 事务里被调用。
- `EvidenceService`：扩展 artifact ref 解析与反向 evidence 查询；不把 artifact 事件加入 trusted payload 旁路。
- 前端 `ArtifactInspector` 依赖 F009 API client/hook，列表请求不含/不读取正文。
- 唯一真相源：artifact revision 内容由 `(artifact_id, revision)` 唯一确定；`current_revision` 由 CAS 保护；scope mismatch 与 not found 对外都返回 404，避免枚举其他 Project 数据。

## 3. 数据模型与 Migration

F009 固定使用 schema v11。若实施顺序在任何 migration 落地前改变，必须整体重新编号，已应用 migration 永不修改或追加。

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

`artifact_revisions.relative_path` 只保存**archived locator**——服务端在 `.personahub/artifacts/archive/<artifact_id>/` 下按**内容 `content_sha256`**（而非 revision 号）派生的确定性文件名，调用方不可指定；调用方提交请求时传入的 source locator（见第 4 节）从不写入这张表，也不作为可信 hash 来源（详见第 4、5 节）。按内容而非 revision 号命名是刻意选择：两个并发 revise 请求几乎必然产出不同内容、因而落在不同文件名下，从根子上避免并发写入共享同一目标路径（见第 5.2 节，第 2 轮评审 F009-DOC-006）；这条只约束 local_file 分支，inline_markdown 不产生 `relative_path`（见第 5.1 节，第 3 轮评审 F009-DOC-007）。

## 4. 接口、Contract 与 Event

### API / CLI / Adapter Contract

| Route                                                  | 行为                               |
| ------------------------------------------------------ | ---------------------------------- |
| `GET /api/issues/:issueId/artifacts?include_archived=` | metadata 列表，不含正文            |
| `POST /api/issues/:issueId/artifacts`                  | 创建实体+r1                        |
| `GET /api/artifacts/:id?revision=`                     | 详情；省略 revision 仅供 UI latest |
| `POST /api/artifacts/:id/revisions`                    | 新 revision，body 必须携带 `expected_revision` |
| `POST /api/artifacts/:id/archive`                      | 幂等归档                           |
| `GET /api/artifacts/:id/evidence-consumers?ref=`       | scope 内反向引用                   |

创建请求使用 `{thread_id, source_run_id?, type, title, storage:{type, content|source_path}, evidence_refs[]}`；服务端不接受 project/room/creator 等只读字段。所有 ids 从父资源推导和复核。scope 至少带 `projectId`、`issueId`；传入 thread/run 时进一步约束。对 scope mismatch 与 not found 的 HTTP 外观都返回 404，日志内部保留不同 code，避免枚举其他 Project 数据。

`storage.source_path`（仅 `local_file` 用）是调用方提供的 **source locator**：workspace 内 `.personahub/artifacts/staging/` 下的规范化相对路径，指向调用方已预先写好的文件。服务端按第 5.2 节 open-then-verify-then-read 协议处理它——先打开文件句柄，再基于该句柄核实 containment/identity，最后从同一句柄读取，不重新按路径字符串二次解析——不落库、不参与后续任何比较。它与 `artifact_revisions.relative_path` 保存的 **archived locator**（服务端按内容 hash 生成、调用方不可指定）是两个不同的概念，字段名也不同，避免同名复用导致语义混淆。revise 请求额外要求 `expected_revision`（正整数，调用方读取内容时看到的 `current_revision`），用于第 5 节的 CAS 判定。

创建/修订请求都不接受调用方提交的 content hash——archived 内容的 `content_sha256` 只按服务端落盘后的字节计算（见第 5 节）。

规范 ref 格式为 `artifact:<ULID>@<positive-integer>`。`parseEvidenceRef()` 扩展 kind=`artifact`；执行 resolver 拒绝 unpinned ref，UI navigation resolver 可把 `artifact:<id>` 投影为 latest 并明确 `floating: true`。

ref 解析和"能否新挂接"是两个独立操作，边界按操作类型而非 ref 字符串本身判定：

- `resolvePinned(ref, scope)`：只读，对任意已存在 `(artifact_id, revision)` 始终返回内容，不受实体是否 archived 影响；用于历史 Run/Handoff 重放和 UI 详情展示。
- `validateAttachableRef(ref, scope)`：写入前置校验，供把某个 artifact ref **新写入**一个 Run/Handoff/消息的调用点使用；若目标实体已 archived，无论 ref 指向的是最新还是历史 revision 一律拒绝。此方法由 F009 提供，具体调用点（写 Run/Handoff 时校验）属于 F010（消费本 Feature 契约）职责，F009 只负责暴露该方法并保证语义正确。

```ts
type ArtifactResolution =
  | { status: "resolved"; artifact: ArtifactSummary; revision: ArtifactRevisionMeta; content: string }
  | { status: "missing" | "invalid" | "scope_mismatch" | "hash_mismatch"; ref: string };

type AttachValidation =
  | { status: "attachable" }
  | { status: "archived_rejected" | "missing" | "invalid" | "scope_mismatch"; ref: string };
```

inline 内容以规范 UTF-8 字节算 hash/size。本地文件的两类路径不可混用（详见第 4 节 storage.source_path 段落与第 3 节表结构说明）：source locator 按 open-then-verify-then-read 协议一次性校验并读取；archived locator 是服务端按内容 hash 生成的确定性目标名，创建 revision 时把读到的字节写入该目标位置，而不是登记任意现有路径或复用调用方给的路径字符串。

### Event / Trace Contract

事件 payload：

- `artifact.created`: `{artifact_id, revision, artifact_type, storage_type, content_sha256, source_run_id}`
- `artifact.revised`: 同上 + `previous_revision`
- `artifact.archived`: `{artifact_id, current_revision}`

`evidence_refs` 字段保存该 revision 的 evidence refs；payload 不保存正文或本地绝对路径。

## 5. Runtime、Workflow 与并发

```ts
ArtifactService.create(input): { artifact, revision, pendingEvent }
ArtifactService.revise(id, input: { expected_revision, ... }): { artifact, revision, pendingEvent }
ArtifactService.archive(id): { artifact, pendingEvent }
ArtifactService.resolvePinned(ref, scope): ArtifactResolution
ArtifactService.validateAttachableRef(ref, scope): AttachValidation
ArtifactService.listByIssue(issueId, includeArchived): ArtifactSummary[]
ArtifactService.findConsumersByEvidence(ref, scope): ArtifactRevisionRef[]
```

create/revise 按 `storage.type` 走两条**完全独立**的持久化协议，绝不共用同一条文件发布管线（第 3 轮评审 F009-DOC-007：此前草稿曾让 inline 也经过 temp/archive 文件流程，与 `inline_content`/`relative_path` 二选一 CHECK 约束及 NFR-002"同事务"矛盾，现已拆开）：

- **inline_markdown**：见 5.1，纯 DB 事务，全程不接触文件系统。
- **local_file**：见 5.2，文件系统 open/verify/read -> temp -> content-addressed publish，再进 DB 事务。

revise 的并发 CAS 判定对两条分支都成立，统一在 5.3 节描述；5.3 节里"CAS 败者清理已 rename 文件"的部分只适用于 local_file 分支，inline 分支没有文件可清理。

### 5.1 inline_markdown：纯 DB 写入协议

校验 UTF-8、size（NFR-001 单 revision ≤ 256 KiB），按规范 UTF-8 字节计算 `content_sha256`。随后在**一个** `db.transaction()` 内：复核归属 -> 走 5.3 节 CAS -> 写 `artifact_revisions` 行（`inline_content` 列存正文，`relative_path` 为 NULL，满足 storage type 与 content/path 二选一 CHECK）-> 更新 `current_revision` -> 写事件 -> commit -> broadcast。

全程不写、不读、不 rename 任何文件；`.personahub/artifacts/.tmp/` 与 `archive/` 对 inline 请求不可见，第 5.2 节的孤儿扫描永远不会遍历到 inline 产生的文件（因为它不产生任何文件）。由于只有单个 SQLite 事务，天然满足 ACID，没有跨资源崩溃点：事务提交前崩溃等价于请求未发生（不留任何痕迹）；提交后即完整可见。唯一需要覆盖的场景是"提交成功、broadcast 前崩溃"，处理方式与 5.2 节的同名场景一致——DB 侧已真实完成，不算幽灵状态，客户端下次拉取即可看到。

### 5.2 local_file：SQLite / 文件系统跨资源一致性协议

DB 事务和文件系统 rename 不能合并成一个原子操作，因此协议不追求跨资源真原子，只保证两个可观察不变量：**DB 永远不暴露指向不存在文件的 revision**，**残留的孤儿文件最终会被回收**。此协议只适用于 `storage.type = "local_file"`；写入顺序固定为：

1. 对 `storage.source_path` 执行 **open-then-verify-then-read**——先打开文件句柄，再基于该已打开句柄核实 containment/identity（而不是重新按路径字符串二次解析/`realpath`），最后从同一句柄读取字节。这避免校验与读取之间的窗口内路径被替换（junction/symlink TOCTOU）。
2. 把读到的字节写入 `.personahub/artifacts/.tmp/<uuid>`，边写边算 `content_sha256`。
3. 用**内容 `content_sha256`**（而非 revision 号）派生确定性目标名，把 temp 文件 **atomic rename** 到 `.personahub/artifacts/archive/<artifact_id>/<content_sha256>`。目标名只由内容决定：两次并发 revise 几乎必然产出不同字节、从而落在不同目标名下，rename 天然不会互相竞争同一目标；若两次请求碰巧产出完全相同的字节，rename 到同一目标也是无害的（幂等覆盖，字节相同）。这条设计专门用于消除"目标名由 `(artifact_id, revision)` 派生"在并发场景下的写入碰撞（第 2 轮评审 F009-DOC-006）。
4. rename/命中完成后，在一个 `db.transaction()` 内复核归属 -> 走第 5.3 节 CAS -> 写 `artifact_revisions` 行（`relative_path` 记录该内容 hash 目标名，`inline_content` 为 NULL）-> 更新 `current_revision` -> 写事件 -> commit。
5. commit 成功后统一 broadcast pending event。

崩溃点与恢复：

| 崩溃点 | 落地状态 | 恢复动作 |
|---|---|---|
| temp 写入中 / 写完未 rename | 只有 `.tmp/` 下的孤立临时文件，DB 无记录 | 启动扫描：`.tmp/` 下超过 24h 且无引用的文件直接删除（幂等，重复运行无副作用） |
| rename 成功，DB 事务提交前崩溃或失败 | `archive/<artifact_id>/` 下存在正式文件，可能暂无 DB 行引用它 | 启动扫描：遍历 `archive/<artifact_id>/` 下的文件，凡是在该 artifact 的 `artifact_revisions` 中找不到任何行引用其 `relative_path`、且文件 mtime 早于一个宽限期（如 1h，避免和进行中的请求打架）的，移入 `.personahub/artifacts/.orphaned/` 隔离（不立即物理删除，保留人工核查窗口），并记录日志；隔离目录里超过设定保留期（如 7 天）的文件再物理清理。DB 提交失败时服务端本身也尝试同步执行一次 best-effort 删除／隔离（先确认没有其他 revision 行引用同一内容 hash 再删），失败不阻塞返回，交由启动扫描兜底 |
| DB 事务提交成功，broadcast 前崩溃 | DB 完全一致（revision 已存在），只是这次进程没广播 SSE | 不需要恢复动作：这不是"幽灵"状态（DB 侧真实完成），客户端下次拉取列表/详情即可看到；NFR-002 只要求提交前不得广播，不承诺提交后必达 |
| 读取时文件 missing / hash 不符（源文件被进程外修改或隔离扫描误判） | DB 有 revision，文件缺失或内容不符 | 按 FR-004/DR 契约返回 `missing`/`hash_mismatch`，不改 DB、不生成新 revision、不伪造旧内容（已有行为，此处仅确认与本协议不冲突） |

启动扫描本身必须幂等：多次运行只应基于当前 DB 状态判断，不依赖运行历史；隔离动作是可重复的 rename，重复扫描到同一个已隔离文件不会二次移动或报错。同一内容 hash 理论上可被同一 artifact 的多个 revision 行共享（例如内容还原成早前版本）；孤儿判定必须是"该 artifact 下没有**任何** revision 行引用这个文件名"，而不是"这个 revision 号没有对应行"。

### 5.3 revise 并发 CAS 协议

revise 请求必须携带 `expected_revision`，判定逻辑与 storage type 无关——inline 在 5.1 节唯一的 DB 事务内直接做，local file 在 5.2 节第 4 步的 DB 事务内做。服务端用单条原子条件更新做 CAS：

```sql
UPDATE artifacts SET current_revision = :new_revision, updated_at = :now
WHERE id = :id AND current_revision = :expected_revision;
```

- 影响 1 行：CAS 成功，继续写 `artifact_revisions` 行与事件，提交。
- 影响 0 行：说明 `expected_revision` 已经不等于当前 `current_revision`——无论是因为调用方基于旧内容编辑（stale writer），还是因为另一个请求刚好抢先提交（真实竞争者），服务端都无法也不需要区分这两种情况：回滚本次 DB 写入，立即返回 409 `ARTIFACT_REVISION_CONFLICT { latest_revision }`（重新读取当前值）。**服务端不做任何业务重试**——重试等于把 stale writer 的内容重放到新 latest 上，正是本协议要避免的。调用方必须重新读取 `latest_revision` 对应的内容，基于它重新编辑并重新提交。

inline 分支的 CAS 失败只回滚这一个 DB 事务，没有文件需要清理，到此结束。local file 分支还需处理已发布的文件：因为第 5.2 节的目标名按内容 hash 派生，CAS 败者已经 rename 完成的文件从不会是胜者正在使用的那个文件（除非两者字节完全相同，此时复用无害）——败者不需要、也不应该盲目删除刚 rename 的文件。败者清理时先确认该 artifact 下没有任何 `artifact_revisions` 行引用这个内容 hash 再删除；确认失败或删除本身失败都不阻塞 409 响应，未删除的文件交由第 5.2 节的启动孤儿扫描兜底回收。三个并发连接（两个基线相同的真实竞争者 + 一个基线落后的 stale writer）各自 rename 到自己内容对应的文件名，互不覆盖、互不删除对方文件，因此写入侧不存在 F009-DOC-006 描述的碰撞。

## 6. UI 与可观测性

Inspector 列表按 updated_at 倒序，显示 type/title/revision/status/source run。详情按 revision 切换，正文采用纯文本/Markdown 安全渲染，不解释 HTML。local missing/hash mismatch 显示诊断与路径，不自动接受新 hash。

## 7. 失败、恢复、安全与兼容

- 校验与失败映射：输入错误 400；不存在/跨 scope 404；revision CAS 冲突（`expected_revision` 与当前值不一致）立即返回 409 `ARTIFACT_REVISION_CONFLICT` + `latest_revision`，不重试；对已归档实体 revise 返回 409；对已归档实体调用 `validateAttachableRef` 返回 `archived_rejected`；重复 archive 幂等返回当前状态、不追加新事件。
- 重启与恢复：见第 5.2 节完整协议（仅 local_file；inline 不产生文件，无需恢复扫描）——`.tmp/` 超过 24h 的孤立临时文件直接清理；`archive/` 下无 DB 引用且超过宽限期的孤儿文件先隔离到 `.orphaned/` 再按保留期物理清理；不自动删除有 DB 引用的正式文件。DB 有 revision 但文件 missing/hash mismatch 时返回明确状态，不改 DB、不生成新 revision。
- 权限 / escalation / 凭据边界：scope mismatch 与 not found 对外都返回 404，避免枚举其他 Project 数据。
- Windows / POSIX / 版本兼容：路径必须防绝对路径、盘符切换、UNC、`..`、junction/symlink 越界与大小写绕过；source locator（staging）与 archived locator（archive）分别做 containment 校验，source locator 必须走第 5.2 节 open-then-verify-then-read（校验基于已打开句柄，不重新按路径字符串解析），真实 Windows 手动验证需覆盖"校验通过后、读取前用 junction/symlink 把路径换成 workspace 外目标"的竞态场景，而不能只测试静态越界路径。这些路径规则只约束 local_file；inline_markdown 不涉及任何文件路径。

## 8. 测试策略与验收映射

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | integration | `server/tests/integration/artifact-crud.test.ts`（计划） | inline 与 local file 创建并显示来源；inline 创建不产生 `.tmp/`/`archive/` 任何文件，local file 创建不写 `inline_content` 列 |
| `AC-002` | integration | `server/tests/integration/artifact-revision-ref.test.ts`（计划） | 旧 revision ref 解析旧内容 |
| `AC-003` | unit + manual | `server/tests/unit/artifact-path-guard.test.ts`、Windows 手动 | 路径越界、文件替换、超限被拒绝；校验后/读取前用 junction/symlink 替换目标的竞态场景不越界（open-then-verify-then-read 生效） |
| `AC-004` | integration | `server/tests/integration/artifact-evidence-query.test.ts`（计划） | 双向追溯 scope 正确、跨 scope 不泄露 |
| `AC-005` | integration | `server/tests/integration/artifact-transaction-fault.test.ts`（计划） | inline 与 local file 分别做故障注入：inline 只需覆盖 DB 事务失败（单资源，回滚即完整回退）；local file 覆盖 5.2 节各崩溃点。事件与数据同提交同回滚、无幽灵 SSE |
| `AC-006` | integration | `server/tests/integration/artifact-archive-replay.test.ts`（计划） | `resolvePinned` 对归档实体任意 revision 可解析；`validateAttachableRef` 拒绝新挂接；重复 archive 幂等无重复事件 |
| `AC-007` | integration | `server/tests/integration/artifact-revise-cas.test.ts`（计划） | 一个 stale writer（`expected_revision` 落后）立即 409；两个共享同一 `expected_revision` 的真实竞争者中败者按 CAS 判负 409、胜者成功且两者互不覆盖/删除对方文件；FR-005 完整 CRUD 可用 |
| `AC-008` | UI / E2E | `web/src/artifact/inspector-states.test.tsx`（计划） | 六种状态（loading/empty/missing/invalid/hash_mismatch/archived）穷尽渲染 |
| `AC-009` | integration | `server/tests/integration/artifact-list-perf.test.ts`（计划） | 100 项列表响应 < 200 ms 且不读正文字段 |

明确批量、并发、失败、恢复与真实环境场景；覆盖三个独立连接同时 revise（一个 stale writer + 两个共享同一 `expected_revision` 的真实竞争者）的 CAS 冲突判定与胜负双方文件互不干扰、孤儿文件启动扫描的隔离/清理幂等性、Windows junction/symlink 静态越界与"校验后读取前被替换"竞态、100 项 metadata 查询不读内容。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| entity + revision | 历史输入可复现 | 旧 ref 不漂移 | 原地 UPDATE（未采用） |
| pinned ref 进入执行 | latest 会漂移 | 执行上下文需确定内容 | 仅 artifact id（未采用） |
| 复制到受控目录 | 可约束路径与 hash | 路径安全 | 引用任意绝对路径（未采用） |
| metadata 与内容分表 | 列表不加载正文 | 100 项列表性能 | 单表 JSON manifest（未采用） |
| 本地文件可被进程外修改（风险） | 受控目录 + pinned hash 检出 | 不假装文件不可变 | 无 |
| source locator 与 archived locator 分离 | 两个不同字段/目录（`staging/` vs `archive/`） | 消除路径语义冲突（同一路径概念身兼输入源与不可变归档两职） | 复用同一字段/目录（未采用，第 1 轮评审否决） |
| source locator 读取走 open-then-verify-then-read | 校验（containment/identity）基于已打开的文件句柄，读取也从同一句柄进行，不重新按路径字符串二次解析 | 单纯"先 realpath 校验、再按路径读取"在两步之间存在窗口，junction/symlink 可在窗口内把路径换成 workspace 外目标（TOCTOU） | 仅一次 `realpath` + 后续按路径读取（未采用，第 2 轮评审 F009-DOC-003 否决——不能证明防护成立） |
| archived locator 按内容 `content_sha256` 命名，而非 `(artifact_id, revision)` | 并发 revise 几乎必然产出不同字节、天然落在不同目标文件名，rename 不再互相竞争同一目标；字节相同时复用是无害的幂等覆盖 | 用 revision 号做目标名时，两个共享同一 `expected_revision` 的并发请求会在 CAS 之前抢占同一 rename 目标，导致覆盖/hash mismatch/误删对方文件 | 引入独占的 revision 号预留机制再发布文件（更复杂，未采用，第 2 轮评审 F009-DOC-006 决策） |
| rename-then-commit + 启动扫描回收孤儿文件 | 不追求跨资源真原子，只保证 DB 不暴露未完成 revision、孤儿文件最终回收；孤儿判定按"该 artifact 下是否有任意 revision 行引用该文件名"，兼容内容寻址下的文件复用 | SQLite 事务与文件系统 rename 无法合并成一个原子操作 | 分布式事务/两阶段提交（成本不成比例，未采用） |
| revise 要求 `expected_revision`，CAS 失败即 409、不重试 | 单条原子条件更新即可正确处理 stale writer 与真实竞争者，无需应用层区分；败者不盲目删除刚 rename 的文件，先确认无引用再清理 | 应用层重试等于把 stale 编辑静默重放到新 latest；内容寻址下删除前不确认引用可能误删胜者仍在用的文件 | 服务端自动重试一次（未采用，第 1 轮评审否决——无法区分两种冲突来源） |
| `resolvePinned`/`validateAttachableRef` 拆分为两个方法 | 历史读取与新写入挂接的判定边界按操作类型而非 ref 字符串区分 | 同一 ref 字符串在归档前后需要不同行为，无法靠 ref 本身判断 | 单一 resolve 方法内部按调用上下文分支（可读性差，未采用） |
| inline_markdown 与 local_file 按 `storage.type` 走两条完全独立的持久化协议 | inline 是单一 DB 事务（5.1 节）；local file 才走文件系统 open/verify/read -> temp -> content-addressed publish -> DB 事务（5.2 节） | 两者共用同一条文件发布管线会让 inline 也产生 temp/archive 文件，与 `inline_content`/`relative_path` 二选一 CHECK 约束及 NFR-002"同事务"矛盾，且 inline 完全不需要跨资源恢复协议 | 两种 storage 共用统一的"先落文件再落 DB"管线（未采用，第 3 轮评审 F009-DOC-007 否决——协议假设不成立） |

## 10. 待确认设计问题

- [x] DQ-001: artifact revision 模型？ - 决策：entity + immutable revision（见 spec Q-001）。
- [x] DQ-002: ref pinning 策略？ - 决策：执行上下文只接受 pinned ref（见 spec Q-002）。
- [x] DQ-003: storage/path 边界？ - 决策：首批 inline/local file；local file 拆分 source locator（`staging/`，调用方提供）与 archived locator（`archive/`，服务端生成、不可覆盖）（见 spec Q-003、第 1 轮评审 F009-DOC-003）；source locator 读取按 open-then-verify-then-read 协议、基于已打开句柄核实并读取，杜绝校验-读取窗口内的路径替换（第 2 轮评审 F009-DOC-003 收紧）；评审若改变任一已关闭决策，必须先同步 F010 消费契约。
- [x] DQ-004: revise 冲突判据与重试策略？ - 决策：调用方必须提交 `expected_revision`，服务端单条原子 CAS，失败立即 409、不做业务重试（见第 1 轮评审 F009-DOC-002）。
- [x] DQ-005: archived artifact 的 ref 解析与新挂接边界？ - 决策：拆分为 `resolvePinned`（历史读取，始终可用）与 `validateAttachableRef`（新写入前置校验，archived 一律拒绝）；后者的调用点归 F010（见第 1 轮评审 F009-DOC-004）。
- [x] DQ-006: archived locator 的目标名派生依据？ - 决策：按内容 `content_sha256` 命名而非 `(artifact_id, revision)`，消除并发 revise 在 CAS 判定前抢占同一 rename 目标的写入碰撞（见第 2 轮评审 F009-DOC-006）。
- [x] DQ-007: inline_markdown 是否与 local_file 共用文件发布管线？ - 决策：不共用；inline 是 5.1 节单一 DB 事务，local file 才走 5.2 节文件系统 + DB 协议，两者在实现前必须分成两条独立代码路径（见第 3 轮评审 F009-DOC-007）。
