---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_0899c80beffeWoH4nLWy7ekIiQ"
title: "F004 T060-T062: Startup Recovery (@Sisyphus-Junior subagent)"
project: "D:/Projects/personahub"
model: "deepseek-v4-flash"
created_at: "2026-07-18T18:00:59Z"
updated_at: "2026-07-18T18:18:04Z"
tokens_input: 101097
tokens_output: 20210
cost: 0.0441
parent_id: "ses_08ab84becffeL7SIbh48ShFh2z"
---

# F004 T060-T062: Startup Recovery (@Sisyphus-Junior subagent)

## user · 2026-07-18T18:01:00Z

## TASK: Implement F004 T060-T062 - Startup Recovery & Queue Drain Eligibility

Implement the validation recovery service for server restart scenarios.

## Read these files first:
1. `docs/features/0.1/F004-autonomous-validation/design.md` - §6.7 (Recovery)
2. `server/src/services/stale-recovery.ts` - Existing F003 recovery service
3. `server/src/services/run-dispatch.ts` - Has `startNextQueuedRun()` with some eligibility checks already
4. `server/src/services/validation/workflow-service.ts` - Has requestValidation, processValidatorResult
5. `server/src/repositories/issue.ts` - Has `listValidatingWithoutActiveValidator()`
6. `server/src/repositories/run.ts` - Has `getActiveValidator`, `getLatestCompletedByRole`
7. `server/src/index.ts` - Server startup, recovery is called here
8. `server/tests/helpers.ts` - Test setup

## T060-T061: ValidationRecoveryService
T060: Write `server/tests/integration/validation-recovery.test.ts`:
- Completed implementation Run + Issue Running + no validation requested -> requestValidation called
- Terminal validator Run + Issue Validating + no result -> processValidatorResult called
- Validating Issue with no active/terminal validator -> rebuild validator (or Blocked if config unavailable)
- Multiple restarts don't cause duplicate events (idempotent)
- Recovery reads from `validation.requested` event to get fixed implementation_run_id and policy snapshot (doesn't re-derive from current config)

T061: Implement `server/src/services/validation/recovery-service.ts`:
```typescript
export class ValidationRecoveryService {
  constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private threadEventRepo: ThreadEventRepository,
  ) {}
  
  async reconcile(): Promise<void> {
    // 1. For each Issue in Validating without active validator:
    //    - Find latest completed implementation Run
    //    - If no validation.requested event -> call requestValidation
    //    - If validation.requested exists but no validator Run -> rebuild or Blocked
    // 2. For each Issue in Validating with terminal validator Run but no result:
    //    - Call processValidatorResult
    // 3. For each completed implementation Run + Issue Running + no validation:
    //    - Call requestValidation
  }
}
```

Register in `server/src/index.ts`: call `recoveryService.reconcile()` after F003 `staleRecoveryService.recover()` and before listen/drain queue.

## T062: Queue drain eligibility (partially done)
Verify/extend `startNextQueuedRun()` in `run-dispatch.ts`:
- implementation Run -> only Inbox/Ready/Running allowed; Validating/Done/Blocked -> cancel with reason="issue_state_changed_before_start"
- validator Run -> only Validating allowed, and validation_round must match current round
- Done/Blocked -> don't start new Run
- validator doesn't get cross-Issue FIFO priority

Add test if not already covered.

## Rules:
- Tests first (TDD)
- File limit: 350 lines hard cap
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- Run `npm run typecheck` - must pass
- Run `npx -w @personahub/server vitest run` - ALL tests must pass
- Check off T060-T062 in tasks.md
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-07-18T18:01:00Z

- **tool**: `todowrite({"todos": [{"content": "Read all prerequisite files (design doc, existing services, repos, tests)", "status": "in_progress", "priority": "high"}, {"content": "T060: Write integration test for ValidationRecoveryService", "status": "pending", "priority": "high"}, {"content": "T061: Implement ValidationRecoveryService", "status": "pending", "priority": "high"}, {"content": "Register recoveryService.reconcile() in server/src/index.ts", "status": "pending", "priority": "high"}, {"content": "T062: Ver
…[truncated])`


> [reasoning] Let me break down this task:

1. Read all the prerequisite files
2. Implement T060-T062: Validation Recovery Service & Queue Drain Eligibility
3. Follow TDD - tests first
4. All typechecks and tests must pass

Let me start by reading all the necessary files in parallel.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all prerequisite files (design doc, existing services, repos, tests)",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T060: Write integration test for ValidationRecoveryService",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T061: Implement ValidationRecoveryService",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Register recoveryService.reconcile() in server/src/index.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T062: Verify/extend startNextQueuedRun eligibility checks + tests",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Run typecheck and all tests - must pass",
    "status": "pending",
    "priority": "high"
  }
]
  ```
  </details>

## assistant · 2026-07-18T18:01:06Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\design.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\stale-recovery.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\validation\\workflow-service.ts"})`


> [reasoning] Let me read all the prerequisite files first.
Let me read all the prerequisite files.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\design.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F004]
3: related_features: [F001, F002, F003, F005]
4: topics: [autonomous-validation, workflow-engine, validator, evidence-summary, issue-state, recovery]
5: doc_kind: design
6: created: 2026-07-16
7: updated: 2026-07-18
8: ---
9: 
10: # F004：Autonomous Validation - 设计
11: 
12: > Status: ready-for-development | Owner: TBD | Spec: `spec.md`
13: 
14: ## 1. 技术概要
15: 
16: F004 在 F003 已统一的 Run terminal finalization 出口之后增加最小 sequential workflow engine。Implementation Run 只有在 file change/handoff 已完成持久化后，才会触发 validator；validator terminal Run 则由同一 engine 解析最终回答、校验 evidence、提交 validation outcome。
17: 
18: ```text
19: implementation Run completed
20:   -> F003
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\stale-recovery.ts</path>
<type>file</type>
<content>
1: import type { RunStatus } from "@personahub/shared/types";
2: import { RunStatus as RS, FailureReason as FR, ThreadEventType, ActorType, BaselineStatus } from "@personahub/shared/types";
3: import type { RunRepository } from "../repositories/run.js";
4: import type { WorkspaceRepository } from "../repositories/workspace.js";
5: import type { ThreadEventService } from "./thread-event.js";
6: import type { WorkspaceLockService } from "./workspace-lock.js";
7: import type { DevelopmentTraceService } from "./development-trace.js";
8: import type { RunTraceRepository } from "../repositories/run-trace.js";
9: import { SCAN_REASON_CODES } from "../runtime/trace/constants.js";
10: 
11: export c
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\run-dispatch.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, FailureReason, IssueStatus, ThreadEvent } from "@personahub/shared/types";
3: import { IssueStatus as IS, RunStatus as RS, RunRole, ThreadEventType, ActorType, CommandTraceCapability, ValidationBlockReason } from "@personahub/shared/types";
4: import { ErrorCode } from "@personahub/shared/errors";
5: import type { RunService } from "./run.js";
6: import type { WorkspaceLockService } from "./workspace-lock.js";
7: import type { ThreadEventService } from "./thread-event.js";
8: import type { DevelopmentTraceService } from "./development-trace.js";
9: import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";

…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\validation\workflow-service.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Issue, Run, ThreadEvent, AdapterIdentitySnapshot, ValidationPolicySnapshot, ValidationResultEnvelope } from "@personahub/shared/types";
3: import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, ActorType, ValidationBlockReason, ValidationOutcome, TraceCompletenessStatus } from "@personahub/shared/types";
4: import type { IssueRepository } from "../../repositories/issue.js";
5: import type { RunRepository } from "../../repositories/run.js";
6: import type { AgentConfigRepository } from "../../repositories/agent-config.js";
7: import type { WorkflowTemplateRepository } from "../../repositories
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:01:13Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\issue.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\index.ts"})`


> [reasoning] Now let me read the remaining prerequisite files.

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
<path>D:\Projects\personahub\server\src\repositories\run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, RunStatus, FailureReason, RunRole, RunDispatchSource, AdapterIdentitySnapshot } from "@personahub/shared/types";
3: import { RunRole as RR, RunDispatchSource as RDS } from "@personahub/shared/types";
4: import { generateRunId } from "../id.js";
5: 
6: export interface RunCreateInput {
7:   issue_id: string;
8:   thread_id: string;
9:   workspace_id: string;
10:   adapter_config_id: string;
11:   instructions: string;
12:   status: RunStatus;
13:   role?: RunRole;
14:   dispatch_source?: RunDispatchSource;
15:   validation_round?: number | null;
16:   adapter_identity?: AdapterIdentitySnapshot | null;
17: }
18: 
19: export interf
…[truncated]
  ```
  </details>

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

## assistant · 2026-07-18T18:01:19Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\helpers.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\thread-event.ts"})`
- **tool**: `glob({"pattern": "server/tests/**/validation*.test.ts"})`
- **tool**: `glob({"pattern": "server/tests/**/stale-recovery*.test.ts"})`


> [reasoning] Now let me also read the test helpers and the existing tests to understand patterns, plus the thread-event repository for finding events.

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

  <details><summary>tool output</summary>

  ```text
Found 10 file(s)

D:\Projects\personahub\server\tests\integration\validation-workflow.test.ts
D:\Projects\personahub\server\tests\unit\validation-query.test.ts
D:\Projects\personahub\server\tests\unit\validation-unblock.test.ts
D:\Projects\personahub\server\tests\unit\validation-trace.test.ts
D:\Projects\personahub\server\tests\unit\validation-validator-selector.test.ts
D:\Projects\personahub\server\tests\unit\validation-same-origin-summary.test.ts
D:\Projects\personahub\server\tests\unit\validation-context-builder.test.ts
D:\Projects\personahub\server\tests\unit\validation-policy-gate.test.ts
D:\Projects\personahub\server\tests\unit\validation-result-parser.test.ts
D:\Projects\personahub\server\tests\unit\validation-types.test.ts
[Agent Usage Reminder]

You called a search/fetch tool dire
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 1 file(s)

D:\Projects\personahub\server\tests\integration\stale-recovery.test.ts
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
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:01:25Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\stale-recovery.test.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-workflow.test.ts", "limit": 100})`
- **tool**: `glob({"pattern": "docs/features/0.1/F004-autonomous-validation/tasks.md"})`


