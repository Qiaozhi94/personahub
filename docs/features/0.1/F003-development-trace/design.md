---
feature_ids: [F003]
related_features: [F001, F002, F004, F005]
topics: [development-trace, adapter-trace, evidence-refs, file-snapshot, handoff, validation-events, export]
doc_kind: design
created: 2026-07-15
updated: 2026-07-17
---

# F003：Development Trace - 设计

> Status: done | Owner: Sisyphus | Spec: `spec.md`

## 1. 技术概要

F003 在现有 F002 Run pipeline 上增加一条结构化 trace 支线，不建立第二套消息系统：

```text
Codex app-server structured items
  -> AgentAdapter RunTraceSignal
  -> AgentRunner normalization / correlation / redaction
  -> ThreadEventService (SQLite first)
  -> EventBus / SSE

workspace lock acquired
  -> RunTraceService captures baseline
  -> adapter executes
  -> Run becomes terminal
  -> RunTraceService finalizes file changes + handoff while lock is held
  -> release lock and drain next queued Run
```

核心实现选择：

- `ThreadEvent` 继续作为 command/test/handoff/validation 的事件真相源。
- 新增 `run_trace_states` 保存 baseline 和 finalization 幂等状态；新增 `run_file_changes` 保存可分页的完整文件变更集合。
- `ThreadEvent.evidence_refs` 保持 `string[]`，定义 typed ref grammar，不引入 Artifact/HandoffPacket 独立表。
- Codex adapter 从 app-server 的 command item lifecycle 产生结构化 signal；普通日志不做命令推断。
- `run.output` 仍由 F002 负责，F003 只为 output chunk 增加可选 `source_item_id`，用于 command evidence 关联。
- Run 终态持久化和 workspace 解锁拆开；终态 event 可以先出现，但锁要到 file scan/handoff 收尾完成后才释放。
- Markdown 在后端内存生成，通过 attachment response 返回，不写 workspace。

## 2. 当前实现基线与影响面

### 2.1 已有可复用能力

| 当前能力 | 代码位置 | F003 用法 |
| --- | --- | --- |
| `ThreadEvent.evidence_refs`、`event_sequence` | `shared/src/types/index.ts`、`thread_events` | 直接扩展事件类型和 typed refs，无字段 migration |
| 先写库再广播 | `services/thread-event.ts` | 所有新事件统一复用 |
| SSE replay / 去重顺序 | `api/routes/threads.ts` | 新事件自动进入现有 stream |
| Codex app-server JSON-RPC | `runtime/adapters/codex-cli-adapter.ts` | 增加 item started/completed normalization |
| Run output truncation | `runtime/agent-runner.ts` | command summary 引用 output event，不复制完整日志 |
| workspace lock/FIFO queue | `services/run-dispatch.ts`、`services/workspace-lock.ts` | baseline/finalization 的隔离边界 |
| Run CAS transition | `services/run.ts`、`repositories/run.ts` | 终态不变量继续保留 |
| 三栏 UI + TanStack Query | `web/src` | Thread cards + Inspector summary + export |

### 2.2 必须修正的现有冲突

当前 `RunService.transitionToCompleted/Failed/Cancelled/Interrupted()` 会立即释放 workspace lock，而 `RunDispatchService.onRunTerminal()` 又会释放一次并启动下一条 Run。F003 若沿用该顺序，下一 Run 可能在前一 Run final snapshot 之前修改 workspace，导致证据串线。

F003 将锁释放责任统一移到 `RunDispatchService.finalizeAndDrain()`：

1. RunService 只做 CAS 状态更新和 terminal event。
2. RunTraceService 完成或收敛 file scan/handoff。
3. `finally` 释放该 Run 的锁。
4. 启动下一条 eligible queued Run。

取消、超时、spawn failure、escalation、server restart 都必须经过同一出口。Queued 且从未 started 的取消不走 trace finalization。

另一个现有边界是 escalation：`onEscalation()` 在外层 transaction 内调用 `RunService.transitionToFailed()`，而后者当前会立即广播 `run.failed`，可能早于外层 transaction commit。重构 terminal pipeline 时，任何参与外层事务的状态转换都必须返回 pending events，由最外层事务提交后统一广播；不得在未提交事务中调用 `writeAndBroadcast()`。普通 terminal path 也沿用“事务提交后广播”的同一规则。

### 2.3 文件影响面

- **shared**：拆出 trace domain 类型；扩展 `ThreadEventType`、API response、ErrorCode。
- **server/db**：schema v3、migration registration。
- **server/repositories**：run trace state、file changes、event-by-id/scope 查询。
- **server/runtime**：adapter trace signal、Codex protocol normalizer、Fake adapter fixture、workspace scanner、command redaction/classifier。
- **server/services**：trace preparation/finalization、evidence resolver、query、export；Run terminal orchestration 重构。
- **server/api**：trace/evidence/export routes。
- **web**：trace API/hook、专用 cards、Inspector evidence summary、download action。
- **tests/docs**：schema/API/runtime/UI tests；稳定后回写 system design/architecture。

## 3. 共享类型与领域 Contract

为避免现有 `shared/src/types/index.ts` 超过项目文件上限，新增 `shared/src/types/trace.ts`，再由 `types/index.ts` re-export。

### 3.1 枚举

