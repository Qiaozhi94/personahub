---
kind: feature
id: F009
version: "0.3"
status: draft
gate_version: 1
related_features: [F003, F004, F006, F010]
topics: [artifact, provenance, evidence, typed-ref, v0.3]
doc_kind: spec
created: 2026-08-09
updated: 2026-08-11
---

# F009：Artifact Foundation & Provenance

> Owner: TBD | Target: v0.3

> **⚠️ SUPERSEDED PENDING REVIEW（2026-08-13）**：本文的用户场景、UX 需求与非目标
> 写于产品体验重置之前，其产品判断已不可直接使用。v0.3 已暂停，PersonaHub 用户旅程
> 正在重做，本 Feature 的三件套（`spec.md` / `design.md` / `tasks.md`）在旅程与原型
> 定稿前**不得作为开发输入**，`status: draft` 不代表可用。处理结论见
> <a href="../../../reviews/product-experience-reset-plan.md">`docs/reviews/product-experience-reset-plan.md`</a>
> 第 7 节；重新进入计划的条件按该节表格逐项判定。技术契约部分（数据模型、接口）
> 可作为背景材料，但需与新旅程重新对齐后才生效。

## 0. 来源与意图

- **PRD 来源**：`docs/personahub-prd.md` 第 5 节 Artifact、Handoff Packet，第 15 节 v0.3。
- **架构来源**：`docs/personahub-architecture.md` 第 7 节。
- **系统设计 / Research / Contract 来源**：`docs/personahub-system-design.md` Artifact 草案。
- **上游决策**：无独立 ADR；本 Feature 契约由 v0.3 评审确定（见 `docs/features/0.3/README.md` 第 6 节 Q1-Q3）。
- **功能类型**：data-model / backend / runtime / ui。
- **规格模式**：full。
- **变更类型**：ADDED。
- **一句话意图**：让阶段成果成为有稳定版本、明确来源、可被统一引用和验证的一级实体。

## 1. 问题、目标与非目标

### 问题

当前协作结果主要存在 ThreadEvent payload、Run final message 和聊天文本中。它们能回放，却没有稳定的成果身份、类型和 revision；下游只能复制上下文，无法证明自己消费了哪一版结果。

### 目标

建立 Artifact 的最小闭环：登记、版本化、查询、typed ref 解析、evidence 追溯和 Inspector 展示。Feature 完成后，任意 artifact revision 均能定位来源 Thread 与 evidence；创建时提供了 `source_run_id` 的 artifact 还能进一步追溯到来源 Run（手工登记、无 Run 的 artifact 不具备这一项，Thread 归属始终必有）；历史引用在重启和源文件变化后仍不漂移。

### 非目标

- 本 feature 不自动从 agent 输出生成 artifact（留给 `F010`）。
- 本 feature 不实现 Room、Squad、全文搜索、外部 URL、富文本协作、Memory/Skill 自动沉淀。
- 本 feature 不允许跨 Project 或 workspace 外路径引用。

## 2. 用户场景

每个用户场景都应该能独立交付价值，并能独立验证。按优先级排序，确保只完成 P1 时也能形成一个有意义的最小切片。

### US-001：登记并查看阶段成果（Priority: P1）

作为 `Issue 协作者`，我希望 `在 Issue 下登记 inline Markdown 或受控本地文件 artifact 并查看其类型、当前 revision、来源和内容状态`，以便 `下游能稳定引用确定版本的结果`。

**为什么是这个优先级**：登记与查看是 artifact 成为一级实体的最小前提，没有它后续引用、追溯都无法成立。

**独立测试**：不运行 agent，直接创建 artifact；列表与详情返回一致的来源链。

**验收场景**：

1. Given `一个 Issue 与归属 Thread`，when `用户登记 inline Markdown artifact`，then `列表与详情返回一致的类型、revision、来源链`。
2. Given `受控目录内的本地文件`，when `用户登记 local file artifact`，then `详情显示内容状态与 hash`。

### US-002：稳定引用与历史复现（Priority: P1）

作为 `下游 Run/Handoff`，我希望 `用 artifact:<artifact_id>@<revision> 引用确定内容`，以便 `创建新 revision 后旧引用仍解析到原内容`。

**为什么是这个优先级**：引用不可漂移是 artifact 契约的核心，决定 handoff/validation 能否复现。

**独立测试**：创建 r1、r2，分别解析并断言内容不漂移。

**验收场景**：

1. Given `artifact 有 r1 与 r2`，when `解析 artifact:<id>@1 与 artifact:<id>@2`，then `分别返回 r1 与 r2 的原始内容`。
2. Given `源文件被替换`，when `解析旧 revision ref`，then `返回 hash mismatch 而非新内容`。

