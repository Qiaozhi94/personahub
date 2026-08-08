---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_02ddc44d8ffeN89Y3B7YlF844O"
title: "Implement resolve-executors endpoint (@Sisyphus-Junior subagent)"
project: "D:/Projects/personahub"
model: "deepseek-v4-pro"
created_at: "2026-08-05T13:36:24Z"
updated_at: "2026-08-05T13:40:36Z"
tokens_input: 56193
tokens_output: 2670
cost: 0.0
parent_id: "ses_03ef5d0faffej5Zj3DPo6UYZHA"
---

# Implement resolve-executors endpoint (@Sisyphus-Junior subagent)

## user · 2026-08-05T13:36:24Z

Implement the `POST /api/graph-runs/:graphRunId/resolve-executors` endpoint for the PersonaHub project. This is the ONLY remaining GraphBlockReason that has no recovery entry point (`no_capable_adapter`).

File to modify: `server/src/api/routes/graph.ts` and `server/src/services/graph-recovery.ts`

The endpoint must be added to the graph routes in `server/src/api/routes/graph.ts`, inside the `graphRoutes` function callback (after the existing cancel endpoint at ~line 205).

SPECIFICATION:
```
POST /api/graph-runs/:graphRunId/resolve-executors
Body: { node_assignments: Record<string, string> } — map from node_key to adapter_config_id
```

BEHAVIOR:
1. Validate graphRun exists, is not terminal, not cancelling
2. Validate `node_assignments` covers each node listed in `graphRun.blocked_node_keys` (each blocked node must have an entry)
3. For each blocked node:
   a. Resolve adapter using `resolveEligibleAdapter()` from the shared adapter-eligibility module
   b. If any adapter resolution fails → return error, do NOT partially update
   c. Update `nodeRuns.assigned_adapter_config_id` to the new value
   d. CAS the nodeRun to `ready` if it was in `failed`/`interrupted` state (not `completed`)
