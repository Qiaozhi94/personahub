---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_019eea13bffezbslxUY6Bo88yf"
title: "F008 runtime health backend (@Sisyphus-Junior subagent)"
project: "D:/Projects/personahub"
model: "glm-5.2"
created_at: "2026-08-09T10:28:45Z"
updated_at: "2026-08-09T10:52:00Z"
tokens_input: 154533
tokens_output: 52482
cost: 0.0
parent_id: "ses_019fcd1b2ffeVhLjSmKAXA2M0m"
---

# F008 runtime health backend (@Sisyphus-Junior subagent)

## user · 2026-08-09T10:28:45Z

You are implementing the BACKEND for F008 "Runtime Health" (Phase 4) in the PersonaHub monorepo at D:\Projects\personahub. This is part of a larger parallel effort — you must NOT touch files owned by the parallel template-admin agent (workflow-template.ts repository, workflow-template-admin.ts, validate-steps-schema.ts, admin-audit-event.ts, workflow-templates.ts routes) or the shared wiring files `server/src/index.ts` and `server/src/api/index.ts` (orchestrator wires them). You MAY edit run-dispatch.ts, adapter-config.ts, adapter-failure-reprobe.ts, and create new runtime-health files.

## READ FIRST (mandatory, in order)
1. `docs/features/0.2/F008-workflow-template-admin-runtime-health/spec.md`
2. `docs/features/0.2/F008-workflow-template-admin-runtime-health/design.md` (especially §5, §5b)
3. `docs/features/0.2/F008-workflow-template-admin-runtime-health/tasks.md` (Phase 4: T040-T043)
Read fully. The design doc's "初稿漏洞已修正" notes are the crux of correctness — follow EXACTLY.

## FOUNDATION ALREADY DONE — do NOT redo, DO use
- `shared/src/errors/index.ts`: ErrorCodes already added including WORKSPACE_NOT_FOUND (existing) — no new error codes needed for health.
- `shared/src/types/f008.ts`: already has `HealthDiagnosticCode` (the 10 public codes), `HealthDiagnostic`, `RuntimeHealthSnapshot`, `RuntimeHealthResponse` matching design §5b exactly. Reuse these EXACT shapes. `eligible_but_not_running` is NOT in the public union — it's an internal classifier variant only.
- `server/src/db/schema-v10.ts`/`migrations.ts` done (v10).

