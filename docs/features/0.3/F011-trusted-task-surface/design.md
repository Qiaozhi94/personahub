---
related_features: [F006, F009, F010, F012, F013, F014]
topics: [task-surface, projection, claims, evidence, acceptance, resources, trace]
doc_kind: design
created: 2026-08-09
updated: 2026-09-13
---

# F011：Trusted Task Surface - 设计

## 0. 输入与约束

本设计实现 `spec.md`，并受以下已冻结或前置契约约束：

- F009：`ApplicationShell`、route / draft store、共享 tabs / dialog / status banner，以及 `migration-matrix.md` 中 F011 owner 的 P005、P008、A004、A005、A016–A024。
- F010：schema v12 的 Artifact entity + immutable revision、`artifact:<id>@<revision>` typed ref、六态读取、provenance、`recordConsumption`；F011 不修改这些表和发布协议。
- F012：Session / Thread、Dispatch、Attempt、context snapshot、intervention API、持久 outbox 与独立性 capability evidence；实现开始前必须以实际导出类型替换本文的概念名，不得造临时镜像字段。
- F013：versioned effective completion requirements 与 EvidenceSpec；F011 冻结快照，不重新合并 Skill requirements。
- ADR 0009 / 0011：上下文范围、冷启动和 adapter 原生 memory 隔离决定独立性上限。
- ADR 0010：固定骨架是“完成要求 → 主张 → 论证 → 证据”，未支撑主张必须显式在场，证据使用天然标识。

实现时读取 `CURRENT_SCHEMA_VERSION` 并顺延 migration，不预占版本号。F010 当前分支已到 schema v12，但 F013 / F012 按执行顺序可能先增加 migration；F011 只追加当时下一个版本。

## 1. 技术概要与影响面

F011 增加一个只读 TaskProjectionService、一个 AcceptanceService 写模型和 V3.44 四视图生产 surface。投影按 view 返回公共 envelope + 分页 detail，而不是一次装载全部消息、trace 和正文。

影响面如下：

| 层 | 新增 / 修改 | 明确不做 |
|---|---|---|
| shared | Task projection、acceptance command / result、verdict、resource ref 类型 | 不复制 F010 / F012 类型 |
| server application | `TaskProjectionService`、`AcceptanceService`、`IndependenceEvaluator`、task create confirmation orchestration | 不写 Run / Dispatch / Artifact 状态 |
| persistence | acceptance case / baseline / requirement / claim revision / argument / evidence-link event / requirement decision / summary / acceptance event 表与索引 | 不改已发布 migration；不持久化 UI filter / badge |
| API | task list / confirm、按 view projection、task SSE、acceptance append-only commands | 不暴露“设置独立性”或“直接置 done”API |
| web | task list、task route shell、四视图、四副栏、全文 / 预览 stage | 不复制原型 HTML / mock 数据 |
| compatibility | 删除 F011 owner 的 transitional host，保留 legacy read adapter | 不删除历史 validation / trace / evidence 数据 |

`docs/personahub-system-design.md` 的 claim / argument 建议形状在实现落定时按本节 schema 回写；文档不得继续把尚未实现的 claims 归给 F010。

## 2. 架构与模块边界

依赖方向固定为：

```text
Task routes / React views
  ├─ TaskProjection API ──> TaskProjectionService (read-only)
  │    ├─ Issue / F012 Session-Dispatch-Attempt readers
  │    ├─ AcceptanceReader + IndependenceEvaluator
  │    ├─ F010 Artifact / provenance readers
  │    └─ existing Trace / Evidence readers
  └─ command APIs
       ├─ task confirm orchestration ──> IssueService + AcceptanceService(tx)
       ├─ acceptance commands ────────> AcceptanceService
       └─ execution / intervention ───> F012 public services

AcceptanceService --transaction--> acceptance repositories + acceptance event
                                      + DomainOutbox.enqueue(acceptance.completed)
DomainOutbox worker -------------> IssueService.consumeAcceptanceCompleted()
```

边界规则：