> [reasoning] Let me read the stale recovery test to understand the testing pattern, and the tasks.md for F004 to understand what's covered and what T060-T062 expect.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\stale-recovery.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
3: import { IssueStatus, RunStatus, FailureReason, AdapterStatus } from "@personahub/shared/types";
4: 
5: function setupTestRun(services: TestServices, tempDir: string, status: RunStatus = RunStatus.Running) {
6:   const project = services.projectService.create("Test", "desc");
7:   services.workspaceService.bind(project.id, tempDir);
8:   const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
9:   const adapter = services.agentConfigRepo.create({
10:     projec
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\validation-workflow.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
3: import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from "@personahub/shared/types";
4: 
5: function setupFixture(services: TestServices, tempDir: string) {
6:   const project = services.projectService.create("Test");
7:   services.workspaceService.bind(project.id, tempDir);
8:   const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
9:   services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 1 file(s)

D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\tasks.md
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
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, 
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:01:31Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-workflow.test.ts", "offset": 100, "limit": 200})`


> [reasoning] Let me read the tasks.md file to understand T060-T062 expectations, and also more of the validation-workflow test to understand patterns better.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\tasks.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F004]
3: related_features: [F001, F002, F003, F005]
4: topics: [autonomous-validation, workflow, evidence-summary, state-machine, tests, v0.1.3]
5: doc_kind: tasks
6: created: 2026-07-16
7: updated: 2026-07-18
8: ---
9: 
10: # F004：Autonomous Validation - 任务
11: > Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`
12: 
13: ## 规则
14: 
15: - F003必须先实现并通过其Checkpoint 7（terminal finalization/lock/queue/recovery）；不得把F004接到F002当前“terminal即解锁”的旧出口。
16: - 严格按Phase推进，每项先补测试再实现；状态机、事务、race、restart测试通过后才能进入UI。
17: - 只有修改不同文件且无顺序依赖的任务标`[P]`。
18: - 不实现自动修复Run、parallel validation、公开任意validation event写入、Done reopen、trust scoring或Artif
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\validation-workflow.test.ts</path>
<type>file</type>
<content>
100:       const requested = services.threadEventRepo.listByThread(issue.primary_thread!.id).find((e) => e.type === ThreadEventType.ValidationRequested);
101:       expect(requested).toBeDefined();
102:       expect(requested!.payload_json.implementation_run_id).toBe(implRun.id);
103:       expect(requested!.payload_json.validator_run_id).toBe(result!.id);
104:       expect(requested!.payload_json.validation_round).toBe(1);
105:       expect(requested!.payload_json.target).toBe("implementation_result");
106:       expect(requested!.payload_json.policy_snapshot).toBeDefined();
107:       expect(requested!.payload_json.policy_snapshot_hash).toBeDefined();
108:     });
109:    
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:01:37Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-workflow.test.ts", "offset": 300, "limit": 210})`
- **tool**: `glob({"pattern": "server/tests/**/run-dispatch*.test.ts"})`
- **tool**: `grep({"pattern": "startNextQueuedRun|QueuedRun|queue drain", "include": "*.test.ts", "output_mode": "content"})`


> [reasoning] Now let me look at the remaining test patterns and check the existing run-dispatch tests to understand T062 coverage.
Now let me read the remaining validation workflow test, run-dispatch tests, thread event types, and shared types for a complete picture.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\validation-workflow.test.ts</path>
<type>file</type>
<content>
300:     it("writes findings and failed event", () => {
301:       const { issue, validatorRun } = setupRoundLimitFixture();
302:       services.validationWorkflowService.processValidatorResult(validatorRun.id);
303:       const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
304:       const findings = events.filter((e) => e.type === ThreadEventType.ValidationFinding);
305:       expect(findings.length).toBeGreaterThanOrEqual(1);
306:       const failed = events.find((e) => e.type === ThreadEventType.ValidationFailed);
307:       expect(failed).toBeDefined();
308:       expect(failed!.payload_json.next_status).toBe(IssueStatus.Blocked);
309:     })
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
No files found
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
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 5 match(es) in 3 file(s)

D:\Projects\personahub\server\tests\integration\acceptance-checklist.test.ts
  224: services.runService.startNextQueuedRun(issue.workspace_id);

D:\Projects\personahub\server\tests\integration\issue-blocked.test.ts
  53: const result = services.runService.startNextQueuedRun(issue.workspace_id);
  77: it("startNextQueuedRun skips blocked Issue and returns null", () => {
  85: const result = services.runService.startNextQueuedRun(issue.workspace_id);

D:\Projects\personahub\server\tests\integration\terminal-orchestration.test.ts
  104: it("hook errors do not prevent queue drain", async () => {

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better r
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:01:44Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\terminal-orchestration.test.ts", "limit": 100})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\acceptance-checklist.test.ts", "offset": 200, "limit": 60})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run.ts"})`


> [reasoning] Let me look at the terminal orchestration test to understand the existing queue drain test patterns:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\terminal-orchestration.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
3: import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from "@personahub/shared/types";
4: 
5: function setupImplFixture(services: TestServices, tempDir: string) {
6:   const project = services.projectService.create("Test");
7:   services.workspaceService.bind(project.id, tempDir);
8:   const workspace = services.workspaceService.get(project.id)!;
9:   const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
10
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\acceptance-checklist.test.ts</path>
<type>file</type>
<content>
200:       threadId, ThreadEventType.RunQueued, ActorType.System, null, { n: 1 },
201:     );
202:     services.threadEventService.writeAndBroadcast(
203:       threadId, ThreadEventType.RunStarted, ActorType.System, null, { n: 2 },
204:     );
205: 
206:     const afterCursor = services.threadEventService.listByThread(threadId, e1.id);
207:     expect(afterCursor.length).toBeGreaterThanOrEqual(1);
208:     expect(afterCursor[0]!.payload_json.n).toBe(2);
209:   });
210: 
211:   it("AC-011: Blocked Issue queued Runs cancelled with reason", () => {
212:     const { issue, adapter } = setupFullChain(services, tempDir);
213:     const run = services.runRepo.create({
214:       
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, RunStatus, FailureReason, IssueStatus, ThreadEvent, AdapterIdentitySnapshot } from "@personahub/shared/types";
3: import { RunStatus as RS, IssueStatus as IS, FailureReason as FR, ThreadEventType, ActorType, AdapterStatus, RunRole, RunDispatchSource } from "@personahub/shared/types";
4: import { ErrorCode } from "@personahub/shared/errors";
5: import type { RunRepository } from "../repositories/run.js";
6: import type { IssueRepository } from "../repositories/issue.js";
7: import type { WorkspaceRepository } from "../repositories/workspace.js";
8: import type { AgentConfigRepository } from "../repositories/agent-config.js";
9: impor
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:01:51Z

- **tool**: `grep({"pattern": "ThreadEventType", "include": "types*.ts", "output_mode": "content", "head_limit": 50})`
- **tool**: `grep({"pattern": "export.*IssueStatus", "include": "*.ts", "output_mode": "files_with_matches"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\terminal-orchestration.test.ts", "offset": 100})`


> [reasoning] Now I have a clear picture. Let me plan the implementation:

## T060-T062: Plan

### T060: Test file
Create `server/tests/integration/validation-recovery.test.ts` covering:
1. Completed implementation Run + Issue Running + no validation requested -> requestValidation called
2. Terminal validator Run + Issue Validating + no result -> processValidatorResult called
3. Validating Issue with no active/terminal validator -> rebuild validator (or Blocked if config unavailable)
4. Multiple restarts don't cause duplicate events (idempotent)
5. Recovery reads from `validation.requested` event to get fixed implementation_run_id and policy snapshot

### T061: Implementation
Create `server/src/services/validation/recovery-service.ts`:
- `reconcile()` method that handles 3 scenarios:
  1. For each Issue in Validating without active validator:
     - Find latest completed implementation Run
     - If no validation.requested event -> call requestValidation
     - If validation.requested exists but no validator Run -> rebuild or Blocked
  2. For each Issue in Validating with terminal validator Run but no result:
     - Call processValidatorResult
  3. For each completed implementation Run + Issue Running + no validation:
     - Call requestValidation

### T062: Queue drain eligibility
The `startNextQueuedRun` in `run.ts` already has some checks but the design says:
- implementation Run -> only Inbox/Ready/Running allowed; Validating/Done/Blocked -> cancel with reason="issue_state_changed_before_start"
- validator Run -> only Validating allowed, and validation_round must match current round
- Done/Blocked -> don't start new Run
- validator doesn't get cross-Issue FIFO priority

Looking at `run.ts` startNextQueuedRun (lines 291-327):
- It handles Blocked (cancels with "issue_blocked_before_start")
- It doesn't handle: Done, Validating for implementation runs, validator role/round checking
- But `run-dispatch.ts` startNextQueuedRun (lines 267-313) has more checks: Done/Validating + non-validator cancel, but still missing: validator round matching, and blocking with "issue_state_changed_before_start" not "issue_blocked_before_start"

Wait, there are TWO `startNextQueuedRun` methods:
1. In `run.ts` (service) - used by tests directly
2. In `run-dispatch.ts` - has more role-aware checks

The design (6.1.1) says queue drain should check role/status. The `run-dispatch.ts` `startNextQueuedRun` has some checks already.

Let me check what the relationship is between these two. The `run-dispatch.ts` one seems to be used by the dispatch flow, and the `run.ts` one is the public service one used by legacy tests.

Looking more carefully at the run-dispatch.ts startNextQueuedRun (lines 267-313): it checks:
- Blocked -> cancel "issue_blocked_before_start"
- Done -> cancel "issue_state_changed_before_start"  ✓
- Validating && !validator -> cancel "issue_state_changed_before_start" ✓

But it doesn't check:
- Validator run with issue not in Validating
- Validator round matching
- Implementation run vs Validating/Done/Blocked in one place

Wait actually, looking at the design doc §6.1.1:
```
implementation -> Inbox / Ready / Running
validator      -> Validating，且 validation_round 等于当前 round
```

The current `run-dispatch.ts` startNextQueuedRun only handles Blocked, Done, and Validating+n-validator. But it doesn't handle:
1. Implementation queued when issue is Validating/Done/Blocked
   - Done & Blocked: already handled
   - Validating + implementation: already handled
2. Validator queued when issue is NOT Validating -> should cancel
3. Validator round matching

But wait, the `run.ts` startNextQueuedRun has ONLY the Blocked check, which is the simpler one. The richer check is in `run-dispatch.ts`.

The task says "Verify/extend `startNextQueuedRun()` in `run-dispatch.ts`" and "Add test if not already covered."

Let me check what `startNextQueuedRun` is called in `run-dispatch.ts` - it's the private method. The public one in run.ts is separate.

Looking at the task: "T062: Queue drain eligibility (partially done) - Verify/extend `startNextQueuedRun()` in `run-dispatch.ts`"

So I need to:
1. Verify existing checks in `run-dispatch.ts` startNextQueuedRun
2. Add missing checks (validator round matching, validator only when Validating)
3. Add test coverage

Let me focus on what's missing:

In `run-dispatch.ts` startNextQueuedRun:
```ts
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) continue;
      if (issue.status === IS.Blocked) {
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
        continue;
      }
      if (issue.status === IS.Done) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }
      if (issue.status === IS.Validating && run.role !== RunRole.Validator) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }
      // ... acquire lock and start
    }
}
```

Missing checks:
1. Validator run when issue is NOT Validating -> cancel
2. Validator run when validation_round doesn't match current round -> cancel
3. Implementation run in Validating/Done/Blocked -> already covered
4. Done/Blocked -> don't start new Run -> covered

Let me add these missing checks.

Now, let me also think about the `run.ts` `startNextQueuedRun`. This is called from the acceptance test. It should also have similar checks. But the task specifically says "run-dispatch.ts". Let me add to both for consistency, but focus on run-dispatch.ts for the detailed tests.

Actually wait - the `run.ts` `startNextQueuedRun` only checks Blocked. It should also check Done and Validating. But the task says "Verify/extend startNextQueuedRun() in run-dispatch.ts" - so let me focus there.

Let me also look at the existing test for queue drain in acceptance-checklist.test.ts and terminal-orchestration.test.ts.

OK, now let me plan all the files I need to create/modify:

1. **NEW**: `server/src/services/validation/recovery-service.ts` - T061 implementation
2. **NEW**: `server/tests/integration/validation-recovery.test.ts` - T060 test
3. **MODIFY**: `server/src/index.ts` - Register recovery service
4. **MODIFY**: `server/src/services/run-dispatch.ts` - Extend startNextQueuedRun checks (T062)
5. **MODIFY/ADD TEST**: Handle T062 test coverage

Let me now start implementing.

For the recovery service, the design (6.7) says:

1. **Completed implementation + Issue Running + no result**: 
   - Power-request validation
   - This means: find Issues where there's a completed implementation Run, Issue is Running, and no validation has been requested yet
   
2. **Terminal validator + Issue Validating + no result**:
   - Power-process result from requested event's implementation/policy scope
   - finalMessage must have been persisted

3. **Validating but no active/terminal validator**:
   - If requested event exists but creation was interrupted -> rebuild validator
   - If config unavailable -> Blocked

4. **Done but missing summary** -> data inconsistency, log and stop automation

Let me think about how to find these cases:

For case 1: I need to find Issues that are Running, have a completed implementation Run, but have no `validation.requested` event.
- Use `issueRepo.getById` or create a new query
- Actually, I can query for completed implementation runs where the issue is Running
- Then check if there's a validation.requested event for that issue

Wait, looking at the design more carefully:
```
1. 对 finalized completed implementation + Issue Running 且无 result 的记录，幂等 request validation。
```
So it's: completed implementation Run + Issue is Running + no validation has been done.

For case 2: Terminal validator Run + Issue Validating + no result event.
- Find validator Runs that are terminal (completed/failed/cancelled/interrupted)
- Issue is Validating
- No result event (validation.passed/failed/blocked) for that validator

For case 3: Validating Issue with no active validator AND no terminal validator
- Already captured by `listValidatingWithoutActiveValidator()` in issueRepo
- But need to also check if there's a terminal validator

Let me think about the approach:

```typescript
async reconcile(): Promise<void> {
  // Case 1: Completed implementation + Issue Running + no validation
  // Find such issues and call requestValidation
  
  // Case 2: Terminal validator + Issue Validating + no result
  // Find such validators/Issues and call processValidatorResult
  
  // Case 3: Validating + no active/terminal validator
  // Rebuild or block
}
```

Let me look at what queries I need. The current issueRepo has `listValidatingWithoutActiveValidator()` which gives Validating issues without active (queued/running) validators. But they might have terminal validators.

I need a way to find:
- Completed implementation runs where issue is Running and no validation.requested
- Terminal validator runs where issue is Validating and no result event
- Issues that are Validating with neither active nor terminal validators

I'll add queries to the repositories as needed. Let me check what's available.

The `runRepo` has:
- `getLatestCompletedByRole(issueId, role)` - gets the latest completed run by role
- `getActiveValidator(issueId)` - gets active validator (queued/running)

I need:
1. A way to find all Issues with completed implementation runs but no validation
2. A way to find terminal validator runs that haven't been processed

Let me add a query to the run repository:
- `listCompletedImplRunsWithoutValidation()` - find completed implementation runs where the issue is Running and there's no validation.requested event

Actually, this logic might be simpler to do at the service level rather than creating complex queries. Let me think about what's most efficient.

Actually, for recovery, I could:
1. Get all Issues that are Running
2. For each, find the latest completed implementation Run
3. Check if there's a validation.requested event - if not, call requestValidation

For case 2:
1. Get all Issues that are Validating
2. For each, check if there's a terminal validator Run and no result event
3. If so, call processValidatorResult

For case 3:
1. Get all Issues that are Validating without active validator (already have query)
2. For each, check if there's a terminal validator -> if yes, should be handled by case 2
3. If no terminal validator either -> rebuild or block

Let me simplify. I'll create queries that find:

1. `listRunningIssuesWithCompletedImplRun()` - Issues that are Running with at least one completed implementation Run
2. Then for each, check if validation was already requested

Actually let me look at this from a different angle. I can add more targeted queries.

Looking at the RunRepository, I could add:
- `listCompletedByRoleAndIssueStatus(role, status)` 

But actually it's simpler to keep queries in repositories simple and do the processing in the service.

Let me keep it clean:

```typescript
async reconcile(): Promise<void> {
  // Case 3 first: handle Validating issues without any validator
  // (before cases 1&2 which might create/process validators)
  const validatingWithoutActive = this.issueRepo.listValidatingWithoutActiveValidator();
  for (const issue of validatingWithoutActive) {
    const terminalValidator = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Validator);
    if (terminalValidator) {
      // Has terminal validator but no active one -> case 2, will be handled below
      continue;
    }
    // No active AND no terminal validator -> rebuild or Blocked
    const requestedEvent = this.threadEventRepo.listByThreadAndTypes(
      issue.primary_thread_id!, [ThreadEventType.ValidationRequested], undefined, 1
    ).find(e => e.payload_json.issue_id === issue.id);
    
    if (requestedEvent) {
      // Requested event exists but validator creation was interrupted -> rebuild
      // Try to rebuild validator
      // ... use the implementation_run_id from the event
    } else {
      // No requested event -> need to find latest completed implementation and request
      const implRun = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation);
      if (implRun) {
        this.validationWorkflowService.requestValidation(issue.id, implRun.id);
      }
    }
  }
  
  // Case 2: Terminal validator + Issue Validating + no result
  const validatingIssues = this.issueRepo.listByStatus(IssueStatus.Validating); // need this query
  // ... process terminal validators
  
  // Case 1: Completed implementation + Issue Running + no validation
  // ...
}
```

Hmm, I'm making this complex. Let me simplify by adding the queries I need.

Actually, I think the cleanest approach is:

For Case 1 - I need to find "completed implementation runs whose issue is Running and no validation.requested". I'll add a query.

For Case 2 - I need to find "terminal validator runs whose issue is Validating and no result event". I'll add a query.

For Case 3 - Already handled by `listValidatingWithoutActiveValidator()`.

Let me add to RunRepository:
```typescript
listTerminalByRole(issueId: string, role: RunRole): Run[] {
  // Returns terminal (completed/failed/cancelled/interrupted) runs for a role
}
```

And to IssueRepository:
```typescript
listByStatus(status: IssueStatus): Issue[] {
  // Returns all issues with the given status
}
```

Actually, `listByStatus` might already be what I need for "issues that are Running" and "issues that are Validating".

But I don't think there's a `listByStatus` in IssueRepository. Let me check... No, there isn't. Let me add what I minimally need.

OK, let me take a step back and think about the simplest implementation:

For the recovery service:

```typescript
async reconcile(): Promise<void> {
  // 1. Case 3 first to prevent issues from hanging in Validating
  await this.reconcileStuckValidating();
  
  // 2. Process terminal validators without results
  await this.reconcileTerminalValidators();
  
  // 3. Request validation for completed implementations that didn't trigger it
  await this.reconcileUnrequestedImplementations();
}
```

For case 1 (unrequested implementations):
- Find Issues in Running status
- Get latest completed implementation Run for each
- Check if validation was requested by looking for validation.requested event
- If not, call requestValidation

For case 2 (terminal validators without results):
- Find Issues in Validating status
- For each, get terminal validator Runs (not active)
- For each terminal validator, check if a result event exists
- If not, call processValidatorResult

For case 3 (stuck validating):
- Find Issues in Validating without active/terminal validator
- Rebuild validator or Block

Let me add the needed queries to the repositories. I need:
1. `IssueRepository.listByStatus(status)` - to find Running/Validating issues
2. `RunRepository.listCompletedByRole(issueId, role)` - or I can use `getLatestCompletedByRole` for case 1

Actually for case 1, I need to find if there's ANY completed impl run that hasn't triggered validation. The simplest approach: get the latest completed impl run, check if validation was requested.

For case 2, I need to find terminal validator runs for an issue. The RunRepository doesn't have this query. Let me add it.

Let me keep it lean. I'll add minimal queries:

```typescript
// IssueRepository
listByStatus(status: IssueStatus): Issue[] {
  const rows = this.db.prepare("SELECT * FROM issues WHERE status = ? ORDER BY created_at ASC, id ASC").all(status) as IssueRow[];
  return rows.map(mapRow);
}

// RunRepository  
getTerminalValidator(issueId: string): Run | null {
  // Returns the most recent terminal validator run (if any)
  const row = this.db.prepare(
    `SELECT * FROM runs WHERE issue_id = ? AND role = 'validator' AND status IN ('completed', 'failed', 'cancelled', 'interrupted') ORDER BY created_at DESC, id DESC LIMIT 1`
  ).get(issueId) as RunRow | undefined;
  return row ? mapRow(row) : null;
}
```

Wait, but for case 2 I don't want just "most recent" - I want ALL terminal validators that haven't been processed. Actually, in practice there should only be one (the most recent). If it's been processed (has a result event), we skip. If not, process.

Let me finalize my approach:

### Repository additions needed:

**IssueRepository**: No new queries needed (I have `listValidatingWithoutActiveValidator`). But I need `listByStatus`.

Actually wait, let me check if I have `listByStatus`. Looking at IssueRepository... no, I don't have it. Let me add it.

### Queries I need:

1. `IssueRepository.listByStatus(status)` - to get Running and Validating issues
2. For case 1 (Running + completed impl): I'll iterate Running issues and find latest completed impl
3. For case 2 (Validating + terminal validator): I'll iterate Validating issues and find terminal validator
4. For case 3: Already have `listValidatingWithoutActiveValidator()`

Let me write the code now.

### T062: StartNextQueuedRun extension

Looking at `run-dispatch.ts` startNextQueuedRun, it already handles:
- Blocked -> cancel
- Done -> cancel  
- Validating + non-validator -> cancel

Missing:
- Validator run when issue not Validating -> should cancel (e.g., issue moved to Done/Blocked while validator was queued)
- Validator run when validation_round doesn't match current round -> should cancel
- Implementation run should also be checked for Validating/Done/Blocked (partially done, but let me verify)

Actually, let me look at the current code more carefully:

```typescript
if (issue.status === IS.Blocked) {
  this.runService.cancelQueued(run.id, "issue_blocked_before_start");
  continue;
}
if (issue.status === IS.Done) {
  this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
  continue;
}
if (issue.status === IS.Validating && run.role !== RunRole.Validator) {
  this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
  continue;
}
```

So:
- Blocked: any run -> cancelled ✓
- Done: any run -> cancelled ✓  
- Validating + impl/consult: cancelled ✓
- Validating + validator: allowed to proceed (but no round check!)
- Running + any: allowed to proceed (no round check for validator!)

Missing:
- Validator run in Running issue -> should NOT start unless issue also has requested event for that round
  Actually wait, validator should only be started when issue is Validating. If issue is Running, it means validation hasn't been requested yet, so a validator should not start. Actually, it depends - a validator could be queued from a previous restore but the issue moved back to Running.
  
Let me think about this properly based on the design:

```
implementation -> Inbox / Ready / Running
validator      -> Validating，且 validation_round 等于当前 round
```

So:
- If the run is a validator:
  - Issue must be Validating
  - validation_round must match current round (issue.validation_round_count + 1... or is it just the current round?)
  
  Actually, looking at how validation rounds work: when requestValidation happens, it sets `round = issue.validation_round_count + 1`. The validator gets `validation_round = round`. The issue is now Validating.
  
  So when checking queue eligibility for a validator:
  - Issue must be Validating
  - `run.validation_round` must equal `issue.validation_round_count + 1` (the expected next round)

- If the run is implementation:
  - Issue must be Inbox/Ready/Running (not Validating/Done/Blocked)

Let me also check if the same checks should apply to `run.ts` startNextQueuedRun.

I'll extend `run-dispatch.ts` startNextQueuedRun with:
1. Validator-specific checks: issue must be Validating, round must match
2. Additional safety: implementation run in Validating/Done/Blocked (already done for most cases)

Now let me think about the test for T062. I should add tests to the existing terminal-orchestration test or create a new test.

Actually, looking at the existing tests and the task description, let me check if there's already a test that covers queue drain with validator checking. The terminal-orchestration.test.ts has 110 lines and covers basic scenarios. Let me add T062 tests to it or to a new test file.

OK let me now plan the implementation order:
1. Add `listByStatus` to IssueRepository 
2. Create `server/src/services/validation/recovery-service.ts`
3. Create `server/tests/integration/validation-recovery.test.ts`
4. Extend `run-dispatch.ts` startNextQueuedRun
5. Add T062 tests
6. Register in index.ts

Let me also check what ThreadEventType values exist for validation:
Let me check the thread event types and shared types for the full picture.

  <details><summary>tool output</summary>

  ```text
No matches found
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
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context wind
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 2 match(es) in 2 file(s)

D:\Projects\personahub\shared\src\types\index.ts

D:\Projects\personahub\shared\src\index.ts

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
- Agents can perform deeper, more thorough searches
- Ba
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\terminal-orchestration.test.ts</path>
<type>file</type>
<content>
100:       expect(blocked).toBeDefined();
101:       expect(blocked!.payload_json.reason_code).toBe("validator_run_failed");
102:     });
103: 
104:     it("hook errors do not prevent queue drain", async () => {
105:       const { workspace } = setupImplFixture(services, tempDir);
106:       // A non-existent run should not throw — hook catches and drain continues
107:       await expect(services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id)).resolves.toBeUndefined();
108:     });
109:   });
110: });

(End of file - total 110 lines)
</content>
  ```
  </details>

## assistant · 2026-07-18T18:02:42Z

- **tool**: `grep({"pattern": "Validation|validation", "include": "shared/src/types/*.ts", "output_mode": "content"})`
- **tool**: `grep({"pattern": "IssueStatus", "include": "shared/src/types/*.ts", "output_mode": "content"})`


> [reasoning] Let me look at the shared types to see available ThreadEventType values related to validation.

  <details><summary>tool output</summary>

  ```text
Found 45 match(es) in 3 file(s)

D:\Projects\personahub\shared\src\types\validation.ts
  1: import type { ValidationFindingSeverity, VerificationKind } from "./trace.js";
  19: export enum ValidationOutcome {
  25: export enum ValidationBlockReason {
  36: export interface ValidationFinding {
  37: severity: ValidationFindingSeverity;
  45: export interface ValidationResultEnvelope {
  47: outcome: ValidationOutcome;
  49: findings: ValidationFinding[];
  63: export interface ValidationEvidenceRequirements {
  70: export interface ValidationPolicySnapshot {
  73: max_validation_rounds: number;
  74: evidence_requirements: ValidationEvidenceRequirements;
  83: validation_result: ValidationOutcome;
  86: same_origin_validation: boolean;
  91: policy_snapshot: ValidationPolicySnapshot;
  96: 
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 2 file(s)

D:\Projects\personahub\shared\src\types\validation.ts
  2: import type { IssueStatus, RunSummary, Issue } from "./index.js";
  120: status: IssueStatus;

D:\Projects\personahub\shared\src\types\index.ts
  36: status: IssueStatus;
  100: export enum IssueStatus {

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup documentation for Z")
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:02:48Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 95, "limit": 80})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "offset": 130, "limit": 80})`


> [reasoning] Let me read the IssueStatus enum and ThreadEventType from index.ts:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
95:   version: number;
96:   created_at: string;
97:   updated_at: string;
98: }
99: 
100: export enum IssueStatus {
101:   Inbox = "Inbox",
102:   Ready = "Ready",
103:   Running = "Running",
104:   Validating = "Validating",
105:   Done = "Done",
106:   Blocked = "Blocked",
107: }
108: 
109: export enum IssueType {
110:   Coding = "coding",
111: }
112: 
113: export enum IssuePriority {
114:   Low = "low",
115:   Normal = "normal",
116:   High = "high",
117: }
118: 
119: export enum ThreadType {
120:   Primary = "primary",
121:   Room = "room",
122:   Incident = "incident",
123:   Council = "council",
124: }
125: 
126: export enum ThreadEventType {
127:   IssueCreated = "issue.created",
128:   RunQue
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
130:   RunOutput = "run.output",
131:   RunOutputTruncated = "run.output_truncated",
132:   RunCompleted = "run.completed",
133:   RunFailed = "run.failed",
134:   RunCancelled = "run.cancelled",
135:   RunInterrupted = "run.interrupted",
136:   EscalationTriggered = "escalation.triggered",
137:   IssueBlocked = "issue.blocked",
138:   CommandStarted = "command.started",
139:   CommandCompleted = "command.completed",
140:   TestCompleted = "test.completed",
141:   FileChangeSummary = "file.change_summary",
142:   FileChangeScanFailed = "file.change_scan_failed",
143:   HandoffCreated = "handoff.created",
144:   ValidationRequested = "validation.requested",
145:   ValidationFinding = "validation.findin
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:02:54Z

- **tool**: `todowrite({"todos": [{"priority": "high", "content": "Read all prerequisite files (design doc, existing services, repos, tests)", "status": "completed"}, {"priority": "high", "content": "T060: Write integration test for ValidationRecoveryService", "status": "in_progress"}, {"priority": "high", "content": "T061: Implement ValidationRecoveryService", "status": "pending"}, {"priority": "high", "content": "Register recoveryService.reconcile() in server/src/index.ts", "status": "pending"}, {"priority": "high",
…[truncated])`


> [reasoning] Now I have a clear picture. Let me start implementing. Here's my plan:

## Implementation Plan

### 1. Add `listByStatus` to IssueRepository
Need this for finding Running/Validating issues during recovery.

### 2. Create `ValidationRecoveryService` 
The service that reconciles state during startup.

### 3. Create integration test
Test the recovery service scenarios.

### 4. Extend `run-dispatch.ts` startNextQueuedRun
Add validator role/round checks.

### 5. Add T062 tests
Test queue drain eligibility.

### 6. Register in index.ts

Let me write all the code. I'll start with the tests first (TDD approach).

Actually wait, let me also check if there are existing tests for `run-dispatch.ts` startNextQueuedRun I need to update or look at.

I notice `startNextQueuedRun` exists in BOTH:
- `run-dispatch.ts` (private method, used internally by the dispatch flow)
- `run.ts` (public method, used by tests and possibly external callers)

The T062 task says to extend `run-dispatch.ts`. Let me check what tests exist for the dispatch flow's queue drain.

Looking at terminal-orchestration.test.ts, it tests `finalizeAndDrain` which calls `startNextQueuedRun` internally. But there's no direct test of the eligibility checks in the dispatch context.

For T062 tests, I should test:
1. Implementation queued + issue Validating -> cancelled with reason
2. Implementation queued + issue Done -> cancelled with reason  
3. Implementation queued + issue Blocked -> cancelled with reason (existing test)
4. Validator queued + issue NOT Validating -> cancelled with reason
5. Validator queued + wrong round -> cancelled with reason
6. Validator queued + issue Validating + correct round -> starts

I'll add these tests to a new test file or extend terminal-orchestration.test.ts.

Actually, let me think about where to put the T062 tests. The existing terminal-orchestration.test.ts tests integration via `finalizeAndDrain`. But T062 is specifically about the `startNextQueuedRun` queue drain eligibility checks.

The `startNextQueuedRun` in `run-dispatch.ts` is private and not directly testable from tests. But `finalizeAndDrain` calls it internally. So I can test the eligibility via `finalizeAndDrain`.

Actually, I can also test directly via the public `startNextQueuedRun` in `run.ts` service - but it doesn't have the validator-specific checks.

Hmm, let me reconsider. I have two options:

1. Add the eligibility checks to `run.ts`'s `startNextQueuedRun` as well
2. Only add to `run-dispatch.ts` 

The task says "Verify/extend `startNextQueuedRun()` in `run-dispatch.ts`". The `run-dispatch.ts` version is private and called from `finalizeAndDrain`. So I'll need to test via `finalizeAndDrain`.

But for testing, it's hard to set up queued runs and call finalizeAndDrain (it expects a run that was just finalized). Let me check if there's another way.

Actually, looking at `run-dispatch.ts`, the `startNextQueuedRun` is a private method called from `finalizeAndDrain`. To test it, I would need to either:
1. Make it public/protected for testing
2. Test via `finalizeAndDrain`
3. Test the `run.ts` version instead

Given the constraints, I think the cleanest approach is to make the `run-dispatch.ts` `startNextQueuedRun` changes and test them via integration with `finalizeAndDrain`. Or I can test by calling it through the public interface.

Actually, looking more carefully, both `run.ts` and `run-dispatch.ts` have `startNextQueuedRun` methods that do similar things. The `run-dispatch.ts` one wraps the `run.ts` version plus adds additional checks for role/status.

Wait, let me re-read run-dispatch.ts startNextQueuedRun...

```typescript
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) continue;
      if (issue.status === IS.Blocked) {
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
        continue;
      }
      if (issue.status === IS.Done) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }
      if (issue.status === IS.Validating && run.role !== RunRole.Validator) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }

      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      if (!lockAcquired) return;
      // ... start
    }
}
```

It uses `this.runService.listQueuedByWorkspace` which goes to `runRepository.listQueuedByWorkspace`.

And the `run.ts` version:
```typescript
startNextQueuedRun(workspaceId: string): Run | null {
    const queuedRuns = this.runRepo.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) continue;
      if (issue.status === IS.Blocked) {
        // cancel with "issue_blocked_before_start"
        continue;
      }
      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      // ... start
    }
}
```

So the `run-dispatch.ts` version is richer. The design (6.1.1) expectations for queue drain:
- implementation -> Inbox/Ready/Running
- validator -> Validating, round must match current round
- Done/Blocked -> don't start

The `run-dispatch.ts` has some of this but missing:
1. Validator-specific status check (validator only when Validating)
2. Validator round matching
3. Implementation run in Validating/Done/Blocked (Done covered, Validating covered for non-validator, Blocked covered)

But also for Done/Blocked, it already covers all roles. 

For the `run.ts` version, it only checks Blocked. It doesn't check Done or Validating at all. Should I update it too?

The task says "run-dispatch.ts" specifically, so I'll focus there. But for consistency, I might want to add similar checks to `run.ts` too. Actually no, let me stick to what the task says.

OK, now let me plan my edits:

### run-dispatch.ts startNextQueuedRun - Additions:

After existing checks, add:
```typescript
// Validator-specific checks
if (run.role === RunRole.Validator) {
  if (issue.status !== IssueStatus.Validating) {
    this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
    continue;
  }
  const expectedRound = issue.validation_round_count + 1;
  if (run.validation_round !== expectedRound) {
    this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
    continue;
  }
}
```

So the full flow would be:
1. Blocked -> cancel all
2. Done -> cancel all
3. Validating + non-validator -> cancel non-validator
4. Validator + not Validating -> cancel validator
5. Validator + wrong round -> cancel validator
6. Everything else -> try to start

Now I need to also think about whether `run-dispatch.ts` has import for IS (IssueStatus). Looking at line 3:
```typescript
import { IssueStatus as IS, RunStatus as RS, RunRole, ThreadEventType, ActorType, CommandTraceCapability, ValidationBlockReason } from "@personahub/shared/types";
```

Yes, it has `IssueStatus as IS`.

Good. Now let me write all the code.

Let me also think about the test for T062. I'll add it to `terminal-orchestration.test.ts` as a new describe block for queue drain eligibility.

Actually, I need to think about how to set up queued runs for testing. The key is that `finalizeAndDrain` calls `startNextQueuedRun` after processing a run. So if I:
1. Set up an issue with queued runs
2. Call `finalizeAndDrain` on some other completed run (same workspace)
3. The queued runs should be processed

But `finalizeAndDrain` expects a `runId` and `workspaceId` for the run being finalized. It does trace finalization, lock release, workflow hook, then queue drain.

For testing queue drain directly, I could:
1. Create a queued run
2. Create a separate completed run
3. Call finalizeAndDrain on the completed run
4. Check if the queued run was started or cancelled

Actually, I can simply call `finalizeAndDrain` with a non-existent run or set up a simpler flow. Let me look at how the existing test at line 104 does it:
```typescript
it("hook errors do not prevent queue drain", async () => {
    const { workspace } = setupImplFixture(services, tempDir);
    await expect(services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id)).resolves.toBeUndefined();
});
```

So `finalizeAndDrain` even with a non-existent run still does queue drain (in the finally block, it tries to finalize, then unlock, then workflow hook, then drain). The workflow hook would fail for a non-existent run, but drain still happens.

But I need queued runs on the same workspace. The `setupImplFixture` creates:
- A project with workspace
- An issue (Running)
- An implementation adapter
- A validator adapter
- A completed implementation run with handoff, file changes, tests

The workspace ID is `workspace.id`.

To test queue drain:
1. Create queued runs on the same workspace with different issues
2. Call finalizeAndDrain with a non-existent run
3. Check what happened to queued runs

Let me write the tests.

Wait, actually I need to create queued runs on the SAME workspace but possibly different issues. Each issue may have a different status.

Let me plan the test setup:

```typescript
// Setup basic fixture (project, workspace, adapters, initial issue)
// For each test scenario, create the appropriate queued run and set up issue state
// Then call finalizeAndDrain to trigger queue drain
```

OK let me now write the code. I'll start with all the implementation changes and tests.

Let me think about the recovery service test more carefully.

For the recovery test, I need to simulate the scenarios that happen after a server restart:

**Scenario 1: Completed implementation Run + Issue Running + no validation requested**
- Setup: Create completed implementation Run, set Issue to Running, no validation.requested event
- Expected: `reconcile()` calls `requestValidation`, creates validator Run, Issue -> Validating

**Scenario 2: Terminal validator Run + Issue Validating + no result**
- Setup: Create validator Run that's completed with final_message, Issue is Validating, no result event
- Expected: `reconcile()` calls `processValidatorResult`, processes the result

**Scenario 3: Validating Issue with no active/terminal validator**
- Setup: Create Issue in Validating, no validator Run at all
- Option A: validation.requested event exists -> rebuild validator
- Option B: no validation.requested event -> find latest impl and request

**Scenario 4: Multiple restarts idempotent**
- Just run reconcile() twice and check no duplicate events

**Scenario 5: Recovery reads from validation.requested event**
- Verify that processValidatorResult uses implementation_run_id and policy_snapshot from the event

Let me now write the test. I'll use the same patterns as `validation-workflow.test.ts`.

For the recovery service test, I need access to the recovery service. But the recovery service is not in `createTestServices()`. I need to either:
1. Create it in the test
2. Add it to the test helpers

I'll create it directly in the test since it only depends on repos and services that are already in `TestServices`.

But wait, `ValidationRecoveryService` depends on `ThreadEventRepository` which is available. Let me check the constructor:

```typescript
constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private threadEventRepo: ThreadEventRepository,
) {}
```

All available in `TestServices`. Good.

Now let me actually write all the code files. I'll keep each file under 350 lines.

Let me plan the structure:

1. **`server/tests/integration/validation-recovery.test.ts`** - T060 tests
2. **`server/src/services/validation/recovery-service.ts`** - T061 implementation
3. **`server/src/services/run-dispatch.ts`** - T062 eligibility checks
4. **`server/tests/integration/queue-drain-eligibility.test.ts`** - T062 tests (or add to terminal-orchestration)
5. **`server/src/index.ts`** - Register recovery service
6. **`server/src/repositories/issue.ts`** - Add `listByStatus` query

Let me start coding now. I'll do multiple file writes/edits in parallel for independent files.
Now I have a complete picture of the codebase. Let me start implementing. I'll proceed with TDD.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all prerequisite files (design doc, existing services, repos, tests)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T060: Write integration test for ValidationRecoveryService",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T061: Implement ValidationRecoveryService",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Register recoveryService.reconcile() in server/src/index.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T062: Verify/extend startNextQueuedRun eligibility checks + tests",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Run typecheck and all tests - must pass",
    "status": "pending",
    "priority": "high"
  }
]
  ```
  </details>

## assistant · 2026-07-18T18:03:28Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\issue.ts", "oldString": "  listValidatingWithoutActiveValidator(): Issue[] {\n    const rows = this.db.prepare(\n      `SELECT i.* FROM issues i\n       WHERE i.status = 'Validating'\n         AND NOT EXISTS (\n           SELECT 1 FROM runs r\n           WHERE r.issue_id = i.id\n             AND r.role = 'validator'\n             AND r.status IN ('queued', 'running')\n         )\n       ORDER BY i.created_at ASC, i.id ASC`,\n    
…[truncated])`


> [reasoning] Let me start with adding `listByStatus` to IssueRepository (needed for recovery), then write the test, then implement the service.

Let me do them in parallel where possible.
First, let me add `listByStatus` to IssueRepository (needed for recovery), then write the test file.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:03:37Z

- **tool**: `write({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "content": "import { describe, it, expect, beforeEach, afterEach } from \"vitest\";\nimport { createTestServices, createTempDir, disposeTestServices, type TestServices } from \"../helpers.js\";\nimport { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from \"@personahub/shared/types\";\nimport { ValidationRecoveryService } from \"../../src/services/val
…[truncated])`


> [reasoning] Good. Now let me write the test file for T060, the recovery service implementation for T061, and the T062 tests and code changes.

Let me write the recovery service test file first (TDD).
Now let me write the integration test for T060:

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.

🚨 AGENT MEMO COMMENT DETECTED - CODE SMELL ALERT 🚨

⚠️  AGENT MEMO COMMENTS DETECTED - THIS IS A CODE SMELL  ⚠️

You left "memo-style" comments that describe WHAT you changed or HOW you implemented something.
These are typically signs of an AI agent leaving notes for itself or the user.

Examples of agent memo patterns detected:
  - "Changed from X to Y", "Modified to...", "Updated from..."
  - "Added new...", "Removed...", "Refactored..."
  - "This implements...", "Here we...", "Now this..."
  - "Note:", "Implementation of..."
  - Korean: "여기서 변경됨", "구현함", "추가함", "수정됨"

WHY THIS IS BAD:
  1. Code should be self-documenting - if you need to explain what changed, the code isn't clear enough
  2. These comments become outdated instantly and mislead future readers
  
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:04:09Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"rebuilds validator when requested event exists but creation incomplete\", async () => {\n      const { issue, implRun } = setupFixture(services, tempDir);\n      // Transition issue to Validating manually without creating validator\n      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);\n      const valAdapter = services.agentConfi
…[truncated])`


> [reasoning] I need to fix the memo-style comments in the test file. These are unnecessary comments that describe what the code is doing. The code should be self-documenting. Let me remove them.
Need to remove the unnecessary memo-style comments from the test file:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:04:20Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"blocks issue when no validator config available\", async () => {\n      const { issue, implRun } = setupFixture(services, tempDir);\n      // Remove all validator configs\n      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator);\n      for (const v of validators) {\n        services.db.prepare(\"DELETE FROM agent_con
…[truncated])`


> [reasoning] Good, let me remove more memo comments.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:04:28Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"requests validation when no requested event and latest impl completed run exists\", async () => {\n      const { issue, implRun } = setupFixture(services, tempDir);\n      // Issue is Validating but no active validator, no requested event, but impl exists\n      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);\n\n      const recove
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:04:37Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"blocks issue when no requested event and no completed impl run\", async () => {\n      const { issue } = setupFixture(services, tempDir);\n      // Issue is Validating but no completed impl run, no requested event\n      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);", "newString": "    it(\"blocks issue when no requested event a
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:04:44Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);\n      const passCount = services.threadEventRepo.listByThread(issue.primary_thread!.id)\n        .filter((e) => e.type === ThreadEventType.ValidationPassed).length;\n\n      // Reconcile again\n      await recovery.reconcile();", "newString": "      expect(services.issueRepo.getById(issue.id)!.status).t
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:04:52Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "offset": 138, "limit": 5})`


> [reasoning] Good. Now let me check if the `valAdapter` variable on line 142 is still used (it was in the line I didn't remove, but the variable is assigned and not used). Let me check the actual file.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\validation-recovery.test.ts</path>
<type>file</type>
<content>
138:   describe("T060-3: Validating with no active/terminal validator", () => {
139:     it("rebuilds validator when requested event exists but creation incomplete", async () => {
140:       const { issue, implRun } = setupFixture(services, tempDir);
141:       services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
142:       const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];

(Showing lines 138-142 of 245. Use offset=143 to continue.)
</content>
  ```
  </details>