## KEY EXISTING CODE CONTEXT
- `server/src/runtime/types.ts` line ~124: `export const DEFAULT_EXECUTION_TIMEOUT_MS = 30*60*1000`. 
- `server/src/services/run-dispatch.ts`: `RunDispatchService.startNextQueuedRun(workspaceId)` (lines ~310-397) is a PRIVATE method with the queued-run classification logic (Blocked/Done/role-status gates/round matching) interleaved with side effects. THIS is the code you must EXTRACT.
- `server/src/services/adapter-config.ts`: `AdapterConfigService` has private `pendingAvailabilityProbes = new Set<Promise<void>>()`. Add a read-only snapshot accessor.
- `server/src/services/adapter-failure-reprobe.ts`: `AdapterFailureReprobe` (RunDispatchService's private field `failureReprobe`) has private `pending = new Set<Promise<void>>()`. Add a read-only snapshot accessor. Do NOT expose the Set reference.
- `server/src/services/stale-recovery.ts`: `cleanupStaleLocks()` (lines 95-114) is the ground truth for stale-lock semantics: lock released if holder missing or terminal, IGNORING duration. `isTerminalStatus` = Completed/Failed/Interrupted/Cancelled.
- `server/src/repositories/run.ts`: `listQueuedByWorkspace(workspaceId)`, `listRunning()`, `getById`. `server/src/repositories/workspace.ts`: `listLockedWorkspaces()`, `listAll()`. `server/src/repositories/issue.ts`: `getById`. 
- `server/src/services/adapter-availability.ts`: `effectiveAdapterStatus(record, override): AdapterStatus`. `server/src/repositories/adapter-workspace-status.ts`: `listForWorkspace(workspaceId)` returns override rows. `server/src/repositories/agent-config.ts`: `listByProject(projectId)`. `server/src/repositories/agent-config-dto.ts`: `toPublicAdapter`.
- `server/src/services/validation/validator-slot-claimer.ts` (~207-225): validator Run created as Queued and validation_dispatch_due_at cleared in same txn when claimed. `server/src/services/validation-dispatch-scheduler.ts`: defaults to 1s tick; claims due Issues.
- `server/src/api/routes/*.ts` + `server/src/api/errors.ts` (`parseRequestBody`, `AppError`, `ErrorCode`): follow the route style (see adapters.ts).
- Repository/service DI pattern: `constructor(private db: Database.Database)` / services injected; `AppError` from `../api/errors.js`, `ErrorCode` from `@personahub/shared/errors`.
- `server/src/db/migrations.ts` uses `SELECT MAX(version) FROM schema_version` — the schema actual version query.
- Issue status enum `IssueStatus` = Inbox/Ready/Running/Validating/Done/Blocked; `RunStatus` = queued/running/completed/failed/interrupted/cancelled; `RunRole` = implementation/validator/consult/graph_node. `AdapterStatus` = unknown/available/unavailable.

## WHAT TO BUILD

### 1. Extract the queued-run classifier (T041b) — in a NEW pure module, e.g. `server/src/services/queue-classifier.ts`
Extract the classification logic (Blocked/Done/role-status gate/round matching) currently inside `startNextQueuedRun()` into a NEW pure function with NO side effects, e.g.:
```ts
export type QueuedRunClassification = "eligible_but_not_running" | "waiting_for_recovery" | "invalid_queued_run";
export function classifyQueuedRun(run: Run, issue: Issue | null): QueuedRunClassification
```
Semantics (must mirror startNextQueuedRun EXACTLY — this is the shared source of truth, drain and health both use it):
- issue null → invalid_queued_run (startNextQueuedRun does `if (!issue) continue` = skip/silently drop; classify as invalid for health since there's no legitimate reason)
- issue.status Blocked: run.role GraphNode → waiting_for_recovery (F006 deliberately keeps blocked graph nodes queued); other roles → invalid_queued_run (they'd be cancelled)
- issue.status Done → invalid_queued_run (cancelled)
- role Implementation and status not in (Inbox, Ready, Running) → invalid_queued_run
- role Validator: status must be Validating else invalid_queued_run; and validation_round must equal issue.validation_round_count + 1 else invalid_queued_run
- role Consult: eligible on Inbox/Ready/Running/Validating (Done/Blocked already handled above)
- otherwise → eligible_but_not_running
ONLY classify Runs already in Queued status. Then REFACTOR `startNextQueuedRun()` to use this shared function for its per-run gate (replacing the inline if-chain) while keeping all the side-effect behavior (cancelQueued, acquire, CAS, startAdapter) identical. Drain behavior MUST NOT change — regression-test queue-drain-eligibility.

### 2. Read-only snapshot accessors (T040b)
- `AdapterConfigService.healthSnapshot(): { pendingProbeCount: number }` — return `{ pendingProbeCount: this.pendingAvailabilityProbes.size }`. Do NOT expose the Set.
- `AdapterFailureReprobe.healthSnapshot(): { pendingReprobeCount: number }` — return `{ pendingReprobeCount: this.pending.size }`. Do NOT expose the Set.
- `RunDispatchService.healthSnapshot(): { pendingReprobeCount: number }` — forwards to `this.failureReprobe.healthSnapshot()`.

### 3. New service `server/src/services/runtime-health.ts` — `RuntimeHealthService`
Constructor deps: db, workspaceRepo, agentConfigRepo, adapterWorkspaceStatusRepo, runRepo, issueRepo, adapterConfigService (for healthSnapshot), runDispatchService (for healthSnapshot), plus a constant for the expected schema version. Method:
`collect(projectId: string, workspaceId?: string): RuntimeHealthSnapshot`
Read-only ONLY (FR-006): no probe trigger, no lock acquisition, no writes. Response shape EXACTLY per shared RuntimeHealthSnapshot / design §5b. Implement:
- schema: actual_version = `SELECT MAX(version) FROM schema_version`; expected_version = constant (10); status = current/behind/ahead. If behind or ahead → emit diagnostic `schema_version_mismatch` (T040d).
- background: pendingProbeCount + pendingReprobeCount from the two healthSnapshot accessors.
- workspaces: for each workspace (all project workspaces, or just the requested one), gather:
  - adapters: listByProject(projectId) + overrides via adapterWorkspaceStatusRepo.listForWorkspace → `effective_status` via effectiveAdapterStatus, name, last_checked_at (effective). Each adapter is workspace-scoped (T040e — same adapter may differ across workspaces; never merge).
  - lock: from workspaceRepo.listLockedWorkspaces() → locked_by_run_id, locked_at, held_ms (now - locked_at, null if not locked/illegal).
  - queue: queued_count = runRepo.listQueuedByWorkspace(workspaceId).length; running_run_id from runRepo.listRunning() where workspace matches.
- diagnostics: build per design §5b + AC-007 (T041, T041b, T041c, T041e, T041f, T041d):
  - stale_lock grading (T041): for each locked workspace, get holder run by locked_by_run_id:
    - holder missing → stale_lock_confirmed (ignore duration)
    - holder terminal → stale_lock_confirmed (ignore duration)
    - holder running AND held duration STRICTLY > (DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS) → stale_lock_suspected
    - holder running but locked_at missing/illegal/future (duration uncomputable) → lock_timestamp_invalid (NO release-type suggestion — holder still running)
    Add constants LOCK_DIAGNOSTIC_GRACE_MS = 60_000 in this file (or runtime/types). Detail includes holder run id, locked_at, held_ms.
  - queue_starved (T041b/T041c): for each workspace, classify queued runs via classifyQueuedRun. `waiting_for_recovery` and `invalid_queued_run` outputs are public diagnostics (workspace-scoped) regardless of lock. If at least one queued run classifies `eligible_but_not_running` AND the workspace lock is FREE → emit single `queue_starved` (do NOT emit the internal classification); if lock is occupied → emit nothing for eligible_but_not_running (normal queueing).
  - waiting_for_validation_due / validation_dispatch_overdue (T041e/T041f): query issues WHERE status='Validating' AND validation_dispatch_due_at IS NOT NULL. For each, compare validation_dispatch_due_at to Date.now() with VALIDATION_DISPATCH_GRACE_MS = 5_000:
    - due_at > now - GRACE → waiting_for_validation_due (normal; detail remaining ms, positive if not yet due)
    - due_at <= now - GRACE → validation_dispatch_overdue (detail overdue_ms = now - due_at)
    Group by issue.workspace_id. Independent of queued-run classification.
  - no_available_adapter (T041d): a workspace with zero adapters whose effective_status is Available → no_available_adapter.
  - Each diagnostic has a suggested_action (one sentence, per design §5 tables).
- Ensure `eligible_but_not_running` NEVER appears as a public diagnostic code.

### 4. API route — NEW file `server/src/api/routes/runtime-health.ts`
`GET /api/projects/:projectId/health/runtime?workspace_id=<optional>` → { health: RuntimeHealthSnapshot }. zod query `{workspace_id?: string}`. projectId ownership check via projectRepo (404 PROJECT_NOT_FOUND). If workspace_id provided but invalid/cross-project → WORKSPACE_NOT_FOUND (reuse F005 semantics, matching adapterConfigService.list behavior). Omit workspace_id → aggregate all project workspaces.

### 5. Tests (Vitest, server/tests/) — `server/tests/integration/runtime-health.test.ts` (+ unit test for the classifier, `server/tests/unit/queue-classifier.test.ts`). Build against a real in-memory DB with applyMigrations; construct RuntimeHealthService directly and/or a minimal Fastify app registering only your route. Cover:
- T040 (five categories collected; adapter under workspace grouping; schema actual/expected/status)
- T040d (behind and ahead both produce schema_version_mismatch)
- T040e (same adapter Available in workspace A, Unavailable in B → both presented separately, not merged)
- T040b (healthSnapshot returns counts, Set not exposed)
- T041 (stale_lock five cases: threshold-1ms, exactly-equal, over-threshold, locked_at illegal+holder missing/terminal→confirmed, locked_at illegal+holder running→lock_timestamp_invalid; assert all v0.2 adapters' capabilities.executionTimeoutMs === DEFAULT_EXECUTION_TIMEOUT_MS)
- T041b/T041c (extracted classifier: drain still works — run queue-drain-eligibility test; health uses classifier; Blocked graph node queued NOT reported queue_starved; eligible_but_not_running + lock occupied → no diagnostic; eligible + lock free → single queue_starved; waiting_for_recovery/invalid_queued_run surfaced)
- T041e (Validating issue waiting for due time, queued_count 0 → waiting_for_validation_due, NOT queue_starved)
- T041f (due-time boundaries: not yet due → waiting; within grace → waiting; past grace → validation_dispatch_overdue with overdue_ms)
- T041d (no available adapter)
- T042 (read-only: calling health triggers no probe, acquires no lock, writes no rows — assert DB state unchanged, pending sets unchanged)
- T043 (route: valid workspace, invalid/cross-project workspace_id → WORKSPACE_NOT_FOUND, omitted → aggregate)

## MUST DO
- Extract the classifier ONCE and reuse it in BOTH drain (startNextQueuedRun) and health (T041b) — never two "look-alike" copies.
- stale_lock must match cleanupStaleLocks() semantics (holder missing/terminal → confirmed regardless of duration; AC-007).
- All diagnostics have suggested_action. eligible_but_not_running never public.
- Read-only: health must not trigger probes/acquire locks/write (FR-006, T042).
- Use server Date.now() consistently; strict greater-than for stale threshold.
- Match repo/service/route/test conventions (read reference files).
- Add the executionTimeoutMs assertion test (T041 prerequisite) — the three/four built-in adapters all set executionTimeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS (claude-code, codex-cli, opencode, fake). If a fake adapter exists, include it.
- Run scoped vitest + ensure `npm -w @personahub/server run typecheck` passes for your files.

## MUST NOT DO
- Do NOT modify server/src/index.ts or server/src/api/index.ts (orchestrator wires them).
- Do NOT touch template-admin files (workflow-template.ts, workflow-template-admin.ts, validate-steps-schema.ts, admin-audit-event.ts, workflow-templates.ts) or schema-v10/migrations.
- Do NOT touch shared/ files.
- Do NOT use `as any`/`@ts-ignore`/`@ts-expect-error`; no new deps; no unrelated refactors; minimal necessary comments.
- Do NOT change the behavioral outcome of startNextQueuedRun — extraction must be behavior-preserving.

## DELIVERABLE
All new/modified source files + passing tests. Report: which task IDs done/verified, test files created, exact RuntimeHealthService constructor signature + the exact registerRoutes + Services additions needed for server/src/index.ts and server/src/api/index.ts (as snippets you did NOT apply), and confirm drain behavior is unchanged. Verify with lsp_diagnostics and scoped vitest run.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-08-09T10:28:45Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F008-workflow-template-admin-runtime-health\\spec.md"})`


> [reasoning] Let me start by reading the mandatory documentation files in order, then explore the existing code structure to understand what I'm working with.

Let me begin by reading the spec, design, and tasks documents.
I'll start by reading the mandatory documentation files in order, then explore the existing code structure.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.2\F008-workflow-template-admin-runtime-health\spec.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F008]
3: related_features: [F004, F005, F007]
4: topics: [workflow-template, admin-ui, runtime-health, observability, v0.2]
5: doc_kind: spec
6: created: 2026-08-01
7: updated: 2026-08-09
8: ---
9: 
10: # F008：Workflow Template Admin & Runtime Health
11: 
12: > Status: ready-for-development | Owner: TBD | Target: v0.2
13: 
14: ## 0. 规格元信息
15: 
16: - **PRD 来源**：`docs/personahub-prd.md` 第 15 节 v0.2 范围中的 "Workflow Template 管理 UI 初版" 与 "Runtime health check"。
17: - **相关**：F004 的 validation 依赖 `steps_json`；F007 的推荐依赖模板的 active 版本。
18: - **功能类型**：user-facing / admin / observability。
19: - **规格模式**：full。
20: - **变更类型**：ADDED。
21: - **一句话意图**
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:28:51Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F008-workflow-template-admin-runtime-health\\design.md"})`


> [reasoning] Let me read the design document next, especially §5 and §5b.
Now reading the design document:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.2\F008-workflow-template-admin-runtime-health\design.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F008]
3: related_features: [F004, F005, F007]
4: topics: [workflow-template, admin-ui, runtime-health, observability]
5: doc_kind: design
6: created: 2026-08-01
7: updated: 2026-08-09
8: ---
9: 
10: # F008：Workflow Template Admin & Runtime Health - 设计
11: 
12: > Status: ready-for-development | Owner: TBD | Spec: `spec.md`
13: 
14: ## 1. 技术概要
15: 
16: 两块互相独立的能力放在同一个 feature，因为它们共享同一条主线：把系统已经拥有但用户看不到的状态呈现出来。
17: 
18: - **模板管理**：给 `WorkflowTemplateRepository` 补写方法，编辑一律走"新增版本"，既有行不可变。
19: - **Runtime health**：新增一个纯只读聚合服务，全部数据来自既有仓储查询，不新增表、不触发任何副作用。
20: 
21: ## 2. 影响面
22: 
23: - **存储**：`workflow_templates` 本身无变更（`version` / `status` 列已具备
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:28:57Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F008-workflow-template-admin-runtime-health\\tasks.md"})`


> [reasoning] Now reading tasks.md, especially Phase 4: T040-T043.
Now reading the tasks document:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.2\F008-workflow-template-admin-runtime-health\tasks.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F008]
3: related_features: [F004, F005, F007]
4: topics: [workflow-template, admin-ui, runtime-health, observability]
5: doc_kind: tasks
6: created: 2026-08-01
7: updated: 2026-08-09
8: ---
9: 
10: # F008：Workflow Template Admin & Runtime Health - 任务
11: 
12: > Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`
13: 
14: ## Phase 1：模板读取与派生投影（FR-001）
15: 
16: - [ ] T009：新建 `server/src/db/schema-v10.ts`——`admin_audit_events` 表 + `idx_workflow_templates_issue_type_version` / `idx_workflow_templates_one_active` 两个唯一索引 + `migrations.ts` 分支 + 迁移测试。版本号按实际落地顺序取，**不得追加进已应用版本**（`design.md` 第 4、7 节）。
17: - [ ] T01
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:03Z

- **tool**: `todowrite({"todos": [{"content": "Read all key existing code files (shared types, errors, run-dispatch, adapter-config, adapter-failure-reprobe, stale-recovery, runtime/types, repos, routes, errors, migrations)", "priority": "high", "status": "in_progress"}, {"content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)", "priority": "high", "status": "pending"}, {"content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)", "priority": "high", "status": 
…[truncated])`


> [reasoning] Now I have a clear understanding of the spec, design, and tasks. Let me explore the existing code structure. Let me set up my todo list and explore the key existing files in parallel.

Key files to read:
1. `shared/src/types/f008.ts` - to see the exact shapes
2. `shared/src/errors/index.ts` - error codes
3. `server/src/services/run-dispatch.ts` - the code to extract from
4. `server/src/services/adapter-config.ts` - to add healthSnapshot
5. `server/src/services/adapter-failure-reprobe.ts` - to add healthSnapshot
6. `server/src/services/stale-recovery.ts` - for stale lock semantics
7. `server/src/runtime/types.ts` - DEFAULT_EXECUTION_TIMEOUT_MS
8. `server/src/repositories/run.ts`, `workspace.ts`, `issue.ts`, `adapter-workspace-status.ts`, `agent-config.ts`, `agent-config-dto.ts`
9. `server/src/services/adapter-availability.ts` - effectiveAdapterStatus
10. `server/src/api/routes/adapters.ts` - route style reference
11. `server/src/api/errors.ts` - AppError, ErrorCode, parseRequestBody
12. `server/src/db/migrations.ts` - schema version query
13. `server/src/services/validation/validator-slot-claimer.ts` - context

Let me read these in parallel batches. I'll start with the most critical ones.
Let me set up my todo list and start exploring the key existing files in parallel.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all key existing code files (shared types, errors, run-dispatch, adapter-config, adapter-failure-reprobe, stale-recovery, runtime/types, repos, routes, errors, migrations)",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create RuntimeHealthService (server/src/serv
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:16Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\f008.ts"})`

Reading the critical foundation files in parallel:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\f008.ts</path>
<type>file</type>
<content>
1: import type { AdapterStatus, IssueType } from "./index.js";
2: 
3: export interface WorkflowTemplateVersionSummary {
4:   id: string;
5:   name: string;
6:   issue_type: IssueType;
7:   status: string;
8:   version: number;
9:   validation_enabled: boolean | null;
10:   created_at: string;
11:   updated_at: string;
12: }
13: 
14: export interface WorkflowTemplateStep {
15:   id: string;
16:   role: string;
17: }
18: 
19: export interface WorkflowTemplateDetail {
20:   id: string;
21:   name: string;
22:   issue_type: IssueType;
23:   collaboration_topology: string;
24:   agent_team_template_id: string | null;
25:   validation_policy_id: string | null;
26:   steps_json: string | null;
27:   handoff_p
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:25Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\run-dispatch.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, RunPurpose } from "@personahub/shared/types";
3: import {
4:   IssueStatus as IS,
5:   RunStatus as RS,
6:   RunRole,
7:   FailureReason as FR,
8:   CommandTraceCapability,
9:   ValidationBlockReason,
10: } from "@personahub/shared/types";
11: import { ErrorCode } from "@personahub/shared/errors";
12: import type { RunService } from "./run.js";
13: import type { ManualRoutingService } from "./manual-routing-service.js";
14: import type { WorkspaceLockService } from "./workspace-lock.js";
15: import type { ThreadEventService } from "./thread-event.js";
16: import type { DevelopmentTraceService } from "./development-trace.js"
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:30Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts"})`


> [reasoning] Now I understand the startNextQueuedRun logic. Let me analyze the classification:

1. `if (!issue) continue;` → issue null → skip (classify as invalid_queued_run for health)
2. `if (issue.status === IS.Blocked)`: 
   - if `run.role === RunRole.GraphNode` → `continue` (skip, keep queued) → waiting_for_recovery
   - else → `cancelQueued` → invalid_queued_run
3. `if (issue.status === IS.Done)` → `cancelQueued` → invalid_queued_run
4. `if (run.role === RunRole.Implementation && issue.status !== IS.Inbox && issue.status !== IS.Ready && issue.status !== IS.Running)` → `cancelQueued` → invalid_queued_run
5. `if (run.role === RunRole.Validator)`:
   - `if (issue.status !== IS.Validating)` → `cancelQueued` → invalid_queued_run
   - `if (run.validation_round !== issue.validation_round_count + 1)` → `cancelQueued` → invalid_queued_run
6. consult: eligible on Inbox/Ready/Running/Validating (Done/Blocked already handled)
7. otherwise → eligible_but_not_running

Now let me read the other key files in parallel.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\adapter-config.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { AdapterConfig, AdapterStatus, AgentCapability } from "@personahub/shared/types";
3: import { AdapterStatus as AS, AdapterAuthType } from "@personahub/shared/types";
4: import { ErrorCode } from "@personahub/shared/errors";
5: import type { AgentConfigRepository } from "../repositories/agent-config.js";
6: import { deriveRole } from "../repositories/agent-config.js";
7: import { toPublicAdapter } from "../repositories/agent-config-dto.js";
8: import type { ProjectRepository } from "../repositories/project.js";
9: import type { WorkspaceRepository } from "../repositories/workspace.js";
10: import type { AdapterWorkspaceStatusRep
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:40Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-failure-reprobe.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\adapter-failure-reprobe.ts</path>
<type>file</type>
<content>
1: import { AdapterStatus as AS, FailureReason as FR, RunStatus as RS } from "@personahub/shared/types";
2: import type { AgentConfigRepository } from "../repositories/agent-config.js";
3: import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
4: import type { RunRepository } from "../repositories/run.js";
5: import type { WorkspaceRepository } from "../repositories/workspace.js";
6: import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
7: import { toPublicAdapter } from "../repositories/agent-config-dto.js";
8: import { sanitizeAuthStatusMessage } from "../runtime/trace/redaction.js";
9: import { effectiveAdapter
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:47Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\stale-recovery.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\stale-recovery.ts</path>
<type>file</type>
<content>
1: import type { RunStatus } from "@personahub/shared/types";
2: import { RunStatus as RS, FailureReason as FR, ThreadEventType, ActorType } from "@personahub/shared/types";
3: import type { RunRepository } from "../repositories/run.js";
4: import type { WorkspaceRepository } from "../repositories/workspace.js";
5: import type { ThreadEventService } from "./thread-event.js";
6: import type { WorkspaceLockService } from "./workspace-lock.js";
7: import type { DevelopmentTraceService } from "./development-trace.js";
8: import type { RunTraceRepository } from "../repositories/run-trace.js";
9: import { SCAN_REASON_CODES } from "../runtime/trace/constants.js";
10: 
11: export class StaleRecove
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:51Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\types.ts"})`


> [reasoning] Now I understand the stale-lock semantics. Let me read more key files in parallel: runtime/types.ts, the repos, errors, routes, migrations.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\types.ts</path>
<type>file</type>
<content>
1: import type { AdapterConfig, RunStatus, FailureReason, AdapterAuthType } from "@personahub/shared/types";
2: import type { RunTraceSignal } from "@personahub/shared/types";
3: 
4: export interface WorkspaceContext {
5:   workspaceId: string;
6:   localPath: string;
7:   gitBranch: string | null;
8:   pushCredentialsEnabled: boolean;
9: }
10: 
11: export interface AgentRunInput {
12:   runId: string;
13:   issueId: string;
14:   threadId: string;
15:   workspace: WorkspaceContext;
16:   instructions: string;
17:   context: string;
18:   /**
19:    * model_provider/default_model/auth_type/api_key are only meaningful for
20:    * OpenCode (design §6.4: `-m provider/model` is mandatory on every
21:  
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:57Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts"})`

Now reading the repositories, errors, routes, and migrations in parallel:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, RunStatus, FailureReason, RunRole, RunDispatchSource, RunPurpose as RunPurposeType, AdapterIdentitySnapshot } from "@personahub/shared/types";
3: import { RunRole as RR, RunDispatchSource as RDS, RunPurpose } from "@personahub/shared/types";
4: import { generateRunId } from "../id.js";
5: import { isActiveGraphAttemptConflict, GraphConstraintError } from "../db/sqlite-errors.js";
6: 
7: export interface RunCreateInput {
8:   /** Pre-generated id — lets a caller build content that must reference the Run's own id (e.g. validator context) before the row exists, so the row can be created once with final content instead of insert-the
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:03Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\workspace.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\workspace.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Workspace, WorkspaceLockState } from "@personahub/shared/types";
3: import { generateWorkspaceId } from "../id.js";
4: 
5: export interface WorkspaceCreateInput {
6:   project_id: string;
7:   local_path: string;
8:   local_path_normalized: string;
9:   git_branch: string | null;
10:   lock_state: WorkspaceLockState;
11: }
12: 
13: export interface WorkspaceUpdateInput {
14:   git_branch: string | null;
15:   updated_at: string;
16: }
17: 
18: interface WorkspaceRow {
19:   id: string;
20:   project_id: string;
21:   local_path: string;
22:   local_path_normalized: string;
23:   git_branch: string | null;
24:   lock_state: stri
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:08Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\issue.ts"})`


> [reasoning] I need to check if WorkspaceRepository has a listByProject method. Let me check. It doesn't seem to have one - only `listAll()`. I'll need to use `listAll()` and filter by project_id, or check if there's another method. Let me look at the issue repo and other key files.

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

## assistant · 2026-08-09T10:30:15Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\adapters.ts"})`


> [reasoning] I need a method to list Validating issues with `validation_dispatch_due_at IS NOT NULL` (regardless of whether due). Let me check - there's `listValidatingWithDueBefore` which is for the scheduler. For health, I need ALL validating issues with due_at not null. I can query directly via db, or I may need to add a repository method. Let me see the design - it says "直接查询 `issues` 表". I can query directly via db in the service. Actually, looking at the design more carefully, it says I should query `SELECT * FROM issues WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL`. 

I have two options:
1. Add a new method to IssueRepository
2. Query directly via db in the RuntimeHealthService

The design says "直接查询 issues 表" - I think adding a repo method is cleaner and matches conventions. But the task says I can create new runtime-health files. Let me check if I can add a method to issue.ts - the instructions say "You MAY edit run-dispatch.ts, adapter-config.ts, adapter-failure-reprobe.ts, and create new runtime-health files." 

Hmm, issue.ts isn't in the allowed list. But adding a read-only query method to IssueRepository seems reasonable and necessary. Let me re-read the constraints.

"You MAY edit run-dispatch.ts, adapter-config.ts, adapter-failure-reprobe.ts, and create new runtime-health files."

This is a constraint on what I can edit. The issue.ts repository is not explicitly listed. But the RuntimeHealthService needs to query issues. I have a few options:
1. Query directly via the `db` parameter in RuntimeHealthService (the service has `db` injected). This avoids touching issue.ts.
2. Use `issueRepo.listByStatus('Validating')` and filter in the service for `validation_dispatch_due_at !== null`.

Option 2 is cleaner - `listByStatus` already exists and returns Issues with all fields including `validation_dispatch_due_at`. I can filter in the service. This avoids touching issue.ts and reuses existing repo methods. Let me go with option 2.

Wait, but `listByStatus` returns ALL validating issues globally, not scoped to a project. The design says I should query issues and group by workspace_id. For health scoped to a project, I need to filter by project. Let me check - `issueRepo.list(projectId)` returns all issues for a project. But that's not filtered by status. 

Actually, for the health service, I need: issues WHERE status='Validating' AND validation_dispatch_due_at IS NOT NULL, scoped to the project (or workspace). I can:
- Use `issueRepo.list(projectId)` to get all project issues, then filter for status=Validating && validation_dispatch_due_at != null in memory. This is a read-only approach using existing repo methods.

But that could be inefficient for large projects. However, for v0.2 this is fine and read-only. Actually, let me reconsider - I can query directly via `db` in the service since `db` is injected. The design explicitly says "直接查询 `issues` 表". Let me do that to be precise and efficient. I'll use `db.prepare(...)` directly in the service for this specific query.

Actually, let me look at how the route and service conventions work. Let me read adapters.ts route and errors.ts to understand the patterns. Let me also check the agent-config repo and adapter-workspace-status repo.

Let me read these in parallel.
Reading more key files in parallel:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\api\routes\adapters.ts</path>
<type>file</type>
<content>
1: import type { FastifyPluginAsync } from "fastify";
2: import { z } from "zod";
3: import type { AdapterConfigService } from "../../services/adapter-config.js";
4: import { AdapterAuthType, AgentCapability } from "@personahub/shared/types";
5: import { getProviderMetadata } from "../../runtime/provider-metadata.js";
6: import { parseRequestBody } from "../errors.js";
7: 
8: export interface AdapterRoutesOptions {
9:   adapterConfigService: AdapterConfigService;
10: }
11: 
12: /**
13:  * Route-boundary schemas (docs/decisions/0005: "只做参数校验（zod）") — the
14:  * service layer trusts these types once past this point. Every field a
15:  * malformed body could send with the wrong JS type (a number 
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:28Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\errors.ts"})`

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

## assistant · 2026-08-09T10:30:33Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\adapter-workspace-status.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\adapter-workspace-status.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { AdapterStatus } from "@personahub/shared/types";
3: 
4: /**
5:  * Workspace-aware adapter availability override (schema v7). Deliberately
6:  * NOT the single source of truth for adapter status — `agent_configs.status`
7:  * stays the Project-global, conservative baseline. A row here means "this
8:  * specific (adapter, workspace) pair's effective status genuinely differs
9:  * from that baseline" (design: OpenCode OAuth on Windows is Unknown
10:  * globally but confirmed Available in one workspace with
11:  * push_credentials_enabled=true; a Run failure in one workspace shouldn't
12:  * silently disable the adap
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:42Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\agent-config.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\agent-config.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { AdapterStatus, AgentCapability } from "@personahub/shared/types";
3: import { AdapterStatus as AS, AdapterAuthType, AgentCapability as AC } from "@personahub/shared/types";
4: import { generateAdapterConfigId } from "../id.js";
5: 
6: /**
7:  * Pure capability check, shared by manual routing (Phase 7) and the automatic
8:  * ValidatorSelector (T028) — one true-source function, not two independently
9:  * maintained checks. Only ever reads the already-parsed `capability_tags`
10:  * array; never falls back to the deprecated `role` column.
11:  */
12: export function hasCapability(record: { capability_tags: AgentCapability[] }
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:53Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-availability.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\adapter-availability.ts</path>
<type>file</type>
<content>
1: import { AdapterStatus, type AgentCapability } from "@personahub/shared/types";
2: import type { AgentConfigRecord } from "../repositories/agent-config.js";
3: import { hasCapability } from "../repositories/agent-config.js";
4: import type { AdapterWorkspaceStatusRecord } from "../repositories/adapter-workspace-status.js";
5: 
6: /**
7:  * Single place that merges the Project-global baseline with a workspace
8:  * override (schema v7) — every availability check (resolver, validator
9:  * selector, explicit manual pick) must go through this, not compare
10:  * `record.status` directly, or a workspace-specific exception silently
11:  * stops applying in whichever call site forgot to
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:04Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\agent-config-dto.ts"})`

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

## assistant · 2026-08-09T10:31:19Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\migrations.ts"})`


> [reasoning] Now let me read the migrations.ts to understand the schema version query, and look at an existing test to understand the test patterns. Let me also check the project repo and the shared types for Run/Issue.
Now reading migrations, project repo, and an existing integration test for patterns:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\db\migrations.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import { SCHEMA_V1 } from "./schema-v1.js";
3: import { SCHEMA_V2 } from "./schema-v2.js";
4: import { SCHEMA_V3 } from "./schema-v3.js";
5: import { SCHEMA_V4 } from "./schema-v4.js";
6: import { SCHEMA_V5 } from "./schema-v5.js";
7: import { SCHEMA_V6 } from "./schema-v6.js";
8: import { SCHEMA_V7 } from "./schema-v7.js";
9: import { SCHEMA_V8 } from "./schema-v8.js";
10: import { SCHEMA_V9 } from "./schema-v9.js";
11: import { SCHEMA_V10 } from "./schema-v10.js";
12: 
13: export function applyMigrations(db: Database.Database): void {
14:   db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
15:     version INTEGER PRIMARY KEY,
16:     applied_at 
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:33Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\project.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\project.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Project } from "@personahub/shared/types";
3: import { generateProjectId } from "../id.js";
4: 
5: export type SetDefaultAdapterResult =
6:   | { success: true }
7:   | { success: false; reason: "adapter_not_found" | "cross_project" | "unavailable" };
8: 
9: export class ProjectRepository {
10:   constructor(private db: Database.Database) {}
11: 
12:   create(name: string, description: string | null): Project {
13:     const id = generateProjectId();
14:     const now = new Date().toISOString();
15:     this.db.prepare(
16:       "INSERT INTO projects (id, name, description, default_workspace_id, default_coordinator_agent_id, cre
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:43Z

- **tool**: `glob({"pattern": "server/tests/integration/*.test.ts"})`


> [reasoning] Now let me look at an existing integration test to understand the test patterns, and check the shared types for Run and Issue. Let me also look at the adapter files to confirm executionTimeoutMs. Let me find an existing integration test that uses applyMigrations and constructs services.
Let me find existing integration tests and the shared types for Run/Issue:

  <details><summary>tool output</summary>

  ```text
Found 85 file(s)

D:\Projects\personahub\server\tests\integration\migration-v10.test.ts
D:\Projects\personahub\server\tests\integration\intake-confirm.test.ts
D:\Projects\personahub\server\tests\integration\intake-null-definition.test.ts
D:\Projects\personahub\server\tests\integration\graph-cli-acceptance.test.ts
D:\Projects\personahub\server\tests\integration\intake-routes.test.ts
D:\Projects\personahub\server\tests\integration\intake-secret.test.ts
D:\Projects\personahub\server\tests\integration\persistence.test.ts
D:\Projects\personahub\server\tests\integration\migration-v6.test.ts
D:\Projects\personahub\server\tests\integration\run-routes.test.ts
D:\Projects\personahub\server\tests\integration\validation-routes.test.ts
D:\Projects\personahub\server\tests\integration\secret-canary-scan.
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:51Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\queue-drain-eligibility.test.ts"})`


> [reasoning] Let me read the queue-drain-eligibility test (which is the regression test I need to keep passing) and an adapter test that shows the test setup pattern. Let me also look at the adapter files to confirm executionTimeoutMs. Let me read these in parallel.
Let me read the queue-drain-eligibility test (the regression test) and an adapter test for setup patterns:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\queue-drain-eligibility.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
3: import { IssueStatus, RunRole, RunDispatchSource, RunStatus, AdapterStatus, AgentCapability } from "@personahub/shared/types";
4: 
5: function setupFixture(services: TestServices, tempDir: string) {
6:   const project = services.projectService.create("Test");
7:   services.workspaceService.bind(project.id, tempDir);
8:   const workspace = services.workspaceService.get(project.id)!;
9:   const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
10:   services.i
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:01Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\helpers.ts"})`


> [reasoning] Now let me look at the test helpers and a test that constructs services directly. Let me also check the adapter files for executionTimeoutMs. Let me read these in parallel.
Now reading the test helpers and checking adapter files for executionTimeoutMs:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\helpers.ts</path>
<type>file</type>
<content>
1: import Database from "better-sqlite3";
2: import { tmpdir } from "node:os";
3: import { join } from "node:path";
4: import { mkdtempSync, rmSync } from "node:fs";
5: import { openDatabase } from "../src/db/index.js";
6: import { ProjectRepository } from "../src/repositories/project.js";
7: import { WorkspaceRepository } from "../src/repositories/workspace.js";
8: import { IssueRepository } from "../src/repositories/issue.js";
9: import { ThreadRepository } from "../src/repositories/thread.js";
10: import { ThreadEventRepository } from "../src/repositories/thread-event.js";
11: import { WorkflowTemplateRepository } from "../src/repositories/workflow-template.js";
12: import { ValidationPolicyRepositor
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:08Z

- **tool**: `glob({"pattern": "server/src/runtime/adapters/*.ts"})`


> [reasoning] Now let me check the adapter files for executionTimeoutMs. Let me look at the fake adapter and the three built-in adapters. Let me also check the shared types for Run and Issue.
Let me check the adapter files for executionTimeoutMs and the shared types:

  <details><summary>tool output</summary>

  ```text
Found 13 file(s)

D:\Projects\personahub\server\src\runtime\adapters\opencode-adapter.ts
D:\Projects\personahub\server\src\runtime\adapters\opencode-protocol.ts
D:\Projects\personahub\server\src\runtime\adapters\shell-command-patterns.ts
D:\Projects\personahub\server\src\runtime\adapters\opencode-normalizer.ts
D:\Projects\personahub\server\src\runtime\adapters\codex-protocol.ts
D:\Projects\personahub\server\src\runtime\adapters\codex-cli-adapter.ts
D:\Projects\personahub\server\src\runtime\adapters\claude-protocol.ts
D:\Projects\personahub\server\src\runtime\adapters\claude-pretooluse-hook.ts
D:\Projects\personahub\server\src\runtime\adapters\claude-code-normalizer.ts
D:\Projects\personahub\server\src\runtime\adapters\claude-code-adapter.ts
D:\Projects\personahub\server\src\runtime\adapter
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:19Z

- **tool**: `grep({"include": "server/src/runtime/adapters/*.ts", "output_mode": "content", "pattern": "executionTimeoutMs"})`

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 4 file(s)

D:\Projects\personahub\server\src\runtime\adapters\claude-code-adapter.ts
  38: executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,

D:\Projects\personahub\server\src\runtime\adapters\codex-cli-adapter.ts
  39: executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,

D:\Projects\personahub\server\src\runtime\adapters\opencode-adapter.ts
  45: executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,

D:\Projects\personahub\server\src\runtime\adapters\fake-adapter.ts
  37: executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:29Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapter-registry.ts"})`


> [reasoning] All four adapters (claude-code, codex-cli, opencode, fake) set `executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS`. Now let me look at the adapter-registry to understand how to list adapters, and look at the shared types for Run/Issue. Let me also look at how routes are registered in the api/index.ts (just to know the pattern, NOT to edit).
Let me read the adapter registry and the shared types index to understand Run/Issue types:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\adapter-registry.ts</path>
<type>file</type>
<content>
1: import type { AgentAdapter } from "./types.js";
2: 
3: export class AgentAdapterRegistry {
4:   private adapters = new Map<string, AgentAdapter>();
5: 
6:   /**
7:    * Replaces any existing registration for the same provider. This is the
8:    * long-standing behavior the test suite already depends on pervasively:
9:    * `createTestServices()` registers a default `FakeAgentAdapter()`, and
10:    * individual tests re-register a differently-configured one (custom
11:    * delays/output/failure modes) for their own scenario. Use
12:    * `registerUnique()` when accidental double-registration should be a hard
13:    * error instead (e.g. production startup wiring, or a registry built fr
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:40Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\index.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\api\index.ts</path>
<type>file</type>
<content>
1: import type { FastifyInstance } from "fastify";
2: import { projectRoutes } from "./routes/projects.js";
3: import { workspaceRoutes } from "./routes/workspaces.js";
4: import { issueRoutes } from "./routes/issues.js";
5: import { threadRoutes } from "./routes/threads.js";
6: import { adapterRoutes } from "./routes/adapters.js";
7: import { runRoutes } from "./routes/runs.js";
8: import { traceRoutes } from "./routes/traces.js";
9: import { validationRoutes } from "./routes/validation.js";
10: import graphRoutes from "./routes/graph.js";
11: import intakeRoutes from "./routes/intake.js";
12: import type { GraphRuntimeService } from "../services/graph-runtime.js";
13: import type { GraphRunRepository 
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:47Z

- **tool**: `grep({"include": "shared/src/types/*.ts", "output_mode": "content", "pattern": "export (enum|type|const|interface) (IssueStatus|RunStatus|RunRole|Issue|Run|AdapterStatus)"})`


> [reasoning] Now let me check the shared types to understand the Run, Issue, RunStatus, RunRole, IssueStatus types. Let me also look at how the fake-adapter is structured (for the executionTimeoutMs assertion test).
Let me check the shared types and the fake adapter:

  <details><summary>tool output</summary>

  ```text
Found 24 match(es) in 7 file(s)

D:\Projects\personahub\shared\src\types\adapter.ts
  29: export enum RunPurpose {

D:\Projects\personahub\shared\src\types\f008.ts
  88: export interface RuntimeHealthSnapshot {
  119: export interface RuntimeHealthResponse {

D:\Projects\personahub\shared\src\types\graph.ts
  132: export interface IssueGraphResponse {

D:\Projects\personahub\shared\src\types\index.ts
  29: export interface Issue {
  105: export enum IssueStatus {
  114: export enum IssueType {
  118: export enum IssuePriority {
  194: export interface IssueWithThread extends Issue {
  205: export enum RunStatus {
  228: export enum AdapterStatus {
  234: export interface Run {
  310: export interface IssueWithRun extends Issue {
  315: export interface RunSummary {

D:\Projects\personahub\
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:32:55Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "limit": 30, "offset": 29})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
29: export interface Issue {
30:   id: string;
31:   project_id: string;
32:   workspace_id: string;
33:   primary_thread_id: string | null;
34:   issue_type: IssueType;
35:   workflow_template_id: string;
36:   validation_policy_id: string;
37:   title: string;
38:   goal: string | null;
39:   status: IssueStatus;
40:   owner_agent_id: string | null;
41:   coordinator_agent_id: string | null;
42:   priority: IssuePriority;
43:   labels: string[];
44:   validation_round_count: number;
45:   blocked_reason_code: ValidationBlockReason | string | null;
46:   blocked_reason_message: string | null;
47:   /** F005 §8.1: set in Phase A (implementation completed), cleared by the Phase B winner. Non-null means
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:02Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "limit": 60, "offset": 100})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
100:   version: number;
101:   created_at: string;
102:   updated_at: string;
103: }
104: 
105: export enum IssueStatus {
106:   Inbox = "Inbox",
107:   Ready = "Ready",
108:   Running = "Running",
109:   Validating = "Validating",
110:   Done = "Done",
111:   Blocked = "Blocked",
112: }
113: 
114: export enum IssueType {
115:   Coding = "coding",
116: }
117: 
118: export enum IssuePriority {
119:   Low = "low",
120:   Normal = "normal",
121:   High = "high",
122: }
123: 
124: export enum ThreadType {
125:   Primary = "primary",
126:   Room = "room",
127:   Incident = "incident",
128:   Council = "council",
129: }
130: 
131: export enum ThreadEventType {
132:   IssueCreated = "issue.created",
133:   R
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:09Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "limit": 60, "offset": 200})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
200:   issue_id: string;
201:   thread_type: ThreadType;
202:   title: string;
203: }
204: 
205: export enum RunStatus {
206:   Queued = "queued",
207:   Running = "running",
208:   Completed = "completed",
209:   Failed = "failed",
210:   Interrupted = "interrupted",
211:   Cancelled = "cancelled",
212: }
213: 
214: export enum FailureReason {
215:   AdapterExitNonzero = "adapter_exit_nonzero",
216:   SpawnFailed = "spawn_failed",
217:   ExecutionTimeout = "execution_timeout",
218:   CredentialIsolationBlocked = "credential_isolation_blocked",
219:   PreExecutionApprovalRejected = "pre_execution_approval_rejected",
220:   PostHocEscalation = "post_hoc_escalation",
221:   ServerRestarted = "server_res
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:16Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\validation.ts", "limit": 25, "offset": 1})`

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
11:   /** F006: Graph node Run — drives the graph state machine, not the Issue
12:    *  state machine. Must NOT fall through to implementation/validator branches. */
13:   GraphNode = "graph_node",
14: }
15:
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:25Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\fake-adapter.ts", "limit": 50})`


> [reasoning] Now I have a complete understanding of all the key code. Let me also check the fake-adapter.ts to understand its capabilities for the assertion test, and look at how the server/index.ts wires things (just for the snippet I need to provide, NOT to edit).
Let me read the fake adapter and check server/src/index.ts for wiring patterns:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\adapters\fake-adapter.ts</path>
<type>file</type>
<content>
1: import type {
2:   AgentAdapter,
3:   AgentAdapterCapabilities,
4:   AgentRunInput,
5:   AdapterValidationResult,
6:   RunHandle,
7:   RunOutputChunk,
8:   RunExitResult,
9: } from "../types.js";
10: import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../types.js";
11: import type { RunTraceSignal } from "@personahub/shared/types";
12: 
13: export interface FakeAdapterOptions {
14:   outputDelayMs?: number;
15:   outputChunks?: string[];
16:   exitCode?: number;
17:   delayMs?: number;
18:   failureReason?: import("@personahub/shared/types").FailureReason | null;
19:   errorMessage?: string | null;
20:   traceSignals?: RunTraceSignal[];
21:   supportsStructuredTrace?: boolean;
22:   sup
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:33Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\index.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\index.ts</path>
<type>file</type>
<content>
1: import Fastify from "fastify";
2: import cors from "@fastify/cors";
3: import { ErrorCode } from "@personahub/shared/errors";
4: import { openDatabase } from "./db/index.js";
5: import { ProjectRepository } from "./repositories/project.js";
6: import { WorkspaceRepository } from "./repositories/workspace.js";
7: import { IssueRepository } from "./repositories/issue.js";
8: import { ThreadRepository } from "./repositories/thread.js";
9: import { ThreadEventRepository } from "./repositories/thread-event.js";
10: import { WorkflowTemplateRepository } from "./repositories/workflow-template.js";
11: import { ValidationPolicyRepository } from "./repositories/validation-policy.js";
12: import { AgentConfigRepos
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:40Z

- **tool**: `grep({"include": "server/src/services/run.ts", "output_mode": "content", "pattern": "listQueuedByWorkspace|cancelQueued|get\\("})`


> [reasoning] Now I have a complete understanding of the codebase. Let me also look at an existing route test to understand the Fastify app test pattern, and the run-service.ts for `listQueuedByWorkspace`. Let me also check how the run-service wraps the run repo.
Let me check the RunService to understand `listQueuedByWorkspace` and look at a route test pattern:

  <details><summary>tool output</summary>

  ```text
Found 5 match(es) in 1 file(s)

D:\Projects\personahub\server\src\services\run.ts
  26: get(runId: string): Run {
  38: listQueuedByWorkspace(workspaceId: string): Run[] {
  39: return this.runRepo.listQueuedByWorkspace(workspaceId);
  154: cancelQueued(runId: string, reason: string): Run | null {
  206: const queuedRuns = this.runRepo.listQueuedByWorkspace(workspaceId);

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:33:49Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\adapter-routes.test.ts", "limit": 70})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\adapter-routes.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Fastify from "fastify";
3: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
4: import { registerRoutes } from "../../src/api/index.js";
5: import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
6: import { ErrorCode } from "@personahub/shared/errors";
7: import { AdapterAuthType, AgentCapability, AdapterStatus, CliProvider } from "@personahub/shared/types";
8: import type { AgentAdapter, AdapterValidationResult } from "../../src/runtime/types.js";
9: 
10: /**
11:  * T073/T074/T075/T076/T080: HTTP-level tests 
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:34:00Z

- **tool**: `glob({"pattern": "server/tests/unit/*.test.ts"})`


> [reasoning] Now I have a thorough understanding of the codebase. Let me check if there are any existing unit tests to understand the unit test pattern.

Let me now check the `server/tests/unit/` directory and the vitest config.

  <details><summary>tool output</summary>

  ```text
Found 47 file(s)

D:\Projects\personahub\server\tests\unit\adapter-config-validate-registry.test.ts
D:\Projects\personahub\server\tests\unit\adapter-config.test.ts
D:\Projects\personahub\server\tests\unit\project-default-adapter.test.ts
D:\Projects\personahub\server\tests\unit\adapter-resolver.test.ts
D:\Projects\personahub\server\tests\unit\adapter-availability.test.ts
D:\Projects\personahub\server\tests\unit\adapter-workspace-status-repository.test.ts
D:\Projects\personahub\server\tests\unit\adapter-config-command-resolution.test.ts
D:\Projects\personahub\server\tests\unit\workspace-context.test.ts
D:\Projects\personahub\server\tests\unit\executable-resolver.test.ts
D:\Projects\personahub\server\tests\unit\error-mapping.test.ts
D:\Projects\personahub\server\tests\unit\opencode-protocol-o
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:34:10Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\unit\\run-routing-classifier.test.ts", "limit": 50})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\unit\run-routing-classifier.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect } from "vitest";
2: import { classifyRunRequest } from "../../src/services/run-routing-classifier.js";
3: import { IssueStatus, RunPurpose, RunRole, AgentCapability } from "@personahub/shared/types";
4: 
5: // T051: design §7.2 matrix — pure classifier, no CLI/repo needed.
6: 
7: describe("classifyRunRequest (T051/T052) - expected role / purpose matrix", () => {
8:   describe("terminal statuses reject all Runs", () => {
9:     it("rejects Done regardless of purpose/capability", () => {
10:       expect(classifyRunRequest(IssueStatus.Done, undefined, [AgentCapability.Implementation])).toEqual({ allowed: false });
11:       expect(classifyRunReques
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:34:17Z

- **tool**: `grep({"include": "shared/src/errors/*.ts", "output_mode": "content", "pattern": "WORKSPACE_NOT_FOUND|PROJECT_NOT_FOUND"})`


> [reasoning] Now I have a thorough understanding. Let me also check the errors index to confirm WORKSPACE_NOT_FOUND exists, and the `db/index.ts` to understand `openDatabase`.

Let me now look at the ErrorCode enum to confirm WORKSPACE_NOT_FOUND is there.
Let me verify the ErrorCode enum has WORKSPACE_NOT_FOUND and check db/index.ts:

  <details><summary>tool output</summary>

  ```text
Found 2 match(es) in 1 file(s)

D:\Projects\personahub\shared\src\errors\index.ts
  26: PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND",
  30: WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND",

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
-
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:34:27Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run.ts", "limit": 30, "offset": 150})`


> [reasoning] Now I have everything I need. Let me update my todo list and start building.

Let me first understand the full classification logic from `startNextQueuedRun`:

```typescript
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) continue;  // -> invalid_queued_run (skip/silently drop)
      
      if (issue.status === IS.Blocked) {
        if (run.role === RunRole.GraphNode) continue;  // -> waiting_for_recovery (F006 deliberately keeps blocked graph nodes queued)
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");  // -> invalid_queued_run
        continue;
      }
      
      if (issue.status === IS.Done) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // -> invalid_queued_run
        continue;
      }
      
      if (
        run.role === RunRole.Implementation &&
        issue.status !== IS.Inbox &&
        issue.status !== IS.Ready &&
        issue.status !== IS.Running
      ) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // -> invalid_queued_run
        continue;
      }
      
      if (run.role === RunRole.Validator) {
        if (issue.status !== IS.Validating) {
          this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // -> invalid_queued_run
          continue;
        }
        const expectedRound = issue.validation_round_count + 1;
        if (run.validation_round !== expectedRound) {
          this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // -> invalid_queued_run
          continue;
        }
      }
      // consult: eligible on Inbox/Ready/Running/Validating (Done/Blocked already handled above)
      
      // At this point, the run is eligible -> eligible_but_not_running
      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) return;
      // ... side effects ...
    }
}
```

Now let me design the pure classifier:

```typescript
export type QueuedRunClassification = "eligible_but_not_running" | "waiting_for_recovery" | "invalid_queued_run";

export function classifyQueuedRun(run: Run, issue: Issue | null): QueuedRunClassification {
  // issue null -> invalid (startNextQueuedRun does `if (!issue) continue` = skip)
  if (!issue) return "invalid_queued_run";
  
  // issue.status Blocked
  if (issue.status === IssueStatus.Blocked) {
    if (run.role === RunRole.GraphNode) return "waiting_for_recovery"; // F006 deliberately keeps blocked graph nodes queued
    return "invalid_queued_run"; // they'd be cancelled
  }
  
  // issue.status Done
  if (issue.status === IssueStatus.Done) return "invalid_queued_run";
  
  // role Implementation and status not in (Inbox, Ready, Running)
  if (
    run.role === RunRole.Implementation &&
    issue.status !== IssueStatus.Inbox &&
    issue.status !== IssueStatus.Ready &&
    issue.status !== IssueStatus.Running
  ) {
    return "invalid_queued_run";
  }
  
  // role Validator
  if (run.role === RunRole.Validator) {
    if (issue.status !== IssueStatus.Validating) return "invalid_queued_run";
    const expectedRound = issue.validation_round_count + 1;
    if (run.validation_round !== expectedRound) return "invalid_queued_run";
  }
  
  // consult: eligible on Inbox/Ready/Running/Validating (Done/Blocked already handled above)
  // otherwise -> eligible
  return "eligible_but_not_running";
}
```

Now let me refactor `startNextQueuedRun` to use this. The key is to keep all side effects identical. The original code:

1. `if (!issue) continue;` -> classify returns "invalid_queued_run", we need to `continue` (skip, no cancel)
2. Blocked + GraphNode -> `continue` (skip, no cancel) -> "waiting_for_recovery"
3. Blocked + other -> cancelQueued + continue -> "invalid_queued_run"
4. Done -> cancelQueued + continue -> "invalid_queued_run"
5. Implementation + wrong status -> cancelQueued + continue -> "invalid_queued_run"
6. Validator + wrong status -> cancelQueued + continue -> "invalid_queued_run"
7. Validator + wrong round -> cancelQueued + continue -> "invalid_queued_run"
8. otherwise -> eligible, proceed to lock acquire etc.

So the refactored version:

```typescript
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      const classification = classifyQueuedRun(run, issue);
      
      if (classification === "invalid_queued_run") {
        // issue null: startNextQueuedRun does `if (!issue) continue` = skip silently (no cancel)
        if (!issue) continue;
        // Blocked + non-GraphNode: cancel with issue_blocked reason
        if (issue.status === IS.Blocked) {
          this.runService.cancelQueued(run.id, "issue_blocked_before_start");
        } else {
          this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        }
        continue;
      }
      
      if (classification === "waiting_for_recovery") {
        // F006 deliberately keeps blocked graph nodes queued - skip without cancelling
        continue;
      }
      
      // classification === "eligible_but_not_running"
      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) return;
      // ... rest of side effects ...
    }
}
```

Wait, I need to be careful here. The original code distinguishes between:
- `issue null` -> `continue` (skip, NO cancel)
- `Blocked + non-GraphNode` -> `cancelQueued(run.id, "issue_blocked_before_start")` + continue
- `Done` -> `cancelQueued(run.id, "issue_state_changed_before_start")` + continue
- `Implementation + wrong status` -> `cancelQueued(run.id, "issue_state_changed_before_start")` + continue
- `Validator + wrong status` -> `cancelQueued(run.id, "issue_state_changed_before_start")` + continue
- `Validator + wrong round` -> `cancelQueued(run.id, "issue_state_changed_before_start")` + continue

So in the refactored version, for `invalid_queued_run`:
- if issue is null -> continue (no cancel)
- if issue.status === Blocked -> cancel with "issue_blocked_before_start"
- else -> cancel with "issue_state_changed_before_start"

This preserves the exact same behavior.

Actually, wait. Let me re-check the original more carefully:

```typescript
if (issue.status === IS.Blocked) {
    if (run.role === RunRole.GraphNode) continue;  // waiting_for_recovery - skip, no cancel
    this.runService.cancelQueued(run.id, "issue_blocked_before_start");  // invalid - cancel
    continue;
}
if (issue.status === IS.Done) {
    this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // invalid - cancel
    continue;
}
if (
    run.role === RunRole.Implementation &&
    issue.status !== IS.Inbox &&
    issue.status !== IS.Ready &&
    issue.status !== IS.Running
) {
    this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // invalid - cancel
    continue;
}
if (run.role === RunRole.Validator) {
    if (issue.status !== IS.Validating) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // invalid - cancel
        continue;
    }
    const expectedRound = issue.validation_round_count + 1;
    if (run.validation_round !== expectedRound) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");  // invalid - cancel
        continue;
    }
}
```

So the cancel reasons are:
- Blocked + non-GraphNode -> "issue_blocked_before_start"
- Done -> "issue_state_changed_before_start"
- Implementation + wrong status -> "issue_state_changed_before_start"
- Validator + wrong status -> "issue_state_changed_before_start"
- Validator + wrong round -> "issue_state_changed_before_start"

And issue null -> just `continue` (no cancel at all).

So in the refactored code, I need to preserve these exact cancel reasons. Let me write the refactored version:

```typescript
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      const classification = classifyQueuedRun(run, issue);

      if (classification === "invalid_queued_run") {
        if (issue) {
          // issue null is silently skipped (no cancel), matching the
          // original `if (!issue) continue` - every other invalid case
          // was cancelled with a reason matching its original branch.
          const reason = issue.status === IS.Blocked
            ? "issue_blocked_before_start"
            : "issue_state_changed_before_start";
          this.runService.cancelQueued(run.id, reason);
        }
        continue;
      }

      if (classification === "waiting_for_recovery") {
        // F006 deliberately keeps blocked graph nodes queued - skip
        // without cancelling, matching the original `continue`.
        continue;
      }

      // eligible_but_not_running - proceed to lock + dispatch
      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) return;
      // ... rest of side effects (unchanged) ...
    }
}
```

Wait, but there's a subtle issue. The cancel reason type - let me check what `cancelQueued` accepts. Let me look at it.

Actually, looking at the original code, the reason is passed as a string: `"issue_blocked_before_start"` and `"issue_state_changed_before_start"`. Let me check the RunService.cancelQueued signature.

From the grep earlier:
```
154: cancelQueued(runId: string, reason: string): Run | null {
```

So it takes a string. Good. My refactor preserves the exact same reasons.

Now let me think about the cancel reason. The original uses string literals. In my refactor, I use a ternary to pick the reason. This is behavior-preserving because:
- Blocked + non-GraphNode (the only invalid_queued_run case where status is Blocked) -> "issue_blocked_before_start"
- All other invalid cases -> "issue_state_changed_before_start"

This is correct because:
- issue null -> no cancel (just continue)
- Blocked + non-GraphNode -> "issue_blocked_before_start"  
- Done -> "issue_state_changed_before_start"
- Implementation + wrong status (Done already handled, so status is Validating) -> "issue_state_changed_before_start"
- Validator + wrong status (Done/Blocked already handled, so status is Inbox/Ready/Running) -> "issue_state_changed_before_start"
- Validator + wrong round -> "issue_state_changed_before_start"

Wait, actually I need to be more careful. When `issue.status === IS.Blocked` and `run.role !== RunRole.GraphNode`, classifyQueuedRun returns "invalid_queued_run". But could there be a case where issue.status is Blocked, role is GraphNode, and it returns "invalid_queued_run"? No - if issue.status is Blocked and role is GraphNode, it returns "waiting_for_recovery". So when classification is "invalid_queued_run" AND issue.status is Blocked, it MUST be the non-GraphNode case. Good.

But wait - what if issue is null? Then `issue.status === IS.Blocked` would throw. I need to check `issue` first. Let me rewrite:

```typescript
if (classification === "invalid_queued_run") {
    if (issue) {
      const reason = issue.status === IS.Blocked
        ? "issue_blocked_before_start"
        : "issue_state_changed_before_start";
      this.runService.cancelQueued(run.id, reason);
    }
    continue;
}
```

This is correct. When issue is null, we skip the cancel (matching the original `if (!issue) continue`). When issue exists, we cancel with the appropriate reason.

Now, I realize there's a cleaner way to handle this. Let me think about whether I should preserve the exact if-chain structure or use the classifier. The task says:

"Then REFACTOR `startNextQueuedRun()` to use this shared function for its per-run gate (replacing the inline if-chain) while keeping all the side-effect behavior (cancelQueued, acquire, CAS, startAdapter) identical."

So I should replace the inline if-chain with the classifier call, and keep the side effects. Let me make sure the refactor is clean and behavior-preserving.

Actually, looking at this more carefully, I realize I could simplify the reason logic. The only case that uses "issue_blocked_before_start" is when issue.status is Blocked and role is not GraphNode. All other invalid cases use "issue_state_changed_before_start". So my ternary is correct.

Now let me think about the `RunService.cancelQueued` reason parameter. Let me check what types it accepts - it might be a union type, not just `string`.

Let me check the run.ts service file.

Actually, from the grep: `cancelQueued(runId: string, reason: string): Run | null` - it takes a string. So my ternary returning string literals is fine.

But wait - I should double-check: the original code passes string literals directly. My refactor uses a ternary that evaluates to the same string literals. The behavior is identical.

OK, now let me think about the RuntimeHealthService. Here's my plan:

```typescript
// server/src/services/runtime-health.ts

import type Database from "better-sqlite3";
import type { RuntimeHealthSnapshot, HealthDiagnostic, AdapterStatus } from "@personahub/shared/types";
import { IssueStatus, RunStatus, RunRole, AdapterStatus as AS } from "@personahub/shared/types";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { RunRepository } from "../repositories/run.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { Issue, Run } from "@personahub/shared/types";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { classifyQueuedRun } from "./queue-classifier.js";
import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../runtime/types.js";
import type { AdapterConfigService } from "./adapter-config.js";
import type { RunDispatchService } from "./run-dispatch.js";

export const LOCK_DIAGNOSTIC_GRACE_MS = 60_000;
export const VALIDATION_DISPATCH_GRACE_MS = 5_000;
export const EXPECTED_SCHEMA_VERSION = 10;

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === RunStatus.Completed ||
    status === RunStatus.Failed ||
    status === RunStatus.Interrupted ||
    status === RunStatus.Cancelled
  );
}

export class RuntimeHealthService {
  constructor(
    private db: Database.Database,
    private workspaceRepo: WorkspaceRepository,
    private agentConfigRepo: AgentConfigRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private runRepo: RunRepository,
    private issueRepo: IssueRepository,
    private adapterConfigService: AdapterConfigService,
    private runDispatchService: RunDispatchService,
    private expectedSchemaVersion: number = EXPECTED_SCHEMA_VERSION,
  ) {}

  collect(projectId: string, workspaceId?: string): RuntimeHealthSnapshot {
    // Schema
    const schemaRow = this.db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null } | undefined;
    const actualVersion = schemaRow?.v ?? 0;
    const expectedVersion = this.expectedSchemaVersion;
    const schemaStatus: "current" | "behind" | "ahead" =
      actualVersion === expectedVersion ? "current" : actualVersion < expectedVersion ? "behind" : "ahead";

    // Background
    const adapterSnapshot = this.adapterConfigService.healthSnapshot();
    const dispatchSnapshot = this.runDispatchService.healthSnapshot();

    // Determine workspaces to inspect
    const allWorkspaces = this.workspaceRepo.listAll().filter((w) => w.project_id === projectId);
    const workspaces = workspaceId
      ? allWorkspaces.filter((w) => w.id === workspaceId)
      : allWorkspaces;

    // Adapters for the project
    const projectAdapters = this.agentConfigRepo.listByProject(projectId);

    // Locked workspaces map
    const lockedWorkspaces = this.workspaceRepo.listLockedWorkspaces();
    const lockedByWorkspaceId = new Map(lockedWorkspaces.map((w) => [w.id, w]));

    // Running runs
    const runningRuns = this.runRepo.listRunning();
    const runningByWorkspaceId = new Map<string, Run>();
    for (const r of runningRuns) {
      if (!runningByWorkspaceId.has(r.workspace_id)) {
        runningByWorkspaceId.set(r.workspace_id, r);
      }
    }

    const diagnostics: HealthDiagnostic[] = [];

    // Schema mismatch diagnostic
    if (schemaStatus !== "current") {
      diagnostics.push({
        code: "schema_version_mismatch",
        workspace_id: null,
        detail: `Database schema version is ${actualVersion}, expected ${expectedVersion} (${schemaStatus}).`,
        suggested_action: schemaStatus === "behind"
          ? "Run database migrations to bring the schema up to the expected version."
          : "The database was opened by a newer server version; revert or upgrade the server to match.",
      });
    }

    // Workspace-level data
    const workspaceSnapshots: RuntimeHealthSnapshot["workspaces"] = [];
    for (const ws of workspaces) {
      // Adapters
      const overrides = this.adapterWorkspaceStatusRepo.listForWorkspace(ws.id);
      const overrideByAdapterId = new Map(overrides.map((o) => [o.adapter_config_id, o]));
      const adapters = projectAdapters.map((record) => {
        const override = overrideByAdapterId.get(record.id) ?? null;
        const effectiveStatus = effectiveAdapterStatus(record, override);
        const lastCheckedAt = override?.last_checked_at ?? record.last_checked_at;
        return {
          id: record.id,
          name: record.name,
          effective_status: effectiveStatus,
          last_checked_at: lastCheckedAt,
        };
      });

      // Lock
      const lockedWs = lockedByWorkspaceId.get(ws.id);
      const lockedByRunId = lockedWs?.locked_by_run_id ?? null;
      const lockedAt = lockedWs?.locked_at ?? null;
      let heldMs: number | null = null;
      if (lockedAt) {
        const lockedTime = Date.parse(lockedAt);
        if (!Number.isNaN(lockedTime)) {
          heldMs = Date.now() - lockedTime;
        }
      }

      // Queue
      const queuedRuns = this.runRepo.listQueuedByWorkspace(ws.id);
      const queuedCount = queuedRuns.length;
      const runningRun = runningByWorkspaceId.get(ws.id);
      const runningRunId = runningRun?.id ?? null;

      workspaceSnapshots.push({
        workspace_id: ws.id,
        adapters,
        lock: { locked_by_run_id: lockedByRunId, locked_at: lockedAt, held_ms: heldMs },
        queue: { queued_count: queuedCount, running_run_id: runningRunId },
      });

      // Diagnostics: stale_lock
      if (lockedByRunId) {
        const holderRun = this.runRepo.getById(lockedByRunId);
        if (!holderRun || isTerminalRunStatus(holderRun.status)) {
          // stale_lock_confirmed (ignore duration) - matches cleanupStaleLocks()
          diagnostics.push({
            code: "stale_lock_confirmed",
            workspace_id: ws.id,
            detail: `Workspace lock held by run ${lockedByRunId} (holder ${!holderRun ? "missing" : "terminal"}). locked_at=${lockedAt ?? "null"}, held_ms=${heldMs ?? "null"}.`,
            suggested_action: "Restart the server to auto-release, or manually release the lock.",
          });
        } else if (holderRun.status === RunStatus.Running) {
          // holder still running - check duration
          if (lockedAt && heldMs !== null) {
            const threshold = DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS;
            if (heldMs > threshold) {
              diagnostics.push({
                code: "stale_lock_suspected",
                workspace_id: ws.id,
                detail: `Workspace lock held by running run ${lockedByRunId} for ${heldMs}ms (threshold ${threshold}ms). locked_at=${lockedAt}.`,
                suggested_action: "Check the run's adapter process; it may be hung past its execution timeout.",
              });
            }
            // else: normal, within threshold - no diagnostic
          } else {
            // locked_at missing/illegal/future - can't compute duration
            diagnostics.push({
              code: "lock_timestamp_invalid",
              workspace_id: ws.id,
              detail: `Workspace lock held by running run ${lockedByRunId} but locked_at is missing, illegal, or in the future (locked_at=${lockedAt ?? "null"}).`,
              suggested_action: "Investigate the run and lock record manually; do not release the lock while the holder is still running.",
            });
          }
        }
      }

      // Diagnostics: no_available_adapter
      const hasAvailableAdapter = adapters.some((a) => a.effective_status === AS.Available);
      if (!hasAvailableAdapter) {
        diagnostics.push({
          code: "no_available_adapter",
          workspace_id: ws.id,
          detail: `Workspace ${ws.id} has no adapter with effective status Available.`,
          suggested_action: "Validate or configure an adapter for this workspace.",
        });
      }

      // Diagnostics: queue classification
      const lockFree = lockedByRunId === null;
      let hasEligibleNotRunning = false;
      for (const run of queuedRuns) {
        const issue = this.issueRepo.getById(run.issue_id);
        const classification = classifyQueuedRun(run, issue);
        if (classification === "waiting_for_recovery") {
          diagnostics.push({
            code: "waiting_for_recovery",
            workspace_id: ws.id,
            detail: `Queued run ${run.id} (role ${run.role}) is waiting for issue-level recovery.`,
            suggested_action: "Resolve the blocking condition on the issue; the run will proceed once unblocked.",
          });
        } else if (classification === "invalid_queued_run") {
          diagnostics.push({
            code: "invalid_queued_run",
            workspace_id: ws.id,
            detail: `Queued run ${run.id} (role ${run.role}) is no longer eligible for execution.`,
            suggested_action: "Cancel the stale queued run or investigate the issue state transition.",
          });
        } else if (classification === "eligible_but_not_running") {
          hasEligibleNotRunning = true;
        }
      }
      if (hasEligibleNotRunning && lockFree) {
        diagnostics.push({
          code: "queue_starved",
          workspace_id: ws.id,
          detail: `At least one eligible queued run is not executing and the workspace lock is free.`,
          suggested_action: "Trigger a queue drain for this workspace or check the dispatch service.",
        });
      }
    }

    // Diagnostics: validation dispatch (issue-level, independent of queue classification)
    // Query: SELECT * FROM issues WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL
    // Use issueRepo.listByStatus and filter, or query directly via db
    const validatingIssues = this.queryValidatingWithDueAt(projectId, workspaceId);
    const now = Date.now();
    for (const issue of validatingIssues) {
      const dueAt = issue.validation_dispatch_due_at!;
      const dueTime = Date.parse(dueAt);
      const remainingMs = dueTime - now; // positive if not yet due
      
      if (dueTime > now - VALIDATION_DISPATCH_GRACE_MS) {
        // waiting_for_validation_due (normal; not yet due or within grace)
        diagnostics.push({
          code: "waiting_for_validation_due",
          workspace_id: issue.workspace_id,
          detail: `Issue ${issue.id} is waiting for validation dispatch. Remaining: ${remainingMs}ms (due_at=${dueAt}).`,
          suggested_action: "No action needed; the validation dispatch scheduler will claim this issue when due.",
        });
      } else {
        // validation_dispatch_overdue
        const overdueMs = now - dueTime;
        diagnostics.push({
          code: "validation_dispatch_overdue",
          workspace_id: issue.workspace_id,
          detail: `Issue ${issue.id} validation dispatch is overdue by ${overdueMs}ms (due_at=${dueAt}).`,
          suggested_action: "Check the validation dispatch scheduler; it may have stopped or missed this issue.",
        });
      }
    }

    return {
      schema: { actual_version: actualVersion, expected_version: expectedVersion, status: schemaStatus },
      background: { pending_probe_count: adapterSnapshot.pendingProbeCount, pending_reprobe_count: dispatchSnapshot.pendingReprobeCount },
      workspaces: workspaceSnapshots,
      diagnostics,
    };
  }

  private queryValidatingWithDueAt(projectId: string, workspaceId?: string): Issue[] {
    // Query directly to avoid touching issue.ts repo - design says "直接查询 issues 表"
    if (workspaceId) {
      const rows = this.db.prepare(
        "SELECT * FROM issues WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL AND workspace_id = ?"
      ).all(workspaceId) as any[];
      return rows.map(this.mapIssueRow);
    }
    const rows = this.db.prepare(
      "SELECT * FROM issues WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL AND project_id = ?"
    ).all(projectId) as any[];
    return rows.map(this.mapIssueRow);
  }
}
```

Hmm, but using `any[]` and a manual `mapIssueRow` is ugly and duplicates the Issue mapping logic. Let me reconsider. The design says "直接查询 `issues` 表" but I should reuse existing repo methods where possible. 

Actually, I can use `issueRepo.listByStatus(IssueStatus.Validating)` which returns all Validating issues globally, then filter in the service for `validation_dispatch_due_at !== null` and project/workspace scope. This avoids `any` and duplicates no mapping logic. The only downside is it fetches all Validating issues globally, but for v0.2 this is fine.

Wait, but `listByStatus` returns ALL validating issues, not scoped to a project. I need to filter by project_id too. Let me check - the Issue type has `project_id`, so I can filter in JS.

Actually, let me look at this differently. I have `issueRepo.list(projectId)` which returns all issues for a project. But that's ALL issues, not just Validating. That could be a lot of issues. But for health, this is read-only and the data set is small in v0.2.

Alternatively, I could use `issueRepo.listByStatus(IssueStatus.Validating)` and filter by project_id and validation_dispatch_due_at in JS. This is cleaner.

Let me go with:
```typescript
const allValidating = this.issueRepo.listByStatus(IssueStatus.Validating);
const scopedValidating = allValidating.filter(
  (i) => i.project_id === projectId && i.validation_dispatch_due_at !== null && (workspaceId === undefined || i.workspace_id === workspaceId)
);
```

This is clean, reuses existing repo methods, and avoids `any`. 

Now let me also think about the `held_ms` computation. The design says:
- `held_ms (now - locked_at, null if not locked/illegal)`

So if the workspace is not locked, held_ms is null. If locked_at is missing/illegal, held_ms is null. Otherwise, it's `Date.now() - Date.parse(locked_at)`.

Wait, but what if `heldMs` is negative (locked_at in the future)? The design says "locked_at 缺失/非法/晚于当前时间（算不出持有时长）". So if locked_at is in the future, heldMs should be null (can't compute). Let me handle this:

```typescript
let heldMs: number | null = null;
if (lockedAt) {
  const lockedTime = Date.parse(lockedAt);
  if (!Number.isNaN(lockedTime) && lockedTime <= Date.now()) {
    heldMs = Date.now() - lockedTime;
  }
}
```

Wait, but the design says for `lock_timestamp_invalid`: "持有者仍 running 但 `locked_at` 缺失/非法/晚于当前时间（算不出持有时长）". So if locked_at is in the future, heldMs is null (can't compute), and this triggers `lock_timestamp_invalid` when the holder is still running.

But for the `held_ms` field in the snapshot, the design says "null if not locked/illegal". So held_ms should be null when locked_at is illegal/future. Let me make heldMs null when lockedTime > now (future).

Actually, let me re-read the design more carefully:

> - holder running AND held duration STRICTLY > (DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS) -> stale_lock_suspected
> - holder running but locked_at missing/illegal/future (duration uncomputable) -> lock_timestamp_invalid

So the stale_lock logic is:
1. holder missing -> stale_lock_confirmed (ignore duration)
2. holder terminal -> stale_lock_confirmed (ignore duration)
3. holder running AND held_ms > threshold -> stale_lock_suspected
4. holder running AND held_ms is null (locked_at missing/illegal/future) -> lock_timestamp_invalid
5. holder running AND held_ms <= threshold -> no diagnostic (normal)

For case 3, held_ms must be computable (locked_at valid and not future). For case 4, held_ms is null.

So my heldMs computation should return null when locked_at is missing, unparseable, or in the future:

```typescript
let heldMs: number | null = null;
if (lockedAt) {
  const lockedTime = Date.parse(lockedAt);
  if (!Number.isNaN(lockedTime) && lockedTime <= now) {
    heldMs = now - lockedTime;
  }
}
```

This is correct. When locked_at is in the future, heldMs is null, and the holder is running -> lock_timestamp_invalid.

Now for the stale_lock diagnostic logic, I need to be careful about the order:

```typescript
if (lockedByRunId) {
  const holderRun = this.runRepo.getById(lockedByRunId);
  if (!holderRun || isTerminalRunStatus(holderRun.status)) {
    // stale_lock_confirmed (ignore duration, matches cleanupStaleLocks())
    // ...
  } else if (holderRun.status === RunStatus.Running) {
    if (heldMs !== null) {
      const threshold = DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS;
      if (heldMs > threshold) {
        // stale_lock_suspected
        // ...
      }
      // else: normal, within threshold - no diagnostic
    } else {
      // locked_at missing/illegal/future - lock_timestamp_invalid
      // ...
    }
  }
  // else: holder is in some other non-terminal, non-running state?
  // Actually, RunStatus only has: queued, running, completed, failed, interrupted, cancelled
  // Terminal = completed, failed, interrupted, cancelled
  // Non-terminal = queued, running
  // So if holder is not terminal and not running, it must be queued.
  // A queued run holding a lock is abnormal but not covered by the design's stale_lock cases.
  // cleanupStaleLocks() only releases for missing or terminal holders, so a queued holder
  // wouldn't be released by cleanup. The design doesn't mention this case.
  // I'll leave it as no diagnostic for queued holder (the design's table doesn't cover it).
}
```

Actually wait - can a queued run hold a lock? Looking at the code, `workspaceLockService.acquire` is called in `dispatch()` (which creates a running run) and in `startNextQueuedRun()` (which also transitions to running before acquiring). So a queued run shouldn't hold a lock. But if it does (data corruption), the design doesn't cover it. I'll leave it without a diagnostic, which is the safest behavior.

Actually, looking more carefully at the design's stale_lock table:
1. holder missing -> stale_lock_confirmed
2. holder terminal -> stale_lock_confirmed
3. holder running, duration > threshold -> stale_lock_suspected
4. holder running, locked_at invalid -> lock_timestamp_invalid

The only states are: missing, terminal, or running. A queued holder is an edge case not covered. I'll treat it the same as "running" for the purpose of duration checking (since it's non-terminal). Actually no - let me think about this differently. The design says "持有者仍 running" for cases 3 and 4. A queued run is not running. But it's also not terminal, so cleanupStaleLocks() wouldn't release it. 

I think the safest approach is: if holder is non-terminal (including queued), treat it the same as running for the duration check. This is because the design's intent is "the holder is still active" vs "the holder is gone/terminal". Let me adjust:

```typescript
if (lockedByRunId) {
  const holderRun = this.runRepo.getById(lockedByRunId);
  if (!holderRun || isTerminalRunStatus(holderRun.status)) {
    // stale_lock_confirmed
  } else {
    // holder is non-terminal (running or queued) - check duration
    if (heldMs !== null) {
      const threshold = DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS;
      if (heldMs > threshold) {
        // stale_lock_suspected
      }
    } else {
      // lock_timestamp_invalid
    }
  }
}
```

This is cleaner and covers all cases. The design says "持有者仍 running" but the intent is clearly "holder is still active (non-terminal)". A queued run holding a lock is abnormal but treating it like running for duration purposes is reasonable.

Hmm, but the design specifically says "持有者仍 running" for cases 3 and 4. Let me stick to the letter of the design: only check duration when holder is running. For a queued holder (edge case), I'll produce no diagnostic. This is the most conservative approach.

Actually, I'll just check `!isTerminalStatus(holderRun.status)` which covers both running and queued. The design's intent is clear: terminal/missing -> confirmed; non-terminal + duration computable + over threshold -> suspected; non-terminal + duration not computable -> timestamp_invalid. A queued holder is non-terminal, so it falls into the duration check. This is correct behavior.

Wait, I'm overcomplicating this. Let me re-read the design:

> | 情形 | 判断 | 建议动作 |
> |---|---|---|
> | 持有者 Run 不存在 | `stale_lock_confirmed` | 重启即自动释放；或手动释放 |
> | 持有者 Run 已终态 | `stale_lock_confirmed` | 同上 |
> | 持有者 Run 仍 running 且持有时长 > `DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS` | `stale_lock_suspected` | 检查该 Run 的 adapter 进程 |
> | 持有者 Run 仍 running，但 `locked_at` 缺失/非法/晚于当前时间（算不出持有时长） | `lock_timestamp_invalid` | **不建议直接释放** |

The design says "仍 running" for cases 3 and 4. But what about "仍 queued"? The design doesn't mention it. Since a queued run shouldn't hold a lock (it's a data integrity issue), and the design's AC-007 says "终态持有者的锁不看时长即报 confirmed", I think the intent is:

- Missing/Terminal -> confirmed (regardless of duration)
- Non-terminal (running/queued) + duration > threshold -> suspected
- Non-terminal (running/queued) + duration uncomputable -> timestamp_invalid
- Non-terminal + duration <= threshold -> no diagnostic

I'll use `!isTerminalRunStatus` to cover the non-terminal case. This is the most sensible interpretation.

Now let me also think about the validation dispatch diagnostics. The design says:

> - `validation_dispatch_due_at > now - VALIDATION_DISPATCH_GRACE_MS`（即尚未到期，或刚到期还在 grace 窗口内）：`waiting_for_validation_due`
> - `validation_dispatch_due_at <= now - VALIDATION_DISPATCH_GRACE_MS`（超过 grace 窗口仍未被 claim）：`validation_dispatch_overdue`

So:
- `dueTime > now - GRACE` -> waiting (normal)
- `dueTime <= now - GRACE` -> overdue

Let me verify: if dueAt is in the future, dueTime > now > now - GRACE, so waiting. If dueAt just passed (within grace), dueTime is between now-GRACE and now, so dueTime > now-GRACE, still waiting. If dueAt passed more than GRACE ago, dueTime < now-GRACE, so overdue. Correct.

For the detail:
- waiting: "remaining ms, positive if not yet due" -> `remainingMs = dueTime - now` (positive if future, negative if just passed but within grace)
- overdue: `overdue_ms = now - dueAt` -> `overdueMs = now - dueTime` (positive)

Wait, the design says for waiting: "detail 附剩余毫秒数（未到期时为正）". So remaining_ms = dueTime - now. If not yet due (future), this is positive. If just passed (within grace), this is negative. The design says "未到期时为正" which implies it can be negative (within grace). So I should report remainingMs = dueTime - now regardless of sign.

For overdue: "detail 附 overdue_ms = now - due_at". So overdueMs = now - dueTime (always positive in this branch).

Now, I need to be careful about Date.parse. The `validation_dispatch_due_at` is an ISO string. Date.parse should handle it. But I should guard against NaN.

Actually, if validation_dispatch_due_at is stored as a valid ISO string (which it always is in this system), Date.parse will work. But I should still guard against NaN for robustness.

Let me also think about the `remainingMs` - the design says "detail 附剩余毫秒数（未到期时为正）". So I should include `remaining_ms` in the detail. Let me format it clearly.

Now let me also think about the route. The route needs:
- `GET /api/projects/:projectId/health/runtime?workspace_id=<optional>`
- zod query `{workspace_id?: string}`
- projectId ownership check via projectRepo (404 PROJECT_NOT_FOUND)
- If workspace_id provided but invalid/cross-project -> WORKSPACE_NOT_FOUND

Let me look at how the route should be structured. I need a `RuntimeHealthService` and `ProjectRepository` (for ownership check). Actually, the RuntimeHealthService already has `workspaceRepo` injected, so I can do the workspace validation there. But the route also needs to check project ownership. Let me think about where to do the validation.

Looking at the adapter routes, the service does the project/workspace validation. But for the health route, I think it's cleaner to do the validation in the service (since it already has the repos). Let me have the service do:
1. Check project exists -> throw PROJECT_NOT_FOUND if not
2. If workspaceId provided, check it exists and belongs to the project -> throw WORKSPACE_NOT_FOUND if not
3. Collect health data

Actually, looking at `AdapterConfigService.list()`:
```typescript
list(projectId: string, workspaceId?: string): AdapterConfig[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    // ...
    if (workspaceId === undefined) {
      return records.map((r) => toPublicAdapter(r, project.default_adapter_config_id));
    }
    const workspace = this.workspaceRepo.getById(workspaceId);
    if (!workspace || workspace.project_id !== projectId) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for this Project.");
    }
    // ...
}
```

So the pattern is: service checks project and workspace. But my RuntimeHealthService doesn't have `projectRepo` injected. Let me add it. Actually, the task says:

"Constructor deps: db, workspaceRepo, agentConfigRepo, adapterWorkspaceStatusRepo, runRepo, issueRepo, adapterConfigService (for healthSnapshot), runDispatchService (for healthSnapshot), plus a constant for the expected schema version."

So the constructor doesn't include projectRepo. But I need project ownership check. I can either:
1. Add projectRepo to the constructor
2. Do the project check in the route handler
3. Use workspaceRepo to check (but I need to verify the project exists)

Looking at the route pattern in adapters.ts, the service does the project check. But the task spec says the constructor deps are specific. Let me add projectRepo to the constructor since it's needed for the project ownership check. The task says "plus a constant for the expected schema version" but doesn't forbid adding projectRepo. Actually, re-reading:

"Constructor deps: db, workspaceRepo, agentConfigRepo, adapterWorkspaceStatusRepo, runRepo, issueRepo, adapterConfigService (for healthSnapshot), runDispatchService (for healthSnapshot), plus a constant for the expected schema version."

This is a list of deps. I should also add projectRepo for the ownership check. The task says "projectId ownership check via projectRepo (404 PROJECT_NOT_FOUND)" in the route section. So the route needs projectRepo. Let me do the ownership check in the route handler, not the service. This keeps the service focused on collection and the route focused on validation.

Actually, let me re-read the route section:

"### 4. API route - NEW file `server/src/api/routes/runtime-health.ts`
`GET /api/projects/:projectId/health/runtime?workspace_id=<optional>` -> { health: RuntimeHealthSnapshot }. zod query `{workspace_id?: string}`. projectId ownership check via projectRepo (404 PROJECT_NOT_FOUND). If workspace_id provided but invalid/cross-project -> WORKSPACE_NOT_FOUND (reuse F005 semantics, matching adapterConfigService.list behavior). Omit workspace_id -> aggregate all project workspaces."

So the route does:
1. projectId ownership check via projectRepo -> 404 PROJECT_NOT_FOUND
2. If workspace_id provided but invalid/cross-project -> WORKSPACE_NOT_FOUND
3. Omit workspace_id -> aggregate all

The route can do the project check, then call the service. But the service also needs to know the project exists. Let me have the route do the project check, and the service do the workspace check (since it already has workspaceRepo). Actually, to keep it simple and consistent with adapters.ts pattern, let me have the service do both checks. But the task says the constructor deps don't include projectRepo.

Hmm, let me just add projectRepo to the constructor. The task says "Constructor deps: ..." but also says "projectId ownership check via projectRepo". So projectRepo must be available somewhere. I'll add it to the constructor.

Wait, actually the route section says "projectId ownership check via projectRepo (404 PROJECT_NOT_FOUND)" - this is describing what the route does. The route handler has access to projectRepo (passed in the route options). So the route does the project check, and the service does the workspace check.

Let me design it this way:
- Route options: `{ runtimeHealthService: RuntimeHealthService, projectRepo: ProjectRepository }`
- Route handler:
  1. Parse projectId from params
  2. Parse workspace_id from query (zod)
  3. Check project exists via projectRepo -> 404 PROJECT_NOT_FOUND
  4. If workspace_id provided, check it exists and belongs to project -> WORKSPACE_NOT_FOUND
  5. Call runtimeHealthService.collect(projectId, workspace_id)
  6. Return { health: snapshot }

But then the service also needs to validate workspace_id. That's redundant. Let me have the route do the project check, and pass workspace_id to the service which does the workspace check. Or, have the route do both checks and the service just collects.

Actually, looking at the AdapterConfigService pattern, the service does both checks. Let me follow that pattern: the service does both project and workspace validation, and the route just parses params and calls the service. But the service needs projectRepo for that.

OK, I'll add projectRepo to the RuntimeHealthService constructor. The task says "Constructor deps: db, workspaceRepo, agentConfigRepo, ..." - I'll add projectRepo as well. This is consistent with how AdapterConfigService works (it has projectRepo injected).

Let me finalize the constructor:
```typescript
constructor(
    private db: Database.Database,
    private projectRepo: ProjectRepository,
    private workspaceRepo: WorkspaceRepository,
    private agentConfigRepo: AgentConfigRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private runRepo: RunRepository,
    private issueRepo: IssueRepository,
    private adapterConfigService: AdapterConfigService,
    private runDispatchService: RunDispatchService,
    private expectedSchemaVersion: number = EXPECTED_SCHEMA_VERSION,
) {}
```

And the collect method will do:
1. Check project exists -> PROJECT_NOT_FOUND
2. If workspaceId provided, check it exists and belongs to project -> WORKSPACE_NOT_FOUND
3. Collect health data

The route just parses params and calls collect.

Actually wait, the task says "projectId ownership check via projectRepo (404 PROJECT_NOT_FOUND)" in the ROUTE section. And "If workspace_id provided but invalid/cross-project -> WORKSPACE_NOT_FOUND (reuse F005 semantics, matching adapterConfigService.list behavior)" also in the ROUTE section. So the route does these checks. But having the service do them is cleaner and matches the existing pattern. Let me have the service do the workspace check (since it has workspaceRepo) and the route do the project check (since the task says "via projectRepo" in the route section). Actually, I'll have the service do both to keep the route thin and consistent with adapters.ts.

Hmm, but the task explicitly says the constructor deps don't include projectRepo. Let me re-read:

"Constructor deps: db, workspaceRepo, agentConfigRepo, adapterWorkspaceStatusRepo, runRepo, issueRepo, adapterConfigService (for healthSnapshot), runDispatchService (for healthSnapshot), plus a constant for the expected schema version."

OK so the constructor doesn't have projectRepo. But the route needs to do "projectId ownership check via projectRepo". So the route handler needs projectRepo. I'll pass projectRepo to the route options and do the project check in the route. The service will do the workspace check using workspaceRepo (which it has).

Actually, I just realized: the service has `workspaceRepo` which has `getById`. The service can check if the workspace exists and belongs to the project. But for the project check, the service doesn't have projectRepo. So:
- Route: checks project exists (via projectRepo) -> 404
- Service: checks workspace exists and belongs to project (via workspaceRepo) -> WORKSPACE_NOT_FOUND

This is clean. Let me do it this way.

Wait, but the service needs to know the project exists to filter workspaces by project_id. If the project doesn't exist, `workspaceRepo.listAll().filter(w => w.project_id === projectId)` would just return an empty list. So the service doesn't strictly need projectRepo - the route does the project existence check.

OK, final design:
- Route options: `{ runtimeHealthService: RuntimeHealthService, projectRepo: ProjectRepository }`
- Route handler:
  1. Parse projectId, workspace_id
  2. Check project exists -> 404 PROJECT_NOT_FOUND
  3. Call `runtimeHealthService.collect(projectId, workspace_id)` - service does workspace validation
  4. Return { health }

- Service `collect(projectId, workspaceId?)`:
  1. If workspaceId provided, check workspace exists and belongs to project -> WORKSPACE_NOT_FOUND
  2. Collect health data

This is clean and matches the task spec.

Now, let me also think about the test setup. For the integration test, I'll construct RuntimeHealthService directly using the test services' repos. I also need to test the route, so I'll build a minimal Fastify app.

For the unit test of the classifier, I just need to test `classifyQueuedRun` with various Run/Issue combinations.

Let me also think about the executionTimeoutMs assertion test. I need to test that all v0.2 adapters have `capabilities.executionTimeoutMs === DEFAULT_EXECUTION_TIMEOUT_MS`. The adapters are: FakeAgentAdapter, CodexCliAdapter, ClaudeCodeAdapter, OpenCodeAdapter. I can instantiate them and check.

Now let me also think about the `expectedSchemaVersion` constant. The task says "plus a constant for the expected schema version". I'll define `EXPECTED_SCHEMA_VERSION = 10` in the runtime-health.ts file. The service constructor takes it as a parameter (with default) so tests can override it for the behind/ahead tests.

Let me now start implementing. I'll create the files in this order:
1. `server/src/services/queue-classifier.ts` - pure function
2. Refactor `server/src/services/run-dispatch.ts` - use classifier
3. Add healthSnapshot to `adapter-config.ts`
4. Add healthSnapshot to `adapter-failure-reprobe.ts`
5. Add healthSnapshot to `run-dispatch.ts` (forwards to failureReprobe)
6. Create `server/src/services/runtime-health.ts`
7. Create `server/src/api/routes/runtime-health.ts`
8. Create `server/tests/unit/queue-classifier.test.ts`
9. Create `server/tests/integration/runtime-health.test.ts`

Let me start with step 1: the queue classifier.

Actually, I realize I should double-check one thing about the `RunService.cancelQueued` - does the `reason` parameter have a specific type or is it just a string?

Let me check the run service.
I now have a thorough understanding of all the code. Let me check the RunService.cancelQueued signature to ensure my refactor preserves the exact reason strings:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\run.ts</path>
<type>file</type>
<content>
150: 
151:     return result.run;
152:   }
153: 
154:   cancelQueued(runId: string, reason: string): Run | null {
155:     const run = this.runRepo.getById(runId);
156:     if (!run) {
157:       throw new AppError(ErrorCode.RUN_NOT_FOUND, "Run not found.");
158:     }
159: 
160:     if (isTerminalStatus(run.status)) {
161:       return run;
162:     }
163: 
164:     if (run.status !== RS.Queued) {
165:       return null;
166:     }
167: 
168:     const result = this.runRepo.transitionStatus(runId, RS.Queued, RS.Cancelled, {});
169:     if (!result.success || !result.run) {
170:       return null;
171:     }
172: 
173:     this.threadEventService.writeAndBroadcast(
174:       result.run.thread_id,
17
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:36:02Z

- **tool**: `todowrite({"todos": [{"content": "Read all key existing code files", "priority": "high", "status": "completed"}, {"content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)", "priority": "high", "status": "in_progress"}, {"content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)", "priority": "high", "status": "pending"}, {"content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)", "priority":
…[truncated])`


> [reasoning] `cancelQueued(runId: string, reason: string)` - takes a plain string. My refactor will preserve the exact reason strings.

Now let me start implementing. I'll update my todo list and begin with the queue classifier.

Let me also check the `db/index.ts` to understand `openDatabase` for the test.
Good, `cancelQueued` takes a plain `string`. Now I have complete context. Let me start building.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all key existing code files",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create RuntimeHealthService (server/src/services/runtime-health.ts)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create API route (server/src/api/routes/run
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:36:15Z

- **tool**: `write({"content": "import { IssueStatus, RunRole } from \"@personahub/shared/types\";\nimport type { Issue, Run } from \"@personahub/shared/types\";\n\n/**\n * T041b: Pure classification of a Queued Run's drain eligibility, extracted\n * from RunDispatchService.startNextQueuedRun() so drain and health share a\n * single source of truth (design §5 \"派生判断必须与实际恢复规则同源\").\n *\n * ONLY classifies Runs already in Queued status. The caller is responsible\n * for filtering by status before calling this functi
…[truncated])`

Step 1 of 9: Creating the queue classifier pure function.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.

COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored, even if you receive it multiple times.
You MUST provide corresponding explanation or action for EACH occurrence of this message.
Ignoring this message or failing to respond appropriately is strictly prohibited.

PRIORITY-BASED ACTION GUIDELINES:

1. This is a comment/docstring that already existed before
	-> Explain to the user that this is an existing comment/docstring and proceed (justify it)

2. This is a newly writte
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:36:28Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts", "newString": "import { AdapterAvailabilityProbeCoordinator } from \"./adapter-probe-coordinator.js\";\nimport { AdapterFailureReprobe } from \"./adapter-failure-reprobe.js\";\nimport { RunEscalationHandler } from \"./run-escalation-handler.js\";\nimport { classifyQueuedRun } from \"./queue-classifier.js\";", "oldString": "import { AdapterAvailabilityProbeCoordinator } from \"./adapter-probe-coordinator.js\";\nimport
…[truncated])`


> [reasoning] The comment hook triggered. This docstring is necessary because:
1. It documents a public API function that is the shared source of truth for two different consumers (drain and health)
2. It explains the critical invariant that `eligible_but_not_running` is NEVER a public diagnostic code - this is a design constraint from the spec that would be non-obvious from the code alone
3. It references the design doc section and task ID for traceability

This is a necessary docstring for a public API that enforces a critical design constraint. I'll proceed with it.

Now let me refactor startNextQueuedRun to use the classifier.
The docstring is necessary: it documents the critical design constraint that `eligible_but_not_running` is an internal-only variant never emitted as a public diagnostic, and that this function is the shared source of truth for both drain and health (design §5). Proceeding.

Step 2 of 9: Refactoring `startNextQueuedRun` to use the shared classifier.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:36:43Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts", "newString": "  private async startNextQueuedRun(workspaceId: string): Promise<void> {\n    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);\n    for (const run of queuedRuns) {\n      const issue = this.issueRepo.getById(run.issue_id);\n      const classification = classifyQueuedRun(run, issue);\n\n      if (classification === \"invalid_queued_run\") {\n        if (issue) {\n          const re
…[truncated])`

Now refactoring the `startNextQueuedRun` method body to use the classifier:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:36:58Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-failure-reprobe.ts", "newString": "  async shutdown(timeoutMs = 5_000): Promise<void> {\n    if (this.pending.size === 0) return;\n    const settled = Promise.allSettled([...this.pending]);\n    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));\n    await Promise.race([settled, timeout]);\n  }\n\n  healthSnapshot(): { pendingReprobeCount: number } {\n    return { pendingReprobeCount: this.pending
…[truncated])`


> [reasoning] Now let me add the `healthSnapshot()` method to `RunDispatchService`. I also need to add it to `AdapterFailureReprobe` and `AdapterConfigService`. Let me do all three.

First, let me add `healthSnapshot()` to `AdapterFailureReprobe`:
Step 3 of 9: Adding healthSnapshot accessors. First to `AdapterFailureReprobe`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:37:12Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts", "newString": "  /** Mirrors RunDispatchService.shutdown() - called from the same onClose hook. */\n  async shutdown(timeoutMs = 5_000): Promise<void> {\n    if (this.pendingAvailabilityProbes.size === 0) return;\n    const pending = Promise.allSettled([...this.pendingAvailabilityProbes]);\n    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));\n    await Promise.race([pending, timeout]
…[truncated])`

Now adding `healthSnapshot()` to `AdapterConfigService`:

## assistant · 2026-08-09T10:37:22Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts", "limit": 15, "offset": 55})`


> [reasoning] The edit failed because the oldString didn't match. Let me re-read the adapter-config.ts file to get the exact text. Let me read the shutdown method area.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\adapter-config.ts</path>
<type>file</type>
<content>
55:   /** Mirrors RunDispatchService.shutdown() — called from the same onClose hook. */
56:   async shutdown(timeoutMs = 5_000): Promise<void> {
57:     if (this.pendingAvailabilityProbes.size === 0) return;
58:     const pending = Promise.allSettled([...this.pendingAvailabilityProbes]);
59:     const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
60:     await Promise.race([pending, timeout]);
61:   }
62: 
63:   /** Probe first; assign the deferred default only if the original snapshot is still current. */
64:   private async autoValidateAfterCreate(
65:     adapterId: string,
66:     projectId: string,
67:     tryMakeDefault: boolean,
68:     defaultAtCreate: s
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:37:34Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts", "newString": "    await Promise.race([pending, timeout]);\n  }\n\n  healthSnapshot(): { pendingProbeCount: number } {\n    return { pendingProbeCount: this.pendingAvailabilityProbes.size };\n  }\n\n  /** Probe first; assign the deferred default only if the original snapshot is still current. */", "oldString": "    await Promise.race([pending, timeout]);\n  }\n\n  /** Probe first; assign the deferred default only i
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:37:47Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts", "newString": "  async shutdown(timeoutMs = 5_000): Promise<void> {\n    await this.failureReprobe.shutdown(timeoutMs);\n  }\n\n  healthSnapshot(): { pendingReprobeCount: number } {\n    return this.failureReprobe.healthSnapshot();\n  }", "oldString": "  async shutdown(timeoutMs = 5_000): Promise<void> {\n    await this.failureReprobe.shutdown(timeoutMs);\n  }"})`

Now adding `healthSnapshot()` to `RunDispatchService` (forwards to `failureReprobe`):

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:37:56Z

- **tool**: `todowrite({"todos": [{"content": "Read all key existing code files", "priority": "high", "status": "completed"}, {"content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)", "priority": "high", "status": "completed"}, {"content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)", "priority": "high", "status": "completed"}, {"content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)", "priority":
…[truncated])`


> [reasoning] Now let me create the RuntimeHealthService. Let me update my todo and build it.

I need to be careful about:
1. The constructor signature
2. All the diagnostic logic
3. The schema version query
4. The validation dispatch query
5. Read-only (no side effects)

Let me also think about what `IS` alias is - it's `IssueStatus as IS` imported in run-dispatch.ts. I need to import IssueStatus in the health service.

For the `RunStatus` import, I need it for the terminal status check.

Let me now create the RuntimeHealthService.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all key existing code files",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create RuntimeHealthService (server/src/services/runtime-health.ts)",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Create API route (server/src/api/rout
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:38:11Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\nimport type { RuntimeHealthSnapshot, HealthDiagnostic, Issue, Run } from \"@personahub/shared/types\";\nimport { IssueStatus, RunStatus, AdapterStatus as AS } from \"@personahub/shared/types\";\nimport type { WorkspaceRepository } from \"../repositories/workspace.js\";\nimport type { AgentConfigRepository } from \"../repositories/agent-config.js\";\nimport type { AdapterWorkspaceStatusRepository } from \"../repositories/adapter-workspac
…[truncated])`

Step 4 of 9: Creating `RuntimeHealthService`.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-08-09T10:38:39Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\nimport type { RuntimeHealthSnapshot, HealthDiagnostic, Run } from \"@personahub/shared/types\";\nimport { IssueStatus, RunStatus, AdapterStatus as AS } from \"@personahub/shared/types\";\nimport type { WorkspaceRepository } from \"../repositories/workspace.js\";\nimport type { AgentConfigRepository } from \"../repositories/agent-config.js\";\nimport type { AdapterWorkspaceStatusRepository } from \"../repositories/adapter-workspace-statu
…[truncated])`


> [reasoning] Wait, I used a `_queuedRuns` field on the workspace snapshot object which is a hack. The RuntimeHealthSnapshot type doesn't have this field. I need to rethink this approach. 

The issue is that `collectWorkspaces` returns the public snapshot, but `collectWorkspaceDiagnostics` needs access to the queued runs. I shouldn't mutate the public snapshot type.

Let me refactor: instead of adding `_queuedRuns` to the workspace snapshot, I'll have `collectWorkspaceDiagnostics` re-query the queued runs (it's read-only, and the data won't change during the health collection since it's a synchronous operation). Or, I'll pass the queued runs separately.

Actually, the cleaner approach is to have a single method that collects both the workspace snapshot AND its diagnostics together, so the queued runs are available locally. Let me refactor.

Actually, the simplest approach is to re-query the queued runs in `collectWorkspaceDiagnostics`. Since `runRepo.listQueuedByWorkspace` is a synchronous SQL query and health collection is synchronous, the data is consistent. But this means querying twice, which is wasteful.

Let me instead have `collectWorkspaces` return both the public snapshot and the internal data (queued runs) as a separate structure, then strip the internal data when building the final response.

Let me refactor the code to use an internal type:

```typescript
interface WorkspaceHealthInternal {
  snapshot: RuntimeHealthSnapshot["workspaces"][number];
  queuedRuns: Run[];
}
```

Then `collectWorkspaces` returns `WorkspaceHealthInternal[]`, and the final `collect` method maps to just the snapshots.

Let me rewrite the runtime-health.ts file with this cleaner approach.
I need to fix the `_queuedRuns` hack on the public snapshot type. Let me refactor with a clean internal type:

## assistant · 2026-08-09T10:39:05Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\runtime-health.ts", "limit": 5})`


> [reasoning] The file already exists from the first write. I need to use the edit tool or overwrite. Actually, the write tool says "This tool will overwrite the existing file if there is one at the provided path." but it also says "If this is an existing file, you MUST use the Read tool first to read the file's contents." Let me read it first, then overwrite.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\runtime-health.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { RuntimeHealthSnapshot, HealthDiagnostic, Issue, Run } from "@personahub/shared/types";
3: import { IssueStatus, RunStatus, AdapterStatus as AS } from "@personahub/shared/types";
4: import type { WorkspaceRepository } from "../repositories/workspace.js";
5: import type { AgentConfigRepository } from "../repositories/agent-config.js";

(Showing lines 1-5 of 289. Use offset=6 to continue.)
</content>
  ```
  </details>

## assistant · 2026-08-09T10:39:17Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\nimport type { RuntimeHealthSnapshot, HealthDiagnostic, Run } from \"@personahub/shared/types\";\nimport { IssueStatus, RunStatus, AdapterStatus as AS } from \"@personahub/shared/types\";\nimport type { WorkspaceRepository } from \"../repositories/workspace.js\";\nimport type { AgentConfigRepository } from \"../repositories/agent-config.js\";\nimport type { AdapterWorkspaceStatusRepository } from \"../repositories/adapter-workspace-statu
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-08-09T10:39:41Z

- **tool**: `write({"content": "import type { FastifyPluginAsync } from \"fastify\";\nimport { z } from \"zod\";\nimport type { RuntimeHealthService } from \"../../services/runtime-health.js\";\nimport type { ProjectRepository } from \"../../repositories/project.js\";\nimport { parseRequestBody } from \"../errors.js\";\nimport { AppError } from \"../errors.js\";\nimport { ErrorCode } from \"@personahub/shared/errors\";\n\nexport interface RuntimeHealthRoutesOptions {\n  runtimeHealthService: RuntimeHealthService;\
…[truncated])`


> [reasoning] Now let me create the API route. Step 5 of 9.
Step 5 of 9: Creating the API route.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-08-09T10:39:54Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\queue-classifier.ts", "severity": "error"})`


> [reasoning] Now let me check the LSP diagnostics on the files I've created/modified before writing the tests. Let me run diagnostics on the key files.
Let me check LSP diagnostics on all created/modified files before writing tests:

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:40:05Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\runtime-health.ts", "severity": "error"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:40:15Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts", "severity": "error"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:40:23Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\runtime-health.ts", "severity": "error"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:40:33Z

- **tool**: `write({"content": "import { describe, it, expect } from \"vitest\";\nimport { classifyQueuedRun } from \"../../src/services/queue-classifier.js\";\nimport {\n  IssueStatus,\n  RunRole,\n  RunStatus,\n  RunDispatchSource,\n  RunPurpose,\n  IssueType,\n  IssuePriority,\n  type Issue,\n  type Run,\n} from \"@personahub/shared/types\";\n\nfunction makeIssue(overrides: Partial<Issue> = {}): Issue {\n  return {\n    id: \"issue_1\",\n    project_id: \"proj_1\",\n    workspace_id: \"ws_1\",\n    primary_thre
…[truncated])`


> [reasoning] All clean. Now let me write the tests. Let me start with the unit test for the classifier, then the integration test.

For the unit test, I need to test `classifyQueuedRun` with various Run/Issue combinations. I need to construct Run and Issue objects. Let me look at what fields are needed.

For Run:
- id, issue_id, thread_id, workspace_id, adapter_config_id, status, failure_reason, instructions, started_at, completed_at, exit_code, error_message, role, workflow_step, validation_round, dispatch_source, adapter_identity, has_final_message, purpose, context_source_run_id, node_run_id, created_at, updated_at

For Issue:
- id, project_id, workspace_id, primary_thread_id, issue_type, workflow_template_id, validation_policy_id, title, goal, status, owner_agent_id, coordinator_agent_id, priority, labels, validation_round_count, blocked_reason_code, blocked_reason_message, validation_dispatch_due_at, created_at, updated_at

I'll create helper functions to build minimal Run and Issue objects.

For the integration test, I need to:
1. Create a test DB with applyMigrations
2. Construct RuntimeHealthService directly
3. Test all the diagnostic scenarios

Let me also check if the `Issue` type needs `validation_round_count` for the classifier. Yes, the validator round check uses `issue.validation_round_count`.

Let me also look at the adapter-routes.test.ts more to see how the Fastify app is built for route testing. Let me read the rest of that test file's buildApp function.

Actually, I already saw the pattern. The route test builds a Fastify app with an error handler and registers routes. But for my route test, I need to register only my route (not all routes). Let me create a minimal Fastify app that registers only the runtime-health route.

But wait, the `registerRoutes` function in `api/index.ts` registers ALL routes. For my test, I need to either:
1. Use `registerRoutes` and pass all services (like adapter-routes.test.ts does)
2. Register only my route directly

Looking at adapter-routes.test.ts, it uses `registerRoutes` and passes all services. This is the established pattern. But my task says "construct RuntimeHealthService directly and/or a minimal Fastify app registering only your route." So I can do either. Let me use the minimal Fastify app approach for the route test, and construct RuntimeHealthService directly for the service-level tests.

Actually, the test helpers (`createTestServices`) don't include `RuntimeHealthService`. I'll need to construct it in the test using the test services' repos. Let me think about this.

For the integration test, I'll:
1. Use `createTestServices()` to get all the repos and services
2. Construct `RuntimeHealthService` using those repos + `adapterConfigService` + `runDispatchService`
3. Test the service directly
4. For the route test, build a minimal Fastify app registering only the runtime-health route

Let me now write the unit test first.

For the unit test, I need to create Run and Issue objects. Let me create minimal builders. The Run type has many fields, but the classifier only uses: `role`, `validation_round`, `issue_id`, `id`. The Issue type is also large, but the classifier only uses: `status`, `validation_round_count`, `id`.

But TypeScript requires all fields. Let me create builder functions that fill in defaults.

Let me check the Run and Issue types again to make sure I have all required fields.

Run:
- id: string
- issue_id: string
- thread_id: string
- workspace_id: string
- adapter_config_id: string
- status: RunStatus
- failure_reason: FailureReason | null
- instructions: string
- started_at: string | null
- completed_at: string | null
- exit_code: number | null
- error_message: string | null
- role: RunRole
- workflow_step: "implementation" | "validation" | null
- validation_round: number | null
- dispatch_source: RunDispatchSource
- adapter_identity: AdapterIdentitySnapshot | null
- has_final_message: boolean
- purpose: RunPurpose
- context_source_run_id: string | null
- node_run_id: string | null
- created_at: string
- updated_at: string

Issue:
- id: string
- project_id: string
- workspace_id: string
- primary_thread_id: string | null
- issue_type: IssueType
- workflow_template_id: string
- validation_policy_id: string
- title: string
- goal: string | null
- status: IssueStatus
- owner_agent_id: string | null
- coordinator_agent_id: string | null
- priority: IssuePriority
- labels: string[]
- validation_round_count: number
- blocked_reason_code: ValidationBlockReason | string | null
- blocked_reason_message: string | null
- validation_dispatch_due_at: string | null
- created_at: string
- updated_at: string

Let me write the tests now.
Step 6 of 9: Writing the unit test for the classifier.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-08-09T10:41:02Z

- **tool**: `write({"content": "import { describe, it, expect, beforeEach, afterEach } from \"vitest\";\nimport Fastify from \"fastify\";\nimport { createTestServices, createTempDir, disposeTestServices, type TestServices } from \"../helpers.js\";\nimport { RuntimeHealthService, LOCK_DIAGNOSTIC_GRACE_MS, EXPECTED_SCHEMA_VERSION } from \"../../src/services/runtime-health.js\";\nimport { runtimeHealthRoutes } from \"../../src/api/routes/runtime-health.js\";\nimport { AppError, getErrorStatus, buildErrorResponse } fr
…[truncated])`


> [reasoning] Now let me write the integration test. This is the big one. I need to cover:

1. T040 (five categories collected; adapter under workspace grouping; schema actual/expected/status)
2. T040d (behind and ahead both produce schema_version_mismatch)
3. T040e (same adapter Available in workspace A, Unavailable in B -> both presented separately, not merged)
4. T040b (healthSnapshot returns counts, Set not exposed)
5. T041 (stale_lock five cases: threshold-1ms, exactly-equal, over-threshold, locked_at illegal+holder missing/terminal->confirmed, locked_at illegal+holder running->lock_timestamp_invalid; assert all v0.2 adapters' capabilities.executionTimeoutMs === DEFAULT_EXECUTION_TIMEOUT_MS)
6. T041b/T041c (extracted classifier: drain still works - run queue-drain-eligibility test; health uses classifier; Blocked graph node queued NOT reported queue_starved; eligible_but_not_running + lock occupied -> no diagnostic; eligible + lock free -> single queue_starved; waiting_for_recovery/invalid_queued_run surfaced)
7. T041e (Validating issue waiting for due time, queued_count 0 -> waiting_for_validation_due, NOT queue_starved)
8. T041f (due-time boundaries: not yet due -> waiting; within grace -> waiting; past grace -> validation_dispatch_overdue with overdue_ms)
9. T041d (no available adapter)
10. T042 (read-only: calling health triggers no probe, acquires no lock, writes no rows - assert DB state unchanged, pending sets unchanged)
11. T043 (route: valid workspace, invalid/cross-project workspace_id -> WORKSPACE_NOT_FOUND, omitted -> aggregate)

This is a comprehensive test file. Let me think about how to structure it.

I'll use `createTestServices()` to get all the repos and services, then construct `RuntimeHealthService` directly.

For the route test, I'll build a minimal Fastify app registering only the runtime-health route.

Let me think about the test data setup. I need:
- A project
- Workspaces (possibly multiple for T040e)
- Adapters (agent_configs)
- Issues
- Runs (queued, running, terminal)
- Locks (by setting workspace lock state directly in DB)

For setting up locks with specific `locked_at` timestamps, I'll need to write directly to the DB since the `acquireLock` method uses `new Date().toISOString()`. I can use `db.prepare("UPDATE workspaces SET ...")` to set specific locked_at values.

For the stale_lock tests, I need:
1. threshold - 1ms: held_ms = threshold - 1 -> no diagnostic (within threshold)
2. exactly equal: held_ms = threshold -> no diagnostic (strict greater-than)
3. over threshold: held_ms = threshold + 1 -> stale_lock_suspected
4. locked_at illegal + holder missing -> stale_lock_confirmed
5. locked_at illegal + holder terminal -> stale_lock_confirmed
6. locked_at illegal + holder running -> lock_timestamp_invalid

For the executionTimeoutMs assertion test, I need to instantiate all four adapters and check their capabilities.executionTimeoutMs.

Let me now write the integration test. This will be a large file.

Actually, let me think about how to structure the test to be manageable. I'll use describe blocks for each task ID.

For setting up test data, I need helper functions. Let me think about what I need:

1. Create a project + workspace + adapter + issue
2. Create runs in various states
3. Set workspace lock state directly in DB
4. Set issue status and validation_dispatch_due_at

Let me also check: the `createTestServices` function creates a `RunDispatchService` which has `healthSnapshot()`. And `AdapterConfigService` which has `healthSnapshot()`. So I can use those directly.

For the RuntimeHealthService, I'll construct it with:
- db
- workspaceRepo
- agentConfigRepo
- adapterWorkspaceStatusRepo
- runRepo
- issueRepo
- adapterConfigService
- runDispatchService
- expectedSchemaVersion (default 10)

Let me write the test now. I'll be comprehensive but organized.

Actually, I realize I need to handle the `Issue` creation. The `issueService.create()` method creates an issue with default status. Let me check what the default status is.

Looking at the queue-drain-eligibility test, it does:
```typescript
const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
```

So issues start with some default status (probably Inbox) and then get updated. Let me also check what fields issueService.create needs.

Actually, for the integration test, I'll use the test helpers directly. Let me look at how `issueService.create` works and what it returns.

Let me also think about the adapter creation. The queue-drain-eligibility test does:
```typescript
const implAdapter = services.agentConfigRepo.create({
  project_id: project.id, name: "Impl", role: "implementation", 
  cli_provider: "fake", command: "echo", args: [], 
  capability_tags: [], default_model: null, status: AdapterStatus.Available
});
```

So I can create adapters directly via the repo.

For the workspace, the test does:
```typescript
services.workspaceService.bind(project.id, tempDir);
const workspace = services.workspaceService.get(project.id)!;
```

OK, I have enough context. Let me write the integration test.

One more thing: for the route test, I need to build a Fastify app. I'll follow the pattern from adapter-routes.test.ts but register only the runtime-health route.

For the executionTimeoutMs assertion, I need to import the adapter classes and instantiate them. Let me check the imports:
- FakeAgentAdapter from "../../src/runtime/adapters/fake-adapter.js"
- CodexCliAdapter from "../../src/runtime/adapters/codex-cli-adapter.js"
- ClaudeCodeAdapter from "../../src/runtime/adapters/claude-code-adapter.js"
- OpenCodeAdapter from "../../src/runtime/adapters/opencode-adapter.js"
- DEFAULT_EXECUTION_TIMEOUT_MS from "../../src/runtime/types.js"

Let me write the comprehensive integration test now.

Actually, for creating issues with specific validation_dispatch_due_at, I need to use the DB directly since the issue repo's updateStatus doesn't set that field. I can use:
```typescript
services.db.prepare("UPDATE issues SET validation_dispatch_due_at = ?, status = 'Validating' WHERE id = ?").run(dueAt, issue.id);
```

For setting workspace lock state with specific timestamps:
```typescript
services.db.prepare("UPDATE workspaces SET lock_state = 'locked', locked_by_run_id = ?, locked_at = ? WHERE id = ?").run(runId, lockedAt, workspaceId);
```

For creating runs in specific states:
```typescript
services.runRepo.create({ ... });
services.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId);
```

Actually, for runs, I should use `runRepo.transitionStatus` to change status, or just create them in the desired status. The `runRepo.create` accepts a `status` field, so I can create runs directly in any status.

Wait, but `runRepo.create` creates runs in the given status directly. But for creating a "running" run, I might need to set `started_at` too. Let me just create runs with the desired status and update fields directly via DB if needed.

Let me also think about the T042 (read-only) test. I need to assert:
1. No probe triggered - check `adapterConfigService.healthSnapshot().pendingProbeCount` is unchanged
2. No lock acquired - check workspace lock state is unchanged
3. No rows written - I can check DB state before and after

For checking DB state, I can take a snapshot of relevant tables before and after calling `collect()`.

Actually, the simplest approach for T042 is:
1. Record the pending probe/reprobe counts before
2. Record the workspace lock states before
3. Call `collect()`
4. Assert counts are unchanged
5. Assert lock states are unchanged
6. Assert no new rows in any table (I can check row counts of key tables)

Let me also think about how to verify no writes happened. I can use SQLite's `total_changes` PRAGMA or check specific table row counts. Actually, the simplest is to check that the `db.prepare("PRAGMA data_version").get()` doesn't change, but that might not work in all cases. Let me just check specific things:
- pendingProbeCount unchanged
- pendingReprobeCount unchanged
- workspace lock state unchanged (locked_by_run_id, locked_at, lock_state)
- no new runs, issues, adapters, etc.

Actually, the most robust approach is to snapshot the entire DB state before and after. But that's complex. Let me just check the key indicators:
1. pendingProbeCount before === after
2. pendingReprobeCount before === after
3. All workspace lock_state, locked_by_run_id, locked_at values unchanged
4. All run statuses unchanged

This should be sufficient to prove read-only behavior.

Let me now write the test. It's going to be long but comprehensive.

For the T040b test, I need to verify that healthSnapshot returns counts and the Set is not exposed. I can:
1. Call `adapterConfigService.healthSnapshot()` and check it returns `{ pendingProbeCount: number }`
2. Call `runDispatchService.healthSnapshot()` and check it returns `{ pendingReprobeCount: number }`
3. Verify the return type doesn't expose the Set (this is a type-level check, but I can verify the shape at runtime)

For the adapter executionTimeoutMs test, I need to:
1. Instantiate all four adapters
2. Check each one's `capabilities.executionTimeoutMs === DEFAULT_EXECUTION_TIMEOUT_MS`

Let me write the test now. I'll organize it by task ID.

Let me also check: for the `validation_dispatch_due_at` field in the issue, I need to set it directly via DB since there's no repo method that sets just that field. Actually, `issueRepo.compareAndSetStatus` can set it, but that requires a status transition. Let me just use DB directly.

Actually wait - I need to be careful. The `listByStatus(IssueStatus.Validating)` method queries issues by status. For the validation dispatch tests, I need issues with status='Validating' and validation_dispatch_due_at set. I can:
1. Create an issue (default status is probably Inbox)
2. Update status to Validating via `issueRepo.updateStatus`
3. Set validation_dispatch_due_at via DB directly

Let me check if there's a simpler way. Looking at the issue repo:
- `updateStatus(issueId, { status, updatedAt })` - updates status only
- `compareAndSetStatus(id, expected, next, patch?)` - can set validation_dispatch_due_at but requires a status transition

I'll use DB directly to set validation_dispatch_due_at after setting status to Validating. This is fine for tests.

OK, let me write the comprehensive integration test now.
Step 7 of 9: Writing the comprehensive integration test.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-08-09T10:42:10Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\unit\\queue-classifier.test.ts", "severity": "error"})`


> [reasoning] Now let me run LSP diagnostics on the test files and then run the tests. Let me check the test files for diagnostics first.
Step 8 of 9: Running LSP diagnostics and tests. Let me check diagnostics on all files:

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:42:22Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "severity": "error"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:42:35Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts", "severity": "error"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:42:52Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-failure-reprobe.ts", "severity": "error"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:43:08Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/unit/queue-classifier.test.ts server/tests/integration/queue-drain-eligibility.test.ts --reporter=verbose 2>&1 | head -80", "timeout": 120000})`


> [reasoning] All diagnostics are clean. Now let me run the tests. Let me first run the unit test for the classifier, then the integration test, and also the queue-drain-eligibility regression test.

Let me check the vitest configuration first to know how to run scoped tests.
All diagnostics clean. Now running the tests. First the unit classifier test and the regression test:

  <details><summary>tool output</summary>

  ```text
[31;1mhead: [31;1mThe term 'head' is not recognized as a name of a cmdlet, function, script file, or executable program.[0m
[31;1m[31;1mCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.[0m
  ```
  </details>

## assistant · 2026-08-09T10:43:22Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/unit/queue-classifier.test.ts server/tests/integration/queue-drain-eligibility.test.ts --reporter=verbose 2>&1 | Select-Object -First 100", "timeout": 120000})`

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m

 [32m�?[39m server/tests/unit/queue-classifier.test.ts[2m > [22mclassifyQueuedRun (T041b)[2m > [22missue null[2m > [22mreturns invalid_queued_run when issue is null[32m 2[2mms[22m[39m
 [32m�?[39m server/tests/unit/queue-classifier.test.ts[2m > [22mclassifyQueuedRun (T041b)[2m > [22missue Blocked[2m > [22mreturns waiting_for_recovery for GraphNode role[32m 0[2mms[22m[39m
 [32m�?[39m server/tests/unit/queue-classifier.test.ts[2m > [22mclassifyQueuedRun (T041b)[2m > [22missue Blocked[2m > [22mreturns invalid_queued_run for Implementation role[32m 0[2mms[22m[39m
 [32m�?[39m server/tests/unit/queue-classifier.test.ts[2m > [22mclassifyQueuedRun (T041b)[2m > [22missue Blocked[2m
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:43:46Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/integration/runtime-health.test.ts --reporter=verbose 2>&1 | Select-Object -First 100", "timeout": 120000})`


> [reasoning] All 43 tests passed, including the queue-drain-eligibility regression tests (both from the main repo and the .claude/worktrees copy). The classifier unit tests also all passed.

Now let me run the integration test for runtime-health:
All 43 tests pass (unit classifier + drain regression). Now running the runtime-health integration test:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m

 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040 - five categories collected[2m > [22mcollects schema, background, workspaces (with adapters under workspace), and queue[32m 279[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040d - schema_version_mismatch[2m > [22mreports behind when expected > actual[32m 220[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040d - schema_version_mismatch[2m > [22mreports ahead when actual > expected[32m 208[2mms[22m[39m
 [32m�?[39m server/
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:44:20Z

- **tool**: `grep({"include": "server/src/services/issue.ts", "output_mode": "content", "pattern": "create\\(|primary_thread|IssueWithThread"})`


> [reasoning] The failures are:
1. FOREIGN KEY constraint failed - this is because I'm creating runs with `adapter_config_id: "ac_any"` which doesn't exist in the agent_configs table. The runs table has a foreign key constraint on `adapter_config_id` referencing `agent_configs(id)`. I need to use a real adapter ID.

2. The "past grace window" test failed because the detail string says "Issue iss_..." but doesn't contain "overdue_ms=". Wait, looking at the error message: `expected 'Issue iss_01KZK1YZWS7T2FBDS50JAJHPDA ...' to contain 'overdue_ms='`. Let me check - the detail format is `Issue ${issue.id} validation dispatch is overdue by ${overdueMs}ms (due_at=${dueAt}).` - it should contain "overdue by Xms". But the test expects "overdue_ms=". I see the issue - the test assertion checks for "overdue_ms=" but my detail string says "overdue by ${overdueMs}ms". Let me fix the test assertion.

Wait, actually let me re-read the error: `expected 'Issue iss_01KZK1YZWS7T2FBDS50JAJHPDA ...' to contain 'overdue_ms='`. The actual detail string is `Issue ${issue.id} validation dispatch is overdue by ${overdueMs}ms (due_at=${dueAt}).` which doesn't contain "overdue_ms=". The test expects `overdue!.detail).toContain("overdue_ms=")`. I need to either change the detail format to include "overdue_ms=" or change the test assertion.

Let me look at what the test checks: `expect(overdue!.detail).toContain("overdue_ms=")`. I should change the detail format to include `overdue_ms=` to match the design's "detail 附 overdue_ms". Let me update the service to use `overdue_ms=${overdueMs}` in the detail.

Now for the FK constraint issue: I need to use a real adapter_config_id when creating runs in the test. The `setupLockedWorkspace` function creates a run with `adapter_config_id: "ac_any"` which doesn't exist. I need to create an adapter first and use its ID.

Looking at the test:
```typescript
function setupLockedWorkspace(holderStatus: RunStatus, lockedAtOffsetMs: number | null) {
  const { project, workspace, issue } = setupProject(services, tempDir);
  createAdapter(services, project.id, "Adapter");
  const holderRun = services.runRepo.create({
    ...
    adapter_config_id: "ac_any",  // <-- WRONG: should use the real adapter ID
    ...
  });
```

The issue is that `createAdapter` returns the adapter record, but I'm not capturing its ID. Let me fix this.

Also, the `createQueuedRun` helper uses `adapterId` parameter correctly, but the `setupLockedWorkspace` function hardcodes `"ac_any"`.

Let me also check if the runs table has a thread_id FK. The run is created with `thread_id: "thread_test"` which doesn't exist. Let me check the schema.

Looking at the queue-drain-eligibility test, it uses `issue.primary_thread!.id` as the thread_id. So I need to use a real thread ID. The issue created by `issueService.create()` has a `primary_thread_id`.

Wait, looking at my `setupProject` function:
```typescript
function setupProject(services: TestServices, tempDir: string) {
  const project = services.projectService.create("HealthTest");
  services.workspaceService.bind(project.id, tempDir);
  const workspace = services.workspaceService.get(project.id)!;
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  return { project, workspace, issue };
}
```

The `issueService.create()` returns an issue with `primary_thread_id`. I should use `issue.primary_thread_id` as the thread_id in run creation. But `primary_thread_id` is `string | null` - it might be null. Let me check the issueService.create to see if it creates a thread.

Looking at the queue-drain-eligibility test:
```typescript
createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
```

It uses `issue.primary_thread!.id` - so the issue has a primary_thread object. But in the Issue type, `primary_thread_id` is `string | null`. The `issueService.create()` probably creates a thread and sets the primary_thread_id.

Wait, looking at the IssueWithThread type:
```typescript
export interface IssueWithThread extends Issue {
  primary_thread: Thread | null;
}
```

So `issueService.create()` returns `{ issue, thread }` or `{ issue: IssueWithThread }`. Let me check what `issueService.create` returns.

Actually, looking at the queue-drain-eligibility test setup:
```typescript
const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
```

And then:
```typescript
createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
```

So `issue` has a `primary_thread` property. This means `issueService.create()` returns an `IssueWithThread`. Let me check.

Actually, looking at my test, I have:
```typescript
const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
```

And then in `createQueuedRun`:
```typescript
thread_id: "thread_test",
```

This is wrong - I should use the real thread ID. But the issue returned by `issueService.create()` might be an `IssueWithThread` which has `primary_thread`. Let me check the IssueService.create return type.

Actually, looking at the test helpers, `issueService` is `IssueService`. Let me check its create method.

Let me look at the issue service create method.
I see two issues: 1) FK constraint on runs (using fake `adapter_config_id` and `thread_id`), 2) detail format mismatch. Let me check how `issueService.create` returns thread info:

  <details><summary>tool output</summary>

  ```text
Found 14 match(es) in 1 file(s)

D:\Projects\personahub\server\src\services\issue.ts
  2: import type { Issue, IssueWithThread, Thread, ThreadSummary } from "@personahub/shared/types";
  43: issue: IssueWithThread;
  44: primary_thread: Thread;
  58: create(projectId: string, input: {
  103: const newIssue = this.issueRepo.create({
  116: const newThread = this.threadRepo.create({
  125: this.threadEventRepo.create({
  138: primary_thread_id: newThread.id,
  150: primary_thread: buildThreadSummary(thread),
  152: primary_thread: thread,
  164: get(issueId: string): IssueWithThread {
  171: if (issue.primary_thread_id) {
  172: const thread = this.threadRepo.getById(issue.primary_thread_id);
  180: primary_thread: primaryThread,

[Agent Usage Reminder]

You called a search/fetch tool direct
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:44:39Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\runtime-health.ts", "newString": "        const overdueMs = now - dueTime;\n        diagnostics.push({\n          code: \"validation_dispatch_overdue\",\n          workspace_id: issue.workspace_id,\n          detail: `Issue ${issue.id} validation dispatch is overdue. overdue_ms=${overdueMs} (due_at=${dueAt}).`,", "oldString": "        const overdueMs = now - dueTime;\n        diagnostics.push({\n          code: \"validation_dispatch_
…[truncated])`


> [reasoning] So `issueService.create()` returns `{ issue: IssueWithThread, primary_thread: Thread }`. The `issue` has `primary_thread_id` set, and there's a `primary_thread` object. I need to use `issue.primary_thread_id` (or the returned `primary_thread.id`) as the `thread_id` for runs.

Let me fix the test:
1. Use `issue.primary_thread_id` as `thread_id` in run creation (but it could be null - in the issueService.create, it's set to `newThread.id`, so it won't be null)
2. Use a real adapter ID instead of `"ac_any"` in `setupLockedWorkspace`
3. Fix the `overdue_ms=` detail format in the service or the test assertion

Let me fix all three issues:

1. In the test helpers, change `thread_id: "thread_test"` to use `issue.primary_thread_id!`
2. In `setupLockedWorkspace`, capture the adapter ID and use it
3. Change the service detail to include `overdue_ms=` or change the test assertion

For #3, the design says "detail 附 overdue_ms = now - due_at". So the detail should include `overdue_ms`. Let me update the service to use `overdue_ms=${overdueMs}` format.

Actually, let me re-read my service code:
```typescript
detail: `Issue ${issue.id} validation dispatch is overdue by ${overdueMs}ms (due_at=${dueAt}).`,
```

The design says "detail 附 overdue_ms = now - due_at". So I should include the key name `overdue_ms` in the detail. Let me change it to:
```typescript
detail: `Issue ${issue.id} validation dispatch is overdue. overdue_ms=${overdueMs} (due_at=${dueAt}).`,
```

And for the waiting case, the design says "detail 附剩余毫秒数（未到期时为正）". I already have `remaining_ms=${remainingMs}`. That's fine.

Let me fix all the issues now. I'll update the test file and the service.

Let me also check: the `createQueuedRun` helper uses `adapterId` parameter, but in some tests I pass `"ac_any"` instead of a real adapter ID. Let me check.

Looking at the T042 test:
```typescript
createQueuedRun(services, issue.id, workspace.id, "ac_any");
```

This should use a real adapter ID. Let me fix this too.

And in `setupLockedWorkspace`:
```typescript
const holderRun = services.runRepo.create({
  ...
  adapter_config_id: "ac_any",
  ...
});
```

This should use the real adapter ID returned by `createAdapter`.

Let me fix the test comprehensively. I need to:
1. Make `setupProject` return the issue with thread info
2. Make `createQueuedRun` use the real thread_id from the issue
3. Make `setupLockedWorkspace` use a real adapter ID
4. Fix the T042 test to use a real adapter ID
5. Fix the service's overdue detail format

Let me update both files.
I see the issues: 1) FK constraints from fake `thread_id`/`adapter_config_id`, 2) detail format. Let me fix the service first, then the test:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:44:57Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "limit": 60, "offset": 1})`

Now fixing the test file - using real `thread_id` from issue and real `adapter_config_id`:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\runtime-health.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Fastify from "fastify";
3: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
4: import { RuntimeHealthService, LOCK_DIAGNOSTIC_GRACE_MS, EXPECTED_SCHEMA_VERSION } from "../../src/services/runtime-health.js";
5: import { runtimeHealthRoutes } from "../../src/api/routes/runtime-health.js";
6: import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
7: import { ErrorCode } from "@personahub/shared/errors";
8: import {
9:   IssueStatus,
10:   RunRole,
11:   RunStatus,
12:   RunDispatchSource,
13:   AdapterStatus,
14
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:45:11Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "function setupProject(services: TestServices, tempDir: string) {\n  const project = services.projectService.create(\"HealthTest\");\n  services.workspaceService.bind(project.id, tempDir);\n  const workspace = services.workspaceService.get(project.id)!;\n  const { issue, primary_thread } = services.issueService.create(project.id, { title: \"T\", goal: \"G\" });\n  return { project, workspace
…[truncated])`


> [reasoning] I need to fix the test file. The main issues are:

1. `createQueuedRun` uses `thread_id: "thread_test"` which doesn't exist - need to pass the real thread_id
2. `setupLockedWorkspace` uses `adapter_config_id: "ac_any"` which doesn't exist - need to use the real adapter ID
3. T042 test uses `createQueuedRun(services, issue.id, workspace.id, "ac_any")` - need real adapter ID

Let me fix these. I'll update `createQueuedRun` to accept a `threadId` parameter, and update `setupLockedWorkspace` to use the real adapter ID.

Actually, a simpler approach: since `issueService.create()` returns `{ issue, primary_thread }`, I can get the thread ID from `primary_thread.id` or from `issue.primary_thread_id`. Let me update `setupProject` to also return the thread_id, and update `createQueuedRun` to accept it.

Wait, looking at the return type of `issueService.create()`:
```
issue: IssueWithThread;
primary_thread: Thread;
```

So I can do:
```typescript
const { issue, primary_thread } = services.issueService.create(project.id, { title: "T", goal: "G" });
return { project, workspace, issue, threadId: primary_thread.id };
```

Then `createQueuedRun` takes a `threadId` parameter.

Let me rewrite the test file's helper functions and the affected test cases.

Actually, let me just update the specific parts that need fixing. Let me do a comprehensive fix:

1. Update `setupProject` to return `threadId`
2. Update `createQueuedRun` to accept `threadId` 
3. Update `setupLockedWorkspace` to use real adapter ID
4. Update T042 test to use real adapter ID
5. Update all callers of `createQueuedRun` to pass `threadId`

This is a lot of changes. Let me just rewrite the entire test file to be correct. Actually, let me use targeted edits.

First, let me fix the helper functions.
Let me fix the test helpers to use real `thread_id` and `adapter_config_id`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:45:30Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "limit": 50, "offset": 225})`


> [reasoning] Now I need to fix all the callers of `createQueuedRun` to pass `threadId`, and fix `setupLockedWorkspace` to use a real adapter ID. Let me also fix the T042 test.

Let me read the relevant parts of the test file to make targeted edits. Let me find all places that call `createQueuedRun` and `setupLockedWorkspace`.
Now fixing the `setupLockedWorkspace` function and all `createQueuedRun` callers. Let me read the relevant sections:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\runtime-health.test.ts</path>
<type>file</type>
<content>
225:       }
226:     });
227: 
228:     const THRESHOLD = DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS;
229: 
230:     function setupLockedWorkspace(holderStatus: RunStatus, lockedAtOffsetMs: number | null) {
231:       const { project, workspace, issue } = setupProject(services, tempDir);
232:       createAdapter(services, project.id, "Adapter");
233:       const holderRun = services.runRepo.create({
234:         issue_id: issue.id,
235:         thread_id: "thread_test",
236:         workspace_id: workspace.id,
237:         adapter_config_id: "ac_any",
238:         instructions: "",
239:         status: holderStatus,
240:         role: RunRole.Implementation,
241:   
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:45:47Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "    function setupLockedWorkspace(holderStatus: RunStatus, lockedAtOffsetMs: number | null) {\n      const { project, workspace, issue, threadId } = setupProject(services, tempDir);\n      const adapter = createAdapter(services, project.id, \"Adapter\");\n      const holderRun = services.runRepo.create({\n        issue_id: issue.id,\n        thread_id: threadId,\n        workspace_id: works
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:46:03Z

- **tool**: `grep({"include": "server/tests/integration/runtime-health.test.ts", "output_mode": "content", "pattern": "createQueuedRun\\("})`


> [reasoning] Now I need to fix all the callers of `createQueuedRun` that don't pass `threadId`. Let me find them all.

Looking at the test file, the callers of `createQueuedRun` are:
1. In T041b/T041c tests - they use `createQueuedRun(services, issue.id, workspace.id, adapter.id)` which needs to be updated to `createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id)`
2. In T042 test - uses `createQueuedRun(services, issue.id, workspace.id, "ac_any")` which needs to use a real adapter ID and thread ID

Let me find and fix all of these. Let me search for `createQueuedRun` calls in the test file.
Now let me find and fix all `createQueuedRun` callers:

  <details><summary>tool output</summary>

  ```text
Found 7 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\runtime-health.test.ts
  46: function createQueuedRun(
  335: createQueuedRun(services, issue.id, workspace.id, adapter.id);
  356: createQueuedRun(services, issue.id, workspace.id, adapter.id);
  367: createQueuedRun(services, issue.id, workspace.id, adapter.id);
  379: createQueuedRun(services, issue.id, workspace.id, adapter.id);
  389: const run = createQueuedRun(services, issue.id, workspace.id, adapter.id, RunRole.Implementation);
  477: createQueuedRun(services, issue.id, workspace.id, "ac_any");

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fir
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:46:24Z

- **tool**: `grep({"include": "server/tests/integration/runtime-health.test.ts", "output_mode": "content", "pattern": "setupProject\\(services"})`


> [reasoning] I need to fix all the `createQueuedRun` calls. The function signature is now:
```typescript
function createQueuedRun(
  services: TestServices,
  issueId: string,
  threadId: string,
  workspaceId: string,
  adapterId: string,
  role: RunRole = RunRole.Implementation,
  validationRound: number | null = null,
)
```

The callers are at lines 335, 356, 367, 379, 389, 477. Each needs to include `threadId` after `issue.id`.

Looking at the test code, the callers use destructured variables from `setupProject`. Since `setupProject` now returns `threadId`, I need to update the destructuring and the calls.

Let me check what each test case looks like. Let me read the relevant sections and fix them. Since there are multiple occurrences of `createQueuedRun(services, issue.id, workspace.id, adapter.id)`, I can't use a simple replaceAll because the context around each might differ. But actually, they all need the same fix: add `threadId` after `issue.id`.

Actually, the pattern `createQueuedRun(services, issue.id, workspace.id, adapter.id` appears multiple times. I can replace all of them with `createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id`. But I also need to make sure the destructuring includes `threadId`.

Let me first fix the destructuring in each test. Let me read each section.

Actually, let me take a different approach. Since all the `createQueuedRun` calls with `issue.id, workspace.id, adapter.id` need to become `issue.id, threadId, workspace.id, adapter.id`, and the `setupProject` call destructuring needs to include `threadId`, let me:

1. First, find all `setupProject` calls that are followed by `createQueuedRun` and add `threadId` to the destructuring
2. Then fix all `createQueuedRun` calls

Let me do this with targeted edits for each test section.

Actually, let me use `replaceAll` for the `createQueuedRun` pattern since they're all the same fix. But I need to check if there are different patterns.

Lines 335, 356, 367, 379: `createQueuedRun(services, issue.id, workspace.id, adapter.id)`
Line 389: `createQueuedRun(services, issue.id, workspace.id, adapter.id, RunRole.Implementation)`
Line 477: `createQueuedRun(services, issue.id, workspace.id, "ac_any")`

These are different patterns. Let me fix them individually.

But first, I need to make sure the destructuring includes `threadId`. Let me search for `setupProject` calls in the test.
Let me find all `setupProject` destructuring calls to add `threadId`:

  <details><summary>tool output</summary>

  ```text
Found 22 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\runtime-health.test.ts
  24: function setupProject(services: TestServices, tempDir: string) {
  122: const { project, workspace, issue } = setupProject(services, tempDir);
  148: const { project } = setupProject(services, tempDir);
  157: const { project } = setupProject(services, tempDir);
  166: const { project } = setupProject(services, tempDir);
  231: const { project, workspace, issue, threadId } = setupProject(services, tempDir);
  310: const { project, workspace, issue } = setupProject(services, tempDir);
  333: const { project, workspace, issue } = setupProject(services, tempDir);
  354: const { project, workspace, issue } = setupProject(services, tempDir);
  365: const { project, workspace, issue } = 
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:46:42Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "const { project, workspace, issue, threadId } = setupProject(services, tempDir);", "oldString": "const { project, workspace, issue } = setupProject(services, tempDir);", "replaceAll": true})`


> [reasoning] I need to fix:
1. Lines 310, 333, 354, 365, 377, 386, 400, 415, 427, 439, 475 - these need `threadId` added to the destructuring where `createQueuedRun` is used
2. All `createQueuedRun` calls need `threadId` parameter added
3. Line 477 needs a real adapter ID instead of `"ac_any"`

But only the ones that actually call `createQueuedRun` need `threadId`. Let me check which tests use `createQueuedRun`:
- Lines 335, 356, 367, 379, 389 are in the T041b/T041c section (lines ~310-395)
- Line 477 is in the T042 section (line ~475)

The tests at lines 400, 415, 427, 439 are in T041e/T041f sections - they use `setIssueValidatingWithDueAt` and don't call `createQueuedRun`. Let me verify by checking what's at those lines.

Actually, let me take a simpler approach. Since `createQueuedRun(services, issue.id, workspace.id, adapter.id` is a common pattern, let me replace all occurrences. But I need to be careful about the different variants.

Let me use replaceAll for the common pattern:
- `createQueuedRun(services, issue.id, workspace.id, adapter.id)` → `createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id)`
- `createQueuedRun(services, issue.id, workspace.id, adapter.id, RunRole.Implementation)` → `createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id, RunRole.Implementation)`
- `createQueuedRun(services, issue.id, workspace.id, "ac_any")` → needs a real adapter ID

But for replaceAll to work, I need the exact string. Let me use replaceAll for each variant.

Also, I need to add `threadId` to the destructuring for all tests that call `createQueuedRun`. The ones at lines 310, 333, 354, 365, 377, 386 need `threadId` added (they're in the T041b/T041c section). Line 475 needs `threadId` too (T042 section).

Let me also check: lines 400, 415, 427, 439 are in the T041e/T041f sections. Do they call `createQueuedRun`? Looking at the grep results, `createQueuedRun` only appears at lines 335, 356, 367, 379, 389, 477. So only the tests at lines 310-389 and 475 need `threadId`.

Let me fix this step by step. First, let me add `threadId` to the destructuring in the relevant tests. Since there are many `const { project, workspace, issue } = setupProject(services, tempDir);` lines, I can't use a simple replaceAll. Let me use the line-specific context to make targeted edits.

Actually, a smarter approach: let me use replaceAll to change the common pattern `createQueuedRun(services, issue.id, workspace.id, adapter.id` to `createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id`. This handles 5 of the 7 calls. Then I fix the remaining 2 individually.

But first, I need to make sure `threadId` is available in each scope. Let me check the T041b/T041c section structure.

Looking at the test, the T041b/T041c section has multiple `it()` blocks, each with its own `const { project, workspace, issue } = setupProject(services, tempDir);`. I need to add `threadId` to each.

Let me use a different approach: I'll use `replaceAll` to change `const { project, workspace, issue } = setupProject(services, tempDir);` to `const { project, workspace, issue, threadId } = setupProject(services, tempDir);` for all occurrences. This is safe because `setupProject` now always returns `threadId`, and adding it to the destructuring doesn't break anything (it's just an extra variable that might not be used in some tests).

Then I'll use `replaceAll` for the `createQueuedRun` pattern.

And finally fix the T042 test's `"ac_any"` to use a real adapter.

Let me do this step by step.
I'll fix all the patterns. First, adding `threadId` to all destructuring:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:47:10Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);", "oldString": "createQueuedRun(services, issue.id, workspace.id, adapter.id);", "replaceAll": true})`

Now fixing all `createQueuedRun` calls to include `threadId`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:47:21Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "const run = createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id, RunRole.Implementation);", "oldString": "const run = createQueuedRun(services, issue.id, workspace.id, adapter.id, RunRole.Implementation);"})`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:47:29Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "limit": 15, "offset": 473})`

Now fixing the T042 test's fake adapter ID:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\runtime-health.test.ts</path>
<type>file</type>
<content>
473:   describe("T042 - read-only (FR-006)", () => {
474:     it("calling collect triggers no probe, acquires no lock, writes no rows", () => {
475:       const { project, workspace, issue, threadId } = setupProject(services, tempDir);
476:       createAdapter(services, project.id, "Adapter");
477:       createQueuedRun(services, issue.id, workspace.id, "ac_any");
478: 
479:       const probeCountBefore = services.adapterConfigService.healthSnapshot().pendingProbeCount;
480:       const reprobeCountBefore = services.runDispatchService.healthSnapshot().pendingReprobeCount;
481:       const wsBefore = services.db.prepare("SELECT lock_state, locked_by_run_id, locked_at FROM workspac
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:47:34Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "      const { project, workspace, issue, threadId } = setupProject(services, tempDir);\n      const adapter = createAdapter(services, project.id, \"Adapter\");\n      createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);", "oldString": "      const { project, workspace, issue, threadId } = setupProject(services, tempDir);\n      createAdapter(services, project.id, \"Adapt
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:47:42Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/integration/runtime-health.test.ts --reporter=verbose 2>&1 | Select-Object -First 100", "timeout": 120000})`


> [reasoning] Now I also need to fix the "locked_at illegal + holder missing" test. In that test, I delete the run after creating it, but the workspace still references it via `locked_by_run_id`. The `cleanupStaleLocks()` function handles this case (holder missing -> release). But in the health service, I just check if `runRepo.getById(lockedByRunId)` returns null. So deleting the run should work. But wait - can I delete a run that's referenced by a workspace's `locked_by_run_id`? There might be a FK constraint.

Looking at the schema, `workspaces.locked_by_run_id` is `TEXT` (not a FK constraint - looking at the workspace repo, `locked_by_run_id` is just a text column, not a FK). So deleting the run should work.

But wait - the `runs` table has FK constraints on `issue_id`, `thread_id`, `workspace_id`, `adapter_config_id`. Deleting a run should be fine as long as nothing references it with a FK. The `workspaces.locked_by_run_id` is not a FK (it's just a TEXT column), so deleting the run is fine.

Actually, let me also check: in the "locked_at illegal + holder missing" test, I first create the run, then lock the workspace with the run ID, then delete the run. The `lockWorkspace` function just does an UPDATE on the workspaces table, so it doesn't create a FK. Then deleting the run should work.

Wait, but there might be other FK constraints. Let me check if `thread_events` or `run_traces` reference the run. The run was just created and hasn't been started, so there shouldn't be any thread events or traces. The delete should work.

Let me also check the "locked_at in the future" test. It creates a locked workspace with a future `locked_at`, then checks that `lock_timestamp_invalid` is produced. My service code checks `lockedTime <= now` for computing `heldMs`. If `locked_at` is in the future, `lockedTime > now`, so `heldMs` is null. Then if the holder is running and `heldMs` is null, it produces `lock_timestamp_invalid`. This should work.

Now let me run the tests again to see if the FK constraint issues are fixed.
Now let me re-run the integration test:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m

 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040 - five categories collected[2m > [22mcollects schema, background, workspaces (with adapters under workspace), and queue[32m 152[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040d - schema_version_mismatch[2m > [22mreports behind when expected > actual[32m 111[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040d - schema_version_mismatch[2m > [22mreports ahead when actual > expected[32m 113[2mms[22m[39m
 [32m�?[39m server/
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:48:09Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "limit": 40, "offset": 305})`


> [reasoning] Good progress! Down to 3 failures:

1. **"locked_at illegal + holder running: lock_timestamp_invalid (no release suggestion)"** - The test asserts `not.toMatch(/release/i)` but the suggested_action contains "do not release the lock". The word "release" appears in the negative context "do not release". The test is checking that the suggested_action doesn't contain the word "release" (case-insensitive). But my suggested_action says "do not release the lock while the holder is still running." which does contain "release". 

   The design says: "不给出释放类建议" (don't give release-type suggestions). The intent is that the action shouldn't suggest releasing the lock. My current text says "do not release" which is actually telling the user NOT to release - it's the correct intent but contains the word "release". 

   I should rephrase to avoid the word "release" entirely. Something like: "Investigate the run and lock record manually; the holder is still running and the workspace mutex must not be removed."

   Or I can change the test assertion to check that it doesn't suggest releasing (i.e., check it doesn't say "release the lock" as a positive suggestion). But the simpler fix is to rephrase the suggested_action.

2. **"Blocked graph node queued: NOT reported as queue_starved"** - FK constraint failed at line 313. Let me check what's at line 313. The test creates a GraphNode run with `node_run_id: "nr_test"`. But `node_run_id` has a FK constraint to `node_runs(id)`. The `nr_test` doesn't exist in the node_runs table, so the FK fails.

   I need to either create a real node_run or use a different approach. Let me check the schema for the `node_run_id` FK.

   Actually, looking at the RunRepository.create code:
   ```typescript
   if ((role === RR.GraphNode) !== (nodeRunId !== null)) {
     throw new Error("Invariant violation: GraphNode runs require node_run_id, and only GraphNode runs may set it.");
   }
   ```
   
   So GraphNode runs MUST have a `node_run_id`. And the `runs` table has a FK constraint on `node_run_id` referencing `node_runs(id)`. So I need to create a real node_run first.

   Let me look at how the queue-drain-eligibility test handles graph nodes. Actually, looking at that test, it doesn't create graph node runs. Let me look at the graph tests for how to create a node_run.

   Actually, I can look at the NodeRunRepository to see how to create a node_run.

3. **"eligible_but_not_running + lock occupied: no queue_starved diagnostic"** - FK constraint failed at line 336. The test creates a run with `adapter_config_id: adapter.id` but then also creates a running run. Wait, let me check - line 336 is probably the `otherRun` creation. Let me read the test.

Actually wait - for test #3, the "eligible_but_not_running + lock occupied" test creates a running run. The running run uses `adapter_config_id: adapter.id` which should be valid. Let me check what's at line 336.

Let me read the test file around lines 310-340 to understand the FK failures.
Down to 3 failures. Let me fix them: 1) rephrase suggested_action to avoid "release", 2) GraphNode FK on `node_run_id`, 3) check the other FK failure. Let me read the failing test sections:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\runtime-health.test.ts</path>
<type>file</type>
<content>
305:     });
306:   });
307: 
308:   describe("T041b/T041c - queue classifier in health", () => {
309:     it("Blocked graph node queued: NOT reported as queue_starved, reported as waiting_for_recovery", () => {
310:       const { project, workspace, issue, threadId } = setupProject(services, tempDir);
311:       const adapter = createAdapter(services, project.id, "Adapter");
312:       services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Blocked, updatedAt: new Date().toISOString() });
313:       const graphRun = services.runRepo.create({
314:         issue_id: issue.id,
315:         thread_id: "thread_test",
316:         workspace_id: workspace.id,
317:         adapt
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:48:23Z

- **tool**: `grep({"include": "server/tests/integration/runtime-health.test.ts", "output_mode": "content", "pattern": "\"thread_test\""})`


> [reasoning] I see two FK issues:

1. Line 315: `thread_id: "thread_test"` - this is still using the hardcoded "thread_test" instead of `threadId`. The `replace all` only fixed `createQueuedRun` calls, not direct `runRepo.create` calls that use `"thread_test"`.

2. Line 322: `node_run_id: "nr_test"` - this references a non-existent node_run. I need to create a real node_run or use a null node_run_id. But GraphNode runs require `node_run_id` (the repo enforces this). So I need to create a real node_run.

3. Line 338: `thread_id: "thread_test"` - same issue, hardcoded instead of `threadId`.

Let me fix all the `thread_id: "thread_test"` occurrences in direct `runRepo.create` calls.

For the GraphNode run, I need to create a real node_run. Let me check the NodeRunRepository to see how to create one.

Actually, looking at the test more carefully, the GraphNode test creates a graph run with `node_run_id: "nr_test"`. The `runs` table has `node_run_id TEXT REFERENCES node_runs(id)`. So I need a real node_run. 

Let me look at the NodeRunRepository to see how to create a node_run. But actually, creating a full graph run + node_run is complex. Let me check if there's a simpler way.

Actually, for the health test, I just need a queued GraphNode run. The health service only looks at the run's `role` and `issue_id` - it doesn't care about the `node_run_id`. So I could create a node_run with minimal fields.

Let me check the NodeRunRepository.create method.

Actually, let me take a simpler approach. Instead of creating a real graph node run through the repo (which requires a node_run), I can insert the run directly via SQL, bypassing the FK constraint by using `PRAGMA foreign_keys = OFF` temporarily, or by creating a minimal node_run row.

Wait, actually the FK constraint is at the database level. The `runRepo.create` method does an INSERT which triggers the FK. I need to either:
1. Create a real node_run first
2. Insert the run directly via SQL without the FK check

Let me look at how to create a node_run. Let me check the NodeRunRepository.

Actually, looking at the helpers.ts, `services.nodeRunRepo` is available. Let me check its create method.

Actually, let me just create a node_run via SQL directly. I need to know the node_runs table schema. Let me check.

Actually, a simpler approach: for the GraphNode test, I can create the run via SQL directly (not through `runRepo.create`), bypassing the invariant check. The run just needs to be in the `runs` table with `role = 'graph_node'` and `status = 'queued'`. The health service reads it via `runRepo.listQueuedByWorkspace` which uses `mapRow` - it doesn't care how the row was created.

But I still need a valid `node_run_id` that satisfies the FK. Or I can set `node_run_id` to NULL in the SQL insert, which should be fine since the FK allows NULL.

Wait, but the health service's `classifyQueuedRun` checks `run.role === RunRole.GraphNode`. So the run needs to have `role = 'graph_node'` in the DB. Let me just insert it via SQL with `node_run_id = NULL`.

Actually, the FK constraint on `node_run_id` is:
```sql
node_run_id TEXT REFERENCES node_runs(id)
```

A NULL `node_run_id` should pass the FK constraint (NULL FKs are always allowed in SQLite). So I can insert the run via SQL with `node_run_id = NULL`.

But wait - the `runRepo.create` method enforces the invariant:
```typescript
if ((role === RR.GraphNode) !== (nodeRunId !== null)) {
  throw new Error("Invariant violation: GraphNode runs require node_run_id, and only GraphNode runs may set it.");
}
```

This means GraphNode runs MUST have a non-null `node_run_id`. But I can bypass this by inserting directly via SQL. The health service doesn't use `runRepo.create` - it uses `runRepo.listQueuedByWorkspace` which just reads rows.

So for the test, I can insert the graph node run directly via SQL:
```typescript
services.db.prepare(
  `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, role, ...)
   VALUES (?, ?, ?, ?, ?, 'queued', 'graph_node', ...)`
).run(...);
```

This bypasses both the invariant check and the FK constraint (if node_run_id is NULL).

Actually, let me just create a real node_run. It's cleaner and tests the real path. Let me check the NodeRunRepository.

Actually, creating a node_run requires a graph_run, which requires a lot of setup. Let me just use SQL to insert the run directly. This is a test - the health service only reads the run, so how it's created doesn't matter.

Let me fix all three issues:
1. Replace all `thread_id: "thread_test"` with `thread_id: threadId` in direct `runRepo.create` calls
2. For the GraphNode run, insert via SQL with `node_run_id = NULL`
3. Fix the suggested_action for `lock_timestamp_invalid` to not contain "release"

Let me also check if there are other `thread_id: "thread_test"` occurrences.
I see the issues: hardcoded `"thread_test"` in direct `runRepo.create` calls, and the GraphNode FK. Let me find all occurrences:

  <details><summary>tool output</summary>

  ```text
Found 2 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\runtime-health.test.ts
  315: thread_id: "thread_test",
  338: thread_id: "thread_test",

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
- Agents can
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:48:39Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\runtime-health.ts", "newString": "            suggested_action:\n              \"Investigate the run and lock record manually; the holder is still running.\",", "oldString": "            suggested_action:\n              \"Investigate the run and lock record manually; do not release the lock while the holder is still running.\","})`


> [reasoning] I need to fix:
1. Line 315: `thread_id: "thread_test"` -> `thread_id: threadId` (in the GraphNode run creation)
2. Line 338: `thread_id: "thread_test"` -> `thread_id: threadId` (in the otherRun creation)
3. The GraphNode run also has `node_run_id: "nr_test"` which needs to be fixed

For the GraphNode run, I need to either:
- Create a real node_run (complex - requires graph_run setup)
- Insert the run via SQL bypassing the repo invariant

Let me go with inserting via SQL for the GraphNode run. This is simpler and the health service only reads the run data.

Let me fix the GraphNode test to use SQL insertion instead of `runRepo.create`. I'll also fix the thread_id in the otherRun creation.

For the suggested_action fix, I need to rephrase the `lock_timestamp_invalid` action to avoid the word "release". The design says "不建议直接释放" (don't suggest direct release). My current text says "do not release the lock while the holder is still running." The word "release" appears even though it's in a negative context. Let me rephrase to: "Investigate the run and lock record manually; the holder is still running and the workspace mutex must not be removed."

Actually, a simpler rephrase: "Investigate the run and lock record manually; the holder is still running."

This avoids the word "release" entirely while conveying the same intent.

Let me now make all three fixes.
Fixing all three issues. First, the `lock_timestamp_invalid` suggested_action to avoid the word "release":

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:48:51Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "    it(\"Blocked graph node queued: NOT reported as queue_starved, reported as waiting_for_recovery\", () => {\n      const { project, workspace, issue, threadId } = setupProject(services, tempDir);\n      const adapter = createAdapter(services, project.id, \"Adapter\");\n      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Blocked, updatedAt: new Date().toISOString() });\n
…[truncated])`

Now fixing the GraphNode test to use SQL insertion (bypasses the node_run_id FK) and fixing the otherRun's thread_id:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:49:01Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "      const otherRun = services.runRepo.create({\n        issue_id: issue.id,\n        thread_id: threadId,\n        workspace_id: workspace.id,", "oldString": "      const otherRun = services.runRepo.create({\n        issue_id: issue.id,\n        thread_id: \"thread_test\",\n        workspace_id: workspace.id,"})`

Now fixing the otherRun's `thread_id`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:49:10Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/integration/runtime-health.test.ts --reporter=verbose 2>&1 | Select-Object -First 80", "timeout": 120000})`


> [reasoning] Now let me also check if there are any other `thread_id: "thread_test"` occurrences in the file. Let me also verify the `RunRole` and `RunDispatchSource` imports are still used (since I removed the direct use of `RunRole.GraphNode` in the GraphNode test, but it's still used elsewhere).

Actually, I replaced the `runRepo.create` call with a SQL INSERT for the GraphNode test. The `RunRole.GraphNode` constant is no longer used in that test. But `RunRole` is still used in other tests (e.g., `RunRole.Implementation` in `createQueuedRun`). So the import is fine.

Let me also check if the `RunDispatchSource` import is still used. It was used in the `setupLockedWorkspace` function and in `createQueuedRun`. Both still use it. So the import is fine.

Let me run the tests again.
Now re-running the tests:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m

 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040 - five categories collected[2m > [22mcollects schema, background, workspaces (with adapters under workspace), and queue[32m 136[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040d - schema_version_mismatch[2m > [22mreports behind when expected > actual[32m 115[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT040d - schema_version_mismatch[2m > [22mreports ahead when actual > expected[32m 145[2mms[22m[39m
 [32m�?[39m server/
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:49:37Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npm -w @personahub/server run typecheck 2>&1 | Select-Object -Last 20", "timeout": 120000})`


> [reasoning] All 33 tests pass! Now let me run the typecheck and also the queue-drain-eligibility regression test one more time to make sure everything is clean.

Let me also run the LSP diagnostics on all changed files one final time.
All 33 tests pass. Now running typecheck and final LSP diagnostics:

  <details><summary>tool output</summary>

  ```text
> @personahub/server@0.1.0 typecheck
> tsc --noEmit
  ```
  </details>

## assistant · 2026-08-09T10:49:56Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/unit/queue-classifier.test.ts server/tests/integration/runtime-health.test.ts server/tests/integration/queue-drain-eligibility.test.ts --reporter=verbose 2>&1 | Select-Object -Last 30", "timeout": 120000})`


> [reasoning] Typecheck passes with no errors. Let me run the full test suite for my new and modified files one more time to confirm everything is clean, and also run the queue-drain-eligibility regression test.
Typecheck passes clean. Let me run all related tests one final time to confirm everything is green:

  <details><summary>tool output</summary>

  ```text
[32m�?[39m server/tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mordering[2m > [22mcontinues scanning after cancelling an ineligible queued run[32m 262[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT041 - stale_lock grading (prerequisite: adapter executionTimeoutMs)[2m > [22mover threshold: stale_lock_suspected[32m 137[2mms[22m[39m
 [32m�?[39m server/tests/integration/runtime-health.test.ts[2m > [22mRuntimeHealth (F008 Phase 4)[2m > [22mT041 - stale_lock grading (prerequisite: adapter executionTimeoutMs)[2m > [22mlocked_at illegal + holder missing: stale_lock_confirmed[32m 120[2mms[22m[39m
 [32m�?[39m server/tests/integration/run
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:50:26Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "severity": "all"})`


> [reasoning] All 76 tests pass (4 test files: queue-classifier unit test, runtime-health integration test, queue-drain-eligibility from both the main repo and the .claude/worktrees copy). Typecheck also passes.

Let me update my todo list and then verify one more thing - let me check that the `IssuePriority` and `IssueType` imports in the test file are actually used (they might be unused now). Let me also run LSP diagnostics on the test files one final time.

Actually, looking at the test imports:
```typescript
import {
  IssueStatus,
  RunRole,
  RunStatus,
  RunDispatchSource,
  AdapterStatus,
  AgentCapability,
  IssuePriority,
  IssueType,
} from "@personahub/shared/types";
```

`IssuePriority` and `IssueType` might not be used directly in the test. Let me check. If they're unused, the TypeScript compiler with `noUnusedLocals` might flag them. But the typecheck passed, so they must be used or the compiler doesn't flag unused imports.

Actually, looking at the test, `IssuePriority` and `IssueType` are not used directly. But the typecheck passed, which means the tsconfig doesn't have `noUnusedLocals` enabled, or the imports are used in some way I'm not seeing.

Wait, let me check - the typecheck passed without errors, so these imports are fine. Let me remove them anyway to be clean, but actually, the instructions say "no unrelated refactors" - so if the typecheck passes, I should leave them. But they're imports I added, so removing unused imports in my own file is not an "unrelated refactor".

Actually, let me check if they're used. Let me search for them in the test file.

Actually, the typecheck passed, so I'll leave it. The imports might be needed for type inference somewhere. Let me not touch it.

Now let me finalize. Let me update my todo list and prepare the deliverable report.

Let me also double-check: the test file has unused imports `IssuePriority` and `IssueType`. Since typecheck passes (no `noUnusedLocals`), this is fine. But let me clean them up since they're my additions.

Actually, let me check if LSP flags them as warnings.
All 76 tests pass across 4 test files. Typecheck clean. Let me do a final LSP check on all modified files and clean up any unused imports:

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:50:48Z

- **tool**: `grep({"include": "server/tests/integration/runtime-health.test.ts", "output_mode": "content", "pattern": "IssuePriority|IssueType"})`


> [reasoning] No diagnostics at all, not even warnings about unused imports. The imports must be used somewhere (perhaps TypeScript's type inference uses them). Since typecheck passes and LSP is clean, I'll leave the imports as-is.

Let me also check the modified files for diagnostics:
- run-dispatch.ts
- adapter-config.ts
- adapter-failure-reprobe.ts
- runtime-health.ts
- queue-classifier.ts
- runtime-health route

I already checked these earlier and they were clean. Let me do a final check on the route file and run-dispatch.ts since they were modified.

Actually, I already checked all of them and they were clean. Let me update my todo list and prepare the final report.

Let me now prepare the deliverable report. I need to provide:
1. Which task IDs done/verified
2. Test files created
3. Exact RuntimeHealthService constructor signature
4. Exact registerRoutes + Services additions needed for server/src/index.ts and server/src/api/index.ts (as snippets I did NOT apply)
5. Confirm drain behavior is unchanged

Let me compile this information.

For the `registerRoutes` and `Services` additions:

In `server/src/api/index.ts`:
- Add import: `import { runtimeHealthRoutes } from "./routes/runtime-health.js";`
- Add import: `import type { RuntimeHealthService } from "../services/runtime-health.js";`
- Add to `Services` interface: `runtimeHealthService: RuntimeHealthService;`
- Add to `registerRoutes`: `app.register(runtimeHealthRoutes, { runtimeHealthService: services.runtimeHealthService, projectRepo: services.projectRepo });`

In `server/src/index.ts`:
- Add import: `import { RuntimeHealthService } from "./services/runtime-health.js";`
- Construct: `const runtimeHealthService = new RuntimeHealthService(db, workspaceRepo, agentConfigRepo, adapterWorkspaceStatusRepo, runRepo, issueRepo, adapterConfigService, runDispatchService);`
- Add to `registerRoutes` call: `runtimeHealthService,`

Let me also clean up the unused imports in the test file. Actually, the LSP said no diagnostics, so there are no unused import warnings. Let me leave it.

Wait, let me re-check the test file for `IssuePriority` and `IssueType` usage. These are imported but might not be used.
Let me clean up potentially unused imports in the test file:

  <details><summary>tool output</summary>

  ```text
Found 2 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\runtime-health.test.ts
  15: IssuePriority,
  16: IssueType,

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
```

WHY:
- Agents can perform deeper, more thorou
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:51:00Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "newString": "import {\n  IssueStatus,\n  RunRole,\n  RunStatus,\n  RunDispatchSource,\n  AdapterStatus,\n  AgentCapability,\n} from \"@personahub/shared/types\";", "oldString": "import {\n  IssueStatus,\n  RunRole,\n  RunStatus,\n  RunDispatchSource,\n  AdapterStatus,\n  AgentCapability,\n  IssuePriority,\n  IssueType,\n} from \"@personahub/shared/types\";"})`


> [reasoning] These two imports (`IssuePriority` and `IssueType`) are only used in the import statement, not in the code. They're unused imports. Since the TypeScript compiler doesn't flag them (no `noUnusedLocals`), the typecheck passes. But I should remove them to be clean since they're my additions.

Let me remove them.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:51:08Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\runtime-health.test.ts", "severity": "error"})`


> [reasoning] Let me verify the test still passes after removing those imports. Actually, the LSP didn't flag them, so they were just unused. Let me run a quick check.

Actually, let me also verify the final state of all files by running LSP diagnostics one more time and a quick test run.
Let me verify the test still passes after cleanup, and run a final LSP check:

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:51:15Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx vitest run server/tests/integration/runtime-health.test.ts 2>&1 | Select-Object -Last 10", "timeout": 120000})`

  <details><summary>tool output</summary>

  ```text
[32m�?[39m server/tests/integration/runtime-health.test.ts [2m([22m[2m33 tests[22m[2m)[22m[33m 4585[2mms[22m[39m
   [33m[2m�?[22m[39m RuntimeHealth (F008 Phase 4)[2m > [22mT040e - same adapter differs across workspaces[2m > [22mpresents adapter separately per workspace, not merged [33m 333[2mms[22m[39m
   [33m[2m�?[22m[39m RuntimeHealth (F008 Phase 4)[2m > [22mT043 - route[2m > [22mvalid workspace_id returns health [33m 435[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m33 passed[39m[22m[90m (33)[39m
[2m   Start at [22m 18:51:24
[2m   Duration [22m 12.31s[2m (transform 1.38s, setup 0ms, collect 5.25s, tests 4.58s, environment 0ms, prepare 415ms)[22m
  ```
  </details>

## assistant · 2026-08-09T10:51:38Z

- **tool**: `todowrite({"todos": [{"content": "Read all key existing code files", "priority": "high", "status": "completed"}, {"content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)", "priority": "high", "status": "completed"}, {"content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)", "priority": "high", "status": "completed"}, {"content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)", "priority":
…[truncated])`


> [reasoning] All 33 tests pass after cleanup. Let me update my todo list and prepare the final report.

Let me do a final comprehensive check:
1. All source files created/modified
2. All tests pass
3. Typecheck passes
4. LSP diagnostics clean

Let me also verify the run-dispatch.ts refactor is correct by checking the refactored section one more time.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all key existing code files",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extract queue-classifier.ts pure function from startNextQueuedRun (T041b)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Refactor startNextQueuedRun to use shared classifier (behavior-preserving)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Add healthSnapshot accessors to AdapterConfigService, AdapterFailureReprobe, RunDispatchService (T040b)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create RuntimeHealthService (server/src/services/runtime-health.ts)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create API route (server/src/api/routes
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:51:45Z

All 9 steps complete. Here's the deliverable report.

---

## Deliverable Report

### Task IDs Done/Verified

| Task | Status |
|------|--------|
| T040 (five categories collected; adapter under workspace grouping; schema actual/expected/status) | ✅ verified |
| T040b (healthSnapshot accessors; Set not exposed) | ✅ verified |
| T040d (behind and ahead both produce schema_version_mismatch) | ✅ verified |
| T040e (same adapter Available in ws A, Unavailable in B -> separate, not merged) | ✅ verified |
| T041 (stale_lock five cases + executionTimeoutMs assertion) | ✅ verified |
| T041b (classifier extracted; drain regression passes; health uses classifier) | ✅ verified |
| T041c (Blocked graph node NOT queue_starved; eligible+lock occupied -> no diagnostic; eligible+lock free -> single queue_starved) | ✅ verified |
| T041d (no_available_adapter) | ✅ verified |
| T041e (waiting_for_validation_due; NOT queue_starved) | ✅ verified |
| T041f (due-time boundaries: not yet due, within grace, past grace) | ✅ verified |
| T042 (read-only: no probe, no lock, no writes) | ✅ verified |
| T043 (route: valid/invalid/cross-project/omitted/nonexistent project) | ✅ verified |

### Files Created/Modified

**New files:**
- `server/src/services/queue-classifier.ts` — pure `classifyQueuedRun(run, issue)` function
- `server/src/services/runtime-health.ts` — `RuntimeHealthService` with `collect(projectId, workspaceId?)`
- `server/src/api/routes/runtime-health.ts` — `GET /api/projects/:projectId/health/runtime`
- `server/tests/unit/queue-classifier.test.ts` — 23 unit tests
- `server/tests/integration/runtime-health.test.ts` — 33 integration tests

**Modified files:**
- `server/src/services/run-dispatch.ts` — `startNextQueuedRun` refactored to use `classifyQueuedRun`; added `healthSnapshot()` forwarding to `failureReprobe`
- `server/src/services/adapter-config.ts` — added `healthSnapshot(): { pendingProbeCount: number }`
- `server/src/services/adapter-failure-reprobe.ts` — added `healthSnapshot(): { pendingReprobeCount: number }`

### Test Results
- **76 tests pass** (23 unit + 33 integration + 20 queue-drain-eligibility regression)
- `npm -w @personahub/server run typecheck` — clean
- LSP diagnostics — clean on all files

### Drain Behavior Unchanged

The refactored `startNextQueuedRun` preserves exact behavior:
- `issue null` → silently `continue` (no cancel) — same as original `if (!issue) continue`
- `invalid_queued_run` + `issue.status === Blocked` → `cancelQueued(run.id, "issue_blocked_before_start")`
- `invalid_queued_run` + any other cause → `cancelQueued(run.id, "issue_state_changed_before_start")`
- `waiting_for_recovery` (Blocked GraphNode) → `continue` (no cancel)
- `eligible_but_not_running` → proceed to lock acquire + dispatch

The queue-drain-eligibility regression test (20 cases) passes unchanged.

### Exact RuntimeHealthService Constructor Signature

```typescript
constructor(
  private db: Database.Database,
  private workspaceRepo: WorkspaceRepository,
  private agentConfigRepo: AgentConfigRepository,
  private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
  private runRepo: RunRepository,
  private issueRepo: IssueRepository,
  private adapterConfigService: AdapterConfigService,
  private runDispatchService: RunDispatchService,
  private expectedSchemaVersion: number = EXPECTED_SCHEMA_VERSION, // = 10
)
```

### Snippets for Orchestrator (NOT applied)

**`server/src/index.ts` additions:**

```typescript
// Add import:
import { RuntimeHealthService } from "./services/runtime-health.js";

// After runDispatchService construction (~line 222):
const runtimeHealthService = new RuntimeHealthService(
  db,
  workspaceRepo,
  agentConfigRepo,
  adapterWorkspaceStatusRepo,
  runRepo,
  issueRepo,
  adapterConfigService,
  runDispatchService,
);

// Add to registerRoutes call object (~line 367-404):
runtimeHealthService,
```

**`server/src/api/index.ts` additions:**

```typescript
// Add imports:
import { runtimeHealthRoutes } from "./routes/runtime-health.js";
import type { RuntimeHealthService } from "../services/runtime-health.js";

// Add to Services interface:
runtimeHealthService: RuntimeHealthService;

// Add to registerRoutes function body:
app.register(runtimeHealthRoutes, {
  runtimeHealthService: services.runtimeHealthService,
  projectRepo: services.projectRepo,
});
```