1. `TaskProjectionService` 只读取 canonical stores；presentation state、attention 和 verdict 是纯函数，输入 fixture 可脱离数据库单测。
2. `AcceptanceService` 是 baseline、claim chain、requirement decision 与 completion summary 的唯一 writer。API、migration adapter 和 task create orchestration只能调用它的 transaction-aware port。
3. `IssueService` 仍是 Issue writer。F011 不能执行 SQL 直接置 done；它只发布 `acceptance.completed`，IssueService 验证 payload 并幂等推进。
4. `IndependenceEvaluator` 只读 evidence ref、producer / validator execution snapshot 和 F012 capability evidence；结果不持久化为可编辑状态。
5. 会话 / 轨迹 / 资源 / 验收视图不能各自重新解释状态。所有主操作由 projection 返回稳定 `action.kind` 与 `action.owner`，组件只把它路由到对应公共 command。

`TaskProjectionService` 是逻辑上的单一 projection，不是单一巨型 SQL。各 view reader 共享一次 `ProjectionFacts` 装配和同一套纯函数，再按 view 分页取 detail；公共 envelope 的 `projection_cursor` 与 `acceptance_version` 用于检测切换期间的漂移。

## 3. 数据模型与 Migration

### 3.1 表与冻结字段

```text
acceptance_cases
  issue_id PK -> issues(id)
  state: open | finalizing | completed | legacy_unresolved
  version INTEGER >= 1
  current_baseline_id nullable
  completion_summary_id nullable
  created_at, updated_at

acceptance_baselines
  id PK, issue_id -> acceptance_cases(issue_id)
  baseline_no INTEGER >= 1
  previous_baseline_id nullable
  source_kind: task_create | requirement_change | legacy_import
  source_refs_json                 # sorted skill@version / dispatch refs
  fingerprint                     # canonical baseline SHA-256
  confirmed_by, confirmation_reason nullable
  created_at
  UNIQUE(issue_id, baseline_no)
  UNIQUE(issue_id, fingerprint)

acceptance_requirements
  id PK, issue_id -> issues(id)
  upstream_key                    # F013 effective requirement id
  definition_json                 # frozen Requirement + EvidenceSpec
  fingerprint                     # canonical definition SHA-256
  created_at
  UNIQUE(issue_id, fingerprint)

acceptance_baseline_items
  baseline_id -> acceptance_baselines(id)
  requirement_id -> acceptance_requirements(id)
  ordinal INTEGER >= 0
  PRIMARY KEY(baseline_id, requirement_id)
  UNIQUE(baseline_id, ordinal)

acceptance_claims
  id PK, issue_id -> issues(id)
  requirement_id -> acceptance_requirements(id)
  current_revision INTEGER >= 1
  state: active | withdrawn
  created_at, updated_at

acceptance_claim_revisions
  claim_id, revision
  statement, source_kind: system_fact | model_statement | user_judgement
  source_ref nullable, created_by, created_at
  PRIMARY KEY(claim_id, revision)

acceptance_arguments
  id PK
  claim_id, claim_revision -> acceptance_claim_revisions
  rationale, source_kind, source_ref nullable, created_by, created_at

claim_evidence_link_events
  id PK
  claim_id, claim_revision, argument_id
  evidence_ref, action: attached | detached
  relation: supports | contradicts
  created_by, idempotency_key, request_fingerprint, created_at
  UNIQUE(claim_id, claim_revision, idempotency_key)

requirement_decision_events
  id PK, baseline_id, requirement_id
  action: accepted_risk | marked_not_applicable | revoked
  reason, created_by, idempotency_key, request_fingerprint, created_at
  UNIQUE(baseline_id, requirement_id, idempotency_key)

completion_summaries
  id PK, issue_id UNIQUE, baseline_id
  acceptance_version INTEGER
  snapshot_json, summary_markdown, content_hash
  created_by, created_at

acceptance_events
  id PK, issue_id, sequence INTEGER, type, source_ref, payload_json, created_at
  UNIQUE(issue_id, sequence)
  UNIQUE(issue_id, source_ref)
```

`acceptance_cases.version` 是整个写模型的 CAS token。每个成功 command 在同一事务内验证 `expected_version`、写 immutable rows / pointer、把 version 加一并追加 `acceptance_events`。失败不消耗版本。

### 3.2 Immutable 与 identity 规则