```ts
export enum TraceSource {
  AdapterStructured = "adapter_structured",
  ApprovalHook = "approval_hook",
}

export enum EvidenceConfidence {
  Confirmed = "confirmed",
  Partial = "partial",
  Unavailable = "unavailable",
}

export enum CommandOutcome {
  Succeeded = "succeeded",
  Failed = "failed",
  Blocked = "blocked",
  Cancelled = "cancelled",
  Unknown = "unknown",
}

export enum VerificationKind {
  Test = "test",
  Lint = "lint",
  Typecheck = "typecheck",
  Build = "build",
}

export enum VerificationResult {
  Passed = "passed",
  Failed = "failed",
  Unknown = "unknown",
}

export enum FileChangeType {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
}

export enum TraceCompletenessStatus {
  Complete = "complete",
  Partial = "partial",
  Unavailable = "unavailable",
}

export enum ValidationFindingSeverity {
  Info = "info",
  Warning = "warning",
  Error = "error",
  Blocking = "blocking",
}

export enum CommandTraceCapability {
  Supported = "supported",
  Unsupported = "unsupported",
  Unknown = "unknown",
}
```

`ThreadEventType` 增加 spec `DR-001` 的 11 个值。枚举值是持久化 contract，后续只能新增，不重命名旧值。

`CommandTraceCapability` 描述“该 Run 的 adapter 是否具备 structured command trace 能力”，是 `run_trace_states.command_trace_capability` 的持久化取值，由当次 `AgentAdapterCapabilities.supportsStructuredTrace` 派生。它与 `TraceCompletenessStatus`（描述“已采集到的 trace 完整度”）是两个不同语义域：capability 是输入前提，completeness 是运行结果，不得互相复用同一枚举。

### 3.2 Adapter trace signal

Adapter 输出的内部 contract 与 ThreadEvent payload 分离，避免 Codex 协议字段泄漏到领域层：

```ts
export type RunTraceSignal =
  | {
      type: "command_started"
      adapterItemId: string
      command: string
      cwd: string | null
      startedAt: string | null
      source: TraceSource
    }
  | {
      type: "command_completed"
      adapterItemId: string
      command?: string
      cwd?: string | null
      outcome: CommandOutcome
      exitCode: number | null
      durationMs: number | null
      outputSummary: string | null
      outputTruncated: boolean
      source: TraceSource
    }

export interface RunHandle {
  runId: string
  onOutput(cb: (event: RunOutputChunk) => void): void
  onTrace(cb: (event: RunTraceSignal) => void): void
  onExit(cb: (result: RunExitResult) => void): void
  cancel(): Promise<void>
}

export interface RunOutputChunk {
  stream: "stdout" | "stderr"
  chunk: string
  sequence: number
  sourceItemId?: string
}
```

`AgentAdapterCapabilities` 增加 `supportsStructuredTrace: boolean`。Fake/Codex 为 `true`；未来 adapter 未实现时为 `false`，Run 正常执行但 completeness 为 unavailable。

### 3.3 File change 与 API 类型

```ts
export interface RunFileChange {
  id: string
  run_id: string
  path: string
  previous_path: string | null
  change_type: FileChangeType
  created_at: string
}

export interface EvidenceResolution {
  ref: string
  kind: "event" | "file_change_set"
  status: "resolved" | "missing" | "truncated"
  target?: {
    id: string
    type: ThreadEventType
    thread_id: string
    run_id?: string
  }
  run_id?: string
  reason?: string
}

export interface TraceCompleteness {
  commands: TraceCompletenessStatus
  verification: TraceCompletenessStatus
  file_changes: TraceCompletenessStatus
  refs: TraceCompletenessStatus
  reasons: string[]
}
```

Issue trace 和 Run evidence response 见第 5 节。

## 4. 数据模型 / Migration

### 4.1 Schema v3

新增 `server/src/db/schema-v3.ts`：

```sql
CREATE TABLE IF NOT EXISTS run_trace_states (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  command_trace_capability TEXT NOT NULL DEFAULT 'unknown',
  baseline_status TEXT NOT NULL DEFAULT 'pending',
  scanner_type TEXT,
  baseline_json TEXT,
  baseline_error_code TEXT,
  baseline_captured_at TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_trace_states_unfinalized
  ON run_trace_states(finalized_at, baseline_status);

CREATE TABLE IF NOT EXISTS run_file_changes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  path TEXT NOT NULL,
  previous_path TEXT,
  change_type TEXT NOT NULL,
  before_fingerprint TEXT,
  after_fingerprint TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, path)
);

CREATE INDEX IF NOT EXISTS idx_run_file_changes_run_id
  ON run_file_changes(run_id, id);
```

约束说明：

- `baseline_status`: `pending | captured | failed`。
- `command_trace_capability`: `supported | unsupported | unknown`，在 adapter 启动前按当次 adapter capability 固化；不能根据未来变更后的 adapter config 反推历史 Run。
- `scanner_type`: `git | filesystem`，baseline 失败时可空。
- `baseline_json` 是内部 snapshot，不通过 API 返回；可能包含 HEAD、status、fingerprints 或 filesystem manifest。
- fingerprint 仅用于净变化比较，不作为用户可见 evidence；实现可保存 SHA-256 或 `size:mtime` 标记。
- `finalized_at` 是幂等门闩。File event、handoff event、file records 和它在同一事务提交。
- file changes 在插入前按规范化 path 排序，使分页和测试确定性稳定；ID 仍用统一 ULID generator。
- F003 不 ALTER `thread_events`：Run events 可从 Run 的 `thread_id` 读取后按 `payload_json.run_id` 过滤；P0 单 Thread 事件规模可接受，避免重复维护 denormalized run_id。

### 4.2 Migration 顺序与兼容

`migrations.ts` 在 v1/v2 后注册 v3。v3 仅新增表，不修改既有记录：

- 旧 Run 没有 `run_trace_states`，在 UI/API 中 completeness 为 unavailable，不回填伪 evidence。
- 新 Run 在取得锁后创建 state。
- migration 重跑使用 `IF NOT EXISTS`，版本只在整个 schema SQL 成功后写入。
- rollback 不自动执行 destructive SQL；测试通过新建 v1/v2 数据库再升级验证。

