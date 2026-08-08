---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_09a0eecdeffe70hwEay5B1OEYl"
title: "Verify new review findings against code (@explore subagent)"
project: "D:/Projects/personahub"
model: "deepseek-v4-flash"
created_at: "2026-07-15T13:22:05Z"
updated_at: "2026-07-15T13:23:52Z"
tokens_input: 33550
tokens_output: 4505
cost: 0.0076
parent_id: "ses_09a38fe8dffe0nAEqjgf8qLRFQ"
---

# Verify new review findings against code (@explore subagent)

## user · 2026-07-15T13:22:05Z

I need to verify several code review findings against the actual PersonaHub codebase. Please check each claim below and report CONFIRMED or NOT CONFIRMED with evidence.

[CONTEXT]: Two code reviews identified new issues in F002 after recent fixes. I need to verify which findings are accurate.

[GOAL]: Determine which findings are real bugs that need fixing.

[REQUEST]: Read the following files and verify these specific claims:

1. **Escalation double-drain**: In `server/src/runtime/agent-runner.ts` handleExit method, when escalation is detected, does it call BOTH `onEscalation(params)` AND `onTerminal?.(run.id, workspaceId)`? And does `server/src/services/run-dispatch.ts` onEscalation method ALSO call `this.onRunTerminal()` at the end? If both, onRunTerminal is called twice.

2. **Cancel running Run doesn't drain queue**: In `server/src/services/run-dispatch.ts` cancel method, when run.status is Running, does it only call `this.agentRunner.cancelRun(runId)` without calling `onRunTerminal` or `startNextQueuedRun`? And in `server/src/runtime/agent-runner.ts` cancelRun method, does it skip calling onTerminal?

3. **turn/completed always success**: In `server/src/runtime/adapters/codex-cli-adapter.ts`, does the turn/completed handler always call `finish({ exitCode: 0, failureReason: null, errorMessage: null })` without checking `msg.params?.turn?.status`? The real protocol can send status="failed" or "interrupted".

4. **JSON-RPC startup errors swallowed**: In `server/src/runtime/adapters/codex-cli-adapter.ts`, does the initialize/thread/start/turn/start chain end with `.catch(() => { void 0; })` - silently swallowing protocol errors without calling finish() or callExit()?

5. **HOME redirect breaks Codex auth**: In `server/src/runtime/workspace-context.ts`, when push_credentials_enabled is false, does buildChildEnv set HOME/USERPROFILE to workspace.local_path? Would this prevent Codex CLI from finding ~/.codex/auth.json?

6. **Post-hoc escalation on agent message text**: In `server/src/runtime/adapters/codex-cli-adapter.ts`, does the `item/agentMessage/delta` handler run `isGitPushOutput(delta)` on the model's natural language output, potentially false-triggering escalation when the model merely mentions "git push" in conversation?

7. **Context assembly incomplete**: In `server/src/services/run-dispatch.ts` startAdapter method, is the context only `issue?.goal ?? ""` - missing Issue title, workspace path, thread ID, run ID as required by design.md?

8. **Adapter form stale state**: In `web/src/components/adapter/AdapterSettings.tsx`, does the edit dialog use useState initializers that don't update when editingAdapter prop changes? Is there no useEffect to sync form state when the dialog opens?

9. **Lock acquisition not atomic**: In `server/src/services/run-dispatch.ts` dispatch method and `server/src/services/run.ts` startNextQueuedRun, are lock acquisition and Run status transition done in separate operations (not in one transaction)?

10. **Broadcast before commit**: In `server/src/services/thread-event.ts` writeAndBroadcast, is eventBus.publish called immediately after the DB insert, potentially inside an outer db.transaction? Check if callers like run-dispatch.ts onEscalation wrap writeAndBroadcast in db.transaction.

For each claim, read the relevant code and report: CONFIRMED or NOT CONFIRMED with the actual code snippet as evidence.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-07-15T13:22:05Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\agent-runner.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\workspace-context.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\thread-event.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run.ts"})`


> [reasoning] The user wants me to verify 10 specific code review findings against the PersonaHub codebase. Let me analyze each claim and read the relevant files to confirm or not confirm them.

Let me start by reading all the files mentioned in parallel.
<analysis>
**Literal Request**: Verify 10 specific code review claims against the codebase by reading files and reporting CONFIRMED/NOT CONFIRMED with evidence.
**Actual Need**: Determine which findings are real bugs needing fixes vs false positives, so the team can prioritize remediation.
**Success Looks Like**: For each of the 10 claims, a definitive verdict backed by exact code snippets from the actual files.
</analysis>