- baseline、requirement definition、claim revision、argument、link event、decision event、summary 和 acceptance event 只追加；migration 为 immutable 表加 `BEFORE UPDATE` / `BEFORE DELETE` reject trigger。可变的只有 `acceptance_cases` head、`acceptance_claims.current_revision/state`。
- requirement fingerprint 对 F013 canonical Requirement JSON 做 SHA-256；同一 Issue 中 fingerprint 相同即复用同一 requirement identity。基线变化时，未变 requirement 继续引用原行；内容变化必得新 identity，因此旧 claim / evidence 不会静默继承。
- baseline fingerprint 对稳定排序后的 requirement fingerprints + source revision refs 计算。相同请求重放返回既有 baseline，不生成相同内容的第二版。
- claim 修改创建 `current_revision + 1`；旧 argument 和 evidence link 仍绑定旧 revision。新增 evidence 可以附到当前 revision；撤销以 `detached` event 表达，不删除原关系。
- `created_by` / `confirmed_by` 从服务端 actor context 取得；HTTP client 不能自行声明操作者。`idempotency_key` 来自请求头，重复 key + 同 fingerprint 返回原结果，重复 key + 不同 fingerprint 返回 `IDEMPOTENCY_PAYLOAD_MISMATCH`。

### 3.3 Summary snapshot

`completion_summaries.snapshot_json` 使用版本化 schema，至少固定：

```ts
type CompletionSnapshotV1 = {
  schema_version: 1;
  issue_id: string;
  baseline: { id: string; fingerprint: string; source_refs: string[] };
  requirements: Array<{
    requirement_id: string;
    definition_fingerprint: string;
    resolution: "satisfied" | "not_applicable" | "accepted_risk";
    claim_revisions: Array<{
      ref: string;
      statement: string;
      source_kind: "system_fact" | "model_statement" | "user_judgement";
      arguments: Array<{ id: string; rationale: string }>;
      evidence: Array<{
        ref: string;
        relation: "supports" | "contradicts";
        domain_status: string;
        verdict: ClaimVerdict;
        independence_reasons: string[];
      }>;
    }>;
    decision_ref: string | null;
  }>;
  artifact_revision_refs: string[];
  generated_by: string;
  generated_at: string;
};
```

`summary_markdown` 只能由 snapshot 的确定性 renderer 生成；hash 针对 canonical `snapshot_json`，不是 Markdown。summary 不保存当前 Artifact pointer、当前 Skill state 或实时 adapter 配置。

### 3.4 索引与 migration

至少建立以下非主键索引并用 `EXPLAIN QUERY PLAN` 锁定：

- `acceptance_baselines(issue_id, baseline_no DESC)`；
- `acceptance_baseline_items(baseline_id, ordinal)`；
- `acceptance_claims(issue_id, requirement_id, state)`；
- `claim_evidence_link_events(claim_id, claim_revision, created_at, id)`；
- `requirement_decision_events(baseline_id, requirement_id, created_at, id)`；
- `acceptance_events(issue_id, sequence)`。

Migration 只追加新表 / 索引 / trigger，不修改 F010 表。新任务通过 transaction-aware port 原子创建 initial baseline。既有 active Issue 的 backfill 按顺序选择：① F012 已冻结的最新 requirement snapshot；② F013 `skill_legacy_combo_map` 可确定解析的 effective requirements；两者都没有则创建 `legacy_unresolved` case，不虚构 requirement。既有 Done + `evidence_summaries` 不倒推 normalized claims，只由 legacy adapter 只读投影；F014 在 migration report 中统计 unresolved / legacy-completed 数量。

## 4. 接口、Contract 与 Event

### 4.1 TaskProjection contract