### 4.3 Repository

新增：

```text
server/src/repositories/run-trace.ts
server/src/repositories/file-change.ts
```

`RunTraceRepository`：

- `createPending(runId, commandTraceCapability, now)`
- `saveBaseline(runId, scannerType, baselineJson, now)`
- `saveBaselineFailure(runId, reasonCode, now)`
- `get(runId)`
- `listTerminalUnfinalized()`（join `runs`）
- `markFinalized(runId, now)`，必须带 `WHERE finalized_at IS NULL`

`FileChangeRepository`：

- `replaceForRun(runId, changes, now)`，仅在 finalization transaction 内使用。
- `listByRun(runId, afterId?, limit?)`
- `countByRun(runId)`
- `existsForRun(runId)`

`ThreadEventRepository` 增加：

- `getById(eventId)`
- `listByThreadAndTypes(threadId, types, afterEventId?, limit?)`

Repository 不解析 evidence ref、不判断 scope、不构造 handoff。

## 5. API / Contract 设计

### 5.1 Issue Development Trace

```http
GET /api/issues/:issue_id/trace?after_event_id=<id>&limit=100
```

`limit` 默认 100、最大 200。只读取 primary Thread；事件包含 F002 Run lifecycle（queued/output 除外）和 F003 trace types，按 `event_sequence ASC`。

```ts
interface RunTraceSummary {
  run: Run
  trace_applicable: boolean
  completeness: TraceCompleteness | null
}

interface IssueTraceResponse {
  issue: IssueWithThread
  runs: RunTraceSummary[]
  events: ThreadEvent[]
  evidence: EvidenceResolution[]
  issue_completeness: TraceCompleteness
  next_after_event_id: string | null
}
```

排除原始 `run.output` 是为了防止 trace query 重复传输最多 1 MiB 日志；command events 仍可通过 refs 指向相关 output event，但 `EvidenceResolution.target` 只返回 id/type/thread/run metadata，不返回目标 `payload_json`，Inspector 原有日志仍使用 Thread events query。

所有 Issue Runs 都返回；曾进入 running 的 Run 为 `trace_applicable=true` 并独立计算 completeness，queued 且从未 running 的 Run 为 `trace_applicable=false, completeness=null`，不能误报为 unavailable。Completeness 不受当前 event page 影响。`issue_completeness` 只聚合 started Runs，按维度取最差状态（`unavailable > partial > complete`），reason 必须带来源 `run_id`；started 的旧 Run 没有 trace state 时该 Run 为 unavailable。Issue 没有任何 started Run 时聚合值为四项 unavailable，并带稳定 reason `no_started_runs`。Inspector 的 Latest Run section 使用对应 Run completeness，不用 Issue 聚合值。Markdown 按 Run 输出 completeness，Issue 顶部可附聚合值。

### 5.2 Run Evidence

```http
GET /api/runs/:run_id/evidence?after_event_id=<id>&after_file_change_id=<id>&event_limit=100&file_limit=100
```

```ts
interface RunEvidenceResponse {
  run: Run
  events: ThreadEvent[]
  file_changes: RunFileChange[]
  evidence: EvidenceResolution[]
  completeness: TraceCompleteness
  next_after_event_id: string | null
  next_after_file_change_id: string | null
}
```

- event query 先按 Run 的 `thread_id` 取 trace event，再严格筛 `payload_json.run_id === run.id`。
- file cursor 必须属于同一 Run；否则返回 `INVALID_QUERY`，不能把其他 Run 的 cursor 当成 offset。
- `event_limit/file_limit` 默认 100、最大 200。
- completeness 基于该 Run 的完整持久化 trace 计算，不随 event/file pagination 改变。

### 5.3 Markdown Export

```http
GET /api/issues/:issue_id/trace/export
```

响应：

```http
Content-Type: text/markdown; charset=utf-8
Content-Disposition: attachment; filename="<sanitized-title>-development-trace.md"
Cache-Control: no-store
```

Markdown 固定结构：

```markdown
# <Issue title> — Development Trace

## Issue
## Trace Completeness
## Run 1 — <status>
### Commands
### Verification
### File Changes
### Handoff
## Validation Trace
## Missing / Truncated Evidence
```

规则：

- 使用 stable English headings，值可保留用户/agent 原文，便于后续机器消费。
- command 使用 fenced code block；动态内容不能闭合 fence，renderer 选择不冲突的 fence 长度。
- Markdown 特殊字符、HTML 和 filename 统一 escape/sanitize。
- 不导出完整 run output、fingerprints、absolute workspace path 或 raw protocol message。
- evidence ref 解析即使目标是 `run.output` 也只输出目标 id/type 和 resolved/missing 状态，不读取或渲染 raw output payload。
- exporter 分页读取所有已记录 file changes，但受全局 export record 上限保护；到上限时写明 truncated。
- 缺少 tests 与 tests passed 是两个不同状态，前者明确写 `Not recorded`。

### 5.4 错误

沿用 AppError response，新增：

| ErrorCode | HTTP | 场景 |
| --- | --- | --- |
| `INVALID_QUERY` | 400 | limit/cursor 非法或 cursor 不属于资源 |
| `EVIDENCE_REF_INVALID` | 400（内部调用通常转 validation error） | ref grammar 非法 |
| `EVIDENCE_SCOPE_MISMATCH` | 409 | validation/handoff 尝试引用其他 Issue/Thread/Run |

Issue/Run 不存在继续使用 `ISSUE_NOT_FOUND` / `RUN_NOT_FOUND`。

### 5.5 路由与 service 边界

新增 `api/routes/traces.ts`，只负责 params/query 校验、headers 和 service 调用。`registerRoutes()` 注入 `DevelopmentTraceService` / `TraceExportService`。Route 不直接读 repository 或拼 Markdown。