4. For each ready node: create a new queued Run (Attempt) — reuse instructions from the last Run for that nodeRun, or use "retry" as fallback
5. For the synthesis node (if it's in blocked_node_keys and got a new adapter): re-check join condition before creating an Attempt — don't create one if precursors aren't both completed
6. Transition graphRun from Blocked to Running, clear `blocked_reason_code` and `blocked_node_keys`
7. Transition Issue from Blocked to Running
8. Write `graph.node_queued` events for each new Attempt created
9. Write `graph.executor_reassigned` audit event
10. Trigger drainWorkspace
11. Return 202 with list of created run_ids

IMPORTANT CONSTRAINTS:
- All DB writes must happen in a single transaction
- Events must be written inside the transaction, broadcasted after commit
- Return 409 if graph is cancelling (GRAPH_RUN_CANCELLING)
- Return 400 if nodeAssignments is empty or missing blocked nodes
- Return 400 if any adapter is ineligible (ADAPTER_CAPABILITY_MISSING etc.)
- Use zod for input validation: `z.object({ node_assignments: z.record(z.string()) })`

IMPLEMENTATION APPROACH:
1. First read the FULL file `server/src/api/routes/graph.ts` to understand structure
2. Read `server/src/services/adapter-eligibility.ts` for `resolveEligibleAdapter` signature
3. Read `shared/src/types/index.ts` for relevant enums (NodeRunStatus, IssueStatus, GraphRunStatus, etc.)
4. Read `server/src/services/graph-recovery.ts` for GraphRecoveryDeps interface
5. Add the endpoint to graph.ts after the cancel endpoint
6. Add necessary imports at the top of graph.ts
7. Use existing patterns: `parseRequestBody`, `AppError`/`ErrorCode`, `deps.*` for service calls
8. Verify with tsc --noEmit

EXISTING CODE PATTERNS TO FOLLOW:
- Use `graphRunRepo.compareAndSetStatus()` with patch for clearing blocker fields
- Use `nodeRunRepo.compareAndSetStatus()` for node status transitions  
- Use `runRepo.create()` for new attempts
- Use `deps.threadEventService.write()` + `deps.threadEventService.broadcast()` for events
- Use `deps.runDispatchService.drainWorkspace()` for draining

CONTEXT:
- `IssueStatus.Running` = "Running", `IssueStatus.Blocked` = "Blocked"
- `GraphRunStatus.Blocked` = "blocked", `GraphRunStatus.Running` = "running"
- `NodeRunStatus.Failed` = "failed", `NodeRunStatus.Ready` = "ready"
- `deps` has: graphRunRepo, nodeRunRepo, runRepo, issueRepo, threadEventService, runDispatchService
- ThreadEventType.GraphNodeQueued is already defined
- `resolveEligibleAdapter` returns `{ ok: true; adapterConfigId: string } | { ok: false; errorCode: ErrorCode }`

After implementation, run: `cd D:/Projects/personahub && npx tsc -p server/tsconfig.json --noEmit` to verify no type errors.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-08-05T13:36:24Z

- **tool**: `todowrite({"todos": [{"content": "Read server/src/api/routes/graph.ts to understand structure and patterns", "status": "in_progress", "priority": "high"}, {"content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature", "status": "pending", "priority": "high"}, {"content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface", "status": "pending", "priority": "high"}, {"content": "Read shared/src/types/index.ts for relevant enums", "status": "pendi
…[truncated])`


> [reasoning] Let me start by reading the files I need to understand the codebase structure before implementing.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read server/src/api/routes/graph.ts to understand structure and patterns",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Read shared/src/types/index.ts for relevant enums",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Add endpoint to graph.ts after cancel endpoint",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Add necessary imports to graph.ts",
    "status": "pending",
    "pri
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T13:36:41Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\graph.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-eligibility.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\graph-recovery.ts"})`


> [reasoning] Let me read all the necessary files in parallel.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\api\routes\graph.ts</path>
<type>file</type>
<content>
1: import type { FastifyInstance } from "fastify";
2: import type Database from "better-sqlite3";
3: import type { GraphRunRepository } from "../../repositories/graph-run.js";
4: import type { NodeRunRepository } from "../../repositories/node-run.js";
5: import type { RunRepository } from "../../repositories/run.js";
6: import type { IssueRepository } from "../../repositories/issue.js";
7: import type { WorkspaceRepository } from "../../repositories/workspace.js";
8: import type { ThreadRepository } from "../../repositories/thread.js";
9: import type { ThreadEventRepository } from "../../repositories/thread-event.js";
10: import type { AgentConfigRepository } from "../../repositories/agent-config
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\adapter-eligibility.ts</path>
<type>file</type>
<content>
1: import type { AgentCapability } from "@personahub/shared/types";
2: import { ErrorCode } from "@personahub/shared/errors";
3: import { resolveAdapter } from "./adapter-resolver.js";
4: import { hasCapability } from "../repositories/agent-config.js";
5: import type { AdapterResolverDeps } from "./adapter-resolver.js";
6: import type { RunDispatchSource } from "@personahub/shared/types";
7: 
8: export interface EligibleAdapterInput {
9:   explicitAdapterId?: string | null;
10:   requiredCapabilities: AgentCapability[];
11: }
12: 
13: export type EligibleAdapterResult =
14:   | { ok: true; adapterConfigId: string; source: RunDispatchSource }
15:   | { ok: false; errorCode: ErrorCode }
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\graph-recovery.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run } from "@personahub/shared/types";
3: import type { GraphRunRepository } from "../repositories/graph-run.js";
4: import type { NodeRunRepository } from "../repositories/node-run.js";
5: import type { RunRepository } from "../repositories/run.js";
6: import type { IssueRepository } from "../repositories/issue.js";
7: import type { ThreadEventRepository } from "../repositories/thread-event.js";
8: import type { AgentConfigRepository } from "../repositories/agent-config.js";
9: import type { ProjectRepository } from "../repositories/project.js";
10: import type { AdapterWorkspaceStatusRepository } from "../repositories/adapte
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T13:36:50Z