```ts
type TaskView = "overview" | "conversation" | "acceptance" | "resources";
type TaskPresentationState =
  | "created" | "awaiting_start" | "awaiting_permission" | "queued"
  | "running" | "awaiting_dispatch" | "validation_unconverged"
  | "failed" | "interrupted" | "cancelled" | "completed"
  | "archived" | "legacy_unknown";

type TaskAction = {
  kind: string;
  owner: "acceptance" | "issue" | "dispatch" | "attempt" | "diagnostics";
  target_ref: string;
  enabled: boolean;
  disabled_reason: string | null;
  impact: { changes: string[]; preserves: string[]; recovery: string };
};

type AttentionItem = {
  key: string;                       // canonical source key
  handling_view: TaskView;           // exactly one owner view
  kind: string;
  title: string;
  action: TaskAction;
};

type TaskProjectionEnvelope = {
  schema_version: 1;
  projection_cursor: string;         // opaque composite cursor
  acceptance_version: number | null;
  task: TaskHeader;
  presentation: {
    state: TaskPresentationState;
    pending_completion: boolean;
    priority_fact: TaskFact;
    primary_action: TaskAction | null;
  };
  attention: {
    total: number;
    by_view: Record<TaskView, number>;
    items: AttentionItem[];
  };
  detail:
    | { view: "overview"; value: OverviewProjection }
    | { view: "conversation"; value: ConversationProjection }
    | { view: "acceptance"; value: AcceptanceProjection }
    | { view: "resources"; value: ResourcesProjection };
};
```

`projection_cursor` 是 base64url 编码的 canonical cursor vector，包含当前 Issue / F012 domain event、所选 Session thread event、acceptance event 与 Artifact event high-water；client 只回传、不解析。每个 projected item 另有 `source_key`。snapshot 与 SSE replay 都用 `source_key` 去重，不能靠数组位置或文案去重。

Presentation state 纯函数采用固定优先级：archived → matching completion summary / pending completion → unresolved permission → newest draft / starting Dispatch → newest queued / running Attempt → newest validation result → newest failed / interrupted / cancelled Attempt → completed Issue → successful terminal Attempt waiting dispatch → created → legacy_unknown。状态测试必须通过每行 fixture 的整组输入验证，不能只测 enum 数量。

### 4.2 HTTP / SSE

- `GET /api/tasks?space_id=<id>&project_id=<id?>&label=<label?>&after=<cursor>&limit=<n>`：稳定 task list；状态只作行内事实，不作为分组键。
- `POST /api/tasks:preview`：解析归属 / Skill / initial requirements，返回将创建的 Task + baseline，不写数据。
- `POST /api/tasks:confirm`：以 `Idempotency-Key` 确认创建；Issue、首个 Session / Thread 与 initial baseline 在同一事务内提交。派工仍由 F012 单独确认。
- `GET /api/tasks/:id/projection?view=<view>&room_id=<id?>&after=<cursor?>&limit=<n>`：公共 envelope + 目标 view detail。
- `GET /api/tasks/:id/events`：SSE；接受 `Last-Event-ID` 的 opaque cursor，事件只表示 source keys 失效 / 新增，客户端随后合并或 refetch projection。
- `POST /api/tasks/:id/acceptance/baselines:preview`、`.../baselines:confirm`：先 diff 后确认。
- `POST /api/tasks/:id/acceptance/claims/:claimId/revisions`：追加 claim revision 与 arguments。
- `POST /api/tasks/:id/acceptance/claims/:claimId/evidence`：追加 attach / detach event；evidence ref 先过公共 parser / resolver。
- `POST /api/tasks/:id/acceptance/requirements/:requirementId/decisions`：追加 accepted risk / not applicable / revoke；只有 user actor 可接受风险或标记不适用。
- `POST /api/tasks/:id/acceptance:complete`：验证 gate，写 summary + outbox；成功返回 `finalizing` 或已存在的 completed result。

所有 acceptance command 使用 `If-Match: "acceptance-<version>"` 与 `Idempotency-Key`。稳定错误至少包括：`ACCEPTANCE_VERSION_CONFLICT`、`ACCEPTANCE_LOCKED`、`BASELINE_CONFIRMATION_REQUIRED`、`REQUIREMENT_NOT_CURRENT`、`EVIDENCE_REF_UNRESOLVED`、`RISK_REASON_REQUIRED`、`ACCEPTANCE_REQUIREMENTS_UNRESOLVED`、`ACCEPTANCE_ACTIVE_EXECUTION`、`ACCEPTANCE_SUMMARY_MISMATCH`、`IDEMPOTENCY_PAYLOAD_MISMATCH`。

### 4.3 Verdict / independence

```ts
type ClaimVerdict =
  | "independently_verified"
  | "evidence_pending"
  | "needs_attention";
```

