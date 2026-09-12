---
kind: feature
id: F010
version: "0.3"
related_features: [F003, F004, F006, F009, F011, F012, F014]
topics: [artifact, revision, provenance, typed-ref]
doc_kind: design
created: 2026-08-09
updated: 2026-09-12
---

# F010：Artifact & Provenance Foundation - 设计

> Owner: unassigned | Spec: `spec.md` | Tasks: `tasks.md`

## 0. 输入与约束

- **行为契约**：本目录 `spec.md`。
- **产品与系统约束**：PRD §5.7、§5.8、§11，`docs/personahub-system-design.md` §4。
- **上游契约**：ADR 0010、F003 Trace、F004 Evidence、F006 Work Graph、F009 前端壳层。
- **实现约束**：实施时读取 `CURRENT_SCHEMA_VERSION` 并顺延 migration，不预占版本号；F010 只拥有 Artifact core 与 `recordConsumption` 公共契约，不接入 F012 的上下文组装器，也不交付 F011 的可见资源视图。

## 1. 技术概要与影响面

F010 新增 Artifact repository/service、不可变 revision、content-addressed archive、统一 typed-ref resolver、consumption/provenance 查询，以及供后续 Feature 使用的只读前端数据契约。

- **前端**：`web/src/lib/api-client.ts` 的 Artifact API client、共享类型和只读 hooks；不注册 `SurfaceRegistry` 槽位，不新增可见组件。
- **后端 / API**：ArtifactService、ArtifactResolver、Repository、provenance routes；`server/src/evidence-ref.ts` 扩展 `artifact` kind 与 revision 解析。
- **存储 / Migration**：新增 `artifacts`、`artifact_revisions`、`artifact_consumptions`、`artifact_evidence_links`、`artifact_maintenance_leases`。
- **Runtime**：文件 revision 采用 archive 先行、DB commit 后可见的发布协议；F012 才是 consumption 调用点的集成 owner。
- **Event / Evidence**：创建、修订、消费和解析拒绝写既有 `thread_events`，事务提交后广播；Evidence 只通过公共 ref / link contract 关联。
- **配置**：Artifact 大小、orphan 宽限期与维护租约时长均有显式默认值，见 §7、§9。

## 2. 架构与模块边界

`ArtifactService` 是 create / revise / retire / `recordConsumption` 的唯一写入口；Repository 不对 route 或 F012 暴露。`ArtifactResolver` 只读 manifest 与 archive，不读可变 source。`server/src/evidence-ref.ts` 是所有 typed ref 线格式的唯一真相源；EvidenceService 通过它解析，不直接读取 Artifact 表。

F010 只提供幂等的 `recordConsumption(dispatch_id, run_id, revision_ref)` 公共契约与消费表，调用点由 F012 上下文组装器拥有，F010 不接入。F011 通过只读 API / hooks 展示资源和验收信息；F010 不建立第二套页面投影或写入口。

依赖方向固定为：API / F012 adapter → ArtifactService → Repository；API / EvidenceService → ArtifactResolver → Repository + archive reader。resolver 不反向调用 service，前端不直接拼 ref 或推导 current revision。

## 3. 数据模型与 Migration

### Schema

`artifacts`

