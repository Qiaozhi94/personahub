---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_08a2a1044ffefBOLv13vLOF5Rx"
title: "F004 Phase 5: Final Message Contract (@Sisyphus-Junior subagent)"
project: "D:/Projects/personahub"
model: "glm-5-2-260617"
created_at: "2026-07-18T15:26:22Z"
updated_at: "2026-07-18T15:44:22Z"
tokens_input: 92878
tokens_output: 34466
cost: 0.0
parent_id: "ses_08ab84becffeL7SIbh48ShFh2z"
---

# F004 Phase 5: Final Message Contract (@Sisyphus-Junior subagent)

## user · 2026-07-18T15:26:22Z

## TASK: Implement F004 Phase 5 (T030-T035) - Adapter/Runner Final Message Contract

Implement Phase 5 of Feature F004 for PersonaHub. This phase extends the runtime to capture and persist the final agent message.

## IMPORTANT: Phase 1 already did partial work
- `RunExitResult` already has `finalMessage: string | null` field in `server/src/runtime/types.ts`
- `FakeAgentAdapter` already supports `finalMessage` option in `server/src/runtime/adapters/fake-adapter.ts`
- All existing `RunExitResult` creators already set `finalMessage: null` (agent-runner.ts, codex-cli-adapter.ts)
- `Run` type already has `has_final_message: boolean` in shared types
- `runs` table already has `final_message TEXT` column (schema-v4)
- Test fixtures exist at `server/tests/helpers/codex-final-message-fixtures.ts`

## KEY FILES TO READ FIRST
1. `docs/features/0.1/F004-autonomous-validation/tasks.md` - Phase 5 section (T030-T035)
2. `docs/features/0.1/F004-autonomous-validation/design.md` - Read §5.1 (Final agent message contract)
3. `server/src/runtime/types.ts` - RunExitResult, AgentAdapter, AgentAdapterCapabilities
4. `server/src/runtime/adapters/codex-cli-adapter.ts` - Current Codex adapter (needs final message capture)
5. `server/src/runtime/adapters/fake-adapter.ts` - Already has finalMessage support
6. `server/src/runtime/agent-runner.ts` - AgentRunner handleExit (needs to persist finalMessage)
7. `server/src/services/run.ts` - RunService (needs finalMessage persistence)
8. `server/src/repositories/run.ts` - RunRepository (may need finalMessage update method)
9. `server/tests/helpers/codex-final-message-fixtures.ts` - Fixtures for T032

## WHAT TO IMPLEMENT (in order)

### T030 -> T031: Runtime contract tests + types extension
- T030: Write `server/tests/unit/runtime-final-message.test.ts`
  - RunExitResult.finalMessage field exists and can be set
  - Fake adapter can emit finalMessage in exit result
  - Missing finalMessage capability detection
  - finalMessage content does NOT appear in public Run API responses
- T031: Extend types if needed (most already done in Phase 1)
  - Add `supportsFinalMessage: boolean` to `AgentAdapterCapabilities` if not present
  - Ensure Fake adapter can configure finalMessage per scenario

### T032 -> T033: Codex final-message normalizer + capture
- T032: Write `server/tests/unit/codex-final-message-normalizer.test.ts`
  - Use fixtures from `server/tests/helpers/codex-final-message-fixtures.ts`
  - Test: pure JSON final message -> captured correctly
  - Test: fenced JSON -> captured correctly
  - Test: delta accumulation is NOT used (only item/completed with phase=final_answer)
  - Test: commentary phase is ignored
  - Test: multiple final_answer -> take last one
  - Test: command output stays isolated
  - Test: missing final message -> null
  - Test: Unicode preserved
  - Test: 64 KiB boundary
- T033: Implement Codex final-message capture in `codex-cli-adapter.ts`
  - Track `item/completed` notifications where `item.type === "agentMessage"` and `item.phase === "final_answer"`
  - Store the `text` field of the last matching item
  - On exit (via `finish()` or `callExit()`), include `finalMessage` in the RunExitResult
  - For non-zero exit, timeout, cancel, escalation: finalMessage = null
  - Do NOT accumulate `item/agentMessage/delta` notifications
  - Do NOT depend on `turn/completed` for the message content
  - Max 64 KiB; truncate if exceeded

### T034 -> T035: AgentRunner/RunService terminal integration
- T034: Write `server/tests/integration/agent-runner-final-message.test.ts`
  - When adapter emits finalMessage in exit result, it gets persisted to runs.final_message
  - Terminal callback duplicate doesn't overwrite finalMessage
  - finalMessage is persisted BEFORE workflow hook (for validator Run processing)
- T035: Implement terminal finalMessage persistence
  - In `RunService.transitionToCompleted()` or a new method, persist `final_message` column
  - AgentRunner.handleExit() passes result.finalMessage to RunService
  - For transitionToFailed/Cancelled/Interrupted: finalMessage = null (already set by adapter)
  - Do NOT change F003 finalization/unlock order

## CRITICAL RULES
- Tests first (TDD)
- File limit: 350 lines hard cap
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- No unnecessary comments
- Run `npm run typecheck && npm test` - ALL must pass
- Check off T030-T035 in tasks.md with brief notes

## MUST NOT DO
- Do NOT implement workflow state machine (Phase 7)
- Do NOT implement validation trace service changes (Phase 6)
- Do NOT modify api/routes (Phase 9)
- Do NOT change F003 finalization order (trace finalize -> release lock -> drain)
- Do NOT expose raw finalMessage in public Run API (only has_final_message)
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-07-18T15:26:22Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\types.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\fake-adapter.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts"})`


> [reasoning] Let me start by reading the key files to understand the current state of the codebase before implementing the task.