精确结论另返回 `domain_status` 与 reason codes。Evaluator 顺序为：

1. evidence ref 解析失败、原生状态映射为 failed、存在未处置 contradicting evidence → `needs_attention`。
2. 没有 active supporting evidence → `needs_attention`。
3. evidence 满足，但 requirement 不要求 independence → `evidence_pending`，直到用户 / domain contract 明确收敛；不能因“不要求独立”自动画绿勾。
4. 要求 independence 时，只有 F012 snapshot 证明 validation purpose、强制 cold start、允许的 context scope、未包含实现过程自述、原生 memory isolation=supported、执行身份满足 F012 独立性规则，且证据原生状态 satisfied，才为 `independently_verified`。
5. `context_scope=all`、resume、同源 identity、隔离 unsupported / unverified 或缺少任一 snapshot 字段都降为 `evidence_pending` 并返回具体 reason；未知不能乐观通过。

三态与精确 reason 都是 projection 结果。数据库不保存 `independently_verified=true` 一类可漂移字段。

### 4.4 Event / outbox

AcceptanceService 追加 `acceptance.baseline_frozen`、`acceptance.baseline_changed`、`acceptance.claim_revised`、`acceptance.evidence_linked`、`acceptance.evidence_unlinked`、`acceptance.requirement_decided`、`acceptance.requirement_decision_revoked`、`acceptance.completion_created`。payload 只含 IDs、fingerprints、版本与 reason code，不含正文。

完成事务在同一 SQLite transaction 内写 summary、`acceptance.completion_created` 与 F012 提供的持久 `DomainOutbox.enqueue("acceptance.completed", payload)`；payload 固定 `issue_id`、`summary_id`、`baseline_id`、`acceptance_version`、`summary_hash`。IssueService consumer 必须重新读取 summary，逐字段核对 payload、确认没有另一个 summary，并以 outbox event ID 幂等推进 done。消费成功后 AcceptanceService head 进入 `completed`；任一步失败由同一 event 重试，不创建新 summary。

普通 acceptance event 的实时广播失败不回滚领域事实；重连从 `acceptance_events` 重建。跨服务推进必须走持久 outbox，不能退回 F010 的内存广播模式。

## 5. Runtime、Workflow 与并发

### 5.1 Acceptance command serialization

每个 command 在单一事务内按以下顺序执行：读取 `acceptance_cases` → 校验 idempotency / request fingerprint → 校验 expected version / state → 验证引用与 actor → 追加 immutable rows / event → CAS 更新 case head/version → commit → 广播。CAS 失败返回当前 version，不自动重试会改变用户判断的命令。

`baseline:preview` 纯读且返回 `base_acceptance_version`；confirm 必须提交相同 base version 和 preview fingerprint。preview 后出现新写入时 confirm 冲突，用户必须重新看 diff。

### 5.2 Complete / outbox race

complete 在事务内再次计算当前 requirement resolution，并查询 F012 是否有 draft / starting Dispatch、queued / running Attempt 或未决 permission。存在任一项即 `ACCEPTANCE_ACTIVE_EXECUTION`。通过后写 summary 与 outbox，并把 case `open → finalizing`；此时所有 acceptance write command 返回 `ACCEPTANCE_LOCKED`。

worker crash 前后均安全：

- summary / event commit 前 crash：三者都不存在，原命令可用同一 key 重试；
- commit 后 delivery 前 crash：case 保持 finalizing，重启 worker 投递同一 event；
- Issue done 后 ack 前 crash：consumer 用 event ID + summary ID 返回已应用，随后 ack；
- payload / summary 不匹配：拒绝消费并保留 outbox 错误，不推进 Issue。

### 5.3 Projection consistency

projection 允许跨 canonical transaction 的短暂时间差，但必须显式表达 `pending_completion`、`artifact_pending` 或 source unavailable，不能提前推断状态。一次 response 内先固定各 reader 的 high-water，再读取 detail；若读取结束 high-water 已变化，返回 `stale=true` 和新 cursor，由 client 合并 / refetch，不拼成伪一致快照。

attention 使用稳定 key 的集合归并；同一 key 只有一个 `handling_view`。概览可展示其他 view 待办摘要，但只链接，不重复进入 `by_view.overview`。

## 6. UI 与可观测性