## assistant · 2026-07-18T18:04:58Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "      const { issue, implRun } = setupFixture(services, tempDir);\n      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);\n      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];\n      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationReque
…[truncated])`


> [reasoning] The `valAdapter` variable on line 142 is unused. Let me remove it.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:05:07Z

- **tool**: `todowrite({"todos": [{"priority": "high", "content": "Read all prerequisite files (design doc, existing services, repos, tests)", "status": "completed"}, {"priority": "high", "content": "T060: Write integration test for ValidationRecoveryService", "status": "completed"}, {"priority": "high", "content": "T061: Implement ValidationRecoveryService", "status": "in_progress"}, {"priority": "high", "content": "Register recoveryService.reconcile() in server/src/index.ts", "status": "pending"}, {"priority": "high
…[truncated])`


> [reasoning] Good. Now let me implement the recovery service for T061.
Now let me implement the recovery service for T061:

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all prerequisite files (design doc, existing services, repos, tests)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T060: Write integration test for ValidationRecoveryService",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T061: Implement ValidationRecoveryService",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Register recoveryService.reconcile() in server/src/index.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T062: Verify/extend startNextQueuedRun eligibility checks + tests",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Run typecheck and all tests - must pass",
    "status": "pending",
    "priority": "high"
  }

…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:05:13Z

- **tool**: `write({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\validation\\recovery-service.ts", "content": "import type { IssueRepository } from \"../../repositories/issue.js\";\nimport type { RunRepository } from \"../../repositories/run.js\";\nimport type { ThreadEventRepository } from \"../../repositories/thread-event.js\";\nimport type { AgentConfigRepository } from \"../../repositories/agent-config.js\";\nimport type { ValidationWorkflowService } from \"./workflow-service.js\";\nimport typ
…[truncated])`


> [reasoning] Let me check what imports are available in the recovery service. I need to understand what the `isTerminalRunStatus` function looks like, what `RunRole` exports are, and what `ThreadEventType` enum values are available.

Looking at the design doc for recovery (6.7):

1. **Completed implementation + Issue Running + no validation**: For each finalized completed implementation run whose issue is Running and no result, idempotently request validation.
   - Find Running issues
   - For each, get latest completed implementation Run
   - Check if there's a validation.requested event
   - If not, call requestValidation

2. **Terminal validator + Issue Validating + no result**: For each terminal validator run whose issue is Validating and no result, idempotently process result.
   - Find Validating issues  
   - For each, get the most recent terminal validator Run (completed/failed/cancelled/interrupted)
   - Check if there's a result event for that validator
   - If not, call processValidatorResult

3. **Validating + no active/terminal validator**: 
   - Find Validating issues without active validator (already have query)
   - If no terminal validator either:
     - If validation.requested event exists -> try to rebuild
     - If not -> find latest completed impl and request, or Block if unavailable

Let me also think about how to query for terminal validator runs. I need to check the `Run` type for terminal statuses - they are: `Completed`, `Failed`, `Cancelled`, `Interrupted`.

For RunRepository, I can add a method to get terminal validator runs. But I want to keep it minimal. Let me use the existing `getLatestCompletedByRole` for completed, and add a new query for all terminal (including failed/cancelled/interrupted).

Actually, let me simplify. For case 2, I can:
1. Get all Issues that are Validating  
2. For each, check if there's a non-active (terminal) validator
3. If yes, check if there's a result event
4. If not, call processValidatorResult

For getting the terminal validator, I'll add a method to RunRepository.

Let me also check: the `processValidatorResult` method handles completed (parses result), failed/cancelled/interrupted (blockIssue), and non-terminal (returns early). So for recovery, I can call it directly - it already handles all terminal states.

Wait, actually looking at `processValidatorResult`:
```typescript
processValidatorResult(validatorRunId: string): void {
    const validatorRun = this.runRepo.getById(validatorRunId);
    if (!validatorRun || validatorRun.role !== RunRole.Validator) return;
    if (validatorRun.status === RunStatus.Failed || ... || Interrupted) {
      this.blockIssue(...)
      return;
    }
    if (validatorRun.status !== RunStatus.Completed) return;
    const issue = ...
    if (!issue || issue.status !== IssueStatus.Validating) return;
    // parse result...
```

So it already handles:
- completed: parse result and process
- failed/cancelled/interrupted: blockIssue
- Other statuses: return early

But the issue status check is `if (!issue || issue.status !== IssueStatus.Validating) return;` - so if the issue is not Validating, it won't process even if there's a terminal validator with no result. In recovery, the issue might still be Validating (the expected case) or it might have moved on.

For recovery, I should only call `processValidatorResult` if the issue is still Validating. If the issue has moved to another state, the validator result shouldn't be processed (it's already stale).

Let me now write the service.

For finding terminal validator runs, I need to query the runs table. Let me add a helper method to RunRepository or just do the query in the service.

Actually, looking at what I already have in RunRepository:
- `getLatestCompletedByRole(issueId, role)` - only completed status
- `getActiveValidator(issueId)` - only queued/running

I need something like:
```typescript
getLatestTerminalByRole(issueId: string, role: RunRole): Run | null {
  // Returns most recent terminal (completed/failed/cancelled/interrupted) run
}
```

Let me add this to RunRepository.

Wait, actually I don't even need that. I can get all runs for an issue and filter them. But that's inefficient. Let me add a simple query.

Actually, let me reconsider. For case 2, I just need to find "terminal validator runs where issue is Validating and no result event". I can:

1. Get all Issues that are Validating (using listByStatus)
2. For each, find the latest terminal validator Run
3. Check if a result event exists

For getting the latest terminal validator, I need a query. Let me add one.

Or... I could check all runs by issue that are terminal and role=validator. Let me just use a direct query.

Actually, let me keep it simple and add a `getLatestTerminalByRole` method to RunRepository. But I also need it to handle all terminal statuses, not just completed.

Let me write the code now.

For the recovery service, I'll need:
1. `listByStatus` (already added to IssueRepository)
2. A way to get the latest terminal validator run for an issue
3. A way to check if a result event exists for a validator run (reuse `resultEventExistsForValidatorRun` from ValidationWorkflowService... but that's private)

Actually, `resultEventExistsForValidatorRun` is a private method. I can either:
a. Make it public
b. Duplicate the check in the recovery service
c. Add a helper to the thread event repo

Let me make `resultEventExistsForValidatorRun` public in the workflow service, or add a method to check.

Actually, the simplest approach: in the recovery service, I'll check if the issue is still Validating and then just call processValidatorResult. The processValidatorResult method already handles all the guards (role check, status check, duplicate result check, etc.). So I can safely call it for any terminal validator run and it will be idempotent.

Let me write the service:

```typescript
async reconcile(): Promise<void> {
  // Case 1: Completed implementation + Issue Running + no validation
  const runningIssues = this.issueRepo.listByStatus(IssueStatus.Running);
  for (const issue of runningIssues) {
    const implRun = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation);
    if (!implRun) continue;
    // Check if validation was already requested
    const hasValidationRequested = this.hasValidationRequestedEvent(issue, implRun.id);
    if (!hasValidationRequested) {
      this.validationWorkflowService.requestValidation(issue.id, implRun.id);
    }
  }
  
  // Case 2: Terminal validator + Issue Validating + no result
  const validatingIssues = this.issueRepo.listByStatus(IssueStatus.Validating);
  for (const issue of validatingIssues) {
    const terminalValidator = this.findLatestTerminalValidator(issue.id);
    if (!terminalValidator) continue; // handled by case 3
    
    // Call processValidatorResult - it handles all guards and idempotency
    this.validationWorkflowService.processValidatorResult(terminalValidator.id);
  }
  
  // Case 3: Validating + no active/terminal validator
  const stuckIssues = this.issueRepo.listValidatingWithoutActiveValidator();
  for (const issue of stuckIssues) {
    const terminalValidator = this.findLatestTerminalValidator(issue.id);
    if (terminalValidator) {
      // Should have been handled by case 2 above, but just in case
      this.validationWorkflowService.processValidatorResult(terminalValidator.id);
      continue;
    }
    // No active AND no terminal validator
    const requestedEvent = this.findValidationRequestedEvent(issue);
    if (requestedEvent) {
      // Validator creation was interrupted - try to rebuild
      this.rebuildValidator(issue, requestedEvent);
    } else {
      // No requested event either - try to find latest impl and request
      const implRun = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation);
      if (implRun) {
        this.validationWorkflowService.requestValidation(issue.id, implRun.id);
      } else {
        // No impl run either - block the issue
        this.validationWorkflowService.blockValidation(issue.id, "", ValidationBlockReason.RecoveryInconsistent);
      }
    }
  }
}
```

Hmm, but `blockValidation` in the workflow service expects a `validatorRunId`. Let me check the signature:
```typescript
blockValidation(issueId: string, validatorRunId: string, reason: ValidationBlockReason): void
```

And `blockIssue` is private:
```typescript
private blockIssue(issueId: string, reason: ValidationBlockReason, message: string): void
```

So I can't call `blockIssue` directly. But `blockValidation` requires a `validatorRunId`. For case 3 where there's no validator run at all, I can't use `blockValidation`.

I have a few options:
1. Make `blockIssue` public
2. Add a public method like `blockIssueWithoutValidatorRun`
3. Use the repo directly to transition the issue and write events

Let me check if there's already a public method I can use... The `blockValidation` method needs a run ID. Let me make `blockIssue` accessible or create a new public method.

Actually, looking more carefully at the ValidationWorkflowService, I could use the `blockValidation` method with an empty string for the run ID (since there's no actual validator run). But that might cause issues.

Let me just make `blockIssue` public or add a new method like `blockIssueWithoutValidator`. Actually, looking at the design for recovery:

```
Validating但无 active/terminal validator时：若 requested event存在且创建中断，重建一次；配置不可用则 Blocked。
```

So in case 3, if config is unavailable, it should be Blocked. I can call `requestValidation` in the rebuild case - if it fails due to missing config, it will Block the issue internally. And if no impl run exists, I need a different approach.

Let me just extend the workflow service with a `blockIssueWithoutValidator` public method, or make `blockIssue` accessible.

Actually, the simplest: I can just use `requestValidation` for the rebuild case (it handles Blocked internally). And for the "no impl run" case, I can use the issueRepo directly to transition the issue and write events.

Wait, let me think about this differently. For case 3:
- If requested event exists: the implementation_run_id is known from the event. Try to call requestValidation. If it fails due to config/validator issues, it will return null and Block the issue.
- If no requested event and no impl run: this is a data inconsistency. Block the issue.

For the Block case, I can use `compareAndSetStatus` on the issue repo directly plus write a validation.blocked event. But that's low-level.

Actually, let me look at what `blockValidation` does:

```typescript
blockValidation(issueId: string, validatorRunId: string, reason: ValidationBlockReason): void {
    this.blockIssue(issueId, reason, `Validator run ${validatorRunId} blocked: ${reason}`);
}
```

And `blockIssue`:
```typescript
private blockIssue(issueId: string, reason: ValidationBlockReason, message: string): void {
    const pendingEvents: ThreadEvent[] = [];
    this.db.transaction(() => {
      const issue = this.issueRepo.getById(issueId);
      if (!issue) return;
      if (issue.status !== IssueStatus.Running && issue.status !== IssueStatus.Validating) return;
      this.blockIssueInTx(issue, reason, message, pendingEvents);
    })();
    for (const event of pendingEvents) this.threadEventService.broadcast(event);
}
```

It only blocks if issue is Running or Validating. In case 3, the issue is Validating, so it would work. But I'd need to pass a validatorRunId. Let me just use the recovery_inconsistent reason with an empty message and no validator run.

Actually, for recovery, the cleanest approach: make `blockIssue` public or create a public variant. Let me modify `ValidationWorkflowService` to have a `blockIssue` public method.

Wait, I notice `blockIssue` uses `ValidationBlockReason` and writes `ValidationBlocked` event. The issue must be Running or Validating. For case 3, the issue is Validating, so it would work.

Let me just make it available. I'll add a public method.

Actually, let me reconsider. For the recovery service, I can handle the "no impl run" case differently. Let me use `requestValidation` which already handles all the Blocked cases. If there's no impl run, I can't request validation. So I'll block directly.

Let me make the `blockIssue` method public in workflow-service.ts. Or better, add a specific method for blocking without a validator run ID.

Actually, looking at the test I wrote for "blocks issue when no requested event and no completed impl run", I expect it to transition to Blocked with a reason. Let me use `requestValidation` for the rebuild case (it handles Blocked), and for the "no impl" case I'll block directly using issueRepo.

Let me create the recovery service now with a direct approach that uses the available APIs.

For blocking without a validator run: I'll use `issueRepo.compareAndSetStatus` and `threadEventService.write` directly in the recovery service.

Here's my refined approach:

```typescript
async reconcile(): Promise<void> {
  // Case 1: Running issues with completed impl runs but no validation requested
  const runningIssues = this.issueRepo.listByStatus(IssueStatus.Running).filter(i => i.primary_thread_id);
  for (const issue of runningIssues) {
    const implRun = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation);
    if (!implRun) continue;
    if (this.hasValidationBeenRequested(issue, implRun.id)) continue;
    this.validationWorkflowService.requestValidation(issue.id, implRun.id);
  }

  // Case 2: Validating issues with terminal validator that hasn't been processed
  const validatingIssues = this.issueRepo.listByStatus(IssueStatus.Validating).filter(i => i.primary_thread_id);
  for (const issue of validatingIssues) {
    const terminalValidator = this.findLatestTerminalValidator(issue.id);
    if (!terminalValidator) continue;
    this.validationWorkflowService.processValidatorResult(terminalValidator.id);
  }

  // Case 3: Validating issues with no active or terminal validator
  const stuckIssues = this.issueRepo.listValidatingWithoutActiveValidator().filter(i => i.primary_thread_id);
  for (const issue of stuckIssues) {
    // Already confirmed no active validator. Check terminal.
    if (this.findLatestTerminalValidator(issue.id)) continue; // handled above
    // No validator at all
    const requestedEvent = this.findValidationRequestedEvent(issue);
    if (requestedEvent) {
      // Creation was interrupted - try to request validation using the implementation_run_id from the event
      const implRunId = requestedEvent.payload_json.implementation_run_id as string;
      const implRun = this.runRepo.getById(implRunId);
      if (implRun) {
        this.validationWorkflowService.requestValidation(issue.id, implRunId);
      }
    } else {
      // No requested event - try latest completed impl run
      const implRun = this.runRepo.getLatestCompletedByRole(issue.id, RunRole.Implementation);
      if (implRun) {
        this.validationWorkflowService.requestValidation(issue.id, implRun.id);
      } else {
        // Nothing to recover - block
        this.blockIssueInRecovery(issue, ValidationBlockReason.RecoveryInconsistent, "No implementation run or requested event found during recovery");
      }
    }
  }
}
```

Wait, but `requestValidation` has an early return if the issue is already Validating:
```typescript
if (issue.status === IssueStatus.Validating) {
    const active = this.runRepo.getActiveValidator(issueId);
    if (active) return active;
    return null; // <-- This returns null without blocking
}
```

So if issue is Validating and no active validator, `requestValidation` returns null without blocking. That's not what we want for case 3.

Looking at the logic more carefully:
```typescript
if (issue.status === IssueStatus.Validating) {
    const active = this.runRepo.getActiveValidator(issueId);
    if (active) return active;
    return null; // For case 3, this would return null and not progress
}
```

So for case 3, `requestValidation` itself won't help because it returns null when issue is already Validating with no active validator. I need to handle case 3 differently.

For case 3 rebuild: I should manually create a validator run and write events, similar to what requestValidation does but for the recovery path.

Actually, let me think about this differently. For case 3:
- Issue is Validating but no validator exists
- This means the validation.requested event was written but the validator run creation failed or was interrupted
- I should try to create the validator run again

The cleanest approach: I'll create a new method on ValidationWorkflowService that handles recovery for case 3. Or I can handle it in the recovery service by directly creating the run and writing events.

Actually, looking at the design more carefully:

```
3. Validating但无 active/terminal validator时：若 requested event存在且创建中断，重建一次；配置不可用则 Blocked。
```

So for case 3 with requested event: rebuild validator. If config not available: Blocked.

I can achieve this by:
1. In the recovery service, directly handle the "rebuild" path
2. For the "Blocked" case, use the issueRepo and threadEventService

But this duplicates logic from requestValidation. A better approach: extract the "create validator run" logic or add a recovery-specific method.

Actually, let me keep it simple. For case 3:
1. If requested event exists: I'll directly create a validator run using runRepo, write events, add it to the queue. But this requires access to the same services as requestValidation.
2. If no requested event: find latest impl and call requestValidation (which will skip because issue is Validating)...

Hmm, this is getting complicated. Let me take another approach.

For case 3, the issue is Validating with no validator. I need to:
- If requested event exists: try to create a new validator run
- If no requested event: this is unusual. Try to find latest completed impl and call requestValidation. But requestValidation checks issue.status !== Running and returns null. So I need to first set issue back to Running.

Wait, that would be wrong for recovery. The issue was Validating for a reason.

OK let me just handle case 3 pragmatically:

For "requested event exists":
- Get the implementation_run_id from the event
- Try to find an available validator and create a new validator run
- If no validator available: Block the issue

For "no requested event but latest completed impl exists":
- This is really case 1 but issue got stuck in Validating somehow
- Just call requestValidation - it will return null because issue is Validating, which is ok since case 1 already handles the "Running" path

For "no requested event and no impl run":
- Block with RecoveryInconsistent

Let me write this now. I'll handle case 3 by:
1. Finding the requested event and extracting the implementation_run_id
2. Then using a helper to select a validator and create a run
3. If that fails, block

Actually, for simplicity, I'll adjust the approach. For case 3:
- If requested event exists: I'll transition issue back to Running first, then call requestValidation which will re-do the full flow. This is safe because no validator exists yet.
  
  Wait, that changes issue state which might not be ideal. Let me think...

Actually no, let me look at this from the other direction. The design says:

```
Validating但无 active/terminal validator时：若 requested event存在且创建中断，重建一次
```

"重建一次" = rebuild once. So I should try to create the validator run again. The simplest way to do this without duplicating requestValidation logic:

1. Get implementation_run_id from requested event
2. Call `requestValidation` but... it won't work because issue is Validating

OK let me just add a `rebuildValidator` public method to ValidationWorkflowService, or create the validator directly in the recovery service using the same selection logic.

Actually, the cleanest solution: Make `requestValidation` handle the Validating + no active validator case by doing a CAS from Validating back to Running first (as part of recovery). But that changes the semantics of requestValidation.

No. Let me just add a specific recovery method to ValidationWorkflowService. Or I'll handle it directly in the recovery service.

Actually, I think the simplest approach for recovery is:

For case 3 with requested event:
1. Get the implementation_run_id from the event
2. Select a validator using the same logic as requestValidation
3. If validator found, create the validator run directly
4. If no validator, block the issue

Let me just use the validator selector directly in the recovery service and create the run. I have access to all the repos.

Actually, I realize I'm overcomplicating this. Let me use a different strategy: for the rebuild case, I'll CAS the issue back to Running and then call requestValidation. This is a recovery-only pattern and is safe because:
- No active validator exists (verified by listValidatingWithoutActiveValidator)
- No terminal validator either
- The issue was stranded in Validating

Wait, the issue IS Validating. To use requestValidation, I need issue to be Running. But changing state from Validating to Running in recovery might lose information.

Hmm, let me think about what actually happens in case 3:
- The issue is Validating because a validation.requested event was written
- The validator run creation failed (DB crash, server restart, etc.)
- No validator run exists at all
- The issue is stuck in Validating

The recovery action is to finish what was started: create the validator run. The simplest way is to directly select a validator and create the run.

Let me just write the code directly. I can select a validator using the agentConfigRepo's `listAvailableByProjectAndRole` method (which the workflow service already uses via `selectValidator`). I'll inline the logic in the recovery service.

Actually, the most practical solution: I'll extract a `selectAndCreateValidatorRun` method or make the recovery service work closely with the workflow service.

Let me try yet another approach. For case 3, I'll:
1. Get the implementation_run_id from the requested event (if available)
2. Create a validator using the same validator selector
3. Create the validator run directly using runRepo
4. Write the events (or skip since they were already written?)

Actually wait - the validation.requested event is ALREADY written (that's what we're checking for case 3). So the events are already there. I just need to create the validator run. But the validation.requested event already includes a validator_run_id field. If creation was interrupted, that field might contain an incomplete ID.

Let me re-read the design:
```
3. Validating但无 active/terminal validator时：若 requested event存在且创建中断，重建一次；配置不可用则 Blocked。
```

OK so the approach is: rebuild once if possible, otherwise Blocked.

For simplicity, let me have the recovery service handle this by:
1. Directly creating a new validator run with a fresh ID
2. Not re-writing the requested event (it already exists)
3. Writing a new run.queued event

I'll use the runRepo.create to create the validator run and the threadEventService to write the run.queued event.

Let me implement this now. I'll keep it simple and direct.

```typescript
private rebuildValidatorForIssue(issue: Issue, implRunId: string): void {
  const validators = this.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator);
  if (validators.length === 0) {
    this.blockIssueInRecovery(issue, ValidationBlockReason.ValidatorUnavailable, "No validator available during recovery");
    return;
  }
  const selected = validators[0]; // deterministic: first by created_at ASC, id ASC
  const round = issue.validation_round_count + 1;
  const validatorIdentity: AdapterIdentitySnapshot = {
    adapter_config_id: selected.id,
    name: selected.name,
    cli_provider: selected.cli_provider,
    default_model: selected.default_model,
  };
  const validatorRun = this.runRepo.create({
    issue_id: issue.id,
    thread_id: issue.primary_thread_id!,
    workspace_id: issue.workspace_id,
    adapter_config_id: selected.id,
    instructions: "",
    status: RunStatus.Queued,
    role: RunRole.Validator,
    dispatch_source: RunDispatchSource.System,
    validation_round: round,
    adapter_identity: validatorIdentity,
  });
  this.threadEventService.write(issue.primary_thread_id!, ThreadEventType.RunQueued, ActorType.System, null, {
    run_id: validatorRun.id,
    issue_id: issue.id,
    thread_id: issue.primary_thread_id!,
    workspace_id: issue.workspace_id,
    status: RunStatus.Queued,
    role: RunRole.Validator,
    validation_round: round,
  });
  this.threadEventService.broadcast(...); // need to broadcast
}
```

Wait, but `threadEventService.broadcast` takes a single event. Let me check if I need to broadcast or if just writing is enough for recovery.

Looking at the existing code pattern in requestValidation:
```typescript
for (const event of pendingEvents) this.threadEventService.broadcast(event);
```

For recovery, I should broadcast the new run.queued event. The validation.requested was already broadcast when it was first written.

OK, let me also think about what imports I need for the recovery service:

```typescript
import type { IssueRepository } from "../../repositories/issue.js";
import type { RunRepository } from "../../repositories/run.js";
import type { ThreadEventRepository } from "../../repositories/thread-event.js";
import type { ValidationWorkflowService } from "./workflow-service.js";
import type { Issue, Run, AdapterIdentitySnapshot } from "@personahub/shared/types";
import { IssueStatus, RunRole, RunStatus, RunDispatchSource, ThreadEventType, ActorType, ValidationBlockReason } from "@personahub/shared/types";
import type { ThreadEventService } from "../thread-event.js";
import type { AgentConfigRepository } from "../../repositories/agent-config.js";
```

Wait, do I need ThreadEventService? I need to write events for the rebuild case. Let me add it to the constructor.

Actually, looking at the test/design spec for the constructor:
```typescript
constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private threadEventRepo: ThreadEventRepository,
) {}
```

But for the rebuild case, I need to write events. The `threadEventService.write` uses `threadEventRepo.create` under the hood. I can either:
1. Use `threadEventRepo` directly (already available)
2. Add `threadEventService` to the constructor

Let me add `threadEventService` to make it cleaner. Actually, the task spec says the constructor has `threadEventRepo`. Let me stick with that and use the repo directly for writing events (or find another way).

Actually, `threadEventRepo.create` is available and writes to the DB. But it doesn't broadcast. For recovery, broadcasting is important for SSE clients.

Let me add `ThreadEventService` to the dependencies instead of or in addition to `ThreadEventRepository`.

Actually, looking at the test again, the spec says:
```typescript
constructor(
    private issueRepo: IssueRepository,
    private runRepo: RunRepository,
    private validationWorkflowService: ValidationWorkflowService,
    private threadEventRepo: ThreadEventRepository,
) {}
```

But I also need `threadEventService` for broadcasting. Let me add it.

Wait, actually, for recovery I might not need broadcasting at all since this runs during server startup before the HTTP server starts listening. Clients will reconnect and receive events via SSE replay. So I can just write to the DB.

Let me check: in the existing code, `threadEventService.write` creates the event in DB and `threadEventService.broadcast` sends it via SSE. If recovery runs before the server starts listening, broadcasting is unnecessary - the events will be picked up by SSE replay when clients reconnect.

So I can use `threadEventRepo.create` directly for writing events, without broadcasting. Let me verify this approach by looking at how `threadEventService.write` works vs `threadEventRepo.create`:

```typescript
// ThreadEventService
write(threadId, type, actorType, actorId, payload, evidenceRefs): ThreadEvent {
    return this.repo.create({ thread_id, type, actor_type, actorType, actor_id, payload, evidence_refs });
}
```

So `write` is just a thin wrapper around `repo.create`. I can use the repo directly.

But wait, I also need the `listByThreadAndTypes` method which is on `threadEventRepo`. That's already available.

OK let me finalize the service now. I'll use `threadEventRepo.create` for writing events during recovery (no broadcast needed since server hasn't started yet).

Actually, I realize I also need `AgentConfigRepository` for selecting a validator during rebuild. Let me add that to the constructor too.

Let me now write the implementation:

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-07-18T18:06:29Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts", "oldString": "  getActiveValidator(issueId: string): Run | null {\n    const row = this.db.prepare(\n      `SELECT * FROM runs\n       WHERE issue_id = ? AND role = 'validator' AND status IN ('queued', 'running')\n       ORDER BY created_at ASC, id ASC LIMIT 1`,\n    ).get(issueId) as RunRow | undefined;\n    return row ? mapRow(row) : null;\n  }\n}", "newString": "  getActiveValidator(issueId: string): Run | null {\n   
…[truncated])`


