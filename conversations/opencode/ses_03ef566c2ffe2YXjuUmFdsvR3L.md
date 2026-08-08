---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_03ef566c2ffe2YXjuUmFdsvR3L"
title: "Explore current types and errors (@explore subagent)"
project: "D:/Projects/personahub"
model: "deepseek-v4-flash"
created_at: "2026-08-02T05:55:25Z"
updated_at: "2026-08-02T05:56:19Z"
tokens_input: 29695
tokens_output: 3547
cost: 0.0
parent_id: "ses_03ef5d0faffej5Zj3DPo6UYZHA"
---

# Explore current types and errors (@explore subagent)

## user · 2026-08-02T05:55:25Z

[CONTEXT] I'm starting Phase 1 of F006 which involves adding new types (GraphRunStatus, NodeRunStatus, GraphBlockReason, GraphNodeKey, DTOs) and extending FailureReason with AdapterNoLongerEligible.

[GOAL] Find the current type definitions and error handling patterns.

[REQUEST] Find:
1. shared/src/types/index.ts - especially around line 203-212 where FailureReason is defined
2. Any DTO patterns in shared/src/types/
3. Error code definitions and error mapping patterns (user-level error mapping)
4. The repository pattern used in the project (e.g., server/src/repositories/ - how repos are structured, especially issue repo and its compareAndSetStatus method)

Return file paths and key code snippets showing the patterns I need to follow.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-08-02T05:55:25Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 190, "limit": 40})`
- **tool**: `glob({"pattern": "shared/src/types/**/*.ts", "path": "D:\\Projects\\personahub"})`
- **tool**: `glob({"pattern": "server/src/repositories/**/*.ts", "path": "D:\\Projects\\personahub"})`
- **tool**: `grep({"pattern": "FailureReason", "path": "D:\\Projects\\personahub\\shared\\src\\types", "output_mode": "files_with_matches"})`
- **tool**: `grep({"pattern": "error.*code|error.*map|ErrorCode", "path": "D:\\Projects\\personahub\\shared\\src", "output_mode": "files_with_matches", "head_limit": 20})`
- **tool**: `grep({"pattern": "compareAndSetStatus", "path": "D:\\Projects\\personahub", "output_mode": "files_with_matches"})`


> [reasoning] The user wants to find several things in the codebase for Phase 1 of F006. Let me launch parallel searches to find all the requested information.

1. shared/src/types/index.ts - FailureReason definition around line 203-212
2. DTO patterns in shared/src/types/
3. Error code definitions and error mapping patterns
4. Repository pattern in server/src/repositories/

Let me start with multiple parallel searches.
<analysis>
**Literal Request**: Find 4 specific areas of code: FailureReason type, DTO patterns, error code/mapping patterns, and repository patterns.

**Actual Need**: Understand the type system and architectural patterns to correctly implement new types (GraphRunStatus, NodeRunStatus, GraphBlockReason, GraphNodeKey, DTOs) and extend FailureReason, following existing conventions.

**Success Looks Like**: Complete code snippets showing exact type definitions, DTO patterns, error mapping, and repo structure so I can implement Phase 1 of F006 without guessing.
</analysis>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
190:   thread_type: ThreadType;
191:   title: string;
192: }
193: 
194: export enum RunStatus {
195:   Queued = "queued",
196:   Running = "running",
197:   Completed = "completed",
198:   Failed = "failed",
199:   Interrupted = "interrupted",
200:   Cancelled = "cancelled",
201: }
202: 
203: export enum FailureReason {
204:   AdapterExitNonzero = "adapter_exit_nonzero",
205:   SpawnFailed = "spawn_failed",
206:   ExecutionTimeout = "execution_timeout",
207:   CredentialIsolationBlocked = "credential_isolation_blocked",
208:   PreExecutionApprovalRejected = "pre_execution_approval_rejected",
209:   PostHocEscalation = "post_hoc_escalation",
210:   ServerRestarted = "server_restarted",
211:   OutputPar
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 4 file(s)

D:\Projects\personahub\shared\src\types\index.ts
D:\Projects\personahub\shared\src\types\validation.ts
D:\Projects\personahub\shared\src\types\adapter.ts
D:\Projects\personahub\shared\src\types\trace.ts
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 14 file(s)

D:\Projects\personahub\server\src\repositories\agent-config.ts
D:\Projects\personahub\server\src\repositories\adapter-workspace-status.ts
D:\Projects\personahub\server\src\repositories\run.ts
D:\Projects\personahub\server\src\repositories\project.ts
D:\Projects\personahub\server\src\repositories\issue.ts
D:\Projects\personahub\server\src\repositories\agent-config-dto.ts
D:\Projects\personahub\server\src\repositories\thread-event.ts
D:\Projects\personahub\server\src\repositories\workspace.ts
D:\Projects\personahub\server\src\repositories\workflow-template.ts
D:\Projects\personahub\server\src\repositories\validation-policy.ts
D:\Projects\personahub\server\src\repositories\evidence-summary.ts
D:\Projects\personahub\server\src\repositories\run-trace.ts
D:\Projects\personahub\
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 1 match(es) in 1 file(s)

D:\Projects\personahub\shared\src\types\index.ts
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 3 match(es) in 3 file(s)

D:\Projects\personahub\shared\src\errors\index.ts

D:\Projects\personahub\shared\src\index.ts

D:\Projects\personahub\shared\src\types\trace.ts
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 17 match(es) in 17 file(s)

D:\Projects\personahub\docs\features\0.2\F006-orchestrated-coding-graph-slice\tasks.md

D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\design.md

D:\Projects\personahub\server\tests\unit\validation-unblock.test.ts

D:\Projects\personahub\server\tests\unit\validation-query.test.ts

D:\Projects\personahub\server\tests\integration\validation-workflow.test.ts

D:\Projects\personahub\server\tests\integration\validation-routes.test.ts

D:\Projects\personahub\server\tests\integration\validation-recovery.test.ts

D:\Projects\personahub\server\tests\integration\validation-multi-round.test.ts

D:\Projects\personahub\server\src\services\validation\workflow-service.ts

D:\Projects\personahub\server\src\services\validation\validator-slot-claimer.ts
…[truncated]
  ```
  </details>