### 6.1 Route 与状态所有权

- `/tasks/:taskId` replace 到 `/tasks/:taskId/overview`；注册 `overview`、`conversation`、`acceptance`、`resources` 四个明确 slug，未知 view 延用 F009 canonicalization 并带诊断。
- Task route shell 拥有 task ID、当前 view、选中 Room、composer draft key、四个副栏展开状态和全文返回位置。领域对象不保存这些 UI 状态。
- task header 第一行显示 ID / title / canonical metadata，第二行四 tabs；tab panel 共用宽度和左边界。badge 只读 `attention.by_view`。
- 输入框仅一份。发送时调用 F012 Dispatch / message API；草稿沿用 F009 generation store，匹配成功才清空。

### 6.2 四视图

- **概览 + 活动**：主栏依次呈现 priority fact、待决定、目标、当前情况、下一步；状态异常时 priority fact 提到最前。活动只显示 task-level events，点击可去 canonical handling view。
- **会话 + 轨迹**：Room selector 切消息与对应 trace；trace 展示 input / model / tool / timing 和执行组合 / context lineage，支持搜索、按事件类型分页、折叠、全宽；它不写会话总结。
- **验收 + 大纲**：三张状态卡筛选同一 claim tree，可再次点击取消；每个 requirement 下显式显示 claim / argument / evidence / exact verdict / reason。实现回归单独折叠，不与用户级验收混算。点长文档进入同一主栏全文，返回条恢复 requirement / scroll anchor。
- **资源 + 预览**：产出来自 Issue-owned Artifact revisions 与 Run file changes；输入来自 F010 consumptions + F012 dispatch context items。以 typed ref / file identity 去重但保留 input / output 双方向。点选只更新副栏；Artifact 读取严格呈现 loading / empty / ready / missing / invalid / hash_mismatch。

### 6.3 可访问性与观察

复用 F009 primitives：tabs 有 `aria-selected`、roving tab index、方向键与 Home / End；dialog 焦点陷阱、Esc 与焦点归还；表格有 caption / headers；状态变化用常驻 feedback。Markdown 经过现有 sanitizer，禁用 raw HTML / script；文件预览只显示授权相对路径。

metrics / logs 只记录 task ID、view、projection duration、source counts、cursor lag、stable reason code 和 command outcome；不记录 goal、claim、argument、evidence / Artifact 正文、绝对路径、provider session ID 或凭据。Eval events 使用 task-scoped 去重 key，不建立信任分。

## 7. 失败、恢复、安全与兼容

- **读取失败**：一个 detail source 失败时返回 typed partial section + retry action；header / primary action 仍由可用 facts 计算。关键状态 source 缺失则 `legacy_unknown`，不能用旧 IssueStatus 猜测。
- **Artifact / file**：F010 missing / invalid / hash mismatch 原样展示且绝不回退 current；F013 授权失败不泄露路径是否存在。二进制内容只有支持的安全预览，否则提供元数据，不执行。
- **恶意正文**：claim / argument / Markdown / terminal output 均视为不可信文本；React text escape + sanitizer，URL scheme 白名单，导出使用 attachment 与固定 MIME。
- **越权写入**：actor 由 server context 注入；只有 user actor 可确认 baseline、接受风险、标记不适用和完成。模型可提交 claim / argument / evidence 候选，不能自行完成。
- **旧数据**：旧 EvidenceSummary / validation rounds / findings 通过 `LegacyAcceptanceProjection` 只读显示，明确标“旧验收记录，完成要求范围不可完整还原”；`same_origin_validation=true` 永不显示独立。active legacy 无 snapshot 时 `legacy_unresolved` 阻止新完成。
- **入口退出**：新旅程通过后，从 route composition 删除 `IssueInspector`、旧 `EvidenceSection`、旧 validation dialogs 和 direct legacy handlers；服务端旧 API 在 F014 migration window 内可保留只读或明确 deprecated wrapper，但 production UI 不可达。历史 tests 可迁到 contract fixture，不能靠删测试掩盖能力丢失。
- **恢复**：SSE 断线用 opaque cursor replay；cursor 无法解析时返回完整 snapshot + 新 cursor，不 silently drop。outbox poison event 保留稳定错误与诊断入口，不自动跳过。