Let me first read the tasks.md, design.md, and the key runtime files to understand what needs to be done.
我先阅读关键文件了解当前状态和需求。

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
11: 
12: > Status: ready-for-development | Owner: TBD | Spec: `spec.md` | Design: `design.md`
13: 
14: ## 规则
15: 
16: - F003必须先实现并通过其Checkpoint 7（terminal finalization/lock/queue/recovery）；不得把F004接到F002当前“terminal即解锁”的旧出口。
17: - 严格按Phase推进，每项先补测试再实现；状态机、事务、race、restart测试通过后才能进入UI。
18: - 只有修改不同文件且无顺序依赖的任务标`[P]`。
19: - 不实现自动修复Run、parallel validation、公开任意validation event写入、Done reopen、trust scoring或
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\types.ts</path>
<type>file</type>
<content>
1: import type { AdapterConfig, RunStatus, FailureReason } from "@personahub/shared/types";
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
18:   adapterConfig: { command: string; args: string[] };
19: }
20: 
21: export interface RunOutputChunk {
22:   stream: "stdout" | "stderr";
23:   chunk: string;
24:   sequence: number;
…[truncated]
  ```
  </details>

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
22:   fin
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
15: import { normalizeCodexTraceNotification } from "./codex-trace-normalizer.js";
16: import {
17:   type JsonRpcRequest,
18: 
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:26:32Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\agent-runner.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\helpers\\codex-final-message-fixtures.ts"})`


> [reasoning] Now let me read the design.md §5.1, agent-runner.ts, RunService, RunRepository, and the fixtures.
现在读取设计文档、agent-runner、RunService、RunRepository 和 fixtures。

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\agent-runner.ts</path>
<type>file</type>
<content>
1: import type { Run, FailureReason, AdapterConfig, Workspace } from "@personahub/shared/types";
2: import { FailureReason as FR, ThreadEventType, ActorType, CommandTraceCapability, type RunTraceSignal } from "@personahub/shared/types";
3: import type { AgentAdapter, RunHandle, RunOutputChunk, RunExitResult, AgentRunInput } from "./types.js";
4: import { DEFAULT_EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES, MAX_CHUNK_BYTES } from "./types.js";
5: import type { RunService } from "../services/run.js";
6: import type { ThreadEventService } from "../services/thread-event.js";
7: import type { WorkspaceLockService } from "../services/workspace-lock.js";
8: import { buildWorkspaceContext } from "./worksp
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
<path>D:\Projects\personahub\server\tests\helpers\codex-final-message-fixtures.ts</path>
<type>file</type>
<content>
1: /**
2:  * Codex final-message protocol fixtures (F004 T002/T003).
3:  *
4:  * Probe confirmed on Codex CLI 0.144.5 (Windows):
5:  * - final message = `item/completed` where `item.type === "agentMessage"`
6:  *   and `item.phase === "final_answer"`,取其 `text` 字段
7:  * - delta field name is `delta`; must NOT accumulate deltas
8:  * - preamble agentMessage phase="commentary", final answer phase="final_answer"
9:  * - command output (aggregatedOutput) stays isolated from final message
10:  * - Unicode preserved as-is
11:  *
12:  * These fixtures are consumed by Phase 5 T032 (Codex final-message normalizer unit tests).
13:  * Boundary cases (64 KiB / missing / non-zero / cancel
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:26:40Z

- **tool**: `grep({"pattern": "5\\.1|Final agent message|finalMessage|final_message", "path": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\design.md", "output_mode": "content", "include": "*.md"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-trace-normalizer.ts"})`


> [reasoning] Now let me read design.md §5.1 and the codex-trace-normalizer to understand the design contract.
现在读取设计文档 §5.1 和 codex-trace-normalizer 了解设计契约。

  <details><summary>tool output</summary>

  ```text
Found 10 match(es) in 1 file(s)

D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\design.md
  211: ALTER TABLE runs ADD COLUMN final_message TEXT;
  317: ### 5.1 Final agent message
  326: finalMessage: string | null
  333: - Fake adapter 可直接配置 `finalMessage`。
  335: - AgentRunner 在 validator Run terminal 时把 `finalMessage` 交给 workflow hook；不把未 redacted 原文新增到结构化 validation payload。原始输出仍按 F002/F003 有界 trace 留存。
  436: - `completed`：解析 finalMessage并进入 outcome submission。
  484: 2. 对 terminal validator + Issue Validating且无 result，幂等 process result；从 requested event 读取固化的 implementation/policy scope。finalMessage 必须已随 terminal capture 持久化。为此 v4 在 `runs` 增加 `final_message TEXT` 内部列（API `Run` 默认不返回正文，只返回 `has_final_message`）。
  658: | finalMessage缺失/超限/JSON非法 | result_unparsable
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\adapters\codex-trace-normalizer.ts</path>
<type>file</type>
<content>
1: import {
2:   TraceSource,
3:   CommandOutcome,
4:   type RunTraceSignal,
5: } from "@personahub/shared/types";
6: 
7: interface JsonRpcNotification {
8:   jsonrpc: "2.0";
9:   method: string;
10:   params?: Record<string, unknown>;
11: }
12: 
13: interface JsonRpcRequest {
14:   jsonrpc: "2.0";
15:   id: number;
16:   method: string;
17:   params?: Record<string, unknown>;
18: }
19: 
20: type JsonRpcMessage = JsonRpcNotification | JsonRpcRequest | { jsonrpc: "2.0"; id: number; result?: unknown };
21: 
22: function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
23:   return "method" in msg && !("id" in msg);
24: }
25: 
26: function isRequest(msg: JsonR
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:26:49Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\design.md", "limit": 60, "offset": 310})`
- **tool**: `glob({"pattern": "server/tests/**/*.test.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-protocol.ts"})`


> [reasoning] Let me read design.md §5.1 in detail and check the existing test files for the unit tests and integration tests.
读取设计文档 §5.1 详细内容，并查看现有测试文件结构。

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\design.md</path>
<type>file</type>
<content>
310: 
311: Repository 不解析 JSON result、不判断 evidence 是否足够、不广播事件。
312: 
313: `RunService` 的公开创建入口只创建 `role=implementation/workflow_step=implementation/dispatch_source=user_explicit`，并在同一 transaction 重新读取 Issue：仅 Inbox/Ready/Running 可接受；Validating/Done/Blocked 返回结构化 transition error。请求 body 出现 role/workflow_step/validation_round/dispatch_source/adapter_identity 等系统字段时直接拒绝未知/保留字段。`AdapterConfigService` 同样把 F004 role 限制为 `implementation|validator`，不允许任意字符串进入数据库。
314: 
315: ## 5. Validator 输出与 Context
316: 
317: ### 5.1 Final agent message
318: 
319: F003 的 `run.output` 是展示日志，不适合做自动决策。F004 扩展 adapter contract：
320: 
321: ```ts
322: interface RunExitResult {
323:   exitCode: numbe
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 55 file(s)

D:\Projects\personahub\server\tests\unit\validation-validator-selector.test.ts
D:\Projects\personahub\server\tests\unit\validation-same-origin-summary.test.ts
D:\Projects\personahub\server\tests\unit\validation-context-builder.test.ts
D:\Projects\personahub\server\tests\unit\validation-policy-gate.test.ts
D:\Projects\personahub\server\tests\unit\validation-result-parser.test.ts
D:\Projects\personahub\server\tests\integration\issue-cas.test.ts
D:\Projects\personahub\server\tests\unit\error-mapping.test.ts
D:\Projects\personahub\server\tests\integration\run-repository-extension.test.ts
D:\Projects\personahub\server\tests\integration\adapter-config-role.test.ts
D:\Projects\personahub\server\tests\integration\issue-blocked.test.ts
D:\Projects\personahub\server\tests\integrati
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\runtime\adapters\codex-protocol.ts</path>
<type>file</type>
<content>
1: import { spawnSync } from "node:child_process";
2: import type { AdapterConfig } from "@personahub/shared/types";
3: import type { AdapterValidationResult } from "../types.js";
4: 
5: /**
6:  * Pure Codex app-server protocol helpers: JSON-RPC framing types/guards,
7:  * git-push escalation detection, credential-failure matching, and command
8:  * validation. Kept out of the adapter so the adapter file stays focused on
9:  * process/stream orchestration.
10:  */
11: 
12: const GIT_PUSH_PATTERNS = [
13:   /\bgit\s+push\b/,
14:   /\bgit\s+push\s+--force\b/,
15:   /\bgit\s+push\s+-f\b/,
16: ];
17: 
18: export const CREDENTIAL_FAILURE_PATTERN =
19:   /permission denied|authentication
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:27:01Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\agent-runner-trace.test.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\fake-adapter-dispatch.test.ts"})`


> [reasoning] Now let me look at the existing test files for the agent-runner and run-service to understand the testing patterns used.
查看现有测试模式，了解集成测试和单元测试的结构。

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\agent-runner-trace.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
3: import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
4: import {
5:   ThreadEventType,
6:   RunStatus,
7:   AdapterStatus,
8:   TraceSource,
9:   CommandOutcome,
10:   EvidenceConfidence,
11:   type RunTraceSignal,
12: } from "@personahub/shared/types";
13: 
14: function setupIssue(services: TestServices, tempDir: string) {
15:   const project = services.projectService.create("Test", "desc");
16:   services.workspaceService.bind(project.id, tempDir);
17:   const { iss
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\fake-adapter-dispatch.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
3: import { RunStatus, ThreadEventType, AdapterStatus } from "@personahub/shared/types";
4: import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
5: 
6: function setupIssue(services: TestServices, tempDir: string) {
7:   const project = services.projectService.create("Test", "desc");
8:   services.workspaceService.bind(project.id, tempDir);
9:   const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
10:   const adapter = services.a
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:27:08Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\helpers.ts"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run-dispatch.ts"})`


> [reasoning] Now let me look at the test helpers and run-dispatch.ts to understand the test services available.
查看测试 helpers 和 run-dispatch service。

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
<path>D:\Projects\personahub\server\src\services\run-dispatch.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Run, FailureReason, IssueStatus, ThreadEvent } from "@personahub/shared/types";
3: import { IssueStatus as IS, RunStatus as RS, ThreadEventType, ActorType, CommandTraceCapability } from "@personahub/shared/types";
4: import { ErrorCode } from "@personahub/shared/errors";
5: import type { RunService } from "./run.js";
6: import type { WorkspaceLockService } from "./workspace-lock.js";
7: import type { ThreadEventService } from "./thread-event.js";
8: import type { DevelopmentTraceService } from "./development-trace.js";
9: import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
10: import type { AgentRunner, E
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:27:15Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\shared\\src\\types", "pattern": "has_final_message|final_message|supportsFinalMessage|AgentAdapterCapabilities|interface Run\\b"})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\codex-cli-adapter.test.ts", "limit": 80})`


> [reasoning] Now I have a good understanding. Let me also check the Run shared types to understand the Run type fully, and look at one existing unit test that's similar to what I need to write.
查看 shared types 中 Run 类型和 codex-cli-adapter 集成测试，确认测试模式。

  <details><summary>tool output</summary>

  ```text
Found 2 match(es) in 1 file(s)

D:\Projects\personahub\shared\src\types\index.ts
  212: export interface Run {
  230: has_final_message: boolean;

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
- Agents can perform deeper, more t
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\codex-cli-adapter.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
2: import { fileURLToPath } from "node:url";
3: import { join } from "node:path";
4: import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
5: import { RunStatus, FailureReason, IssueStatus, AdapterStatus, ThreadEventType } from "@personahub/shared/types";
6: 
7: const __testDir = join(fileURLToPath(import.meta.url), "..");
8: const fakeScriptPath = join(__testDir, "..", "helpers", "fake-codex.mjs").replace(/\\/g, "/");
9: 
10: vi.mock("node:child_process", async (importOriginal) => {
11:   const actual = await importOriginal<typeof import("node:chil
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:27:24Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "limit": 40, "offset": 205})`
- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\codex-cli-adapter.test.ts", "offset": 81})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
205: 
206: export enum AdapterStatus {
207:   Unknown = "unknown",
208:   Available = "available",
209:   Unavailable = "unavailable",
210: }
211: 
212: export interface Run {
213:   id: string;
214:   issue_id: string;
215:   thread_id: string;
216:   workspace_id: string;
217:   adapter_config_id: string;
218:   status: RunStatus;
219:   failure_reason: FailureReason | null;
220:   instructions: string;
221:   started_at: string | null;
222:   completed_at: string | null;
223:   exit_code: number | null;
224:   error_message: string | null;
225:   role: RunRole;
226:   workflow_step: "implementation" | "validation" | null;
227:   validation_round: number | null;
228:   dispatch_source: RunDispatchSo
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\codex-cli-adapter.test.ts</path>
<type>file</type>
<content>
81:     await wait(500);
82: 
83:     const events = services.threadEventService.listByThread(issue.primary_thread!.id);
84:     const outputEvents = events.filter(e => e.type === ThreadEventType.RunOutput);
85:     expect(outputEvents.length).toBeGreaterThan(0);
86:     expect(outputEvents[0]!.payload_json.stream).toBe("stdout");
87:   });
88: 
89:   it("persists run.queued, run.started, run.completed in correct order", async () => {
90:     const { issue, adapter } = setupIssue(services, tempDir);
91: 
92:     await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
93:     await wait(500);
94: 
95:     const events = services.threadEventService.listByThread
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:27:31Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\helpers\\fake-codex.mjs"})`


> [reasoning] Now let me look at the fake-codex.mjs script to understand how it's structured, since I'll need to extend it for the final-message test scenarios.
查看 fake-codex.mjs 脚本以了解如何扩展 final-message 测试场景。

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\helpers\fake-codex.mjs</path>
<type>file</type>
<content>
1: #!/usr/bin/env node
2: import * as readline from "node:readline";
3: 
4: const mode = process.env.FAKE_CODEX_MODE ?? "success";
5: 
6: const rl = readline.createInterface({ input: process.stdin });
7: process.stdin.resume();
8: 
9: function send(msg) {
10:   process.stdout.write(JSON.stringify(msg) + "\n");
11: }
12: 
13: function sendResponse(id, result) {
14:   send({ jsonrpc: "2.0", id, result });
15: }
16: 
17: function sendNotification(method, params) {
18:   send({ jsonrpc: "2.0", method, params });
19: }
20: 
21: let turnCount = 0;
22: const fakeThreadId = "fake-thread-1";
23: const fakeTurnId = "fake-turn-1";
24: 
25: rl.on("line", (line) => {
26:   const trimmed = line.trim();
27
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:27:39Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "in_progress"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "pending"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "pending"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts
…[truncated])`


> [reasoning] Now I have a complete understanding. Let me plan the implementation:

## Implementation Plan

### T030: Write `server/tests/unit/runtime-final-message.test.ts`
Tests for:
- RunExitResult.finalMessage field exists and can be set
- Fake adapter can emit finalMessage in exit result
- Missing finalMessage capability detection (need to add `supportsFinalMessage` to `AgentAdapterCapabilities`)
- finalMessage content does NOT appear in public Run API responses (Run only has `has_final_message` boolean)

### T031: Extend types
- Add `supportsFinalMessage: boolean` to `AgentAdapterCapabilities`
- Update Fake adapter and Codex adapter to set `supportsFinalMessage`
- Update codex-cli-adapter.ts and other RunExitResult creators if needed

### T032: Write `server/tests/unit/codex-final-message-normalizer.test.ts`
Tests using fixtures from `server/tests/helpers/codex-final-message-fixtures.ts`:
- pure JSON final message -> captured correctly
- fenced JSON -> captured correctly
- delta accumulation is NOT used (only item/completed with phase=final_answer)
- commentary phase is ignored
- multiple final_answer -> take last one
- command output stays isolated
- missing final message -> null
- Unicode preserved
- 64 KiB boundary

### T033: Implement Codex final-message capture in `codex-cli-adapter.ts`
- Create a pure function/module `codex-final-message-capture.ts` to track final messages (extracting from notifications)
- Track `item/completed` notifications where `item.type === "agentMessage"` and `item.phase === "final_answer"`
- Store the `text` field of the last matching item
- On exit (via `finish()` or `callExit()`), include `finalMessage` in the RunExitResult
- For non-zero exit, timeout, cancel, escalation: finalMessage = null
- Do NOT accumulate `item/agentMessage/delta` notifications
- Do NOT depend on `turn/completed` for the message content
- Max 64 KiB; truncate if exceeded

### T034: Write `server/tests/integration/agent-runner-final-message.test.ts`
- When adapter emits finalMessage in exit result, it gets persisted to runs.final_message
- Terminal callback duplicate doesn't overwrite finalMessage
- finalMessage is persisted BEFORE workflow hook (for validator Run processing)

### T035: Implement terminal finalMessage persistence
- In `RunService.transitionToCompleted()`, persist `final_message` column
- AgentRunner.handleExit() passes result.finalMessage to RunService
- For transitionToFailed/Cancelled/Interrupted: finalMessage = null (already set by adapter)
- Do NOT change F003 finalization/unlock order

Let me now plan the architecture:

1. **`server/src/runtime/adapters/codex-final-message-capture.ts`** (new file): A pure class/function that tracks final messages from notifications. This is what T032 tests against.

2. **`server/src/runtime/types.ts`** (modify): Add `supportsFinalMessage: boolean` to `AgentAdapterCapabilities`.

3. **`server/src/runtime/adapters/fake-adapter.ts`** (modify): Set `supportsFinalMessage: true` in capabilities.

4. **`server/src/runtime/adapters/codex-cli-adapter.ts`** (modify): Set `supportsFinalMessage: true`, use the capture module, include finalMessage in exit result.

5. **`server/src/repositories/run.ts`** (modify): Add `final_message` to `transitionStatus` updates.

6. **`server/src/services/run.ts`** (modify): Add `finalMessage` parameter to `transitionToCompleted`.

7. **`server/src/runtime/agent-runner.ts`** (modify): Pass `result.finalMessage` to `transitionToCompleted`.

Let me think about the design for T032/T033:

The fixtures are notifications. The test T032 should test a pure function that takes notifications and returns the final message. Let me design this:

```typescript
// codex-final-message-capture.ts
export class CodexFinalMessageCapture {
  private finalMessage: string | null = null;
  
  handleNotification(method: string, params: Record<string, unknown> | undefined): void {
    if (method !== "item/completed") return;
    const item = params?.item as { type?: string; phase?: string; text?: string } | undefined;
    if (!item || item.type !== "agentMessage") return;
    if (item.phase !== "final_answer") return;
    if (typeof item.text !== "string") return;
    this.finalMessage = item.text;
  }
  
  getFinalMessage(): string | null {
    if (this.finalMessage === null) return null;
    // Truncate to 64 KiB
    const buf = Buffer.from(this.finalMessage, "utf8");
    if (buf.byteLength <= CODEX_FINAL_MESSAGE_MAX_BYTES) return this.finalMessage;
    return buf.subarray(0, CODEX_FINAL_MESSAGE_MAX_BYTES).toString("utf8");
  }
  
  reset(): void {
    this.finalMessage = null;
  }
}
```

Wait, looking at the fixture `oversizedMessage`:
```typescript
{
  name: "oversizedMessage",
  description: "Final message exceeding 64 KiB boundary",
  notifications: [
    agentMessageCompleted("x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)),
    turnCompleted(),
  ],
  expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1),
  expectedCanValidate: true,
},
```

The expected final message is the FULL message (not truncated). But the task says "Max 64 KiB; truncate if exceeded". Hmm, there's a conflict.

Wait, let me re-read the task:
> - T032: Write `server/tests/unit/codex-final-message-normalizer.test.ts`
>   - Test: 64 KiB boundary

And for T033:
> - Max 64 KiB; truncate if exceeded

But the fixture says expectedFinalMessage is the full oversized message. This is a discrepancy. Let me look more carefully.

Actually, looking at the fixture file again:
```typescript
{
  name: "oversizedMessage",
  description: "Final message exceeding 64 KiB boundary",
  notifications: [
    agentMessageCompleted("x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)),
    turnCompleted(),
  ],
  expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1),
  expectedCanValidate: true,
},
```

The `expectedFinalMessage` is the full oversized message. But the task T033 says "Max 64 KiB; truncate if exceeded".

Hmm. There are two interpretations:
1. The capture layer stores the raw message, and truncation happens at the persistence layer.
2. The capture layer truncates.

The fixture says the expected final message is the full message. So the capture layer should NOT truncate - it stores the raw text. The truncation might happen at a different layer (persistence to DB).

But wait, T033 says "Max 64 KiB; truncate if exceeded" for the Codex final-message capture. And the design doc §5.1 says "最大 64 KiB".

Let me re-read the fixture description: "Final message exceeding 64 KiB boundary" and expectedCanValidate: true. The `expectedFinalMessage` is the full message.

Actually, I think the fixture represents what the PROTOCOL delivers, and the test for the normalizer/capture might test that the capture returns the full message OR truncated. Since the fixture's `expectedFinalMessage` is the full message, the capture layer should return the full message, and truncation might happen elsewhere (at persistence time or at parser time).

Wait, but the task explicitly says "Max 64 KiB; truncate if exceeded" for T033. Let me reconcile:

Option A: The fixture is wrong/outdated and I should update it to expect truncation.
Option B: The capture returns full message, and the 64 KiB truncation is a separate concern (e.g., in the DB column or parser).

Looking at the fixture file header comment:
```
* Boundary cases (64 KiB / missing / non-zero / cancel / timeout) have Blocked fallbacks.
```

And the fixture `oversizedMessage` has `expectedCanValidate: true`. This suggests the oversized message is still capturable, but when parsing it might be blocked. Actually "canValidate" might mean "the adapter can capture a final message" not "the validation will pass".

Hmm, but the name `expectedCanValidate` is ambiguous. Let me think about what makes sense:

- The capture layer captures the raw final message text (no truncation).
- The 64 KiB limit is enforced somewhere - either at persistence (DB column limit) or at the parser.
- The design says "最大 64 KiB" for the final message.

Given the fixture expects the full message back, I'll make the capture layer return the full message, and handle the 64 KiB truncation at the persistence layer (in the repository or service). This way:
- T032 tests the capture layer against fixtures, expecting full messages.
- T033 captures the full message.
- T035 truncates to 64 KiB when persisting to DB.

Actually wait, let me re-read T033 more carefully:
> - Max 64 KiB; truncate if exceeded

And the task T030-T035 description says:
> - Max 64 KiB; truncate if exceeded

OK so the truncation needs to happen somewhere. The question is where. Given the fixture expects full message, the capture layer returns full message. The truncation happens at persistence (T035).

Hmm, but actually, let me reconsider. The fixture's `expectedFinalMessage` field might be testing what the CAPTURE returns, and the capture should return the full message. Then the truncation to 64 KiB happens at the DB persistence layer.

Actually, I realize I'm overthinking this. Let me look at the fixture more carefully. The `expectedFinalMessage` is what the capture function should return. The fixture says it's the full oversized message. So the capture returns full message.

But T033 says "Max 64 KiB; truncate if exceeded". This could mean:
- The capture stores full, but when putting into RunExitResult, truncate.
- OR the capture truncates.

Given the fixture expects full message from the "normalizer" (T032 tests the normalizer/capture), the capture returns full. The truncation is at persistence (RunExitResult -> DB).

Wait, actually, I think I need to re-read. The T032 tests the "normalizer" which is the capture layer. The fixture says the normalizer returns the full message. So the normalizer/capture does NOT truncate.

Then T033 says "Max 64 KiB; truncate if exceeded" - this must be at the point where finalMessage goes into RunExitResult OR at persistence. 

Hmm, but the task says for T033: "On exit (via `finish()` or `callExit()`), include `finalMessage` in the RunExitResult" and "Max 64 KiB; truncate if exceeded". So the truncation happens when building RunExitResult in the Codex adapter.

But then the fixture (which tests the normalizer) expects the full message, and the adapter truncates. So:
- Normalizer/capture: returns full raw text
- Codex adapter (T033): truncates to 64 KiB when putting into RunExitResult

Wait, but that doesn't match. Let me look at the fixture test name: "oversizedMessage" with expectedFinalMessage = full message. If T032 tests the normalizer and expects full message, then the normalizer doesn't truncate. But T033 says the adapter truncates. So the adapter would truncate the normalizer's output.

Actually, I think the cleanest design is:
1. The capture/normalizer is a pure tracker that returns the raw final message text (no truncation). T032 tests this.
2. The Codex adapter uses the capture, and when building RunExitResult, truncates to 64 KiB. T033 implements this.
3. The RunService/Repository persists the finalMessage (already truncated by adapter) to the DB. T035 implements this.

But wait, the fixture's `expectedFinalMessage` for oversizedMessage is the FULL message. If T032 tests the normalizer and expects full message, that's fine. The truncation happens in the adapter (T033), which is not tested by T032.

Actually, let me reconsider. Maybe I should make the capture handle truncation too, and the fixture is just documenting what the PROTOCOL sends, not what the capture returns. Let me look at the fixture name: `codexFinalMessageFixtures` and the field `expectedFinalMessage`.

Hmm, the fixture has `expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)` which is the full oversized message. If the capture truncates, this would be wrong.

I think the safest approach is:
1. The capture/normalizer returns the raw final message (no truncation). The fixture tests confirm this.
2. The truncation to 64 KiB happens at the adapter level when building RunExitResult, OR at the persistence level.

But actually, the task T033 explicitly says "Max 64 KiB; truncate if exceeded" for the Codex capture. So maybe the capture DOES truncate, and the fixture's expectedFinalMessage for oversizedMessage is wrong (or I should update it).

Let me re-read the fixture comment:
```
* Boundary cases (64 KiB / missing / non-zero / cancel / timeout) have Blocked fallbacks.
```

This suggests the 64 KiB boundary has a "Blocked fallback", meaning if the message exceeds 64 KiB, it's blocked. But the fixture `oversizedMessage` has `expectedCanValidate: true`, which contradicts "Blocked fallback".

OK, I think there's some ambiguity. Let me make a decision:

**Decision**: The capture/normalizer returns the raw final message text without truncation. The fixture's `expectedFinalMessage` for oversizedMessage is the full message. The 64 KiB truncation is enforced at the adapter level (T033) when building RunExitResult. This way:
- T032 tests the normalizer against fixtures, expecting full messages (matching `expectedFinalMessage`).
- T033 truncates to 64 KiB in the adapter.
- The oversizedMessage fixture tests that the normalizer can handle oversized messages, returning the full text. The adapter then truncates.

Wait, but then the T032 test for oversizedMessage would expect the full message from the normalizer, which is fine. And T033 (adapter) truncates. But T032 doesn't test the adapter, so there's no conflict.

Hmm, but actually let me reconsider once more. Let me look at what `expectedCanValidate` means. It might mean "can this final message be used for validation (parsing)". For oversizedMessage, `expectedCanValidate: true` means the message is capturable and can be attempted for validation. The actual validation (parsing) might fail or the message might be truncated before parsing.

OK, I'll go with:
1. Normalizer/capture returns raw text (no truncation). T032 tests this.
2. Adapter truncates to 64 KiB when building RunExitResult. T033 implements this.
3. RunService persists finalMessage to DB. T035 implements this.

Actually, wait. Let me reconsider the truncation location. The design §5.1 says "最大 64 KiB" for the final message. This is a hard limit. Where should it be enforced?

If I enforce it at the adapter (RunExitResult), then the normalizer returns full text, and the adapter truncates. The DB stores the truncated version.

If I enforce it at the normalizer, then the normalizer returns truncated text, and the fixture's expectedFinalMessage for oversizedMessage would be wrong.

Given the fixture expects full text, I'll enforce truncation at the adapter level (RunExitResult). This is cleanest.

Actually, hold on. Let me re-read the fixture once more:

```typescript
{
  name: "oversizedMessage",
  description: "Final message exceeding 64 KiB boundary",
  notifications: [
    agentMessageCompleted("x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)),
    turnCompleted(),
  ],
  expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1),
  expectedCanValidate: true,
},
```

The `expectedFinalMessage` is the full message. If the normalizer truncates, this fixture would fail. So the normalizer does NOT truncate. The truncation happens elsewhere (adapter or persistence).

OK, final decision:
- Normalizer/capture (`codex-final-message-capture.ts`): pure tracker, returns raw final message text, NO truncation. T032 tests this.
- Codex adapter: uses capture, truncates to 64 KiB when building RunExitResult.finalMessage. T033 implements this.
- RunService.transitionToCompleted: accepts finalMessage param, persists to DB. T035 implements this.
- RunRepository.transitionStatus: adds final_message to updates. T035 implements this.

Wait, but the task T033 says "Max 64 KiB; truncate if exceeded" explicitly for the Codex capture. Let me just put the truncation in the capture's getFinalMessage method, but make it configurable or have a separate method. Actually, no. Let me keep it simple:

The capture stores raw text. The adapter calls `capture.getFinalMessage()` and gets raw text, then truncates to 64 KiB before putting into RunExitResult. OR, the capture has a `getFinalMessage(maxBytes)` method that truncates.

Actually, the simplest: the capture's `getFinalMessage()` returns raw text. A helper function `truncateFinalMessage(text, maxBytes)` truncates. The adapter uses both.

Hmm, but for T032, I need to test the 64 KiB boundary. The fixture has oversizedMessage. If the normalizer returns full text, the test just confirms full text is returned. The "64 KiB boundary" test would be that the normalizer handles large messages without error.

Let me just go with:
- Capture returns raw text (no truncation).
- T032 tests capture against fixtures, expecting raw text (matching expectedFinalMessage).
- Adapter truncates to 64 KiB in RunExitResult.
- T033 implements adapter truncation.

This is clean and matches the fixtures. Let me proceed.

Actually, wait. I just realized the task says for T032:
> - Test: 64 KiB boundary

And for T033:
> - Max 64 KiB; truncate if exceeded

So T032 tests the boundary (capture handles it), and T033 truncates. The capture returns full text (boundary test = capture doesn't crash on large messages). The adapter truncates.

OK let me finalize the plan and start implementing.

Let me also check: does the `transitionStatus` in RunRepository need to support `final_message`? Yes, for T035. Let me add it to the updates interface.

Now, one important consideration for T035: "finalMessage is persisted BEFORE workflow hook". The workflow hook is Phase 7/8 (not implemented yet). But the test T034 needs to verify that finalMessage is persisted before the workflow hook. Since the workflow hook doesn't exist yet, the test just needs to verify that finalMessage is persisted during the terminal transition (which happens before any hypothetical workflow hook).

Looking at the current code flow:
1. AgentRunner.handleExit() calls RunService.transitionToCompleted() (or transitionToFailed/etc.)
2. Then calls onTerminal callback (which triggers finalizeAndDrain)
3. finalizeAndDrain: trace finalize -> release lock -> drain queue

The workflow hook (Phase 8) will be inserted between "release lock" and "drain queue". So finalMessage must be persisted in step 1 (transitionToCompleted), which is before onTerminal/finalizeAndDrain/workflow hook. This is already the correct order.

So for T035, I just need to:
1. Add `finalMessage` param to `RunService.transitionToCompleted()`.
2. Add `final_message` to `RunRepository.transitionStatus()` updates.
3. Pass `result.finalMessage` from AgentRunner.handleExit() to transitionToCompleted().

For transitionToFailed/Cancelled/Interrupted, finalMessage is already null (set by adapter), so no change needed there. But wait, the task says "For transitionToFailed/Cancelled/Interrupted: finalMessage = null (already set by adapter)". So I don't need to pass finalMessage to those methods. But actually, to be safe and explicit, I could set final_message = null in those transitions. Let me check if the DB column defaults to null... The schema has `final_message TEXT` (nullable), and it defaults to null on creation. So failed/cancelled/interrupted runs will have final_message = null (since it's never set). That's correct.

But wait, what if a run was completed (final_message set), then... no, terminal states are terminal. Once completed, it stays completed. So no issue.

Actually, there's a subtle point: for the escalation path, the adapter sets finalMessage = null in the RunExitResult, but the escalation path calls transitionToFailedWriteOnly, not transitionToCompleted. So final_message stays null. Good.

Let me also consider: for timeout (transitionToFailed with ExecutionTimeout), the adapter/caller sets finalMessage = null. Good.

Now let me think about the "terminal callback duplicate doesn't overwrite finalMessage" test (T034). Looking at AgentRunner.handleExit():

```typescript
handle.onExit((result: RunExitResult) => {
  if (activeRun.exited) return;
  activeRun.exited = true;
  clearTimeout(activeRun.timeoutTimer);
  this.handleExit(run, workspace.id, result, onTerminal, onEscalation);
});
```

The `if (activeRun.exited) return;` guard prevents duplicate processing. And `timeoutRun` also sets `activeRun.exited = true` before calling handleExit. So duplicates are already prevented at the AgentRunner level.

But the test T034 says "Terminal callback duplicate doesn't overwrite finalMessage". This might mean: if onTerminal is called twice (from different paths), the finalMessage shouldn't be overwritten. Since AgentRunner prevents duplicate handleExit calls, and RunService.transitionToCompleted uses CAS (expectedStatus = Running), a second call would fail (status is already Completed). So finalMessage won't be overwritten.

Actually, the test might be about: if the adapter calls onExit twice, the second call is ignored (activeRun.exited guard). So finalMessage from the first call is what gets persisted. Good.

Let me now start implementing. I'll create the todo list first.

Let me plan the files:

1. **T031 (types)**: Modify `server/src/runtime/types.ts` - add `supportsFinalMessage: boolean` to `AgentAdapterCapabilities`.
2. **T031 (fake adapter)**: Modify `server/src/runtime/adapters/fake-adapter.ts` - add `supportsFinalMessage: true`.
3. **T031 (codex adapter)**: Modify `server/src/runtime/adapters/codex-cli-adapter.ts` - add `supportsFinalMessage: true` (will be done in T033).
4. **T030 (test)**: Write `server/tests/unit/runtime-final-message.test.ts`.
5. **T032 (test)**: Write `server/tests/unit/codex-final-message-normalizer.test.ts`.
6. **T033 (impl)**: Create `server/src/runtime/adapters/codex-final-message-capture.ts`, modify `codex-cli-adapter.ts`.
7. **T034 (test)**: Write `server/tests/integration/agent-runner-final-message.test.ts`.
8. **T035 (impl)**: Modify `server/src/repositories/run.ts`, `server/src/services/run.ts`, `server/src/runtime/agent-runner.ts`.

Let me also check: are there other adapters that implement AgentAdapter? Let me search.

Actually, from the code I've seen, there are only two adapters: FakeAgentAdapter and CodexCliAdapter. Let me verify.

Let me also check if there are other places that create AgentAdapterCapabilities objects.

Let me search for all usages of AgentAdapterCapabilities to make sure I update all of them.

OK, let me start. First, the todo list, then I'll do the implementation in TDD order (tests first, then implementation).

Actually, the task says "Tests first (TDD)". So the order should be:
1. T030: Write runtime contract test (will fail because supportsFinalMessage doesn't exist yet)
2. T031: Extend types (make T030 pass)
3. T032: Write codex normalizer test (will fail because capture doesn't exist)
4. T033: Implement codex capture (make T032 pass)
5. T034: Write agent-runner integration test (will fail because finalMessage not persisted)
6. T035: Implement terminal persistence (make T034 pass)

But actually, T030 and T031 are intertwined - T030 tests the types that T031 extends. Let me do T031 first (extend types), then T030 (write test). Actually no, TDD says test first. But the test needs the types to compile. Hmm.

Let me look at what T030 tests:
- RunExitResult.finalMessage field exists and can be set (already done in Phase 1)
- Fake adapter can emit finalMessage in exit result (already done in Phase 1)
- Missing finalMessage capability detection (needs supportsFinalMessage - T031)
- finalMessage content does NOT appear in public Run API responses (already done - Run has has_final_message, not final_message)

So T030 can be written to test existing functionality + the new supportsFinalMessage capability. For the capability part, I need T031 first. But TDD says test first.

I think the practical approach is:
1. Write T030 test (it will reference supportsFinalMessage which doesn't exist yet - test won't compile).
2. Do T031 (add supportsFinalMessage to types + adapters).
3. T030 test now compiles and passes.
4. Write T032 test (references codex-final-message-capture which doesn't exist - won't compile).
5. Do T033 (create capture + integrate into codex adapter).
6. T032 test now compiles and passes.
7. Write T034 test (references finalMessage persistence which doesn't work yet - test fails).
8. Do T035 (implement persistence).
9. T034 test passes.

Since TypeScript won't compile if types are missing, I'll write the test and implementation close together. Let me do T031 types first (minimal), then T030 test, then continue.

Actually, let me just be pragmatic:
1. T031: Add supportsFinalMessage to types + both adapters.
2. T030: Write runtime contract test.
3. T032: Write codex normalizer test.
4. T033: Implement codex capture + integrate.
5. T034: Write integration test.
6. T035: Implement persistence.

This ensures everything compiles at each step. Let me start.

Let me first check all places that construct AgentAdapterCapabilities.
现在我已经充分理解了代码库。让我创建 todo 列表并开始实现。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunRepository/
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:29:09Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\src", "pattern": "supportsApprovalHook|supportsStructuredTrace|AgentAdapterCapabilities"})`
- **tool**: `grep({"include": "*.ts", "output_mode": "files_with_matches", "path": "D:\\Projects\\personahub\\server", "pattern": "supportsApprovalHook|AgentAdapterCapabilities"})`


> [reasoning] Let me first search for all places that construct AgentAdapterCapabilities to make sure I update all of them.
先搜索所有构造 `AgentAdapterCapabilities` 的地方，确保全部更新。

  <details><summary>tool output</summary>

  ```text
Found 17 match(es) in 5 file(s)

D:\Projects\personahub\server\src\services\run-dispatch.ts
  82: const traceCapability = adapter.capabilities.supportsStructuredTrace

D:\Projects\personahub\server\src\runtime\agent-runner.ts
  92: traceCapability: adapter.capabilities.supportsStructuredTrace

D:\Projects\personahub\server\src\runtime\types.ts
  43: export interface AgentAdapterCapabilities {
  45: supportsApprovalHook: boolean;
  46: supportsStructuredTrace: boolean;
  57: capabilities: AgentAdapterCapabilities;

D:\Projects\personahub\server\src\runtime\adapters\fake-adapter.ts
  3: AgentAdapterCapabilities,
  21: supportsStructuredTrace?: boolean;
  27: readonly capabilities: AgentAdapterCapabilities;
  33: supportsApprovalHook: false,
  34: supportsStructuredTrace: options.supportsStru
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 4 file(s)

D:\Projects\personahub\server\tests\integration\run-timeout.test.ts

D:\Projects\personahub\server\src\runtime\types.ts

D:\Projects\personahub\server\src\runtime\adapters\codex-cli-adapter.ts

D:\Projects\personahub\server\src\runtime\adapters\fake-adapter.ts

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

## assistant · 2026-07-18T15:29:26Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\tests\\integration\\run-timeout.test.ts", "pattern": "supportsApprovalHook|capabilities|AgentAdapterCapabilities|supportsStructuredTrace"})`


> [reasoning] Let me check run-timeout.test.ts to see how it uses AgentAdapterCapabilities, to make sure adding a new field won't break it.

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\run-timeout.test.ts
  4: import type { AgentAdapter, AgentAdapterCapabilities, AgentRunInput, RunHandle, AdapterValidationResult } from "../../src/runtime/types.js";
  30: readonly capabilities: AgentAdapterCapabilities = {
  32: supportsApprovalHook: false,
  33: supportsStructuredTrace: false,

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
ta
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:29:34Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\run-timeout.test.ts", "limit": 45, "offset": 25})`


> [reasoning] There's a test adapter in run-timeout.test.ts that constructs AgentAdapterCapabilities. I need to update it too. Let me read that file to understand the context.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\run-timeout.test.ts</path>
<type>file</type>
<content>
25:   return new Promise(resolve => setTimeout(resolve, ms));
26: }
27: 
28: class HangingAgentAdapter implements AgentAdapter {
29:   readonly provider = "hanging";
30:   readonly capabilities: AgentAdapterCapabilities = {
31:     provider: "hanging",
32:     supportsApprovalHook: false,
33:     supportsStructuredTrace: false,
34:     executionTimeoutMs: 100,
35:   };
36: 
37:   async validate(): Promise<AdapterValidationResult> {
38:     return { available: true, errorMessage: null };
39:   }
40: 
41:   async start(input: AgentRunInput): Promise<RunHandle> {
42:     const handle: RunHandle = {
43:       runId: input.runId,
44:       onOutput() {},
45:       onTrace() {},
46:      
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:29:41Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\types.ts", "newString": "export interface AgentAdapterCapabilities {\n  provider: string;\n  supportsApprovalHook: boolean;\n  supportsStructuredTrace: boolean;\n  supportsFinalMessage: boolean;\n  executionTimeoutMs: number;\n}", "oldString": "export interface AgentAdapterCapabilities {\n  provider: string;\n  supportsApprovalHook: boolean;\n  supportsStructuredTrace: boolean;\n  executionTimeoutMs: number;\n}"})`
- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\fake-adapter.ts", "newString": "export interface FakeAdapterOptions {\n  outputDelayMs?: number;\n  outputChunks?: string[];\n  exitCode?: number;\n  delayMs?: number;\n  failureReason?: import(\"@personahub/shared/types\").FailureReason | null;\n  errorMessage?: string | null;\n  traceSignals?: RunTraceSignal[];\n  supportsStructuredTrace?: boolean;\n  supportsFinalMessage?: boolean;\n  finalMessage?: string | null;\n}", "o
…[truncated])`


> [reasoning] Now I have the full picture. Let me start implementing T031: add `supportsFinalMessage` to `AgentAdapterCapabilities` and update all adapters.

Files to modify for T031:
1. `server/src/runtime/types.ts` - add `supportsFinalMessage: boolean` to `AgentAdapterCapabilities`
2. `server/src/runtime/adapters/fake-adapter.ts` - add `supportsFinalMessage: true` and add option
3. `server/src/runtime/adapters/codex-cli-adapter.ts` - add `supportsFinalMessage: true`
4. `server/tests/integration/run-timeout.test.ts` - add `supportsFinalMessage: false` to HangingAgentAdapter

Let me do these changes.
开始 T031：添加 `supportsFinalMessage` 到 `AgentAdapterCapabilities` 并更新所有 adapter。

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:29:55Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\fake-adapter.ts", "newString": "    this.capabilities = {\n      provider: \"fake\",\n      supportsApprovalHook: false,\n      supportsStructuredTrace: options.supportsStructuredTrace ?? true,\n      supportsFinalMessage: options.supportsFinalMessage ?? true,\n      executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,\n    };\n\n    this.defaultOptions = {\n      outputDelayMs: options.outputDelayMs ?? 50,\n      outputChunks:
…[truncated])`
- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "  readonly capabilities: AgentAdapterCapabilities = {\n    provider: \"codex\",\n    supportsApprovalHook: true,\n    supportsStructuredTrace: true,\n    supportsFinalMessage: true,\n    executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,\n  };", "oldString": "  readonly capabilities: AgentAdapterCapabilities = {\n    provider: \"codex\",\n    supportsApprovalHook: true,\n    supportsStruct
…[truncated])`
- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\run-timeout.test.ts", "newString": "  readonly capabilities: AgentAdapterCapabilities = {\n    provider: \"hanging\",\n    supportsApprovalHook: false,\n    supportsStructuredTrace: false,\n    supportsFinalMessage: false,\n    executionTimeoutMs: 100,\n  };", "oldString": "  readonly capabilities: AgentAdapterCapabilities = {\n    provider: \"hanging\",\n    supportsApprovalHook: false,\n    supportsStructuredTrace: false,\n   
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:30:11Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server", "pattern": "supportsApprovalHook\\s*:"})`


> [reasoning] Now let me check if there are any other places that construct AgentAdapterCapabilities that I might have missed. Let me also check the test files.
检查是否还有其他地方构造 `AgentAdapterCapabilities`。

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 4 file(s)

D:\Projects\personahub\server\tests\integration\run-timeout.test.ts
  32: supportsApprovalHook: false,

D:\Projects\personahub\server\src\runtime\types.ts
  45: supportsApprovalHook: boolean;

D:\Projects\personahub\server\src\runtime\adapters\codex-cli-adapter.ts
  34: supportsApprovalHook: true,

D:\Projects\personahub\server\src\runtime\adapters\fake-adapter.ts
  34: supportsApprovalHook: false,

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", lo
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:30:18Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "completed"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "in_progress"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "pending"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.
…[truncated])`


> [reasoning] All 4 places are updated. Now T031 is done. Let me mark it complete and move to T030.
T031 完成。现在写 T030 运行时契约测试。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunRepositor
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:30:29Z

- **tool**: `write({"content": "import { describe, it, expect } from \"vitest\";\nimport { FakeAgentAdapter } from \"../../src/runtime/adapters/fake-adapter.js\";\nimport type { RunExitResult, AgentAdapterCapabilities } from \"../../src/runtime/types.js\";\nimport type { Run } from \"@personahub/shared/types\";\n\nfunction wait(ms: number): Promise<void> {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}\n\nconst SAMPLE_FINAL_MESSAGE = JSON.stringify({\n  schema_version: 1,\n  outcome: \"passed\",\n
…[truncated])`


> [reasoning] Now let me write the T030 test. The test should cover:
1. RunExitResult.finalMessage field exists and can be set
2. Fake adapter can emit finalMessage in exit result
3. Missing finalMessage capability detection (supportsFinalMessage = false)
4. finalMessage content does NOT appear in public Run API responses (Run only has has_final_message boolean)

Let me look at how RunExitResult is structured and how to test the fake adapter. I need to write a unit test that doesn't require database setup for most parts, but the "public Run API" test might need to verify the Run type doesn't expose finalMessage.

Let me write the test file.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-07-18T15:30:58Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx tsc --noEmit 2>&1 | head -30", "timeout": 60000})`


> [reasoning] Now let me run the typecheck and this test to make sure T030 passes.
运行 typecheck 和 T030 测试验证。

  <details><summary>tool output</summary>

  ```text
[31;1mhead: [31;1mThe term 'head' is not recognized as a name of a cmdlet, function, script file, or executable program.[0m
[31;1m[31;1mCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.[0m
  ```
  </details>

## assistant · 2026-07-18T15:31:08Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx tsc --noEmit 2>&1 | Select-Object -First 30", "timeout": 60000})`

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-18T15:31:23Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx vitest run tests/unit/runtime-final-message.test.ts 2>&1 | Select-Object -Last 30", "timeout": 60000})`

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m�?[39m tests/unit/runtime-final-message.test.ts [2m([22m[2m12 tests[22m[2m)[22m[32m 101[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m12 passed[39m[22m[90m (12)[39m
[2m   Start at [22m 23:31:34
[2m   Duration [22m 832ms[2m (transform 61ms, setup 0ms, collect 174ms, tests 101ms, environment 0ms, prepare 219ms)[22m
  ```
  </details>

## assistant · 2026-07-18T15:31:38Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "completed"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "completed"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "in_progress"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapte
…[truncated])`


> [reasoning] T030 test passes (12 tests). Now let me move to T032: write the codex final-message normalizer test using fixtures.

Let me mark T030 complete and start T032.
T030 通过（12 个测试）。现在写 T032 Codex final-message normalizer 测试。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunReposit
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:31:47Z

- **tool**: `write({"content": "import { describe, it, expect } from \"vitest\";\nimport { CodexFinalMessageCapture } from \"../../src/runtime/adapters/codex-final-message-capture.js\";\nimport {\n  codexFinalMessageFixtures,\n  CODEX_FINAL_MESSAGE_MAX_BYTES,\n  type CodexNotification,\n} from \"../helpers/codex-final-message-fixtures.js\";\n\nfunction runFixture(notifications: CodexNotification[]): string | null {\n  const capture = new CodexFinalMessageCapture();\n  for (const n of notifications) {\n    capture.
…[truncated])`


> [reasoning] Now let me write T032. This test uses the fixtures from `codex-final-message-fixtures.ts` and tests a pure function/class that extracts the final message from Codex notifications.

The test should cover:
- pure JSON final message -> captured correctly
- fenced JSON -> captured correctly
- delta accumulation is NOT used (only item/completed with phase=final_answer)
- commentary phase is ignored
- multiple final_answer -> take last one
- command output stays isolated
- missing final message -> null
- Unicode preserved
- 64 KiB boundary

I need to design the API for the capture module first. Based on the design §5.1:
- final message = `item/completed` where `item.type === "agentMessage"` and `item.phase === "final_answer"`, take its `text` field
- multiple final_answer -> take last one
- do NOT accumulate `item/agentMessage/delta`
- do NOT depend on `turn/completed` for message content
- max 64 KiB, truncate if exceeded

I'll create a class `CodexFinalMessageCapture` with:
- `handleNotification(method: string, params: Record<string, unknown> | undefined): void`
- `getFinalMessage(): string | null` (returns truncated to 64 KiB)

Wait, but the fixture's expectedFinalMessage for oversizedMessage is the FULL message (not truncated). So if my capture truncates, the test would fail against the fixture.

Let me re-examine. The fixture has:
```typescript
{
  name: "oversizedMessage",
  description: "Final message exceeding 64 KiB boundary",
  notifications: [
    agentMessageCompleted("x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)),
    turnCompleted(),
  ],
  expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1),
  expectedCanValidate: true,
},
```

The `expectedFinalMessage` is the full message. So the capture/normalizer should return the full message, NOT truncated.

But T033 says "Max 64 KiB; truncate if exceeded". This truncation must happen at the adapter level (when building RunExitResult), not at the capture level.

So my plan:
- `CodexFinalMessageCapture.getFinalMessage()`: returns raw final message text (no truncation)
- A separate helper `truncateFinalMessage(text, maxBytes)` or the adapter truncates when building RunExitResult

For T032, I test the capture against fixtures, expecting raw text (matching expectedFinalMessage).
For T033, the adapter truncates to 64 KiB.

But wait, T032 also says "Test: 64 KiB boundary". What does this test mean if the capture doesn't truncate? It tests that the capture can handle messages at/exceeding the 64 KiB boundary without crashing, returning the full text.

Actually, let me reconsider. Maybe I should make the capture handle truncation, but the fixture's expectedFinalMessage for oversizedMessage is testing the raw protocol text, not the capture output. Let me re-read the fixture structure:

```typescript
export interface CodexFinalMessageFixture {
  name: string;
  description: string;
  notifications: CodexNotification[];
  expectedFinalMessage: string | null;
  expectedCanValidate: boolean;
}
```

The `expectedFinalMessage` is what the test should assert. For oversizedMessage, it's the full message. So the capture returns the full message.

OK, I'll go with: capture returns raw text (no truncation). The adapter truncates. T032 tests capture against fixtures.

But then, how do I test "64 KiB boundary" in T032? I test that the capture returns the full oversized message (boundary test = capture handles large messages). And in T033, I can have a separate test or the adapter test verifies truncation.

Actually, let me think about this differently. The task says for T032:
> - Test: 64 KiB boundary

And for T033:
> - Max 64 KiB; truncate if exceeded

So T032 tests the boundary (capture handles it, returns full text), and T033 implements truncation in the adapter. The T032 test against the oversizedMessage fixture confirms the capture returns the full text. The adapter (T033) then truncates.

Wait, but that seems odd - why would the capture return full text and then the adapter truncates? It would be cleaner to have the capture truncate. But the fixture says otherwise.

Let me look at the fixture once more. Actually, I wonder if the `expectedFinalMessage` field is meant to test the raw capture output (before truncation), and there should be a separate `expectedTruncatedFinalMessage` field. But there isn't.

OK, I'll go with the fixture as-is: the capture returns raw text, and the adapter truncates. This is actually a clean separation:
- Capture: pure protocol extraction, returns raw text
- Adapter: enforces 64 KiB limit when building RunExitResult

Let me write T032 now. I'll test the `CodexFinalMessageCapture` class against all fixtures.

Actually, I realize I should also test the truncation in T032 separately, since the task says "Test: 64 KiB boundary". Let me add a test that verifies the capture returns the full text for oversized messages, and a separate test that verifies the truncation helper works.

Wait, but the truncation is in the adapter (T033), not the capture. So T032 should only test the capture. The "64 KiB boundary" test in T032 is that the capture handles oversized messages correctly (returns full text).

Hmm, but then the 64 KiB truncation is only tested in T033 (adapter). Let me check if T033 has tests... T033 says "Implement Codex final-message capture in `codex-cli-adapter.ts`". T033 is implementation, not test. The test for the adapter's truncation would be in... hmm, there's no separate test for T033. The codex-cli-adapter integration test might cover it.

Actually, let me reconsider the architecture. Maybe I should put the truncation in the capture module, and export a separate function for testing. The capture's `getFinalMessage()` returns truncated text. But then the fixture's expectedFinalMessage for oversizedMessage would need to be truncated.

The fixture says `expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)` which is the FULL message. If the capture truncates, this would be `CODEX_FINAL_MESSAGE_MAX_BYTES` characters of "x", not `CODEX_FINAL_MESSAGE_MAX_BYTES + 1`.

So either:
1. The capture doesn't truncate (returns full text), and the fixture is correct.
2. The capture truncates, and the fixture needs to be updated.

The task says "Phase 1 already did partial work" and "Test fixtures exist at `server/tests/helpers/codex-final-message-fixtures.ts`". So the fixtures are pre-existing and I should use them as-is. If the fixture expects full text, the capture returns full text.

I'll go with option 1: capture returns full text, adapter truncates. For T032, I test the capture against fixtures (expecting full text). For the "64 KiB boundary" test, I verify the capture handles oversized messages (returns full text). The truncation is implemented and tested in T033 (adapter level).

Actually, wait. Let me re-read the T032 requirements:
> - Test: 64 KiB boundary

This could mean: test that the capture correctly handles a message at the 64 KiB boundary. The fixture `oversizedMessage` has a message exceeding 64 KiB. The test verifies the capture returns it (full text). That's the boundary test.

OK, I'll proceed with this approach. Let me write T032.

For the capture API, I'll design:
```typescript
export class CodexFinalMessageCapture {
  handleNotification(method: string, params: Record<string, unknown> | undefined): void;
  getFinalMessage(): string | null;  // returns raw text, no truncation
  reset(): void;
}
```

Wait, but I also need to test "delta accumulation is NOT used". How do I test this? The fixture `commentaryPreamble` has delta + commentary + final_answer. The expected final message is just the final_answer text, not accumulated deltas. So the test verifies that deltas are not accumulated.

And "command output stays isolated" - the fixture `commandIsolation` has commandExecution + agentMessage. The expected final message is just the agentMessage text, not including command output.

Let me write the test now.

Actually, I need to think about what the "normalizer" is. The task says "codex-final-message-normalizer.test.ts". The normalizer could be:
1. A pure function that takes an array of notifications and returns the final message.
2. A class that processes notifications one by one and returns the final message.

Option 2 is more realistic (the adapter processes notifications as they arrive). Let me go with a class `CodexFinalMessageCapture`.

But the test file is called "normalizer" not "capture". Let me name the module `codex-final-message-capture.ts` (as I planned) and the test `codex-final-message-normalizer.test.ts` (as the task requires). The test tests the capture module.

Actually, the task says T032 is "Codex final-message normalizer" test. Let me just name the module to match. I'll call it `codex-final-message-capture.ts` since it captures the final message. The test file name is specified by the task.

Let me write the test.

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-07-18T15:32:43Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "completed"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "completed"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "completed"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.
…[truncated])`


> [reasoning] Now the test references `CodexFinalMessageCapture` which doesn't exist yet. Let me implement T033: create the capture module and integrate it into the codex-cli-adapter.

Let me mark T032 as complete (test written) and start T033.
T032 测试已写好。现在实现 T033：创建 capture 模块并集成到 codex adapter。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunRepos
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:32:55Z

- **tool**: `write({"content": "export const CODEX_FINAL_MESSAGE_MAX_BYTES = 64 * 1024;\n\ninterface AgentMessageItem {\n  type?: unknown;\n  phase?: unknown;\n  text?: unknown;\n}\n\nexport class CodexFinalMessageCapture {\n  private finalMessage: string | null = null;\n\n  handleNotification(method: string, params: Record<string, unknown> | undefined): void {\n    if (method !== \"item/completed\") return;\n    if (!params) return;\n    const item = params.item as AgentMessageItem | undefined;\n    if (!item || 
…[truncated])`


> [reasoning] Now let me create the `codex-final-message-capture.ts` module. Based on the design:
- Track `item/completed` notifications where `item.type === "agentMessage"` and `item.phase === "final_answer"`
- Store the `text` field of the last matching item
- Do NOT accumulate `item/agentMessage/delta` notifications
- Do NOT depend on `turn/completed` for the message content
- Max 64 KiB; truncate if exceeded (this is at the adapter level, not capture level - capture returns raw text)

I also need a helper function to truncate the final message to 64 KiB, which the adapter will use.

Let me design the module:

```typescript
export const CODEX_FINAL_MESSAGE_MAX_BYTES = 64 * 1024;

export class CodexFinalMessageCapture {
  private finalMessage: string | null = null;

  handleNotification(method: string, params: Record<string, unknown> | undefined): void {
    if (method !== "item/completed") return;
    if (!params) return;
    const item = params.item;
    if (!item || typeof item !== "object") return;
    const itemObj = item as { type?: unknown; phase?: unknown; text?: unknown };
    if (itemObj.type !== "agentMessage") return;
    if (itemObj.phase !== "final_answer") return;
    if (typeof itemObj.text !== "string") return;
    this.finalMessage = itemObj.text;
  }

  getFinalMessage(): string | null {
    return this.finalMessage;
  }

  reset(): void {
    this.finalMessage = null;
  }
}

export function truncateFinalMessage(text: string | null, maxBytes: number = CODEX_FINAL_MESSAGE_MAX_BYTES): string | null {
  if (text === null) return null;
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}
```

Wait, but the fixtures file already exports `CODEX_FINAL_MESSAGE_MAX_BYTES`. I should import it from there or define it in the capture module and have the fixtures import from the capture module. But the fixtures file already defines it. Let me just define it in the capture module too (or import from fixtures). Actually, it's cleaner to define the constant in the capture module and have both the fixtures and adapter use it. But the fixtures already define it independently.

Let me just define `CODEX_FINAL_MESSAGE_MAX_BYTES` in the capture module and use it. The fixtures file has its own copy for test purposes. That's fine - they're both `64 * 1024`.

Actually, to avoid duplication, let me export `CODEX_FINAL_MESSAGE_MAX_BYTES` from the capture module and have the fixtures import it. But the fixtures file is a test helper that already exists and defines its own constant. I shouldn't modify it (the task says fixtures already exist). Let me just define the constant in the capture module independently.

Now, for the adapter integration (T033):
- The adapter needs to use `CodexFinalMessageCapture` to track final messages
- On `item/completed` with `agentMessage` + `final_answer`, the capture tracks it
- On exit (via `finish()` or `callExit()`), include `finalMessage` (truncated) in RunExitResult
- For non-zero exit, timeout, cancel, escalation: finalMessage = null

Looking at the current codex-cli-adapter.ts, the `item/completed` handler currently only processes `commandExecution` items:

```typescript
if (msg.method === "item/completed") {
  const item = msg.params?.item as { type?: string; aggregatedOutput?: string; id?: string } | undefined;
  if (item?.type === "commandExecution" && typeof item.aggregatedOutput === "string" && item.aggregatedOutput.length > 0) {
    emitOutput("stdout", item.aggregatedOutput, item.id);
  }
  return;
}
```

I need to also feed the notification to the capture. The cleanest way is to call `capture.handleNotification(msg.method, msg.params)` in the notification handler, before the specific method checks.

Actually, looking more carefully, the capture should be fed ALL notifications (it filters internally). But to be precise, I should feed it in the notification handling section. Let me add `capture.handleNotification(msg.method, msg.params)` right after the trace normalization, before the specific method checks.

Wait, but the capture only cares about `item/completed`. I can feed it all notifications and it will filter. Or I can feed it only `item/completed` notifications. Let me feed it all notifications for simplicity (it filters internally).

Actually, looking at the adapter code, the `handleMessage` function processes notifications in the `if (isNotification(msg))` block. I should add `capture.handleNotification(msg.method, msg.params)` at the top of that block, before the specific method checks. This way, the capture sees all notifications and filters internally.

Now, for the exit handling:
- `finish()` is called on turn/completed (success or failure), on escalation, on cancel, on protocol startup failure
- `callExit()` is called on process error, process exit (non-zero, signal, or clean exit without turn/completed)

For success (turn/completed with status=completed): finalMessage should be the captured final message (truncated)
For failure (turn/completed with non-completed status): finalMessage = null
For escalation: finalMessage = null
For cancel: finalMessage = null
For non-zero exit: finalMessage = null
For timeout: finalMessage = null (set by agent-runner, not adapter)
For spawn failure: finalMessage = null

So I need to modify the `finish()` and `callExit()` calls to include the appropriate finalMessage.

The key insight: only the success path (turn/completed with status=completed) should include the captured final message. All other paths should have finalMessage = null.

Let me look at the current `finish()` and `callExit()` calls:

1. `failSpawn()`: `callExit({ ..., finalMessage: null })` - correct (spawn failure)
2. Escalation in approval: `finish({ ..., finalMessage: null })` - correct (escalation)
3. `turn/completed` success: `finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: null })` - needs to include captured finalMessage
4. `turn/completed` failure: `finish({ ..., finalMessage: null })` - correct (parse failure)
5. `item/agentMessage/delta` escalation: `finish({ ..., finalMessage: null })` - correct (escalation)
6. Process error: `callExit({ ..., finalMessage: null })` - correct
7. Process exit non-zero: `callExit({ ..., finalMessage: null })` - correct
8. Process exit signal: `callExit({ ..., finalMessage: null })` - correct
9. Process exit clean (no turn/completed): `callExit({ ..., finalMessage: null })` - hmm, should this include finalMessage? If the process exits cleanly but without turn/completed, should we include the final message? The task says "For non-zero exit, timeout, cancel, escalation: finalMessage = null". Clean exit without turn/completed is not in this list. But it's an unusual case.

Actually, looking at the design §5.1:
> - 取不到 `phase === "final_answer"` 的 agentMessage item 视为 final message 缺失，validator Run 按 `result_unparsable` Blocked。

So if the final message is missing (no agentMessage with final_answer), the finalMessage is null. The capture returns null in this case. So for the clean exit path, I should include `capture.getFinalMessage()` (which might be null if no final_answer was seen).

But wait, the task says "For non-zero exit, timeout, cancel, escalation: finalMessage = null". It doesn't mention "clean exit without turn/completed". Let me think about this...

The design says the final message is captured from `item/completed` with `phase=final_answer`. If the process exits cleanly (exit code 0) but without `turn/completed`, should we include the final message? The current code path for this is:

```typescript
} else {
  callExit({ exitCode: code ?? 0, failureReason: null, errorMessage: null, finalMessage: null });
}
```

This is the case where the process exits with code 0 but `turnCompleted` is false. In this case, the process completed but didn't send `turn/completed`. Should we include the final message? I think yes - if the adapter captured a final message before the process exited, it should be included. But this is an edge case.

Actually, let me be more conservative. The main success path is `turn/completed` with status=completed. For that path, include the captured final message. For all other paths, finalMessage = null. This is the safest approach and matches the task requirements.

Wait, but the task says "On exit (via `finish()` or `callExit()`), include `finalMessage` in the RunExitResult". This suggests that ALL exit paths should include finalMessage (which might be null for failure cases). The key is that for success, finalMessage = captured message; for failure, finalMessage = null.

Let me re-read: "For non-zero exit, timeout, cancel, escalation: finalMessage = null (already set by adapter)". So the adapter sets finalMessage = null for these cases. For success (turn/completed), finalMessage = captured message.

Let me also check: what about the clean exit path (exit code 0 without turn/completed)? The task doesn't mention this. I'll set finalMessage = null for this case too (conservative), since it's an unusual exit path and the turn wasn't properly completed.

Actually, wait. Let me reconsider. If the process exits cleanly but without turn/completed, and a final message was captured, should we include it? The design says the final message is the authority for validator decisions. If the process exits cleanly, the final message might be valid. But without turn/completed, the turn didn't finish properly.

I'll go with: only the `turn/completed` success path includes the captured final message. All other paths have finalMessage = null. This is the most conservative and matches the task requirements.

Now let me implement the capture module and integrate it.

For the `turn/completed` success path, I need to change:
```typescript
finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: null });
```
to:
```typescript
finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: truncateFinalMessage(capture.getFinalMessage()) });
```

And for the `turn/completed` failure path:
```typescript
finish({ exitCode: null, failureReason: FR.OutputParseFailed, errorMessage: ..., finalMessage: null });
```
This stays as null (correct).

Let me create the capture module first.
创建 `codex-final-message-capture.ts` 模块。

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-07-18T15:33:36Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx vitest run tests/unit/codex-final-message-normalizer.test.ts 2>&1 | Select-Object -Last 15", "timeout": 60000})`

现在将 capture 集成到 codex-cli-adapter.ts。先运行 T032 测试确认 capture 模块正确。

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m�?[39m tests/unit/codex-final-message-normalizer.test.ts [2m([22m[2m29 tests[22m[2m)[22m[32m 6[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m29 passed[39m[22m[90m (29)[39m
[2m   Start at [22m 23:33:45
[2m   Duration [22m 834ms[2m (transform 66ms, setup 0ms, collect 188ms, tests 6ms, environment 0ms, prepare 246ms)[22m
  ```
  </details>

## assistant · 2026-07-18T15:33:49Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "import { buildChildEnv } from \"../workspace-context.js\";\nimport { normalizeCodexTraceNotification } from \"./codex-trace-normalizer.js\";\nimport { CodexFinalMessageCapture, truncateFinalMessage } from \"./codex-final-message-capture.js\";", "oldString": "import { buildChildEnv } from \"../workspace-context.js\";\nimport { normalizeCodexTraceNotification } from \"./codex-trace-normaliz
…[truncated])`


> [reasoning] T032 tests pass (29 tests). Now I need to integrate the capture into the codex-cli-adapter.ts. Let me modify the adapter to:

1. Import `CodexFinalMessageCapture` and `truncateFinalMessage`
2. Create a capture instance
3. Feed notifications to the capture in the notification handler
4. On `turn/completed` success, include the truncated captured final message in the RunExitResult
5. All other exit paths keep finalMessage = null

Let me make the edits to codex-cli-adapter.ts.

The file is 352 lines. I need to be careful with the 350-line hard cap. Let me check if my changes will push it over.

Current file is 352 lines. I need to:
- Add 2 import lines (net +2)
- Add 1 line for capture instance creation
- Add 1 line for feeding notification to capture
- Change 1 line for turn/completed success path (finalMessage: null -> finalMessage: truncateFinalMessage(capture.getFinalMessage()))

That's about +4 lines, bringing it to ~356. That's over the 350-line cap.

Wait, the file is already 352 lines, which is OVER the 350-line cap. Hmm. Let me re-read the task: "File limit: 350 lines hard cap". The file is already at 352 lines. I need to be careful not to add too many lines.

Actually, let me count more carefully. The current file has 352 lines (including the final newline). Let me see if I can refactor slightly to stay under 350.

Actually, let me look at what I need to change:
1. Import: add `CodexFinalMessageCapture` and `truncateFinalMessage` to the existing import from `./codex-final-message-capture.js` - this is 1 new line.
2. Create capture instance: add `const finalMessageCapture = new CodexFinalMessageCapture();` - 1 new line.
3. Feed notification: add `finalMessageCapture.handleNotification(msg.method, msg.params);` in the notification handler - 1 new line.
4. Change turn/completed success: change `finalMessage: null` to `finalMessage: truncateFinalMessage(finalMessageCapture.getFinalMessage())` - 0 net new lines (just modifying).

So about +3 lines, bringing it to 355. Still over.

Wait, the file is already over the cap at 352. Let me see if I can remove some comments or consolidate. Actually, the task says "File limit: 350 lines hard cap". The file is ALREADY at 352 lines. This was pre-existing. Let me see if I can reduce lines while making my changes.

Looking at the file, I can potentially consolidate some of the `finalMessage: null` entries. Actually, many of the RunExitResult objects already have `finalMessage: null`. I can't remove those without breaking the type.

Let me look for opportunities to reduce lines:
- The `failSpawn` function could be inlined or simplified
- Some multi-line statements could be condensed

Actually, let me just make my changes and see the final line count. If it's over 350, I'll refactor.

Let me also consider: the import statement. Currently:
```typescript
import { normalizeCodexTraceNotification } from "./codex-trace-normalizer.js";
```

I can add a new import line:
```typescript
import { CodexFinalMessageCapture, truncateFinalMessage } from "./codex-final-message-capture.js";
```

That's +1 line.

Let me think about how to minimize line additions. I could combine the capture instance creation with existing variable declarations. Looking at the code:

```typescript
let threadId: string | null = null;
let turnId: string | null = null;
```

I can add:
```typescript
const finalMessageCapture = new CodexFinalMessageCapture();
```

That's +1 line.

For feeding the notification, I need to add a line in the notification handler block. Currently:

```typescript
if (isNotification(msg)) {
  const traceSignal = normalizeCodexTraceNotification(msg);
  if (traceSignal) {
    for (const cb of traceCallbacks) {
      cb(traceSignal);
    }
  }

  if (msg.method === "turn/completed") {
```

I can add `finalMessageCapture.handleNotification(msg.method, msg.params);` after the trace signal block. That's +1 line.

For the turn/completed success path:
```typescript
finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: null });
```
becomes:
```typescript
finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: truncateFinalMessage(finalMessageCapture.getFinalMessage()) });
```
0 net new lines (same line count).

So total: +3 lines. File goes from 352 to 355.

To get under 350, I need to remove at least 6 lines (to get to 349). Let me look for refactoring opportunities.

Actually, wait. Let me recount the current file. The read output showed "End of file - total 352 lines". But there's a newline at the end. Let me check the actual line count.

Hmm, the read tool shows 352 lines. With my +3 additions, it would be 355. I need to reduce by 6+ lines.

Let me look for consolidation opportunities:

1. The `failSpawn` function (lines 70-73):
```typescript
const failSpawn = (errorMessage: string): RunHandle => {
  callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage, finalMessage: null });
  return createHandle();
};
```
This is 4 lines. Can't really reduce.

2. Multiple `finish()` and `callExit()` calls with `finalMessage: null` are already on single lines.

3. The `emitOutput` function (lines 83-88):
```typescript
const emitOutput = (stream: "stdout" | "stderr", chunk: string, sourceItemId?: string) => {
  sequence++;
  for (const cb of outputCallbacks) {
    cb({ stream, chunk, sequence, ...(sourceItemId ? { sourceItemId } : {}) });
  }
};
```
This is 6 lines. Could be condensed but not easily.

4. The `sendMessage` and `sendRequest` functions are already compact.

5. The `handleMessage` function is the bulk of the file. 

Let me look at the child process exit handler (lines 252-279):
```typescript
childProcess.on("exit", (code, signal) => {
  if (!exited && !turnCompleted) {
    if (escalationTriggered) return;
    if (code !== null && code !== 0) {
      const isCredentialIssue = gitPushAttempted
        && !input.workspace.pushCredentialsEnabled
        && credentialFailureDetected;
      const failureReason: FailureReason = isCredentialIssue
        ? FR.CredentialIsolationBlocked
        : FR.AdapterExitNonzero;
      callExit({
        exitCode: code,
        failureReason,
        errorMessage: `Process exited with code ${code}`,
        finalMessage: null,
      });
    } else if (signal) {
      callExit({
        exitCode: null,
        failureReason: FR.SpawnFailed,
        errorMessage: `Process killed by signal ${signal}`,
        finalMessage: null,
      });
    } else {
      callExit({ exitCode: code ?? 0, failureReason: null, errorMessage: null, finalMessage: null });
    }
  }
});
```

I can condense some of these multi-line callExit calls into single lines:

```typescript
childProcess.on("exit", (code, signal) => {
  if (!exited && !turnCompleted) {
    if (escalationTriggered) return;
    if (code !== null && code !== 0) {
      const isCredentialIssue = gitPushAttempted && !input.workspace.pushCredentialsEnabled && credentialFailureDetected;
      const failureReason: FailureReason = isCredentialIssue ? FR.CredentialIsolationBlocked : FR.AdapterExitNonzero;
      callExit({ exitCode: code, failureReason, errorMessage: `Process exited with code ${code}`, finalMessage: null });
    } else if (signal) {
      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage: `Process killed by signal ${signal}`, finalMessage: null });
    } else {
      callExit({ exitCode: code ?? 0, failureReason: null, errorMessage: null, finalMessage: null });
    }
  }
});
```

This condenses the multi-line callExit calls into single lines, saving several lines. Let me count:
- `const isCredentialIssue` line: was 3 lines, now 1 line (-2)
- `const failureReason` line: was 3 lines, now 2 lines (-1)
- First callExit: was 5 lines, now 1 line (-4)
- Second callExit: was 4 lines, now 1 line (-3)
- Third callExit: already 1 line (0)

Total savings: about -10 lines. That's more than enough.

Let me also look at other multi-line callExit/finish calls that can be condensed:

Lines 131-136 (escalation approval):
```typescript
            finish({
              exitCode: null,
              failureReason: FR.PreExecutionApprovalRejected,
              errorMessage: typeof command === "string" ? command : JSON.stringify(command),
              finalMessage: null,
            });
```
Can be condensed to 1 line:
```typescript
            finish({ exitCode: null, failureReason: FR.PreExecutionApprovalRejected, errorMessage: typeof command === "string" ? command : JSON.stringify(command), finalMessage: null });
```
Saves -4 lines.

Lines 156-163 (turn/completed):
```typescript
            finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: null });
          } else {
            finish({
              exitCode: null,
              failureReason: FR.OutputParseFailed,
              errorMessage: turn.error?.message ?? `Codex turn ${turn.status}`,
              finalMessage: null,
            });
          }
```
The else branch can be condensed:
```typescript
            finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: truncateFinalMessage(finalMessageCapture.getFinalMessage()) });
          } else {
            finish({ exitCode: null, failureReason: FR.OutputParseFailed, errorMessage: turn.error?.message ?? `Codex turn ${turn.status}`, finalMessage: null });
          }
```
Saves -3 lines.

Lines 174-179 (delta escalation):
```typescript
              finish({
                exitCode: null,
                failureReason: FR.PostHocEscalation,
                errorMessage: delta.trim().slice(0, 200),
                finalMessage: null,
              });
```
Can be condensed to 1 line:
```typescript
              finish({ exitCode: null, failureReason: FR.PostHocEscalation, errorMessage: delta.trim().slice(0, 200), finalMessage: null });
```
Saves -4 lines.

Lines 244-249 (process error):
```typescript
      callExit({
        exitCode: null,
        failureReason: FR.SpawnFailed,
        errorMessage: `Process error: ${err.message}`,
        finalMessage: null,
      });
```
Can be condensed to 1 line:
```typescript
      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage: `Process error: ${err.message}`, finalMessage: null });
```
Saves -4 lines.

Lines 307-312 (protocol startup failure):
```typescript
      finish({
        exitCode: null,
        failureReason: FR.OutputParseFailed,
        errorMessage: `Codex protocol startup failed: ${String(err)}`,
        finalMessage: null,
      });
```
Can be condensed to 1 line:
```typescript
      finish({ exitCode: null, failureReason: FR.OutputParseFailed, errorMessage: `Codex protocol startup failed: ${String(err)}`, finalMessage: null });
```
Saves -4 lines.

OK, I have plenty of opportunities to condense. Let me make all the changes now. I'll:
1. Add the import
2. Add the capture instance
3. Add the notification feeding
4. Change the turn/completed success path
5. Condense multi-line finish/callExit calls

Let me do this carefully. I'll rewrite the file to ensure it's under 350 lines.

Actually, let me be more strategic. Instead of making many small edits, let me make targeted edits that add my changes AND condense existing code.

Let me do the edits one by one.

First, add the import:
现在集成 capture 到 codex-cli-adapter.ts。需要添加 import、capture 实例、通知转发，并修改 turn/completed 成功路径。同时压缩多行 callExit/finish 调用以保持在 350 行以内。

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:34:33Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "    let threadId: string | null = null;\n    let turnId: string | null = null;\n    const finalMessageCapture = new CodexFinalMessageCapture();", "oldString": "    let threadId: string | null = null;\n    let turnId: string | null = null;"})`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:34:42Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "      if (isNotification(msg)) {\n        const traceSignal = normalizeCodexTraceNotification(msg);\n        if (traceSignal) {\n          for (const cb of traceCallbacks) {\n            cb(traceSignal);\n          }\n        }\n\n        finalMessageCapture.handleNotification(msg.method, msg.params);\n\n        if (msg.method === \"turn/completed\") {\n          turnCompleted = true;\n  
…[truncated])`

现在在 notification handler 中添加 capture 转发，并修改 turn/completed 成功路径。同时压缩多行 finish/callExit 调用。

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:34:57Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "            sendResponse(msg.id, { decision: \"cancel\" });\n            escalationTriggered = true;\n            finish({ exitCode: null, failureReason: FR.PreExecutionApprovalRejected, errorMessage: typeof command === \"string\" ? command : JSON.stringify(command), finalMessage: null });", "oldString": "            sendResponse(msg.id, { decision: \"cancel\" });\n            escalationT
…[truncated])`


> [reasoning] Now let me condense the escalation approval finish call and the process exit handler.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:35:07Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "    childProcess.on(\"error\", (err) => {\n      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage: `Process error: ${err.message}`, finalMessage: null });\n    });\n\n    childProcess.on(\"exit\", (code, signal) => {\n      if (!exited && !turnCompleted) {\n        if (escalationTriggered) return;\n        if (code !== null && code !== 0) {\n          const isCredent
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:35:20Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "newString": "    }).catch((err) => {\n      finish({ exitCode: null, failureReason: FR.OutputParseFailed, errorMessage: `Codex protocol startup failed: ${String(err)}`, finalMessage: null });\n    });", "oldString": "    }).catch((err) => {\n      finish({\n        exitCode: null,\n        failureReason: FR.OutputParseFailed,\n        errorMessage: `Codex protocol startup failed: ${String(err)}`,\n   
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:35:29Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && (Get-Content src\\runtime\\adapters\\codex-cli-adapter.ts | Measure-Object -Line).Lines"})`
- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx tsc --noEmit 2>&1 | Select-Object -First 20", "timeout": 60000})`


> [reasoning] Let me check the line count of the file now.
检查文件行数和 typecheck。

  <details><summary>tool output</summary>

  ```text
291
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-18T15:35:46Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx vitest run tests/unit/codex-final-message-normalizer.test.ts tests/integration/codex-cli-adapter.test.ts 2>&1 | Select-Object -Last 20", "timeout": 60000})`


> [reasoning] The file is now 291 lines (well under 350) and typecheck passes. Let me run the T032 test and the codex-cli-adapter integration test to make sure everything works.
文件 291 行，typecheck 通过。运行 T032 测试和 codex adapter 集成测试。

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m�?[39m tests/integration/codex-cli-adapter.test.ts [2m([22m[2m5 tests[22m[2m)[22m[33m 5019[2mms[22m[39m
   [33m[2m�?[22m[39m CodexCliAdapter Integration (T053)[2m > [22mexecutes a low-risk instruction through real CodexCliAdapter and completes [33m 972[2mms[22m[39m
   [33m[2m�?[22m[39m CodexCliAdapter Integration (T053)[2m > [22mpersists run.output events from CodexCliAdapter agent_message_delta [33m 1009[2mms[22m[39m
   [33m[2m�?[22m[39m CodexCliAdapter Integration (T053)[2m > [22mpersists run.queued, run.started, run.completed in correct order [33m 999[2mms[22m[39m
   [33m[2m�?[22m[39m CodexCliAdapter Integration (T053)[2m > [22mhandles adapter process 
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:36:07Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "completed"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "completed"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "completed"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.
…[truncated])`


> [reasoning] T032 (29 tests) and codex-cli-adapter integration tests (5 tests) all pass. T033 is complete. 

Now let me move to T034/T035: the AgentRunner/RunService terminal finalMessage persistence.

Let me mark T033 complete and start T034.
T033 完成（29 + 5 测试通过）。现在写 T034 集成测试。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunRep
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:36:21Z

- **tool**: `write({"content": "import { describe, it, expect, beforeEach, afterEach } from \"vitest\";\nimport { createTestServices, disposeTestServices, createTempDir, type TestServices } from \"../helpers.js\";\nimport { FakeAgentAdapter } from \"../../src/runtime/adapters/fake-adapter.js\";\nimport { RunStatus, AdapterStatus, FailureReason } from \"@personahub/shared/types\";\n\nfunction setupIssue(services: TestServices, tempDir: string) {\n  const project = services.projectService.create(\"Test\", \"desc\");
…[truncated])`


> [reasoning] Now let me write T034: the integration test for AgentRunner final message persistence. This test should verify:

1. When adapter emits finalMessage in exit result, it gets persisted to runs.final_message
2. Terminal callback duplicate doesn't overwrite finalMessage
3. finalMessage is persisted BEFORE workflow hook (for validator Run processing)

For test 3, since the workflow hook doesn't exist yet (Phase 7/8), I need to verify that finalMessage is persisted during the terminal transition (transitionToCompleted), which happens before onTerminal callback (which would trigger the workflow hook).

Let me look at the current flow:
1. AgentRunner.handleExit() calls RunService.transitionToCompleted(run.id, exitCode)
2. Then calls onTerminal callback

The workflow hook will be inserted in onTerminal/finalizeAndDrain. So finalMessage must be persisted in step 1.

For the test, I can:
- Use FakeAgentAdapter with finalMessage set
- Dispatch a run
- Wait for completion
- Check that runs.final_message column has the final message (via has_final_message on Run)
- Check that the raw final_message is in the DB (via direct DB query, since Run type only exposes has_final_message)

Let me also verify that the finalMessage is NOT in the public Run API (has_final_message is true, but no final_message field on Run).

For the "terminal callback duplicate doesn't overwrite" test:
- The AgentRunner has a guard `if (activeRun.exited) return;` that prevents duplicate processing
- I can test this by verifying that even if onExit is called twice, the finalMessage is only set once

Actually, looking at the FakeAgentAdapter, it only calls exit callbacks once. To test duplicate, I might need to directly test the AgentRunner's guard. But that's more of a unit test.

For the integration test, let me focus on:
1. finalMessage is persisted to DB when adapter emits it
2. has_final_message is true on the Run
3. finalMessage content is NOT in the public Run object
4. For failed/cancelled runs, has_final_message is false
5. finalMessage is persisted before onTerminal callback (I can verify this by checking that the Run has final_message set when onTerminal is called)

Let me also check: the raw `final_message` column is in the DB but not exposed in the Run type. I can query the DB directly to verify the raw content.

Let me write the test. I'll use the test helpers and FakeAgentAdapter.

For verifying "finalMessage is persisted BEFORE workflow hook", I can use the onTerminal callback to check if finalMessage is already persisted at that point. The onTerminal callback is called after transitionToCompleted but before finalizeAndDrain (which would contain the workflow hook). So if finalMessage is persisted in transitionToCompleted, it will be available when onTerminal is called.

Let me write the test now.

Actually, I realize I need to check how the DB stores final_message. The RunRepository maps `final_message` column to `has_final_message` boolean. To check the raw content, I need to query the DB directly.

Let me write the test:

  <details><summary>tool output</summary>

  ```text
Wrote file successfully.
  ```
  </details>

## assistant · 2026-07-18T15:36:55Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\src", "pattern": "transitionToCompleted"})`
- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\server\\tests", "pattern": "transitionToCompleted"})`


> [reasoning] Now the test will fail because:
1. `transitionToCompleted` doesn't accept a `finalMessage` parameter
2. The `RunRepository.transitionStatus` doesn't support `final_message` in updates
3. The `AgentRunner.handleExit` doesn't pass `result.finalMessage` to `transitionToCompleted`

Let me now implement T035: the terminal finalMessage persistence.

Changes needed:
1. `RunRepository.transitionStatus`: add `final_message?: string | null` to the updates interface
2. `RunService.transitionToCompleted`: add `finalMessage?: string | null` parameter, pass to repo
3. `AgentRunner.handleExit`: pass `result.finalMessage` to `transitionToCompleted`

Let me also check: for the "failed runs" test, the adapter emits finalMessage but the run is failed. The `transitionToFailed` doesn't persist finalMessage, so `has_final_message` should be false. This is correct because `transitionToFailed` doesn't set `final_message`, and the column defaults to null.

Wait, but the test "does not persist finalMessage for failed runs" uses FakeAgentAdapter with `exitCode: 1` and `failureReason: AdapterExitNonzero` and `finalMessage: SAMPLE_FINAL_MESSAGE`. The adapter emits this finalMessage in the exit result. But since the run is failed (not completed), the `transitionToFailed` is called, which doesn't persist finalMessage. So `has_final_message` is false. Good.

But wait, looking at AgentRunner.handleExit, for `exitCode !== 0` with `failureReason`:
```typescript
} else if (result.exitCode !== null && result.exitCode !== 0) {
  this.deps.runService.transitionToFailed(
    run.id,
    FR.AdapterExitNonzero,
    result.exitCode,
    result.errorMessage,
  );
}
```

This calls `transitionToFailed` which doesn't persist finalMessage. So the test should pass (finalMessage is not persisted for failed runs). Good.

For the cancelled run test, the `cancelRun` method in AgentRunner calls `transitionToCancelled`, which also doesn't persist finalMessage. Good.

Now let me implement the changes:

1. `RunRepository.transitionStatus`: add `final_message` to updates
2. `RunService.transitionToCompleted`: add `finalMessage` param
3. `AgentRunner.handleExit`: pass `result.finalMessage`

Let me also check the `transitionToCompleted` signature - it currently takes `(runId, exitCode)`. I need to add `finalMessage` as a third parameter.

For backward compatibility, I should make `finalMessage` optional with default `null`. But actually, the only caller is `AgentRunner.handleExit`, so I can just add the parameter.

Wait, let me check if there are other callers of `transitionToCompleted`.
T034 测试已写好（会失败，因为持久化尚未实现）。现在实现 T035。先查找 `transitionToCompleted` 的所有调用者。

  <details><summary>tool output</summary>

  ```text
Found 3 match(es) in 2 file(s)

D:\Projects\personahub\server\src\services\run.ts
  149: transitionToCompleted(runId: string, exitCode: number): Run | null {

D:\Projects\personahub\server\src\runtime\agent-runner.ts
  263: this.deps.runService.transitionToCompleted(run.id, 0);
  286: this.deps.runService.transitionToCompleted(run.id, result.exitCode ?? 0);

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[], prompt="Search for implementation of Y")
task(subagent_type=
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
Found 1 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\agent-runner-final-message.test.ts
  165: services.runService.transitionToCompleted(run.id, 0);

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
- Age
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:37:16Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts", "newString": "  transitionStatus(\n    id: string,\n    expectedStatus: RunStatus,\n    newStatus: RunStatus,\n    updates: {\n      failure_reason?: FailureReason | null;\n      started_at?: string | null;\n      completed_at?: string | null;\n      exit_code?: number | null;\n      error_message?: string | null;\n      final_message?: string | null;\n    },\n  ): RunTransitionResult {\n    const sets: string[] = [\"sta
…[truncated])`


> [reasoning] The callers of `transitionToCompleted` are:
1. `agent-runner.ts` line 263: `this.deps.runService.transitionToCompleted(run.id, 0);` - this is in the `result.exitCode === 0 && !result.failureReason` path
2. `agent-runner.ts` line 286: `this.deps.runService.transitionToCompleted(run.id, result.exitCode ?? 0);` - this is the fallback/else path
3. My test file line 165: `services.runService.transitionToCompleted(run.id, 0);` - this is the duplicate callback test

For the implementation:
1. `RunRepository.transitionStatus`: add `final_message?: string | null` to the updates interface
2. `RunService.transitionToCompleted`: add `finalMessage?: string | null` parameter (default null for backward compat), pass to repo
3. `AgentRunner.handleExit`: pass `result.finalMessage` to `transitionToCompleted` on both call sites

For the `transitionToCompleted` signature, I'll make `finalMessage` an optional parameter with default `null`:
```typescript
transitionToCompleted(runId: string, exitCode: number, finalMessage: string | null = null): Run | null
```

This way, existing callers that don't pass `finalMessage` will still work (default null).

For the AgentRunner, I need to pass `result.finalMessage` on both call sites:
- Line 263 (exitCode === 0, no failure): `transitionToCompleted(run.id, 0, result.finalMessage)`
- Line 286 (else/fallback): `transitionToCompleted(run.id, result.exitCode ?? 0, result.finalMessage)`

Wait, but the fallback path (line 286) is for cases where `exitCode` is null but there's no failure reason. This could happen when the process exits cleanly without a turn/completed. In this case, should finalMessage be persisted? Looking at the Codex adapter, the clean exit without turn/completed path sets `finalMessage: null`. So `result.finalMessage` would be null. For the Fake adapter, if `finalMessage` is configured, it would be set. But this is an edge case.

Actually, for the Fake adapter, the exit result always includes `finalMessage` (either configured or null). So passing `result.finalMessage` is correct for both paths.

Let me also think about the "else" path (line 286). This path is reached when:
- `result.failureReason` is not an escalation reason
- `result.exitCode` is not 0, OR `result.failureReason` is not null
- `result.failureReason` is not SpawnFailed, ExecutionTimeout
- `result.exitCode` is null or 0

Wait, let me re-read the handleExit logic:

```typescript
if (result.exitCode === 0 && !result.failureReason) {
  this.deps.runService.transitionToCompleted(run.id, 0);
} else if (result.failureReason === FR.SpawnFailed) {
  this.deps.runService.transitionToFailed(run.id, FR.SpawnFailed, result.exitCode, result.errorMessage);
} else if (result.failureReason === FR.ExecutionTimeout) {
  this.deps.runService.transitionToFailed(run.id, FR.ExecutionTimeout, result.exitCode, result.errorMessage);
} else if (result.exitCode !== null && result.exitCode !== 0) {
  this.deps.runService.transitionToFailed(run.id, FR.AdapterExitNonzero, result.exitCode, result.errorMessage);
} else {
  this.deps.runService.transitionToCompleted(run.id, result.exitCode ?? 0);
}
```

The "else" path is reached when:
- exitCode is null or 0 (but not 0 with no failureReason, that's the first if)
- So exitCode is null AND failureReason is not SpawnFailed/ExecutionTimeout
- OR exitCode is 0 AND failureReason is not null but not SpawnFailed/ExecutionTimeout

This is an edge case. For the Fake adapter, if exitCode is null and failureReason is null (e.g., cancel), the exit result has finalMessage = null. So passing result.finalMessage is fine.

Actually wait, looking at the Fake adapter more carefully - the cancel path doesn't go through handleExit (it goes through cancelRun -> transitionToCancelled). The Fake adapter's exit result is only emitted via the exit timer, which uses the configured exitCode/failureReason/finalMessage.

For the "else" path, the finalMessage would typically be null (since it's an edge case). But passing result.finalMessage is still correct - if the adapter emits a finalMessage, it should be persisted.

OK, let me implement the changes now. I'll make `finalMessage` an optional parameter with default null on `transitionToCompleted`, and pass `result.finalMessage` from both call sites in AgentRunner.

For the RunRepository, I need to add `final_message` to the `transitionStatus` updates interface.

Let me implement the changes.
现在实现 T035：修改 RunRepository、RunService 和 AgentRunner。

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:37:47Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run.ts", "newString": "  transitionToCompleted(runId: string, exitCode: number, finalMessage: string | null = null): Run | null {\n    const now = new Date().toISOString();\n    const result = this.runRepo.transitionStatus(runId, RS.Running, RS.Completed, {\n      completed_at: now,\n      exit_code: exitCode,\n      final_message: finalMessage,\n    });", "oldString": "  transitionToCompleted(runId: string, exitCode: number): Run | 
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:37:59Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\agent-runner.ts", "newString": "    if (result.exitCode === 0 && !result.failureReason) {\n      this.deps.runService.transitionToCompleted(run.id, 0, result.finalMessage);\n    } else if (result.failureReason === FR.SpawnFailed) {", "oldString": "    if (result.exitCode === 0 && !result.failureReason) {\n      this.deps.runService.transitionToCompleted(run.id, 0);\n    } else if (result.failureReason === FR.SpawnFailed) {"})`

现在修改 AgentRunner.handleExit 传递 `result.finalMessage`。

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:38:09Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\agent-runner.ts", "newString": "    } else {\n      this.deps.runService.transitionToCompleted(run.id, result.exitCode ?? 0, result.finalMessage);\n    }", "oldString": "    } else {\n      this.deps.runService.transitionToCompleted(run.id, result.exitCode ?? 0);\n    }"})`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:38:19Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx tsc --noEmit 2>&1 | Select-Object -First 20", "timeout": 60000})`


> [reasoning] Now let me also update my test file to pass `finalMessage` explicitly to `transitionToCompleted` in the duplicate callback test. Actually, looking at my test:

```typescript
services.runService.transitionToCompleted(run.id, 0);
```

This is the duplicate callback test. Since `finalMessage` defaults to `null`, this call would try to set `final_message = null`. But the transition would fail (CAS: expected Running, but status is already Completed), so `final_message` wouldn't be overwritten. The test should pass.

Wait, actually, let me re-read the test:

```typescript
it("terminal callback duplicate does not overwrite finalMessage", async () => {
  // ... dispatch run, wait for completion ...
  
  const completedRun = services.runRepo.getById(run.id);
  expect(completedRun!.status).toBe(RunStatus.Completed);
  expect(completedRun!.has_final_message).toBe(true);

  // Attempt duplicate transition (simulating duplicate terminal callback)
  services.runService.transitionToCompleted(run.id, 0);

  const stillCompletedRun = services.runRepo.getById(run.id);
  expect(stillCompletedRun!.has_final_message).toBe(true);
  expect(getRawFinalMessage(services, run.id)).toBe(SAMPLE_FINAL_MESSAGE);
});
```

The second `transitionToCompleted(run.id, 0)` call uses the default `finalMessage = null`. But since the CAS check (`WHERE id = ? AND status = 'running'`) will fail (status is already 'completed'), the UPDATE won't execute. So `final_message` stays as `SAMPLE_FINAL_MESSAGE`. The test should pass.

Actually wait, I need to think about this more carefully. The `transitionToCompleted` call with `finalMessage = null` would try to UPDATE with `final_message = NULL`. But the CAS check fails, so the UPDATE returns 0 changes. The `transitionStatus` method checks `if (result.changes === 0) return { success: false, run: null };`. So the method returns null, and the DB is not modified. Good, the test should pass.

But wait, I should update my test to explicitly pass `null` to make the intent clearer, or pass the finalMessage. Actually, the test is about a "duplicate callback" - in real code, the duplicate would come from the adapter calling onExit twice. But the AgentRunner has a guard (`if (activeRun.exited) return;`) that prevents this. So the duplicate would never reach `transitionToCompleted`.

My test simulates what would happen if somehow `transitionToCompleted` were called twice - the CAS guard prevents the overwrite. This is correct.

Let me now run typecheck and the T034 test.
运行 typecheck 和 T034 测试。

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-18T15:38:44Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx vitest run tests/integration/agent-runner-final-message.test.ts 2>&1 | Select-Object -Last 30", "timeout": 60000})`

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub/server[39m

 [32m�?[39m tests/integration/agent-runner-final-message.test.ts [2m([22m[2m8 tests[22m[2m)[22m[33m 5064[2mms[22m[39m
   [33m[2m�?[22m[39m AgentRunner final-message persistence (T034)[2m > [22mpersists finalMessage to runs.final_message when adapter emits it [33m 536[2mms[22m[39m
   [33m[2m�?[22m[39m AgentRunner final-message persistence (T034)[2m > [22mdoes not expose finalMessage content in public Run object [33m 620[2mms[22m[39m
   [33m[2m�?[22m[39m AgentRunner final-message persistence (T034)[2m > [22msets has_final_message=false when adapter emits null finalMessage [33m 621[2mms[22m[39m
   [33m[2m�?[22m[39m AgentRunner final-message persistence (T034)[2m >
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:39:04Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "completed"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "completed"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "completed"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.
…[truncated])`


> [reasoning] All 8 T034 tests pass. T035 is also done (the implementation changes made the tests pass). Let me mark T034 and T035 as complete and run the full test suite.

Let me also verify the lsp_diagnostics on all changed files first.
T034 全部 8 个测试通过，T035 实现完成。现在运行 LSP 诊断和全量测试。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunRepos
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:39:15Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-cli-adapter.ts", "severity": "error"})`
- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\adapters\\codex-final-message-capture.ts", "severity": "error"})`
- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\agent-runner.ts", "severity": "error"})`
- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\run.ts", "severity": "error"})`
- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\run.ts", "severity": "error"})`
- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\runtime\\types.ts", "severity": "error"})`

## assistant · 2026-07-18T15:39:39Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx vitest run 2>&1 | Select-Object -Last 40", "timeout": 300000})`


> [reasoning] LSP not installed. I'll rely on `tsc --noEmit` (which already passed) and the full test suite. Let me run the full test suite now.
LSP 未安装，依赖 tsc（已通过）和全量测试。运行全量测试。

  <details><summary>tool output</summary>

  ```text
[32m�?[39m tests/integration/run-trace-repository.test.ts [2m([22m[2m7 tests[22m[2m)[22m[33m 789[2mms[22m[39m
 [32m�?[39m tests/integration/issue-creation.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 777[2mms[22m[39m
 [32m�?[39m tests/integration/thread-event-query.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 758[2mms[22m[39m
 [32m�?[39m tests/unit/run-event-payload.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 794[2mms[22m[39m
 [32m�?[39m tests/integration/persistence.test.ts [2m([22m[2m4 tests[22m[2m)[22m[33m 673[2mms[22m[39m
   [33m[2m�?[22m[39m Persistence / Restart Recovery[2m > [22mmultiple projects and issues persist across restart [33m 394[2mms[22m[39m
 [32m�?[39m tests/unit/workspace-lock.test.ts [2m([22m[2m5 tests
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:42:25Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && @(\"src\\runtime\\adapters\\codex-cli-adapter.ts\",\"src\\runtime\\adapters\\codex-final-message-capture.ts\",\"src\\runtime\\adapters\\fake-adapter.ts\",\"src\\runtime\\types.ts\",\"src\\runtime\\agent-runner.ts\",\"src\\services\\run.ts\",\"src\\repositories\\run.ts\",\"tests\\unit\\runtime-final-message.test.ts\",\"tests\\unit\\codex-final-message-normalizer.test.ts\",\"tests\\integration\\agent-runner-final-message.test.ts\") | ForEach-Obje
…[truncated])`
- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && Select-String -Path \"src\\runtime\\adapters\\codex-final-message-capture.ts\",\"src\\runtime\\adapters\\codex-cli-adapter.ts\",\"tests\\unit\\runtime-final-message.test.ts\",\"tests\\unit\\codex-final-message-normalizer.test.ts\",\"tests\\integration\\agent-runner-final-message.test.ts\" -Pattern \"as any|@ts-ignore|@ts-expect-error\" 2>&1"})`


> [reasoning] All 788 tests pass (1 skipped, which is pre-existing). The full test suite passes.

Let me now verify:
- typecheck: passed
- All tests: 788 passed, 1 skipped (pre-existing)

Now I need to:
1. Check the file line counts to ensure all are under 350 lines
2. Check for `as any`, `@ts-ignore`, `@ts-expect-error` in my changes
3. Update tasks.md to check off T030-T035

Let me check the file line counts first.
全部 788 个测试通过（1 个预存 skip）。验证文件行数和代码质量。

  <details><summary>tool output</summary>

  ```text
src\runtime\adapters\codex-cli-adapter.ts : 291 lines
src\runtime\adapters\codex-final-message-capture.ts : 35 lines
src\runtime\adapters\fake-adapter.ts : 127 lines
src\runtime\types.ts : 80 lines
src\runtime\agent-runner.ts : 300 lines
src\services\run.ts : 295 lines
src\repositories\run.ts : 175 lines
tests\unit\runtime-final-message.test.ts : 203 lines
tests\unit\codex-final-message-normalizer.test.ts : 275 lines
tests\integration\agent-runner-final-message.test.ts : 170 lines
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-18T15:42:37Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md", "limit": 12, "offset": 89})`


> [reasoning] All files are under 350 lines, and there are no `as any`, `@ts-ignore`, or `@ts-expect-error` in my new/modified files.

Now I need to update tasks.md to check off T030-T035. Let me read the current Phase 5 section and update it.
所有文件都在 350 行以内，无 `as any`/`@ts-ignore`/`@ts-expect-error`。现在更新 tasks.md 勾选 T030-T035。

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\docs\features\0.1\F004-autonomous-validation\tasks.md</path>
<type>file</type>
<content>
89: ## Phase 5：Adapter/Runner Final Message Contract
90: 
91: - [ ] **T030**（`FR-003`）：先添加runtime contract测试，覆盖RunExitResult.finalMessage、Fake pending exit、missing capability和正文不进入public Run API。
92: - [ ] **T031**（`FR-003`）：扩展runtime/shared内部types和Fake adapter finalMessage。
93: - [ ] **T032**（`FR-003`, `NFR-003`）：用Phase 1 fixture添加Codex final-message normalizer单元测试，覆盖delta/complete、重复、command隔离、limit和malformed。
94: - [ ] **T033**（`FR-003`）：实现Codex final-message capture并交给RunExitResult；raw protocol不落库。
95: - [ ] **T034**（`FR-003`, `NFR-001`）：添加AgentRunner/Run terminal集成测试，确保final message在workflow hook前持久化，terminal callback重复不覆盖。
96: - [ ] **T035**（`FR-003`）：接入AgentRunner/Ru
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:42:46Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md", "newString": "## Phase 5：Adapter/Runner Final Message Contract\n\n- [x] **T030**（`FR-003`）：先添加runtime contract测试，覆盖RunExitResult.finalMessage、Fake pending exit、missing capability和正文不进入public Run API。\n  - 12 tests in `server/tests/unit/runtime-final-message.test.ts`：RunExitResult.finalMessage 字段 set/null、Fake adapter 发射 finalMessage（含 Unicode）、supportsFinalMessage capability（默认 true/可禁用）、Run 类型只有 
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:43:06Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md", "newString": "updated: 2026-07-18\n---\n\n# F004：Autonomous Validation - 任务", "oldString": "updated: 2026-07-18\n---\n\n# F004：Autonomous Validation - 任务\n"})`


> [reasoning] Now let me also update the `updated` date in the tasks.md frontmatter since I modified it.
更新 tasks.md 的 `updated` 日期。

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-07-18T15:43:17Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.1\\F004-autonomous-validation\\tasks.md", "limit": 10})`


> [reasoning] Wait, that edit was wrong. I accidentally removed the trailing newline. Let me check what happened.

Actually, looking at the edit more carefully, the oldString and newString are essentially the same except for the trailing newline. This was a no-op edit. Let me verify the file is still correct.

Actually, the `updated` date is already `2026-07-18`, which is today's date. So no change needed. Let me verify the tasks.md is correct by reading the Phase 5 section.

Actually, I made a mistake - the edit was unnecessary and might have caused issues. Let me check.

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

(Showing lines 1-10 of 226. Use offset=11 to continue.)
</content>
  ```
  </details>

## assistant · 2026-07-18T15:43:26Z

- **tool**: `bash({"command": "set CI=\"true\" && set DEBIAN_FRONTEND=\"noninteractive\" && set GIT_TERMINAL_PROMPT=\"0\" && set GCM_INTERACTIVE=\"never\" && set HOMEBREW_NO_AUTO_UPDATE=\"1\" && set GIT_EDITOR=\":\" && set EDITOR=\":\" && set VISUAL=\"\" && set GIT_SEQUENCE_EDITOR=\":\" && set GIT_MERGE_AUTOEDIT=\"no\" && set GIT_PAGER=\"cat\" && set PAGER=\"cat\" && set npm_config_yes=\"true\" && set PIP_NO_INPUT=\"1\" && set YARN_ENABLE_IMMUTABLE_INSTALLS=\"false\" && cd D:\\Projects\\personahub && git status -
…[truncated])`
- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && npx tsc --noEmit 2>&1 | Select-Object -First 5", "timeout": 60000})`


> [reasoning] The file looks correct. The frontmatter is fine. Let me now do a final verification: run typecheck once more and verify the test count.

Actually, I already ran typecheck (passed) and the full test suite (788 passed, 1 skipped). Let me do one final check to make sure everything is clean.

Let me verify the git status to see what files were changed.
文件正确。最后做一次完整验证：typecheck + 确认 git 变更。

  <details><summary>tool output</summary>

  ```text
M docs/features/0.1/F004-autonomous-validation/tasks.md
 M server/src/api/errors.ts
 M server/src/db/migrations.ts
 M server/src/id.ts
 M server/src/repositories/agent-config.ts
 M server/src/repositories/issue.ts
 M server/src/repositories/run.ts
 M server/src/repositories/validation-policy.ts
 M server/src/repositories/workflow-template.ts
 M server/src/runtime/adapters/codex-cli-adapter.ts
 M server/src/runtime/adapters/fake-adapter.ts
 M server/src/runtime/agent-runner.ts
 M server/src/runtime/types.ts
 M server/src/services/adapter-config.ts
 M server/src/services/run.ts
 M server/tests/integration/issue-blocked.test.ts
 M server/tests/integration/migration.test.ts
 M server/tests/integration/persistence.test.ts
 M server/tests/integration/run-timeout.test.ts
 M shared/src/errors/inde
…[truncated]
  ```
  </details>

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-18T15:43:43Z

- **tool**: `bash({"command": "cd D:\\Projects\\personahub\\server && Select-String -Path \"src\\runtime\\adapters\\codex-cli-adapter.ts\",\"src\\runtime\\adapters\\fake-adapter.ts\",\"src\\runtime\\agent-runner.ts\",\"src\\runtime\\types.ts\",\"src\\services\\run.ts\",\"src\\repositories\\run.ts\",\"tests\\integration\\run-timeout.test.ts\" -Pattern \"as any|@ts-ignore|@ts-expect-error\" 2>&1"})`


> [reasoning] The git status shows many modified and untracked files. This is because the repository has prior Phase 1-4 work that hasn't been committed yet. My changes for Phase 5 are:

Modified files (my changes):
- `server/src/repositories/run.ts` - added final_message to transitionStatus
- `server/src/runtime/adapters/codex-cli-adapter.ts` - integrated capture, added supportsFinalMessage
- `server/src/runtime/adapters/fake-adapter.ts` - added supportsFinalMessage option
- `server/src/runtime/agent-runner.ts` - pass result.finalMessage to transitionToCompleted
- `server/src/runtime/types.ts` - added supportsFinalMessage to AgentAdapterCapabilities
- `server/src/services/run.ts` - added finalMessage param to transitionToCompleted
- `server/tests/integration/run-timeout.test.ts` - added supportsFinalMessage: false to HangingAgentAdapter
- `docs/features/0.1/F004-autonomous-validation/tasks.md` - checked off T030-T035

New files (my changes):
- `server/src/runtime/adapters/codex-final-message-capture.ts` - new capture module
- `server/tests/unit/runtime-final-message.test.ts` - T030 test
- `server/tests/unit/codex-final-message-normalizer.test.ts` - T032 test
- `server/tests/integration/agent-runner-final-message.test.ts` - T034 test

The other modified/untracked files are from prior phases (Phase 1-4) that were already done but not committed.

Typecheck passes (no output = success).

All tests pass (788 passed, 1 skipped).

Let me do a final summary of what was implemented and mark the todo as complete.

Let me also double-check that I haven't introduced any issues with the `as any` check on ALL my modified files (not just the new ones).
Typecheck 通过。让我对所有修改的文件做最终的 `as any`/`@ts-ignore` 检查。

  <details><summary>tool output</summary>

  ```text
(no output)
  ```
  </details>

## assistant · 2026-07-18T15:43:57Z

- **tool**: `todowrite({"todos": [{"content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities", "priority": "high", "status": "completed"}, {"content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试", "priority": "high", "status": "completed"}, {"content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures", "priority": "high", "status": "completed"}, {"content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.
…[truncated])`


> [reasoning] No `as any`, `@ts-ignore`, or `@ts-expect-error` in any of my modified files. Everything is clean.

Let me mark the final todo as complete and provide a summary.
全部检查通过。标记最终 todo 完成。

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "T031: 扩展 AgentAdapterCapabilities 添加 supportsFinalMessage，更新 Fake/Codex adapter capabilities",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T030: 编写 server/tests/unit/runtime-final-message.test.ts 运行时契约测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T032: 编写 server/tests/unit/codex-final-message-normalizer.test.ts 使用 fixtures",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T033: 实现 codex-final-message-capture.ts 并集成到 codex-cli-adapter.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T034: 编写 server/tests/integration/agent-runner-final-message.test.ts 集成测试",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "T035: 实现 RunRepos
…[truncated]
  ```
  </details>

## assistant · 2026-07-18T15:44:07Z

F004 Phase 5（T030-T035）实现完成。

## 总结

### 新增文件
| 文件 | 行数 | 说明 |
|---|---|---|
| `server/src/runtime/adapters/codex-final-message-capture.ts` | 35 | `CodexFinalMessageCapture` 类（只认 `item/completed`+`agentMessage`+`phase=final_answer`，取最后一条 text，不累加 delta）+ `truncateFinalMessage`（64 KiB 截断） |
| `server/tests/unit/runtime-final-message.test.ts` | 203 | T030：12 个运行时契约测试 |
| `server/tests/unit/codex-final-message-normalizer.test.ts` | 275 | T032：29 个 normalizer 单元测试（10 fixture + 边界/malformed） |
| `server/tests/integration/agent-runner-final-message.test.ts` | 170 | T034：8 个 terminal 持久化集成测试 |

### 修改文件
| 文件 | 变更 |
|---|---|
| `server/src/runtime/types.ts` | `AgentAdapterCapabilities` 新增 `supportsFinalMessage: boolean` |
| `server/src/runtime/adapters/fake-adapter.ts` | 新增 `supportsFinalMessage` option，capabilities 设 `true` |
| `server/src/runtime/adapters/codex-cli-adapter.ts` | 集成 capture，`turn/completed` 成功路径包含截断后的 finalMessage，其余 terminal 路径 null；压缩至 291 行 |
| `server/src/runtime/agent-runner.ts` | `handleExit` 两处 `transitionToCompleted` 传递 `result.finalMessage` |
| `server/src/services/run.ts` | `transitionToCompleted` 新增 `finalMessage` 参数（默认 null） |
| `server/src/repositories/run.ts` | `transitionStatus` updates 新增 `final_message` 字段 |
| `server/tests/integration/run-timeout.test.ts` | HangingAgentAdapter 设 `supportsFinalMessage: false` |
| `docs/.../tasks.md` | T030-T035 勾选并添加实现说明 |

### 验证结果
- `npx tsc --noEmit`：通过
- `npx vitest run`：**788 passed**, 1 skipped（预存）
- 所有文件 ≤ 350 行
- 无 `as any` / `@ts-ignore` / `@ts-expect-error`

### 关键设计决策
1. **capture 层不截断**：`CodexFinalMessageCapture.getFinalMessage()` 返回原始 text，匹配 fixture 的 `expectedFinalMessage`；64 KiB 截断由 `truncateFinalMessage` 在 adapter 构建 `RunExitResult` 时执行
2. **仅成功路径持久化**：只有 `turn/completed` 成功路径包含 capture 的 finalMessage；非零退出/超时/取消/escalation 均为 null
3. **CAS 防覆盖**：duplicate terminal callback 通过 `transitionStatus` 的 `WHERE status = 'running'` CAS 守卫，不会覆盖已持久化的 finalMessage
4. **F003 顺序不变**：`finalizeAndDrain`（trace finalize → release lock → drain queue）顺序未改动，finalMessage 在 `transitionToCompleted`（onTerminal 之前）持久化