### US-003：Evidence 双向追溯（Priority: P2）

作为 `Issue 协作者`，我希望 `从 artifact 查看 evidence refs，也可查询某个 evidence ref 被哪些 artifact revision 引用`，以便 `证明成果与证据的对应关系`。

**为什么是这个优先级**：双向追溯依赖登记与引用先成立，故排在 P1 之后。

**独立测试**：两个 artifact 引用同一 event ref，反向查询返回两条且受 Project/Issue scope 限制。

**验收场景**：

1. Given `两个 artifact revision 引用同一 evidence ref`，when `反向查询该 evidence ref 的 artifact 消费者`，then `返回两条且不跨 Project/Issue scope 泄露存在性`。

## 3. 范围与边界

### 范围内

- 首批类型：`research_findings`、`synthesis_plan`、`implementation_log`、`verification_results`。
- 存储：`inline_markdown`、`local_file_path`；`db_record` 与 `external_url` 延后。两种类型走完全独立的持久化路径，不可共用同一条实现：`inline_markdown` 全程只有一次 DB 写入，不接触文件系统、不产生任何临时或归档文件；只有 `local_file_path` 才涉及下面的 source/archived locator 与文件系统协议。
- local file 区分两类路径，二者不可混用：
  - **source locator**（调用方提供）：workspace 内 `.personahub/artifacts/staging/` 下的规范化相对路径，指向调用方已预先写好的文件；系统按"先打开文件句柄、基于该句柄核实边界、再从同一句柄读取"的顺序处理，不允许校验与读取之间出现可被替换的路径解析窗口（防 junction/symlink TOCTOU）；仅用于一次性读取，不被持久化为最终归档位置。
  - **archived locator**（服务端生成）：按内容 `content_sha256` 派生的确定性相对路径，落在 `.personahub/artifacts/archive/` 下，调用方不可指定、不可覆盖，是唯一被 DB `relative_path` 记录和后续读取所依赖的路径；按内容而非 revision 号命名，使并发创建的不同 revision 天然落在不同文件，不会在写入阶段互相竞争同一目标。
- artifact 采用逻辑实体 + immutable revision；实体可改 title，可归档，不物理删除已引用 revision。
- artifact -> evidence/source 与 evidence -> artifact revision 双向查询。

### 范围外

- 自动从 agent 输出生成 artifact（`F010`）。
- 全文搜索、外部 URL 存储、富文本/多人编辑、Memory/Skill 自动沉淀。
- 跨 Project artifact 共享。

### 边界场景

- 当传入未知类型、跨 Issue/Project ref、越界路径、缺失文件或 hash 不匹配时会发生什么？系统必须显式失败，不能降级成空内容。
- 如果源文件被进程外修改，系统应如何处理？读取时重新校验路径与 hash，返回 missing/invalid，不伪造旧 revision。
- 在归档情况下，哪些事情绝不能发生？归档不得破坏历史 ref 解析，也不得阻止历史 revision 被读取。

## 4. 需求

使用稳定 ID，方便 design、tasks、code review 和 tests 引用。

### 功能需求

- **FR-001**：系统应创建 Artifact 实体与 revision 1，并验证 Issue、Thread、Room、Run 的归属一致性。
- **FR-002**：更新内容时应追加 revision；已存在 revision 的内容、storage locator、hash 和 evidence refs 不可修改。
- **FR-003**：系统应解析 `artifact:<id>@<revision>`；缺 revision 的 ref 只允许 UI 导航到 latest，不得用于 Run/Handoff 执行上下文。
- **FR-004**：系统应验证 artifact type、内容大小、UTF-8、路径边界和 SHA-256；inline_markdown 只校验 UTF-8/size/hash 并直接写 DB，不得触碰文件系统；local file 的 source locator 与 archived locator 分别校验——source locator 按"打开句柄 -> 基于句柄核实边界 -> 从同一句柄读取"处理，不得先校验路径字符串再重新按路径打开（防校验与读取之间的 TOCTOU 替换）；archived locator 的内容 hash 以服务端复制落盘后的字节为准，调用方提交的 hash（如有）不被信任；读取时重新校验 archived locator 的路径与 hash。
- **FR-005**：用户可列出 Issue artifacts、读取详情/指定 revision、创建 revision、归档实体。
- **FR-006**：系统应提供 artifact -> evidence/source 和 evidence -> artifact revision 的双向查询。
- **FR-007**：归档拆分为两个可判定的操作边界——`resolvePinned` 对 archived artifact 的任意已存在 revision 始终可读（不受归档状态影响，供历史 Run/Handoff/UI 回放使用）；`validateAttachableRef` 拒绝把 archived artifact 的 ref（无论新旧 revision）作为**新写入**附加到新的 Run/Handoff/消息（即在归档之后才发生的"挂接"动作，与 ref 字符串本身是否为历史值无关）。归档操作本身幂等：对已归档实体重复调用不追加新的 `artifact.archived` 事件，直接返回当前状态。

  归档只影响默认列表与新引用（`validateAttachableRef` 场景），不破坏历史 ref 解析（`resolvePinned` 场景）。