## 6. Evidence Ref 设计

### 6.1 Grammar

P0 支持两个前缀：

```text
event:<thread_event_id>
file-change-set:<run_id>
```

保留未来扩展但 F003 不解析：

```text
artifact:<artifact_id>
```

不用裸 ULID，原因是 `evidence_refs: string[]` 未来会引用不同资源；显式前缀避免碰撞和猜类型。

### 6.2 Resolver

`EvidenceService.resolve(refs, scope)`：

```ts
interface EvidenceScope {
  issueId: string
  threadId?: string
  runId?: string
}
```

- `event:`：event -> thread -> issue；若 scope 有 runId，还需 payload `run_id` 相同，除非调用者显式允许 Issue 级 validation ref。
- `file-change-set:`：run -> issue/thread；检查 scope 后返回记录数与是否 scan_truncated。
- ref 目标不存在返回 `missing`，查询/export 不抛错；写入新的 handoff/validation event 时，非法或越界 ref 必须拒绝。
- public query/export 的 event resolution 只返回最小 target metadata；任何 event type 都不内联目标 `payload_json`，尤其不得经 ref 重新暴露被 trace query 排除的 `run.output`。内部 F004/F005 context builder 若需读取允许类型的 payload，必须在 scope 校验后使用独立的 trusted resolver allowlist，且 `run.output` 永不进入 context。
- resolver 去重但保持首次出现顺序。
- F003 产生的 event refs 使用 event id，不使用 `event_sequence`；sequence 只在 Thread 内排序，不是跨资源标识。

### 6.3 Ref 生成

- `command.completed.evidence_refs = [event:<command.started>]`，再附关联的 `run.output` event refs（仅保留前 N 个和 truncation event）。
- `test.completed.evidence_refs = [event:<command.completed>]`。
- `file.change_summary.evidence_refs = [file-change-set:<run_id>]`。
- `handoff.created.evidence_refs` 聚合本 Run 的 command completed、test completed、file summary/scan failure refs，去重并限制数量；payload 同时记录 `evidence_ref_count` 和 `evidence_refs_truncated`。
- validation refs 由 F004 提供，但通过同一 validator。

## 7. Runtime / Workflow 设计

### 7.1 Codex protocol normalization

当前 Codex adapter 已处理：

- `item/agentMessage/delta`
- `item/commandExecution/outputDelta`
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `turn/completed`

F003 增加 protocol normalizer，识别当前 app-server 版本实际发出的 command item started/completed notification。预期形状为 `item/started` / `item/completed` 且 `params.item.type === "commandExecution"`；真实字段必须由任务中的本地 probe 和 fixture 固化，业务代码不得散落 `msg.params?.a ?? b ?? c`。

```text
raw JsonRpcNotification
  -> normalizeCodexTraceNotification(message)
  -> RunTraceSignal | null
```

兼容规则：

- item id 是 correlation key；缺失 id 的 command event 不持久化为 confirmed evidence，并记录 adapter diagnostic。
- `item/commandExecution/outputDelta` 的 `itemId` 写入 `RunOutputChunk.sourceItemId`。
- approval request 只作为直接观察信号：若相同 item 已有 started signal 则去重；若命令被 PersonaHub cancel，可补一对 `approval_hook` started/completed(blocked) signal。
- 不保存整个 raw JSON-RPC message，避免协议噪声和潜在敏感数据进入 DB。
- unknown notification 忽略，不导致 Run failure。

Fake adapter 增加可配置 `traceSignals`，`fake-codex.mjs` 增加 command success/failure/approval fixture，自动化测试不依赖真实 CLI。

### 7.2 AgentRunner command correlation

`ActiveRun` 增加：

```ts
commandEventsByItemId: Map<string, string>       // item id -> command.started event id
outputEventIdsByItemId: Map<string, string[]>   // item id -> bounded run.output event ids
traceCapability: CommandTraceCapability          // 当次 adapter 能力，与 run_trace_states.command_trace_capability 同域；completeness 单独计算
```

处理 started：

1. 校验 active Run 和 adapter item id。
2. redaction command/cwd，cwd 转 workspace-relative（workspace root 显示 `.`）。
3. 同 item id 已存在则忽略重复 signal。
4. 写 `command.started` 并记录 event id。

处理 completed：

1. 查 started id；若 completed 先到，使用 completed 中可用 command 合成 started（confidence partial），再写 completed。
2. outcome/exit code 做一致性规范化：exit 0 -> succeeded；非 0 -> failed；blocked/cancelled 优先；缺失 -> unknown。
3. summary 优先使用 structured output summary，否则从关联 run.output 取有界尾部摘要；统一 redaction，最大 2 KiB。
4. 写 `command.completed`，refs 包含 started 和有界 output refs。
5. 仅对 `adapter_structured + known exit/outcome` 调 classifier；匹配后紧接写 `test.completed`。

Run exit 时未 completed 的 started commands 保持 started-only；handoff/completeness 标为 partial，不合成成功。

### 7.3 Verification classifier

实现为纯函数 `classifyVerificationCommand(command, platform): VerificationKind | null`。

原则：

- 先按 shell-aware tokenizer 拆 wrapper，再匹配 executable/subcommand，不用宽泛 substring。
- 支持直接命令和一层常见 wrapper：PowerShell `&`/`powershell -Command`、cmd `/c`、`npm run`/`pnpm run`/`yarn`/`bun run`、`npx`。
- 初始 allowlist 覆盖 vitest/jest/pytest/cargo test/go test/dotnet test/mvn test/gradle test，以及项目 scripts 名 `test`、`lint`、`typecheck`、`build`。
- `echo npm test`、README 文本、包含 `test` 的文件名不得命中。
- 不确定返回 `null`；分类器不执行命令、不读取 package scripts 来扩大结论。
- `passed` 只由明确 exit code 0 得出；unknown 不升级为 pass。

