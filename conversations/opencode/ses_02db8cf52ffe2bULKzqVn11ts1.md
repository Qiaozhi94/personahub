---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_02db8cf52ffe2bULKzqVn11ts1"
title: "Recovery semantics regression tests (@Sisyphus-Junior subagent)"
project: "D:/Projects/personahub"
model: "glm-5.2"
created_at: "2026-08-05T14:15:08Z"
updated_at: "2026-08-05T14:25:33Z"
tokens_input: 61726
tokens_output: 23633
cost: 0.0
parent_id: "ses_03ef5d0faffej5Zj3DPo6UYZHA"
---

# Recovery semantics regression tests (@Sisyphus-Junior subagent)

## user · 2026-08-05T14:15:08Z

Create integration test file `server/tests/integration/graph-recovery-semantics.test.ts` covering recovery semantic regression tests for F006.

TASK: Write 6 test cases covering terminalize and recovery semantics that are currently untested.

EXPECTED OUTCOME: A test file at `server/tests/integration/graph-recovery-semantics.test.ts` that compiles and passes all 6 tests.

CONTEXT PATTERNS (copy EXACTLY from existing test files):
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { RunRepository } from "../../src/repositories/run.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { AdapterWorkspaceStatusRepository } from "../../src/repositories/adapter-workspace-status.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { GraphRecoveryService } from "../../src/services/graph-recovery.js";
import { tryFinalizeCancellingGraph } from "../../src/services/graph/cancelling-finalizer.js";
import { getDefinition } from "../../src/runtime/graph/definitions.js";
import { GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, RunRole, RunPurpose, ThreadEventType, ActorType, FailureReason } from "@personahub/shared/types";
```

SEED FUNCTION (copy from fanin test):
```typescript
function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?,?,?,?)").run("prj_1","test",now,now);
  db.prepare("INSERT INTO workspaces (id,project_id,local_path,local_path_normalized,lock_state,push_credentials_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wsp_1","prj_1","/tmp/test","/tmp/test","idle",0,now,now);
  db.prepare("INSERT INTO workflow_templates (id,name,issue_type,collaboration_topology,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wft_1","test","coding","single","active",1,now,now);
  db.prepare("INSERT INTO validation_policies (id,name,issue_type,max_validation_rounds,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("vpl_1","test","coding",3,"active",1,now,now);
  db.prepare("INSERT INTO issues (id,project_id,workspace_id,issue_type,workflow_template_id,validation_policy_id,title,status,priority,labels,validation_round_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("iss_1","prj_1","wsp_1","coding","wft_1","vpl_1","test","Running","normal","[]",0,now,now);
  db.prepare("INSERT INTO threads (id,issue_id,thread_type,title,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("thr_1","iss_1","primary","test",now,now);
  db.prepare("INSERT INTO agent_configs (id,project_id,name,cli_provider,command,args,capability_tags,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("agt_1","prj_1","test","codex","codex","[]",'["implementation"]',"available",now,now);
}
```

SIX TESTS TO WRITE:

### T039b: Terminalize tests
1. `"terminalize: success path — all nodes Completed, graphRun becomes Completed, Issue becomes Ready"`:
   - Create graphRun (Running), 3 nodes all Completed (with result_event_ids for precursors)
   - Create GraphRecoveryService, call reconcile()
   - Assert graphRun.status === GraphRunStatus.Completed
   - Assert issue status === IssueStatus.Ready
   - Assert graph.terminal event exists (query thread_events WHERE event_type = 'graph.terminal')

2. `"terminalize: failure path — one node Failed, graphRun becomes Blocked"`:
   - Create graphRun (Running), N1 Completed, N2 Failed, N3 Pending
   - Call reconcile()
   - Assert graphRun.status === GraphRunStatus.Blocked with blocked_reason_code 'recovery_inconsistent'
   - Assert issue status === IssueStatus.Blocked

### T042-T045: Recovery semantics
3. `"recovery semantics ①②: restart preserves completed state, completed nodes not rerun"`:
   - Create graphRun (Running), N1 Completed (with result_event_id + queued Run that was Completed), N2 Pending, N3 Pending
   - Call reconcile()
   - Assert N1 stays Completed (no status change)
   - Assert no new Run created for N1 (still only 1)
   - Assert graphRun still Running (N2/N3 not terminal)

4. `"recovery semantics ③④: interrupted NodeRun can be retried with new Attempt"`:
   - Setup: N1 Completed, N2 Running with Interrupted Run, N3 Pending
   - Call reconcile()
   - Assert N2.status === NodeRunStatus.Interrupted
   - Create new retry Run for N2 (simulate user retry via existing retry logic: CAS nodeRun to Ready, create queued Run with same node_run_id and instructions)
   - Assert node_run_id unchanged, Attempt count === 2

5. `"recovery semantics ⑤: fan-in does not converge prematurely — precursor incomplete"`:
   - Setup: N1 Completed (with result_event_id), N2 Running (with Running Run — NOT interrupted), N3 Pending
   - Call reconcile()
   - Since N2 is Running (not Interrupted) and its latest Attempt is still Running (not Interrupted/Completed/Failed/Cancelled), reconcile should NOT mark N2 as Interrupted and should NOT trigger the join for N3
   - Assert N3.status stays Pending (no join triggered — N2 not completed nor interrupted with a replayable outcome)

### T045b: Fault injection
6. `"fault injection: crash after transaction one (NodeRun stuck Running, Run Finished) — replay fixes it"`:
   - Create graphRun (Running)
   - N1 Running with a Run that has status RunStatus.Completed (simulating crash between Run completing and workflow hook updating NodeRun)
   - N2 Running with a Run that has status RunStatus.Completed
   - N3 Pending
   - Call reconcile()
   - Step 7 should replay: N1 and N2 transition to Completed (processGraphNodeCompletion replays the completion)
   - Steps 3/4/6 re-evaluate joins → N3 transitions to Ready
   - Assert N1.status === NodeRunStatus.Completed, N2.status === NodeRunStatus.Completed
   - Assert N3.status === NodeRunStatus.Ready (join triggered)
   - Note: after reconciliation N3 is Ready not terminal, so graphRun stays Running. That's correct — the graph is still in progress.

MUST DO:
- Follow exact patterns from graph-recovery.test.ts and graph-fanin.test.ts
- Use `new Database(":memory:")` with `pragma("foreign_keys = ON")`
- Apply migrations then seed
- Close db in afterEach
- Create fresh repos in beforeEach
- Create GraphRecoveryService with full deps: `{ graphRunRepo, nodeRunRepo, runRepo, issueRepo, threadEventService, threadEventRepo, agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo, db }`
- Query terminal events: `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`
- Assert DB state after calls (re-query repos, don't trust stale references)
- NO `as any` or `@ts-ignore`
- Each test under 40 lines

MUST NOT DO:
- No HTTP/fastify
- No RunDispatchService
- No complex mocking

After writing, run: `npx vitest run tests/integration/graph-recovery-semantics.test.ts` and fix any failures.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-08-05T14:15:08Z

- **tool**: `todowrite({"todos": [{"content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns", "status": "in_progress", "priority": "high"}, {"content": "Examine GraphRecoveryService, repositories, and graph definitions", "status": "pending", "priority": "high"}, {"content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)", "status": "pending", "priority": "high"}, {"content": "Write the 6 test cases in graph-recovery-semantics.test.ts", "status": "pending", "pri
…[truncated])`


> [reasoning] Let me start by exploring the codebase to understand the existing patterns, types, and services before writing the test file.
我将先探索代码库以了解现有的模式，然后再编写测试。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Examine GraphRecoveryService, repositories, and graph definitions",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Write the 6 test cases in graph-recovery-semantics.test.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Run vitest and fix any failures",
    "status": "pending",
    "priority": "high"
  }
]
  ```
  </details>

## assistant · 2026-08-05T14:15:19Z

- **tool**: `glob({"pattern": "server/tests/integration/graph-*.test.ts"})`

  <details><summary>tool output</summary>

  ```text
Found 5 file(s)

D:\Projects\personahub\server\tests\integration\graph-routes-mutations.test.ts
D:\Projects\personahub\server\tests\integration\graph-recovery.test.ts
D:\Projects\personahub\server\tests\integration\graph-fanin.test.ts
D:\Projects\personahub\server\tests\integration\graph-repositories.test.ts
D:\Projects\personahub\server\tests\integration\graph-constraints.test.ts
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of 
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:15:29Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\graph-recovery.test.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\graph-recovery.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Database from "better-sqlite3";
3: import { applyMigrations } from "../../src/db/migrations.js";
4: import { GraphRunRepository } from "../../src/repositories/graph-run.js";
5: import { NodeRunRepository } from "../../src/repositories/node-run.js";
6: import { RunRepository } from "../../src/repositories/run.js";
7: import { IssueRepository } from "../../src/repositories/issue.js";
8: import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
9: import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
10: import { ProjectRepository } from "../../src/repos
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:15:36Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\graph-fanin.test.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\graph-fanin.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Database from "better-sqlite3";
3: import { applyMigrations } from "../../src/db/migrations.js";
4: import { GraphRunRepository } from "../../src/repositories/graph-run.js";
5: import { NodeRunRepository } from "../../src/repositories/node-run.js";
6: import { RunRepository } from "../../src/repositories/run.js";
7: import { IssueRepository } from "../../src/repositories/issue.js";
8: import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
9: import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
10: import { ProjectRepository } from "../../src/reposito
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:15:43Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\graph-recovery.ts"})`


> [reasoning] Now I have a good understanding of the patterns. Let me explore the GraphRecoveryService, the graph definitions, and shared types to understand what's available.
现在，让我并行探索 GraphRecoveryService、definitions 和 shared types。

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

## assistant · 2026-08-05T14:15:57Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\graph\\node-completion.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\graph\node-completion.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, ThreadEvent } from "@personahub/shared/types";
3: import { IssueStatus as IS, RunStatus as RS, NodeRunStatus, GraphRunStatus, ThreadEventType, ActorType } from "@personahub/shared/types";
4: import type { NodeRunRepository } from "../../repositories/node-run.js";
5: import type { GraphRunRepository } from "../../repositories/graph-run.js";
6: import type { RunRepository } from "../../repositories/run.js";
7: import type { IssueRepository } from "../../repositories/issue.js";
8: import type { ThreadEventService } from "../thread-event.js";
9: import type { ThreadEventRepository } from "../../repositories/thread-even
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:16:08Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\graph\\definitions.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\graph\definitions.ts</path>
<type>file</type>
<content>
1: import type { GraphDefinitionV1 } from "./types.js";
2: import { AgentCapability, NodeRunStatus } from "@personahub/shared/types";
3: 
4: const WGD_CODING_DUAL_REVIEW_V1: GraphDefinitionV1 = {
5:   id: "wgd_coding_dual_review",
6:   version: 1,
7:   targetGlobs: ["**/*.ts", "**/*.tsx", "**/*.sql"],
8:   nodes: [
9:     {
10:       key: "review_concurrency",
11:       requiredCapabilities: [AgentCapability.Implementation],
12:       inputSlots: [],
13:       outputContract: "findings_v1",
14:       instructionTemplate: `You are performing a **concurrency, state consistency, and recovery-path** review of the target codebase.
15: 
16: ## Review Scope
17: - Examine all state management: l
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:16:20Z

- **tool**: `grep({"include": "*.ts", "output_mode": "files_with_matches", "path": "D:\\Projects\\personahub\\shared", "pattern": "FailureReason|GraphBlockReason"})`


> [reasoning] Now let me explore the shared types to understand the enums available, especially `FailureReason` mentioned in the context patterns.
我来并行探索一下共享类型、存储库以及 result-parser。

  <details><summary>tool output</summary>

  ```text
Found 3 match(es) in 3 file(s)

D:\Projects\personahub\shared\src\index.ts

D:\Projects\personahub\shared\src\types\index.ts

D:\Projects\personahub\shared\src\types\graph.ts

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
- Agen
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:16:32Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\graph.ts"})`

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

## assistant · 2026-08-05T14:16:45Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\shared\\src", "pattern": "enum FailureReason|enum RunStatus|enum RunRole|enum RunPurpose|enum ThreadEventType|enum ActorType|enum IssueStatus"})`

  <details><summary>tool output</summary>

  ```text
Found 7 match(es) in 3 file(s)

D:\Projects\personahub\shared\src\types\adapter.ts
  29: export enum RunPurpose {

D:\Projects\personahub\shared\src\types\index.ts
  105: export enum IssueStatus {
  131: export enum ThreadEventType {
  170: export enum ActorType {
  203: export enum RunStatus {
  212: export enum FailureReason {

D:\Projects\personahub\shared\src\types\validation.ts
  7: export enum RunRole {

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt=
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:17:02Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "limit": 160, "offset": 100})`

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

## assistant · 2026-08-05T14:17:19Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\graph\\result-parser.ts"})`


> [reasoning] Now I have the types. Let me look at the result-parser to understand what happens during processGraphNodeCompletion for Completed runs, since Test 6 (fault injection) has runs with status RunStatus.Completed.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\graph\result-parser.ts</path>
<type>file</type>
<content>
1: import type { NodeRunStatus, GraphBlockReason } from "@personahub/shared/types";
2: import { NodeRunStatus as NRS, GraphBlockReason as GBR } from "@personahub/shared/types";
3: 
4: export interface FindingV1 {
5:   severity: "high" | "medium" | "low";
6:   file: string;
7:   line: number;
8:   claim: string;
9:   failure_scenario: string;
10:   source_nodes?: string[];
11: }
12: 
13: export interface ParsedResultV1 {
14:   node_key: string;
15:   findings: FindingV1[];
16:   not_reviewed: string[];
17:   duplicates_merged?: number;
18:   truncated?: boolean;
19:   dropped_count?: number;
20: }
21: 
22: export interface EnvelopeParseSuccess {
23:   status: "ok";
24:   nodeStatus: No
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:17:35Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts"})`


> [reasoning] Now I understand the result parser. For test 6 (fault injection), the run.status is `RunStatus.Completed`, so `processGraphNodeCompletion` will try to parse the final message. I need to set a valid final message for the runs.

Let me look at how `getFinalMessage` works and the `runRepo` to understand the API.

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

## assistant · 2026-08-05T14:17:52Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\node-run.ts"})`


> [reasoning] Now I understand. For test 6 (fault injection), I need to create runs with status `RunStatus.Completed` and a valid `final_message` so `processGraphNodeCompletion` can replay. The `transitionStatus` method accepts `final_message` in updates. But the runs are created with `createRun` directly setting `status: RunStatus.Completed`. Let me check if there's a way to set final_message directly.

Looking at the create method - it doesn't accept final_message. So I'll need to either:
1. Use `transitionStatus` from a Queued status to Completed with a final_message
2. Or directly update the DB

Let me look at how graph-recovery.test.ts creates runs and sets things up. Actually, the pattern in graph-fanin.test.ts (lines 117-118) is:
```typescript
nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Running, NodeRunStatus.Completed);
runRepo.transitionStatus(run1.id, RunStatus.Queued, RunStatus.Completed, {});
```

But this doesn't set a final_message. For test 6, I need the run to have a final_message so the result parser can parse it.

Actually, looking more carefully at the test requirements:

Test 6: "crash after transaction one (NodeRun stuck Running, Run Finished)"
- N1 Running with a Run that has status RunStatus.Completed
- N2 Running with a Run that has status RunStatus.Completed

So the scenario is: the Run completed (status = completed, has final message), but the NodeRun is still "running" because the workflow hook crashed before updating the NodeRun. The recovery service's Step 7 should replay the completion via `processGraphNodeCompletion`.

For this to work, the run needs a `final_message` that parses correctly. Let me create runs with a final_message by using `transitionStatus` from Queued to Completed with the final_message, OR I could insert directly via SQL.

Actually, the cleaner approach: create the run as Queued, then transitionStatus to Completed with a final_message containing valid JSON.

Let me look at how to write a valid final message. The parser expects:
```json
{
  "node_key": "review_concurrency",
  "findings": [],
  "not_reviewed": []
}
```

Let me also check the node-run repository for the CAS method and other helpers.

Let me also look at the existing graph-repositories.test.ts to see more patterns.

Let me also examine the workflow.ts for evaluateJoinAndTrigger to understand the join triggering for test 5.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\node-run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { NodeRun, NodeRunStatus, GraphNodeKey } from "@personahub/shared/types";
3: import { generateRunId } from "../id.js";
4: import { isNodeRunDuplicateConflict, GraphConstraintError } from "../db/sqlite-errors.js";
5: 
6: export interface NodeRunCreateInput {
7:   id?: string;
8:   graph_run_id: string;
9:   node_key: GraphNodeKey;
10:   status: NodeRunStatus;
11:   assigned_adapter_config_id: string;
12: }
13: 
14: export interface NodeRunCompareAndSetResult {
15:   success: boolean;
16:   nodeRun: NodeRun | null;
17: }
18: 
19: interface NodeRunRow {
20:   id: string;
21:   graph_run_id: string;
22:   node_key: string;
23:   statu
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:18:09Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\graph-run.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\graph-run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { GraphRun, GraphRunStatus, GraphBlockReason, GraphNodeKey } from "@personahub/shared/types";
3: import { generateRunId } from "../id.js";
4: import { isNonTerminalGraphConflict, GraphConstraintError } from "../db/sqlite-errors.js";
5: 
6: export interface GraphRunCreateInput {
7:   id?: string;
8:   issue_id: string;
9:   thread_id: string;
10:   workspace_id: string;
11:   definition_id: string;
12:   definition_version: number;
13:   status: GraphRunStatus;
14:   target_files: readonly string[];
15:   target_files_hash: string;
16:   target_files_truncated?: boolean;
17:   target_files_dropped_count?: number;
18: }
19: 
20: ex
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:18:20Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\graph\\workflow.ts"})`


> [reasoning] Now let me look at the workflow.ts to understand how `evaluateJoinAndTrigger` works for test 5.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\graph\workflow.ts</path>
<type>file</type>
<content>
1: import type { GraphRun, NodeRun } from "@personahub/shared/types";
2: import type { ThreadEvent } from "@personahub/shared/types";
3: import {
4:   GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus,
5:   ThreadEventType, ActorType, RunRole, RunPurpose,
6: } from "@personahub/shared/types";
7: import type { GraphRunRepository } from "../../repositories/graph-run.js";
8: import type { NodeRunRepository } from "../../repositories/node-run.js";
9: import type { RunRepository } from "../../repositories/run.js";
10: import type { IssueRepository } from "../../repositories/issue.js";
11: import type { ThreadEventService } from "../thread-event.js";
12: import type { ThreadEventRepository }
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:18:30Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tsconfig.json"})`


> [reasoning] Now I have a complete understanding. Let me also check the thread-event repository to confirm `listByThreadAndTypes` and `getById` methods, and understand how to count terminal events via direct DB query (the task says to use `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`).

Let me check the thread-events table schema and the ThreadEventRepository.

Now let me look at the issue repository for the compareAndSetStatus method and updateStatus.

Let me verify the issue repo methods.

Actually, I have enough understanding now. Let me look at the existing graph-recovery test patterns once more to understand what I need.

Key observations:
1. The seedDb in the CONTEXT PATTERNS section uses `"Running"` for issue status (not "Inbox" like the actual test files). I should use the exact seed from the task description.

Wait, looking again at the task's SEED FUNCTION:
```
db.prepare("INSERT INTO issues (id,project_id,workspace_id,issue_type,workflow_template_id,validation_policy_id,title,status,priority,labels,validation_round_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("iss_1","prj_1","wsp_1","coding","wft_1","vpl_1","test","Running","normal","[]",0,now,now);
```

The issue status is "Running" (not "Inbox"). So the seed pre-sets the issue to Running. Good.

2. The CONTEXT PATTERNS imports include `FailureReason` but the existing tests import `GraphBlockReason`. The task says to copy EXACTLY from existing test files, but the context patterns show a different import. Let me follow the CONTEXT PATTERNS exactly as given since the task explicitly says "copy EXACTLY from existing test files" and then provides the context patterns. Actually re-reading: "CONTEXT PATTERNS (copy EXACTLY from existing test files):" - so these are the patterns to use. But they include `FailureReason` which isn't in the existing test files. And they're missing `GraphBlockReason` which IS in the existing files.

Hmm, the task is a bit contradictory. The CONTEXT PATTERNS block shows imports that include `FailureReason` but not `GraphBlockReason`. But for test 2, I need to assert `blocked_reason_code === 'recovery_inconsistent'`. Let me check if I can use the string literal or need the enum.

Looking at graph-recovery.test.ts line 213: `blocked_reason_code: GraphBlockReason.NodeRunFailed`. So the enum is used. But the CONTEXT PATTERNS don't include `GraphBlockReason`. 

Actually, the task says to use the exact context patterns given. So I'll import `FailureReason` (even if unused, though that might cause lint errors). But I also need `GraphBlockReason` for assertions. Let me add both - the context patterns show what to copy from existing files, but I can add `GraphBlockReason` since it's needed.

Actually, looking more carefully at the instructions: "CONTEXT PATTERNS (copy EXACTLY from existing test files)" - this is telling me these are the patterns that exist in the existing test files that I should copy. The block shown is a combination. Let me just use what makes sense: import everything needed including `GraphBlockReason`.

Wait, let me re-read the task imports:
```typescript
import { GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, IssueStatus, RunRole, RunPurpose, ThreadEventType, ActorType, FailureReason } from "@personahub/shared/types";
```

There's a duplicate `IssueStatus` in there. That's likely a typo in the task. I'll clean it up.

I'll include `GraphBlockReason` since I need it for assertions, and include `FailureReason` since the task explicitly lists it (might be needed or might be unused - but unused imports may cause TS errors with strict settings).

Actually, let me check the tsconfig to see if unused imports cause errors.

Let me check the tsconfig.
在编写测试之前，让我先检查一下 `tsconfig` 的严格程度，并验证 `thread-event` 仓库。

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tsconfig.json</path>
<type>file</type>
<content>
1: {
2:   "extends": "../tsconfig.base.json",
3:   "compilerOptions": {
4:     "outDir": "./dist",
5:     "rootDir": "./src",
6:     "types": ["node"]
7:   },
8:   "include": ["src/**/*"],
9:   "exclude": ["node_modules", "dist"]
10: }

(End of file - total 10 lines)
</content>
  ```
  </details>

## assistant · 2026-08-05T14:18:55Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\tsconfig.base.json"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\tsconfig.base.json</path>
<type>file</type>
<content>
1: {
2:   "compilerOptions": {
3:     "target": "ES2022",
4:     "module": "NodeNext",
5:     "moduleResolution": "NodeNext",
6:     "lib": ["ES2022"],
7:     "strict": true,
8:     "esModuleInterop": true,
9:     "skipLibCheck": true,
10:     "forceConsistentCasingInFileNames": true,
11:     "declaration": true,
12:     "declarationMap": true,
13:     "sourceMap": true
14:   }
15: }

(End of file - total 15 lines)
</content>
  ```
  </details>

## assistant · 2026-08-05T14:19:06Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\src\\db", "pattern": "thread_events|graph.terminal"})`


> [reasoning] The tsconfig only includes "src/**/*", not tests. So tests might be compiled separately by vitest. Let me check if there's a vitest config or tsconfig for tests. Vitest uses esbuild which doesn't error on unused imports by default. So unused imports won't cause compilation failures in tests.

But the task says "NO `as any` or `@ts-ignore`" and "compiles and passes all 6 tests". Let me check how vitest handles type checking. Typically vitest doesn't do full type checking - it uses esbuild to transpile. So type errors won't fail tests, but I should still write clean code.

Now, the `noUnusedLocals` and `noUnusedParameters` are not set in the tsconfig, so unused imports won't cause TS errors anyway.

Let me verify the thread_events table schema to make sure my COUNT query works.

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 2 file(s)

D:\Projects\personahub\server\src\db\schema-v1.ts
  90: CREATE TABLE IF NOT EXISTS thread_events (
  102: CREATE INDEX IF NOT EXISTS idx_thread_events_thread_seq
  103: ON thread_events(thread_id, event_sequence);

D:\Projects\personahub\server\src\db\schema-v8.ts
  30: result_event_id TEXT REFERENCES thread_events(id),

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="libra
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:19:21Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\schema-v1.ts", "limit": 25, "offset": 85})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\db\schema-v1.ts</path>
<type>file</type>
<content>
85: );
86: 
87: CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_primary_unique
88:   ON threads(issue_id) WHERE thread_type = 'primary';
89: 
90: CREATE TABLE IF NOT EXISTS thread_events (
91:   id TEXT PRIMARY KEY,
92:   event_sequence INTEGER NOT NULL,
93:   thread_id TEXT NOT NULL REFERENCES threads(id),
94:   type TEXT NOT NULL,
95:   actor_type TEXT NOT NULL,
96:   actor_id TEXT,
97:   payload_json TEXT NOT NULL,
98:   evidence_refs TEXT NOT NULL DEFAULT '[]',
99:   created_at TEXT NOT NULL
100: );
101: 
102: CREATE INDEX IF NOT EXISTS idx_thread_events_thread_seq
103:   ON thread_events(thread_id, event_sequence);
104: 
105: INSERT OR IGNORE INTO workflow_templates (id, name, issue_type, collabor
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:19:35Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\thread-event.ts"})`


> [reasoning] The column is `type` not `event_type`. But the task says to query: `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`. 

Wait, that would fail because the column is `type` not `event_type`. Let me check if there's a migration that renames it, or if the task description has an error. Let me check the thread_event repository to see how it queries.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\thread-event.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { ThreadEvent, ThreadEventType, ActorType } from "@personahub/shared/types";
3: import { generateEventId } from "../id.js";
4: 
5: export interface ThreadEventCreateInput {
6:   thread_id: string;
7:   type: ThreadEventType;
8:   actor_type: ActorType;
9:   actor_id: string | null;
10:   payload: Record<string, unknown>;
11:   evidence_refs: string[];
12: }
13: 
14: interface ThreadEventRow {
15:   id: string;
16:   event_sequence: number;
17:   thread_id: string;
18:   type: string;
19:   actor_type: string;
20:   actor_id: string | null;
21:   payload_json: string;
22:   evidence_refs: string;
23:   created_at: string;
24: }
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:19:49Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\src\\repositories\\issue.ts", "pattern": "compareAndSetStatus|updateStatus|getById"})`


> [reasoning] The column is `type` not `event_type`. The task description says to use `event_type` in the query, but that would fail. The task says: "Query terminal events: `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`". 

This is incorrect - the column is `type`. I should use `type` instead. The task also mentions: "Assert graph.terminal event exists (query thread_events WHERE event_type = 'graph.terminal')". 

I'll use the correct column name `type` since using `event_type` would cause a SQL error. The task description has an error here, but the intent is clear - count graph.terminal events. I could also use the `threadEventRepo.listByThreadAndTypes` method like the existing tests do (line 118 in graph-recovery.test.ts: `threadEventRepo.listByThreadAndTypes("thr_1", [ThreadEventType.GraphTerminal]).length`).

Actually, to be safe and match the task intent while being correct, I'll use the repository method which is the established pattern. But the task explicitly says to use the raw SQL query. Let me use the raw SQL with the CORRECT column name `type`. The task description's `event_type` is a mistake.

Actually, wait. Let me re-read: "Query terminal events: `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`". This is presented as a pattern to use. But it would fail at runtime. I'll use `type` instead of `event_type` to make it actually work. The tests need to PASS.

Now let me also check the issue repository for the methods I need.

  <details><summary>tool output</summary>

  ```text
Found 3 match(es) in 1 file(s)

D:\Projects\personahub\server\src\repositories\issue.ts
  115: getById(id: string): Issue | null {
  125: updateStatus(issueId: string, input: IssueUpdateStatusInput): void {
  131: compareAndSetStatus(

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
//
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:20:11Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\src\\services\\thread-event.ts", "pattern": "write\\(|class ThreadEventService"})`


> [reasoning] Good. Now I have all the information I need. Let me also check the ThreadEventService.write method signature to ensure I use it correctly.

  <details><summary>tool output</summary>

  ```text
Found 3 match(es) in 1 file(s)

D:\Projects\personahub\server\src\services\thread-event.ts
  5: export class ThreadEventService {
  11: write(
  41: const event = this.write(threadId, type, actorType, actorId, payload, evidenceRefs);

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// 
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:20:22Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\thread-event.ts", "limit": 40})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\thread-event.ts</path>
<type>file</type>
<content>
1: import type { ThreadEvent, ThreadEventType, ActorType } from "@personahub/shared/types";
2: import type { ThreadEventRepository } from "../repositories/thread-event.js";
3: import type { EventBus } from "../runtime/event-bus.js";
4: 
5: export class ThreadEventService {
6:   constructor(
7:     private threadEventRepo: ThreadEventRepository,
8:     private eventBus: EventBus,
9:   ) {}
10: 
11:   write(
12:     threadId: string,
13:     type: ThreadEventType,
14:     actorType: ActorType,
15:     actorId: string | null,
16:     payload: Record<string, unknown>,
17:     evidenceRefs: string[] = [],
18:   ): ThreadEvent {
19:     return this.threadEventRepo.create({
20:       thread_id: thr
…[truncated]
  ```
  </details>

## assistant · 2026-08-05T14:20:35Z

- **tool**: `todowrite({"todos": [{"content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns", "priority": "high", "status": "completed"}, {"content": "Examine GraphRecoveryService, repositories, and graph definitions", "priority": "high", "status": "completed"}, {"content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)", "priority": "high", "status": "completed"}, {"content": "Write the 6 test cases in graph-recovery-semantics.test.ts", "priority": "high", "st
…[truncated])`


> [reasoning] Now I have all the information. Let me update my todos and start writing the test file.

Let me now carefully design each test case:

### Test 1: "terminalize: success path - all nodes Completed, graphRun becomes Completed, Issue becomes Ready"
- Create graphRun (Running)
- 3 nodes all Completed (with result_event_ids for precursors)
- Call reconcile()
- Assert graphRun.status === GraphRunStatus.Completed
- Assert issue status === IssueStatus.Ready
- Assert graph.terminal event exists

Setup:
- setIssueStatus not needed since seed already sets to "Running"
- createGraphRun() with Running
- create 3 nodes as Completed
- For n1 (review_concurrency) and n2 (review_contract): write result events and set result_event_id
- For n3 (synthesize_findings): it needs a result_event_id too? Looking at tryFinalizeGraphRun - it just checks allTerminal. Completed is terminal. So n3 just needs to be Completed. But wait, does n3 need a result_event_id? Let me check... tryFinalizeGraphRun just checks statuses, not result_event_ids. So n3 can be Completed without a result_event_id.

But wait - the reconcile() calls `reevaluateOutgoingJoins` for Completed nodes. For n1 and n2, this would try to trigger the join for n3. But n3 is already Completed (not Pending), so `evaluateJoinAndTrigger` would skip it (line 52: `if (!synthesisNodeRun || synthesisNodeRun.status !== NodeRunStatus.Pending) continue;`). Good.

Then `tryFinalizeGraphRun` runs - all 3 are Completed (terminal), no failures, so it transitions to Completed and writes graph.terminal event. 

But wait - the issue status. The seed sets it to "Running". tryFinalizeGraphRun does `deps.issueRepo.compareAndSetStatus(graphRun.issue_id, IS.Running, IS.Ready)`. So issue should become Ready. 

### Test 2: "terminalize: failure path - one node Failed, graphRun becomes Blocked"
- Create graphRun (Running), N1 Completed, N2 Failed, N3 Pending
- Call reconcile()
- Assert graphRun.status === GraphRunStatus.Blocked with blocked_reason_code 'recovery_inconsistent'
- Assert issue status === IssueStatus.Blocked

Let me trace through reconcile():
- Step 1: N3 is Pending, not Running, skip. N2 is Failed, not Running, skip. N1 is Completed, not Running, skip.
- Step 7: No Running nodes, skip.
- Steps 3/4/6: reevaluateOutgoingJoins for N1 (Completed). N1 has outgoing edge to N3 (synthesize_findings). N3 is Pending. Check if all predecessors completed: N1 is Completed, N2 is Failed (not Completed). So allPredecessorsCompleted is false, skip.
- Step 8: tryFinalizeGraphRun - allTerminal? N3 is Pending, not terminal. So no.
- Step 5: freshGraphRun is still Running. freshNodes: N1 Completed, N2 Failed, N3 Pending. 
  - anyNonTerminal: N3 is Pending (not in DONE_NODE_STATUSES which is [Completed, Failed, Cancelled]). So yes.
  - anyContinuable: any Ready or Running? No.
  - So: anyNonTerminal && !anyContinuable => block with 'recovery_inconsistent'
  - blocked_reason_code = 'recovery_inconsistent', blocked_node_keys = ['synthesize_findings'] (the non-terminal ones)
  - issue becomes Blocked

So graphRun becomes Blocked with blocked_reason_code 'recovery_inconsistent'. Issue becomes Blocked. 

### Test 3: "recovery semantics ①②: restart preserves completed state, completed nodes not rerun"
- Create graphRun (Running), N1 Completed (with result_event_id + queued Run that was Completed), N2 Pending, N3 Pending
- Call reconcile()
- Assert N1 stays Completed (no status change)
- Assert no new Run created for N1 (still only 1)
- Assert graphRun still Running (N2/N3 not terminal)

Trace:
- Step 1: No Running nodes.
- Step 7: No Running nodes.
- Steps 3/4/6: reevaluateOutgoingJoins for N1. N1 has edge to N3. N3 is Pending. Check all predecessors: N1 Completed, N2 Pending (not Completed). So allPredecessorsCompleted is false. Skip.
- Step 8: tryFinalizeGraphRun - N2 and N3 are Pending, not terminal. No.
- Step 5: freshGraphRun Running. freshNodes: N1 Completed, N2 Pending, N3 Pending.
  - anyNonTerminal: N2, N3 are Pending. Yes.
  - anyContinuable: any Ready or Running? No.
  - Wait, this would trigger the 'recovery_inconsistent' block!

Hmm, that's a problem. The test says "Assert graphRun still Running (N2/N3 not terminal)". But step 5 would block it because N2/N3 are Pending (non-terminal) and there's nothing Ready/Running to make progress.

Wait, but N1 is Completed and has an outgoing edge to N3. The join for N3 requires both N1 and N2 to be Completed. N2 is Pending. So the join can't be satisfied. And there's nothing to make N2 progress (N2 is Pending, waiting for... nothing actually - N2 is a root node with no input slots).

Hmm, but in the reconcile, steps 3/4/6 only re-evaluate joins for Completed nodes. N2 is Pending, not Completed, so its outgoing edges aren't re-evaluated. And even if they were, N2 isn't Completed so the join check would fail.

Actually wait - N2 (review_contract) has no predecessors (inputSlots: []). So N2 should be Ready, not Pending! In a normal flow, when the graph is created, root nodes (no input slots) would be transitioned to Ready and get an Attempt.

But in this test scenario, N2 is still Pending. That means the graph was created but the initial dispatch of root nodes never happened (or was interrupted). This is an inconsistent state - N2 has no predecessors but is still Pending.

So step 5 would indeed block this graph with 'recovery_inconsistent'. But the test expects graphRun to still be Running...

Let me re-read the test requirement:
"Assert graphRun still Running (N2/N3 not terminal)"

Hmm, maybe I need to set N2 to Ready instead of Pending? Or maybe N2 should have a queued Run?

Wait, let me re-read: "N1 Completed (with result_event_id + queued Run that was Completed), N2 Pending, N3 Pending"

Actually, if N2 is Pending and there's no Ready/Running node, then step 5 would block it. The test says "Assert graphRun still Running" which contradicts the reconcile logic.

Unless... the test is designed to show that completed nodes are NOT rerun. Maybe I need to make N2 Ready so that anyContinuable is true and step 5 doesn't block.

Let me reconsider. The test's main assertion is:
1. N1 stays Completed
2. No new Run for N1
3. graphRun still Running

For graphRun to stay Running after reconcile, there must be something continuable (Ready or Running). If N2 is Ready, then anyContinuable = true, and step 5 won't block.

But the test description says "N2 Pending, N3 Pending". Hmm. Let me think about this differently.

Actually, wait - maybe I should set N2 to Ready (not Pending) to avoid the step 5 block. The test is about "restart preserves completed state" - the key assertion is that N1 is not rerun. The graphRun status is secondary.

Actually, let me re-read the test more carefully:
"recovery semantics ①②: restart preserves completed state, completed nodes not rerun"
- N1 Completed (with result_event_id + queued Run that was Completed)
- N2 Pending, N3 Pending

The semantics ①② are about:
① restart preserves completed state
② completed nodes not rerun

The key point is that N1 with its Completed Run is not replayed or rerun. The graphRun staying Running is because N2/N3 are not terminal.

But as I analyzed, step 5 would block this graph. Unless... the Run for N1 is Completed (not Interrupted), and N1 is already Completed, so step 7 doesn't replay it. Step 1 doesn't touch it. Steps 3/4/6 re-evaluate joins but N3's join isn't satisfied. Step 8 can't finalize. Step 5 blocks it.

So either:
a) The test expects graphRun to become Blocked (contradicting "Assert graphRun still Running")
b) I need to set N2 to Ready to avoid the block

Looking at the assertion "Assert graphRun still Running (N2/N3 not terminal)" - this explicitly says graphRun should be Running. So I need to avoid the step 5 block. The easiest way: make N2 Ready (so anyContinuable = true).

But the test says "N2 Pending, N3 Pending". Hmm. Let me look at this from a different angle.

Actually, wait. Maybe N2 should be Ready with a Queued Run? The description says "N2 Pending" but maybe that's imprecise. Let me think about what "recovery semantics ①②" means in the design doc context. 

Actually, looking at the graph-recovery.test.ts test at line 122:
```typescript
it("reconcile detects interrupted NodeRuns and marks them Interrupted", async () => {
  setIssueStatus(IssueStatus.Running);
  const gr = createGraphRun();
  const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
  const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
  createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
  ...
```

In that test, N2 is Running (not Pending). And the graphRun stays Running after reconcile because N2 is Running (anyContinuable = true).

For my test 3, if I want graphRun to stay Running, I need at least one node to be Ready or Running. Let me set N2 to Ready instead of Pending. Or I could set N2 to Running with a Running Run.

Actually, re-reading the test description again: "N1 Completed (with result_event_id + queued Run that was Completed), N2 Pending, N3 Pending". 

Hmm, but the assertion says "Assert graphRun still Running (N2/N3 not terminal)". If N2 is Pending and N3 is Pending, and N1 is Completed, then:
- anyNonTerminal = true (N2, N3 Pending)
- anyContinuable = false (no Ready/Running)
- Step 5 blocks with recovery_inconsistent

This would make graphRun Blocked, not Running. So the test description seems inconsistent with the reconcile logic.

I think the best approach is to set N2 to Ready (with a Queued Run) so that:
1. The graph is in a valid in-progress state (N2 is ready to run)
2. graphRun stays Running (anyContinuable = true because N2 is Ready)
3. N1 stays Completed (not rerun)
4. No new Run for N1

This matches the spirit of the test: "restart preserves completed state, completed nodes not rerun". The focus is on N1 not being rerun.

Actually, wait. Let me reconsider. Maybe I should just set N2 to Running with a Running Run (not Interrupted). Then:
- Step 1: N2 is Running, latest Attempt is Running (not Interrupted), so N2 is NOT marked Interrupted.
- Step 7: N2 is Running, latest Attempt is Running (not in REPLAYABLE_RUN_STATUSES), so no replay.
- Steps 3/4/6: N1 is Completed, reevaluateOutgoingJoins. N3's join: N1 Completed, N2 Running (not Completed). Not all completed. Skip.
- Step 8: N2 Running, N3 Pending, not all terminal. Skip.
- Step 5: anyNonTerminal = true (N2 Running, N3 Pending). anyContinuable = true (N2 Running). So no block.
- graphRun stays Running. 

This is the same setup as test 5! Let me differentiate them.

For test 3, the key assertion is "no new Run created for N1 (still only 1)". So I need to create a Run for N1 initially, then verify after reconcile that there's still only 1 Run for N1.

Let me use this setup for test 3:
- N1 Completed with result_event_id + a Completed Run
- N2 Running with a Running Run (not Interrupted) - to keep graphRun Running
- N3 Pending

Actually, hmm. But the test says "N2 Pending, N3 Pending". Let me try a different approach: make N2 Ready with a Queued Run. Then:
- anyContinuable = true (N2 is Ready)
- graphRun stays Running
- N1 not rerun

Actually, looking at step 5 again:
```typescript
const anyContinuable = freshNodes.some((n) => n.status === NodeRunStatus.Ready || n.status === NodeRunStatus.Running);
```

Ready counts as continuable. So if N2 is Ready, graphRun stays Running.

But wait - if N2 is Ready with a Queued Run, does reconcile do anything with it? Let me check:
- Step 1: only looks at Running nodes. N2 is Ready, skip.
- Step 7: only looks at Running nodes. N2 is Ready, skip.
- Steps 3/4/6: only for Completed nodes. N2 is Ready, skip.
- Step 8: N2 is Ready (not terminal), N3 is Pending (not terminal). Skip.
- Step 5: anyNonTerminal = true (N2 Ready, N3 Pending). anyContinuable = true (N2 Ready). No block.
- graphRun stays Running. 

OK, I'll go with N2 Ready + Queued Run for test 3. But the test description says "N2 Pending, N3 Pending". I think the description is a guideline, not exact. The key assertions are what matter:
1. N1 stays Completed
2. No new Run for N1
3. graphRun still Running

Let me use N2 Ready to achieve assertion 3. Actually, let me think again... maybe I should just use N2 Running with a Running Run. That way:
- The test is about "restart preserves completed state" - N1 is completed and stays completed
- N2 is actively running (in-progress)
- graphRun stays Running because N2 is Running

Actually, I realize there's a subtlety. The test says "queued Run that was Completed" for N1. So N1 has a Run with status Completed. This is the normal state - the Run completed, and the NodeRun was marked Completed.

Let me go with:
- N1 Completed, result_event_id set, Run status Completed
- N2 Running, Run status Running (actively running, not interrupted)
- N3 Pending

This keeps graphRun Running (N2 is Running = continuable), N1 stays Completed, no new Run for N1.

For counting runs for N1: `runRepo.listByIssue("iss_1").filter(r => r.node_run_id === n1.id).length` should be 1.

### Test 4: "recovery semantics ③④: interrupted NodeRun can be retried with new Attempt"
- Setup: N1 Completed, N2 Running with Interrupted Run, N3 Pending
- Call reconcile()
- Assert N2.status === NodeRunStatus.Interrupted
- Create new retry Run for N2 (simulate user retry)
- Assert node_run_id unchanged, Attempt count === 2

Trace of reconcile():
- Step 1: N2 is Running. Latest Attempt for N2 is Interrupted. So mark N2 as Interrupted.
- Step 7: N2 is now Interrupted (not Running), skip. Wait, step 7 runs after step 1 in the same pass. Let me re-read the code...

Actually, step 1 iterates `this.deps.nodeRunRepo.listByGraphRun(graphRun.id)` and step 7 also iterates `this.deps.nodeRunRepo.listByGraphRun(graphRun.id)`. Step 1 modifies N2 from Running to Interrupted via CAS. Then step 7 re-queries the list, so N2 is now Interrupted, and step 7 only looks at Running nodes. So N2 is skipped in step 7.

- Steps 3/4/6: N1 is Completed, reevaluateOutgoingJoins. N3's join: N1 Completed, N2 Interrupted (not Completed). Not all completed. Skip.
- Step 8: N2 Interrupted, N3 Pending. tryFinalizeGraphRun checks allTerminal: [Completed, Failed, Cancelled]. Interrupted is NOT in this list. So allTerminal = false. Skip.

Wait, let me re-check tryFinalizeGraphRun:
```typescript
const allTerminal = nodeRuns.every((nr) =>
  [NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Cancelled].includes(nr.status as NodeRunStatus),
);
```
Interrupted is NOT terminal for finalization. So allTerminal = false. Skip.

- Step 5: freshGraphRun Running. freshNodes: N1 Completed, N2 Interrupted, N3 Pending.
  - anyNonTerminal: N2 Interrupted (not in DONE_NODE_STATUSES [Completed, Failed, Cancelled]), N3 Pending. Yes.
  - anyContinuable: any Ready or Running? N2 is Interrupted, N3 is Pending. No.
  - So: anyNonTerminal && !anyContinuable => block with 'recovery_inconsistent'!

Hmm, this would block the graph. But the test says to assert N2.status === Interrupted after reconcile, then create a new retry Run. If the graph is Blocked, the retry logic might not work.

Wait, but the test says:
1. Call reconcile()
2. Assert N2.status === NodeRunStatus.Interrupted
3. Create new retry Run for N2 (simulate user retry via existing retry logic: CAS nodeRun to Ready, create queued Run with same node_run_id and instructions)
4. Assert node_run_id unchanged, Attempt count === 2

The retry is done AFTER reconcile, simulating a user manually retrying. The graph might be Blocked after reconcile, but the retry logic (CAS nodeRun Interrupted -> Ready, create new Run, etc.) should still work because it's direct CAS operations.

Actually, let me re-check. After reconcile blocks the graph with 'recovery_inconsistent', the graphRun is Blocked. Then the test does:
- CAS nodeRun N2 from Interrupted to Ready (this should work, N2 is Interrupted)
- Create new Run for N2 (this might fail if there's a constraint...)

Actually, looking at the retry test in graph-recovery.test.ts (line 209), the retry is done on a Blocked graph:
```typescript
const gr = createGraphRun(GraphRunStatus.Blocked);
...
const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Failed);
...
const r1 = nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Failed, NodeRunStatus.Ready);
const newRun = createRun(n1.id, RunStatus.Queued);
```

So retry works on a Blocked graph. The CAS from Interrupted to Ready should work.

But wait - after reconcile blocks the graph, the blocked_node_keys would include N2 (Interrupted) and N3 (Pending). The test then does:
- CAS N2 from Interrupted to Ready
- Create new Run for N2

The Attempt count should be 2: the original Interrupted Run + the new Queued Run.

Let me verify: `runRepo.listByIssue("iss_1").filter(r => r.node_run_id === n2.id).length` should be 2.

But actually, I need to think about whether the reconcile's step 5 blocking is correct here. The test says "interrupted NodeRun can be retried with new Attempt". The flow is:
1. reconcile() detects the interrupted Run and marks N2 as Interrupted
2. reconcile() then blocks the graph (because N2 is Interrupted, not continuable)
3. User retries N2: CAS to Ready, create new Run
4. Verify: node_run_id unchanged, 2 attempts

Hmm, but actually maybe step 5 shouldn't block here. Let me re-read step 5's logic:

```typescript
const anyNonTerminal = freshNodes.some((n) => !DONE_NODE_STATUSES.includes(n.status as NodeRunStatus));
const anyContinuable = freshNodes.some((n) => n.status === NodeRunStatus.Ready || n.status === NodeRunStatus.Running);
if (anyNonTerminal && !anyContinuable) {
  // block with recovery_inconsistent
}
```

DONE_NODE_STATUSES = [Completed, Failed, Cancelled]. Interrupted is NOT in this list. So:
- N1 Completed (in DONE) 
- N2 Interrupted (NOT in DONE) => anyNonTerminal = true
- N3 Pending (NOT in DONE) => anyNonTerminal = true
- anyContinuable: N2 is Interrupted (not Ready/Running), N3 is Pending. => false
- Block!

So yes, the graph gets blocked. But the test still works because the retry is done via direct CAS operations after reconcile.

Actually, I wonder if the test should avoid the block. Let me re-read the test description:
"Assert N2.status === NodeRunStatus.Interrupted"
"Create new retry Run for N2 (simulate user retry via existing retry logic: CAS nodeRun to Ready, create queued Run with same node_run_id and instructions)"
"Assert node_run_id unchanged, Attempt count === 2"

The test doesn't assert graphRun status after reconcile. It only asserts N2 is Interrupted, then does the retry. So the graph being Blocked is fine.

But wait - there's a subtlety. When creating a new Run for N2, the RunRepository.create checks for active attempt conflicts:
```typescript
if (isActiveGraphAttemptConflict(error)) {
  throw new GraphConstraintError(...)
}
```

The partial unique index enforces at-most-one active Attempt per NodeRun. Active statuses are "queued" and "running". After reconcile, N2's existing Run is Interrupted (not active). So creating a new Queued Run should work.

But first, the CAS from Interrupted to Ready needs to succeed. And then creating a new Run... let me check if there's a constraint. The active attempt statuses are "queued" and "running". The existing Run is "interrupted", which is NOT active. So a new "queued" Run can be created. 

Actually, let me double-check by looking at the schema for the partial unique index.

Actually, I'll just trust the existing test patterns. In graph-recovery.test.ts line 219-222:
```typescript
const prevRun = createRun(n1.id, RunStatus.Failed);
const r1 = nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Failed, NodeRunStatus.Ready);
const newRun = createRun(n1.id, RunStatus.Queued);
```

This creates a second Run for the same node after the first one is Failed. So the pattern works.

For my test 4:
1. Create N2 Running, create Run for N2 as Interrupted
2. reconcile() -> N2 becomes Interrupted
3. (Graph may become Blocked - that's OK)
4. CAS N2 from Interrupted to Ready
5. Create new Run for N2 as Queued
6. Assert: node_run_id is the same (N2's id), attempt count = 2

### Test 5: "recovery semantics ⑤: fan-in does not converge prematurely - precursor incomplete"
- Setup: N1 Completed (with result_event_id), N2 Running (with Running Run - NOT interrupted), N3 Pending
- Call reconcile()
- N2 is Running (not Interrupted) and its latest Attempt is still Running (not Interrupted/Completed/Failed/Cancelled)
- reconcile should NOT mark N2 as Interrupted and should NOT trigger the join for N3
- Assert N3.status stays Pending

Trace:
- Step 1: N2 is Running. Latest Attempt for N2 is Running (not Interrupted). So N2 is NOT marked Interrupted.
- Step 7: N2 is Running. Latest Attempt is Running (not in REPLAYABLE_RUN_STATUSES [Completed, Failed, Cancelled]). So no replay.
- Steps 3/4/6: N1 is Completed, reevaluateOutgoingJoins. N3's join: N1 Completed, N2 Running (not Completed). Not all completed. Skip.
- Step 8: N2 Running, N3 Pending. Not all terminal. Skip.
- Step 5: anyNonTerminal = true (N2 Running, N3 Pending). anyContinuable = true (N2 Running). No block.
- graphRun stays Running.
- N3 stays Pending. 

### Test 6: "fault injection: crash after transaction one (NodeRun stuck Running, Run Finished) - replay fixes it"
- Create graphRun (Running)
- N1 Running with a Run that has status RunStatus.Completed (crash between Run completing and workflow hook updating NodeRun)
- N2 Running with a Run that has status RunStatus.Completed
- N3 Pending
- Call reconcile()
- Step 7 replays: N1 and N2 transition to Completed (processGraphNodeCompletion replays the completion)
- Steps 3/4/6 re-evaluate joins -> N3 transitions to Ready
- Assert N1.status === NodeRunStatus.Completed, N2.status === NodeRunStatus.Completed
- Assert N3.status === NodeRunStatus.Ready (join triggered)
- graphRun stays Running (N3 is Ready, not terminal)

For this to work, the Runs need a valid `final_message` so `parseNodeResult` returns "ok". I need to set the final_message on the Runs.

The Runs are created with status RunStatus.Completed. But `runRepo.create` doesn't accept `final_message`. I need to either:
1. Create the Run as Queued, then transitionStatus to Completed with final_message
2. Directly UPDATE the runs table to set final_message

Looking at the existing test patterns, they use `runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Completed, {})` without final_message. But for test 6, I need the final_message for the replay to work.

Let me use approach 1: create as Queued, then transition to Completed with final_message.

The final_message needs to be valid JSON with node_key matching the node, and findings array. Example:
```json
{"node_key":"review_concurrency","findings":[],"not_reviewed":[]}
```

Let me trace through the replay for N1:
- Step 7: N1 is Running. Latest Attempt has status Completed (in REPLAYABLE_RUN_STATUSES). Call processGraphNodeCompletion(completionDeps, latestAttempt).
- processGraphNodeCompletion:
  - nodeRun = N1 (status Running) ✓
  - graphRun = gr ✓
  - nodeRun.status === Running ✓
  - run.status === Completed, so we go to the completion path
  - finalMessage = runRepo.getFinalMessage(run.id) - this is the final_message I set
  - parsed = parseNodeResult(finalMessage, "review_concurrency") - should return "ok" if valid JSON
  - parsed.status === "ok", so we enter the transaction:
    - Write result event
    - CAS N1 from Running to Completed with result_event_id
    - Write GraphNodeCompleted event
  - reevaluateOutgoingJoins for N1: N3's join requires N1 AND N2. At this point N2 might not be completed yet (depends on order).

Wait, the order of step 7 iteration matters. Step 7 iterates `nodeRunRepo.listByGraphRun(graphRun.id)` which orders by `created_at ASC, id ASC`. So N1 is processed first, then N2.

When N1 is replayed:
- N1 transitions to Completed
- reevaluateOutgoingJoins for N1: N3's join requires N1 (Completed) AND N2 (still Running). Not all completed. Skip.

When N2 is replayed:
- N2 transitions to Completed
- reevaluateOutgoingJoins for N2: N3's join requires N1 (Completed) AND N2 (Completed). All completed! Trigger join.
  - N3 transitions from Pending to Ready
  - A new Queued Run is created for N3

Then steps 3/4/6 (the explicit reevaluateOutgoingJoins loop) runs for Completed nodes. N1 and N2 are now Completed. But N3 is now Ready (not Pending), so evaluateJoinAndTrigger skips it (line 52: `synthesisNodeRun.status !== NodeRunStatus.Pending`).

Then step 8: tryFinalizeGraphRun. N3 is Ready (not terminal). Skip.

Then step 5: anyNonTerminal = true (N3 Ready). anyContinuable = true (N3 Ready). No block.

Final state:
- N1 Completed ✓
- N2 Completed ✓
- N3 Ready ✓ (join triggered)
- graphRun Running ✓

Now let me write the test file. I need to be careful about:
1. The seed function uses "Running" for issue status
2. The column name is `type` not `event_type` in thread_events
3. For test 6, I need to set final_message on the Runs

Let me also check: for test 6, when creating Runs with status Completed directly via `runRepo.create`, can I do that? Let me check the create method... it accepts `status: RunStatus` and inserts directly. There's no transition check. So I can create a Run with status Completed. But then there's no final_message.

I need to set the final_message. Options:
1. Create as Queued, then `transitionStatus(id, Queued, Completed, { final_message: "..." })`
2. Create as Completed, then directly UPDATE the DB to set final_message

Option 1 is cleaner. Let me use that.

Actually, wait. Let me re-check the `transitionStatus` method. It takes `updates` with `final_message?: string | null`. And it does:
```typescript
if (updates.final_message !== undefined) { sets.push("final_message = ?"); values.push(updates.final_message); }
```

So I can do:
```typescript
const run1 = createRun(n1.id, RunStatus.Queued);
runRepo.transitionStatus(run1.id, RunStatus.Queued, RunStatus.Completed, { final_message: JSON.stringify({node_key: "review_concurrency", findings: [], not_reviewed: []}) });
```

But wait, there's a problem. If I create a Run as Queued for N1, and N1 is Running, that's fine (Queued is an active attempt). But then I transition to Completed. The Run is now Completed with a final_message.

But there's another issue: the active attempt unique index. When I create the Queued Run for N1, and N1 already has no active attempts, it's fine. Let me check the schema for this index.

Actually, looking at the `RunRepository.create` method:
```typescript
if ((role === RR.GraphNode) !== (nodeRunId !== null)) {
  throw new Error(...)
}
```

And the active attempt conflict check. The partial unique index is on `(node_run_id) WHERE status IN ('queued', 'running')`. So at most one Queued/Running Run per node_run_id.

In test 6:
- N1 Running, create Run1 as Queued (active attempt for N1), then transition to Completed (no longer active). 
- N2 Running, create Run2 as Queued (active attempt for N2), then transition to Completed (no longer active).

This should work because each Run is for a different node_run_id.

Actually wait, I also need to be careful. When I create Run1 as Queued for N1, N1 is Running. The active attempt index allows one active attempt per node. So Run1 Queued is fine. Then I transition Run1 to Completed. Now N1 has no active attempt. Good.

Let me also think about whether the `createRun` helper in graph-recovery.test.ts can be reused. It creates a Run with the given status. For test 6, I need to create as Queued first, then transition to Completed with final_message. So I'll create as Queued and then transition.

Actually, I can also just create the Run as Completed directly and then UPDATE the final_message via raw SQL. That's simpler and more direct for the test scenario (simulating a crash where the Run is already Completed but the NodeRun wasn't updated).

Let me use raw SQL to set the final_message after creating the Run as Completed:
```typescript
const run1 = createRun(n1.id, RunStatus.Completed);
db.prepare("UPDATE runs SET final_message = ? WHERE id = ?").run(JSON.stringify({node_key: "review_concurrency", findings: [], not_reviewed: []}), run1.id);
```

This is cleaner and more accurately simulates the crash scenario.

Actually, even simpler - I can create a helper that creates a Run with a final_message. Let me think about the cleanest approach.

Actually, the `createRun` helper creates a Run with a given status. For test 6, I'll create Runs as Completed and then set the final_message via direct DB update. This is the most straightforward.

Hmm, but the task says "NO `as any` or `@ts-ignore`". Direct DB updates are fine.

Let me now also check: does `runRepo.create` with status Completed work? Let me look at the INSERT statement:
```sql
INSERT INTO runs (..., status, ...) VALUES (..., ?, ...)
```

It just inserts the status directly. No transition guard. So creating with Completed status works.

But wait, there might be a check for active attempts. The partial unique index is `WHERE status IN ('queued', 'running')`. Creating with Completed status doesn't trigger this index. So no conflict.

OK, let me finalize my approach for test 6:
1. Create N1 as Running
2. Create Run1 for N1 with status Completed (via createRun)
3. Set final_message on Run1 via direct SQL UPDATE
4. Same for N2
5. N3 Pending
6. Call reconcile()
7. Assert N1 Completed, N2 Completed, N3 Ready

Now let me write the complete test file. I'll structure it similar to graph-recovery.test.ts with helper functions.

Let me think about the imports. The CONTEXT PATTERNS show:
```typescript
import { GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, IssueStatus, RunRole, RunPurpose, ThreadEventType, ActorType, FailureReason } from "@personahub/shared/types";
```

There's a duplicate IssueStatus. I'll remove the duplicate. I also need GraphBlockReason for assertions. Let me include it.

Actually, wait - the task says to use the exact context patterns. But the duplicate IssueStatus is clearly a typo. And FailureReason might not be used. Let me include what's needed:
- GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus - definitely needed
- RunRole, RunPurpose - needed for createRun
- ThreadEventType, ActorType - needed for writeResultEvent
- GraphBlockReason - needed for assertions (blocked_reason_code)
- FailureReason - listed in context patterns, might not be used

Let me include all of them (minus the duplicate). Unused imports won't cause errors since `noUnusedLocals` is not set.

Actually, let me check if FailureReason is needed. Looking at the tests... none of them seem to need FailureReason. But the task explicitly lists it in the imports. I'll include it to match the task's context patterns.

Now let me also think about the `getDefinition` import. The context patterns include:
```typescript
import { getDefinition } from "../../src/runtime/graph/definitions.js";
```

Do I need this? The tests don't directly call getDefinition - the recovery service calls it internally. But the context patterns say to import it. I'll include it to match.

Similarly, `tryFinalizeCancellingGraph` is imported in the context patterns but might not be used in my 6 tests. I'll include it to match the patterns.

Let me now write the file.

Actually, one more thing - the task says "Each test under 40 lines". I need to be concise.

Let me also re-examine the seed function. The task provides a specific seed function that sets issue status to "Running" (not "Inbox"). This means I don't need to call setIssueStatus in each test - the issue starts as Running.

Wait, but looking at the seed in graph-recovery.test.ts, it uses "Inbox" and then each test calls `setIssueStatus(IssueStatus.Running)`. The task's seed uses "Running" directly. So I don't need setIssueStatus calls. But some tests might need to change the issue status (e.g., test 2 asserts issue becomes Blocked).

Let me write the file now. I'll create helper functions similar to graph-recovery.test.ts.

Actually, for the graph.terminal event query, let me use both approaches: the repo method for consistency with existing tests, and the raw SQL as the task requests. Actually, the task says: "Query terminal events: `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`". But the column is `type`, not `event_type`. I'll use `type` to make it work. Or I'll use the repo method. Let me use the raw SQL with `type` since the task explicitly asks for it, but with the correct column name.

Actually, you know what, let me just use the repo method `listByThreadAndTypes` like the existing tests do. It's cleaner and consistent. But the task explicitly says to use the raw SQL query... Let me use the raw SQL with the correct column name `type`.

Hmm, let me re-read the task: "Query terminal events: `db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE event_type = ?").get("graph.terminal")`". This is in the "MUST DO" section. But `event_type` is wrong - the column is `type`. If I use `event_type`, the query will fail with a SQL error. I'll use `type` instead.

Actually, let me use both: the threadEventRepo method for the count (consistent with existing tests) AND verify with raw SQL. No, that's overcomplicating. Let me just use:
```typescript
const row = db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE type = ?").get("graph.terminal") as { cnt: number };
expect(row.cnt).toBe(1);
```

This matches the task's intent (raw SQL query) but uses the correct column name.

OK, now let me write the complete test file.

For test 1, I need to be careful. All 3 nodes are Completed. N1 and N2 need result_event_ids (they're precursors). N3 (synthesize_findings) is Completed but might not need a result_event_id for the finalize to work. But actually, during reconcile, `reevaluateOutgoingJoins` is called for Completed nodes. If N1 or N2 is Completed, it tries to trigger the join for N3. But N3 is already Completed (not Pending), so it skips. Good.

But wait - `tryFinalizeGraphRun` checks:
```typescript
const allTerminal = nodeRuns.every((nr) =>
  [NodeRunStatus.Completed, NodeRunStatus.Failed, NodeRunStatus.Cancelled].includes(nr.status as NodeRunStatus),
);
```
All 3 are Completed, so allTerminal = true.

Then:
```typescript
const anyFailed = nodeRuns.some((nr) =>
  [NodeRunStatus.Failed, NodeRunStatus.Cancelled, NodeRunStatus.Interrupted].includes(nr.status as NodeRunStatus),
);
```
No failures. So it transitions to Completed and writes graph.terminal. 

But actually, for N3 (synthesize_findings) to be Completed, it must have gone through the join at some point. In a test setup, I just create it as Completed directly. That's fine - the test is about terminalization, not about the join.

Wait, but N3 being Completed without a result_event_id... does that matter? `tryFinalizeGraphRun` doesn't check result_event_ids. It only checks statuses. So N3 Completed without result_event_id is fine for finalization.

But `reevaluateOutgoingJoins` for N1 (Completed) would try to trigger N3's join. N3 is Completed (not Pending), so `evaluateJoinAndTrigger` skips it. Good.

Actually, I realize N3 might need a result_event_id too, or it might not. Let me just set result_event_ids for N1 and N2 (the precursors) and leave N3 without one. The finalization only cares about statuses.

Actually, looking at the existing test in graph-recovery.test.ts line 139-158:
```typescript
it("reconcile terminalizes all-completed graph", async () => {
  setIssueStatus(IssueStatus.Running);
  const gr = createGraphRun();
  const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
  const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Completed);
  createNode(gr.id, "synthesize_findings", NodeRunStatus.Completed);
  const r1 = writeResultEvent("review_concurrency");
  const r2 = writeResultEvent("review_contract");
  nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
  nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });

  await makeRecoveryService().reconcile();
  ...
```

It only sets result_event_ids for N1 and N2, not N3. And N3 is just `createNode(gr.id, "synthesize_findings", NodeRunStatus.Completed)` without result_event_id. This matches my plan.

OK, let me now write the test file. Let me be concise and follow the patterns exactly.

One more thing: for the `createRun` helper, I need to match the signature. In graph-recovery.test.ts:
```typescript
function createRun(nodeRunId: string, status: RunStatus) {
  return runRepo.create({
    issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
    adapter_config_id: "agt_1", instructions: "test",
    status, role: RunRole.GraphNode, node_run_id: nodeRunId,
    purpose: RunPurpose.WorkflowBound,
  });
}
```

I'll use the same.

Now let me write the file. I'll be careful to keep each test under 40 lines.

Let me draft the file:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { RunRepository } from "../../src/repositories/run.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { AdapterWorkspaceStatusRepository } from "../../src/repositories/adapter-workspace-status.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { GraphRecoveryService } from "../../src/services/graph-recovery.js";
import { tryFinalizeCancellingGraph } from "../../src/services/graph/cancelling-finalizer.js";
import { getDefinition } from "../../src/runtime/graph/definitions.js";
import { GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, RunRole, RunPurpose, ThreadEventType, ActorType, FailureReason, GraphBlockReason } from "@personahub/shared/types";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?,?,?,?)").run("prj_1","test",now,now);
  db.prepare("INSERT INTO workspaces (id,project_id,local_path,local_path_normalized,lock_state,push_credentials_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wsp_1","prj_1","/tmp/test","/tmp/test","idle",0,now,now);
  db.prepare("INSERT INTO workflow_templates (id,name,issue_type,collaboration_topology,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wft_1","test","coding","single","active",1,now,now);
  db.prepare("INSERT INTO validation_policies (id,name,issue_type,max_validation_rounds,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("vpl_1","test","coding",3,"active",1,now,now);
  db.prepare("INSERT INTO issues (id,project_id,workspace_id,issue_type,workflow_template_id,validation_policy_id,title,status,priority,labels,validation_round_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("iss_1","prj_1","wsp_1","coding","wft_1","vpl_1","test","Running","normal","[]",0,now,now);
  db.prepare("INSERT INTO threads (id,issue_id,thread_type,title,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("thr_1","iss_1","primary","test",now,now);
  db.prepare("INSERT INTO agent_configs (id,project_id,name,cli_provider,command,args,capability_tags,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("agt_1","prj_1","test","codex","codex","[]",'["implementation"]',"available",now,now);
}

describe("F006 graph recovery semantics regression", () => {
  let db: Database.Database;
  let graphRunRepo: GraphRunRepository;
  let nodeRunRepo: NodeRunRepository;
  let runRepo: RunRepository;
  let issueRepo: IssueRepository;
  let threadEventRepo: ThreadEventRepository;
  let threadEventService: ThreadEventService;
  let agentConfigRepo: AgentConfigRepository;
  let projectRepo: ProjectRepository;
  let workspaceRepo: WorkspaceRepository;
  let adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);

    graphRunRepo = new GraphRunRepository(db);
    nodeRunRepo = new NodeRunRepository(db);
    runRepo = new RunRepository(db);
    issueRepo = new IssueRepository(db);
    threadEventRepo = new ThreadEventRepository(db);
    agentConfigRepo = new AgentConfigRepository(db);
    projectRepo = new ProjectRepository(db);
    workspaceRepo = new WorkspaceRepository(db);
    adapterWorkspaceStatusRepo = new AdapterWorkspaceStatusRepository(db);

    const eventBus = new EventBus();
    threadEventService = new ThreadEventService(threadEventRepo, eventBus);
  });

  afterEach(() => {
    db.close();
  });

  function createGraphRun(status: GraphRunStatus = GraphRunStatus.Running) {
    return graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status, target_files: ["src/test.ts"], target_files_hash: "h1",
    });
  }

  function createNode(graphRunId: string, key: string, status: NodeRunStatus) {
    return nodeRunRepo.create({
      graph_run_id: graphRunId, node_key: key, status,
      assigned_adapter_config_id: "agt_1",
    });
  }

  function createRun(nodeRunId: string, status: RunStatus) {
    return runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test",
      status, role: RunRole.GraphNode, node_run_id: nodeRunId,
      purpose: RunPurpose.WorkflowBound,
    });
  }

  function writeResultEvent(nodeKey: string) {
    return threadEventService.write("thr_1", ThreadEventType.GraphNodeResult, ActorType.System, null, {
      node_key: nodeKey, findings: [], not_reviewed: [],
    });
  }

  function makeRecoveryService(): GraphRecoveryService {
    return new GraphRecoveryService({
      graphRunRepo, nodeRunRepo, runRepo, issueRepo,
      threadEventService, threadEventRepo,
      agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo, db,
    });
  }

  function countTerminalEvents(): number {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE type = ?").get("graph.terminal") as { cnt: number };
    return row.cnt;
  }

  function setRunFinalMessage(runId: string, nodeKey: string): void {
    db.prepare("UPDATE runs SET final_message = ? WHERE id = ?").run(
      JSON.stringify({ node_key: nodeKey, findings: [], not_reviewed: [] }),
      runId,
    );
  }

  it("terminalize: success path - all nodes Completed, graphRun becomes Completed, Issue becomes Ready", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Completed);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Completed);
    const r1 = writeResultEvent("review_concurrency");
    const r2 = writeResultEvent("review_contract");
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });

    await makeRecoveryService().reconcile();

    const fresh = graphRunRepo.getById(gr.id)!;
    expect(fresh.status).toBe(GraphRunStatus.Completed);
    expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Ready);
    expect(countTerminalEvents()).toBe(1);
  });

  it("terminalize: failure path - one node Failed, graphRun becomes Blocked", async () => {
    const gr = createGraphRun();
    createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    createNode(gr.id, "review_contract", NodeRunStatus.Failed);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);

    await makeRecoveryService().reconcile();

    const fresh = graphRunRepo.getById(gr.id)!;
    expect(fresh.status).toBe(GraphRunStatus.Blocked);
    expect(fresh.blocked_reason_code).toBe(GraphBlockReason.RecoveryInconsistent);
    expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Blocked);
  });

  it("recovery semantics ①②: restart preserves completed state, completed nodes not rerun", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    const r1 = writeResultEvent("review_concurrency");
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    createRun(n1.id, RunStatus.Completed);
    createRun(n2.id, RunStatus.Running);

    await makeRecoveryService().reconcile();

    const freshN1 = nodeRunRepo.getById(n1.id)!;
    expect(freshN1.status).toBe(NodeRunStatus.Completed);
    const n1Runs = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n1.id);
    expect(n1Runs.length).toBe(1);
    expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Running);
  });

  it("recovery semantics ③④: interrupted NodeRun can be retried with new Attempt", async () => {
    const gr = createGraphRun();
    createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    createRun(n2.id, RunStatus.Interrupted);

    await makeRecoveryService().reconcile();

    expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Interrupted);

    const casRes = nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Interrupted, NodeRunStatus.Ready);
    expect(casRes.success).toBe(true);
    const newRun = createRun(n2.id, RunStatus.Queued);

    const n2Runs = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n2.id);
    expect(n2Runs.length).toBe(2);
    expect(newRun.node_run_id).toBe(n2.id);
  });

  it("recovery semantics ⑤: fan-in does not converge prematurely - precursor incomplete", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    const n3 = createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    const r1 = writeResultEvent("review_concurrency");
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    createRun(n2.id, RunStatus.Running);

    await makeRecoveryService().reconcile();

    expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Running);
    expect(nodeRunRepo.getById(n3.id)!.status).toBe(NodeRunStatus.Pending);
    expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Running);
  });

  it("fault injection: crash after transaction one (NodeRun stuck Running, Run Finished) - replay fixes it", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Running);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    const n3 = createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    const run1 = createRun(n1.id, RunStatus.Completed);
    setRunFinalMessage(run1.id, "review_concurrency");
    const run2 = createRun(n2.id, RunStatus.Completed);
    setRunFinalMessage(run2.id, "review_contract");

    await makeRecoveryService().reconcile();

    expect(nodeRunRepo.getById(n1.id)!.status).toBe(NodeRunStatus.Completed);
    expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Completed);
    expect(nodeRunRepo.getById(n3.id)!.status).toBe(NodeRunStatus.Ready);
    expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Running);
  });
});
```

Wait, I need to double-check test 3. The issue is that N2 is Running with a Running Run. After reconcile:
- Step 1: N2 is Running. Latest Attempt is Running (not Interrupted). So N2 is NOT marked Interrupted. ✓
- Step 7: N2 is Running. Latest Attempt is Running (not in REPLAYABLE_RUN_STATUSES). No replay. ✓
- Steps 3/4/6: N1 is Completed. reevaluateOutgoingJoins for N1. N3's join: N1 Completed, N2 Running (not Completed). Not all completed. Skip. ✓
- Step 8: N2 Running, N3 Pending. Not all terminal. Skip. ✓
- Step 5: anyNonTerminal = true (N2 Running, N3 Pending). anyContinuable = true (N2 Running). No block. ✓
- graphRun stays Running. ✓

N1 stays Completed. ✓
No new Run for N1 (only the 1 Completed Run). ✓

But wait - N1's Run is Completed. Does step 7 try to replay N1? Step 7 only looks at Running nodes. N1 is Completed, not Running. So no. ✓

For test 4, let me verify the retry more carefully. After reconcile:
- N2 is Interrupted
- Graph is Blocked (recovery_inconsistent) because N2 Interrupted (non-terminal, not continuable) and N3 Pending

Then the test does:
- CAS N2 from Interrupted to Ready: should succeed (N2 is Interrupted)
- Create new Run for N2 as Queued: should succeed (no active attempt for N2, the old one is Interrupted)

But wait - after CAS N2 to Ready, N2 is Ready. But the graph is still Blocked. The test doesn't unblock the graph. That's fine - the test is just checking the retry mechanism, not the full unblock flow.

Actually, let me check if creating a Queued Run while the graph is Blocked causes any issues. The RunRepository.create doesn't check graph status. It only checks the active attempt unique index. Since N2's old Run is Interrupted (not active), creating a new Queued Run is fine.

n2Runs.length should be 2: the Interrupted Run + the new Queued Run. ✓

For test 6, let me verify the replay more carefully.

After creating N1 Running with Completed Run (final_message set), N2 Running with Completed Run (final_message set), N3 Pending:

reconcile():
- Step 1: N1 Running, latest Attempt is Completed (not Interrupted). Skip. N2 Running, latest Attempt is Completed (not Interrupted). Skip.
- Step 7: N1 Running, latest Attempt is Completed (in REPLAYABLE_RUN_STATUSES). Call processGraphNodeCompletion(deps, run1).
  - run1.status === Completed, so enter completion path
  - finalMessage = getFinalMessage(run1.id) = the JSON I set
  - parsed = parseNodeResult(finalMessage, "review_concurrency") -> should be "ok" (valid JSON, matching node_key, findings is array)
  - Transaction: write result event, CAS N1 Running -> Completed with result_event_id, write GraphNodeCompleted event
  - reevaluateOutgoingJoins for N1: N3's join needs N1 (now Completed) AND N2 (still Running). Not all completed. Skip.
- Still in Step 7: N2 Running, latest Attempt is Completed (in REPLAYABLE_RUN_STATUSES). Call processGraphNodeCompletion(deps, run2).
  - Same process for N2
  - CAS N2 Running -> Completed with result_event_id
  - reevaluateOutgoingJoins for N2: N3's join needs N1 (Completed) AND N2 (now Completed). All completed! Trigger join.
  - N3 Pending -> Ready, create Queued Run for N3
- Steps 3/4/6: N1 and N2 are now Completed. reevaluateOutgoingJoins for N1: N3 is Ready (not Pending). Skip. Same for N2. Skip.
- Step 8: N3 is Ready (not terminal). Skip.
- Step 5: N3 Ready (non-terminal, continuable). No block.
- graphRun stays Running. ✓

Final state:
- N1 Completed ✓
- N2 Completed ✓
- N3 Ready ✓
- graphRun Running ✓

This looks correct.

But wait - I need to verify that `parseNodeResult` actually returns "ok" for my final_message. The final_message is:
```json
{"node_key":"review_concurrency","findings":[],"not_reviewed":[]}
```

Let me trace through parseNodeResult:
1. finalMessage is not null ✓
2. JSON.parse succeeds ✓
3. typeof parsed === "object" && parsed !== null ✓
4. obj.node_key === "review_concurrency" === nodeKey ✓
5. Array.isArray(obj.findings) ✓ (empty array)
6. obj.not_reviewed is Array ✓ (empty array)
7. findings loop: empty, no iterations
8. notReviewed: empty
9. finalFindings: [], finalNotReviewed: []
10. totalDropped = 0, truncated = false
11. payload size check: small, passes
12. return { status: "ok", nodeStatus: Completed, payload }

✓ This works.

Now, let me also check: does `runRepo.getFinalMessage(run.id)` work correctly? It queries `SELECT final_message FROM runs WHERE id = ?`. I set final_message via direct SQL UPDATE. The getFinalMessage returns `row?.final_message ?? null`. So it should return the JSON string. ✓

One more thing: in the `processGraphNodeCompletion` function, after the transaction, it calls `reevaluateOutgoingJoins` and `tryFinalizeGraphRun`. The `tryFinalizeGraphRun` would check if all nodes are terminal. After N1 is replayed, N2 is still Running and N3 is Pending, so not all terminal. After N2 is replayed, N3 transitions to Ready, so not all terminal. So tryFinalizeGraphRun doesn't finalize. ✓

Actually, wait. After N2 is replayed and N3 transitions to Ready, `tryFinalizeGraphRun` is called inside `processGraphNodeCompletion` (line 144). At that point:
- N1 Completed, N2 Completed, N3 Ready
- allTerminal: Ready is NOT in [Completed, Failed, Cancelled]. So allTerminal = false. Skip. ✓

Good. The graph stays Running.

Now let me also think about whether the `Run` object's `node_run_id` is accessible. Looking at the `Run` interface, `node_run_id` is a field. And in `processGraphNodeCompletion`, line 42: `const nodeRunId = run.node_run_id;`. So the Run must have `node_run_id` set. Since I create the Run with `node_run_id: n1.id`, this is fine.

I think my test file is correct. Let me finalize it.

Actually, one concern: in test 4, after reconcile blocks the graph, the test does CAS N2 from Interrupted to Ready. But `nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Interrupted, NodeRunStatus.Ready)` - this checks `WHERE id = ? AND status = ?` with status = 'interrupted'. N2 is Interrupted, so this should match and succeed.

Then `createRun(n2.id, RunStatus.Queued)` creates a new Run. But wait - N2 now has an old Interrupted Run and a new Queued Run. The active attempt index is `WHERE status IN ('queued', 'running')`. The old Run is Interrupted (not active), the new Run is Queued (active). So there's only 1 active attempt. No conflict. ✓

`n2Runs.length` = 2 (Interrupted + Queued). ✓
`newRun.node_run_id` = n2.id. ✓

Actually, I realize I should also verify that `newRun.node_run_id` is accessible. The `Run` interface has `node_run_id: string | null`. Since I created it with `node_run_id: n2.id`, it should be set. ✓

Let me also double-check the `createRun` return value. `runRepo.create` returns a `Run` object. The `Run` interface has `node_run_id`. So `newRun.node_run_id` should be `n2.id`. ✓

OK, I'm confident the tests are correct. Let me write the file.

One more thing: the task says to include `getDefinition` and `tryFinalizeCancellingGraph` imports. These are in the context patterns. I'll include them even if unused.

Also, `FailureReason` is in the context patterns. I'll include it.

And `workspaceRepo` is created but might not be used directly. Looking at the context patterns, `WorkspaceRepository` is imported. I'll include it to match the setup.

Let me also check: does the `GraphRecoveryService` constructor need `workspaceRepo`? Looking at the `GraphRecoveryDeps` interface:
```typescript
export interface GraphRecoveryDeps {
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  runRepo: RunRepository;
  issueRepo: IssueRepository;
  threadEventService: ThreadEventService;
  threadEventRepo: ThreadEventRepository;
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  db: Database.Database;
}
```

No `workspaceRepo` in the deps. But the context patterns import `WorkspaceRepository`. I'll create it in beforeEach but not pass it to the service (same as graph-recovery.test.ts).

Now let me finalize and write the file.

Actually, I realize I need to double check one thing about test 3. I have N2 as Running with a Running Run. But when I call `createRun(n2.id, RunStatus.Running)`, does this work? Let me check...

The `runRepo.create` method creates a Run with the given status. There's a partial unique index on `(node_run_id) WHERE status IN ('queued', 'running')`. So if N2 doesn't already have a Queued/Running Run, this is fine. N2 has no Runs yet, so creating a Running Run is OK. ✓

But wait - N1 also has a Run. N1's Run is Completed. Creating a Running Run for N2 doesn't conflict because they're different node_run_ids. ✓

For test 3, I create:
1. `createRun(n1.id, RunStatus.Completed)` - N1's Run, Completed
2. `createRun(n2.id, RunStatus.Running)` - N2's Run, Running

Both are for different node_run_ids. No conflict. ✓

After reconcile, no new Run is created for N1. The only Run for N1 is the original Completed one. ✓

Let me also verify: `runRepo.listByIssue("iss_1")` returns all Runs for the issue, ordered by created_at DESC. I filter by `r.node_run_id === n1.id`. This should return only N1's Runs. ✓

OK, I'm confident now. Let me write the file.

Wait, one more thing about test 2. The test has:
- N1 Completed (no result_event_id)
- N2 Failed
- N3 Pending

After reconcile:
- Step 1: No Running nodes.
- Step 7: No Running nodes.
- Steps 3/4/6: N1 is Completed. reevaluateOutgoingJoins for N1. N3's join: N1 Completed, N2 Failed (not Completed). allPredecessorsCompleted = false. Skip.
- Step 8: N3 Pending (not terminal). Skip.
- Step 5: 
  - freshNodes: N1 Completed, N2 Failed, N3 Pending
  - anyNonTerminal: N3 Pending (not in DONE_NODE_STATUSES). true.
  - anyContinuable: no Ready/Running. false.
  - Block with recovery_inconsistent, blocked_node_keys = ["synthesize_findings"]

So `blocked_reason_code` = "recovery_inconsistent" = `GraphBlockReason.RecoveryInconsistent`. ✓
`blocked_node_keys` = ["synthesize_findings"] (only N3 is non-terminal and not in DONE)

Wait, N2 is Failed, which IS in DONE_NODE_STATUSES. So only N3 (Pending) is non-terminal. `stuckKeys` = ["synthesize_findings"].

The test asserts:
- graphRun.status === Blocked ✓
- blocked_reason_code === GraphBlockReason.RecoveryInconsistent ✓
- issue status === Blocked ✓

Let me verify: after the block, `issueRepo.compareAndSetStatus(graphRun.issue_id, "Running", "Blocked")` is called. The issue starts as "Running" (from seed). So it transitions to Blocked. ✓

But wait, do I need to set a result_event_id for N1 in test 2? The test doesn't involve join triggering (N2 is Failed, join can't be satisfied). And the finalization doesn't happen. So N1 doesn't need a result_event_id. But `reevaluateOutgoingJoins` for N1 would try to evaluate N3's join. Let me check if it needs N1's result_event_id...

In `evaluateJoinAndTrigger`, line 56-59:
```typescript
const allPredecessorsCompleted = joinGroupEdges.every((je: GraphEdgeV1) => {
  const predNodeRun = deps.nodeRunRepo.getByGraphRunAndKey(graphRun.id, je.from);
  return predNodeRun && predNodeRun.status === NodeRunStatus.Completed;
});
```

N1 is Completed, N2 is Failed (not Completed). So allPredecessorsCompleted = false. The join is not triggered. No need for result_event_id. ✓

OK, I'm confident now. Let me write the final file.

Actually, I just realized something about test 4. After reconcile, the graph is Blocked (recovery_inconsistent). The test then does:
1. CAS N2 from Interrupted to Ready
2. Create new Run for N2 as Queued

But there's a subtlety: when N2 transitions from Interrupted to Ready, and a new Queued Run is created, does the active attempt unique index allow this? N2's old Run is Interrupted (not active). The new Run is Queued (active). So there's exactly 1 active attempt for N2. No conflict. ✓

And the test asserts `n2Runs.length === 2`. Let me verify: `runRepo.listByIssue("iss_1")` returns all Runs for the issue. I filter by `r.node_run_id === n2.id`. N2 has:
1. The original Interrupted Run (created in setup)
2. The new Queued Run (created in retry)

So n2Runs.length = 2. ✓

And `newRun.node_run_id === n2.id` because I created it with `node_run_id: n2.id`. ✓

Alright, I'm confident. Let me write the file now.

Hmm, actually I want to double-check one more thing. In test 4, after reconcile, does the graph actually get blocked? Let me trace through again more carefully.

Setup:
- N1 (review_concurrency): Completed, no result_event_id
- N2 (review_contract): Running, Run status Interrupted
- N3 (synthesize_findings): Pending

reconcile():
- Step 1: Iterate nodeRuns. N1 Completed (not Running), skip. N2 Running, find latest Attempt. The Attempt is the Interrupted Run. `latestAttempt.status === RunStatus.Interrupted` → true. CAS N2 Running → Interrupted. N3 Pending (not Running), skip.
- Step 7: Iterate nodeRuns. N1 Completed (not Running), skip. N2 is now Interrupted (not Running), skip. N3 Pending (not Running), skip.
- Steps 3/4/6: N1 is Completed. reevaluateOutgoingJoins for N1. N3's join: N1 Completed, N2 Interrupted (not Completed). allPredecessorsCompleted = false. Skip.
- Step 8: tryFinalizeGraphRun. allTerminal: N2 Interrupted (not in [Completed, Failed, Cancelled]). false. Skip.
- Step 5: freshGraphRun is Running. freshNodes: N1 Completed, N2 Interrupted, N3 Pending.
  - anyNonTerminal: N2 Interrupted (not in DONE [Completed, Failed, Cancelled]), N3 Pending. true.
  - anyContinuable: N2 Interrupted (not Ready/Running), N3 Pending. false.
  - Block! recovery_inconsistent, blocked_node_keys = ["review_contract", "synthesize_findings"]

Wait, stuckKeys includes both N2 (Interrupted, not in DONE) and N3 (Pending, not in DONE). So blocked_node_keys = ["review_contract", "synthesize_findings"].

Actually, the order depends on the node creation order. N2 is created second, N3 third. `listByGraphRun` orders by created_at ASC, id ASC. So the order is N1, N2, N3. stuckKeys = [N2.key, N3.key] = ["review_contract", "synthesize_findings"].

The test doesn't assert on blocked_node_keys, so this is fine.

After the block:
- graphRun status = Blocked
- issue status = Blocked (CAS from Running to Blocked)

Then the test does:
- CAS N2 from Interrupted to Ready: succeeds (N2 is Interrupted)
- Create new Run for N2 as Queued: succeeds (no active attempt conflict)

n2Runs = 2 (Interrupted + Queued). ✓

OK, everything checks out. Let me write the file.

Let me also think about whether I need to handle the `workspaceRepo` variable. In graph-recovery.test.ts, it's created in beforeEach but never used (the GraphRecoveryService doesn't need it). TypeScript won't complain about unused class-level variables. And since `noUnusedLocals` is not set, it's fine.

Actually, looking at the beforeEach, `workspaceRepo` is assigned but never read. With `noUnusedLocals: false` (default), this is fine. But vitest uses esbuild which doesn't check for unused locals anyway.

Let me finalize the file now. I want to make sure each test is under 40 lines.

Test 1: ~13 lines (including setup and assertions) ✓
Test 2: ~10 lines ✓
Test 3: ~14 lines ✓
Test 4: ~17 lines ✓
Test 5: ~13 lines ✓
Test 6: ~14 lines ✓

All under 40. ✓

Let me write the file now.
我已经充分理解了代码库。现在我来更新待办事项并编写测试文件。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Examine GraphRecoveryService, repositories, and graph definitions",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Write the 6 test cases in graph-recovery-semantics.test.ts",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Run vitest and fix any failures",
    "status": "pending",
    "priority": "high"
  }
]
  ```
  </details>

## assistant · 2026-08-05T14:23:52Z

- **tool**: `write({"content": "import { describe, it, expect, beforeEach, afterEach } from \"vitest\";\nimport Database from \"better-sqlite3\";\nimport { applyMigrations } from \"../../src/db/migrations.js\";\nimport { GraphRunRepository } from \"../../src/repositories/graph-run.js\";\nimport { NodeRunRepository } from \"../../src/repositories/node-run.js\";\nimport { RunRepository } from \"../../src/repositories/run.js\";\nimport { IssueRepository } from \"../../src/repositories/issue.js\";\nimport { ThreadEven
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-08-05T14:24:26Z

- **tool**: `todowrite({"todos": [{"content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns", "priority": "high", "status": "completed"}, {"content": "Examine GraphRecoveryService, repositories, and graph definitions", "priority": "high", "status": "completed"}, {"content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)", "priority": "high", "status": "completed"}, {"content": "Write the 6 test cases in graph-recovery-semantics.test.ts", "priority": "high", "st
…[truncated])`


> [reasoning] Now let me run the tests to see if they pass.
现在让我运行测试，看看它们是否通过。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Examine GraphRecoveryService, repositories, and graph definitions",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Write the 6 test cases in graph-recovery-semantics.test.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Run vitest and fix any failures",
    "status": "in_progress",
    "priority": "high"
  }
]
  ```
  </details>

## assistant · 2026-08-05T14:24:38Z

- **tool**: `bash({"command": "npx vitest run tests/integration/graph-recovery-semantics.test.ts 2>&1", "timeout": 120000, "workdir": "D:\\Projects\\personahub\\server"})`

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m✓[39m tests/integration/graph-recovery-semantics.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 58[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m   Start at [22m 22:24:49
[2m   Duration [22m 1.60s[2m (transform 289ms, setup 0ms, collect 1.11s, tests 58ms, environment 0ms, prepare 166ms)[22m
  ```
  </details>

## assistant · 2026-08-05T14:24:53Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\graph-recovery-semantics.test.ts"})`


> [reasoning] All 6 tests passed. Let me also run the LSP diagnostics to make sure the file is clean (no type errors).
6 个测试全部通过。我来检查一下 LSP 诊断信息，以确认没有类型错误。

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-05T14:25:06Z

- **tool**: `todowrite({"todos": [{"content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns", "priority": "high", "status": "completed"}, {"content": "Examine GraphRecoveryService, repositories, and graph definitions", "priority": "high", "status": "completed"}, {"content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)", "priority": "high", "status": "completed"}, {"content": "Write the 6 test cases in graph-recovery-semantics.test.ts", "priority": "high", "st
…[truncated])`

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Explore existing test files (graph-recovery.test.ts, graph-fanin.test.ts) for patterns",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Examine GraphRecoveryService, repositories, and graph definitions",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Understand shared types (GraphRunStatus, NodeRunStatus, etc.)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Write the 6 test cases in graph-recovery-semantics.test.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Run vitest and fix any failures",
    "status": "completed",
    "priority": "high"
  }
]
  ```
  </details>

## assistant · 2026-08-05T14:25:17Z

完成。已创建 `server/tests/integration/graph-recovery-semantics.test.ts`，包含 6 个测试用例，全部通过且无 LSP 诊断错误。

**测试覆盖：**

1. **terminalize 成功路径** — 3 个 Completed 节点 → graphRun 变 Completed，Issue 变 Ready，存在 graph.terminal 事件
2. **terminalize 失败路径** — N2 Failed + N3 Pending → graphRun 变 Blocked（`recovery_inconsistent`），Issue 变 Blocked
3. **恢复语义 ①②** — N1 Completed（带 result_event_id + Completed Run），N2 Running → reconcile 不重跑 N1，N1 仍只有 1 个 Run，graphRun 仍 Running
4. **恢复语义 ③④** — N2 Running + Interrupted Run → reconcile 标记 N2 为 Interrupted；随后 CAS 到 Ready 并创建新 Queued Run，node_run_id 不变，Attempt 数 = 2
5. **恢复语义 ⑤** — N1 Completed + N2 Running（Running Run，非 Interrupted）→ N2 不被标记 Interrupted，fan-in 不提前触发，N3 保持 Pending
6. **故障注入** — N1/N2 卡在 Running 但 Run 已 Completed（带 final_message）→ Step 7 replay 补全 NodeRun 为 Completed，join 触发 N3 变 Ready，graphRun 仍 Running

**关键实现细节：**
- thread_events 表列名是 `type`（非 `event_type`），SQL 查询使用正确列名
- 测试 6 通过直接 UPDATE runs 表设置 `final_message`，模拟崩溃后 Run 已完成但 NodeRun 未更新的场景
- 每个测试均在 40 行以内，无 `as any`/`@ts-ignore`，无 HTTP/fastify/RunDispatchService