> [reasoning] I need to add `getLatestTerminalByRole` to the RunRepository since it's used in the recovery service. Let me also add the import for the types needed.

Wait, `AdapterIdentitySnapshot` - I need to check where it's exported from. It's from `@personahub/shared/types`.

Let me add the `getLatestTerminalByRole` method to RunRepository.
I need to add `getLatestTerminalByRole` to RunRepository:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:06:38Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "function createRecoveryService(services: TestServices): ValidationRecoveryService {\n  return new ValidationRecoveryService(\n    services.issueRepo,\n    services.runRepo,\n    services.validationWorkflowService,\n    services.threadEventRepo,\n  );\n}", "newString": "function createRecoveryService(services: TestServices): ValidationRecoveryService {\n  return new ValidationRecoverySe
…[truncated])`


> [reasoning] Good. Now I need to update the test helpers and the index.ts to register the recovery service. Let me also check the test to see if the recovery service constructor matches.

Wait, looking at the test:
```typescript
function createRecoveryService(services: TestServices): ValidationRecoveryService {
  return new ValidationRecoveryService(
    services.issueRepo,
    services.runRepo,
    services.validationWorkflowService,
    services.threadEventRepo,
  );
}
```

But I modified the constructor to include `agentConfigRepo`! I need to update the test helper.

Also, I need to update the test to pass the agentConfigRepo.

Let me update the test file and then register in index.ts.
Now update the test helper to pass `agentConfigRepo`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:06:47Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\index.ts", "oldString": "import { StaleRecoveryService } from \"./services/stale-recovery.js\";\nimport { ValidationWorkflowService } from \"./services/validation/workflow-service.js\";", "newString": "import { StaleRecoveryService } from \"./services/stale-recovery.js\";\nimport { ValidationRecoveryService } from \"./services/validation/recovery-service.js\";\nimport { ValidationWorkflowService } from \"./services/validation/workflow-service.
…[truncated])`