### 7.4 Command redaction

所有 command、summary、Markdown export 复用 `redactTraceText()`：

- 对 `--token/--api-key/--password/--secret` 的 `value` 和 `=value` 形式替换为 `[REDACTED]`。
- 对常见 credential URL、Bearer token、GitHub/OpenAI 等高置信 token pattern 做替换。
- 不记录 env dump；无法安全结构化的超长 command 在 redaction 后截断并标 `command_truncated=true`。
- command 最大 8 KiB，summary 2 KiB，cwd/path 1 KiB。
- redaction 是安全兜底，不承诺识别所有秘密；UI/export 提示 trace 可能包含 agent 执行内容。

### 7.5 Baseline capture

启动顺序改为：

```text
create queued Run
acquire workspace lock
trace.prepareRun(run, workspace)
transition queued -> running + run.started
start adapter
```

`prepareRun()` 先把当次 adapter 的 structured trace capability 固化到 state，再做 filesystem/git IO 并持久化 snapshot；即使 baseline 失败也允许 Run 启动，state 记 `failed + reason code`，终态生成 `file.change_scan_failed`。这样才能区分“支持 trace 但本轮没有执行命令”和“该 Run 根本不具备 command trace 能力”。

若 prepare 后、transitionToRunning 前进程退出，startup recovery 清除 queued stale lock；queued Run 不 finalization。下次真正启动时允许覆盖 pending/failed baseline。

### 7.6 Workspace snapshot

定义：

```ts
interface WorkspaceScanner {
  type: "git" | "filesystem"
  capture(workspacePath: string, limits: ScanLimits): Promise<WorkspaceSnapshot>
  diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChangeDraft[]
}
```

#### Git scanner

优先条件：workspace 是 git worktree 且 git 命令在短超时内可用。子进程使用 executable + argv，`shell: false`，cwd 为 workspace。

Snapshot 至少保存：

- HEAD oid（unborn 时为 null）。
- `git status --porcelain=v1 -z --untracked-files=all` 解析后的 path/status。
- baseline 时已 dirty/untracked path 的内容 fingerprint，使“原本已 modified、Run 又继续修改”可识别；clean tracked path 的 baseline workspace view 可由 baseline HEAD blob 恢复。
- scanner version 和 `scan_truncated`。

Final diff 使用候选路径 + workspace view 复核：

- baseline/final status 差异。
- 同为 dirty 但 fingerprint 改变的 path。
- HEAD 变化时 baseline HEAD 到 final HEAD 的 name-status 只提供候选路径，不能直接成为 file-change record。
- 每个候选路径最终比较 baseline workspace view 与 final workspace view：baseline dirty/untracked 使用已存 fingerprint，baseline clean tracked 使用 baseline HEAD blob；final 使用 working tree 内容或 final HEAD blob。两端内容相同则不记录，因此“把 Run 前已有 dirty 内容原样 commit”不会误报。
- rename 在可靠识别时保留 `previous_path`；否则降级为 delete + add，不伪造 rename。

P0 不保存 patch，也不执行 `git reset/checkout` 等写操作。

#### Filesystem scanner

非 git 或 git 不可用时递归扫描 regular files：

- 默认忽略 `.git/`、`node_modules/`、依赖/缓存目录和 PersonaHub DB/WAL/SHM；不笼统忽略 `dist/`、`build/` 等可能属于用户交付物的目录，ignore list 在常量中集中维护并测试。
- path 经 `resolve`/`relative` 后必须仍在 workspace 内；symlink 不跟随到 workspace 外。
- 目录与文件使用规范化 workspace-relative path 的 lexical order 确定性遍历，snapshot 记录 `scan_complete`/`scan_truncated` 和停止原因。
- 小文件使用 SHA-256；超过单文件 hash 上限使用 `size + mtime` 并降低 confidence。
- 两侧 snapshot 都 complete 时比较完整 manifest 得出 added/modified/deleted；任一 snapshot 因 entry/time/IO 边界不完整时，只允许为两侧都实际观察到且 fingerprint 不同的同一路径生成 modified，不生成 added/deleted。未覆盖差异只进入 truncated/unknown completeness。

#### Limits

初始默认值（集中在 `runtime/trace/constants.ts`，不是用户配置）：

| Limit | 默认 |
| --- | --- |
| scan wall time | 10 s |
| scanned entries | 20,000 |
| hashed bytes per file | 8 MiB |
| persisted changes | 5,000 |
| event preview | 100 |
| export changes | 5,000 |

达到 scan/entry 上限时按上述 coverage 规则只保留已确认记录并标 `scan_truncated=true`，completeness 为 partial。若两侧 snapshot 完整、只是变化记录超过 persist 上限，则按规范化 path 排序保留前 5,000 条已确认变化并标 `scan_truncated=true`；不得因持久化截断改变记录真假。超时、权限、baseline parse 错误使用稳定 reason code，而不是自由文本作为判断依据。

### 7.7 Terminal finalization

统一入口：

```ts
async finalizeAndDrain(runId: string, workspaceId: string): Promise<void> {
  try {
    await developmentTraceService.finalizeRun(runId)
  } finally {
    workspaceLockService.releaseByRunId(runId)
    await startNextQueuedRun(workspaceId)
  }
}
```

`finalizeRun()`：