Let me start by reading all the key files in parallel:

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\agent-runner.ts</path>
<type>file</type>
<content>
1: import type { Run, FailureReason, AdapterConfig, Workspace } from "@personahub/shared/types";
2: import { FailureReason as FR, ThreadEventType, ActorType } from "@personahub/shared/types";
3: import type { AgentAdapter, RunHandle, RunOutputChunk, RunExitResult, AgentRunInput } from "./types.js";
4: import { DEFAULT_EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES, MAX_CHUNK_BYTES } from "./types.js";
5: import type { RunService } from "../services/run.js";
6: import type { ThreadEventService } from "../services/thread-event.js";
7: import type { WorkspaceLockService } from "../services/workspace-lock.js";
8: import { buildWorkspaceContext } from "./workspace-context.js";
9: 
10: interface ActiveRun 
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\run-dispatch.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, FailureReason, IssueStatus } from "@personahub/shared/types";
3: import { IssueStatus as IS, RunStatus as RS, ThreadEventType, ActorType } from "@personahub/shared/types";
4: import { ErrorCode } from "@personahub/shared/errors";
5: import type { RunService } from "./run.js";
6: import type { WorkspaceLockService } from "./workspace-lock.js";
7: import type { ThreadEventService } from "./thread-event.js";
8: import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
9: import type { AgentRunner, EscalationParams } from "../runtime/agent-runner.js";
10: import type { AgentConfigRepository } from "../reposito
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\adapters\codex-cli-adapter.ts</path>
<type>file</type>
<content>
1: import { spawn, type ChildProcess } from "node:child_process";
2: import type { AdapterConfig, FailureReason } from "@personahub/shared/types";
3: import { FailureReason as FR } from "@personahub/shared/types";
4: import type {
5:   AgentAdapter,
6:   AgentAdapterCapabilities,
7:   AgentRunInput,
8:   AdapterValidationResult,
9:   RunHandle,
10:   RunOutputChunk,
11:   RunExitResult,
12: } from "../types.js";
13: import { DEFAULT_EXECUTION_TIMEOUT_MS, CANCEL_TIMEOUT_MS } from "../types.js";
14: import { buildChildEnv } from "../workspace-context.js";
15: import { spawnSync } from "node:child_process";
16: 
17: const GIT_PUSH_PATTERNS = [
18:   /\bgit\s+push\b/,
19:   /\bgit\s
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\workspace-context.ts</path>
<type>file</type>
<content>
1: import type { Workspace } from "@personahub/shared/types";
2: import type { WorkspaceContext } from "./types.js";
3: 
4: export function buildWorkspaceContext(workspace: Workspace): WorkspaceContext {
5:   return {
6:     workspaceId: workspace.id,
7:     localPath: workspace.local_path,
8:     gitBranch: workspace.git_branch,
9:     pushCredentialsEnabled: workspace.push_credentials_enabled,
10:   };
11: }
12: 
13: interface CredentialIsolationInput {
14:   push_credentials_enabled: boolean;
15:   local_path: string;
16: }
17: 
18: export function buildChildEnv(workspace: CredentialIsolationInput): Record<string, string> {
19:   if (workspace.push_credentials_enabled) {
20:     retur
…[truncated]
  ```
  </details>

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
11:   writeAndBroadcast(
12:     threadId: string,
13:     type: ThreadEventType,
14:     actorType: ActorType,
15:     actorId: string | null,
16:     payload: Record<string, unknown>,
17:     evidenceRefs: string[] = [],
18:   ): ThreadEvent {
19:     const event = this.threadEventRepo.create({
20:  
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\run.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, RunStatus, FailureReason, IssueStatus } from "@personahub/shared/types";
3: import { RunStatus as RS, IssueStatus as IS, FailureReason as FR, ThreadEventType, ActorType, AdapterStatus } from "@personahub/shared/types";
4: import { ErrorCode } from "@personahub/shared/errors";
5: import type { RunRepository } from "../repositories/run.js";
6: import type { IssueRepository } from "../repositories/issue.js";
7: import type { WorkspaceRepository } from "../repositories/workspace.js";
8: import type { AgentConfigRepository } from "../repositories/agent-config.js";
9: import type { ThreadEventService } from "./thread-event.js";
10: import
…[truncated]
  ```
  </details>

## assistant · 2026-07-15T13:22:13Z

- **tool**: `glob({"pattern": "**/AdapterSettings.tsx"})`
- **tool**: `glob({"pattern": "**/design.md"})`
- **tool**: `grep({"pattern": "issue\\.goal|context.*=.*goal|issue\\.title", "include": "*.ts", "output_mode": "content"})`


> [reasoning] Now let me also find and read the web component file mentioned in claim 8.
Now let me find the remaining files needed:

  <details><summary>tool output</summary>

  ```text
Found 1 file(s)

D:\Projects\personahub\web\src\components\adapter\AdapterSettings.tsx
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 3 file(s)

D:\Projects\personahub\docs\features\0.1\F002-agent-command-center\design.md
D:\Projects\personahub\docs\features\0.1\F001-workspace-issue-foundation\design.md
D:\Projects\personahub\docs\features\TEMPLATE\design.md
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 1 match(es) in 1 file(s)

D:\Projects\personahub\server\src\services\run-dispatch.ts
  156: const context = issue?.goal ?? "";
  ```
  </details>

## assistant · 2026-07-15T13:22:22Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\web\\src\\components\\adapter\\AdapterSettings.tsx"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F002-agent-command-center\\design.md"})`


> [reasoning] Now let me read the AdapterSettings.tsx, the design.md for F002, and the workspace-context.ts (already read) to verify all claims.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\web\src\components\adapter\AdapterSettings.tsx</path>
<type>file</type>
<content>
1: import { useState, type FormEvent } from "react";
2: import { Trash2, RefreshCw, Cpu } from "lucide-react";
3: import { AdapterStatus, type AdapterConfig, type AdapterConfigCreateInput } from "@personahub/shared";
4: import { useAdapters, useCreateAdapter, useUpdateAdapter, useDeleteAdapter, useValidateAdapter } from "@/hooks/use-adapters";
5: import { toApiError } from "@/lib/api-client";
6: import { Button } from "@/components/ui/button";
7: import { Badge } from "@/components/ui/badge";
8: import {
9:   Dialog,
10:   DialogContent,
11:   DialogHeader,
12:   DialogTitle,
13: } from "@/components/ui/dialog";
14: import { Input } from "@/components/ui/input";
15: import { Label
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F002-agent-command-center\design.md</path>
<type>file</type>
<content>
1: ---
2: feature_ids: [F002]
3: related_features: [F001]
4: topics: [agent-adapter, codex-cli, run-events, workspace-lock, escalation, api, ui, v0.1.1]
5: doc_kind: design
6: created: 2026-07-12
7: updated: 2026-07-12
8: ---
9: 
10: # F002：Agent Command Center - 设计
11: 
12: > Status: draft | Owner: TBD | Spec: `spec.md`
13: 
14: ## 1. 技术概要
15: 
16: F002 在 F001 的 Project / Workspace / Issue / Thread 基础上，加入最小可运行 agent runtime：
17: 
18: ```text
19: Thread user instruction
20:   -> Run created
21:   -> Workspace write lock acquired
22:   -> CodexCliAdapter started
23:   -> stdout/stderr persisted as ThreadEvents
24:   -> Inspector shows status/logs
25:   -> Run terminal state

…[truncated]
  ```
  </details>

## assistant · 2026-07-15T13:22:28Z

- **tool**: `grep({"pattern": "issue\\.title", "include": "*.ts", "path": "D:\\Projects\\personahub\\server\\src\\services", "output_mode": "content"})`
- **tool**: `grep({"pattern": "onRunTerminal|startNextQueuedRun", "include": "*.ts", "path": "D:\\Projects\\personahub\\server\\src", "output_mode": "content"})`


> [reasoning] Now I have all the files I need. Let me analyze each claim one by one.

## Claim 1: Escalation double-drain

In `server/src/runtime/agent-runner.ts` handleExit method (lines 205-265):
- Line 214-233: When escalation is detected (`result.failureReason && ESCALATION_REASONS.has(result.failureReason)`):
  - Line 216-224: Calls `onEscalation(params)` if present
  - Line 233: Then calls `onTerminal?.(run.id, workspaceId)` 
  - Line 234: Returns

So YES, handleExit calls BOTH `onEscalation(params)` and `onTerminal?.(run.id, workspaceId)`.

In `server/src/services/run-dispatch.ts` onEscalation method (lines 75-127):
- Line 124: `this.cancelQueuedRunsForIssue(params.issueId);`
- Line 126: `this.onRunTerminal(params.runId, escalationRun.workspace_id);`

So onEscalation DOES call `this.onRunTerminal()` at the end.

onRunTerminal (lines 58-73):
- Line 59: `this.workspaceLockService.release(workspaceId);`
- Line 61: `const nextRun = this.runService.startNextQueuedRun(workspaceId);`

So the flow is:
1. handleExit → onEscalation(params) → onRunTerminal(runId, workspaceId) [releases lock, starts next]
2. handleExit → onTerminal?.(run.id, workspaceId) → onRunTerminal(run.id, workspaceId) [releases lock AGAIN, starts next AGAIN]

Yes, this is a confirmed double-drain. The lock is released twice and `startNextQueuedRun` is called twice.

**CONFIRMED**

## Claim 2: Cancel running Run doesn't drain queue

In `server/src/services/run-dispatch.ts` cancel method (lines 129-141):
- Line 136-138: When `run.status === RS.Running`:
  - Line 137: `return this.agentRunner.cancelRun(runId);`
  
It returns immediately to `this.agentRunner.cancelRun(runId)`. No call to `onRunTerminal` or `startNextQueuedRun`.

In `server/src/runtime/agent-runner.ts` cancelRun method (lines 267-294):
- Line 267-294: It does NOT call onTerminal. It just:
  - Sets exited flag
  - Clears timeout
  - Cancels handle
  - Deletes from activeRuns
  - Calls `this.deps.runService.transitionToCancelled(runId, "user_cancelled")`
  - Returns the result

So cancelRun does NOT call onTerminal either.

This means when canceling a running Run:
- The Run is transitioned to cancelled
- The workspace lock is released by `transitionToCancelled` (line 300: `this.workspaceLockService.releaseByRunId(runId)`)
- But `startNextQueuedRun` is NEVER called

Wait, let me check transitionToCancelled in run.ts (lines 275-302):
- Line 300: `this.workspaceLockService.releaseByRunId(runId);`

So the lock IS released, but the queue is never drained (startNextQueuedRun is never called).

The cancel method in run-dispatch.ts returns directly without calling onRunTerminal. And cancelRun does not have a mechanism to call onTerminal.

**CONFIRMED** - Cancel doesn't drain the queue; the next queued run will never be started.

## Claim 3: turn/completed always success

In `server/src/runtime/adapters/codex-cli-adapter.ts`:
- Lines 202-205:
```ts
if (msg.method === "turn/completed") {
  turnCompleted = true;
  finish({ exitCode: 0, failureReason: null, errorMessage: null });
  return;
}
```

Indeed, it ignores `msg.params?.turn?.status`. It always calls `finish` with `exitCode: 0` and no failure, regardless of what status the turn actually completed with.

**CONFIRMED**

## Claim 4: JSON-RPC startup errors swallowed

In `server/src/runtime/adapters/codex-cli-adapter.ts`:
- Lines 323-350:
```ts
sendRequest("initialize", {
  clientInfo: { name: "personahub", version: "0.1.0" },
}).then(() => {
  return sendRequest("thread/start", {
    cwd: input.workspace.localPath,
    sandbox: "workspace-write",
    approvalPolicy: "untrusted",
  });
}).then((threadResponse) => {
  const threadResult = getResult(threadResponse);
  const thread = threadResult.thread as { id?: string } | undefined;
  if (thread?.id) {
    threadId = thread.id;
  }
  const text = input.instructions + "\n\n" + input.context;
  return sendRequest("turn/start", {
    threadId: threadId,
    input: [{ type: "text", text }],
  });
}).then((turnResponse) => {
  const turnResult = getResult(turnResponse);
  const turn = turnResult.turn as { id?: string } | undefined;
  if (turn?.id) {
    turnId = turn.id;
  }
}).catch(() => {
  void 0;
});
```

The catch at the end (line 348-350) does `void 0;` - it silently swallows any error without calling `finish()` or `callExit()`. If initialize, thread/start, or turn/start fail, the Run will hang indefinitely (never exit, never get a terminal state).

**CONFIRMED**

## Claim 5: HOME redirect breaks Codex auth

In `server/src/runtime/workspace-context.ts` buildChildEnv (lines 18-51):

Lines 19-21: When `push_credentials_enabled` is true, it returns the full process.env.

Lines 23-35: When false:
- Line 33: `if (key === "HOME" || key === "USERPROFILE") continue;` - Strips HOME/USERPROFILE from inherited env
- Line 37: `env["HOME"] = workspace.local_path;` - Sets HOME to workspace.local_path
- Lines 38-40: On Windows, also sets USERPROFILE to workspace.local_path

So yes, when `push_credentials_enabled` is false, HOME/USERPROFILE are set to `workspace.local_path`. This would prevent Codex CLI from finding `~/.codex/auth.json` because `~` now resolves to the workspace path instead of the user's home directory.

**CONFIRMED** - though it's worth noting this is by design (credential isolation), not necessarily a bug. The claim asks to verify the behavior, which is accurate.

## Claim 6: Post-hoc escalation on agent message text

In `server/src/runtime/adapters/codex-cli-adapter.ts`:
- Lines 209-223:
```ts
if (msg.method === "item/agentMessage/delta" || msg.method === "item/commandExecution/outputDelta") {
  const delta = msg.params?.delta ?? msg.params?.text ?? "";
  if (typeof delta === "string" && delta.length > 0) {
    emitOutput("stdout", delta);
    if (!escalationTriggered && isGitPushOutput(delta) && !input.workspace.pushCredentialsEnabled) {
      escalationTriggered = true;
      finish({
        exitCode: null,
        failureReason: FR.PostHocEscalation,
        errorMessage: delta.trim().slice(0, 200),
      });
    }
  }
  return;
}
```

The handler is for `item/agentMessage/delta` notifications. The `delta` is the raw text content included in the notification. It calls `isGitPushOutput(delta)` on this text.

The `isGitPushOutput` function (lines 34-36):
```ts
function isGitPushOutput(text: string): boolean {
  return GIT_PUSH_PATTERNS.some((p) => p.test(text));
}
```

And GIT_PUSH_PATTERNS (lines 17-21):
```ts
const GIT_PUSH_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
];
```

The first pattern `/\bgit\s+push\b/` would match if the model says "we should git push this change" in a natural language message. Since `item/agentMessage/delta` sends the agent's natural language output as deltas, this could indeed false-trigger.

**CONFIRMED** - The regex pattern matches natural language mentions of "git push", not just actual commands.

## Claim 7: Context assembly incomplete

In `server/src/services/run-dispatch.ts` startAdapter method (lines 143-171):
- Line 155-156:
```ts
const issue = this.issueRepo.getById(run.issue_id);
const context = issue?.goal ?? "";
```

That's it. Only `issue?.goal ?? ""`. No Issue title, no workspace path, no thread ID, no run ID.

Compare with `design.md` (lines 654-656):
> - P0 `context` 至少包含 Issue title、Issue goal、workspace path、当前 thread id、run id。

The design says context must include at least: Issue title, Issue goal, workspace path, thread ID, run ID. But the actual code only includes `issue?.goal ?? ""`.

**CONFIRMED**

## Claim 8: Adapter form stale state

In `web/src/components/adapter/AdapterSettings.tsx`:
- Lines 177-178: `AdapterDialog` component
- Lines 180-183:
```tsx
const [name, setName] = useState(editingAdapter?.name ?? "");
const [command, setCommand] = useState(editingAdapter?.command ?? "");
const [argsInput, setArgsInput] = useState(editingAdapter?.args?.join(", ") ?? "");
const [defaultModel, setDefaultModel] = useState(editingAdapter?.default_model ?? "");
```

These are `useState` initializers. In React, `useState` initializer only runs on the first render of the component. When the `editingAdapter` prop changes (e.g., user clicks "Edit" on a different adapter), the component is the same `AdapterDialog` instance (it's not unmounted/remounted between dialog opens because Dialog might still be in the DOM), so the state won't re-initialize with the new `editingAdapter` values.

Wait, actually the Dialog component might mount/unmount based on the `open` prop. Let me check the flow:

1. User clicks "Edit" → `openEdit(adapter)` → sets `editingAdapter` AND `dialogOpen = true`
2. But `AdapterDialog` is always rendered (lines 102-107):
```tsx
<AdapterDialog
  open={dialogOpen}
  onOpenChange={handleDialogClose}
  projectId={projectId}
  editingAdapter={editingAdapter}
/>
```

It's always mounted, just toggling the `open` prop of the Dialog component. So when `editingAdapter` changes, the useState initializers won't re-run.

There's no `useEffect` to sync the form state when `editingAdapter` prop changes.

The `reset` function (lines 191-198) uses `editingAdapter?.name ?? ""` etc., but it's only called in `handleOpenChange` (lines 200-203) which is when the dialog closes, not when it opens with a new editingAdapter.

**CONFIRMED** - useState initializers don't update when editingAdapter prop changes, and there's no useEffect to sync form state on dialog open.

## Claim 9: Lock acquisition not atomic

In `server/src/services/run-dispatch.ts` dispatch method (lines 30-56):
- Line 33: `this.workspaceLockService.acquire(run.workspace_id, run.id);` - acquires lock
- Line 38: `this.runService.transitionToRunning(run.id);` - transitions Run to running

These are two separate operations. No transaction wrapping them.

In `server/src/services/run.ts` startNextQueuedRun method (lines 304-339):
- Line 327: `const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);` - acquires lock
- Line 332: `const startedRun = this.transitionToRunning(run.id);` - transitions Run to running

Again, two separate operations. No transaction wrapping them.

Compare with `design.md` (lines 663-664):
> - 获取锁：在 repository transaction 中检查 Workspace 是否 idle 且 Run 仍为 `queued`；若成立，同时写 `Workspace.lock_state = locked`、`Workspace.locked_by_run_id = run_id`、`Run.status = running`、`Run.started_at = now`。

The design says lock acquisition should be in a single transaction where both the workspace lock and Run status transition happen atomically. The actual code does them separately.

**CONFIRMED**

## Claim 10: Broadcast before commit

In `server/src/services/thread-event.ts` writeAndBroadcast (lines 11-29):
```ts
const event = this.threadEventRepo.create({...});
this.eventBus.publish(event);
return event;
```

The repo `create` is called first (which presumably does a DB insert), then `eventBus.publish` is called. This is within the same function, with no transaction boundary.

But the claim is about whether `eventBus.publish` could be called inside a transaction. Let me check callers.

In `server/src/services/run-dispatch.ts` onEscalation (lines 75-127):
```ts
this.db.transaction(() => {
  this.threadEventService.writeAndBroadcast(...);   // line 78 - within transaction
  this.runService.transitionToFailed(...);            // line 95
  this.issueRepo.updateStatus(...);                   // line 102
  this.threadEventService.writeAndBroadcast(...);     // line 107 - within transaction
})();
```

Yes! The onEscalation method wraps writeAndBroadcast in `db.transaction`. So `writeAndBroadcast` inserts into DB and then calls `eventBus.publish` - all within the outer transaction. If the transaction later rolls back, the event would have already been broadcast. 

Wait, but `better-sqlite3` is synchronous, so the DB insert happens first, then the event is published. But the transaction wraps all operations. So if the transaction fails after the insert but before the event publish... actually no, since `better-sqlite3` is synchronous, the insert completes before the publish. But the transaction as a whole might fail, meaning the insert could be rolled back but the event was already published.

Let me re-check the claim: "is eventBus.publish called immediately after the DB insert, potentially inside an outer db.transaction?"

In writeAndBroadcast: DB insert → eventBus.publish. These are done sequentially inside the function.

In onEscalation: the entire block (including two writeAndBroadcast calls plus other operations) is wrapped in `db.transaction`.

So yes, eventBus.publish is called within an outer db.transaction in the onEscalation case. If the transaction rolls back, the event is already broadcast.

But let me also check if there's another concern - looking at run.ts create method (lines 64-97):
```ts
return this.db.transaction(() => {
  const run = this.runRepo.create({...});
  if (issue.status === IS.Inbox || issue.status === IS.Ready) {
    this.issueRepo.updateStatus(issueId, { status: IS.Running, ... });
  }
  this.threadEventService.writeAndBroadcast(
    run.thread_id, ThreadEventType.RunQueued, ActorType.System, null, {...}
  );
  return run;
})();
```

So in run.ts create, `writeAndBroadcast` is called inside a transaction. The DB insert (create) happens first, then eventBus.publish is called within the same transaction. The event is broadcast while the outer transaction is still open - if it rolls back, the event is already published.

Also in transitionToRunning (lines 112-137):
```ts
transitionToRunning(runId: string): Run | null {
  const result = this.runRepo.transitionStatus(runId, RS.Queued, RS.Running, { started_at: now });
  // ...
  this.threadEventService.writeAndBroadcast(...);
  return result.run;
}
```
This is NOT wrapped in a transaction - so the insert and publish are sequential but not transactional.

So the claim is that writeAndBroadcast publishes before the outer transaction commits. Let me verify: in onEscalation, the entire code block is wrapped in `db.transaction(() => { ... })()`. Inside that, `writeAndBroadcast` creates a DB event AND publishes via eventBus. So the publish happens before the transaction returns/commits. If `better-sqlite3` transaction function fails (throws), the DB changes are rolled back, but the event was already published.

Actually wait - `better-sqlite3` transactions: when you pass a callback to `db.transaction()`, it returns a function. When that function is called, it runs the callback in a transaction. If the callback completes without error, the transaction is committed. If it throws, the transaction is rolled back. Since `writeAndBroadcast` calls `this.eventBus.publish(event)` within this callback, the event is published BEFORE the transaction commits. If the callback later throws (e.g., after the first writeAndBroadcast succeeds, the second one fails), the event was already published but the DB changes are rolled back.

However, looking at the onEscalation code more carefully: the operations inside the transaction are all synchronous (better-sqlite3 is synchronous). So the order is:
1. writeAndBroadcast call 1 → DB insert → eventBus.publish
2. transitionToFailed → DB updates
3. issueRepo.updateStatus → DB updates
4. writeAndBroadcast call 2 → DB insert → eventBus.publish
5. Transaction commits

If any of steps 2-4 throws, steps 2-4 are rolled back, but step 1's DB insert is also rolled back (since they're in the same transaction). However, step 1's eventBus.publish has already happened.

So the claim is **CONFIRMED** - though importantly, this is a write-after-commit (or rather publish-before-commit) issue. The event is published before the transaction commits.

Wait, actually let me re-read the claim more carefully:

> **Broadcast before commit**: In `server/src/services/thread-event.ts` writeAndBroadcast, is eventBus.publish called immediately after the DB insert, potentially inside an outer db.transaction? Check if callers like run-dispatch.ts onEscalation wrap writeAndBroadcast in db.transaction.

The claim is exactly this - yes, `eventBus.publish` is called immediately after the DB insert (within the same function), and yes, callers like `onEscalation` DO wrap it in `db.transaction`. This means the broadcast happens before the outer transaction commits.

**CONFIRMED** - both parts of the claim.

Now let me compile all the results.

Wait, one more thing about Claim 4. Let me also check if the `catch` block in the startup chain at line 348-350 is truly silent:

```ts
}).catch(() => {
  void 0;
});
```

Yes. `void 0` is a no-op. No error logging, no `finish()` call, no `callExit()` call. If initialization fails, the adapter never signals "exit" and the Run hangs forever.

Also for Claim 2, let me re-check whether `transitionToCancelled` in run.ts releases the workspace lock:

Line 300: `this.workspaceLockService.releaseByRunId(runId);`

Yes, it does. So the lock IS released, but the queue is never drained (startNextQueuedRun is never called). This means the next queued Run for the workspace will never get a chance to start until the next Run is dispatched or the server restarts.

Actually, wait. Let me look at `cancel` again:

```ts
async cancel(runId: string): Promise<Run | null> {
  const run = this.runService.get(runId);
  if (run.status === RS.Queued) {
    return this.runService.cancelQueued(runId, "user_cancelled");
  }
  if (run.status === RS.Running) {
    return this.agentRunner.cancelRun(runId);
  }
  return run;
}
```

For Running state, it calls `this.agentRunner.cancelRun(runId)` which calls `this.deps.runService.transitionToCancelled(...)`. The `transitionToCancelled` releases the lock via `this.workspaceLockService.releaseByRunId(runId)`. But `onRunTerminal` (which would call `startNextQueuedRun`) is never invoked. So the queue is not drained.

Actually, I should also check `cancelQueued`:
```ts
cancelQueued(runId: string, reason: string): Run | null {
  // ...
  return result.run;
}
```
For Queued runs, it just cancels without releasing any lock (since queued runs don't hold the lock). But it also doesn't drain the queue. However, a queued run that hasn't started doesn't block the queue in the same way.

For running runs, the issue is clear: the lock is released but the queue is never drained.

Let me compile the final results now.
Now I have all the data needed. Let me do one final check on the `issueRepo.getById` return type and a quick search for any additional context assembly:

  <details><summary>tool output</summary>

  ```text
No matches found
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 7 match(es) in 2 file(s)

D:\Projects\personahub\server\src\services\run.ts
  304: startNextQueuedRun(workspaceId: string): Run | null {

D:\Projects\personahub\server\src\services\run-dispatch.ts
  53: this.onRunTerminal(startedRun.id, startedRun.workspace_id);
  58: onRunTerminal(runId: string, workspaceId: string): void {
  61: const nextRun = this.runService.startNextQueuedRun(workspaceId);
  70: this.onRunTerminal(nextRun.id, workspaceId);
  126: this.onRunTerminal(params.runId, escalationRun.workspace_id);
  165: this.onRunTerminal(terminalRunId, workspaceId);
  ```
  </details>

## assistant · 2026-07-15T13:23:17Z


> [reasoning] Now I have enough information to compile the full results. Let me summarize each claim.
Here are the complete verification results for all 10 claims:

---

<results>
<files>
- /D:/Projects/personahub/server/src/runtime/agent-runner.ts - handleExit, cancelRun, escalation double-drain, cancel without onTerminal
- /D:/Projects/personahub/server/src/services/run-dispatch.ts - dispatch, cancel, onEscalation, onRunTerminal, startAdapter context assembly, transaction wrapping
- /D:/Projects/personahub/server/src/runtime/adapters/codex-cli-adapter.ts - turn/completed, startup chain catch, post-hoc escalation on agentMessage/delta
- /D:/Projects/personahub/server/src/runtime/workspace-context.ts - buildChildEnv HOME/USERPROFILE redirect
- /D:/Projects/personahub/server/src/services/thread-event.ts - writeAndBroadcast DB insert then publish
- /D:/Projects/personahub/server/src/services/run.ts - startNextQueuedRun lock + transition, transitionToCancelled lock release, create with transaction
- /D:/Projects/personahub/web/src/components/adapter/AdapterSettings.tsx - AdapterDialog useState stale state
- /D:/Projects/personahub/docs/features/0.1/F002-agent-command-center/design.md - design requirements for context, lock atomicity
</files>

<answer>

## 1. Escalation double-drain — **CONFIRMED**

**Evidence — `agent-runner.ts` handleExit** (lines 214-234):
```ts
if (result.failureReason && ESCALATION_REASONS.has(result.failureReason)) {
  // ...
  if (onEscalation) {
    onEscalation({ ... });                          // ← calls onEscalation
  }
  onTerminal?.(run.id, workspaceId);                // ← ALSO calls onTerminal
  return;
}
```
**Evidence — `run-dispatch.ts` onEscalation** (lines 75-127):
```ts
onEscalation(params: EscalationParams): void {
  // ... writes events, transitions to failed, sets issue blocked ...
  this.onRunTerminal(params.runId, escalationRun.workspace_id);  // ← line 126: calls onRunTerminal
}
```

**The flow hits onRunTerminal TWICE:**
1. `onEscalation(params)` → ends with `this.onRunTerminal(...)` → releases lock + calls `startNextQueuedRun`
2. Back in `handleExit`, `onTerminal?.(run.id, workspaceId)` → calls `this.onRunTerminal(...)` again → **releases lock again + calls `startNextQueuedRun` again** (double drain)

This is a real bug: the workspace lock is released twice (second call is a no-op if lock service tolerates it, but `startNextQueuedRun` runs twice causing potential double-start of the next queued run).

---

## 2. Cancel running Run doesn't drain queue — **CONFIRMED**

**Evidence — `run-dispatch.ts` cancel** (lines 129-141):
```ts
async cancel(runId: string): Promise<Run | null> {
  const run = this.runService.get(runId);
  if (run.status === RS.Queued) {
    return this.runService.cancelQueued(runId, "user_cancelled");  // ← returns immediately
  }
  if (run.status === RS.Running) {
    return this.agentRunner.cancelRun(runId);                       // ← returns immediately, no onRunTerminal
  }
  return run;
}
```
**Evidence — `agent-runner.ts` cancelRun** (lines 267-294):
```ts
async cancelRun(runId: string): Promise<Run | null> {
  // ... cleanup ...
  const result = this.deps.runService.transitionToCancelled(runId, "user_cancelled");
  return result;                                   // ← returns without calling onTerminal
}
```

The lock IS released inside `transitionToCancelled` (run.ts line 300: `this.workspaceLockService.releaseByRunId(runId)`), but **`startNextQueuedRun` is never called**, so the next eligible queued Run for that workspace will never start automatically. The queue is stuck until a new dispatch triggers `onRunTerminal` or the server restarts.

---

## 3. turn/completed always success — **CONFIRMED**

**Evidence — `codex-cli-adapter.ts`** (lines 202-205):
```ts
if (msg.method === "turn/completed") {
  turnCompleted = true;
  finish({ exitCode: 0, failureReason: null, errorMessage: null });  // ← always success
  return;
}
```

The handler **completely ignores `msg.params?.turn?.status`**. The real Codex CLI protocol can send a `Turn` object with `status: "failed"` or `"interrupted"` in the `turn/completed` notification. But the code always reports success, masking genuine execution failures from the adapter.

---

## 4. JSON-RPC startup errors swallowed — **CONFIRMED**

**Evidence — `codex-cli-adapter.ts`** (lines 323-350):
```ts
sendRequest("initialize", { ... })
  .then(() => sendRequest("thread/start", { ... }))
  .then((threadResponse) => {
    // ...
    return sendRequest("turn/start", { ... });
  })
  .then((turnResponse) => {
    // ...
  })
  .catch(() => {
    void 0;                                        // ← silently swallows ALL startup errors
  });
```

If `initialize`, `thread/start`, or `turn/start` fail (process not ready, protocol error, invalid params), the error is silently swallowed. **No `finish()` or `callExit()` is called**, so the Run handle never fires `onExit`, and the Run hangs forever in "running" status until the timeout in `agent-runner.ts` kicks in (30 min default).

---

## 5. HOME redirect breaks Codex auth — **CONFIRMED** (behavior matches claim)

**Evidence — `workspace-context.ts` buildChildEnv** (lines 18-51):
```ts
if (workspace.push_credentials_enabled) {
  return { ...process.env } as Record<string, string>;        // ← full env pass-through
}
// When push_credentials_enabled is false:
for (const [key, value] of Object.entries(process.env)) {
  // ...
  if (key === "HOME" || key === "USERPROFILE") continue;      // ← strips user's HOME/USERPROFILE
  env[key] = value;
}
env["HOME"] = workspace.local_path;                            // ← redirects HOME to workspace
if (process.platform === "win32") {
  env["USERPROFILE"] = workspace.local_path;                   // ← redirects USERPROFILE to workspace
}
```

When `push_credentials_enabled` is `false`, `HOME` and `USERPROFILE` are redirected to `workspace.local_path`. This prevents Codex CLI from finding `~/.codex/auth.json` (which resolves under the redirected HOME). **This is by design** (credential isolation), but it does mean Codex will fail to authenticate for any operation requiring the saved auth token. If the intent was to allow read-only Codex access while blocking only git push, this is too aggressive.

---

## 6. Post-hoc escalation on agent message text — **CONFIRMED**

**Evidence — `codex-cli-adapter.ts`** (lines 209-222):
```ts
if (msg.method === "item/agentMessage/delta" || msg.method === "item/commandExecution/outputDelta") {
  const delta = msg.params?.delta ?? msg.params?.text ?? "";
  if (typeof delta === "string" && delta.length > 0) {
    emitOutput("stdout", delta);
    if (!escalationTriggered && isGitPushOutput(delta) && !input.workspace.pushCredentialsEnabled) {
      // ... triggers escalation
    }
  }
}
```
**Evidence — `isGitPushOutput`** (lines 34-36):
```ts
function isGitPushOutput(text: string): boolean {
  return GIT_PUSH_PATTERNS.some((p) => p.test(text));    // tests /\bgit\s+push\b/ etc.
}
```

The `item/agentMessage/delta` notification streams the **model's natural language text** (e.g., "I think we should git push this change to the remote"). The regex `/\bgit\s+push\b/` matches this text, **false-triggering a PostHocEscalation** solely because the model mentioned "git push" in conversation, not because it actually executed a push.

Note: `item/commandExecution/outputDelta` is correctly checked since that's actual command output. But `item/agentMessage/delta` should not be subjected to `isGitPushOutput` without distinguishing between agent speech and actual executed commands.

---

## 7. Context assembly incomplete — **CONFIRMED**

**Evidence — `run-dispatch.ts` startAdapter** (lines 155-156):
```ts
const issue = this.issueRepo.getById(run.issue_id);
const context = issue?.goal ?? "";
```

That's the **entire context** — just `issue?.goal ?? ""`.

**Evidence — `design.md`** (lines 654-656):
> P0 `context` 至少包含 Issue title、Issue goal、workspace path、当前 thread id、run id。

The design mandates at least: **Issue title, Issue goal, workspace path, current thread ID, run ID**. The code includes **only Issue goal**. Missing: Issue title, workspace path, thread ID, run ID. The `instructions` field (line 69: `instructions: run.instructions`) is passed separately via `AgentRunInput`, but `context` itself is severely incomplete per design.

---

## 8. Adapter form stale state — **CONFIRMED**

**Evidence — `AdapterSettings.tsx`** (lines 177-183):
```tsx
function AdapterDialog({ open, onOpenChange, projectId, editingAdapter }: AdapterDialogProps) {
  const isEdit = editingAdapter !== null;

  const [name, setName] = useState(editingAdapter?.name ?? "");         // ← initializer runs ONCE
  const [command, setCommand] = useState(editingAdapter?.command ?? ""); // ← initializer runs ONCE
  const [argsInput, setArgsInput] = useState(editingAdapter?.args?.join(", ") ?? "");
  const [defaultModel, setDefaultModel] = useState(editingAdapter?.default_model ?? "");
```

The `AdapterDialog` component is **always mounted** (line 102-107 in parent), only toggling `open` prop. React `useState` initializers only run on the **first render**. When the user clicks "Edit" on a different adapter:
1. `editingAdapter` prop changes to the new adapter
2. But the state values still hold the **previous adapter's data** (stale)
3. **There is no `useEffect`** to sync state when `editingAdapter` changes

The `reset()` function references `editingAdapter` but is only called on dialog close (`handleOpenChange`), not when dialog opens with a new adapter. **Opening the edit dialog for a different adapter shows stale data from the previous adapter.**

---

## 9. Lock acquisition not atomic — **CONFIRMED**

**Evidence — `run-dispatch.ts` dispatch** (lines 33-38):
```ts
const lockAcquired = this.workspaceLockService.acquire(run.workspace_id, run.id);  // step 1: lock
if (!lockAcquired) { return run; }

const startedRun = this.runService.transitionToRunning(run.id);                     // step 2: status transition
```
These are **two separate operations** with no wrapping transaction. Between steps 1 and 2, another process could steal the lock or the Run's status could change.

**Evidence — `run.ts` startNextQueuedRun** (lines 327-333):
```ts
const lockAcquired = this.workspaceLockService.acquire(workspaceId, run.id);  // step 1: lock
if (!lockAcquired) { return null; }

const startedRun = this.transitionToRunning(run.id);                           // step 2: status transition
```
Same pattern — **not atomic**.

**Design requirement** (`design.md` lines 663-664):
> 获取锁：在 repository transaction 中检查 Workspace 是否 idle 且 Run 仍为 `queued`；若成立，同时写 `Workspace.lock_state = locked`、`Workspace.locked_by_run_id = run_id`、`Run.status = running`、`Run.started_at = now`。

The design explicitly requires **one atomic transaction** for lock + status transition. The code does not implement this.

---

## 10. Broadcast before commit — **CONFIRMED**

**Evidence — `thread-event.ts` writeAndBroadcast** (lines 18-28):
```ts
writeAndBroadcast(...): ThreadEvent {
  const event = this.threadEventRepo.create({ ... });      // ← DB INSERT
  this.eventBus.publish(event);                              // ← BROADCAST (immediately after insert)
  return event;
}
```

**Evidence — `run-dispatch.ts` onEscalation** (lines 77-122):
```ts
this.db.transaction(() => {
  this.threadEventService.writeAndBroadcast(...);            // ← inside transaction: INSERT + PUBLISH
  this.runService.transitionToFailed(...);
  this.issueRepo.updateStatus(...);
  this.threadEventService.writeAndBroadcast(...);            // ← inside transaction: INSERT + PUBLISH
})();                                                        // ← transaction COMMIT happens AFTER both publishes
```

The `eventBus.publish(event)` is called **before the outer `db.transaction` callback completes**. If the transaction later fails (throws after the first event is published), the event is already broadcast to SSE clients, but the DB insert is rolled back. **Clients see an event that doesn't exist in the database** — a classic "broadcast-before-commit" issue.

Additionally, the same pattern exists in `run.ts` create (line 81-94) where `writeAndBroadcast` is called inside `db.transaction`.

</answer>

<next_steps>

**Priority bugs (should fix immediately):**
- **#10 Broadcast before commit** — Swap order: commit the outer transaction first, then publish events. Or use a two-phase approach (publish after transaction commits).
- **#1 Escalation double-drain** — Remove the `onTerminal?.(run.id, workspaceId)` call on line 233 of agent-runner.ts inside the escalation branch; `onEscalation` already calls `onRunTerminal`.
- **#2 Cancel doesn't drain queue** — In `cancel()`, after `agentRunner.cancelRun(runId)`, call `onRunTerminal(run.id, run.workspace_id)`.
- **#4 Startup errors swallowed** — Replace the `.catch(() => { void 0; })` with a proper error handler that calls `finish()` with appropriate failure reason.
- **#3 turn/completed always success** — Check `msg.params?.turn?.status` and pass the real status/error to `finish()`.

**Lower priority (should still fix):**
- **#7 Context assembly** — Add Issue title, workspace path, thread ID, run ID to context string.
- **#8 Adapter form stale state** — Add `useEffect` to sync form state when `editingAdapter` changes.
- **#6 Post-hoc escalation on agent message** — Skip `isGitPushOutput` check for `item/agentMessage/delta` (it's the model speaking, not executing).
- **#9 Lock acquisition not atomic** — Wrap acquire + transitionToRunning in a DB transaction.
- **#5 HOME redirect** — If intentional (credential isolation), document it explicitly. If not intended to break Codex auth for non-push operations, refine the env construction to preserve access to `~/.codex/auth.json`.

**Ready to proceed** — All 10 findings have been verified with exact code evidence.
</next_steps>
</results>