- `id TEXT PRIMARY KEY`
- `issue_id TEXT NOT NULL REFERENCES issues(id)`：v0.3 唯一归属列；Project / Workspace 由 Issue 关系推导，不复制第二套归属。
- `thread_id TEXT NOT NULL REFERENCES threads(id)`：创建与事件回放所属会话。
- `type TEXT NOT NULL`、`title TEXT NOT NULL`
- `state TEXT NOT NULL CHECK (state IN ('active', 'retired'))`
- `current_revision INTEGER`：创建事务发布 revision 1 后置为 1；不指向草稿。
- `created_by TEXT NOT NULL`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`

`artifact_revisions`

- `(artifact_id, revision)` 复合主键，`revision >= 1`，revision 行只代表已发布内容，禁止 `UPDATE` 内容列。
- `storage_kind TEXT NOT NULL CHECK (storage_kind IN ('inline_markdown', 'workspace_file'))`
- `inline_content TEXT`、`source_relative_path TEXT`、`archive_relative_path TEXT` 按 storage kind 互斥：inline 只填正文；file 同时填 source / archive locator。
- `content_hash TEXT NOT NULL`：原始内容字节的 SHA-256 小写十六进制值。
- `source_run_id TEXT REFERENCES runs(id)`；现有 `runs` 行就是 Attempt，不新增不存在的 `source_attempt_id`。Room / Thread / Issue 通过 Run 与 Artifact 外键回放。
- `created_by TEXT NOT NULL`、`idempotency_key TEXT NOT NULL`、`request_fingerprint TEXT NOT NULL`、`created_at TEXT NOT NULL`
- `UNIQUE (artifact_id, idempotency_key)`：同一 Artifact 内的 create/revise 重放命中既有 revision；人工登记使用 client ULID，派工产出使用稳定的 `dispatch_id + logical_output_key`，不得只用会把同一派工多个成果合并的裸 `dispatch_id`。

`artifact_consumptions`

- `artifact_id` + `revision` 外键指向确定 revision；另存 `dispatch_id TEXT NOT NULL`、`run_id TEXT NOT NULL REFERENCES runs(id)`、`purpose TEXT NOT NULL`、`consumed_at TEXT NOT NULL`。
- `PRIMARY KEY (dispatch_id, artifact_id, revision, purpose)`；同一次 Dispatch 重放 `recordConsumption` 返回原记录，不产生第二条消费。

`artifact_evidence_links`

- `(artifact_id, revision, evidence_ref)` 复合主键；`evidence_ref` 必须先经公共 ref parser 解析为已知 kind。
- 该表只保存关系，不复制 Evidence / Run 状态；Artifact → Evidence 与 Evidence → Artifact 使用同一张表反查。

`artifact_maintenance_leases`

- `name TEXT PRIMARY KEY`、`owner_id TEXT NOT NULL`、`expires_at_ms INTEGER NOT NULL`。
- 发布者与 orphan sweeper 都以 CAS 获取同一个 `archive-maintenance` 租约；租约过期后才允许新 owner 接管，避免 sweep 与在途 rename / manifest commit 竞争。

### 状态与兼容

Artifact 只在 `active → retired` 间单向流转；retired 禁止新 revision，但历史 revision 仍可解析。F010 不持久化 draft revision：写入中的 inline payload 或临时 blob 不是 revision，只有 manifest 事务 commit 后才成为 published revision，因此“未发布的临时内容不能进入派工”有明确载体边界。

本节是 `docs/personahub-system-design.md` §4 “建议形状”的冻结实现契约，并同步回写该节。Migration 保持 forward-only：只追加新表 / 索引，不修改既有列；migration 集成测试必须证明旧表和既有查询在升级后仍可读取、重复升级幂等。仓库没有 down migration，不声明不可执行的“回滚前检查”。

## 4. 接口、Contract 与 Event

### API 与 service contract

- `POST /api/artifacts`：请求含调用方生成的 `artifact_id`、`issue_id`、`thread_id`、`type`、`title`、storage payload、`source_run_id?`、`evidence_refs?`、`created_by`、`idempotency_key`；以稳定 Artifact ID + revision 幂等键重放，成功返回 Artifact 和 revision 1。
- `POST /api/artifacts/:artifactId/revisions`：请求含 storage payload、`source_run_id?`、`evidence_refs?`、`created_by`、`idempotency_key`、`expected_current_revision`；CAS 成功返回新 revision，冲突返回 `ARTIFACT_REVISION_CONFLICT`。
- `GET /api/artifacts?issue_id=...`、`GET /api/artifacts/:id`、`GET /api/artifacts/:id/revisions/:revision`：返回列表、实体/current 指针和确定 revision。
- `GET /api/artifacts/:id/provenance`、`GET /api/runs/:id/artifacts` 与 `GET /api/evidence/:ref/artifacts`：使用同一 link / consumption 数据双向查询。
- `recordConsumption(dispatch_id, run_id, revision_ref, purpose)`：只接受含 revision 的 Artifact ref；幂等重放返回既有记录。

所有 create / revise 调用都必须携带调用方生成的 `idempotency_key`，create 还必须携带稳定的 `artifact_id`。Repository 持久化排除时间戳后的规范化请求 SHA-256 到 `request_fingerprint`；`UNIQUE (artifact_id, idempotency_key)` 冲突时，相同指纹返回既有 revision，不同指纹返回 `ARTIFACT_IDEMPOTENCY_CONFLICT`，不得静默复用不相同内容。

大小在创建临时 blob 或开启事务前校验：inline 按 UTF-8 字节数，file 同时做预读 `stat` 与流式硬上限；超限返回 `ARTIFACT_TOO_LARGE`，且不产生 Artifact、revision 或临时文件。

### Typed ref

公共线格式为 `artifact:<artifact_id>@<revision>`；交互读取 current 可使用 `artifact:<artifact_id>`。`server/src/evidence-ref.ts` 扩展 `EvidenceRefKind` 的 `artifact`，并让 `ParsedRef` 增加可选 `revision?: number`；`@revision` 的切分、正整数校验和 builder 均在该模块完成，既有 `event` / `file_change_set` kind 及返回语义不变。

parser 不抛异常：`artifact:<id>` 返回 `kind: "artifact"` 且 `revision: undefined`；`artifact:<id>@<正整数>` 返回确定 revision；空值、未知前缀、空 id、重复 `@` 或非正整数 revision 返回 `kind: "unknown"` 并保留冒号后的原始 payload 供诊断。`resolveForRead()` 允许无 revision ref 并读取 current；`resolveForDispatch()` 与 `recordConsumption()` 遇无 revision、未知 kind 或非法 revision 时返回 `ARTIFACT_REF_INVALID`，禁止调用方绕过该模式把 floating ref 放入 Dispatch snapshot。

拒绝事件的 thread 载体按可得性降级：Dispatch / consumption 路径使用调用方提供的 Dispatch 所属 thread；其他路径能定位到 Artifact 时使用该 Artifact 的 `thread_id`。ref 无法解析或 Artifact 不存在且调用方也没有 thread context 时，只返回稳定错误码并写服务日志，不写 `thread_events`；不得编造 thread id。

### Event / Trace contract

事件类型为 `artifact.created`、`artifact.revised`、`artifact.consumed`、`artifact.resolve_rejected`。成功事件 payload 至少含 `artifact_id`、`revision`、`issue_id`、`source_run_id?`；consumed 另含 `dispatch_id` / `run_id?` / `purpose`；拒绝事件含原 ref、调用模式和稳定 `reason_code`，不记录正文。

事件与领域写入使用同一 SQLite transaction 写入 `thread_events`，事务内只收集 `pendingEvents`。DB commit 成功后统一广播，沿用 `intake-service.ts` 既有模式；广播失败只影响实时推送，不影响已提交事实，客户端重连后从持久事件重建。F010 不新增持久化 outbox。

## 5. Runtime、Workflow 与并发

inline revision 的 manifest、current pointer CAS 和事件在单一 DB transaction 内提交。文件 revision 使用：`临时 blob → 校验并 fsync → 原子改名到 content-addressed archive → DB 事务插入 revision manifest 并 CAS 更新 current pointer / pendingEvents → commit → 广播`。

DB commit 是 revision 对 resolver 可见的唯一发布点。rename 后 crash、DB 失败或 CAS 失败只留下不可见的 archive orphan；已提交 revision 一定先有完整 archive。事件广播不参与发布原子性。

archive locator 固定为 `<sha256前2位>/<sha256>`。目标已存在时先校验目标字节 hash：一致则删除临时 blob 并继续，避免 Win32 对正在读取目标执行覆盖 rename 时的 `EPERM` / `EBUSY`；不一致则报 `ARTIFACT_ARCHIVE_COLLISION` 并停止。rename 竞态报错后也重新执行同一目标校验，相同内容视为发布成功。

同一 Artifact 的 revision 号从 current + 1 计算，并以 `expected_current_revision` CAS；败者返回冲突，不删除可能被赢家或相同 hash revision 引用的 archive。幂等键命中优先于分配 revision，保证重试不因 current 已推进而误报 CAS。

## 6. UI 与可观测性

本 Feature 只交付 Artifact 读取所需的 API client、共享类型与只读 hooks，不注册任何 `SurfaceRegistry` 槽位、不交付可见组件；资源 / 验收视图由 F011 拥有。

读取契约返回显式 discriminated state：`loading`、`empty`、`ready`、`missing`、`invalid`、`hash_mismatch`，并为失败态携带稳定错误码、ref 与可安全显示的诊断信息。`empty` 表示查询成功但列表无记录，`missing` 表示确定 revision 的 manifest 或 archive 不存在，两者不得合并。正文只以文本 / Markdown 安全渲染，不执行 Artifact 中的 HTML 或脚本。

服务日志记录 `artifact_id`、revision、操作、reason code 和耗时，不记录正文。provenance API 足以从 Artifact 查 Run / consumer / Evidence，也可从 Run / Evidence 反查 Artifact。

## 7. 失败、恢复、安全与兼容

- **hash**：发布时与 resolver 每次读取时都对原始字节计算 SHA-256；inline 使用 UTF-8 编码后的字节。hash mismatch 已定位到 revision，始终使用 `artifacts.thread_id` 写 `artifact.resolve_rejected`，返回 `ARTIFACT_HASH_MISMATCH` 且绝不返回受损正文。sweep 只用 hash 判断候选文件名，不替代读取时校验。
- **路径边界**：先 `realpath` 授权根目录与 source 文件，再用平台原生 `relative(root, file)` 判断结果不得为绝对路径、`..` 或以 `..${sep}` 开头；这会解析 junction / symlink，并按 Windows 大小写不敏感语义比较。越界返回 `ARTIFACT_SOURCE_OUTSIDE_ROOT`。
- **恢复与租约**：`PERSONAHUB_ARTIFACT_ORPHAN_GRACE_MS` 默认 `3600000`（1 小时），`PERSONAHUB_ARTIFACT_SWEEP_LEASE_MS` 默认 `30000`（30 秒）。发布者与 sweeper 竞争 `archive-maintenance` DB 租约；重启清理只删除超过安全宽限期且未被任何 manifest 引用的 orphan，并额外要求 hash 文件名合法。临时文件也只在超过宽限期后删除。
- **只读边界**：content-addressed 命名和 ArtifactService“不打开既有 archive 做写入”是应用约定，不是操作系统级只读隔离；同用户的外部进程仍可能修改文件。resolver 每次读取 hash 校验是完整性兜底，本 Feature 不声称 chmod / ACL 安全边界。
- **兼容**：旧 `event:` / `file-change-set:` ref 行为不变；新增 artifact revision 解析测试覆盖 POSIX、Windows 分隔符模拟、junction/symlink 越界和大小写路径。Migration 只前进，不要求不存在的 down/rollback 流程。

## 8. 测试策略与验收映射

ArtifactService 的发布路径接受生产默认 `undefined` 的 `testHooks`：`afterTempWrite`、`afterFsync`、`afterRename`、`afterRevisionInsert`、`afterPointerCas`、`afterCommit`，沿用 `intake-service.ts` 的注入约定。故障测试只能在这些 hook 抛出；随后丢弃 service / database 实例，用同一 `dbPath` 重新 `openDatabase()` 组装 resolver 再断言，沿用 `restart-recovery.test.ts`。测试不得自行编排发布步骤。

| 验收项 | 测试层级 | 计划文件 / 场景 | 关键断言 |
|---|---|---|---|
| `AC-001` | integration | `server/tests/integration/artifact-publication.test.ts` | inline/file 创建修订、六个 hook 逐点 crash + reopen；resolver 只能返回完整 published revision 或 not-found；历史 revision 不漂移 |
| `AC-001` | integration | `server/tests/integration/migration-artifact.test.ts` | 真实旧 schema 顺延、重复 migration 幂等、既有表和查询仍可读 |
| `AC-002` | unit + integration | `server/tests/unit/artifact-ref.test.ts`、`server/tests/integration/artifact-resolver.test.ts` | 缺失、越界、unknown、floating dispatch ref、hash mismatch、Win32 target-exists 与 junction/symlink 均显式拒绝或按契约恢复 |
| `AC-003` | integration | `server/tests/integration/artifact-provenance.test.ts` | 多个 Artifact / Run / Dispatch / Evidence 同时存在时双向映射不串行；重复 consumption 幂等；事件只在 commit 后可回放 |
| `AC-003` | unit / contract | `web/src/f010-artifact-read-model.test.ts` | API client / hooks 区分 loading、empty、ready、missing、invalid、hash_mismatch；无可见组件或 Surface 注册 |

门禁先做红→绿：每条文档契约锁点先删除关键短语确认 `test:docs` 变红；实现测试也必须从产品路径触发 hook，不得复制 service 内部发布顺序。并发 fixture 同时包含多个 Artifact、相同内容和不同内容，覆盖批量索引与 CAS。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论或缓解 | 理由 | 替代方案 / 后续 |
|---|---|---|---|
| 事件投递 | F010 使用 transaction 内 `pendingEvents`、commit 后内存广播，不建持久化 outbox | 事件是可从持久事实重建的通知；避免无 owner 的跨 Feature 基础设施 | F011 的跨服务状态推进由 F011 独立评审是否需要 outbox |
| revision 草稿态 | 不持久化 draft revision；只有 commit 后的 manifest 是 published revision | 消除“未发布但可被 resolver 看见”的状态组合 | 若未来需要协作草稿，作为独立 Feature 增加草稿实体 |
| archive 只读 | 应用约定 + 每次读取 hash 校验，不声称 OS 隔离 | 本地同用户进程可绕过 chmod；如实表达安全边界 | 外部 Blob store / 受限账户在 v0.4+ 评估 |
| 大文件上限 | `PERSONAHUB_ARTIFACT_MAX_BYTES=10485760`（10 MiB）；写临时文件前拒绝并返回 `ARTIFACT_TOO_LARGE` | v0.3 只覆盖 inline Markdown 与受控本地文件，避免无界内存 / 磁盘使用 | Blob store、流式预览后移 |
| orphan 清理 | DB 租约 + 1 小时宽限 + manifest 反查；同 hash archive 可共享 | crash 后可恢复且不与在途发布竞争 | 每 Artifact 租约复杂度更高，当前无收益 |
| system-design 漂移 | 本设计冻结 source/archive 双 locator 与 Issue 归属，已同步回写 system-design §4 | Feature design 是实现契约真相源 | 后续字段变化先改本设计，再同步系统文档 |

## 10. 待确认设计问题

无。