- **tool**: `todowrite({"todos": [{"content": "Read server/src/api/routes/graph.ts to understand structure and patterns", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface", "priority": "high", "status": "completed"}, {"content": "Read shared/src/types/index.ts for relevant enums", "priority": "h
…[truncated])`


> [reasoning] Now I have a good understanding of the codebase. Let me analyze what I see:

1. The `resolve-executors` endpoint is ALREADY IMPLEMENTED in `graph.ts` starting at line 282. Let me read it more carefully.

Wait, let me look at the file again. The endpoint at line 282-443 is already there! But wait, the user asked me to implement it. Let me check if this is the current state of the file...

Actually, looking at the file content more carefully, the endpoint IS already implemented in the file. Lines 282-443 contain the full implementation. But the user is asking me to implement it. Let me re-read the instructions...

The user says: "Implement the `POST /api/graph-runs/:graphRunId/resolve-executors` endpoint for the PersonaHub project. This is the ONLY remaining GraphBlockReason that has no recovery entry point (`no_capable_adapter`)."

But looking at the file, it's already there! Maybe this is a test? Or maybe the user wants me to review/improve it?

Wait, let me re-read the specification more carefully against what's in the file...

Actually, the file I read was 444 lines long and the resolve-executors endpoint is already there on lines 282-443. Let me look at this more carefully...

The spec says:
- File to modify: `server/src/api/routes/graph.ts` and `server/src/services/graph-recovery.ts`
- The endpoint must be added "after the existing cancel endpoint at ~line 205"

But it's already there at line 282. This seems like the endpoint has already been implemented.

Let me check if there's something wrong with the current implementation that needs fixing, or if the user is asking me to review it.

Actually, wait - let me re-read the user's request more carefully. They say "Implement the endpoint" - but it's already there. Maybe the issue is that the implementation is incomplete or wrong? Let me compare it against the specification more carefully.

Looking at the specification:
1. ✅ Validate graphRun exists, is not terminal, not cancelling
2. ✅ Validate node_assignments covers each blocked node
3. For each blocked node:
   a. ✅ Resolve adapter using resolveEligibleAdapter
   b. ✅ If any adapter resolution fails → return error, do NOT partially update
   c. ✅ Update nodeRuns.assigned_adapter_config_id to the new value
   d. ✅ CAS the nodeRun to ready if it was in failed/interrupted state
4. ✅ For each ready node: create a new queued Run
5. ✅ For synthesis node: re-check join condition
6. ✅ Transition graphRun from Blocked to Running
7. ✅ Transition Issue from Blocked to Running
8. ✅ Write graph.node_queued events
9. ✅ Write graph.executor_reassigned audit event
10. ✅ Trigger drainWorkspace
11. ✅ Return 202

Wait, the spec says "Return 202 with list of created run_ids" but the current implementation doesn't explicitly set reply.code(202). Let me check...

Actually, looking at the current implementation, it returns `{ graph_run_id, status, reassigned, queued_run_ids }` without setting `reply.code(202)`. But the retry endpoint does set `reply.code(202)`.

Also, the spec says "Return 202 with list of created run_ids" - and the current implementation uses `queued_run_ids` not `run_ids`.

Let me check more carefully...

Actually, I think the user might have already implemented this endpoint and is asking me to verify/fix it. But their wording is "Implement the endpoint" which suggests it should be new.

Hmm, let me look at the git status to see if this file has been modified recently.

Actually, looking at this more carefully, I think the endpoint IS already in the file. The user's request might be a test to see if I notice, or they might want me to verify it works correctly.

Let me check if there are any issues with the current implementation:

1. The spec says "Return 202" - the current implementation doesn't set `reply.code(202)`. The retry endpoint at line 212 does `reply.code(202)`.

2. The spec says "Return 202 with list of created run_ids" - the current implementation returns `queued_run_ids`.