### 数据 / 实体需求

- **DR-001**：Artifact 保存 project/issue/thread/room/run 归属、type、title、status、current revision。
- **DR-002**：ArtifactRevision 保存 revision、storage type、content/relative path、content hash、size、evidence refs、creator 与时间。
- **DR-003**：同一 artifact 的 revision 单调递增且唯一；引用目标由 `(artifact_id, revision)` 唯一确定。

### 事件 / Trace 需求

- **TR-001**：创建、修订、归档分别写 `artifact.created`、`artifact.revised`、`artifact.archived` ThreadEvent，payload 不复制完整内容。

### API / 接口需求

- **IR-001**：HTTP 边界使用 zod；错误至少包含 `ARTIFACT_NOT_FOUND`、`ARTIFACT_REF_INVALID`、`ARTIFACT_SCOPE_MISMATCH`、`ARTIFACT_PATH_INVALID`、`ARTIFACT_CONTENT_MISSING`、`ARTIFACT_HASH_MISMATCH`、`ARTIFACT_TOO_LARGE`、`ARTIFACT_REVISION_CONFLICT`。revise 请求必须携带调用方读取内容时看到的基线 `expected_revision`（正整数）；服务端用单条原子条件更新（`UPDATE artifacts SET current_revision = ? WHERE id = ? AND current_revision = expected_revision`）做 CAS：更新影响 0 行即判定冲突，立即返回 409 `ARTIFACT_REVISION_CONFLICT` 并携带当前 `latest_revision`，服务端不得对请求内容做任何业务重试（避免把基于旧内容的编辑静默重放到新 latest 上）；调用方须按最新 `latest_revision` 重新读取并重新提交。

### UX 需求

- **UX-001**：Inspector 展示 list/detail/revision/source/evidence，以及 loading/empty/missing/invalid/hash_mismatch/archived 六种状态；`missing`/`invalid`/`hash_mismatch` 对应 `ArtifactResolution.status` 的同名取值，`loading`/`empty`/`archived` 是纯前端状态。

### 非功能需求

- **NFR-001**：性能：inline 单 revision 上限 256 KiB，本地文件上限 2 MiB；列表不得读取正文。
- **NFR-002**：可靠性 / 恢复：创建 revision 与事件写入同事务；事务提交前不得广播。
- **NFR-003**：安全 / escalation 边界：Windows 路径必须防绝对路径、盘符切换、UNC、`..`、junction/symlink 越界与大小写绕过。

## 5. 生命周期与不变量

```text
active --archive--> archived
active --new revision--> active
archived --archive（幂等，不追加事件）--> archived
archived --resolvePinned(任意已存在 revision)--> archived（允许读取）
archived --new revision--> 拒绝（409）
archived --validateAttachableRef(新写入 Run/Handoff/消息)--> 拒绝
```

不变量：

- 已存在 revision 的内容、storage locator、hash 和 evidence refs 不可修改（FR-002）。
- 引用目标由 `(artifact_id, revision)` 唯一确定；历史 ref 永远解析旧内容（DR-003、FR-003）。
- 创建 revision 与事件写入同事务，提交前不得广播（NFR-002）。
- 归档不破坏历史 ref 解析（`resolvePinned` 对任意已存在 revision 始终可读），但拒绝把 archived artifact 新挂接到 Run/Handoff/消息（`validateAttachableRef`）；归档操作本身幂等（FR-007）。

## 6. 成功与验收

### 成功标准

- **SC-001**：r1/r2 ref 在重启和源文件变化后仍不漂移；变化时返回 hash mismatch。
- **SC-002**：任意 artifact revision 均能定位来源 Thread 与 evidence；若创建时提供 `source_run_id`，同时能定位来源 Run。
- **SC-003**：列表 100 个 artifact 时不加载正文，单机本地响应目标小于 200 ms。

### 验收清单

验收清单每项引用第 4 节真实存在的需求 ID。本 Feature 处于 `draft`，`tests:` 路径暂缺，进入 `review` 前回填。