## assistant · 2026-08-02T05:55:32Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\adapter.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\trace.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\errors\\index.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\issue.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\agent-config-dto.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 1, "limit": 50})`


> [reasoning] Good, I have the initial results. Now let me read the additional files in parallel to get the full picture:

1. The FailureReason enum is at lines 203-212 - I have it
2. DTO patterns - need to read adapter.ts and trace.ts, plus the agent-config-dto.ts repo
3. Error codes - need to read shared/src/errors/index.ts
4. Repository pattern - need to read the issue repo and a few others

Let me now read these files in parallel.
Now let me read the DTOs, error codes, and repository patterns in parallel:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\adapter.ts</path>
<type>file</type>
<content>
1: /**
2:  * F005 adapter/routing contract: provider identity, auth type, and per-adapter
3:  * capability. See docs/features/0.1/F005-multi-agent-manual-routing/design.md §3.
4:  */
5: 
6: export enum CliProvider {
7:   Codex = "codex",
8:   ClaudeCode = "claude-code",
9:   OpenCode = "opencode",
10: }
11: 
12: export enum AdapterAuthType {
13:   OAuth = "oauth",
14:   ApiKey = "api_key",
15: }
16: 
17: /**
18:  * Describes which workflow role an adapter can carry. Consult is NOT a
19:  * capability here — every adapter can always handle a consult Run; making it
20:  * configurable would only create a failure mode (user unchecks it, mismatch
21:  * fallback has nothing to fall back to) with no user
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\trace.ts</path>
<type>file</type>
<content>
1: export enum TraceSource {
2:   AdapterStructured = "adapter_structured",
3:   ApprovalHook = "approval_hook",
4: }
5: 
6: export enum EvidenceConfidence {
7:   Confirmed = "confirmed",
8:   Partial = "partial",
9:   Unavailable = "unavailable",
10: }
11: 
12: export enum CommandOutcome {
13:   Succeeded = "succeeded",
14:   Failed = "failed",
15:   Blocked = "blocked",
16:   Cancelled = "cancelled",
17:   Unknown = "unknown",
18: }
19: 
20: export enum VerificationKind {
21:   Test = "test",
22:   Lint = "lint",
23:   Typecheck = "typecheck",
24:   Build = "build",
25: }
26: 
27: export enum VerificationResult {
28:   Passed = "passed",
29:   Failed = "failed",
30:   Unknown = "unknown",
31: }
32: 
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\errors\index.ts</path>
<type>file</type>
<content>
1: import type {
2:   Project,
3:   ProjectWithWorkspace,
4:   Workspace,
5:   Issue,
6:   IssueWithThread,
7:   Thread,
8:   ThreadEvent,
9:   IssuePriority,
10:   Run,
11:   AdapterConfig,
12:   CliProvider,
13:   AdapterAuthType,
14:   AgentCapability,
15: } from "../types/index.js";
16: 
17: export {
18:   type IssueValidationResponse,
19:   type EvidenceSummaryResponse,
20:   type UnblockInput,
21:   type UnblockResponse,
22: } from "../types/validation.js";
23: 
24: export enum ErrorCode {
25:   PROJECT_NAME_REQUIRED = "PROJECT_NAME_REQUIRED",
26:   PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND",
27:   WORKSPACE_PATH_REQUIRED = "WORKSPACE_PATH_REQUIRED",
28:   WORKSPACE_PATH_NOT_FOUND = "WORKSPACE_PAT
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\issue.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Issue, IssueType, IssueStatus, IssuePriority } from "@personahub/shared/types";
3: import { generateIssueId } from "../id.js";
4: 
5: export interface IssueUpdateStatusInput {
6:   status: IssueStatus;
7:   updatedAt: string;
8: }
9: 
10: export interface IssueCreateInput {
11:   project_id: string;
12:   workspace_id: string;
13:   issue_type: IssueType;
14:   workflow_template_id: string;
15:   validation_policy_id: string;
16:   title: string;
17:   goal: string | null;
18:   status: IssueStatus;
19:   priority: IssuePriority;
20:   labels: string[];
21: }
22: 
23: export interface IssueCompareAndSetPatch {
24:   validation_roun
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\agent-config-dto.ts</path>
<type>file</type>
<content>
1: import type { AdapterConfig } from "@personahub/shared/types";
2: import type { AgentConfigRecord } from "./agent-config.js";
3: 
4: /**
5:  * T020: explicit secret-safe DTO builder. Every field is listed by name —
6:  * deliberately NOT `{...record, api_key: undefined}` (design §4.2 forbids that
7:  * pattern): a spread silently re-leaks any new secret-bearing field added to
8:  * AgentConfigRecord later, whereas this explicit form fails to compile until
9:  * someone consciously decides what the new field's public projection should be.
10:  *
11:  * `defaultAdapterConfigId` is the caller's Project.default_adapter_config_id —
12:  * `is_default` is never a column on agent_configs
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
1: import type { RunRole, RunDispatchSource, AdapterIdentitySnapshot, ValidationBlockReason } from "./validation.js";
2: import type { AdapterAuthType, AgentCapability, RunPurpose } from "./adapter.js";
3: 
4: export interface Project {
5:   id: string;
6:   name: string;
7:   description: string | null;
8:   default_workspace_id: string | null;
9:   default_coordinator_agent_id: string | null;
10:   /** F005: Project-level default adapter, resolved when a Run omits adapter_id. */
11:   default_adapter_config_id: string | null;
12:   created_at: string;
13:   updated_at: string;
14: }
15: 
16: export interface Workspace {
17:   id: string;
18:   project_id: string;
19:   local_path: string;
20:   git_
…[truncated]
  ```
  </details>

## assistant · 2026-08-02T05:55:39Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 50, "limit": 160})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\validation.ts"})`
- **tool**: `grep({"output_mode": "files_with_matches", "path": "D:\\Projects\\personahub\\server\\src", "pattern": "mapApiError|toApiError|ApiError.*code|ErrorCode.*map"})`
- **tool**: `grep({"output_mode": "files_with_matches", "path": "D:\\Projects\\personahub\\server\\src", "pattern": "throw.*ErrorCode|throw.*ApiError"})`


> [reasoning] I have a lot of information now. Let me also read the rest of the types/index.ts to see IssueStatus, IssueType, etc., and look at the error mapping pattern. Let me also check the validation.ts file for the types referenced.
Let me get the remaining pieces — the rest of types/index.ts, validation types, and the error mapping pattern

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
50:   updated_at: string;
51: }
52: 
53: export interface Thread {
54:   id: string;
55:   issue_id: string;
56:   room_id: string | null;
57:   thread_type: ThreadType;
58:   title: string;
59:   created_at: string;
60:   updated_at: string;
61: }
62: 
63: export interface ThreadEvent {
64:   id: string;
65:   event_sequence: number;
66:   thread_id: string;
67:   type: ThreadEventType;
68:   actor_type: ActorType;
69:   actor_id: string | null;
70:   payload_json: Record<string, unknown>;
71:   evidence_refs: string[];
72:   created_at: string;
73: }
74: 
75: export interface WorkflowTemplate {
76:   id: string;
77:   name: string;
78:   issue_type: IssueType;
79:   collaboration_topology: string;
8
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\validation.ts</path>
<type>file</type>
<content>
1: import type { ValidationFindingSeverity, VerificationKind } from "./trace.js";
2: import type { IssueStatus, RunSummary, Issue, Run } from "./index.js";
3: 
4: // Extended by F005: adds a persisted, non-null Consult value for ad-hoc
5: // Runs that don't drive the Issue state machine. Never write null/implementation
6: // as a stand-in for consult — see design.md §4.1.
7: export enum RunRole {
8:   Implementation = "implementation",
9:   Validator = "validator",
10:   Consult = "consult",
11: }
12: 
13: // Extended by F005: adds UserDefault for Runs dispatched via the Project's
14: // persisted default adapter (as opposed to an explicit user selection).
15: export enum RunDispatchSource {
16: 
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
No matches found
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 20 match(es) in 20 file(s)

D:\Projects\personahub\server\src\api\errors.ts

D:\Projects\personahub\server\src\api\routes\validation.ts

D:\Projects\personahub\server\src\api\routes\traces.ts

D:\Projects\personahub\server\src\api\routes\runs.ts

D:\Projects\personahub\server\src\services\adapter-config.ts

D:\Projects\personahub\server\src\services\adapter-config-validator.ts

D:\Projects\personahub\server\src\services\workspace.ts

D:\Projects\personahub\server\src\services\adapter-config-updater.ts

D:\Projects\personahub\server\src\services\validation-trace.ts

D:\Projects\personahub\server\src\services\adapter-config-contract.ts

D:\Projects\personahub\server\src\services\run-dispatch.ts

D:\Projects\personahub\server\src\services\project.ts

D:\Projects\personahub\server\src\se
…[truncated]
  ```
  </details>

## assistant · 2026-08-02T05:55:45Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\errors.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 210, "limit": 100})`


> [reasoning] Let me now read the error handling pattern in the API errors module, and also look at the run repository to see the pattern for runs.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\api\errors.ts</path>
<type>file</type>
<content>
1: import type { ZodType } from "zod";
2: import { ErrorCode } from "@personahub/shared/errors";
3: import type { ApiError as ApiErrorInterface } from "@personahub/shared/errors";
4: 
5: export class AppError extends Error implements ApiErrorInterface {
6:   constructor(
7:     public code: ErrorCode,
8:     public message: string,
9:     public field?: string,
10:     public details?: Record<string, unknown>,
11:   ) {
12:     super(message);
13:     this.name = "AppError";
14:   }
15: }
16: 
17: /**
18:  * design docs/decisions/0005 §route handler contract ("只做参数校验（zod）"):
19:  * TypeScript `as` casts on `request.body` have zero runtime effect — a
20:  * wrong-typed field (a number where a string is 
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, RunStatus, FailureReason, RunRole, RunDispatchSource, RunPurpose as RunPurposeType, AdapterIdentitySnapshot } from "@personahub/shared/types";
3: import { RunRole as RR, RunDispatchSource as RDS, RunPurpose } from "@personahub/shared/types";
4: import { generateRunId } from "../id.js";
5: 
6: export interface RunCreateInput {
7:   /** Pre-generated id — lets a caller build content that must reference the Run's own id (e.g. validator context) before the row exists, so the row can be created once with final content instead of insert-then-update. Omitted generates one internally. */
8:   id?: string;
9:   issue_id: string;
10:   th
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
210:   ServerRestarted = "server_restarted",
211:   OutputParseFailed = "output_parse_failed",
212: }
213: 
214: export enum AdapterStatus {
215:   Unknown = "unknown",
216:   Available = "available",
217:   Unavailable = "unavailable",
218: }
219: 
220: export interface Run {
221:   id: string;
222:   issue_id: string;
223:   thread_id: string;
224:   workspace_id: string;
225:   adapter_config_id: string;
226:   status: RunStatus;
227:   failure_reason: FailureReason | null;
228:   instructions: string;
229:   started_at: string | null;
230:   completed_at: string | null;
231:   exit_code: number | null;
232:   error_message: string | null;
233:   role: RunRole;
234:   workflow_step: "implementation
…[truncated]
  ```
  </details>

## assistant · 2026-08-02T05:55:50Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\index.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F006-orchestrated-coding-graph-slice\\tasks.md", "limit": 100})`
- **tool**: `glob({"path": "D:\\Projects\\personahub\\docs\\features\\0.2\\F006-orchestrated-coding-graph-slice", "pattern": "*"})`


> [reasoning] Now I have all the information needed. Let me also check the shared/src/index.ts to see what's exported, and look at the F006 tasks.md to understand what's expected.
Let me also check the shared index exports and the F006 task definition to understand the full context:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\index.ts</path>
<type>file</type>
<content>
1: export { type Project, type Workspace, type Issue, type Thread, type ThreadEvent, type WorkflowTemplate, type ValidationPolicy, type ProjectWithWorkspace, type WorkspaceSummary, type IssueWithThread, type ThreadSummary, type Run, type AdapterConfig, type RunSummary, type IssueWithRun, IssueStatus, IssueType, IssuePriority, ThreadType, ThreadEventType, ActorType, WorkspaceLockState, RunStatus, FailureReason, AdapterStatus, type RunTraceSignal, type RunFileChange, type EvidenceResolution, type TraceCompleteness, type RunTraceSummary, type IssueTraceResponse, type RunEvidenceResponse, type RunTraceState, TraceSource, EvidenceConfidence, CommandOutcome, VerificationKind, VerificationResult, FileChangeType, T
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.2\F006-orchestrated-coding-graph-slice\tasks.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F006]
3: related_features: [F003, F004, F005]
4: topics: [executable-work-graph, orchestrator-subagent, recovery]
5: doc_kind: tasks
6: created: 2026-08-01
7: updated: 2026-08-02
8: ---
9: 
10: # F006：Orchestrated Coding Graph Slice - 任务
11: 
12: > Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`
13: 
14: ## Phase 0：设计收敛（已完成）
15: 
16: - [x] T001：选择并记录首个真实三节点 coding 场景，给出每个节点的输入/输出示例 → `design.md` 第 5 节
17: - [x] T002：对比"扩展 Run/Event"与"独立 Graph 持久化"两种方案，使用 ADR 0006 的恢复五条逐项验证 → `design.md` 第 4 节
18: - [x] T003：定义 Edge payload/evidence refs 与实际 traversal contract → `design.md` 第 6 节
19: - [x] T004：定义 GraphRun/
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 3 file(s)

D:\Projects\personahub\docs\features\0.2\F006-orchestrated-coding-graph-slice\design.md
D:\Projects\personahub\docs\features\0.2\F006-orchestrated-coding-graph-slice\tasks.md
D:\Projects\personahub\docs\features\0.2\F006-orchestrated-coding-graph-slice\spec.md
  ```
  </details>

## assistant · 2026-08-02T05:56:00Z


> [reasoning] Now I have everything I need to present a comprehensive answer. Let me compose the results.
<results>
<files>

### 1. FailureReason 定义（需要追加 AdapterNoLongerEligible）
**`/shared/src/types/index.ts:203-212`**

```typescript
export enum FailureReason {
  AdapterExitNonzero = "adapter_exit_nonzero",
  SpawnFailed = "spawn_failed",
  ExecutionTimeout = "execution_timeout",
  CredentialIsolationBlocked = "credential_isolation_blocked",
  PreExecutionApprovalRejected = "pre_execution_approval_rejected",
  PostHocEscalation = "post_hoc_escalation",
  ServerRestarted = "server_restarted",
  OutputParseFailed = "output_parse_failed",
}
```

你需要追加：`AdapterNoLongerEligible = "adapter_no_longer_eligible"`

---

### 2. DTO 模式
**`/shared/src/types/adapter.ts`** — 纯枚举 + 接口，无 import 依赖，遵循 flat 命名：
```typescript
export enum CliProvider { Codex = "codex", ClaudeCode = "claude-code", OpenCode = "opencode" }
export enum RunPurpose { WorkflowBound = "workflow_bound", AdHocConsult = "ad_hoc_consult" }
export interface AdapterProviderMetadata { ... }
export interface AdapterProvidersResponse { providers: AdapterProviderMetadata[] }
```

**`/shared/src/types/validation.ts`** — 枚举 + 接口 + DTO 响应类型，import 从 `./index.js` 和 `./trace.js` 引用：
```typescript
export enum RunRole { Implementation = "implementation", Validator = "validator", Consult = "consult" }
export enum ValidationBlockReason { ... }
export interface IssueValidationResponse { ... }
export interface UnblockResponse { issue: Issue }
```

**DTO 命名约定**（来自 `agent-config-dto.ts`）：
- DTO 函数名 `toPublicXxx`，显式逐字段构建（禁止 spread）
- 响应类型后缀 `*Response` / `*Input`

---

### 3. 错误码定义与错误映射

**`/shared/src/errors/index.ts`** — `ErrorCode` 枚举（67 个值），每个 `APPEND_SNAKE_CASE` 风格，API 层通过 `AppError` 抛出：
```typescript
export enum ErrorCode {
  // ... 现有 67 个值
  RUN_NOT_ALLOWED_FOR_ISSUE_STATUS = "RUN_NOT_ALLOWED_FOR_ISSUE_STATUS",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}
```

**`/server/src/api/errors.ts`** — 用户级错误映射（HTTP status code）：
```typescript
const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.ISSUE_BLOCKED]: 409,
  [ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS]: 409,
  // ... 所有 67 个一对一映射
  [ErrorCode.INTERNAL_ERROR]: 500,
};
```

**模式**：新错误码需要 (1) 加进 `ErrorCode` 枚举 (2) 加进 `ERROR_STATUS_MAP` (3) 在合适位置 `throw new AppError(ErrorCode.NEW_CODE, "message")`。

---

### 4. Repository 模式

**`/server/src/repositories/issue.ts`** — `compareAndSetStatus` 核心模式：
```typescript
export class IssueRepository {
  constructor(private db: Database.Database) {}

  compareAndSetStatus(
    id: string,
    expected: IssueStatus,
    next: IssueStatus,
    patch?: IssueCompareAndSetPatch,
  ): IssueCompareAndSetResult {
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [next, new Date().toISOString()];
    // 可选字段依次 push
    values.push(id, expected);
    const result = this.db.prepare(
      `UPDATE issues SET ${sets.join(", ")} WHERE id = ? AND status = ?`
    ).run(...values);
    if (result.changes === 0) return { success: false, issue: null };
    const row = this.db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as IssueRow;
    return { success: true, issue: mapRow(row) };
  }
}
```

**`/server/src/repositories/run.ts`** — `transitionStatus` 同模式：
```typescript
transitionStatus(
  id: string, expectedStatus: RunStatus, newStatus: RunStatus,
  updates: { failure_reason?: FailureReason | null; started_at?: string | null; ... }
): RunTransitionResult { ... }
```

**`/server/src/repositories/agent-config-dto.ts`** — 安全 DTO 构建（显式逐字段，禁止 spread）：
```typescript
export function toPublicAdapter(record: AgentConfigRecord, defaultAdapterConfigId: string | null): AdapterConfig {
  return {
    id: record.id,
    project_id: record.project_id,
    // ... 每个字段显式列出
  };
}
```

**通用模式**：每个 repo 有 `interface Row` → `mapRow()` 转换 → `class XxxRepository` 含 `constructor(private db: Database.Database)`，方法返回 mapped 类型。

</files>

<answer>

## 你需要实现的 Phase 1 变更清单

根据代码库现有模式，以下是 T013/T014/T015/T016 要求的具体实现要点：

### 新建类型（`shared/src/types/`）
新建 `graph.ts`（遵循 `adapter.ts` / `validation.ts` 模式），包含：
- `GraphRunStatus` 枚举（含 `cancelling` 非终态）
- `NodeRunStatus` 枚举
- `GraphBlockReason` 枚举（8 个取值，含 `result_too_large`）
- `GraphNodeKey` 类型
- `GraphRun`、`NodeRun` 接口
- 对应 DTO 响应类型（`*Response` 后缀）

### 修改已有类型
- **`shared/src/types/index.ts:203-212`** → `FailureReason` 追加 `AdapterNoLongerEligible = "adapter_no_longer_eligible"`
- `shared/src/types/index.ts` 中 `Run` 接口追加 `node_run_id: string | null`
- `shared/src/index.ts` 导出新类型

### 新建错误码
- `shared/src/errors/index.ts` → `ErrorCode` 追加 `NODE_RUN_ATTEMPT_IN_PROGRESS` 等
- `server/src/api/errors.ts` → `ERROR_STATUS_MAP` 追加对应 HTTP 状态码（409）

### 新建 Repository
- `server/src/repositories/graph-run.ts` — 遵循 `issue.ts` 模式，`compareAndSetStatus` 风格 CAS
- `server/src/repositories/node-run.ts` — 同上，含 `listByGraphRun` 方法
- `server/src/repositories/run.ts` — 补 `node_run_id` 映射（`mapRow` 追加一行）

### 遵循的约定
1. **Repository 结构**：`interface Row` → `mapRow()` → `class XxxRepository { constructor(private db) }` → 方法返回 mapped 类型
2. **CAS 模式**：`compareAndSet` 返回 `{ success, entity }`，失败时 `changes === 0` 判断
3. **DTO 安全**：显式逐字段构造（禁止 spread 泄露 secret）
4. **错误映射**：`AppError` + `ErrorCode` + `ERROR_STATUS_MAP` 三件套

</answer>

<next_steps>
可以按以下顺序实现：
1. `shared/src/types/graph.ts` — 新类型 + DTO
2. `shared/src/types/index.ts` — 追加 `FailureReason.AdapterNoLongerEligible` + `Run.node_run_id`
3. `shared/src/index.ts` — 导出新类型
4. `shared/src/errors/index.ts` — 追加新 `ErrorCode`
5. `server/src/api/errors.ts` — 追加 `ERROR_STATUS_MAP` 条目
6. `server/src/repositories/graph-run.ts` + `node-run.ts` — 新建 repo
7. `server/src/repositories/run.ts` — 补 `node_run_id` 映射
</next_steps>
</results>