3. The `resolveEligibleAdapter` function signature in the actual file returns `{ ok: true; adapterConfigId: string; source: RunDispatchSource }` not just `{ ok: true; adapterConfigId: string }`. The current code uses `eligibility.ok` and `eligibility.adapterConfigId` which is fine, but it doesn't handle the `source` field.

4. The spec says "Use zod for input validation: `z.object({ node_assignments: z.record(z.string()) })`" - which is already done.

5. Looking at line 300: `if (gr.status !== GraphRunStatus.Blocked || gr.blocked_reason_code !== "no_capable_adapter")` - this checks that the graph is blocked specifically for `no_capable_adapter`, which matches the spec.

Wait, let me check the `GraphRunStatus` enum values. The spec says:
- `GraphRunStatus.Blocked` = "blocked"
- `GraphRunStatus.Running` = "running"

But the code uses `GraphRunStatus.Blocked` at line 300 and `GraphRunStatus.Running` at line 425. Let me check if these are the correct enum values...

Actually, looking at the import: `import { ..., GraphRunStatus } from "@personahub/shared/types"`. The spec says these values are strings. The current code uses `GraphRunStatus.Blocked` and `GraphRunStatus.Running` which should be the enum members.

But wait, there's also `GraphRunStatus.Cancelling` at line 294 - the spec says "GRAPH_RUN_CANCELLING" with status "cancelling"? Let me check...

Actually, looking at the cancel endpoint at line 172: `gr.status === "cancelling" as never`. And at line 294: `gr.status === GraphRunStatus.Cancelling`. These should be the same thing.

Let me look at the types to understand the enum values.

Actually, I think the main issue is that the endpoint is ALREADY implemented. Let me verify by running tsc to see if there are any type errors, and then report to the user.

Wait, actually, re-reading the user's request one more time... "Implement the POST /api/graph-runs/:graphRunId/resolve-executors endpoint"

They say "File to modify: server/src/api/routes/graph.ts and server/src/services/graph-recovery.ts"

But the endpoint is already in graph.ts. Maybe they want me to add something to graph-recovery.ts? Let me check if there's anything missing there...

Looking at graph-recovery.ts, it doesn't have any resolve-executors logic. But the spec says to add the endpoint to graph.ts, not graph-recovery.ts. The spec says "File to modify: server/src/api/routes/graph.ts and server/src/services/graph-recovery.ts" - but looking at the implementation, it's all in graph.ts.

Hmm, maybe the user wants me to verify the endpoint is correct and also add something to graph-recovery.ts? Or maybe they want me to extract the logic into graph-recovery.ts?

Actually, looking at the spec again more carefully, I think the user might have a stale version of the file and doesn't realize the endpoint is already there. OR, the endpoint was added but there are issues with it.

Let me just verify there are no type errors and report back. Let me also check if there are any issues with the implementation.

Actually, I think the endpoint IS already implemented and working. Let me verify with tsc and report. But let me also check if there are any issues:

1. Missing `reply.code(202)` - the spec says "Return 202" but the code doesn't set the status code explicitly. However, Fastify might default to 200 for POST, so this could be a bug.

2. The spec says "Return 202 with list of created run_ids" but the current code returns `queued_run_ids`.

3. Looking at the implementation more carefully, it seems quite complete and well-written. Let me check for any type errors.

Let me just run tsc and see if it compiles correctly.

Actually wait, let me re-read one more time. The user says "This is the ONLY remaining GraphBlockReason that has no recovery entry point (no_capable_adapter)." - maybe the endpoint was recently added and they want me to verify it's complete?

Or maybe they want me to add something to graph-recovery.ts to handle the `no_capable_adapter` block reason during recovery?

Looking at graph-recovery.ts line 107-108:
```typescript
if (graphRun.status === GraphRunStatus.Blocked) {
  if (graphRun.blocked_reason_code !== "definition_version_unavailable") continue;
```

This means that during recovery, only `definition_version_unavailable` is handled automatically. All other blocked reasons (including `no_capable_adapter`) are skipped with `continue`. This is correct behavior - `no_capable_adapter` requires user action (the resolve-executors endpoint).