## 8. 测试策略与验收映射

| AC | 层级 | 计划文件 | 关键断言 |
|---|---|---|---|
| AC-001 | unit + component | `server/tests/unit/task-presentation-state.test.ts`、`web/src/f011-task-state-matrix.test.tsx` | 11 行逐项语义；archived / legacy_unknown；唯一 action owner 与影响说明 |
| AC-002 | unit + integration + component | `server/tests/unit/acceptance-verdict.test.ts`、`server/tests/integration/task-acceptance-projection.test.ts`、`web/src/f011-acceptance-view.test.tsx` | 未覆盖显式；三态 + exact reasons；同源 / scope / memory / ref 六组负例 |
| AC-003 | integration + component | `server/tests/integration/task-resource-projection.test.ts`、`web/src/f011-conversation-resources.test.tsx` | Room / trace 联动；input/output revision；六态预览；草稿与返回 anchor |
| AC-004 | unit + integration + browser | `server/tests/integration/task-projection-replay.test.ts`、`e2e/tests/f011-task-surface.spec.ts` | cursor / source key 去重；分页索引；tabs / dialog / table / keyboard；断线补读 |
| AC-005 | integration | `server/tests/integration/acceptance-baseline.test.ts`、`server/tests/integration/migration-acceptance.test.ts` | create 原子性、preview-confirm CAS、requirement identity、不继承变化项、legacy backfill |
| AC-006 | integration + restart | `server/tests/integration/acceptance-completion.test.ts`、`server/tests/integration/acceptance-outbox-recovery.test.ts` | 每个 transaction seam 故障；active execution gate；summary / event / done 一致；重复 delivery |
| AC-007 | contract + browser | `tools/check-v03-plan-contracts.test.mjs`、`e2e/tests/f011-task-surface.spec.ts` | 矩阵 14 行逐行 completion evidence；旧组件 / route / write entry 不可达 |

AcceptanceService 提供仅测试注入的 transaction hooks：`afterRequirementWrite`、`afterClaimWrite`、`afterSummaryInsert`、`afterAcceptanceEventInsert`、`afterOutboxEnqueue`、`afterCaseCas`、`afterCommit`。故障测试必须丢弃 service / DB 实例后用同一 DB path reopen 再断言，不直接编排 repository 步骤。

V3.44 browser checks 至少覆盖 BC-003/004、009–026、031–039、046–052、059、071；BC-033 在 v0.3 只验证骨架没有 coding-only 分支，真正非 coding Evidence Adapter 的领域旅程仍归 v0.5。迁移矩阵逐行验收不能用“旧组件文件已删除”替代生产 route / registry 不可达证明。

## 9. 已确认决策与残余风险

| 决策 / 风险 | 结论 | 理由 / 缓解 |
|---|---|---|
| projection 形状 | 一个 service、公共 envelope、按 view discriminated detail | 保持单一语义并避免巨型 payload |
| presentation state | 纯 projection，不新增 Task 状态列 | Run / Dispatch / Issue 继续是执行事实真源 |
| acceptance concurrency | case-level version CAS + command idempotency | 防止基线、claim 与 complete 互相静默覆盖 |
| 跨服务完成 | summary + persistent outbox 同事务；IssueService 幂等消费 | 解决无摘要 done 与重启丢推进 |
| requirement identity | canonical content fingerprint；未变复用、变化换 identity | 防止变更后的要求继承旧证据 |
| verdict | 动态计算三态 + 精确 reason，不存 bool / score | 当前配置变化不能改写历史 snapshot；未知保守降级 |
| legacy validation | 只读 adapter，不倒推 normalized claims | 旧数据缺 requirement / context 完整血统，伪造比缺失更危险 |
| 上游契约漂移 | F012 / F013 未实现是当前最大风险 | T000 先做 contract audit；不一致先改文档，不用临时字段绕过 |

残余风险：F012 的 outbox 与 independence snapshot 尚未实现，最终字段名和 transaction port 需在其收口后对照一次；F011 的产品行为与失败判据已经冻结，字段名调整不得改变“持久 outbox、未知不独立、完成锁写、requirement 变化不继承证据”四个不变量。

## 10. 待确认设计问题

无。