1. 读取 Run；只有 terminal 且 `started_at != null` 才继续。
2. 若 `finalized_at != null`，幂等返回。
3. baseline captured 时在锁内采 final snapshot/diff；baseline failed/missing 时生成 failure draft。
4. 收集本 Run command/test events并构造 handoff/completeness。
5. 单个 DB transaction：再次检查未 finalized；replace file records；写 file event；写 handoff；CAS mark finalized。
6. commit 后广播两个事件。

文件 IO 不放进 SQLite transaction，避免长事务；幂等检查在 IO 前后各做一次。若两个 finalizer 竞争，事务内 CAS 只有一个提交 events。

异常收敛：

- scanner 异常转为 `file.change_scan_failed`，仍生成 handoff。
- handoff builder 不应抛；未知字段转 missing evidence。
- finalization transaction DB 写失败时在仍持有 workspace 锁的当前调用内做有界重试（默认最多 3 次，间隔常量集中管理）；仍失败则记录 server error，`finally` 释放锁并继续 drain，state 保持 unfinalized。
- startup recovery 处理 terminal-unfinalized state 时先验证 workspace 仍由该 `run_id` 持锁：仍持有才允许重新采 final snapshot；锁已丢失/属于其他 Run 时，不读取 workspace、不重新扫描、不写 file records，只基于已持久化的 Run/trace state 以 `file.change_scan_failed(reason_code=workspace_ownership_lost)` + handoff missing evidence + finalized CAS 收敛。该 DB-only failure finalization 是“扫描必须持锁”的唯一例外；仍可标 `recovered_after_restart=true`，但不使用模糊的 `workspace_may_have_advanced` 作为可信 file evidence。

### 7.8 Cancel / escalation / recovery

- running cancel：Run -> cancelled event -> finalization -> unlock/drain。
- queued cancel：无 baseline/finalization；若异常持有锁只释放，不生成 handoff。
- escalation：保持 F002 的 `escalation.triggered -> run.failed -> issue.blocked` 顺序；随后 finalization，再 cancel blocked Issue queued Runs、unlock/drain。
- escalation 的三个事件在同一事务写入，并在最外层 commit 后按上述顺序广播；不得由嵌套 RunService 调用提前广播 `run.failed`。
- timeout/spawn/adapter nonzero：terminal event 后走同一 finalization。
- startup recovery：先处理 running Run 为 interrupted（不解锁），再 finalize；再处理“已 terminal 但未 finalized”的 state，并按锁 ownership 决定正常扫描或 `workspace_ownership_lost` fail-closed；最后清 stale lock/queue。`main()` 改为 await async recovery 后再 listen。
- server shutdown 主动 cancel 时仍由正常 callback finalization；如果进程来不及完成，startup recovery 补做。

## 8. Event / Trace 设计

### 8.1 Command events

`command.started`：

```json
{
  "issue_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "workspace_id": "...",
  "adapter_item_id": "item-1",
  "command": "npm test",
  "command_truncated": false,
  "cwd": ".",
  "source": "adapter_structured",
  "confidence": "confirmed"
}
```

`command.completed`：

```json
{
  "issue_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "workspace_id": "...",
  "adapter_item_id": "item-1",
  "command_event_id": "...",
  "outcome": "succeeded",
  "exit_code": 0,
  "duration_ms": 842,
  "summary": "12 tests passed",
  "summary_truncated": false,
  "output_truncated": false,
  "source": "adapter_structured",
  "confidence": "confirmed"
}
```

`evidence_refs` 至少含 `event:<command.started id>`。

### 8.2 Verification event

`test.completed`：

```json
{
  "issue_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "workspace_id": "...",
  "command_event_id": "...",
  "test_kind": "test",
  "result": "passed",
  "exit_code": 0,
  "summary": "12 tests passed",
  "confidence": "confirmed"
}
```

命名沿用 spec/PRD 的 `test.completed`，但 `test_kind` 覆盖 lint/typecheck/build。后续若需要更广义名称，只新增事件类型，不重解释已存事件。

### 8.3 File events

`file.change_summary`：

```json
{
  "issue_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "workspace_id": "...",
  "scanner": "git",
  "added_count": 2,
  "modified_count": 3,
  "deleted_count": 1,
  "renamed_count": 0,
  "total_count": 6,
  "preview": [
    { "path": "server/src/a.ts", "change_type": "modified" }
  ],
  "preview_truncated": false,
  "scan_truncated": false,
  "recovered_after_restart": false
}
```

`evidence_refs = ["file-change-set:<run_id>"]`。

`file.change_scan_failed`：

```json
{
  "issue_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "workspace_id": "...",
  "phase": "baseline",
  "reason_code": "permission_denied",
  "message": "Workspace baseline could not be read.",
  "recovered_after_restart": false
}
```

稳定 reason code：`git_unavailable`、`not_a_git_workspace`（通常触发 fallback，不直接失败）、`permission_denied`、`timeout`、`entry_limit`、`snapshot_corrupt`、`path_outside_workspace`、`workspace_ownership_lost`、`unknown`。

### 8.4 Handoff event

`handoff.created.payload_json`：

```json
{
  "issue_id": "...",
  "thread_id": "...",
  "run_id": "...",
  "workspace_id": "...",
  "issue_goal": "...",
  "run_status": "completed",
  "summary": "Run completed; 3 files changed; tests passed.",
  "completed_work": ["2 commands completed", "1 verification passed"],
  "command_summary": { "total": 2, "succeeded": 2, "failed": 0, "blocked": 0, "unknown": 0 },
  "verification_summary": { "passed": 1, "failed": 0, "unknown": 0 },
  "file_summary": { "total": 3, "scan_status": "complete", "ref": "file-change-set:..." },
  "known_risks": [],
  "missing_evidence": [],
  "next_expected_action": "Validate the implementation against the issue goal.",
  "evidence_ref_count": 4,
  "evidence_refs_truncated": false
}
```