- [ ] **AC-001** (`FR-001`, `DR-001`): inline 与 local file 均能创建并显示来源；两者走独立协议——inline 创建不产生任何文件，local file 创建不写 `inline_content`。
- [ ] **AC-002** (`FR-002`, `FR-003`): 旧 revision ref 永远解析旧内容。
- [ ] **AC-003** (`FR-004`, `NFR-003`): 路径越界、文件替换和超限均被拒绝；校验通过后、读取前把 source locator 换成 workspace 外目标（junction/symlink 竞态）同样被拒绝，不产出内容。
- [ ] **AC-004** (`FR-006`): 双向追溯在 scope 内正确、跨 scope 不泄露存在性。
- [ ] **AC-005** (`TR-001`, `NFR-002`): 事件与数据同提交同回滚且无幽灵 SSE。
- [ ] **AC-006** (`FR-007`): `resolvePinned` 对归档实体的任意已存在 revision 仍可解析；`validateAttachableRef` 拒绝把 archived artifact 新挂接到 Run/Handoff/消息；重复归档幂等、不追加事件。
- [ ] **AC-007** (`FR-005`, `IR-001`): 列出/读取详情与指定 revision/创建 revision/归档实体的完整 CRUD 均可用；revise 携带 `expected_revision`，`expected_revision` 落后的 stale writer 立即收到 409；两个提交同一 `expected_revision` 的真实竞争者中败者也收到 409 `ARTIFACT_REVISION_CONFLICT` + `latest_revision`、胜者成功且互不覆盖或删除对方归档文件，不发生静默重放。
- [ ] **AC-008** (`UX-001`): Inspector 完整渲染 loading/empty/missing/invalid/hash_mismatch/archived 六种状态。
- [ ] **AC-009** (`NFR-001`): 列表 100 个 artifact 时不读取正文，单机本地响应小于 200 ms。

## 7. 测试、依赖与决策

### 测试策略

- 单元测试：ref parser、type/size/hash/path validator、revision allocator。
- 集成测试：migration、CRUD、三个独立连接同时 revise（一个 stale writer + 两个共享同一 `expected_revision` 的真实竞争者）的 CAS 冲突判定与胜负双方文件互不干扰、归属校验、inline 与 local file 分别做事务故障注入（inline 只需单一 DB 事务回滚断言，local file 覆盖文件系统崩溃点）、反向 evidence 查询。
- UI / E2E：列表、详情、revision 切换、六种异常状态。
- 真实环境 / 手动验证：Windows junction/symlink 静态越界与"校验通过后、读取前被替换"竞态；大小写路径边界；重启后历史引用回放。

### 依赖

- 上游 Feature / Contract：F003 ThreadEvent/Evidence、F004 EvidenceService。
- 下游消费者：F010 消费本 Feature 的 artifact ref 与 revision 契约。
- 外部 / 环境依赖：Windows 路径行为需真实环境验证。

### 决策与风险

| 决策 / 风险 | 结论或缓解 | 理由 | 后续 |
|---|---|---|---|
| artifact 版本模型 | entity + immutable revision | 历史输入可复现，旧 ref 不漂移 | 不原地 UPDATE |
| ref pinning | pinned ref 进入执行上下文 | latest 会漂移 | 仅 artifact id 不允许进入执行 |
| local file 存储 | 复制到受控目录 | 可约束路径与 hash | 不引用任意绝对路径 |
| inline 与 local file 持久化路径 | 两条完全独立的协议，不共用文件发布管线 | inline 是单一 DB 事务；共用管线会让 inline 也产生文件，与存储字段二选一约束和同事务要求矛盾 | 不设计统一的"先落文件再落 DB"通用管线 |
| metadata 与内容分表 | 列表不加载正文 | 100 项列表性能 | 不用单表 JSON manifest |
| 本地文件可被进程外修改（风险） | 受控目录 + pinned hash 检出，不假装文件不可变 | 读取时重新校验 hash | 无 |

## 8. 待确认问题

- [x] Q-001: artifact 是否允许原地覆盖？ - 决策：采用 entity + immutable revision，不允许原地覆盖。
- [x] Q-002: 执行上下文是否接受不带 revision 的 artifact ref？ - 决策：执行上下文只接受带 revision 的 pinned ref；缺 revision 的 ref 只允许 UI 导航到 latest。
- [x] Q-003: 首批开放哪些 storage 类型？ - 决策：首批只开放 inline_markdown 与 workspace 内受控 local_file_path；local file 拆分 source locator（`.personahub/artifacts/staging/`，调用方提供，open-then-verify-then-read 读取）与 archived locator（`.personahub/artifacts/archive/`，服务端按内容 hash 生成、不可指定），详见第 3 节。