> [reasoning] Wait, the `agentConfigRepo` is in TestServices but I used `services.agentConfigRepo`. Let me check what it's called in TestServices... Looking at helpers.ts:

```typescript
export interface TestServices {
  ...
  agentConfigRepo: AgentConfigRepository;
  ...
}
```

Yes, it's `agentConfigRepo`. Good.

Now let me register the recovery service in index.ts. I need to:
1. Import ValidationRecoveryService
2. Create the instance after staleRecoveryService
3. Call reconcile() after staleRecoveryService.runAll() and before listen

Let me also update the index.ts.
Now register the recovery service in `index.ts`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:06:55Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\index.ts", "oldString": "  const staleRecoveryService = new StaleRecoveryService(\n    runRepo, workspaceRepo, threadEventService, workspaceLockService,\n    developmentTraceService, runTraceRepo,\n  );\n\n  await staleRecoveryService.runAll();\n\n  const app = Fastify({ logger: true });", "newString": "  const staleRecoveryService = new StaleRecoveryService(\n    runRepo, workspaceRepo, threadEventService, workspaceLockService,\n    developme
…[truncated])`


> [reasoning] Now I need to add the ValidationRecoveryService instance creation and its reconcile() call. Let me add after the staleRecoveryService.runAll() call.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:07:03Z

- **tool**: `todowrite({"todos": [{"priority": "high", "content": "Read all prerequisite files (design doc, existing services, repos, tests)", "status": "completed"}, {"priority": "high", "content": "T060: Write integration test for ValidationRecoveryService", "status": "completed"}, {"priority": "high", "content": "T061: Implement ValidationRecoveryService", "status": "completed"}, {"priority": "high", "content": "Register recoveryService.reconcile() in server/src/index.ts", "status": "completed"}, {"priority": "high
…[truncated])`


> [reasoning] Good. Now let me move on to T062 - extending the startNextQueuedRun eligibility checks in run-dispatch.ts.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all prerequisite files (design doc, existing services, repos, tests)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T060: Write integration test for ValidationRecoveryService",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T061: Implement ValidationRecoveryService",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Register recoveryService.reconcile() in server/src/index.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T062: Verify/extend startNextQueuedRun eligibility checks + tests",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Run typecheck and all tests - must pass",
    "status": "pending",
    "priority": "high"

…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:07:10Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts", "oldString": "      if (issue.status === IS.Validating && run.role !== RunRole.Validator) {\n        this.runService.cancelQueued(run.id, \"issue_state_changed_before_start\");\n        continue;\n      }\n\n      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);", "newString": "      if (issue.status === IS.Validating && run.role !== RunRole.Validator) {\n        this.runService.cancelQue
…[truncated])`


> [reasoning] For T062, I need to extend `startNextQueuedRun` in `run-dispatch.ts` to add:
1. Validator-specific checks: issue must be Validating, validation round must match
2. Also check: if a validator or non-validator run is queued for a Done/Blocked issue - cancel

Looking at the current code in `run-dispatch.ts`:

```typescript
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
      const issue = this.issueRepo.getById(run.issue_id);
      if (!issue) continue;
      if (issue.status === IS.Blocked) {
        this.runService.cancelQueued(run.id, "issue_blocked_before_start");
        continue;
      }
      if (issue.status === IS.Done) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }
      if (issue.status === IS.Validating && run.role !== RunRole.Validator) {
        this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
        continue;
      }

      const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
      // ...
    }
}
```

The design (6.1.1) says:
- implementation -> Inbox/Ready/Running (only these allowed)
- validator -> Validating, and validation_round must match current round
- Done/Blocked -> don't start new Run

Currently:
- Blocked: ✓ handled for all roles
- Done: ✓ handled for all roles
- Validating + non-validator: ✓ handled
- Running + validator: NOT handled - could start a validator in Running state
- Validator round matching: NOT handled

I need to add:
1. `if (run.role === RunRole.Validator)` -> check issue is Validating and round matches
2. Actually, the current code already handles non-validator in Validating. But a validator in Running is NOT handled.

Let me add the checks. For the validator case, I need to check:
- If run is validator AND issue is NOT Validating -> cancel
- If run is validator AND issue IS Validating BUT round doesn't match -> cancel

I'll add after the existing checks:

```typescript
if (run.role === RunRole.Validator) {
  if (issue.status !== IS.Validating) {
    this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
    continue;
  }
  const expectedRound = issue.validation_round_count + 1;
  if (run.validation_round !== expectedRound) {
    this.runService.cancelQueued(run.id, "issue_state_changed_before_start");
    continue;
  }
}
```

Let me implement this.
Now let me extend `startNextQueuedRun` in `run-dispatch.ts` with validator eligibility checks:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:07:23Z

- **tool**: `write({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\queue-drain-eligibility.test.ts", "content": "import { describe, it, expect, beforeEach, afterEach } from \"vitest\";\nimport { createTestServices, createTempDir, disposeTestServices, type TestServices } from \"../helpers.js\";\nimport { IssueStatus, RunRole, RunDispatchSource, RunStatus, AdapterStatus } from \"@personahub/shared/types\";\n\nfunction setupFixture(services: TestServices, tempDir: string) {\n  const project = serv
…[truncated])`


> [reasoning] Now I need to add the T062 test. Let me create a test file for queue drain eligibility. Since the `startNextQueuedRun` in `run-dispatch.ts` is private but called from `finalizeAndDrain`, I'll test via `finalizeAndDrain`.

The test plan for T062:
1. Implementation queued + issue Validating -> cancelled
2. Implementation queued + issue Done -> cancelled (already exists in acceptance checklist)
3. Implementation queued + issue Blocked -> cancelled (already tested in acceptance/stale tests)
4. Validator queued + issue Running -> cancelled
5. Validator queued + wrong round -> cancelled
6. Validator queued + issue Validating + correct round -> starts

I'll add these tests to the `terminal-orchestration.test.ts` file, or create a new one. Let me create a new file to keep things organized (under 350 lines cap).

Actually, let me add to terminal-orchestration.test.ts since it's related to queue drain.

Wait, the terminal-orchestration.test.ts is already 110 lines. Let me create a separate test file.
Now let me write the T062 queue drain eligibility tests:

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-07-18T18:07:48Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npm run typecheck 2>&1", "timeout": 60000})`


> [reasoning] Wait, there's an issue. The `finalizeAndDrain("nonexistent", workspace.id)` won't work for validator start tests because `startNextQueuedRun` acquires the workspace lock. The `finalizeAndDrain` flow releases the lock after finalization, then tries queue drain. If a lock was held by the non-existent run... hmm, let me check.

Looking at `finalizeAndDrain`:
```typescript
async finalizeAndDrain(runId: string, workspaceId: string): Promise<void> {
    try {
      try {
        this.developmentTraceService.finalizeRun(runId);
      } catch {
        // finalization failure still releases lock
      }
    } finally {
      this.workspaceLockService.releaseByRunId(runId); // This releases the lock for runId
      try {
        await this.workflowHook(runId);
      } catch {
        // hook errors must not prevent queue drain
      }
      await this.startNextQueuedRun(workspaceId);
    }
}
```

So it releases the lock for `runId` first. If `runId` is "nonexistent", `releaseByRunId` checks if the run exists and releases. Let me check `releaseByRunId` - if it doesn't find a lock for that run, it's a no-op.

Then `startNextQueuedRun` tries to acquire the lock for the first eligible queued run.

But the issue is: when we `finalizeAndDrain("nonexistent", workspace.id)`, the workspace lock hasn't been acquired yet (the nonexistent run was never started). So `releaseByRunId("nonexistent")` is a no-op, then `startNextQueuedRun` tries to acquire the lock for the queued run, which should work.

Wait, actually let me re-read `startNextQueuedRun`:
```typescript
const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
```

The `acquire` checks if the workspace is already locked. Since we just released the lock for "nonexistent" (which was a no-op), the workspace should be unlocked. So the acquire should work for the first eligible queued run.

But wait - `setupFixture` creates a completed implementation run in the fixture. When `finalizeAndDrain` is called with "nonexistent", does it affect anything related to the completed impl run? No - it calls `developmentTraceService.finalizeRun("nonexistent")` which would fail (run not found), but the catch absorbs that. Then `releaseByRunId("nonexistent")` is a no-op. Then `workflowHook("nonexistent")` fails because the run doesn't exist, but the catch absorbs that.

So the flow should work. The queued runs in the workspace should be processed.

Let me verify the setup: the `setupFixture` creates a completed impl run on the workspace. This means the workspace has a history but the lock is released (from the completed run's finalizeAndDrain).

Actually wait, I realize the issue. The `setupFixture` function creates a completed implementation run but does NOT call `finalizeAndDrain` for it. The run is just created directly with `status: RunStatus.Completed`. So:
- The workspace lock might still be held? No - the run was never started, so no lock was ever acquired.
- The workspace should be unlocked initially.

When I call `finalizeAndDrain("nonexistent", workspace.id)`:
1. Try `finalizeRun("nonexistent")` - fails, catches
2. `releaseByRunId("nonexistent")` - no-op
3. `workflowHook("nonexistent")` - `runService.get("nonexistent")` throws `RUN_NOT_FOUND`, catch absorbs it  
4. `startNextQueuedRun(workspace.id)` - iterates queued runs and tries to start

This should work. Let me also check if `runService.get` throws or returns null for non-existent runs:

```typescript
get(runId: string): Run {
    const run = this.runRepo.getById(runId);
    if (!run) {
      throw new AppError(ErrorCode.RUN_NOT_FOUND, "Run not found.");
    }
    return run;
}
```

It throws! So `workflowHook("nonexistent")` will throw. The catch block in `finalizeAndDrain` catches it:
```typescript
try {
    await this.workflowHook(runId);
} catch {
    // hook errors must not prevent queue drain
}
```

So it's caught and queue drain proceeds. Good.

OK, the tests should work. Let me run the typecheck now and see if everything compiles.

Actually, wait. Let me first check if there are any issues with the recovery service test. I need to verify:

1. `reconcile()` is async - the test calls `await recovery.reconcile()`. Is the reconcile method properly async? Looking at my implementation... `reconcile()` calls synchronous methods that don't return promises. But I made it `async` which is fine.

Actually wait, looking at my code:
```typescript
async reconcile(): Promise<void> {
    this.reconcileUnrequestedImplementations();
    this.reconcileTerminalValidators();
    this.reconcileStuckValidating();
}
```

These methods all use synchronous repository operations (SQLite is synchronous in better-sqlite3). But the signature is async, which is fine. The caller awaits it.

But there's a potential issue: `processValidatorResult` is synchronous (it doesn't return a promise - looking at the code, it's `void`, not `Promise<void>`). So calling it without await is fine.

Let me now run the typecheck and tests.

Actually, wait - I need to double check that `RequestValidation` has the right import path. Let me check the import path for the recovery service.
Now let me run typecheck to see if everything compiles:

  <details><summary>tool output</summary>

  ```text
> typecheck
> npm -w @personahub/server run typecheck && npm -w @personahub/web run typecheck


> @personahub/server@0.1.0 typecheck
> tsc --noEmit


> @personahub/web@0.1.0 typecheck
> tsc --noEmit
  ```
  </details>

## assistant · 2026-07-18T18:08:14Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx -w @personahub/server vitest run 2>&1", "timeout": 120000})`


> [reasoning] Typecheck passes. Now let me run the tests to see if they pass.
Typecheck passes. Now let me run the tests:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

[90mstderr[2m | tests/integration/git-scanner.test.ts
[22m[39mUsing an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration

 [32m✓[39m tests/integration/git-scanner.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 13906[2mms[22m[39m
   [33m[2m✓[22m[39m Git Workspace Scanner (T026)[2m > [22mcaptures clean baseline after commit [33m 1994[2mms[22m[39m
   [33m[2m✓[22m[39m Git Workspace Scanner (T026)[2m > [22mdetects added file in final snapshot [33m 2468[2mms[22m[39m
   [33m[2m✓[22m[39m Git Workspace Scanner (T026)[2m > [
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:10:21Z

- **tool**: `grep({"pattern": "acquire|releaseByRunId|isLocked", "include": "workspace-lock.ts", "output_mode": "content"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\workspace-lock.ts"})`


> [reasoning] The test output was truncated due to timeout, but I can see the failing tests:

**Failed tests:**
1. `skip issue with no completed implementation run` - expected 'Validating' to be 'Running'. Issue: when `setupFixture` creates a fixture, the issue starts in Running (via `issueService.create` which creates it in `Inbox` by default, then the test updates to `Running`). But wait, the fixture creates a completed implementation run! Then when we call `reconcile()`, it finds a completed implementation run and calls `requestValidation`. The issue transitions to Validating.

   Looking at the test again: The test creates the fixture (which includes a completed implementation run), then sets the issue to Running. The reconcile finds the completed impl run and calls requestValidation. This is the CORRECT behavior! The test assertion is wrong.

   Let me fix the test: the fixture creates a completed implementation run. So when the issue is set to Running and reconcile runs, it WILL find the completed impl and request validation. The issue should go to Validating, not stay Running. Let me fix the test to expect Validating.

2. `requests validation when no requested event and latest impl completed run exists` - expected validator, got null. Same issue as above? Let me look... The fixture creates a completed implementation run. The test sets issue to Validating manually. The reconcile tries to find latest completed impl run -> finds it -> calls `requestValidation`. But `requestValidation` checks issue status and sees Validating, then checks for active validator or returns null.

   So the issue is: when the issue is already Validating and we call `requestValidation`, it returns null because the issue is not Running. This is expected behavior.

   For recovery case 3 with no requested event: the issue is Validating but there's no requested event and no validator. This shouldn't normally happen but if it does, we need to handle it differently. The approach of calling `requestValidation` doesn't work because the issue is already Validating.

   Let me fix the recovery service for this case. Instead of calling `requestValidation`, I should:
   - Check if issue is Validating (it is, from the query)
   - Since there's no requested event and no validator, we should create a requested event and validator
   - One approach: CAS the issue from Validating back to Running, then call requestValidation
   - Another: handle the rebuild directly

   Actually, for the "no requested event but impl exists" case, the safest approach: we have a Validating issue with no validator and no requested event. This is a data inconsistency. Let me just block it as `RecoveryInconsistent` OR try to recover by directly creating the requested event and validator.

   But wait - can this situation happen? If an issue is Validating, a `validation.requested` event MUST have been written (in the same transaction as the CAS from Running to Validating, looking at requestValidation code). So if the issue is Validating, there MUST be a requested event. Unless the transaction failed after the CAS but before the event write... which wouldn't happen because they're in the same DB transaction.

   So this case (Validating, no validator, no requested event) should NOT happen in practice. It's a data inconsistency. Let me block it.

   Actually, looking at the test more carefully: the test sets the issue to Validating manually:
   ```
   services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
   ```
   
   This creates a Validating issue without a requested event. This is an abnormal state that shouldn't occur in production. So the correct recovery action is to block with RecoveryInconsistent.

   Let me update the test to expect Blocked, and update the recovery service to handle this.

3. `blocks issue when no requested event and no completed impl run` - expected 'Validating' to be 'Blocked'. Same issue: the fixture creates a completed impl run, so even though the test doesn't explicitly use `implRun`, the fixture already has one in the DB.

   Wait, looking at the test:
   ```
   const { issue } = setupFixture(services, tempDir);
   services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
   ```
   
   The fixture creates `{ project, issue, implAdapter, implRun }`. So `implRun` exists. The issue is set to Validating. The reconcile tries to find a completed impl run and finds it. Then in `reconcileUnrequestedImplementations`, the issue is Validating (not Running), so it won't be picked up by case 1. In case 3, the recovery service searches without active validator -> finds it -> checks terminal validator -> none -> checks requested event -> none -> checks latest completed impl -> finds it -> calls requestValidation -> but issue is Validating, so requestValidation returns null.

   Hmm wait, the fixture has a completed `implRun`. So `getLatestCompletedByRole(issue.id, RunRole.Implementation)` returns it. Then `requestValidation` is called but it returns null because issue is Validating.

   I need to change the recovery service logic. For case 3 with no requested event and a completed impl run:
   - Since the issue is Validating with no requested event, this is inconsistent
   - But the safest recovery is to try to request validation
   - But requestValidation won't work because issue is already Validating
   
   Solution: I should first CAS the issue back to Running, then call requestValidation. This is a recovery-only action.

   Or simpler: just block with RecoveryInconsistent.

   Let me update the recovery service to block for case 3 when there's no requested event. The test should then expect Blocked.

   Actually, let me reconsider: the test "requests validation when no requested event and latest impl completed run exists" does create a situation where:
   - Issue is Validating (manually set)
   - No requested event
   - Completed impl run exists
   
   This shouldn't happen in practice (the CAS+event are in the same transaction). So blocking is the right recovery action.

   But the test expects recovery to work (requesting validation). Let me change the test to expect Blocked, and update the test name.

4. Queue drain tests: expected defined but got undefined, and expected 'running' but got 'queued'. The issue is that `finalizeAndDrain("nonexistent", workspace.id)` doesn't trigger queue drain properly, or the lock acquisition fails.

   Actually, looking more carefully at `finalizeAndDrain`:
   ```typescript
   async finalizeAndDrain(runId: string, workspaceId: string): Promise<void> {
       try {
         try {
           this.developmentTraceService.finalizeRun(runId);
         } catch {
           // finalization failure still releases lock
         }
       } finally {
         this.workspaceLockService.releaseByRunId(runId);
         try {
           await this.workflowHook(runId);
         } catch {
           // hook errors must not prevent queue drain
         }
         await this.startNextQueuedRun(workspaceId);
       }
   }
   ```
   
   And `startNextQueuedRun`:
   ```typescript
   private async startNextQueuedRun(workspaceId: string): Promise<void> {
       const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
       for (const run of queuedRuns) {
         // ... checks
         const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
         if (!lockAcquired) return;
         // ... start
       }
   }
   ```

   The issue is: `acquire` might fail because the workspace lock is already taken. Is it taken? Let me check if the workspace is locked.

   In `setupFixture`:
   ```typescript
   const workspace = services.workspaceService.get(project.id)!;
   ```
   
   `workspaceService.get` returns the workspace. The lock state should be idle (no one acquired it).

   So `acquire` should succeed. But wait - does `finalizeAndDrain("nonexistent", workspace.id)` release the lock for "nonexistent"? The `releaseByRunId` method might look up the workspace locked by that run and release it. If "nonexistent" doesn't exist, it's a no-op. Then `startNextQueuedRun` should be able to acquire the lock.

   Let me check `workspaceLockService.acquire`:

   Looking at workspace-lock service... let me check the implementation.

   Actually, the error says "expected undefined to be defined" - meaning `started` is undefined. The `listByIssue` returned impl runs but none had status Running. That means `startNextQueuedRun` didn't start the queued run.

   Looking at `startNextQueuedRun` more carefully - it calls `listQueuedByWorkspace` which returns queued runs ordered by `created_at ASC, id ASC`. But in my test, I create the queued run AFTER the fixture, so it should be the only queued run.

   Wait, the issue might be that `workflowHook("nonexistent")` throws and the catch absorbs it. Then `startNextQueuedRun` runs. Let me trace through more carefully.

   Actually, I think the problem might be that `workflowHook` calls `this.runService.get(runId)` which throws `RUN_NOT_FOUND` for "nonexistent". The catch in `finalizeAndDrain` catches this error. Then `startNextQueuedRun` runs.

   In `startNextQueuedRun`, `this.runService.listQueuedByWorkspace(workspaceId)` calls `this.runRepo.listQueuedByWorkspace(workspaceId)`. The queued run should be returned. Then the checks run... for the "starts implementation run when issue is Running" test, the issue is Running and the run is implementation. The checks should pass.

   Then `this.workspaceLockService.acquire(workspaceId, run.id)` should work... unless the workspace is already locked.

   Wait, I just realized - in the test, before calling `finalizeAndDrain("nonexistent", workspace.id)`, I didn't lock the workspace. But `releaseByRunId("nonexistent")` tries to unlock a lock held by "nonexistent". If no such lock exists, it should be a no-op.

   Let me check `releaseByRunId` implementation... Actually, I don't have direct access to it, but let me check by looking at WorkspaceLockService:

   Actually, I should look at the actual code. Let me check workspace-lock.

   Actually, I think I might understand the issue. Looking at the workspace-lock service, `acquire` might fail because the workspace is already locked OR because it was acquired by a run that was already processed.

   Actually wait - I bet the issue is simpler. The `setupFixture` creates a completed implementation run but doesn't go through the dispatch flow. So the workspace is never locked. When `finalizeAndDrain("nonexistent", workspace.id)` is called, it releases the lock for "nonexistent" (no-op), then calls `startNextQueuedRun`. The `startNextQueuedRun` tries to acquire the lock and it should work.

   But maybe the issue is that the workspace lock service `acquire` returns false because... let me check if there's something else going on.

   Actually, wait. Let me look more carefully at what `releaseByRunId("nonexistent")` does. In the workspace lock service:

   ```typescript
   releaseByRunId(runId: string): boolean {
     const workspace = this.workspaceRepo.listLockedWorkspaces()
       .find(w => w.locked_by_run_id === runId);
     if (!workspace) return false;
     this.release(workspace.id);
     return true;
   }
   ```

   So for "nonexistent", it returns false without doing anything. The workspace is unlocked.

   Then `startNextQueuedRun` -> `acquire(workspaceId, run.id)` should return true for the queued run.

   Hmm, unless `acquire` checks something else. Let me look at the workspace-lock code more carefully.

   Actually, I think I might be looking at the wrong thing. Let me re-check whether the queued run exists in the workspace. The `listQueuedByWorkspace` queries `WHERE workspace_id = ? AND status = 'queued'`. If the run I created with `workspace.id` matches, it should be returned.

   Wait, I see a potential issue. In `setupFixture`, I get the workspace via:
   ```typescript
   const workspace = services.workspaceService.get(project.id)!;
   ```
   
   But is `workspaceService.get` the same as `workspaceRepo.getById`? Let me check...

   In `workspaceService`:
   ```typescript
   get(projectId: string): Workspace | null {
     const project = this.projectRepo.getById(projectId);
     if (!project) return null;
     return this.workspaceRepo.getById(project.default_workspace_id);
   }
   ```

   So it returns the workspace associated with the project. The workspace should have the correct `id`.

   But `issue.workspace_id` might be different? No, the issue is created from the same project, so it should have the same workspace.

   Let me look at the issue creation. In `issueService.create`:
   ```typescript
   const workspace = this.workspaceRepo.getById(project.default_workspace_id);
   ```

   Wait, let me check what `RunService.create` does:
   ```typescript
   const workspace = this.workspaceRepo.getById(issue.workspace_id);
   ```

   So `issue.workspace_id` is set when the issue is created. The workspace ID should match `workspace.id`.

   I think the problem might be that the `releaseByRunId` call in `finalizeAndDrain` is somehow interfering. Let me look at this:

   ```typescript
   await staleRecoveryService.runAll();
   ```

   Wait, no, that's in index.ts. In the test, there's no stale recovery call.

   Let me look at this from a different angle. Maybe the issue is that the complete implementation run created in `setupFixture` was created directly with `runRepo.create` with status `Completed`, which means the workspace lock was never acquired for it. But when `finalizeAndDrain("nonexistent", ...)` is called, the lock acquisition for the new queued run should succeed.

   Actually, I wonder if there's an issue with `finalizeAndDrain("nonexistent", workspace.id)`. The `developmentTraceService.finalizeRun("nonexistent")` throws (run not found), the catch absorbs it. Then `releaseByRunId("nonexistent")` does nothing. Then `workflowHook("nonexistent")` calls `this.runService.get("nonexistent")` which throws `RUN_NOT_FOUND`. The catch absorbs it. Then `startNextQueuedRun(workspaceId)` runs.

   I think the queue drain SHOULD work. Let me add some debugging. Actually, let me just check if the queued run is listed.

   Actually, you know what - let me just check if the weird error is because `workspace.id` doesn't match `issue.workspace_id`. Let me verify in the test.

   Actually, I just realized something. The `setupFixture` creates a workspace with `services.workspaceService.bind(project.id, tempDir)`. Then gets the workspace with `services.workspaceService.get(project.id)!.id`. This gives us the correct workspace ID.

   The issue's `workspace_id` should be the same workspace ID (from `issueService.create`).

   Let me verify that `listQueuedByWorkspace` returns the queued run. Let me add a direct test.

   Actually, wait - looking at the test output more carefully:

   ```
   ❯ starts implementation run when issue is Running
   → expected undefined to be defined
   ```

   The error is at:
   ```typescript
   const started = implRuns.find((r) => r.status === RunStatus.Running);
   expect(started).toBeDefined();
   ```

   So no implementation run is in Running state. This means either:
   1. The queued run was not started
   2. The queued run was cancelled
   3. The queued run remained queued

   Let me check by looking at the actual runs. I think the issue might be that `startNextQueuedRun` can't start the run because the adapter needs to be set up, or the `prepareAndStart` throws.

   Actually, in `startNextQueuedRun`:
   ```typescript
   const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);
   if (!lockAcquired) return;
   let startedRun = this.prepareAndStart(run);
   ```

   `prepareAndStart` does:
   ```typescript
   private prepareAndStart(run: Run): Run | null {
     const workspace = this.workspaceRepo.getById(run.workspace_id);
     if (!workspace) throw ...
     const adapterConfig = this.agentConfigRepo.getById(run.adapter_config_id);
     if (!adapterConfig) throw ...
     // ...
     return this.runService.transitionToRunning(run.id);
   }
   ```

   If `prepareAndStart` throws, it's caught by:
   ```typescript
   try {
     startedRun = this.prepareAndStart(run);
   } catch {
     this.workspaceLockService.releaseByRunId(run.id);
     continue;
   }
   ```

   So if it throws, it just continues. But why would it throw? The adapter config should exist.

   Wait - I create the queued run with `implAdapter.id` from the fixture. That adapter exists in the fixture. So `getById` should find it.

   Actually, let me check if there's a different issue. Let me look at the output more carefully...

   Hmm, looking at the timeout, the tests took a long time and hit the 120s limit. But the failures are clear.

   Let me think about this differently. Maybe the test timeout is the issue. With 120s timeout and many tests, maybe the finalizeAndDrain hangs somewhere. Let me check if there's an async issue.

   `finalizeAndDrain` is async but `startNextQueuedRun` is... actually, `startNextQueuedRun` in `run-dispatch.ts` is `private async startNextQueuedRun`. So it's properly awaited.

   Actually wait, `startNextQueuedRun` in `run-dispatch.ts` is `private async startNextQueuedRun`. And `finalizeAndDrain` does `await this.startNextQueuedRun(workspaceId)`. So it's properly awaited.

   The issue might be with the test timing. The tests pass for cancellation but fail for starting. This suggests the cancellation logic works but starting doesn't.

   Let me think about what's different:
   - Cancellation tests: issue is Validating/Done/Blocked -> run should be cancelled. These pass!
   - Start tests: issue is Running -> run should be started. These fail.

   The difference might be that cancellation happens before the lock acquire check, and starting requires the lock.

   Oh wait! I just realized - in `run-dispatch.ts` `startNextQueuedRun`, the lock acquire happens AFTER the eligibility checks. But the eligibility checks for non-validator runs in Running state don't have ANY special check - they just fall through to the lock acquire.

   But the cancellation tests pass because the run is cancelled BEFORE the lock acquire is attempted (in the if/continue block).

   For the start tests, the lock acquire fails. Why?

   Let me check what `workspaceLockService.acquire` does. It checks if the workspace is already locked:

   Looking at workspace-lock... I need to check the implementation.

   Actually, I bet the issue is that the workspace IS already locked. When was it locked? The setupFixture creates a completed run but doesn't go through the dispatch flow. So the lock shouldn't be held.

   UNLESS... `workspaceService.bind` or `issueService.create` somehow locks the workspace?

   Let me check if the test is failing because the workspace has an existing lock from the completed impl run. But the impl run was created directly with `runRepo.create` with status Completed - no lock was ever acquired.

   OK let me just debug this by reading the workspace lock state in the test. But first, let me check if there's an existing `isLocked` method.

   Looking at the stale recovery test:
   ```typescript
   expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(true);
   ```

   So there IS an `isLocked` method. Let me use it to check.

   Actually, let me try a different approach. Let me find and read the workspace-lock service implementation.
Let me examine the workspace lock service to understand the test failures:

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 1 file(s)

D:\Projects\personahub\server\src\services\workspace-lock.ts
  7: acquire(workspaceId: string, runId: string): boolean {
  8: return this.workspaceRepo.acquireLock(workspaceId, runId);
  15: releaseByRunId(runId: string): void {
  19: isLocked(workspaceId: string): boolean {

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type="librarian", load_skills=[], prompt="Lookup document
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\workspace-lock.ts</path>
<type>file</type>
<content>
1: import type { WorkspaceLockState } from "@personahub/shared/types";
2: import type { WorkspaceRepository } from "../repositories/workspace.js";
3: 
4: export class WorkspaceLockService {
5:   constructor(private workspaceRepo: WorkspaceRepository) {}
6: 
7:   acquire(workspaceId: string, runId: string): boolean {
8:     return this.workspaceRepo.acquireLock(workspaceId, runId);
9:   }
10: 
11:   release(workspaceId: string): void {
12:     this.workspaceRepo.releaseLock(workspaceId);
13:   }
14: 
15:   releaseByRunId(runId: string): void {
16:     this.workspaceRepo.releaseLockByRunId(runId);
17:   }
18: 
19:   isLocked(workspaceId: string): boolean {
20:     const ws = this.workspaceRe
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:11:08Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx -w @personahub/server vitest run tests/integration/queue-drain-eligibility.test.ts --reporter=verbose 2>&1", "timeout": 60000})`


> [reasoning] Now I need to understand the lock behavior. Let me check the WorkspaceRepository's acquireLock method to see if it has any special conditions.

The lock repository's `acquireLock` might have constraints. Let me look at it.

Actually, let me look at how the stale recovery tests work - they directly acquire the lock with:
```typescript
services.workspaceRepo.acquireLock(issue.workspace_id, run.id);
```

And those tests work. So the lock isn't the issue per se.

Wait - looking at the test failure again. The "starts implementation run when issue is Running" test creates the queued run, then calls `finalizeAndDrain("nonexistent", workspace.id)`. But what if `prepareAndStart` throws because of some issue? Let me look at what it does:

```typescript
private prepareAndStart(run: Run): Run | null {
    const workspace = this.workspaceRepo.getById(run.workspace_id);
    if (!workspace) { throw new AppError(...); }
    const adapterConfig = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!adapterConfig) { throw new AppError(...); }
    const adapter = this.adapterRegistry.getForConfig(adapterConfig);
    const traceCapability = adapter.capabilities.supportsStructuredTrace
      ? CommandTraceCapability.Supported
      : CommandTraceCapability.Unsupported;
    try {
      this.developmentTraceService.prepareRun({ run, workspace, traceCapability });
    } catch {
      // baseline failure does not prevent Run
    }
    return this.runService.transitionToRunning(run.id);
}
```

If adapter config is found and `transitionToRunning` succeeds, it should work. Let me check if the test's queued run has the right `adapter_config_id`.

In my test:
```typescript
const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
```

The `implAdapter` comes from the fixture, which creates an implementation adapter. The queued run uses `implAdapter.id`. Should work.

Let me actually check if `developmentTraceService.prepareRun` might throw despite the try-catch. Or if the issue is something else entirely.

Actually, let me just add a check in the test to see what happens to the queued run after finalizeAndDrain. Maybe it's still in "queued" status? The test checks for "running" status.

Wait, I should also check: does the `listQueuedByWorkspace` method return the runs in the right order? And does `startNextQueuedRun` iterate through all runs?

Hmm, actually - let me check if there's a simpler issue. Looking at the test output again:

```
✓ starts implementation run when issue is Running - FAILED
✓ cancels implementation run when issue is Validating - PASSED
✓ cancels implementation run when issue is Done - PASSED
✓ cancels implementation run when issue is Blocked - PASSED
```

All the cancellation tests pass but the start test fails. The cancellation tests work because they cancel the run before trying to acquire the lock. The start test fails because the lock acquisition might be failing.

But wait - `workspaceLockService.isLocked` is available. In the "starts" test, the workspace should be unlocked initially. Let me check if there's something else that locks the workspace.

Actually, let me think about this differently. What if `finalizeAndDrain("nonexistent", workspace.id)` doesn't just release the lock for "nonexistent" but does something else that locks the workspace?

No - `releaseByRunId("nonexistent")` calls `workspaceRepo.releaseLockByRunId("nonexistent")` which does:
```sql
UPDATE workspaces SET lock_state = 'idle', locked_by_run_id = NULL WHERE locked_by_run_id = ?
```

For "nonexistent", no rows are affected, but it's still a valid operation.

Then `startNextQueuedRun` tries to acquire the lock. For the first eligible queued run:
```sql
UPDATE workspaces SET lock_state = 'locked', locked_by_run_id = ? WHERE id = ? AND lock_state = 'idle'
```

If the workspace is idle, this should succeed. But wait - maybe the workspace ISN'T idle. Maybe the workspace was locked by something in the fixture.

In `setupFixture`, the `workspaceService.bind` doesn't lock. The `issueService.create` doesn't lock. The `runRepo.create` with status Completed doesn't lock. The lock should be idle.

Let me just run a quick test to check the lock state before and after.

Actually, you know what, let me just look at the console output more carefully. Maybe the test is hanging on something. But the output says the tests completed (just with failures).

Wait, I see: the entire test suite timed out at 120s. So some tests might be stuck. But the failures I see are actual assertion failures, not timeouts.

Let me focus on fixing the known issues:

1. Recovery test: Fix the tests to expect correct behavior
2. Queue drain test: Investigate why start fails

For the queue drain test, let me check if `prepareAndStart` throws by wrapping the call and checking. Actually, let me just modify the test to check if the run is still queued after finalizeAndDrain.

Actually, I just had another thought. The `run-dispatch.ts` `runService` is the `RunService` instance. Its `listQueuedByWorkspace` method filters by status. But there's something else - the private `startNextQueuedRun` in `run-dispatch.ts` calls `this.runService.listQueuedByWorkspace(workspaceId)`. This is fine.

But `this.runService.transitionToRunning(run.id)` returns the run or null. If it returns null, the catch in startNextQueuedRun... wait, `transitionToRunning` returns a `Run | null` but `startNextQueuedRun` does:
```typescript
let startedRun: Run | null;
try {
  startedRun = this.prepareAndStart(run);
} catch {
  this.workspaceLockService.releaseByRunId(run.id);
  continue;
}
```

The `prepareAndStart` itself might return null if `transitionToRunning` fails. But looking at the code:
```typescript
private prepareAndStart(run: Run): Run | null {
    // ...
    return this.runService.transitionToRunning(run.id);
}
```

If `transitionToRunning` returns null, then `startedRun` is null, and the code does:
```typescript
if (startedRun) {
    // start adapter
} else {
    this.workspaceLockService.releaseByRunId(run.id);
}
```

So if transitionToRunning returns null, the lock is released and the function returns (via `return` at the end... wait, no, there's no `return` after the `if/else`, so it continues to the next iteration? No, looking at:

```typescript
if (startedRun) {
    try {
        await this.startAdapter(startedRun);
    } catch (error) {
        ...
    }
    return; // <-- returns after starting
}
this.workspaceLockService.releaseByRunId(run.id);
```

Wait, if `startedRun` is null, it releases the lock and continues to the next queued run? Actually no, there's no explicit continue, but the function is inside a loop, so it continues to the next iteration naturally. And since `startedRun` is null, it falls through to `releaseByRunId` and then the loop continues.

But why would `transitionToRunning` return null? Looking at the RunService method:
```typescript
transitionToRunning(runId: string): Run | null {
    const now = new Date().toISOString();
    const result = this.runRepo.transitionStatus(runId, RS.Queued, RS.Running, { started_at: now });
    if (!result.success || !result.run) return null;
    // ... write event
    return result.run;
}
```

If the run is not in Queued status, it returns null. But my test creates it with status Queued. So it should work.

OK, I think I need to actually debug this properly. Let me add a simpler test that just checks if the lock can be acquired.

Actually, wait. Let me re-read the test name: "starts implementation run when issue is Running". The test creates a queued implementation run and calls finalizeAndDrain. But the setupFixture ALSO creates a completed implementation run on the same workspace. When finalizeAndDrain is called, the workflowHook tries to process the "nonexistent" run. But what about the completed run from the fixture? That run was created directly, not through the dispatch flow. So its workflow hook was never called.

But that shouldn't matter. The lock should be acquirable.

Let me try a different approach: just use startNextQueuedRun directly from run.ts (the public one) in the tests. But the task says to test run-dispatch.ts...

Actually, let me check if there's something weird happening with the lock. Let me just check the test more carefully by looking at the lock state.

You know what, let me just add a simple debug assertion in the test to check if the lock is available.

Actually, let me try yet another approach. Instead of using `finalizeAndDrain("nonexistent")`, let me use a different strategy to trigger queue drain. I can create a scenario where a run is finalized and triggers the drain.

Or... let me just make `startNextQueuedRun` accessible from tests by adding a public method to `RunDispatchService` or better, testing through the existing `RunService.startNextQueuedRun`.

Wait, but `RunService.startNextQueuedRun` doesn't have the validator checks. The checks are in `run-dispatch.ts`.

Hmm, let me think about this. The task says to verify/extend `startNextQueuedRun` in run-dispatch.ts. While `startNextQueuedRun` is private, we can test it through `finalizeAndDrain`.

But the issue is that `finalizeAndDrain` doesn't work well with a "nonexistent" run ID because... actually, let me look at the error more carefully:

```
× starts implementation run when issue is Running
→ expected undefined to be defined
```

`started` is undefined. Let me trace through the code:

1. `createQueuedImplRun` creates a run with status Queued
2. `finalizeAndDrain("nonexistent", workspace.id)` calls:
   - `developmentTraceService.finalizeRun("nonexistent")` -> throws, caught
   - `workspaceLockService.releaseByRunId("nonexistent")` -> no-op
   - `workflowHook("nonexistent")` -> `runService.get("nonexistent")` throws RUN_NOT_FOUND, caught
   - `startNextQueuedRun(workspace.id)` -> should process queued runs

3. In `startNextQueuedRun`:
   - `runService.listQueuedByWorkspace(workspaceId)` -> should return the queued run
   - `issue = issueRepo.getById(run.issue_id)` -> should find the issue
   - Issue is Running, not Blocked, not Done, not Validating
   - Run is not Validator -> skip validator check
   - `workspaceLockService.acquire(workspaceId, run.id)` -> should succeed

But... wait. Looking at the `run-dispatch.ts` startNextQueuedRun more carefully:

```typescript
private async startNextQueuedRun(workspaceId: string): Promise<void> {
    const queuedRuns = this.runService.listQueuedByWorkspace(workspaceId);
    for (const run of queuedRuns) {
```

`this.runService.listQueuedByWorkspace` is:
```typescript
listQueuedByWorkspace(workspaceId: string): Run[] {
    return this.runRepo.listQueuedByWorkspace(workspaceId);
}
```

And `runRepo.listQueuedByWorkspace`:
```typescript
listQueuedByWorkspace(workspaceId: string): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE workspace_id = ? AND status = 'queued' ORDER BY created_at ASC, id ASC"
    ).all(workspaceId) as RunRow[];
    return rows.map(mapRow);
}
```

This should return the queued run.

OK actually, I wonder if there's a issue with `run-dispatch.ts`'s `startNextQueuedRun` having a different `this.runService` than expected. Let me verify...

Looking at the RunDispatchService constructor:
```typescript
constructor(
    private runService: RunService,
    ...
) {}
```

And in the test setup, the `RunDispatchService` is created with the same `runService` instance. So `this.runService.listQueuedByWorkspace(workspaceId)` should work.

Let me just add a console.log or check the test more carefully. Actually, let me simplify by checking the lock state before and after.

Actually, I just realized something. The `setupFixture` creates:
- A project
- Workspace bound to project
- An issue
- An implementation adapter  
- A validator adapter
- A completed implementation run

But the test creates:
```typescript
createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
```

The `workspace.id` might not match `issue.workspace_id`. Let me check...

In `setupFixture`:
```typescript
const project = services.projectService.create("Test");
services.workspaceService.bind(project.id, tempDir);
const workspace = services.workspaceService.get(project.id)!;
```

The workspace is bound to the project. When `issueService.create` is called, it finds the project's default workspace and sets `workspace_id` on the issue.

So `issue.workspace_id` should equal `workspace.id`. Let me verify by checking `workspaceService.get`:

```typescript
get(projectId: string): Workspace | null {
    const project = this.projectRepo.getById(projectId);
    if (!project) return null;
    return this.workspaceRepo.getById(project.default_workspace_id);
}
```

This returns the workspace by the project's default_workspace_id. And `issueService.create` does:
```typescript
const workspace = this.workspaceRepo.getById(project.default_workspace_id);
```

So both get the same workspace. The IDs should match.

Let me just try a different approach to the test. Instead of debugging the lock issue, let me use `finalizeAndDrain` with a real completed run to trigger the drain. I'll create a second completed run (separate from the fixture one) and use that to trigger the drain.

Actually, let me try the simplest fix first: check if the workspace lock is the issue by testing it.

Let me just rewrite the queue drain tests to use a different approach for triggering the drain. I'll:
1. Create a completed impl run (not from fixture)
2. Manually acquire then release lock for it
3. Then call finalizeAndDrain with that run

Actually wait, looking at the test flow again:

The test creates a queued run via `createQueuedImplRun`. Then calls `finalizeAndDrain("nonexistent", workspace.id)`. Inside `finalizeAndDrain`, the `releaseByRunId("nonexistent")` tries to release a lock for "nonexistent". Since there's no such lock, it does nothing.

But wait - what if `releaseByRunId` is NOT a no-op? Let me check the implementation:

In workspace-lock.ts:
```typescript
releaseByRunId(runId: string): void {
    this.workspaceRepo.releaseLockByRunId(runId);
}
```

In workspace repository:
```typescript
releaseLockByRunId(runId: string): void {
    this.db.prepare(
      "UPDATE workspaces SET lock_state = 'idle', locked_by_run_id = NULL WHERE locked_by_run_id = ?"
    ).run(runId);
}
```

This is an UPDATE that affects 0 rows if no matching run. So it's a no-op. Good.

Let me try another approach. Maybe the issue is simpler than I think - maybe `finalizeAndDrain` has some issue with the async/sync boundaries. Let me just test directly if startNextQueuedRun in run.ts works for running the implementation run. If it does, the issue is in the run-dispatch.ts drain flow. If it doesn't, the issue is elsewhere.
Let me debug the queue drain test failure:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [31m×[39m tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mimplementation run eligibility[2m > [22mstarts implementation run when issue is Running[32m 192[2mms[22m[39m
[31m   → expected undefined to be defined[39m
 [32m✓[39m tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mimplementation run eligibility[2m > [22mcancels implementation run when issue is Validating[32m 177[2mms[22m[39m
 [32m✓[39m tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mimplementation run eligibility[2m > [22mcancels implementation run when issue is Done
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:11:53Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\queue-drain-eligibility.test.ts", "oldString": "  describe(\"implementation run eligibility\", () => {\n    it(\"starts implementation run when issue is Running\", async () => {\n      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);\n      createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);\n\n      await services.runDispatchService.finalizeAndDrain(\"nonexi
…[truncated])`


> [reasoning] The runs remain in "queued" status. This means `startNextQueuedRun` in `run-dispatch.ts` is either:
1. Not finding the queued runs
2. Not able to acquire the lock
3. `prepareAndStart` returns null

Let me check what happens. Let me simplify the test to check the lock state.

Actually, I bet the issue is that the `issue.workspace_id` doesn't equal `workspace.id` in my test setup. Let me check:

In `setupFixture`:
```typescript
const project = services.projectService.create("Test");
services.workspaceService.bind(project.id, tempDir);
const workspace = services.workspaceService.get(project.id)!;
```

But `workspaceService.get()` returns the workspace from `project.default_workspace_id`. And `issueService.create()` also uses `project.default_workspace_id`. So they should match.

But wait - the issue is that the test calls `finalizeAndDrain("nonexistent", workspace.id)` where `workspace.id` comes from `services.workspaceService.get(project.id)!.id`. The queued run has `workspace.id` (from `createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, ...)`).

Inside `startNextQueuedRun`, `this.runService.listQueuedByWorkspace(workspaceId)` queries `WHERE workspace_id = ? AND status = 'queued'`. The workspace ID used is `workspaceId` which comes from `finalizeAndDrain`'s parameter. Since the test passes `workspace.id` (same as the queued run's workspace), the query should find the run.

Let me debug by adding a console.log or by testing the lock state:

Actually, let me just add a quick debug test.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:12:05Z

- **tool**: `grep({"include": "adapter-registry.ts", "pattern": "getForConfig", "output_mode": "content", "head_limit": 10})`


> [reasoning] Wait, let me think about this differently. The cancellation tests PASS - so `finalizeAndDrain("nonexistent", workspace.id)` DOES process the queue. The impl run with Validating issue gets cancelled. So the queue drain is working.

But for the start tests (Running issue), the run stays in "queued". This means the lock acquisition fails.

Let me check - maybe the workspace is locked from the fixture. The fixture creates a completed implementation run directly via `runRepo.create`. This doesn't go through the dispatch flow, so no lock is ever acquired.

Wait, but maybe the issue is that `issueService.create` somehow acquires the lock? Let me check... No, issueService.create doesn't touch locks.

Actually, wait. Let me look at the fixture again:

```typescript
function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const workspace = services.workspaceService.get(project.id)!;
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  // ...
  return { project, issue, implAdapter, workspace };
}
```

And then in the test:
```typescript
const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
expect(services.workspaceLockService.isLocked(workspace.id)).toBe(false);
```

Wait - `expect(services.workspaceLockService.isLocked(workspace.id)).toBe(true)` - let me check if the lock is really false.

Actually, wait - the workspace was bound with `bind(project.id, tempDir)`. Does `bind` check anything about locks? Let me check the workspaceService.bind...

Actually, the issue might be that `workspace.id` is not the same as `issue.workspace_id`. The fixture uses `workspaceService.get(project.id)` which returns the workspace from `project.default_workspace_id`. And `issueService.create` gets the same workspace from `project.default_workspace_id`. So `issue.workspace_id` should equal `workspace.id`.

But wait, the `startNextQueuedRun` is called with `workspace.id` as the parameter, and it queries runs by `workspace_id`. So the queued runs must match.

Hmm, actually, I just realized - the `startNextQueuedRun` in `run-dispatch.ts` uses `this.runService.listQueuedByWorkspace(workspaceId)`. But `this.runService` is a `RunService` instance. Looking at `RunService.listQueuedByWorkspace`:

```typescript
listQueuedByWorkspace(workspaceId: string): Run[] {
    return this.runRepo.listQueuedByWorkspace(workspaceId);
}
```

And in RunRepository:
```typescript
listQueuedByWorkspace(workspaceId: string): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE workspace_id = ? AND status = 'queued' ORDER BY created_at ASC, id ASC"
    ).all(workspaceId) as RunRow[];
    return rows.map(mapRow);
}
```

So it queries by `workspace_id`. All my runs are created with the same `workspace_id` = `workspace.id`.

I'm confused. The cancellation tests work but the start tests don't. Let me add more debug assertions to understand what state the test is in.

Actually, let me check a simpler theory: maybe `prepareAndStart` throws? Let me look at `prepareAndStart` again:

```typescript
private prepareAndStart(run: Run): Run | null {
    const workspace = this.workspaceRepo.getById(run.workspace_id);
    if (!workspace) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found.");
    }
    const adapterConfig = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!adapterConfig) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }
    const adapter = this.adapterRegistry.getForConfig(adapterConfig);
    const traceCapability = adapter.capabilities.supportsStructuredTrace
      ? CommandTraceCapability.Supported
      : CommandTraceCapability.Unsupported;
    try {
      this.developmentTraceService.prepareRun({ run, workspace, traceCapability });
    } catch {
      // baseline failure does not prevent Run
    }
    return this.runService.transitionToRunning(run.id);
}
```

If `adapterConfig` is null, this throws. But `createQueuedImplRun` uses `implAdapter.id` from the fixture, which is a valid adapter.

Actually, wait. Let me check if `prepareRun` might throw an UNCAUGHT error that goes through `catch` but then `transitionToRunning` returns null for some reason.

Or maybe the adapter registry doesn't have a matching adapter? Let me check...

The adapter registry has `FakeAgentAdapter` registered. The adapter config has `cli_provider: "codex"`. `getForConfig` looks up by cli_provider. For "codex", it would find... wait, the test helper only registers `FakeAgentAdapter`:

```typescript
const adapterRegistry = new AgentAdapterRegistry();
adapterRegistry.register(new FakeAgentAdapter());
```

And looking at `FakeAgentAdapter`:
```typescript
export class FakeAgentAdapter implements AgentAdapter {
    readonly id = "fake";
    readonly name = "Fake Adapter";
    readonly cliProvider = "fake"; // <-- not "codex"!
```

So the adapter in the test has `cli_provider: "codex"` which would match `CodexCliAdapter`. But in the test helpers, only `FakeAgentAdapter` is registered! Wait, no, let me check...

In `createTestServices`:
```typescript
const adapterRegistry = new AgentAdapterRegistry();
adapterRegistry.register(new FakeAgentAdapter());
```

Only `FakeAgentAdapter` is registered. The `FakeAgentAdapter` has `cliProvider = "fake"`.

But the adapter config created in `setupFixture` has `cli_provider: "codex"`. So when `startNextQueuedRun` -> `prepareAndStart` -> `this.adapterRegistry.getForConfig(adapterConfig)` is called, it looks for an adapter with `cli_provider = "codex"`. But only "fake" is registered!

Let me check `getForConfig`:
```typescript
getForConfig(config: AgentConfig): AgentAdapter {
    const adapter = this.adapters.find(a => a.cliProvider === config.cli_provider);
    if (!adapter) throw new Error(...);
    return adapter;
}
```

Wait, does it throw? Let me check.

Let me look at the adapter registry implementation.

  <details><summary>tool output</summary>

  ```text
Found 1 match(es) in 1 file(s)

D:\Projects\personahub\server\src\runtime\adapter-registry.ts
  14: getForConfig(adapterConfig: { cli_provider: string }): AgentAdapter {

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
- Agents ca
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:12:22Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapter-registry.ts"})`


> [reasoning] Let me read adapter-registry.ts to see if getForConfig throws or returns something.

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
6:   register(adapter: AgentAdapter): void {
7:     this.adapters.set(adapter.provider, adapter);
8:   }
9: 
10:   getByProvider(provider: string): AgentAdapter | undefined {
11:     return this.adapters.get(provider);
12:   }
13: 
14:   getForConfig(adapterConfig: { cli_provider: string }): AgentAdapter {
15:     const adapter = this.adapters.get(adapterConfig.cli_provider);
16:     if (!adapter) {
17:       throw new Error(`No adapter registered for provider: ${adapterConfig.cli_provider}`);
18:     }
19:     return adapter;
20:   }
2
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:12:28Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\queue-drain-eligibility.test.ts", "oldString": "function setupFixture(services: TestServices, tempDir: string) {\n  const project = services.projectService.create(\"Test\");\n  services.workspaceService.bind(project.id, tempDir);\n  const workspace = services.workspaceService.get(project.id)!;\n  const { issue } = services.issueService.create(project.id, { title: \"T\", goal: \"G\" });\n  services.issueRepo.updateStatus(issue.id
…[truncated])`


> [reasoning] `getForConfig` throws an Error if the adapter is not found! The test fixture creates an adapter with `cli_provider: "codex"` but the test helper only registers `FakeAgentAdapter` with `provider: "fake"`.

So when `startNextQueuedRun` calls `prepareAndStart`, which calls `adapterRegistry.getForConfig(adapterConfig)`, it throws because there's no "codex" adapter registered.

Wait, but the cancellation tests work because they cancel the run BEFORE `prepareAndStart` is called. The cancellation happens in the eligibility check section, not in the start section.

This explains all the failures:
1. Implementation run start: getForConfig throws -> caught -> lock released -> continue -> no more queued runs -> function returns -> run stays queued
2. Validator run start: same issue
3. Ordering: same issue

But wait, in the validator test I use the correct adapter from fixture:
```typescript
const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
```

And the queued validator run uses `valAdapter.id`:
```typescript
const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);
```

The `valAdapter` also has `cli_provider: "codex"`. So same issue.

The fix: I need to use `cli_provider: "fake"` for the adapter configs, or register the `CodexCliAdapter` in the test helpers.

Actually, wait. Looking at the test helper more carefully:
```typescript
const adapterRegistry = new AgentAdapterRegistry();
adapterRegistry.register(new FakeAgentAdapter());
```

`FakeAgentAdapter` has `provider: "fake"`. So I need to create adapter configs with `cli_provider: "fake"` in the tests.

But the fixture already creates adapters with `cli_provider: "codex"`. The existing validation workflow tests pass because they call `requestValidation` directly, not through the dispatch flow. And `requestValidation` creates a validator run but doesn't try to start it (it stays in Queued status). The start happens via `startNextQueuedRun` in `run-dispatch.ts`.

So for my queue drain tests, I need to use `cli_provider: "fake"` for the adapter configs so that `getForConfig` finds the `FakeAgentAdapter`.

Let me fix the setup fixture and the test.
Found the issue - the adapter registry only has `FakeAgentAdapter` (`provider: "fake"`), but the test fixtures use `cli_provider: "codex"`. The cancellation tests pass (they don't reach `prepareAndStart`), but the start tests fail because `getForConfig` throws. Let me fix the fixture to use `"fake"` provider:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:12:42Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx -w @personahub/server vitest run tests/integration/queue-drain-eligibility.test.ts --reporter=verbose 2>&1", "timeout": 60000})`


> [reasoning] Also need to update the `createQueuedImplRun` and `createQueuedValidatorRun` helpers to use the same adapter identity format. Let me check... the `adapter_identity` in those functions uses the same `adapter_config_id` and `name` but the `cli_provider` needs to match. Actually the identity is just a snapshot, it doesn't affect the registry lookup. The registry lookup uses the `adapter_config_id` -> config -> `cli_provider`. So as long as the adapter config has `cli_provider: "fake"`, the registry will find it.

Wait, actually no. The `startNextQueuedRun` in `run-dispatch.ts` does:
```typescript
const adapterConfig = this.agentConfigRepo.getById(run.adapter_config_id);
```

This gets the config from the DB. The config has `cli_provider: "fake"`. Then:
```typescript
const adapter = this.adapterRegistry.getForConfig(adapterConfig);
```

This looks up the adapter by `cli_provider`. Since we set `cli_provider: "fake"` and `FakeAgentAdapter` is registered with `provider: "fake"`, it should work.

Good, the test should now pass for starting. Let me also fix the identity in the create helpers to match (though it shouldn't matter for the start test):

Actually no, let me just run the test to see if the fix works.

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m✓[39m tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mimplementation run eligibility[2m > [22mstarts implementation run when issue is Running[33m 310[2mms[22m[39m
 [32m✓[39m tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mimplementation run eligibility[2m > [22mcancels implementation run when issue is Validating[32m 122[2mms[22m[39m
 [32m✓[39m tests/integration/queue-drain-eligibility.test.ts[2m > [22mQueue drain eligibility (T062)[2m > [22mimplementation run eligibility[2m > [22mcancels implementation run when issue is Done[32m 167[2mms[22m[39m
 [32m✓[39m tests/int
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:13:00Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\validation\\recovery-service.ts", "oldString": "  private reconcileStuckValidating(): void {\n    const stuckIssues = this.issueRepo.listValidatingWithoutActiveValidator();\n    for (const issue of stuckIssues) {\n      if (!issue.primary_thread_id) continue;\n      if (this.findLatestTerminalValidator(issue.id)) continue;\n      const requestedEvent = this.findValidationRequestedEvent(issue);\n      if (requestedEvent) {\n        co
…[truncated])`


> [reasoning] All 10 T062 tests pass. Now let me fix the T060 recovery test failures. The issues were:

1. "skips issue with no completed implementation run" - The fixture creates a completed impl run, so the recovery will find it and request validation. The issue transitions to Validating. I need to fix the test to expect Validating.

2. "requests validation when no requested event and latest impl completed run exists" - The fixture creates a completed impl run. The issue is set to Validating manually. The recovery finds the stuck issue (Validating, no active validator, no terminal validator). Since there's no requested event but there IS a completed impl, it calls requestValidation. But requestValidation returns null because issue is Validating. Need to fix the recovery logic.

3. "blocks issue when no requested event and no completed impl run" - The fixture creates a completed impl run. The test expects non-existing impl but the fixture always creates one. Need to fix the test.

Let me think about the correct approach:

For the recovery service, case 3 (Validating without active/terminal validator):
- **If requested event exists**: rebuild validator (already handled)
- **If no requested event but completed impl exists**: This is a data inconsistency. The issue shouldn't be Validating without a requested event. But to be safe, I should try to recover. Since `requestValidation` won't work (issue is Validating), I should CAS the issue back to Running and then call requestValidation.
- **If no requested event and no completed impl**: This is a full data inconsistency. Block.

Actually wait, let me re-read the test case more carefully:

Test "requests validation when no requested event and latest impl completed run exists":
```typescript
const { issue, implRun } = setupFixture(services, tempDir);
services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
```

SetupFixture creates a completed impl run (implRun). Then issue is set to Validating. Then recovery runs. The stuck case 3 finds it. Since there's no requested event, it should... well, it's not clear what the best recovery is. But since the issue is Validating (meaning someone intended validation to happen), and there's a completed impl run, the recovery should try to kick off validation.

The simplest approach: in the recovery service, for case 3 with no requested event but a completed impl run, I'll CAS the issue from Validating back to Running and then call requestValidation. This is a recovery-only operation.

But wait - this might be dangerous. Let me think about when this scenario could happen:

1. Server crashes during `requestValidation` AFTER the issue status CAS (Running -> Validating) but BEFORE the `validation.requested` event write. But these are in the same transaction! So if the CAS succeeds, the event write also succeeds. This scenario can't happen with SQLite transactions.

2. Some manual DB operation sets the issue to Validating. This shouldn't happen in practice.

So this is a data inconsistency case. The safest recovery is to block with RecoveryInconsistent. Let me update the recovery service:

For case 3, "no requested event":
- If completed impl exists: Block with RecoveryInconsistent (data inconsistency)
- If no completed impl: Block with RecoveryInconsistent

Let me also fix the test. The test "requests validation when no requested event and latest impl completed run exists" should expect Blocked instead.

And the test "skips issue with no completed implementation run" - I need to understand what this tests. The fixture always creates a completed impl run. So the recovery service will always find one and request validation. The test expects the issue to stay in Running. But since there IS a completed impl run, the recovery will call requestValidation and the issue will go to Validating.

The test name says "skips" - but the recovery shouldn't skip. Let me change the test to expect the recovery to process it (move to Validating) OR change the test to not have a completed impl run.

Looking at the test:
```typescript
it("skips issue with no completed implementation run", async () => {
    const { issue } = setupFixture(services, tempDir);
    services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
    const recovery = createRecoveryService(services);
    await recovery.reconcile();
    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Running);
});
```

The problem is that `setupFixture` creates a completed impl run. So the test can't test "no completed implementation run". Let me change the setup to avoid creating a completed impl run, OR remove this test.

Actually, the simplest fix: just remove the completed impl run from the DB before running recovery. Or use a fresh issue without a completed impl run.

Let me change the test to delete the impl run before running recovery.

OK, let me plan the fixes:

1. Fix recovery service case 3 (no requested event): instead of calling requestValidation (which won't work), block with RecoveryInconsistent.

2. Fix test "skips issue with no completed implementation run": delete the impl run before calling reconcile.

3. Fix test "requests validation when no requested event and latest impl completed run exists": expect Blocked instead of Validating.

4. Fix test "blocks issue when no requested event and no completed impl run": delete the impl run before calling reconcile.

Actually, for test 4, I also need to think. If I delete the impl run AND the issue is Validating without requested event, the recovery should block it. Let me adjust.

Let me fix the recovery service first.
Now let me fix the recovery service for case 3 when there's no requested event. Since the issue is Validating, calling `requestValidation` won't work (it returns null for non-Running issues). The correct approach is to block with `RecoveryInconsistent`:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:13:23Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"skips issue with no completed implementation run\", async () => {\n      const { issue } = setupFixture(services, tempDir);\n      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });\n\n      const recovery = createRecoveryService(services);\n      await recovery.reconcile();\n\n      expect(services.issueRepo.getByI
…[truncated])`


> [reasoning] Now I need to fix the failing tests. Let me update the test file:

1. "skips issue with no completed implementation run" - Need to remove the completed impl run from the fixture
2. "requests validation when no requested event and latest impl completed run exists" - Should expect Blocked since there's no requested event but issue is Validating
3. "blocks issue when no requested event and no completed impl run" - Should also expect Blocked

Let me fix these tests.
Now let me fix the failing tests:

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:13:32Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"requests validation when no requested event and latest impl completed run exists\", async () => {\n      const { issue, implRun } = setupFixture(services, tempDir);\n      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);\n\n      const recovery = createRecoveryService(services);\n      await recovery.reconcile();\n\n      expect(se
…[truncated])`


> [reasoning] Now fix the "requests validation when no requested event" test. Since there's no requested event and the issue is Validating, the recovery should block it with RecoveryInconsistent. Let me update the test to expect Blocked.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:13:41Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"blocks issue when no requested event and no completed impl run\", async () => {\n      const { issue } = setupFixture(services, tempDir);\n      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);\n\n      const recovery = createRecoveryService(services);\n      await recovery.reconcile();\n\n      expect(services.issueRepo.getById(is
…[truncated])`


> [reasoning] Now fix the third test - "blocks issue when no requested event and no completed impl run":

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:13:50Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "offset": 185, "limit": 10})`


> [reasoning] Also, I need to remove the unused `implRun` variable in the "blocks issue when no requested event exists for Validating issue" test. Let me check the latest state of the file.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\validation-recovery.test.ts</path>
<type>file</type>
<content>
185:     });
186: 
187:     it("blocks issue when no requested event exists for Validating issue", async () => {
188:       const { issue, implRun } = setupFixture(services, tempDir);
189:       services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
190: 
191:       const recovery = createRecoveryService(services);
192:       await recovery.reconcile();
193: 
194:       expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);

(Showing lines 185-194 of 246. Use offset=195 to continue.)
</content>
  ```
  </details>

## assistant · 2026-07-18T18:13:56Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-recovery.test.ts", "oldString": "    it(\"blocks issue when no requested event exists for Validating issue\", async () => {\n      const { issue, implRun } = setupFixture(services, tempDir);", "newString": "    it(\"blocks issue when no requested event exists for Validating issue\", async () => {\n      const { issue } = setupFixture(services, tempDir);"})`


> [reasoning] Line 188 has `{ issue, implRun }` - `implRun` is unused. Let me remove it.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:14:04Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx -w @personahub/server vitest run tests/integration/validation-recovery.test.ts --reporter=verbose 2>&1", "timeout": 60000})`


> [reasoning] Let me also need to remove the unused `implRun` on the last fixed test as well... wait, I already wrote:
```
const { issue, implRun } = setupFixture(services, tempDir);
services.db.prepare("DELETE FROM runs WHERE id = ?").run(implRun.id);
```
That's used. Let me run the tests now to see if they pass.
Now let me run the recovery tests:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m✓[39m tests/integration/validation-recovery.test.ts[2m > [22mValidationRecoveryService (T060-T061)[2m > [22mT060-1: Completed implementation + Issue Running + no validation[2m > [22mcalls requestValidation when impl completed but no validation requested[32m 184[2mms[22m[39m
 [32m✓[39m tests/integration/validation-recovery.test.ts[2m > [22mValidationRecoveryService (T060-T061)[2m > [22mT060-1: Completed implementation + Issue Running + no validation[2m > [22mdoes not request validation again when already requested[32m 170[2mms[22m[39m
 [32m✓[39m tests/integration/validation-recovery.test.ts[2m > [22mValidationRecoveryService (T060-T061)[2m > [22mT060-1: Completed implementat
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:14:20Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npx -w @personahub/server vitest run 2>&1", "timeout": 180000})`


> [reasoning] All 13 recovery tests pass! Now let me run ALL tests to make sure nothing is broken.
All recovery tests pass. Now let me run the full test suite:

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

[90mstderr[2m | tests/integration/git-scanner.test.ts
[22m[39mUsing an object as a third argument is deprecated. Vitest 4 will throw an error if the third argument is not a timeout number. Please use the second argument for options. See more at https://vitest.dev/guide/migration

 [32m✓[39m tests/integration/git-scanner.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 14293[2mms[22m[39m
   [33m[2m✓[22m[39m Git Workspace Scanner (T026)[2m > [22mcaptures clean baseline after commit [33m 2041[2mms[22m[39m
   [33m[2m✓[22m[39m Git Workspace Scanner (T026)[2m > [22mdetects added file in final snapshot [33m 2592[2mms[22m[39m
   [33m[2m✓[22m[39m Git Workspace Scanner (T026)[2m > [
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:17:17Z

- **tool**: `todowrite({"todos": [{"priority": "high", "content": "Read all prerequisite files (design doc, existing services, repos, tests)", "status": "completed"}, {"priority": "high", "content": "T060: Write integration test for ValidationRecoveryService", "status": "completed"}, {"priority": "high", "content": "T061: Implement ValidationRecoveryService", "status": "completed"}, {"priority": "high", "content": "Register recoveryService.reconcile() in server/src/index.ts", "status": "completed"}, {"priority": "high
…[truncated])`


> [reasoning] All 906 tests pass (1 skipped, which is pre-existing). 65 test files all pass.

Now let me update the tasks.md to mark T060-T062 as completed.
All 906 tests pass. Let me now update the tasks.md to mark T060-T062 as completed:

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Read all prerequisite files (design doc, existing services, repos, tests)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T060: Write integration test for ValidationRecoveryService",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T061: Implement ValidationRecoveryService",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Register recoveryService.reconcile() in server/src/index.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T062: Verify/extend startNextQueuedRun eligibility checks + tests",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Run typecheck and all tests - must pass",
    "status": "completed",
    "priority": "high"

…[truncated]
  ```
  </details>

## assistant · 2026-07-18T18:17:24Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md", "oldString": "- [ ] **T060**（`NFR-001`, `NFR-003`）：添加startup recovery测试，覆盖completed implementation未request、terminal validator未result、Validating无active、result transaction上次失败和重复restart；断言recovery从`validation.requested`读取固化的`implementation_run_id`与policy snapshot/hash，并从Run读取identity snapshot，不用latest/current config/policy重新推导。\n- [ ] **T061**（`NFR-001`）：实现ValidationRecoveryService，并在F003 recovery后、
…[truncated])`


> [reasoning] Let me update the tasks.md to mark T060-T062 as completed.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T18:17:35Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub && npm run typecheck 2>&1", "timeout": 60000})`
- **tool**: `bash({"command": "cd D:\\Projects\\personahub && Get-ChildItem -Path \"server/src/services/validation/recovery-service.ts\", \"server/tests/integration/validation-recovery.test.ts\", \"server/tests/integration/queue-drain-eligibility.test.ts\", \"server/src/services/run-dispatch.ts\", \"server/src/repositories/run.ts\", \"server/src/repositories/issue.ts\", \"server/src/index.ts\" | Select-Object Name, @{N=\"Lines\";E={(Get-Content $_.FullName | Measure-Object -Line).Lines}} 2>&1"})`


> [reasoning] Let me verify all changes are consistent by doing a final typecheck and verifying the file sizes are under 350 lines.
Let me do a final typecheck and verify file sizes:

  <details><summary>tool output</summary>

  ```text
> typecheck
> npm -w @personahub/server run typecheck && npm -w @personahub/web run typecheck


> @personahub/server@0.1.0 typecheck
> tsc --noEmit


> @personahub/web@0.1.0 typecheck
> tsc --noEmit
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
[32;1mName                           [0m[32;1m Lines[0m
[32;1m----                           [0m [32;1m-----[0m
recovery-service.ts               133
validation-recovery.test.ts       201
queue-drain-eligibility.test.ts   131
run-dispatch.ts                   298
run.ts                            184
issue.ts                          163
index.ts                          170
  ```
  </details>

## assistant · 2026-07-18T18:17:49Z


> [reasoning] Wait, the `run.ts` showed up (it wasn't in my Get-ChildItem filter)... Let me check the actual paths. Let me look at the run.ts (184 lines) which is the RunService. And I also modified the run repository (it shows 184 lines because "run.ts" could be pointing to the service, not the repo).

Wait, the file `run.ts` is showing 184 lines. Let me check: the paths I specified were correct but `run.ts` matches two things: `server/src/repositories/run.ts` and `server/src/services/run.ts`. The `Get-ChildItem` found `server/src/services/run.ts` first.

Regardless, all the files are well under 350 lines. Typecheck passes. Everything looks good.

Let me do a final summary:

## Summary

### T060: Test file created
- `server/tests/integration/validation-recovery.test.ts` (201 lines) - 13 tests covering:
  - Completed implementation + Running issue + no validation -> requestValidation called
  - Terminal validator + Validating issue + no result -> processValidatorResult called
  - Validating issue + no active/terminal validator -> rebuild validator or Blocked
  - Multiple restarts -> no duplicate events (idempotent)
  - Recovery reads from validation.requested event

### T061: Implementation created
- `server/src/services/validation/recovery-service.ts` (133 lines) - `ValidationRecoveryService` with:
  - `reconcile()` method calling 3 recovery paths
  - `reconcileUnrequestedImplementations()` - Running issues with completed impl runs that lack validation
  - `reconcileTerminalValidators()` - Validating issues with terminal validator runs needing processing
  - `reconcileStuckValidating()` - Validating issues with no validator at all (rebuild or Block)
  - `rebuildValidatorForIssue()` - Creates validator run when validation was interrupted
  - `blockIssueInRecovery()` - Blocks issue with recovery inconsistent reason

### Registration in index.ts
- `ValidationRecoveryService` instantiated and `reconcile()` called after `staleRecoveryService.runAll()` and before HTTP listen

### T062: Queue drain eligibility
- Extended `run-dispatch.ts` `startNextQueuedRun()` with:
  - Validator must be in Validating issue, with matching round
  - If not, cancelled with `issue_state_changed_before_start`
- Created `server/tests/integration/queue-drain-eligibility.test.ts` (131 lines) - 10 tests covering:
  - Implementation run: starts in Running, cancelled in Validating/Done/Blocked
  - Validator run: starts in Validating+correct round, cancelled in Running/wrong round/Done/Blocked
  - Ordering: continues scanning after cancelling ineligible run

### Repository additions
- `IssueRepository.listByStatus()` - query issues by status
- `RunRepository.getLatestTerminalByRole()` - get latest terminal run by role

All 906 tests pass, typecheck passes, all files under 350 lines.
All checks pass. Here's a summary of the implementation:

---

**T060** - `server/tests/integration/validation-recovery.test.ts` (201 lines)
- 13 tests covering all recovery scenarios: unrequested implementations, terminal validators without processed results, stuck Validating issues (rebuild or Blocked), idempotent restarts, and reading from `validation.requested` event

**T061** - `server/src/services/validation/recovery-service.ts` (133 lines)
- `ValidationRecoveryService.reconcile()` orchestrates 3 recovery paths:
  1. `reconcileUnrequestedImplementations()` - Running issues with completed impl runs → calls `requestValidation`
  2. `reconcileTerminalValidators()` - Validating issues with terminal validator runs → calls `processValidatorResult`
  3. `reconcileStuckValidating()` - Validating issues with no validator → rebuilds or blocks with `RecoveryInconsistent`
- Registered in `index.ts` after `staleRecoveryService.runAll()`, before server listen

**T062** - Queue drain eligibility
- Extended `run-dispatch.ts` `startNextQueuedRun()` with validator-specific checks: only starts when issue is Validating and `validation_round` matches current round
- Created `server/tests/integration/queue-drain-eligibility.test.ts` (131 lines) with 10 tests covering all eligibility scenarios for both implementation and validator runs

**Repository additions:**
- `IssueRepository.listByStatus()` - queries issues by any status
- `RunRepository.getLatestTerminalByRole()` - gets latest terminal run (completed/failed/cancelled/interrupted) by role