成功 Run 的 next action 默认是 validation；failed/cancelled/interrupted 根据 failure reason 生成“inspect failure / resume work / resolve escalation”等确定性建议。F003 不调用 LLM 生成 handoff，以保持 terminal path 可测和可恢复。

### 8.5 Validation contract

F003 提供 `ValidationTraceService.writeRequested/writeFinding/writeResult()` 给 F004 内部调用。每次写入先验证 thread/issue/run/ref scope。

| Event | 必需 payload（除公共 IDs） |
| --- | --- |
| `validation.requested` | `validation_round`, `target`, `policy_id`, `requested_by_run_id?` |
| `validation.finding` | `validation_round`, `severity`, `message`, `suggestion?`, `file_path?`, `line?` |
| `validation.passed` | `validation_round`, `summary`, `validator_run_id?` |
| `validation.failed` | `validation_round`, `summary`, `validator_run_id?`, `finding_count` |
| `validation.blocked` | `validation_round`, `reason_code`, `summary`, `validator_run_id?` |

Validation result event 在 F003 只是 trace；F004 负责同事务 Issue 状态流转和 Done gate。

## 9. UI 设计

### 9.1 数据流

```text
Trace components
  -> use- trace hooks
  -> apiClient.traces
  -> /api/issues/:id/trace | /api/runs/:id/evidence | export
```

新增：

```text
web/src/hooks/use-trace.ts
web/src/components/trace/CommandTraceCard.tsx
web/src/components/trace/VerificationTraceCard.tsx
web/src/components/trace/FileChangeTraceCard.tsx
web/src/components/trace/HandoffTraceCard.tsx
web/src/components/trace/ValidationTraceCard.tsx
web/src/components/trace/TraceCompleteness.tsx
```

现有 `web/src/components/thread/ThreadEvent.tsx` 保留通用 shell、F002 run/escalation renderer，把 F003 类型委托给专用 cards，避免继续膨胀。新增 trace cards 与既有约定同级嵌套于 `web/src/components/trace/`。

### 9.2 Thread

- command.started 默认显示运行中；对应 completed 到达后仍各自作为事件保留，不在数据层合并。UI 可以把相邻 pair 视觉关联。
- command 文本使用 monospace、最多 3 行，点击展开；redacted/truncated 有 badge。
- verification 用 success/destructive/warning 色分别表达 passed/failed/unknown。
- file card 展示 totals + 最多 preview；“View all”加载 Run evidence 下一页，不把全列表塞进 Thread。
- handoff 突出 next action、risks、missing evidence。
- validation finding severity 不只靠颜色，必须有文字 badge。
- unknown F003 event 回退到现有 generic field renderer，保证前后端小版本兼容。

### 9.3 Inspector

在 Latest Run 下新增 `Evidence` section：

- Trace completeness 四项状态。
- Verification totals 和最近失败摘要。
- Changed files totals + 前若干路径 + View all。
- Latest handoff summary / next action。
- Latest validation result（若有），文案说明“Recorded result”；F003 不显示 Done gate。
- `Export Markdown` button。

原有 Run Logs 和 Cancel 保留。Evidence query 只在选中 Issue/Run 时开启；active Run 可通过 SSE invalidation 刷新，不额外高频 polling file evidence。

### 9.4 Download

`apiClient.traces.export(issueId)` 返回 `Blob` 和从 `Content-Disposition` 解析的 filename；mutation 成功后组件创建临时 object URL、触发 `<a download>` 并立即 revoke。失败使用现有 `toApiError()`。

## 10. 失败处理与恢复

| 场景 | 行为 |
| --- | --- |
| malformed Codex command notification | 忽略该 signal、trace completeness partial；Run 不失败 |
| command completed 无 started | 合成 partial started（有 command 时）；否则只记 unavailable diagnostic，不伪造成功 |
| baseline capture 失败 | state=failed；Run 继续；终态写 scan_failed + handoff missing evidence |
| final scan 超时/权限失败 | scan_failed；Run status 不变；继续 handoff/unlock |
| file changes 达上限 | 已记录部分可分页，event `scan_truncated=true`，completeness partial |
| evidence target missing | query/export 返回 missing；新 handoff/validation 写入越界 ref 则拒绝 |
| DB finalization 失败 | 持锁有界重试；仍失败则解锁/drain。恢复时仅在锁仍属于旧 Run 时重扫，否则以 `workspace_ownership_lost` scan failure + missing evidence 收敛，不写旧 Run file records |
| SSE 广播失败 | DB 已有 event，客户端 replay 补读 |
| service restart | interrupted terminalization -> finalization -> unlock；再扫 terminal/unfinalized state |
| export 中动态 Markdown | escape/fence/filename sanitize；不执行、不渲染为 raw HTML |
| redaction 规则异常 | fail closed：使用 `[REDACTION_FAILED]` 摘要，不写原始 secret-bearing text |

## 11. 测试策略

### 11.1 Unit

- `codex-trace-normalizer.test.ts`：started/completed/output/approval、字段变体、unknown、dedupe。
- `verification-classifier.test.ts`：正例、wrapper、Windows、substring false positive、unknown exit。
- `trace-redaction.test.ts`：flag/env/url/bearer/token、长度、Unicode。
- `workspace-snapshot.test.ts`：git status parse、dirty baseline 原样/修改后 commit、HEAD change、rename fallback、non-git hash、deterministic traversal、截断 snapshot 不产生虚假 add/delete、symlink/path scope、limits。
- `evidence-ref.test.ts`：grammar、missing、scope mismatch、stable order。
- `handoff.test.ts`：四种 terminal status、missing/truncated evidence、deterministic output。
- `trace-export.test.ts`：escaping、fence、filename、missing/truncated sections。