So the endpoint IS already implemented and the recovery logic correctly skips it. The user might be asking me to verify it.

Let me just run tsc to check for type errors and report back.

Actually, I just realized - maybe the user is giving me a task and the file I read already has the implementation because it was done in a previous session? The user might not know it's already implemented.

Let me just verify the implementation against the spec, check for any issues, run tsc, and report.

Let me look at one more thing - the GraphRunStatus enum values. Let me read the types file.
Now let me read the shared types to verify enum values and check if there's anything missing.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read server/src/api/routes/graph.ts to understand structure and patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read shared/src/types/index.ts for relevant enums",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Add endpoint to graph.ts after cancel endpoint",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Add necessary imports to graph.ts",
    "status": "pending",
  
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T13:37:35Z

- **tool**: `grep({"path": "D:\\Projects\\personahub\\shared\\src\\types", "pattern": "GraphRunStatus|GraphBlockReason|ThreadEventType\\.GraphNodeQueued|GraphExecutorReassigned|NodeRunStatus|IssueStatus", "output_mode": "content"})`
- **tool**: `grep({"path": "D:\\Projects\\personahub\\server\\src\\repositories", "pattern": "updateAssignedAdapter", "output_mode": "content"})`


> [reasoning] Let me read the shared types file to check the enum values.

  <details><summary>tool output</summary>

  ```text
Found 16 match(es) in 3 file(s)

D:\Projects\personahub\shared\src\types\validation.ts
  2: import type { IssueStatus, RunSummary, Issue, Run } from "./index.js";
  130: status: IssueStatus;

D:\Projects\personahub\shared\src\types\index.ts
  39: status: IssueStatus;
  105: export enum IssueStatus {
  165: GraphExecutorReassigned = "graph.executor_reassigned",

D:\Projects\personahub\shared\src\types\graph.ts
  6: export enum GraphRunStatus {
  16: export enum NodeRunStatus {
  28: export enum GraphBlockReason {
  51: status: GraphRunStatus;
  52: blocked_reason_code: GraphBlockReason | null;
  67: status: NodeRunStatus;
  75: /** Non-terminal GraphRunStatus values — used by the partial unique
  77: export const NON_TERMINAL_GRAPH_STATUSES: readonly GraphRunStatus[] = [
  78: GraphRunStatu
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 1 match(es) in 1 file(s)

D:\Projects\personahub\server\src\repositories\node-run.ts
  129: updateAssignedAdapter(id: string, adapterConfigId: string): NodeRun {

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

## assistant · 2026-08-05T13:37:45Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\graph.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 100, "limit": 80})`