### 11.2 Integration

- migration v2 -> v3 preserves F001/F002 data。
- fake adapter emits command/test events and output refs in exact order。
- baseline occurs before adapter mutates workspace。
- completed/failed/cancelled/interrupted/escalation each produce one file event + one handoff。
- queued cancel produces neither。
- two Runs same workspace: second adapter start timestamp/event sequence is after first `handoff.created` and unlock。
- duplicate exit/finalize callback produces no duplicate rows/events。
- restart with running or terminal-unfinalized Run recovers and releases lock；DB finalization 失败后下一 Run 推进再重启时，旧 Run 只产生 ownership-lost failure，不产生 file records。
- Issue trace/Run evidence cursor、scope errors、file pagination、逐 Run/Issue completeness、public resolver/export 不内联 raw output。
- SSE replay includes F003 events by event sequence。

### 11.3 UI

- each card render and accessibility labels。
- Inspector complete/partial/unavailable and pagination。
- export success/error, object URL cleanup。
- SSE invalidates trace queries。
- existing F002 logs/cancel/escalation regression，包括连续 `run.output` 合并、`run.output_truncated` 标记、无 adapter/Blocked/active Run composer 护栏、提交成功清空、mutation error，以及 credential isolation/pre-execution/post-hoc 三类能力边界文案。

### 11.4 Manual probe

真实 Codex CLI probe 必须记录 app-server 版本和 observed notification fixture，但 fixture 要 redaction 后入库。验证：

- 普通 shell command started/completed fields。
- command output item id。
- exit code / duration availability。
- failed command。
- approval rejected command。
- PowerShell command representation。

如果真实字段与预期不同，只修改 Codex normalizer 和 fixture，不改变 RunTraceSignal/ThreadEvent contract。

## 12. 设计决策

| 决策 | 理由 | 替代方案 |
| --- | --- | --- |
| P0 不从 run.output 猜命令 | 日志当前混合 agent message/command output，推断无法作为 F004 confirmed evidence | regex 推断并标 inferred；仍易误导且增加复杂度 |
| Adapter 输出 RunTraceSignal | 隔离 Codex JSON-RPC 版本与领域事件，未来 adapter 可复用 | AgentRunner 直接解析 Codex raw JSON；强耦合 |
| ThreadEvent + 两张 derived 表 | 事件仍是真相源，baseline/idempotence 与大 file list 又能高效恢复 | 全塞 payload；大事件、无法分页；或完整 Artifact 系统，超出 F003 |
| typed string refs | 兼容现有 `string[]` 且可扩展资源类型 | 裸 event id；未来资源碰撞 |
| terminal event 后、解锁前 finalization | 保留 Run 状态及时性，同时保证文件归因不被下一 Run 污染 | 解锁后扫描；证据会串线；扫描前不写 terminal；状态延迟且异常复杂 |
| File IO 在 transaction 外，最终写入在 transaction 内 | 避免长 SQLite 写锁，同时用二次 CAS 保证幂等 | 扫描全程持 DB transaction；阻塞其他请求 |
| Handoff 确定性生成，不调用 LLM | terminal path 快、可测、可恢复；F003 只需要最小 packet | 再启动 summarizer agent；引入递归 Run/失败/成本 |
| event preview + file record pagination | Thread 可读且完整已记录数据可恢复 | event 保存全部；大 repo 拖慢 SSE/UI |
| public resolver 只返回 target metadata | refs 可追溯且不会绕过 trace/export 的 raw output 边界 | 内联目标 event；重新暴露大日志和潜在秘密 |
| snapshot 截断时只保留可证明变化 | partial evidence 仍必须逐条可信 | 直接 diff 两个部分 manifest；会制造虚假 add/delete |
| ownership 丢失的恢复 fail closed | 解锁继续队列后无法可靠重建旧 Run terminal view | 从当前 workspace 重扫；会把下一 Run 归到旧 Run |
| 旧 Run 不回填 evidence | 无 baseline 无法可靠重建“那一轮”净变化 | 用当前 workspace 猜历史；制造伪证据 |
| 无公开 validation write API | 防止客户端伪造 pass/fail；F004 走内部 service | 通用 POST event；安全/状态语义不清 |
| 锁释放统一归 RunDispatch finalizer | 消除 RunService/Dispatch 双重释放并建立唯一 terminal 收尾出口 | 各 terminal method 自己释放；顺序分散易回归 |

## 13. 待确认设计问题

目前没有未关闭的设计问题。需要真实环境确认但不改变设计边界的事项已转为实现任务：

- Codex 当前 app-server command notification 的精确字段：通过 protocol probe + normalizer fixture 验证；领域 contract 已确定。
- Windows git/non-git scanner 和 PowerShell wrapper 的实际表现：通过自动化 fixture + 手动验证；失败时仍按已确定的 bounded fallback/partial evidence 处理。
- 默认扫描 limits 的体验：先采用第 7.6 节默认值并记录耗时；若测试不达标，只调常量/策略，不改变 event/API contract。

## 14. 实现后回写

F003 稳定后：

- `docs/personahub-system-design.md` 增加 `RunTraceState` / `RunFileChange`，说明 Handoff P0 仍内联 event。
- `docs/personahub-architecture.md` 更新实际 Adapter interface（`onTrace`、structured capability）和 terminal finalization/lock 顺序；修正其中“ThreadEvent id 全局单调”与当前 `event_sequence` 实现的表述差异，并确认 typed evidence refs（`event:` / `file-change-set:` / future `artifact:`）是唯一演进 contract。
- `CLAUDE.md` 的“现状”更新 F001/F002/F003 状态，但只在本 feature 实现完成时执行。
- `BACKLOG.md` 按 review/done 状态更新；设计阶段不提前标 done。