> [reasoning] Let me read the enum definitions to verify the values.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\graph.ts</path>
<type>file</type>
<content>
1: // F006: Orchestrated Coding Graph Slice — graph-level types.
2: // GraphRun / NodeRun lifecycles are defined in design.md §7.
3: 
4: /** Non-terminal statuses include cancelling: the graph is waiting for
5:  *  running Attempts to exit, and must not be replaced by a new graph. */
6: export enum GraphRunStatus {
7:   Running = "running",
8:   Blocked = "blocked",
9:   Cancelling = "cancelling",
10:   Completed = "completed",
11:   Cancelled = "cancelled",
12: }
13: 
14: /** NodeRun lifecycle: pending (join unsatisfied) → ready (Attempt queued)
15:  *  → running → completed | failed | interrupted | cancelled. */
16: export enum NodeRunStatus {
17:   Pending = "pending",
18:   Ready = "ready",
19:   
…[truncated]
  ```
  </details>

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

## assistant · 2026-08-05T13:37:52Z

- **tool**: `todowrite({"todos": [{"content": "Read server/src/api/routes/graph.ts to understand structure and patterns", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface", "priority": "high", "status": "completed"}, {"content": "Read shared/src/types/index.ts for relevant enums", "priority": "h
…[truncated])`


> [reasoning] Now I have full clarity. The endpoint IS already implemented in `graph.ts` (lines 282-443). Let me verify:

1. The endpoint matches all the spec requirements
2. The enum values match what the spec describes
3. Check for any issues with the implementation

Let me go through the spec point by point:

**SPEC: Validate graphRun exists, is not terminal, not cancelling**
- ✅ Line 290-291: `gr = graphRunRepo.getById(graphRunId)` + not found check
- ✅ Line 294: `gr.status === GraphRunStatus.Cancelling` → `GRAPH_RUN_CANCELLING`
- ✅ Line 297: `gr.status === GraphRunStatus.Completed || gr.status === GraphRunStatus.Cancelled` → `GRAPH_RUN_TERMINAL`
- ✅ Line 300: Also checks `gr.status !== GraphRunStatus.Blocked || gr.blocked_reason_code !== "no_capable_adapter"` → `RECOVERY_ACTION_NOT_APPLICABLE`

**SPEC: Validate node_assignments covers each blocked node**
- ✅ Lines 322-337: Maps each targetKey, throws if missing

**SPEC: For each blocked node, resolve adapter, update, CAS**
- ✅ Lines 330-333: `resolveEligibleAdapter` call
- ✅ Line 334: throws if not eligible
- ✅ Line 345: `nodeRunRepo.updateAssignedAdapter()`
- ✅ Lines 379-384: CAS to `Ready`

**SPEC: All DB writes in single transaction**
- ✅ Line 343: `deps.db.transaction(() => { ... })`

**SPEC: Events written inside transaction, broadcasted after commit**
- ✅ Lines 348-351: `GraphExecutorReassigned` events written inside transaction
- ✅ Lines 403-407: `GraphNodeQueued` events written inside transaction
- ✅ Lines 431-433: broadcasted after transaction

**SPEC: Return 409 if cancelling**
- ✅ Line 294-296: Returns `GRAPH_RUN_CANCELLING` (409 error)

**SPEC: Return 400 if nodeAssignments empty or missing blocked nodes**
- ✅ Line 324: throws `GRAPH_PLAN_INCOMPLETE` if missing

**SPEC: Return 400 if any adapter ineligible**
- ✅ Line 334: throws `NO_CAPABLE_ADAPTER`

**SPEC: Zod validation**
- ✅ Lines 282-284: `resolveExecutorsSchema` with `z.record(z.string())`

**SPEC: Return 202 with list of created run_ids**
- ⚠️ Line 437-442: Returns `{ graph_run_id, status, reassigned, queued_run_ids }` - but does NOT set `reply.code(202)`. The spec says "Return 202". The retry endpoint line 212 sets `reply.code(202)`. This is a minor issue but not a type error.

**SPEC: Trigger drainWorkspace**
- ✅ Line 435: `await deps.runDispatchService.drainWorkspace(gr.workspace_id)`

**SPEC: Synthesis node re-check join condition**
- ✅ Lines 360-377: Checks incoming edges, join satisfaction, creates inputPayloads

**SPEC: GraphNodeQueued events**
- ✅ Lines 403-407

**SPEC: GraphExecutorReassigned audit event**
- ✅ Lines 348-351

**SPEC: Transition graphRun from Blocked to Running**
- ✅ Lines 425-427

**SPEC: Transition Issue from Blocked to Running**
- ✅ Line 428

So the endpoint is fully implemented! The only minor issue is that `reply.code(202)` is not explicitly set. But Fastify might default to 200 for the response. Let me check if the spec explicitly says 202...

Actually, let me just run `tsc --noEmit` to verify no type errors. Then I'll report that the endpoint is already implemented and check for any issues.

Wait, actually I should double-check one thing. The spec says "Return 202" but the current implementation doesn't set reply.code(202). Let me check if there's a `reply` parameter in the handler...

Looking at line 286: `app.post("/api/graph-runs/:graphRunId/resolve-executors", async (request) => {`

The handler only takes `request`, not `reply`. Compare with the retry endpoint at line 168: `app.post("/api/graph-runs/:graphRunId/nodes/:nodeKey/retry", async (request, reply) => {`

The retry endpoint has `reply` and sets `reply.code(202)`. The resolve-executors endpoint doesn't have `reply` in its signature.

This is a discrepancy. The spec says "Return 202" but the current implementation doesn't set the status code. This could be intentional (Fastify defaults to 200 for POST) or a bug.

Let me just run tsc and verify the types are clean. Then I'll fix the minor issue with reply.code(202).

Actually wait, I should re-read the user's request more carefully. They say "Implement the endpoint". Maybe they have a version of the file WITHOUT the endpoint? Let me check git status to see if this is a recent addition.

Actually, the file I read has 444 lines and the endpoint is at lines 282-443. The user says "after the existing cancel endpoint at ~line 205" which is consistent with the current file structure. So the endpoint is already there.

I think the user's request might be outdated, or they want me to verify it works. Let me just run tsc and if there are no errors, report that the endpoint is already implemented and working correctly.

But wait - the spec also says "File to modify: server/src/api/routes/graph.ts and server/src/services/graph-recovery.ts". The graph-recovery.ts file doesn't have any resolve-executors logic. Let me check if there's supposed to be something there...

Looking at graph-recovery.ts, the `reconcile()` method at line 107-108:
```typescript
if (graphRun.status === GraphRunStatus.Blocked) {
  if (graphRun.blocked_reason_code !== "definition_version_unavailable") continue;
```

This correctly skips `no_capable_adapter` blocked graphs during recovery - they need user action via the resolve-executors endpoint. So no changes needed in graph-recovery.ts.

OK, I think the endpoint is already implemented. Let me just verify with tsc and report.

Actually, let me ALSO check the `reply` parameter issue. The spec says "Return 202". Let me look at the handler signature again...

Line 286: `app.post("/api/graph-runs/:graphRunId/resolve-executors", async (request) => {`

The handler doesn't accept `reply`. But the spec says 202. Let me add `reply` to the signature and set `reply.code(202)`.

But wait, looking at the Fastify docs, when you return an object, the default status code is 200. If the spec explicitly says 202, we should add `reply` and set the code.

Actually, let me just run tsc first and see if there are any issues. Then I'll fix the reply.code(202) issue.

Hmm, but actually on second thought, I should just trust what the file says. The endpoint is already implemented. The user asked me to implement it, but it's already there. Maybe this is a test to see if I notice and report it, or maybe the user wants me to verify it.

Let me just run tsc and then report the findings.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read server/src/api/routes/graph.ts to understand structure and patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read shared/src/types/index.ts for relevant enums",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Verify endpoint implementation against spec and fix any issues",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Verify with tsc --noEmit",
    "status": "pen
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T13:38:30Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\graph.ts", "oldString": "app.post(\"/api/graph-runs/:graphRunId/resolve-executors\", async (request) => {", "newString": "app.post(\"/api/graph-runs/:graphRunId/resolve-executors\", async (request, reply) => {"})`


> [reasoning] The endpoint is already fully implemented at lines 282-443. Let me now identify the issues:

1. **Missing `reply.code(202)`**: The spec says "Return 202". The handler signature is `async (request)` without `reply`. Compare with the retry endpoint at line 168: `async (request, reply)` with `reply.code(202)` at line 212.

2. The spec also mentions `graph-recovery.ts` as a file to modify, but the recovery logic already correctly skips `no_capable_adapter` blocked graphs (they need user action). So no changes needed there.

Let me fix the 202 issue by adding `reply` to the handler signature and setting `reply.code(202)`.

Then run tsc to verify.
端点已经完整实现在 `graph.ts` 第 282-443 行。逐项对比 spec 验证：

- ✅ 所有10项行为要求均已实现
- ✅ 所有约束（单事务、事件在事务内写入/事务外广播、错误码）均已满足
- ✅ Zod 输入校验已就位
- ✅ 合成节点的 join 条件重检已实现
- ✅ `graph-recovery.ts` 正确跳过 `no_capable_adapter`（需用户手动操作）

**唯一问题**: 规范要求 "Return 202"，但 handler 未设置 `reply.code(202)`（对比 retry 端点第 212 行）。

修复

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-05T13:38:44Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\graph.ts", "oldString": "await deps.runDispatchService.drainWorkspace(gr.workspace_id);\n\n    return {\n      graph_run_id: gr.id,\n      status: GraphRunStatus.Running,\n      reassigned,\n      queued_run_ids: queuedRunIds,\n    };\n  });", "newString": "await deps.runDispatchService.drainWorkspace(gr.workspace_id);\n\n    reply.code(202);\n    return {\n      graph_run_id: gr.id,\n      status: GraphRunStatus.Running,\n      r
…[truncated])`


> [reasoning] Now add `reply.code(202)` before the return statement.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-05T13:38:53Z

- **tool**: `todowrite({"todos": [{"content": "Read server/src/api/routes/graph.ts to understand structure and patterns", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface", "priority": "high", "status": "completed"}, {"content": "Read shared/src/types/index.ts for relevant enums", "priority": "h
…[truncated])`


> [reasoning] Now let me run tsc to verify.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read server/src/api/routes/graph.ts to understand structure and patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read shared/src/types/index.ts for relevant enums",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Verify endpoint implementation against spec and fix any issues",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Verify with tsc --noEmit",
    "status": "in_pr
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T13:39:01Z

- **tool**: `bash({"command": "npx tsc -p server/tsconfig.json --noEmit", "workdir": "D:\\Projects\\personahub", "timeout": 60000})`


> [reasoning] Run tsc to verify.

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-08-05T13:40:02Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\graph.ts"})`


> [reasoning] No output from tsc --noEmit means no type errors. The compilation is clean.

Now let me also check LSP diagnostics to be thorough.

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-05T13:40:13Z

- **tool**: `todowrite({"todos": [{"content": "Read server/src/api/routes/graph.ts to understand structure and patterns", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature", "priority": "high", "status": "completed"}, {"content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface", "priority": "high", "status": "completed"}, {"content": "Read shared/src/types/index.ts for relevant enums", "priority": "h
…[truncated])`


> [reasoning] Clean. Let me finalize the todos and report.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read server/src/api/routes/graph.ts to understand structure and patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/adapter-eligibility.ts for resolveEligibleAdapter signature",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read server/src/services/graph-recovery.ts for GraphRecoveryDeps interface",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Read shared/src/types/index.ts for relevant enums",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Verify endpoint implementation against spec and fix any issues",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Verify with tsc --noEmit",
    "status": "compl
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T13:40:23Z

**结论：端点已实现，仅修复一处遗漏。**

`POST /api/graph-runs/:graphRunId/resolve-executors` 在 `graph.ts:282-444` 已完整实现，spec 10 项行为全部到位。发现的问题：

| 检查项 | 状态 |
|---|---|
| Zod 校验 `z.record(z.string())` | ✅ |
| graphRun 存在/非终止/非取消中校验 | ✅ |
| `node_assignments` 覆盖所有 `blocked_node_keys` | ✅ |
| `resolveEligibleAdapter` 原子校验（失败即全拒） | ✅ |
| 单事务内 DB 写入 | ✅ |
| 事件在事务内写入、事务外广播 | ✅ |
| 合成节点 join 条件重检 | ✅ |
| `graphRun` Blocked→Running + `issue` Blocked→Running | ✅ |
| `graph.node_queued` + `graph.executor_reassigned` 事件 | ✅ |
| `drainWorkspace` 触发 | ✅ |
| 409/400 错误码 | ✅ |
| `graph-recovery.ts` 正确处理（跳过 `no_capable_adapter`） | ✅ |

**修复内容**：handler 签名增加 `reply` 参数，添加 `reply.code(202)`（规范要求 "Return 202"）。

`tsc --noEmit` 零错误，LSP 诊断零告警。
