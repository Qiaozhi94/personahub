---
tool: "opencode"
tool_name: "OpenCode"
session_id: "ses_019efdfd4ffeO4PfN4dX6VfSyf"
title: "F008 template admin backend (@Sisyphus-Junior subagent)"
project: "D:/Projects/personahub"
model: "glm-5.2"
created_at: "2026-08-09T10:27:24Z"
updated_at: "2026-08-09T10:48:41Z"
tokens_input: 163907
tokens_output: 56172
cost: 0.0
parent_id: "ses_019fcd1b2ffeVhLjSmKAXA2M0m"
---

# F008 template admin backend (@Sisyphus-Junior subagent)

## user · 2026-08-09T10:27:24Z

You are implementing the BACKEND for F008 "Workflow Template Admin" (Phases 1-3) in the PersonaHub monorepo at D:\Projects\personahub. This is part of a larger parallel effort — you must NOT touch files owned by the parallel runtime-health agent (run-dispatch.ts, adapter-config.ts, adapter-failure-reprobe.ts, and anything under runtime health). You also must NOT edit the shared wiring files `server/src/index.ts` and `server/src/api/index.ts` (integration is done by the orchestrator after you finish). You MAY edit any other server file.

## READ FIRST (mandatory, in order)
1. `docs/features/0.2/F008-workflow-template-admin-runtime-health/spec.md`
2. `docs/features/0.2/F008-workflow-template-admin-runtime-health/design.md`
3. `docs/features/0.2/F008-workflow-template-admin-runtime-health/tasks.md`
4. `docs/features/README.md` (review checklist conventions)
Read these fully. The design doc has many "初稿漏洞已修正" notes — these are the crux of correctness. Follow them EXACTLY.

## FOUNDATION ALREADY DONE — do NOT redo, DO use
- `shared/src/errors/index.ts`: ErrorCodes already added: TEMPLATE_NOT_FOUND, TEMPLATE_STEPS_INVALID, VALIDATION_DISABLE_NOT_ACKNOWLEDGED, TEMPLATE_FIELD_NOT_EDITABLE, TEMPLATE_VERSION_CONFLICT, LAST_ACTIVE_TEMPLATE.
- `server/src/api/errors.ts`: error→status map already wired for those codes.
- `server/src/db/schema-v10.ts`: admin_audit_events table + `idx_workflow_templates_issue_type_version` (UNIQUE(issue_type,version)) + `idx_workflow_templates_one_active` (partial UNIQUE where status='active') — already created and wired into `migrations.ts` (v10). Do NOT re-add.
- `shared/src/types/f008.ts`: already has WorkflowTemplateVersionSummary, WorkflowTemplateStep, WorkflowTemplateDetail, WorkflowTemplateListResponse, WorkflowTemplateDetailResponse, CreateWorkflowTemplateVersionInput, CreateWorkflowTemplateVersionResponse, ActivateWorkflowTemplateInput, ActivateWorkflowTemplateResponse, DeactivateWorkflowTemplateResponse — exported from shared/src/index.ts. Reuse these exact shapes.

## KEY EXISTING CODE CONTEXT
- `server/src/repositories/workflow-template.ts`: currently only `getDefault()` and `getById()`. Extend this class (same file) with the new methods. Row interface + mapRow already exist.
- `server/src/services/validation/validator-selector.ts`: exports `parseWorkflowSteps(stepsJson: string|null): WorkflowStep[]` (throws ValidatorSelectorError("invalid_steps_json",...)) and `hasValidationStep(steps: WorkflowStep[]): boolean`. `WorkflowStep` = {id, role}. REUSE these for the `validation_enabled` projection — do NOT write a second parser (AC-001). Runtime interpretation keeps using the loose `parseWorkflowSteps()` untouched.
- `server/src/services/issue.ts`: `IssueService.create()` uses `workflowTemplateRepo.getDefault()` — do not break it (regression).
- `server/src/repositories/issue.ts` has `getById` — use to read a workspace/issue's workflow_template_id.
- Existing repo pattern: constructor `constructor(private db: Database.Database)`. Existing service pattern uses `AppError` from `../api/errors.js` with `ErrorCode` from `@personahub/shared/errors`. Look at `server/src/services/adapter-config.ts` and `server/src/api/routes/adapters.ts` for service + route style. Route boundary uses zod + `parseRequestBody` from `../api/errors.js`.
- Transactions: `this.db.transaction(() => {...})()` pattern (see adapter-config.ts delete, run-dispatch.ts).

## WHAT TO BUILD

### 1. WorkflowTemplateRepository (extend server/src/repositories/workflow-template.ts)
- `listByIssueType(issueType: string): WorkflowTemplate[]` — all versions ordered by version (asc or desc, pick asc for history).
- `listVersions(issueType)` — alias or same as listByIssueType.
- `insertVersion(source: WorkflowTemplate, input: {name, steps_json}, activate: boolean, newId: string, version: number): WorkflowTemplate` — inserts a NEW row with `version = max(version)+1` for that issue_type, computing version INSIDE the same transaction as the INSERT (the caller passes a transaction db or you compute here — design requires max+1 and INSERT in the same transaction; see T020). `issue_type` and the four non-editable fields (collaboration_topology, validation_policy_id, handoff_policy_json, evidence_requirements_json) and agent_team_template_id are COPIED from `source`. `name`/`steps_json` come from input. `status` = active or inactive per `activate`.
- `activate(id)` and `deactivate(id)` — the two semantic commands (NO generic setStatus). activate: within one transaction, set ALL active rows of that issue_type to inactive, then set this row to active; reject if steps_json NULL/invalid (service-level, see gate). deactivate: reject if this is the last active template of its issue_type.
- You may need a helper to get max version and current active row for an issue_type. Use the raw rows; reuse mapRow.

### 2. Strict validator — NEW file `server/src/services/validation/validate-steps-schema.ts` (or similar)
Export `validateStepsSchema(stepsJson: string | null): void` (throws AppError with TEMPLATE_STEPS_INVALID + specific parse message) — used ONLY as the activation write-gate. It must STRICTLY reject (T023c): unsupported/missing schema_version, unknown role, malformed/empty steps, duplicate step ids, unexpected fields. It must NOT reuse the loose parseWorkflowSteps (that silently filters malformed entries and ignores schema_version). Keep parseWorkflowSteps untouched.

### 3. New service `server/src/services/workflow-template-admin.ts` — `WorkflowTemplateAdminService`
Constructor deps: `workflowTemplateRepo`, `db`, plus an audit repo (below). Methods:
- `list(issueType: string): WorkflowTemplateVersionSummary[]` — for each version, compute `validation_enabled` via parseWorkflowSteps+hasValidationStep (null + parse_error when invalid — see detail, but summary's validation_enabled can be null; put the parse error only in detail).
- `detail(id: string): WorkflowTemplateDetail` — returns steps list + `validation_enabled`. When steps_json invalid/NULL, `parseWorkflowSteps` throws → catch and return `validation_enabled: null` + `parse_error` message; the detail request must NOT fail (T012). Also include all raw fields (collaboration_topology, validation_policy_id, handoff_policy_json, evidence_requirements_json, agent_team_template_id). 404 TEMPLATE_NOT_FOUND if missing.
- `createVersion(sourceId: string, input: CreateWorkflowTemplateVersionInput): WorkflowTemplateDetail` — 404 if source missing. Only `name` and `steps_json` accepted; if request carries collaboration_topology/validation_policy_id/handoff_policy_json/evidence_requirements_json → 400 TEMPLATE_FIELD_NOT_EDITABLE (T020/T020c). If `activate` is true, run the full activation gate (see below). If activate false, save as inactive draft (allow invalid steps_json). Write an admin_audit_event in the same transaction (action 'template.version_created'). version = max+1 in same transaction; if unique index conflict (concurrent max+1 collision) → map to 409 TEMPLATE_VERSION_CONFLICT, not a 500 (T020b).
- `activate(id: string, acknowledge?: boolean): WorkflowTemplateDetail` — 404 if missing. Implements the activation GATE MATRIX (T030b) based on the CURRENTLY-ACTIVE template (re-read inside the transaction, NOT the request-time snapshot — T030d), NOT the inheritance source:
  - target steps_json NULL or invalid → reject TEMPLATE_STEPS_INVALID (unconditional; T023d)
  - currently-active is valid AND target disabled validation (no validator step) → require `acknowledge_validation_disabled: true` else 400 VALIDATION_DISABLE_NOT_ACKNOWLEDGED + consequence message
  - currently-active is invalid AND target is valid → require `acknowledge_validation_disabled: true`, audit "before" value = unknown, allow activation (escape hatch, T023e)
  - both invalid → reject (covered by first row)
  - (target valid + keeps validator → no acknowledge needed)
  Same-transaction: deactivate all sibling active rows, activate target, write audit (action 'template.activated', record acknowledge + before/after validation_enabled).
- `deactivate(id: string): WorkflowTemplateDetail` — 404 if missing; reject 409 LAST_ACTIVE_TEMPLATE if it's the last active for its issue_type (T023). Write audit (action 'template.deactivated').
- `acknowledge` semantics: the flag lives on the request; audit `details_json` records `acknowledge_validation_disabled` and validation_enabled before/after.

CRITICAL (T030c): inheritanceSource (:sourceId) and currentlyActive are SEPARATE. All destructive judgments, acknowledge requirements, and audit "before" values key off `currentlyActive` (re-read inside txn). Cloning from an old inactive v1 with no validator while current active v3 has a validator MUST still require acknowledge.

### 4. Audit repo — NEW file `server/src/repositories/admin-audit-event.ts`
`AdminAuditEventRepository` with `insert({id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at})`. actor_type = 'local_user', actor_id always null (no auth). Called INSIDE the same transaction as the template mutation (T031). Atomicity: audit insert failure must roll back the template change (T031b).

### 5. API routes — NEW file `server/src/api/routes/workflow-templates.ts` (FastifyPluginAsync)
- `GET /api/workflow-templates?issue_type=coding` → { templates } (list)
- `GET /api/workflow-templates/:id` → { template } (detail) — 404 TEMPLATE_NOT_FOUND
- `POST /api/workflow-templates/:sourceId/versions` — body zod: `{name?, steps_json? (string|null), activate? (bool), acknowledge_validation_disabled? (bool)}`. Reject extra fields that are non-editable → 400 TEMPLATE_FIELD_NOT_EDITABLE. Errors per design §8 matrix.
- `POST /api/workflow-templates/:id/activate` — body `{acknowledge_validation_disabled?}` → { template }
- `POST /api/workflow-templates/:id/deactivate` → { template }
Use `parseRequestBody`. Route options: `{ workflowTemplateAdminService }`. Follow adapters.ts style exactly (zod schemas at top, typed options interface).

### 6. Tests (Vitest, server/tests/) — write to `server/tests/integration/workflow-template-admin.test.ts` and/or unit files. Cover the task IDs below. Build services against a real in-memory `Database` with `applyMigrations`. For route-level tests, construct a minimal Fastify app registering ONLY your route plugin (do not require server/src/index.ts). Cover:
- T010/T011/T012/T013 (detail projection same-source with validator-selector; invalid steps → validation_enabled null + parse_error, request doesn't fail; per-steps consistency)
- T020 (createVersion: only name/steps_json accepted; non-editable field → TEMPLATE_FIELD_NOT_EDITABLE; new id, version=max+1 same txn; issue_type + 4 non-editable fields inherited from source)
- T020b (concurrent createVersion both computing max+1 → unique index catches → TEMPLATE_VERSION_CONFLICT mapped as user error, not 500)
- T020c (non-editable fields have no runtime consumer → they're read-only, inherited)
- T021 (insertVersion activate:true deactivates siblings same txn → single active)
- T022 (edit template referenced by in-progress issue → original row content unchanged field-by-field; issue.workflow_template_id unchanged)
- T023 (deactivate last active → LAST_ACTIVE_TEMPLATE user-level reject; activate/deactivate replace setStatus)
- T023b (single-active invariant: activate old version, double-activate different versions, activate + insertVersion({activate:true}) interleaved → at most one active at every point)
- T023c (validateStepsSchema rejects: unsupported schema_version, unknown role, malformed/empty steps, duplicate step id, unexpected fields; loose parseWorkflowSteps untouched for runtime)
- T023d (activate hard-rejects NULL/invalid steps; inactive draft may still save invalid)
- T023e (source invalid + target valid → activate requires acknowledge, audit before=unknown, allowed)
- T030 (activating a version that removed validator step requires acknowledge → else 400 + consequence)
- T030b (four-row matrix per design §6)
- T030c (from inactive old v1 no-validator, current active v3 has validator → still requires acknowledge)
- T030d (activate re-reads current active inside txn, not request-time snapshot)
- T031 (audit written same txn with action/target/version/acknowledge/before+after validation_enabled; actor_id null)
- T031b (inject audit insert failure → template change rolls back too)
- T032 (after enabling a template that disabled validation, a new Issue's implementation run completing does NOT trigger validation — verify against validator-selector behavior / IssueService.create default template selection)
- T024 (getDefault() regression: new inactive version doesn't change default; only after activate)

## MUST DO
- Match existing repo/service/route/test conventions exactly (read the reference files listed above).
- Reuse `parseWorkflowSteps` + `hasValidationStep` for the validation_enabled projection (AC-001) — never duplicate parsing.
- `version = max+1` computed and INSERTed in the SAME transaction (T020, T020b).
- Activation gate uses currentlyActive re-read in-txn; never the inheritance source (T030c/T030d).
- Audit write same transaction as the template mutation (T031/T031b); actor_id null.
- Non-editable fields present in request body → 400 TEMPLATE_FIELD_NOT_EDITABLE (T020, AC-008).
- No generic setStatus; only activate()/deactivate()/insertVersion({activate}) (T023).
- All write operations that mutate a template also write an admin_audit_event.
- Run `npx vitest run` scoped to your new test files until green; ensure `npm -w @personahub/server run typecheck` passes for your files.

## MUST NOT DO
- Do NOT modify server/src/index.ts or server/src/api/index.ts (orchestrator wires them).
- Do NOT touch runtime-health files (run-dispatch.ts, adapter-config.ts, adapter-failure-reprobe.ts) or create RuntimeHealthService.
- Do NOT touch shared/ files (already done).
- Do NOT edit schema-v10.ts or migrations.ts (already done).
- Do NOT use `as any`, `@ts-ignore`, `@ts-expect-error`.
- Do NOT add new npm dependencies.
- Do NOT refactor unrelated code while implementing.
- Do NOT add unnecessary comments; only minimal necessary ones (match file conventions like the `// F00x:` grouping style).

## DELIVERABLE
All new/modified source files + passing tests. At the end, report: which task IDs are done and verified, which test files you created, the exact constructor signature of WorkflowTemplateAdminService (so the orchestrator can wire it), and the exact registerRoutes call + Services interface additions needed in server/src/index.ts and server/src/api/index.ts (as a snippet you did NOT apply). Verify with lsp_diagnostics on changed files and the scoped vitest run.
<!-- OMO_INTERNAL_INITIATOR -->

## assistant · 2026-08-09T10:27:24Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F008-workflow-template-admin-runtime-health\\spec.md"})`


> [reasoning] Let me start by reading the mandatory documents in order. I'll read them in parallel since they're independent reads.
I'll start by reading the mandatory documentation files in order.

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

## assistant · 2026-08-09T10:27:30Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F008-workflow-template-admin-runtime-health\\design.md"})`


> [reasoning] Let me read the design and tasks docs.

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

## assistant · 2026-08-09T10:27:37Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\docs\\features\\0.2\\F008-workflow-template-admin-runtime-health\\tasks.md"})`

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

## assistant · 2026-08-09T10:27:43Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\workflow-template.ts"})`


> [reasoning] Now let me explore the existing code structure. I need to read the key existing files mentioned in the task. Let me do this in parallel.
Now let me explore the existing code structure in parallel.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\workflow-template.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { WorkflowTemplate, IssueType } from "@personahub/shared/types";
3:
4: interface WorkflowTemplateRow {
5:   id: string;
6:   name: string;
7:   issue_type: string;
8:   collaboration_topology: string | null;
9:   agent_team_template_id: string | null;
10:   validation_policy_id: string | null;
11:   steps_json: string | null;
12:   handoff_policy_json: string | null;
13:   evidence_requirements_json: string | null;
14:   status: string;
15:   version: number;
16:   created_at: string;
17:   updated_at: string;
18: }
19:
20: function mapRow(row: WorkflowTemplateRow): WorkflowTemplate {
21:   return {
22:     id: row.id,

…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:27:49Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\validation\\validator-selector.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\validation\validator-selector.ts</path>
<type>file</type>
<content>
1: import {
2:   AdapterRole,
3:   AgentCapability,
4:   type AdapterConfig,
5:   type WorkflowTemplate,
6: } from "@personahub/shared/types";
7: import { ValidationBlockReason } from "@personahub/shared/types";
8: import { hasCapability } from "../../repositories/agent-config.js";
9:
10: export class ValidatorSelectorError extends Error {
11:   constructor(
12:     public readonly code: string,
13:     message: string,
14:   ) {
15:     super(message);
16:     this.name = "ValidatorSelectorError";
17:   }
18: }
19:
20: export interface WorkflowStep {
21:   id: string;
22:   role: string;
23: }
24:
25: interface StepsJson {
26:   schema_version?: number;
27:   steps?: Wor
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:27:55Z

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

## assistant · 2026-08-09T10:28:01Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\adapter-config.ts"})`

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

## assistant · 2026-08-09T10:28:07Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\adapters.ts"})`

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

## assistant · 2026-08-09T10:28:14Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\f008.ts"})`


> [reasoning] Now let me read the shared types and errors, schema-v10, migrations, issue service, and a sample existing test to understand conventions.
Let me read the shared types, errors, schema, and existing tests in parallel.

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

## assistant · 2026-08-09T10:28:20Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\errors\\index.ts"})`

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

## assistant · 2026-08-09T10:28:27Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\schema-v10.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\db\schema-v10.ts</path>
<type>file</type>
<content>
1: export const SCHEMA_V10 = `
2: -- F008: Workflow Template Admin & Runtime Health.
3: -- admin_audit_events: global audit ledger for workflow-template mutations. The
4: -- table carries no project_id / workspace_id because workflow_templates itself
5: -- has neither (schema-v1) — template edits happen before any affected Issue
6: -- exists, so there is no thread_event row to attach the audit to. actor_id is
7: -- always NULL: the app has no auth, so the ledger answers "when/what/which
8: -- version/what was acknowledged", never "who" (design §7).
9:
10: CREATE TABLE IF NOT EXISTS admin_audit_events (
11:   id TEXT PRIMARY KEY,
12:   action TEXT NOT NULL,
13:   target_type TEXT NOT NULL,
14:   tar
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:28:34Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\migrations.ts"})`

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

## assistant · 2026-08-09T10:28:40Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\issue.ts"})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\services\issue.ts</path>
<type>file</type>
<content>
1: import type Database from "better-sqlite3";
2: import type { Issue, IssueWithThread, Thread, ThreadSummary } from "@personahub/shared/types";
3: import {
4:   IssueType, IssueStatus, IssuePriority, ThreadType,
5:   ThreadEventType, ActorType,
6: } from "@personahub/shared/types";
7: import { ErrorCode } from "@personahub/shared/errors";
8: import type { IssueRepository } from "../repositories/issue.js";
9: import type { ThreadRepository } from "../repositories/thread.js";
10: import type { ThreadEventRepository } from "../repositories/thread-event.js";
11: import type { ProjectRepository } from "../repositories/project.js";
12: import type { WorkflowTemplateRepository } from "../repositories/wor
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:28:44Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\issue.ts"})`


> [reasoning] Now let me look at the issue repository, an existing test file, the schema-v1 for workflow_templates seed, and run-dispatch.ts for transaction patterns. Let me also look at the index.ts files I'm NOT supposed to edit but need to know about for the snippet.
Let me read the issue repo, a sample test, the schema-v1 for workflow_templates seed, and the index files (read-only to understand wiring).

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

## assistant · 2026-08-09T10:28:53Z

- **tool**: `glob({"pattern": "server/tests/**/*.test.ts"})`

  <details><summary>tool output</summary>

  ```text
Found 100 file(s)

D:\Projects\personahub\server\tests\integration\migration-v10.test.ts
D:\Projects\personahub\server\tests\integration\persistence.test.ts
D:\Projects\personahub\server\tests\integration\migration-v6.test.ts
D:\Projects\personahub\server\tests\integration\run-routes.test.ts
D:\Projects\personahub\server\tests\integration\validation-routes.test.ts
D:\Projects\personahub\server\tests\integration\secret-canary-scan.test.ts
D:\Projects\personahub\server\tests\integration\migration.test.ts
D:\Projects\personahub\server\tests\integration\migration-v8.test.ts
D:\Projects\personahub\server\tests\integration\opencode-adapter.test.ts
D:\Projects\personahub\server\tests\unit\adapter-config-validate-registry.test.ts
D:\Projects\personahub\server\tests\unit\adapter-config.test.ts
D:\P
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:28:59Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\migration-v10.test.ts"})`


> [reasoning] Let me look at an existing integration test for routes (to understand the Fastify setup pattern) and an existing migration test for v10. Let me also look at the migration-v10 test and an adapters route test if any. Let me look at the issue-creation test and validation-routes test for the Fastify app pattern.
Let me read the migration-v10 test, validation-routes test (Fastify pattern), and check the schema-v1 for the workflow_templates seed data.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\migration-v10.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Database from "better-sqlite3";
3: import { applyMigrations } from "../../src/db/migrations.js";
4:
5: // T009: v9 → v10 migration for F008. Covers: fresh install reaching v10,
6: // idempotency, admin_audit_events table shape, and the two workflow_templates
7: // unique indexes (issue_type+version uniqueness; single-active invariant).
8:
9: function seedWorkflowTemplate(db: Database.Database): string {
10:   db.prepare(
11:     "INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
12:   ).run("wft_
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:08Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\validation-routes.test.ts", "limit": 90})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\validation-routes.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Fastify from "fastify";
3: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
4: import { registerRoutes } from "../../src/api/index.js";
5: import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
6: import { ErrorCode } from "@personahub/shared/errors";
7: import { buildPolicySnapshot, hashPolicySnapshot } from "../../src/services/validation/policy-gate.js";
8: import {
9:   IssueStatus,
10:   RunRole,
11:   RunDispatchSource,
12:   RunStatus,
13:   ThreadEventType,
14:   AdapterStatus,
15:   ActorType,
16:
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:14Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\helpers.ts"})`


> [reasoning] This test uses `createTestServices` from helpers.js and `registerRoutes` from the api index. But the task says: "For route-level tests, construct a minimal Fastify app registering ONLY your route plugin (do not require server/src/index.ts)." So I should construct a minimal Fastify app with only my route plugin. Let me check the helpers.js to understand the test services pattern, and look at a unit test for adapter-config to understand the simpler in-memory DB pattern.

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

## assistant · 2026-08-09T10:29:23Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\id.ts"})`


> [reasoning] Now let me look at the schema-v1 for the workflow_templates seed data, the id.js for id generation, and a route test that constructs a minimal Fastify app (without registerRoutes from index). Let me look at the run-routes test for the minimal app pattern and the existing routing recommendation service which uses workflowTemplateRepo to understand how to read the template.

Let me look at the id.js, schema-v1, and a simpler unit test.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\id.ts</path>
<type>file</type>
<content>
1: import { ulid } from "ulid";
2:
3: export function generateProjectId(): string {
4:   return `prj_${ulid()}`;
5: }
6:
7: export function generateWorkspaceId(): string {
8:   return `wsp_${ulid()}`;
9: }
10:
11: export function generateIssueId(): string {
12:   return `iss_${ulid()}`;
13: }
14:
15: export function generateThreadId(): string {
16:   return `thr_${ulid()}`;
17: }
18:
19: export function generateEventId(): string {
20:   return `evt_${ulid()}`;
21: }
22:
23: export function generateRunId(): string {
24:   return `run_${ulid()}`;
25: }
26:
27: export function generateAdapterConfigId(): string {
28:   return `adp_${ulid()}`;
29: }
30:
31: export function generateFileChangeId(): string {
3
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:32Z

- **tool**: `grep({"include": "*.ts", "output_mode": "files_with_matches", "pattern": "wft_coding_default|workflow_templates"})`

  <details><summary>tool output</summary>

  ```text
Found 22 match(es) in 22 file(s)

D:\Projects\personahub\server\tests\unit\validation-validator-selector.test.ts

D:\Projects\personahub\server\tests\unit\thread-event.test.ts

D:\Projects\personahub\server\tests\unit\issue.test.ts

D:\Projects\personahub\server\src\db\schema-v10.ts

D:\Projects\personahub\server\src\db\schema-v1.ts

D:\Projects\personahub\server\src\db\schema-v4.ts

D:\Projects\personahub\server\tests\integration\intake-confirm.test.ts

D:\Projects\personahub\server\tests\integration\graph-repositories.test.ts

D:\Projects\personahub\server\tests\integration\graph-recovery.test.ts

D:\Projects\personahub\server\tests\integration\graph-recovery-semantics.test.ts

D:\Projects\personahub\server\src\repositories\workflow-template.ts

D:\Projects\personahub\server\tests\integr
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:37Z

- **tool**: `grep({"include": "schema-v1.ts", "output_mode": "content", "pattern": "workflow_templates|wft_coding_default|steps_json|AdapterRole"})`

  <details><summary>tool output</summary>

  ```text
Found 4 match(es) in 1 file(s)

D:\Projects\personahub\server\src\db\schema-v1.ts
  27: CREATE TABLE IF NOT EXISTS workflow_templates (
  34: steps_json TEXT,
  105: INSERT OR IGNORE INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at)
  106: VALUES ('wft_coding_default', 'Coding Workflow', 'coding', 'sequential', 'active', 1, datetime('now'), datetime('now'));

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_skills=[], prompt="Find all files matching pattern X")
task(subagent_type="explore", load_skills=[
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:45Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\schema-v1.ts", "limit": 90, "offset": 20})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\db\schema-v1.ts</path>
<type>file</type>
<content>
20:   created_at TEXT NOT NULL,
21:   updated_at TEXT NOT NULL
22: );
23:
24: CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_project_path
25:   ON workspaces(project_id, local_path_normalized);
26:
27: CREATE TABLE IF NOT EXISTS workflow_templates (
28:   id TEXT PRIMARY KEY,
29:   name TEXT NOT NULL,
30:   issue_type TEXT NOT NULL,
31:   collaboration_topology TEXT,
32:   agent_team_template_id TEXT,
33:   validation_policy_id TEXT,
34:   steps_json TEXT,
35:   handoff_policy_json TEXT,
36:   evidence_requirements_json TEXT,
37:   status TEXT NOT NULL DEFAULT 'active',
38:   version INTEGER NOT NULL DEFAULT 1,
39:   created_at TEXT NOT NULL,
40:   updated_at TEXT NOT NULL
41: );
42:
43: CREATE
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:29:53Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\unit\\validation-validator-selector.test.ts", "limit": 80})`


> [reasoning] Now I have a good understanding. Let me check the AdapterRole enum and look at the shared types index to confirm the WorkflowTemplate type and AdapterRole values. Let me also look at the validation-validator-selector test to understand the steps_json format used (with schema_version, roles, etc.) and the existing test conventions for the validator-selector.

Let me also check the index.ts (server) and api/index.ts to understand the wiring for my snippet - just read them, don't edit.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\unit\validation-validator-selector.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect } from "vitest";
2: import {
3:   selectValidator,
4:   parseWorkflowSteps,
5:   hasValidationStep,
6:   assertValidatorAvailable,
7:   ValidatorSelectorError,
8:   type ValidatorSelectorInput,
9: } from "../../src/services/validation/validator-selector.js";
10: import {
11:   AgentCapability,
12:   ValidationBlockReason,
13:   type AdapterConfig,
14:   type WorkflowTemplate,
15:   type IssueType,
16: } from "@personahub/shared/types";
17:
18: function defaultWorkflow(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
19:   return {
20:     id: "wft_coding_default",
21:     name: "Coding Workflow",
22:     issue_type: "coding"
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:00Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\unit\\validation-validator-selector.test.ts", "limit": 120, "offset": 80})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\unit\validation-validator-selector.test.ts</path>
<type>file</type>
<content>
80:     });
81:
82:     it("throws for invalid JSON", () => {
83:       expect(() => parseWorkflowSteps("not json")).toThrow(ValidatorSelectorError);
84:     });
85:
86:     it("throws for non-object JSON", () => {
87:       expect(() => parseWorkflowSteps("[1,2,3]")).toThrow(ValidatorSelectorError);
88:     });
89:
90:     it("throws when steps is not an array", () => {
91:       expect(() => parseWorkflowSteps(JSON.stringify({ steps: "not array" }))).toThrow(ValidatorSelectorError);
92:     });
93:   });
94:
95:   describe("hasValidationStep", () => {
96:     it("returns true when validator step exists", () => {
97:       expect(hasValidationStep([
98:         { id:
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:06Z

- **tool**: `grep({"include": "*.ts", "output_mode": "content", "path": "D:\\Projects\\personahub\\shared\\src\\types", "pattern": "enum AdapterRole|AdapterRole =|WorkflowTemplate =|interface WorkflowTemplate"})`


> [reasoning] Now let me check the AdapterRole enum in shared types, and look at the index.ts (server) and api/index.ts to understand the wiring for my snippet. Let me also check the workflow-template type definition in shared types.

  <details><summary>tool output</summary>

  ```text
Found 7 match(es) in 3 file(s)

D:\Projects\personahub\shared\src\types\f008.ts
  3: export interface WorkflowTemplateVersionSummary {
  14: export interface WorkflowTemplateStep {
  19: export interface WorkflowTemplateDetail {
  38: export interface WorkflowTemplateListResponse {
  42: export interface WorkflowTemplateDetailResponse {

D:\Projects\personahub\shared\src\types\index.ts
  75: export interface WorkflowTemplate {

D:\Projects\personahub\shared\src\types\validation.ts
  24: export enum AdapterRole {

[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

```
// Parallel exploration - fire multiple agents simultaneously
task(subagent_type="explore", load_ski
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:12Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\index.ts", "limit": 35, "offset": 70})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\index.ts</path>
<type>file</type>
<content>
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
80:   agent_team_template_id: string | null;
81:   validation_policy_id: string | null;
82:   steps_json: string | null;
83:   handoff_policy_json: string | null;
84:   evidence_requirements_json: string | null;
85:   status: string;
86:   version: number;
87:   created_at: string;
88:   updated_at: string;
89: }
90:
91: export interface ValidationPolicy {
92:   id: string;
93:   name: string;
94:   issue_type: IssueType;
95:   pass_conditions_jso
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:18Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\shared\\src\\types\\validation.ts", "limit": 40, "offset": 20})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\shared\src\types\validation.ts</path>
<type>file</type>
<content>
20:   UserDefault = "user_default",
21:   System = "system",
22: }
23:
24: export enum AdapterRole {
25:   Implementation = "implementation",
26:   Validator = "validator",
27: }
28:
29: export enum ValidationOutcome {
30:   Passed = "passed",
31:   Failed = "failed",
32:   Blocked = "blocked",
33: }
34:
35: export enum ValidationBlockReason {
36:   ValidatorUnavailable = "validator_unavailable",
37:   ValidatorRunFailed = "validator_run_failed",
38:   ResultUnparsable = "result_unparsable",
39:   EvidenceMissing = "evidence_missing",
40:   EvidenceScopeMismatch = "evidence_scope_mismatch",
41:   RoundLimitReached = "round_limit_reached",
42:   WorkflowConfigurationInvalid = "workflow_configur
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:26Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\index.ts"})`


> [reasoning] Now I have a clear understanding of the AdapterRole values: `implementation` and `validator`. For the strict validator, valid roles are these two. The schema_version supported is `1` (based on the test data). Let me now check the server index.ts and api/index.ts (read-only) to understand the wiring for my snippet.
Now let me read the server index files (read-only, to produce the wiring snippet) and a route that uses minimal Fastify app in tests.

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

## assistant · 2026-08-09T10:30:37Z

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

## assistant · 2026-08-09T10:30:49Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\unit\\error-mapping.test.ts"})`


> [reasoning] Now I have a complete picture. Let me also check the run-routes test to understand the minimal Fastify app pattern for routes (without registerRoutes from index). Let me check how existing tests build a minimal Fastify app.
Let me check how existing route tests build a minimal Fastify app and the error-mapping test for the AppError→response pattern.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\unit\error-mapping.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect } from "vitest";
2: import { ErrorCode } from "@personahub/shared/errors";
3: import { getErrorStatus, AppError, buildErrorResponse } from "../../src/api/errors.js";
4:
5: describe("Error Status Mapping", () => {
6:   describe("existing error codes preserve their HTTP status", () => {
7:     it("PROJECT_NAME_REQUIRED -> 400", () => {
8:       expect(getErrorStatus(ErrorCode.PROJECT_NAME_REQUIRED)).toBe(400);
9:     });
10:
11:     it("PROJECT_NOT_FOUND -> 404", () => {
12:       expect(getErrorStatus(ErrorCode.PROJECT_NOT_FOUND)).toBe(404);
13:     });
14:
15:     it("ISSUE_NOT_FOUND -> 404", () => {
16:       expect(getErrorStatus(ErrorCode.ISSUE_NOT_
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:30:59Z

- **tool**: `grep({"include": "*.test.ts", "output_mode": "files_with_matches", "path": "D:\\Projects\\personahub\\server\\tests", "pattern": "app.register\\(\\w+Routes"})`


> [reasoning] Let me look at a route test that builds a minimal Fastify app without registerRoutes from index - let me check the run-routes test and a simple route test that registers a single plugin.
Let me look at how a route test constructs a minimal Fastify app, and check the sqlite-errors file for UNIQUE constraint detection.

  <details><summary>tool output</summary>

  ```text
Found 1 match(es) in 1 file(s)

D:\Projects\personahub\server\tests\integration\graph-routes-mutations.test.ts

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
- Background tasks
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:15Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\graph-routes-mutations.test.ts", "limit": 110})`

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\graph-routes-mutations.test.ts</path>
<type>file</type>
<content>
1: import { describe, it, expect, beforeEach, afterEach } from "vitest";
2: import Fastify from "fastify";
3: import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
4: import graphRoutes from "../../src/api/routes/graph.js";
5: import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
6: import { ErrorCode } from "@personahub/shared/errors";
7: import {
8:   AdapterStatus, GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, RunRole, RunPurpose,
9: } from "@personahub/shared/types";
10: import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
11: import { GraphRuntime
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:25Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\sqlite-errors.ts"})`


> [reasoning] I now have the full Fastify minimal app pattern. Now let me check the sqlite-errors file to understand how UNIQUE constraint errors are detected (for T020b mapping).

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\db\sqlite-errors.ts</path>
<type>file</type>
<content>
1: import { AppError } from "../api/errors.js";
2: import { ErrorCode } from "@personahub/shared/errors";
3: import type { GraphRunRepository } from "../repositories/graph-run.js";
4:
5: const SQLITE_CONSTRAINT_UNIQUE = "SQLITE_CONSTRAINT_UNIQUE";
6:
7: export type GraphConstraintKind = "active_attempt" | "nonterminal_graph" | "duplicate_node";
8:
9: export class GraphConstraintError extends Error {
10:   constructor(
11:     message: string,
12:     public readonly kind: GraphConstraintKind,
13:   ) {
14:     super(message);
15:     this.name = "GraphConstraintError";
16:   }
17: }
18:
19: interface SqliteError {
20:   code: string;
21:   message: string;
22: }
23:
24: export function isSql
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:31:37Z

- **tool**: `todowrite({"todos": [{"content": "Add id generators (wft_, aev_) to server/src/id.ts", "priority": "high", "status": "in_progress"}, {"content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate", "priority": "high", "status": "pending"}, {"content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)", "priority": "high", "status": "pending"}, {"content": "Creat
…[truncated])`


> [reasoning] Now I have the `isSqliteUniqueConstraint` helper. I can use `isSqliteUniqueConstraint(error, "idx_workflow_templates_issue_type_version")` to detect the version conflict (T020b) and `isSqliteUniqueConstraint(error, "idx_workflow_templates_one_active")` to detect the single-active violation.

Wait - does better-sqlite3's error message include the index name? Let me verify. The existing code checks for "runs.node_run_id" (a column reference) and "graph_runs.issue_id" (a column reference), not index names. SQLite's UNIQUE constraint error message format depends on SQLite version. Newer SQLite versions include the index name in the message. Let me check what the error message looks like. Actually, better-sqlite3 with recent SQLite includes the index name. Let me verify by checking how the message looks. The format is typically: `UNIQUE constraint failed: workflow_templates.issue_type, workflow_templates.version` (column-based) OR in newer versions with the index: `UNIQUE constraint failed: ...`.

Actually, SQLite's error message for a UNIQUE constraint violation is: `UNIQUE constraint failed: table.column`. It does NOT include the index name by default. Hmm. But there's a subtlety: when there are multiple unique constraints, the message lists the columns. So for `idx_workflow_templates_issue_type_version`, the message would be `UNIQUE constraint failed: workflow_templates.issue_type, workflow_templates.version`. For `idx_workflow_templates_one_active`, it would be `UNIQUE constraint failed: workflow_templates.issue_type`.

So I should check by column references. Let me use:
- version conflict: `isSqliteUniqueConstraint(error, "workflow_templates.version")` - but this could be ambiguous if there's another unique on version alone (there isn't). Actually the message includes `workflow_templates.issue_type, workflow_templates.version` so checking for "workflow_templates.version" works.
- single-active: `isSqliteUniqueConstraint(error, "workflow_templates.issue_type")` - but this would ALSO match the version conflict message (which contains issue_type). So I need to check version conflict FIRST, then single-active.

Actually wait - let me reconsider. For the single-active partial index, the columns are just `issue_type`. So the message is `UNIQUE constraint failed: workflow_templates.issue_type`. For version conflict, message is `UNIQUE constraint failed: workflow_templates.issue_type, workflow_templates.version`.

So if I check `isSqliteUniqueConstraint(error, "workflow_templates.version")` first - only the version conflict matches. Then check `isSqliteUniqueConstraint(error, "workflow_templates.issue_type")` for single-active - but this would also be true for the version conflict (already handled above since we check version first). Good, ordering works.

But actually, for robustness, let me check the exact column set. Hmm, the helper just does `.includes()`. Let me think about whether checking "workflow_templates.version" is safe. Yes - the only unique index involving the `version` column is `idx_workflow_templates_issue_type_version`. So checking for "workflow_templates.version" uniquely identifies the version conflict.

Actually, I realize I should double check what better-sqlite3 actually puts in the error. Let me check if there's an existing test that asserts the message format. Let me just trust the existing helper and use column references. Actually, let me verify by writing a quick test. But first, let me check the better-sqlite3 version and whether SQLite includes index name.

Actually, modern SQLite (3.25+) changed the error message format. Let me check what version is used. Actually, the existing code checks `sqliteErr.message.includes(indexOrColumn)` where indexOrColumn is "runs.node_run_id" (a column). This suggests the message contains column references in `table.column` format. So my approach of checking "workflow_templates.version" and "workflow_templates.issue_type" is consistent with existing code.

Hmm, but there's a subtle issue. The single-active partial index violation message. Let me think. Actually for the activate path, I deactivate siblings FIRST within the transaction, then activate. So the single-active index should never be violated by my code IF I do it in the right order. But the version conflict (T020b) CAN happen under concurrency. And for safety, the single-active index is a backstop.

Let me now also verify: when better-sqlite3 throws, does the error have `code: "SQLITE_CONSTRAINT_UNIQUE"`? Yes, that's standard. And the message format is `UNIQUE constraint failed: workflow_templates.issue_type, workflow_templates.version`.

Now, I have enough context. Let me set up todos and start building.

Let me plan the files:

1. **`server/src/repositories/workflow-template.ts`** (EXTEND) - add listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, insertVersion, activate, deactivate, countActiveByIssueType.

2. **`server/src/services/validation/validate-steps-schema.ts`** (NEW) - `validateStepsSchema(stepsJson: string | null): void`.

3. **`server/src/repositories/admin-audit-event.ts`** (NEW) - `AdminAuditEventRepository` with `insert(...)`.

4. **`server/src/services/workflow-template-admin.ts`** (NEW) - `WorkflowTemplateAdminService`.

5. **`server/src/api/routes/workflow-templates.ts`** (NEW) - Fastify route plugin.

6. **`server/tests/integration/workflow-template-admin.test.ts`** (NEW) - tests.

Let me think about the design carefully.

### WorkflowTemplateRepository extension

```ts
listByIssueType(issueType: string): WorkflowTemplate[] {
  const rows = this.db.prepare(
    "SELECT * FROM workflow_templates WHERE issue_type = ? ORDER BY version ASC"
  ).all(issueType) as WorkflowTemplateRow[];
  return rows.map(mapRow);
}

listVersions(issueType: string): WorkflowTemplate[] {
  return this.listByIssueType(issueType);
}

getMaxVersion(issueType: string): number {
  const row = this.db.prepare(
    "SELECT MAX(version) as v FROM workflow_templates WHERE issue_type = ?"
  ).get(issueType) as { v: number | null } | undefined;
  return row?.v ?? 0;
}

getActiveByIssueType(issueType: string): WorkflowTemplate | null {
  const row = this.db.prepare(
    "SELECT * FROM workflow_templates WHERE issue_type = ? AND status = 'active' LIMIT 1"
  ).get(issueType) as WorkflowTemplateRow | undefined;
  return row ? mapRow(row) : null;
}

countActiveByIssueType(issueType: string): number {
  const row = this.db.prepare(
    "SELECT COUNT(*) as c FROM workflow_templates WHERE issue_type = ? AND status = 'active'"
  ).get(issueType) as { c: number };
  return row.c;
}
```

For `insertVersion`: The caller passes a transaction db or I compute here. The design requires max+1 and INSERT in the same transaction. The service will wrap in `this.db.transaction(() => {...})()` and call repo methods that use `this.db`. Since better-sqlite3 transactions are reentrant (nested transactions become savepoints), calling repo methods inside a service-level transaction works fine - they all operate on the same connection.

Actually, the task says: "insertVersion(source, input, activate, newId, version) - inserts a NEW row with version = max(version)+1 for that issue_type, computing version INSIDE the same transaction as the INSERT".

Hmm, but the signature given has `version` as a parameter. Let me re-read: "insertVersion(source: WorkflowTemplate, input: {name, steps_json}, activate: boolean, newId: string, version: number): WorkflowTemplate - ... computing version INSIDE the same transaction as the INSERT (the caller passes a transaction db or you compute here - design requires max+1 and INSERT in the same transaction; see T020)."

So there's flexibility. The cleanest approach: the SERVICE computes max+1 inside the transaction and passes it to insertVersion. OR insertVersion computes it. But the design requirement is that max+1 and INSERT are in the same transaction.

The cleanest: have the service open the transaction, call `repo.getMaxVersion(issueType)` to get the max, compute `version = max + 1`, then call `repo.insertVersion(...)` with that version - all inside the transaction. If a concurrent transaction already inserted the same version, the unique index catches it, and I map to TEMPLATE_VERSION_CONFLICT.

Actually, to keep the repo simple and the transaction in the service, I'll have:
- `insertVersion(input: InsertVersionInput): WorkflowTemplate` - just does the INSERT with provided values (including version).
- The service computes version inside the transaction via `getMaxVersion`.

But wait, the task explicitly lists `insertVersion(source, input, activate, newId, version)` as a method. Let me follow a pragmatic approach that satisfies the design constraints. I'll make insertVersion take the computed values and do the insert. The service orchestrates the transaction, computes max+1, handles activate semantics, and catches conflicts.

Actually, let me reconsider. The `activate` boolean in insertVersion: "status = active or inactive per activate". And "insertVersion({activate:true}) 内部即调用 activate()，不另写一份停用逻辑" (design §4). So if activate is true, insertVersion should deactivate siblings and insert as active - in the same transaction.

But the activation GATE (validateStepsSchema, acknowledge check) is a SERVICE-level concern (it needs the currentlyActive re-read, acknowledge flag, audit). So insertVersion({activate:true}) at the repo level just does the deactivate-siblings + insert-active, but the GATE is enforced by the service BEFORE calling insertVersion.

Let me design it cleanly:

**Repo level** (`insertVersion`):
- Takes: source (for inherited fields), input (name, steps_json), activate, newId, version.
- INSERTs the new row with status = activate ? 'active' : 'inactive'.
- If activate is true, FIRST updates all active rows of that issue_type to inactive, THEN inserts the new active row. (This maintains the single-active invariant at the repo level.)
- Returns the new row.

Wait, but if activate is true and there's an existing active row, the order matters for the partial unique index: I must deactivate existing active rows BEFORE inserting the new active row, otherwise the index rejects two active rows. So the repo does: `UPDATE ... SET status='inactive' WHERE issue_type=? AND status='active'` then `INSERT ... status='active'`.

**Service level** (`createVersion`):
- Opens transaction.
- Re-reads source (404 if missing).
- Validates non-editable fields not in input (this is done at route level via zod, but service can double-check - actually the task says route rejects extra fields. Let me do it at route level with zod `.strict()` or explicit check. Actually zod by default strips unknown keys; I need to detect them and reject. I'll use a manual check or `.strict()`. But `.strict()` gives REQUEST_BODY_INVALID, not TEMPLATE_FIELD_NOT_EDITABLE. So I'll do a manual check in the route or service. Let me do it in the service to keep the route clean - actually the task says "Reject extra fields that are non-editable -> 400 TEMPLATE_FIELD_NOT_EDITABLE". Let me check the raw body in the route handler for the four non-editable field names before zod parsing.)

Hmm, actually cleaner: in the route, before/after zod parse, check if the raw body contains any of the four non-editable keys. Let me do it explicitly.

Actually, let me reconsider. The zod schema for createVersion body: `{name?, steps_json?, activate?, acknowledge_validation_disabled?}`. If I use a non-strict (default) zod object, unknown keys are stripped silently - bad. If I use `.strict()`, unknown keys cause REQUEST_BODY_INVALID - wrong code.

Best approach: parse with zod (default, strips unknowns), but FIRST check the raw body for the four non-editable field names and throw TEMPLATE_FIELD_NOT_EDITABLE. Or: use `.strict()` and then in the error handler map... no, too complex.

Cleanest: in the route handler, before zod parse, inspect `request.body` for the four forbidden keys. If present, throw AppError(TEMPLATE_FIELD_NOT_EDITABLE). Then zod-parse the rest. Actually, I can do this check in the service too. Let me do it in the route to keep service clean - matches "route boundary" convention. Actually, the service receives a typed input `CreateWorkflowTemplateVersionInput` which only has name/steps_json/activate/acknowledge. So the non-editable field check must happen BEFORE the service, at the route, on the raw body. Good.

Let me write the route to:
1. Check raw body for forbidden keys -> TEMPLATE_FIELD_NOT_EDITABLE.
2. zod parse for type validation.
3. Call service.

**Service `createVersion(sourceId, input)`**:
```
- const source = repo.getById(sourceId); if (!source) throw 404 TEMPLATE_NOT_FOUND.
- Open transaction:
  - if input.activate:
    - run activation gate against target (the NEW version's steps_json):
      - validateStepsSchema(input.steps_json) -> throw TEMPLATE_STEPS_INVALID if invalid (unconditional, T023d)
      - re-read currentlyActive = repo.getActiveByIssueType(source.issue_type)
      - determine if acknowledge required (gate matrix), check input.acknowledge_validation_disabled
      - compute before/after validation_enabled
    - version = repo.getMaxVersion(source.issue_type) + 1
    - newId = generate
    - newTemplate = repo.insertVersion(source, {name, steps_json}, activate=true, newId, version)
    - audit insert (action 'template.version_created', details with acknowledge + before/after + activate=true)
  - else (activate false):
    - version = repo.getMaxVersion + 1
    - newId = generate
    - newTemplate = repo.insertVersion(source, {name, steps_json}, activate=false, newId, version)
    - audit insert (action 'template.version_created', details with activate=false)
  - catch unique constraint on version -> 409 TEMPLATE_VERSION_CONFLICT
- return detail(newTemplate)
```

Wait, but the gate for activate requires re-reading currentlyActive. And insertVersion({activate:true}) deactivates siblings. But the GATE logic (acknowledge check) uses currentlyActive, which is the state BEFORE the deactivate. So the order is:
1. validateStepsSchema(target)
2. re-read currentlyActive
3. gate check (acknowledge)
4. compute version
5. insertVersion({activate:true}) - which deactivates siblings + inserts active
6. audit

That's correct. The currentlyActive is read inside the txn before the mutation.

But there's a subtlety: for createVersion with activate=true, the "target" is the NEW version being created (with input.steps_json). The currentlyActive is the EXISTING active row. The gate compares currentlyActive.validation_enabled vs target.validation_enabled (derived from input.steps_json).

For activate(id) (activating an EXISTING version), the target is that existing row, currentlyActive is the current active row.

Let me define a shared private method for the gate logic.

**Gate matrix (T030b)** - given target (the version to activate) and currentlyActive (re-read in txn):
```
- targetValidation = try { parseWorkflowSteps(target.steps_json); hasValidationStep(...) } catch -> null (invalid)
  - Actually for the gate, target invalid (incl NULL) -> reject TEMPLATE_STEPS_INVALID (unconditional, first row).
  - But wait: validateStepsSchema already runs first and rejects NULL/invalid. So by the time we compute targetValidation, target is valid (schema-valid). But "valid schema" doesn't mean "has validator step". A schema-valid steps_json with no validator step is "valid but disabled validation".

Let me re-read the matrix:
  - target invalid / NULL -> reject (unconditional) [T023d]
  - currently active valid AND target disabled validation (no validator step) -> require acknowledge
  - currently active invalid AND target valid -> require acknowledge, audit before=unknown, allow
  - both invalid -> reject (covered by first row)
  - target valid + keeps validator -> no acknowledge needed

So the matrix keys off:
- targetValid (schema-valid, i.e., validateStepsSchema passes) - but actually "target invalid" in the first row means steps_json NULL or schema-invalid. validateStepsSchema handles that rejection.
- targetHasValidator: does the (schema-valid) target have a validator step? Computed via parseWorkflowSteps + hasValidationStep.
- currentlyActiveValid: is currentlyActive's steps_json schema-valid (via validateStepsSchema - but we don't want to throw, we want a boolean). Hmm. Actually for currentlyActive, "invalid" means parseWorkflowSteps throws (the loose parser). Let me use the loose parser for currentlyActive validity (since it's about runtime behavior), OR use validateStepsSchema in a try/catch.

Wait, the design §6 says: "当前 active 合法" / "当前 active 非法". What does "合法" mean for currentlyActive? It means its steps_json is parseable by the runtime parser (parseWorkflowSteps). If parseWorkflowSteps throws, it's "非法" (invalid).

Actually, let me think about what "valid" means consistently. The strict validator (validateStepsSchema) is the WRITE gate for the target. For currentlyActive, we're not writing it - we're reading its current state to determine the "before" value. The "before" validation_enabled is computed via parseWorkflowSteps + hasValidationStep (the runtime/loose path, same as detail()). If parseWorkflowSteps throws, currentlyActive is "invalid" and before = null/unknown.

So:
- targetValid: validateStepsSchema(target.steps_json) passes (strict). If it throws -> reject TEMPLATE_STEPS_INVALID. (This is the unconditional first-row rejection.)
- targetHasValidator: parseWorkflowSteps(target.steps_json) (now known valid) + hasValidationStep. Since validateStepsSchema passed, parseWorkflowSteps won't throw.
- currentlyActive: null (no active) OR {valid, hasValidator}:
  - if currentlyActive is null: there's no "before". Hmm, is that possible? If there's no active row... but the seed always has wft_coding_default active. But after deactivate-last is blocked, there's always at least one active. Actually activate() could be called when... no, there's always exactly one active (invariant). But defensively, if currentlyActive is null, then before = unknown, and we're enabling validation (if target has validator) -> no acknowledge needed; or disabling -> require acknowledge?

Actually, let me handle currentlyActive=null as "before unknown". If target disables validation and there's no current active... edge case. Let me treat: if currentlyActive is null OR invalid -> "before unknown". Then:
  - target has validator -> no acknowledge (enabling/keeping validation, no regression)
  - target no validator -> require acknowledge (can't prove validation wasn't disabled, conservative)

Hmm, but the matrix says "currently active invalid AND target valid -> require acknowledge". It doesn't separately call out "currently active null". Let me treat null as a sub-case of "invalid" (before unknown). That's the conservative, safe choice.

So the gate:
```
validateStepsSchema(target.steps_json)  // throws TEMPLATE_STEPS_INVALID if invalid (row 1)
targetHasValidator = hasValidationStep(parseWorkflowSteps(target.steps_json))
currentlyActive = repo.getActiveByIssueType(issueType)  // re-read in txn
beforeValidationEnabled = computeBefore(currentlyActive)  // null if no active or parse fails -> "unknown"
// beforeValid = currentlyActive !== null && parseWorkflowSteps(currentlyActive.steps_json) doesn't throw
beforeValid = currentlyActive !== null && tryParse(currentlyActive.steps_json)  // loose parse success

// Determine if acknowledge required:
// - target keeps validator (targetHasValidator true) -> NO acknowledge (row: "target valid + keeps validator")
// - target disables validator (targetHasValidator false):
//   - beforeValid true (currently active valid) -> require acknowledge (row 2)
//   - beforeValid false/null (currently active invalid or null) -> require acknowledge, before=unknown, allow (row 3 / escape hatch)
//   So: if targetHasValidator is false -> ALWAYS require acknowledge.
//   If targetHasValidator is true -> never require acknowledge (unless... no).

acknowledgeRequired = !targetHasValidator
if (acknowledgeRequired && !acknowledge) throw VALIDATION_DISABLE_NOT_ACKNOWLEDGED
```

Wait, that's simpler than I thought. Let me verify against the matrix:
- Row 1: target invalid/NULL -> reject (handled by validateStepsSchema before this).
- Row 2: currently active valid AND target disabled validation -> require acknowledge. ✓ (targetHasValidator false -> require)
- Row 3: currently active invalid AND target valid -> require acknowledge, before=unknown, allow. ✓ (targetHasValidator could be true OR false here. If target is valid AND has validator -> row says "require acknowledge"??)

Hold on. Let me re-read row 3: "当前 active 非法、目标合法 -> 要求 acknowledge_validation_disabled，审计前值记 unknown，允许启用".

So when currently active is INVALID and target is VALID (regardless of whether target has validator), require acknowledge. That's the escape hatch: because we can't prove the current state had validation, we conservatively require acknowledge even if the target ENABLES validation.

Hmm wait, that seems odd. If target enables validation (has validator) and current is invalid, why require acknowledge? Because "无法证明验证没被关掉" - we can't prove validation wasn't already off. The acknowledge is "I acknowledge validation may be disabled". Since the current state is unknown, activating even a validator-containing template might be a no-op regression... Actually the reasoning is: the audit "before" value is unknown, so we require the user to acknowledge that they understand the before-state is unknown. It's conservative.

So the matrix is:
- target invalid/NULL -> reject (row 1)
- target valid:
  - currentlyActive valid (loose parse ok):
    - target has validator -> NO acknowledge (no change in validation enabled, or enabling)
    - target no validator -> require acknowledge (disabling validation) [row 2]
  - currentlyActive invalid OR null:
    - require acknowledge, before=unknown, allow [row 3] — REGARDLESS of whether target has validator

So `acknowledgeRequired`:
```
if (!beforeValid) {
  // currently active invalid or null
  acknowledgeRequired = true;  // row 3, before=unknown
} else {
  // currently active valid
  acknowledgeRequired = !targetHasValidator;  // row 2 if no validator, else no acknowledge
}
```

Let me double check row "both invalid -> reject (covered by first row)". Yes - target invalid is caught by validateStepsSchema first.

And "target valid + keeps validator -> no acknowledge needed" - this is the case where beforeValid is true (currently active valid) and targetHasValidator true. ✓

But what if beforeValid is true and targetHasValidator true but currentlyActive has NO validator and target HAS validator (enabling validation)? Row says "no acknowledge needed" - because we're enabling/re-enabling validation, not disabling. ✓ My formula: beforeValid true, targetHasValidator true -> acknowledgeRequired = !true = false. ✓ Correct.

What if beforeValid is false (current invalid) and targetHasValidator true (target enables validation)? Row 3: require acknowledge, before=unknown. My formula: !beforeValid -> acknowledgeRequired = true. ✓

Good, my formula is correct.

Now `beforeValidationEnabled` for audit:
- if currentlyActive is null -> "unknown" (null)
- if currentlyActive parse fails (loose) -> "unknown" (null)
- else -> hasValidationStep(parsed) (boolean)

`afterValidationEnabled` = targetHasValidator (boolean, since target is schema-valid).

Now, the audit details_json should record: acknowledge_validation_disabled (bool), validation_enabled before (bool|null|unknown), validation_enabled after (bool).

Let me use null for "unknown" in the audit. Actually the design says "审计前值记为 unknown". Let me store before as `null` when unknown, and the string "unknown" would be ambiguous with boolean null. Let me store: `validation_enabled_before: boolean | null` where null means unknown, plus maybe a flag. Actually, let me store `validation_enabled_before: boolean | null` (null = unknown) and `validation_enabled_after: boolean`. That's clean. The detail's validation_enabled is `boolean | null` already (null when parse fails). So for audit, null = unknown/invalid.

Hmm, but there's a subtle distinction: "before is null because no active row" vs "before is null because active row's steps_json is invalid". Both map to "unknown" for audit purposes. That's fine - the design says "前值记为 unknown" for the invalid case, and no-active is a degenerate case that's effectively unknown too.

Now for `activate(id, acknowledge?)` (activating an EXISTING version):
```
- target = repo.getById(id); if (!target) throw 404 TEMPLATE_NOT_FOUND.
- Open transaction:
  - validateStepsSchema(target.steps_json) -> throw TEMPLATE_STEPS_INVALID if invalid (row 1, T023d)
  - targetHasValidator = hasValidationStep(parseWorkflowSteps(target.steps_json))
  - currentlyActive = repo.getActiveByIssueType(target.issue_type)  // re-read in txn (T030d)
  - beforeValid = currentlyActive !== null && tryParseLoose(currentlyActive.steps_json)
  - acknowledgeRequired = !beforeValid ? true : !targetHasValidator
  - if (acknowledgeRequired && !acknowledge) throw VALIDATION_DISABLE_NOT_ACKNOWLEDGED
  - // if target is already the active row, activate is idempotent-ish: deactivate siblings (none, since it's the only active) then set active. Actually if target IS currently active, deactivating siblings does nothing and setting it active again is a no-op. But we should still write audit? The design doesn't explicitly say. Let me handle: if target.id === currentlyActive?.id, it's already active - I'll still proceed (deactivate others - none, set active - no-op) and write audit. Actually, simpler: just run the deactivate-all-active + set-target-active. If target is already active, deactivate-all-active would deactivate it too! That's wrong.
```

Hmm. The activate() repo method "停用同 issue_type 的全部 active 行 -> 激活 id". If I deactivate ALL active rows including target, then activate target - that works (target ends active). But the partial unique index: after deactivating all, there are zero active rows; then setting target to active creates one. Fine. But it's a no-op if target was already active (deactivate then reactivate). The issue is: should I skip if already active?

Actually, re-activating the already-active template: the gate still runs. If target is already active and valid with validator, gate passes (no acknowledge), deactivate-all-active (deactivates target), set target active. Net no-op but audit written. That's acceptable but slightly wasteful. However, if target is already active and we run the gate with currentlyActive = target itself... beforeValid = parse(target), targetHasValidator = hasValidator(target). If target has no validator (disabled validation, already active), then acknowledgeRequired = !beforeValid(false since valid) ? ... = !targetHasValidator = true. So re-activating a no-validator active template requires acknowledge. That seems odd but consistent - it's a no-op activation but the gate still enforces.

Actually, to avoid weirdness, let me NOT short-circuit. The design says activate() "停用同 issue_type 的全部 active 行 -> 激活 id". I'll implement deactivate-all-others then activate-target. But "全部 active 行" includes target if it's active. To be safe and correct, I'll deactivate all active rows EXCEPT target, then set target to active. Wait, but the design says "全部" (all). Let me re-read design §4 table:

| `activate(id)` | 停用同 `issue_type` 的**全部** active 行 -> 激活 `id` | ... |

So deactivate ALL active rows (including target if active), then activate target. If target was already active, it gets deactivated then reactivated - net same. The partial unique index is satisfied throughout? No - during the transaction, after deactivate-all, zero active rows; then activate target, one active row. Fine. The index is checked at statement boundaries within the transaction (SQLite checks at each statement). So: UPDATE all to inactive (0 active) - OK. UPDATE target to active (1 active) - OK.

But wait, if I do "UPDATE ... SET status='inactive' WHERE issue_type=? AND status='active'" that deactivates target too (if it was active). Then "UPDATE ... SET status='active' WHERE id=?" reactivates it. Two statements. Fine.

Alternatively, to be cleaner and avoid deactivating target unnecessarily: "UPDATE ... SET status='inactive' WHERE issue_type=? AND status='active' AND id != ?". Then "UPDATE ... SET status='active' WHERE id=?". This deactivates siblings only, then activates target. If target was inactive, siblings deactivated, target activated. If target was active, no siblings to deactivate (it's the only active), target stays active (the second UPDATE is a no-op). This is cleaner. But the design says "全部 active 行". Hmm. The INTENT of "全部" is to ensure single-active invariant. Deactivating "all except target" achieves the same end state. I think "全部 active 行 -> 激活 id" is describing the conceptual flow (clear the field, then set the one). Implementing "all except target" is equivalent and avoids a wasteful deactivate-reactivate.

But there's a subtle case: what if target is currently active and there's ANOTHER active row (invariant violated somehow)? "all except target" would deactivate the other, keeping target. "all" would deactivate both then reactivate target. Same end state. Both fine.

I'll go with "deactivate all active rows of this issue_type" (matching the design text literally), then "set target to active". Actually, the cleanest literal implementation:
1. `UPDATE workflow_templates SET status='inactive', updated_at=? WHERE issue_type=? AND status='active'` - deactivates all active (incl target if active).
2. `UPDATE workflow_templates SET status='active', updated_at=? WHERE id=?` - activates target.

This is simple and matches "全部 active 行 -> 激活 id". Let me go with this.

For `deactivate(id)`:
```
- target = repo.getById(id); if (!target) throw 404.
- Open transaction:
  - count = repo.countActiveByIssueType(target.issue_type)
  - if count <= 1 throw 409 LAST_ACTIVE_TEMPLATE
  - // also verify target is currently active? The design says deactivate rejects last active. If target is already inactive, deactivating it is a no-op. Should I reject? The design doesn't say. Let me just set it inactive (no-op if already inactive) and write audit. Actually, if target is inactive and it's the... hmm. countActive counts active rows. If target is inactive and there's 1 active row (different), count=1, but target isn't that active row. Deactivating target (already inactive) is a no-op but count<=1 would reject. That's wrong - rejecting deactivate of an inactive template because there's only 1 active (a different one).

  Let me reconsider. deactivate(id) should only make sense for an active template. If target is inactive, it's already deactivated. Let me check: the design says "deactivate(id) | 仅置该行 inactive | 它是该 issue_type 最后一个 active 模板". So the reject condition is "it is the last active template". If target is inactive, it's not "the last active template" (it's not active at all). So I should: if target is inactive, it's a no-op (or maybe still write audit? No - no mutation). Let me handle: if target.status is already 'inactive', return detail(target) without mutation/audit (idempotent). Actually, to be safe, let me only proceed if target is active. If inactive, return current detail (no-op). If active and it's the last active -> reject. If active and not last -> deactivate + audit.
```

Hmm, but is a no-op deactivate correct? Let me keep it simple: if target is active, check last-active, then deactivate+audit. If target is inactive, just return detail (no mutation, no audit). That avoids weird rejections.

Actually, wait. Let me reconsider whether deactivate of an inactive template should be an error or no-op. The API contract (design §8) says `POST /api/workflow-templates/:id/deactivate` -> 409 LAST_ACTIVE_TEMPLATE. It doesn't list "template is inactive" as an error. So a no-op return is fine. But to be safe, let me make deactivate of an already-inactive template a no-op that returns the detail. Actually, I worry about audit consistency - if no mutation, no audit. Fine.

Let me reconsider: maybe simpler to always check `if target.status === 'active'`. If active: count active; if count <= 1 reject; else deactivate + audit. If inactive: return detail (no-op). Good.

Now, the `detail()` method:
```
detail(id):
  - t = repo.getById(id); if (!t) throw 404 TEMPLATE_NOT_FOUND.
  - try { steps = parseWorkflowSteps(t.steps_json); validation_enabled = hasValidationStep(steps); parse_error = null }
    catch (e) { steps = []; validation_enabled = null; parse_error = e.message }
  - return WorkflowTemplateDetail { ...t, steps, validation_enabled, parse_error }
```

`list(issueType)`:
```
list(issueType):
  - rows = repo.listByIssueType(issueType)
  - for each: try { validation_enabled = hasValidationStep(parseWorkflowSteps(t.steps_json)) } catch { validation_enabled = null }
  - return WorkflowTemplateVersionSummary[] (no parse_error in summary, per task: "summary's validation_enabled can be null; put the parse error only in detail")
```

Now the audit repo:
```
class AdminAuditEventRepository {
  constructor(private db: Database.Database) {}
  insert(input: {id, action, target_type, target_id, target_version?, actor_type, actor_id?, details_json, created_at}): void {
    this.db.prepare("INSERT INTO admin_audit_events (...) VALUES (...)").run(...)
  }
}
```

For T031b (audit failure rolls back template change): the audit insert is inside the same transaction as the template mutation. If audit insert throws (e.g., inject a failing repo), the transaction rolls back. To test this, I can inject a mock audit repo that throws. So the service should accept the audit repo as a dependency, and in the test, pass one that throws. Good - dependency injection.

Now the strict validator `validateStepsSchema`:
```
SUPPORTED_SCHEMA_VERSION = 1
VALID_ROLES = new Set(["implementation", "validator"])  // AdapterRole values

export function validateStepsSchema(stepsJson: string | null): void {
  if (stepsJson === null || stepsJson === "") {
    throw new AppError(TEMPLATE_STEPS_INVALID, "steps_json is null; a template cannot be activated without valid steps.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(stepsJson); } catch { throw TEMPLATE_STEPS_INVALID "Failed to parse steps_json: ..." }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw ...
  const obj = parsed as { schema_version?: unknown; steps?: unknown };
  if (obj.schema_version !== SUPPORTED_SCHEMA_VERSION) throw "unsupported schema_version ..."
  if (!Array.isArray(obj.steps)) throw "steps_json.steps must be an array"
  if (obj.steps.length === 0) throw "steps_json.steps must not be empty"
  const seenIds = new Set<string>();
  for (const s of obj.steps) {
    if (typeof s !== "object" || s === null) throw "each step must be an object"
    const keys = Object.keys(s);
    // unexpected fields
    for (const k of keys) if (k !== "id" && k !== "role") throw `unexpected field '${k}'`
    const step = s as { id?: unknown; role?: unknown };
    if (typeof step.id !== "string" || step.id.length === 0) throw "step.id must be a non-empty string"
    if (typeof step.role !== "string") throw "step.role must be a string"
    if (!VALID_ROLES.has(step.role)) throw `unknown role '${step.role}'`
    if (seenIds.has(step.id)) throw `duplicate step id '${step.id}'`
    seenIds.add(step.id)
  }
}
```

Wait - should I check `schema_version` is missing? "unsupported/missing schema_version" per T023c. So if `obj.schema_version` is undefined (missing) -> reject. `obj.schema_version !== 1` catches both missing (undefined !== 1) and wrong. Good.

Now, the `VALID_ROLES` - should I import AdapterRole enum? The roles are "implementation" and "validator" (AdapterRole.Implementation, AdapterRole.Validator). Let me use the enum values to stay in sync. Actually, to avoid coupling, I'll reference `AdapterRole.Implementation` and `AdapterRole.Validator`. But the loose parser accepts ANY role string. The strict one should reject unknown roles. Using the enum values is the right call for "same source of truth". Let me build the set from the enum.

Actually, there might be more roles in the future. But for v0.2, the strict validator rejects anything not in the known enum. That's the design intent ("未知 role" rejection). I'll use `[AdapterRole.Implementation, AdapterRole.Validator]`.

Now let me think about the `tryParseLoose` helper for currentlyActive validity:
```
function tryParseWorkflowSteps(stepsJson: string | null): { valid: boolean; hasValidator: boolean } {
  try {
    const steps = parseWorkflowSteps(stepsJson);
    return { valid: true, hasValidator: hasValidationStep(steps) };
  } catch {
    return { valid: false, hasValidator: false };
  }
}
```
Note: parseWorkflowSteps(null) returns [] (not throw). So null steps_json -> valid: true, hasValidator: false. Hmm. That means "currentlyActive with null steps_json" is "valid but no validator" by the loose parser. But the design considers null steps_json as "invalid" for activation purposes (row 1: "target非法 / 为 NULL -> 拒绝").

Wait, there's a distinction: for the TARGET, null steps_json is rejected by validateStepsSchema (strict). For CURRENTLYACTIVE, we use the loose parser to determine "before" state. parseWorkflowSteps(null) returns [] (empty), hasValidationStep([]) = false. So currentlyActive with null steps_json -> loose-valid, hasValidator false. That means beforeValid = true, beforeHasValidator = false. So if target has validator, acknowledgeRequired = !beforeValid(false) ? ... : !targetHasValidator. beforeValid true, targetHasValidator true -> acknowledgeRequired = false. So enabling validation from a null-steps active template -> no acknowledge. Is that right?

Hmm. The design row 3 is "currently active 非法". Is null steps_json "非法" (invalid)? The loose parser treats null as valid (returns []). But semantically, a template with null steps_json can't run validation. The design §6 says: "当前 active 本身非法时（历史数据或手工改坏）". "手工改坏" includes null steps_json. So null steps_json should be treated as "invalid" for the currentlyActive assessment.

But parseWorkflowSteps(null) doesn't throw - it returns []. So my tryParseLoose would say valid=true. That's wrong for the gate.

Let me reconsider. For currentlyActive validity, I should treat null steps_json as invalid. Let me define:
```
function assessActiveValidation(t: WorkflowTemplate | null): { valid: boolean; hasValidator: boolean } {
  if (!t) return { valid: false, hasValidator: false };  // no active row
  if (t.steps_json === null) return { valid: false, hasValidator: false };  // null = invalid
  try {
    const steps = parseWorkflowSteps(t.steps_json);
    return { valid: true, hasValidator: hasValidationStep(steps) };
  } catch {
    return { valid: false, hasValidator: false };
  }
}
```

Wait, but parseWorkflowSteps filters malformed entries silently. So a steps_json with all-malformed entries returns [] (valid, hasValidator false). Is that "valid" or "invalid"? For the currentlyActive assessment, the loose parser is the runtime truth - if the runtime sees [] (no validator), validation is off. So "valid: true, hasValidator: false" is the correct runtime assessment. The "invalid" case is only when parseWorkflowSteps THROWS (JSON parse error, not an object, steps not an array).

Hmm, but null is a special case. parseWorkflowSteps(null) returns [] without throwing. So runtime treats null as "no steps, no validation". So currentlyActive with null steps_json: runtime says validation is OFF (hasValidator false), and it doesn't crash. So it's "valid" in the sense that the runtime doesn't crash, but validation is off.

Now the gate: if currentlyActive has null steps_json (runtime: no validation, valid), and target has validator (enabling validation) -> beforeValid=true, targetHasValidator=true -> acknowledgeRequired=false. That seems... fine? We're enabling validation, no regression.

But wait - the design row 3 says "当前 active 非法" requires acknowledge. Is null steps_json "非法"? The design says target null is rejected (row 1). But for currentlyActive, "非法" is about whether the runtime can parse it. The runtime CAN handle null (returns []). So null currentlyActive is "valid but validation-off" by runtime semantics.

Actually, I think I'm overcomplicating. Let me re-read the design's escape hatch (§6): "当前 active 本身非法时（历史数据或手工改坏——恰恰是"可读的非法详情"要帮用户修的场景），不能一刀切拒绝，否则用户存得下正确的替代版本却永远启用不了，管理功能没有逃生口。改为：保守要求 acknowledge_validation_disabled: true（因为无法证明验证没被关掉），审计里把前值记为 unknown，允许启用这个修复版本。"

So "当前 active 非法" = the detail view shows validation_enabled: null (parse error). That happens when parseWorkflowSteps THROWS. null steps_json -> parseWorkflowSteps returns [] -> validation_enabled: false (not null). So null steps_json currentlyActive is NOT "非法" by the detail's definition - it's "valid, validation off".

Wait, let me check detail():
```
try { steps = parseWorkflowSteps(t.steps_json); validation_enabled = hasValidationStep(steps); parse_error = null }
catch { validation_enabled = null; parse_error = ... }
```
For null steps_json: parseWorkflowSteps(null) returns [] (no throw), hasValidationStep([]) = false. So validation_enabled = false, parse_error = null. So null steps_json is "valid, validation_enabled false" in the detail view.

For malformed JSON: parseWorkflowSteps throws -> validation_enabled = null, parse_error = message. This is the "非法" case.

So "currently active 非法" = validation_enabled is null (parseWorkflowSteps throws). "currently active 合法" = validation_enabled is false or true (parse succeeds, including null steps_json -> false).

OK so my `assessActiveValidation` should be:
```
function assessActiveValidation(t): { valid: boolean; hasValidator: boolean } {
  if (!t) return { valid: false, hasValidator: false };  // no active row -> treat as "unknown/invalid"
  try {
    const steps = parseWorkflowSteps(t.steps_json);  // null returns [], doesn't throw
    return { valid: true, hasValidator: hasValidationStep(steps) };
  } catch {
    return { valid: false, hasValidator: false };  // parse error -> invalid
  }
}
```

So null steps_json -> valid: true, hasValidator: false. Malformed -> valid: false. No active row -> valid: false.

Now the gate:
```
before = assessActiveValidation(currentlyActive)  // {valid, hasValidator}
beforeValid = before.valid
acknowledgeRequired = !beforeValid ? true : !targetHasValidator
```

Case: currentlyActive null steps_json (valid, no validator), target has validator -> beforeValid true, targetHasValidator true -> ackRequired false. Enabling validation from off (null) to on. No acknowledge. ✓ Makes sense.

Case: currentlyActive null steps_json (valid, no validator), target no validator -> beforeValid true, targetHasValidator false -> ackRequired true. Staying off. Hmm - requires acknowledge even though validation was already off? The matrix row 2: "currently active valid AND target disabled validation -> require acknowledge". currentlyActive is valid (null steps -> valid, hasValidator false). target disabled validation. So yes, row 2 applies -> require acknowledge. ✓ Consistent.

Case: currentlyActive malformed (invalid), target has validator -> beforeValid false -> ackRequired true (row 3, escape hatch, before=unknown). ✓

Case: currentlyActive malformed (invalid), target no validator -> beforeValid false -> ackRequired true (row 3). But wait, row "both invalid -> reject (covered by first row)". "Both invalid" means TARGET invalid. But target is valid here (target no validator but schema-valid). So target valid + currently invalid -> row 3, allow with acknowledge. ✓ Not "both invalid".

Good, my logic is correct. The "both invalid -> reject" only applies when TARGET is invalid, which validateStepsSchema catches first.

Now `beforeValidationEnabled` for audit:
- if !beforeValid -> null (unknown)
- else -> before.hasValidator (boolean)

`afterValidationEnabled` = targetHasValidator (boolean).

Now, for `createVersion` with activate=true: the target is the NEW version with input.steps_json. The gate runs on input.steps_json as target. Same logic.

For `createVersion` with activate=false: no gate, save as inactive draft (allow invalid steps_json). Audit action 'template.version_created' with details {activate: false, ...}. No validation_enabled before/after needed (no activation). But I should still record the new version's validation_enabled? The audit is about the mutation. For version_created with activate=false, details: {activate: false}. For version_created with activate=true, details: {activate: true, acknowledge_validation_disabled, validation_enabled_before, validation_enabled_after}.

Now let me think about id generation. I need a `generateWorkflowTemplateId()` - but id.ts doesn't have one. I shouldn't add to id.ts? Actually I can add it - it's not a "shared" file, it's server/src/id.ts. The task says "MAY edit any other server file". Adding a generator is fine. Let me add `generateWorkflowTemplateId(): string { return \`wft_${ulid()}\`; }` and `generateAdminAuditEventId(): string { return \`aev_${ulid()}\`; }`.

Wait, let me check existing prefix conventions. The seed is `wft_coding_default`. So `wft_` prefix. For audit, design uses `aev_1` in the migration test. So `aev_` prefix.

Now let me think about the route file.

```ts
// server/src/api/routes/workflow-templates.ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { WorkflowTemplateAdminService } from "../../services/workflow-template-admin.js";
import { parseRequestBody, AppError } from "../errors.js";
import { ErrorCode } from "@personahub/shared/errors";

export interface WorkflowTemplateRoutesOptions {
  workflowTemplateAdminService: WorkflowTemplateAdminService;
}

const NON_EDITABLE_FIELDS = [
  "collaboration_topology",
  "validation_policy_id",
  "handoff_policy_json",
  "evidence_requirements_json",
  "agent_team_template_id",
  "issue_type",
];

function rejectNonEditableFields(body: unknown): void {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const key of NON_EDITABLE_FIELDS) {
      if (key in (body as Record<string, unknown>)) {
        throw new AppError(
          ErrorCode.TEMPLATE_FIELD_NOT_EDITABLE,
          `Field '${key}' is not editable and cannot be set on a new version. Only 'name' and 'steps_json' are editable.`,
          key,
        );
      }
    }
  }
}

const listQuerySchema = z.object({
  issue_type: z.string().optional(),
});

const createVersionSchema = z.object({
  name: z.string().optional(),
  steps_json: z.string().nullable().optional(),
  activate: z.boolean().optional(),
  acknowledge_validation_disabled: z.boolean().optional(),
});

const activateSchema = z.object({
  acknowledge_validation_disabled: z.boolean().optional(),
});

export const workflowTemplateRoutes: FastifyPluginAsync<WorkflowTemplateRoutesOptions> = async (app, opts) => {
  const { workflowTemplateAdminService } = opts;

  app.get("/api/workflow-templates", async (request) => {
    const query = parseRequestBody(listQuerySchema, request.query ?? {});
    const issueType = query.issue_type ?? "coding";
    const templates = workflowTemplateAdminService.list(issueType);
    return { templates };
  });

  app.get("/api/workflow-templates/:id", async (request) => {
    const { id } = request.params as { id: string };
    const template = workflowTemplateAdminService.detail(id);
    return { template };
  });

  app.post("/api/workflow-templates/:sourceId/versions", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    rejectNonEditableFields(request.body);
    const body = parseRequestBody(createVersionSchema, request.body ?? {});
    const template = workflowTemplateAdminService.createVersion(sourceId, {
      name: body.name,
      steps_json: body.steps_json,
      activate: body.activate,
      acknowledge_validation_disabled: body.acknowledge_validation_disabled,
    });
    reply.code(201);
    return { template };
  });

  app.post("/api/workflow-templates/:id/activate", async (request) => {
    const { id } = request.params as { id: string };
    const body = parseRequestBody(activateSchema, request.body ?? {});
    const template = workflowTemplateAdminService.activate(id, body.acknowledge_validation_disabled);
    return { template };
  });

  app.post("/api/workflow-templates/:id/deactivate", async (request) => {
    const { id } = request.params as { id: string };
    const template = workflowTemplateAdminService.deactivate(id);
    return { template };
  });
};
```

Wait, the non-editable fields list. The task says: "if request carries collaboration_topology/validation_policy_id/handoff_policy_json/evidence_requirements_json -> 400 TEMPLATE_FIELD_NOT_EDITABLE". It mentions those four. But agent_team_template_id and issue_type are also inherited (not editable). Let me include all inherited fields: collaboration_topology, validation_policy_id, handoff_policy_json, evidence_requirements_json, agent_team_template_id, issue_type. Also "id", "status", "version", "created_at", "updated_at" shouldn't be settable either. But the four mentioned are the key ones. Let me include the inherited + structural fields. Actually, to be safe and match the design's "请求体只接受 name 与 steps_json" + activate + acknowledge, I'll reject ANY field other than {name, steps_json, activate, acknowledge_validation_disabled}. That's the cleanest interpretation of "请求体只接受 name 与 steps_json；其余字段出现在请求里 -> 400 TEMPLATE_FIELD_NOT_EDITABLE".

Hmm, but activate and acknowledge_validation_disabled are also accepted (they're control fields, not content fields). The design §8 says body accepts "name / steps_json + activate、acknowledge_validation_disabled". So the allowed set is {name, steps_json, activate, acknowledge_validation_disabled}. Any other field -> TEMPLATE_FIELD_NOT_EDITABLE.

Let me implement rejectNonEditableFields to reject any key NOT in the allowed set. That's the strictest and matches "请求体只接受...". But wait - the design specifically names the four content fields as triggering TEMPLATE_FIELD_NOT_EDITABLE. If I reject ANY unknown field with TEMPLATE_FIELD_NOT_EDITABLE, that includes typos etc. Is that right? The design says "其余字段出现在请求里 -> 400 TEMPLATE_FIELD_NOT_EDITABLE". "其余字段" = other fields (besides name/steps_json). So yes, any other field -> TEMPLATE_FIELD_NOT_EDITABLE. But activate/acknowledge are also allowed. So: allowed = {name, steps_json, activate, acknowledge_validation_disabled}. Any other key -> TEMPLATE_FIELD_NOT_EDITABLE.

Hmm, but should a typo like "actvate" give TEMPLATE_FIELD_NOT_EDITABLE or REQUEST_BODY_INVALID? The design says "其余字段出现在请求里 -> 400 TEMPLATE_FIELD_NOT_EDITABLE". So TEMPLATE_FIELD_NOT_EDITABLE for any extra field. I'll go with that - reject any key not in the allowed set, with TEMPLATE_FIELD_NOT_EDITABLE, field=the offending key.

Actually, wait. Let me reconsider. If I reject ANY unknown key with TEMPLATE_FIELD_NOT_EDITABLE, that's a bit aggressive for typos. But the design is explicit. And the task says "Reject extra fields that are non-editable -> 400 TEMPLATE_FIELD_NOT_EDITABLE". I'll interpret "extra fields" as any field beyond the allowed set. Let me list the non-editable content fields explicitly for a clearer error message, but also catch any other unknown. Actually, simplest:

```
const ALLOWED_CREATE_FIELDS = new Set(["name", "steps_json", "activate", "acknowledge_validation_disabled"]);
function rejectNonEditableFields(body: unknown): void {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const key of Object.keys(body as Record<string, unknown>)) {
      if (!ALLOWED_CREATE_FIELDS.has(key)) {
        throw new AppError(TEMPLATE_FIELD_NOT_EDITABLE, `Field '${key}' is not editable...`, key);
      }
    }
  }
}
```

This rejects any non-allowed field. Clean. But the error message should be specific. Let me make it: `Field '${key}' is not editable. Only 'name' and 'steps_json' (plus 'activate' and 'acknowledge_validation_disabled') are accepted.`

Good. Now let me also handle the zod schema - since I pre-check for unknown keys and reject, the zod schema can be non-strict (it won't see unknowns). Actually, I check BEFORE zod parse. So zod gets only allowed keys. Fine. But the zod schema should still validate types. Let me keep createVersionSchema as is.

Hmm wait, there's an ordering issue: I call rejectNonEditableFields(request.body) BEFORE parseRequestBody. If body is malformed (not object), rejectNonEditableFields handles it gracefully (checks typeof object). Then parseRequestBody validates types. Good.

Now let me think about the service more carefully, especially the transaction and conflict mapping.

For createVersion:
```
createVersion(sourceId, input):
  const source = this.repo.getById(sourceId);
  if (!source) throw new AppError(TEMPLATE_NOT_FOUND, "Workflow template not found.");

  const newName = input.name ?? source.name;  // if name omitted, inherit? Or require? The input is optional. If omitted, inherit from source? The design says "name 与 steps_json 可编辑". If name omitted, keep source name. If steps_json omitted, keep source steps_json.
  const newStepsJson = input.steps_json !== undefined ? input.steps_json : source.steps_json;

  try {
    const result = this.db.transaction(() => {
      const version = this.repo.getMaxVersion(source.issue_type) + 1;
      const newId = generateWorkflowTemplateId();

      if (input.activate) {
        // gate
        validateStepsSchema(newStepsJson);  // throws TEMPLATE_STEPS_INVALID
        const targetHasValidator = hasValidationStep(parseWorkflowSteps(newStepsJson));
        const currentlyActive = this.repo.getActiveByIssueType(source.issue_type);
        const before = assessActiveValidation(currentlyActive);
        const acknowledgeRequired = !before.valid ? true : !targetHasValidator;
        if (acknowledgeRequired && !input.acknowledge_validation_disabled) {
          throw new AppError(VALIDATION_DISABLE_NOT_ACKNOWLEDGED, "...");
        }
        const newTemplate = this.repo.insertVersion(source, {name: newName, steps_json: newStepsJson}, true, newId, version);
        this.auditRepo.insert({
          id: generateAdminAuditEventId(),
          action: "template.version_created",
          target_type: "workflow_template",
          target_id: newId,
          target_version: version,
          actor_type: "local_user",
          actor_id: null,
          details_json: JSON.stringify({
            activate: true,
            acknowledge_validation_disabled: input.acknowledge_validation_disabled === true,
            validation_enabled_before: before.valid ? before.hasValidator : null,
            validation_enabled_after: targetHasValidator,
            source_id: sourceId,
          }),
          created_at: new Date().toISOString(),
        });
        return newTemplate;
      } else {
        const newTemplate = this.repo.insertVersion(source, {name: newName, steps_json: newStepsJson}, false, newId, version);
        this.auditRepo.insert({
          ...
          action: "template.version_created",
          details_json: JSON.stringify({ activate: false, source_id: sourceId }),
        });
        return newTemplate;
      }
    })();
    return this.detail(result.id);
  } catch (error) {
    if (isSqliteUniqueConstraint(error, "workflow_templates.version")) {
      throw new AppError(TEMPLATE_VERSION_CONFLICT, "...");
    }
    throw error;
  }
```

Wait - the AppError for VALIDATION_DISABLE_NOT_ACKNOWLEDGED thrown inside the transaction would be caught by the catch and re-thrown (it's not a sqlite constraint). Good - it propagates. But I need to make sure I don't accidentally catch AppErrors and rethrow as something else. The catch only maps sqlite unique constraint on version; everything else rethrows. Good.

But there's an issue: `isSqliteUniqueConstraint(error, "workflow_templates.version")` - the error from better-sqlite3 when the version unique index fails. The message format... let me verify. Actually, let me check the exact column reference. The index is on (issue_type, version). SQLite message: `UNIQUE constraint failed: workflow_templates.issue_type, workflow_templates.version`. So checking `.includes("workflow_templates.version")` works. But also need to make sure the single-active index violation (if it somehow occurs) isn't mis-mapped. The single-active message: `UNIQUE constraint failed: workflow_templates.issue_type`. That doesn't include "workflow_templates.version", so it won't be mapped to VERSION_CONFLICT. Good. But if single-active IS violated (shouldn't happen with correct ordering), I'd want to map it too. Let me add: if single-active violation -> also TEMPLATE_VERSION_CONFLICT? Or a different error? Actually, single-active violation means a bug in my ordering. But defensively, let me map it to TEMPLATE_VERSION_CONFLICT as well (it's a conflict). Hmm, or let it surface. Actually, for createVersion with activate=true, my repo deactivates siblings BEFORE inserting active, so single-active shouldn't be violated. For activate(), same. So I'll only map version conflicts. If single-active somehow fires, it'll be a 500 (unmapped). That's acceptable as a "shouldn't happen" backstop. Actually, the design says the index is the backstop for ALL writers. If it fires, it's a real conflict. Let me map single-active to TEMPLATE_VERSION_CONFLICT too, to be safe. But the error code is "VERSION_CONFLICT" which is specifically about version. A single-active conflict is different semantically.

Hmm, let me reconsider. Actually for createVersion, the only expected conflict is version collision (T020b). Single-active shouldn't fire because I deactivate first. For activate(), there's no version insertion, so no version conflict; single-active shouldn't fire because I deactivate first. So neither should hit single-active. I'll map only version conflicts in createVersion. Clean.

Actually, wait. Let me reconsider the activate() flow. activate(id) doesn't insert a new version - it changes status of an existing row. So no version conflict there. The only conflict would be single-active (if my ordering is wrong). Since I deactivate all active first, then activate target, single-active is satisfied. So activate() has no conflict mapping needed.

For createVersion, version conflict is the expected one (T020b). Map it.

Now, `insertVersion` repo method. Let me define it to do the deactivate-siblings + insert:
```
insertVersion(source, input, activate, newId, version): WorkflowTemplate {
  const now = new Date().toISOString();
  if (activate) {
    this.db.prepare(
      "UPDATE workflow_templates SET status='inactive', updated_at=? WHERE issue_type=? AND status='active'"
    ).run(now, source.issue_type);
  }
  this.db.prepare(
    `INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, agent_team_template_id, validation_policy_id, steps_json, handoff_policy_json, evidence_requirements_json, status, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId, input.name, source.issue_type,
    source.collaboration_topology, source.agent_team_template_id, source.validation_policy_id,
    input.steps_json, source.handoff_policy_json, source.evidence_requirements_json,
    activate ? "active" : "inactive", version, now, now
  );
  const row = this.db.prepare("SELECT * FROM workflow_templates WHERE id = ?").get(newId) as WorkflowTemplateRow;
  return mapRow(row);
}
```

Wait, `source.collaboration_topology` - in mapRow, `collaboration_topology: row.collaboration_topology ?? ""`. So the WorkflowTemplate type has `collaboration_topology: string` (never null, defaults to ""). But the DB column is nullable. When inserting, if source.collaboration_topology is "" (empty string), should I insert "" or null? The seed inserts 'sequential'. Existing rows might have null. Let me preserve the source's DB value. But the WorkflowTemplate type has it as string ("" for null). Hmm. To preserve exactly, I should read the raw row. But mapRow converts null to "". So if source had null collaboration_topology, WorkflowTemplate.collaboration_topology = "". Inserting "" is different from null.

To be safe and preserve the raw DB value, let me have insertVersion accept the source as WorkflowTemplate but insert `source.collaboration_topology || null`? No - that converts "" to null. Actually, the cleanest: since collaboration_topology is `string` in the type (null->""), and the DB allows null, inserting "" is fine (it's a valid value). But it changes null to "" which is a (minor) mutation. For the "non-editable fields inherited exactly" requirement (T020c), I should preserve the exact value.

Hmm. Let me reconsider. The four non-editable fields: collaboration_topology, validation_policy_id, handoff_policy_json, evidence_requirements_json. Plus agent_team_template_id. These should be copied EXACTLY from source.

For validation_policy_id, handoff_policy_json, evidence_requirements_json, agent_team_template_id - these are `string | null` in the type, so they preserve null. Good.

For collaboration_topology - it's `string` in the type (null converted to ""). So if source DB had null, the type gives "", and inserting "" changes it. To avoid this, I could insert `source.collaboration_topology === "" ? null : source.collaboration_topology`. But that's hacky.

Actually, let me check: does any code care about collaboration_topology being null vs ""? The seed is 'sequential'. F007 reads it. Let me check... actually, the task says these fields have no runtime consumer in v0.2 (T020c). So null vs "" doesn't affect runtime. But for exact inheritance, I should preserve.

The cleanest solution: have insertVersion read the source's RAW row to get the exact DB values. But that's an extra query. Alternatively, change mapRow to preserve null for collaboration_topology. But that changes the WorkflowTemplate type (collaboration_topology: string | null) which is a shared type change - NOT allowed.

Let me just insert `source.collaboration_topology || null` to preserve null-ness when empty. Wait, if source is 'sequential', `|| null` keeps 'sequential'. If source is "" (was null), `|| null` gives null. If source is "" (actually empty string in DB), gives null. That's mostly fine. Actually `'sequential' || null` = 'sequential' (truthy). `'' || null` = null. So this converts empty-string to null. Since the original null was converted to "" by mapRow, and I convert back to null, it round-trips correctly for the null case. For a genuine "" in DB (unlikely), it becomes null. Acceptable given no runtime consumer.

Hmm, actually, let me just preserve via the source object directly without the `|| null` trick, inserting the string value. The DB column allows strings. Inserting "" instead of null is a minor difference with no runtime impact. But T020c test says "断言...在 v0.2 无运行时消费者" - it's about verifying no runtime consumer, not about exact byte preservation. And T020 says "issue_type 与四个不可编辑字段一律取自 sourceId 那一行" - inherited from source. Inserting source.collaboration_topology (which is "" if source had null) technically inherits the logical value.

To be safe and exact, let me read the raw source row in insertVersion. Actually, simpler: I'll pass the source WorkflowTemplate and insert its fields directly. For collaboration_topology, I'll insert `source.collaboration_topology` (string). If it was null in DB, it becomes "". This is a non-issue since no runtime consumer and the value is "inherited" logically. But to be truly exact, let me do the `|| null` conversion. Actually no - `source.collaboration_topology` is always a string (type guarantees it). Let me just insert it as-is. Done. Moving on - this is a minor point with no runtime impact, and obsessing over null-vs-"" for a field with no consumer wastes time.

Wait, actually there's a cleaner approach. Let me have the repo's insertVersion take the source and just copy fields. Since mapRow converts null->"" for collaboration_topology, and the DB column is nullable, inserting "" is valid. The inherited value is logically the same. I'll insert `source.collaboration_topology` directly. If a test checks exact null preservation, I'll revisit. But T020c is about "no runtime consumer", not exact null. Fine.

Hmm, let me reconsider once more. Actually for robustness in tests, let me preserve null where the type allows it (validation_policy_id, handoff_policy_json, evidence_requirements_json, agent_team_template_id are `string | null` - preserve directly). For collaboration_topology (string), insert as-is. This is the pragmatic choice.

Now the `activate` repo method:
```
activate(id): void {
  const target = this.db.prepare("SELECT issue_type FROM workflow_templates WHERE id = ?").get(id) as {issue_type: string} | undefined;
  if (!target) return;  // service handles 404
  const now = new Date().toISOString();
  this.db.transaction(() => {
    this.db.prepare("UPDATE workflow_templates SET status='inactive', updated_at=? WHERE issue_type=? AND status='active'").run(now, target.issue_type);
    this.db.prepare("UPDATE workflow_templates SET status='active', updated_at=? WHERE id=?").run(now, id);
  })();
}
```

Wait, but the SERVICE wraps everything in its own transaction. If the repo also wraps in a transaction, that's a nested transaction (savepoint) - fine in better-sqlite3. But the design wants the audit + activation in the SAME transaction. If repo.activate() commits its own transaction, then the audit (written after) is in a separate transaction - violating T031.

So the repo methods should NOT wrap in their own transactions. The SERVICE wraps the whole operation (gate check + repo mutations + audit) in one transaction. The repo methods are just statement runners. Let me make repo.activate() NOT transactional - just the two UPDATEs. The service wraps them with the audit in one transaction.

But wait - the service calls `this.db.transaction(() => { ... repo.activate(id); ... audit.insert(...); })()`. The repo methods use `this.db` (same connection). In better-sqlite3, a transaction is connection-level. Calling `this.db.prepare(...).run(...)` inside a `this.db.transaction()` block executes within that transaction. So repo methods that just run statements (no nested transaction) work correctly within the service's transaction.

So: repo methods = plain statements (no transaction wrapper). Service = wraps in `this.db.transaction(...)()`. Audit insert = plain statement, called within service's transaction. T031 satisfied.

But for insertVersion with activate=true, the deactivate-siblings + insert must be atomic with the audit. Since the service wraps insertVersion + audit in one transaction, and insertVersion just runs statements (deactivate UPDATE + INSERT), it's all one transaction. Good.

Let me make repo methods transaction-free (just statements):
```
insertVersion(...): just runs UPDATE (if activate) + INSERT, returns row.
activate(id): runs two UPDATEs.
deactivate(id): runs one UPDATE.
```

And the service wraps each operation in `this.db.transaction(...)()`.

Wait, but `getMaxVersion`, `getActiveByIssueType` etc. are reads - they can be called inside or outside a transaction. Inside, they see the transaction's uncommitted state. Good for re-reading currentlyActive in-txn (T030d).

Now, one concern: better-sqlite3's `db.transaction(fn)` returns a function. When called, if already in a transaction, it creates a savepoint (reentrant). So if the service wraps in a transaction and calls repo methods that DON'T start their own transaction, everything is in the service's transaction. Good.

Let me now also handle the `activate(id, acknowledge?)` service method:
```
activate(id, acknowledge):
  const target = this.repo.getById(id);
  if (!target) throw 404 TEMPLATE_NOT_FOUND;
  try {
    this.db.transaction(() => {
      validateStepsSchema(target.steps_json);  // row 1: reject invalid/NULL (T023d)
      const targetHasValidator = hasValidationStep(parseWorkflowSteps(target.steps_json));
      const currentlyActive = this.repo.getActiveByIssueType(target.issue_type);  // re-read in txn (T030d)
      const before = assessActiveValidation(currentlyActive);
      const acknowledgeRequired = !before.valid ? true : !targetHasValidator;
      if (acknowledgeRequired && !acknowledge) {
        throw new AppError(VALIDATION_DISABLE_NOT_ACKNOWLEDGED, consequenceMessage, undefined, { consequence: "..." });
      }
      this.repo.activate(id);  // deactivate all active + activate target
      this.auditRepo.insert({
        action: "template.activated",
        target_id: id, target_version: target.version,
        details_json: JSON.stringify({
          acknowledge_validation_disabled: acknowledge === true,
          validation_enabled_before: before.valid ? before.hasValidator : null,
          validation_enabled_after: targetHasValidator,
        }),
        ...
      });
    })();
  } catch (error) {
    if (isSqliteUniqueConstraint(error, "workflow_templates.issue_type") && !isSqliteUniqueConstraint(error, "workflow_templates.version")) {
      // single-active backstop - shouldn't happen with correct ordering
      throw new AppError(TEMPLATE_VERSION_CONFLICT, "...");
    }
    throw error;
  }
  return this.detail(id);
```

Hmm, the conflict mapping for activate. Since activate doesn't insert versions, version conflict won't fire. Single-active could fire if ordering is wrong (it's not). Let me just not map and let unexpected errors surface. Actually, to be safe, let me leave the catch out for activate (no conflict expected). If an AppError is thrown (gate rejection), it propagates. If sqlite error, it surfaces as 500 (shouldn't happen). Clean.

Wait, but VALIDATION_DISABLE_NOT_ACKNOWLEDGED is an AppError thrown inside the transaction. It propagates out of `transaction()()` and is re-thrown. Does better-sqlite3's transaction wrapper catch and rethrow? Yes - it rolls back and rethrows the error. So AppError propagates. Good.

Now `deactivate(id)`:
```
deactivate(id):
  const target = this.repo.getById(id);
  if (!target) throw 404 TEMPLATE_NOT_FOUND;
  if (target.status !== "active") {
    return this.detail(id);  // idempotent no-op for inactive
  }
  this.db.transaction(() => {
    const activeCount = this.repo.countActiveByIssueType(target.issue_type);
    if (activeCount <= 1) {
      throw new AppError(LAST_ACTIVE_TEMPLATE, "Cannot deactivate the last active workflow template. ...");
    }
    this.repo.deactivate(id);
    this.auditRepo.insert({
      action: "template.deactivated",
      target_id: id, target_version: target.version,
      details_json: JSON.stringify({}),
      ...
    });
  })();
  return this.detail(id);
```

Wait, I check `target.status !== "active"` OUTSIDE the transaction (using the initially-fetched target). But the status could change between fetch and transaction. For correctness, re-check inside the transaction. Let me re-fetch inside:
```
deactivate(id):
  const target = this.repo.getById(id);
  if (!target) throw 404;
  this.db.transaction(() => {
    const current = this.repo.getById(id);  // re-read in txn
    if (!current) throw 404;  // deleted concurrently
    if (current.status !== "active") return;  // idempotent
    const activeCount = this.repo.countActiveByIssueType(current.issue_type);
    if (activeCount <= 1) throw LAST_ACTIVE_TEMPLATE;
    this.repo.deactivate(id);
    this.auditRepo.insert(...);
  })();
  return this.detail(id);
```

Hmm, the idempotent return inside transaction - I need to return from createVersion/detail, not from the transaction callback. Let me restructure. The transaction returns a value. Let me have it return a flag or the template.

Actually, let me simplify. For deactivate, the no-op case (already inactive) is rare and I'll just let it proceed: if already inactive, countActive won't include it, activeCount could be >=1 (other actives). Then deactivate(id) sets it inactive (no-op) and writes audit. That writes an audit for a no-op mutation - slightly wrong.

Let me handle it cleanly: re-read inside txn, if not active, skip mutation+audit (return early from txn with a marker). Let me use a return value:

```
deactivate(id):
  const target = this.repo.getById(id);
  if (!target) throw 404 TEMPLATE_NOT_FOUND;
  const mutated = this.db.transaction(() => {
    const current = this.repo.getById(id);
    if (!current) throw 404 TEMPLATE_NOT_FOUND;
    if (current.status !== "active") return false;  // no-op
    const activeCount = this.repo.countActiveByIssueType(current.issue_type);
    if (activeCount <= 1) throw new AppError(LAST_ACTIVE_TEMPLATE, "...");
    this.repo.deactivate(id);
    this.auditRepo.insert({ action: "template.deactivated", ... });
    return true;
  })();
  // mutated flag unused; detail returned regardless
  return this.detail(id);
```

Hmm, throwing 404 inside transaction after the outside check - redundant but safe. Actually if target exists outside, it exists inside (unless concurrent delete - unlikely for templates). Let me keep the outside 404 check and trust it inside. Simplify:

```
deactivate(id):
  const target = this.repo.getById(id);
  if (!target) throw 404 TEMPLATE_NOT_FOUND;
  this.db.transaction(() => {
    const current = this.repo.getById(id);
    if (!current || current.status !== "active") return;  // no-op / deleted
    const activeCount = this.repo.countActiveByIssueType(current.issue_type);
    if (activeCount <= 1) throw new AppError(LAST_ACTIVE_TEMPLATE, "...");
    this.repo.deactivate(id);
    this.auditRepo.insert({ ... });
  })();
  return this.detail(id);
```

This works. The no-op case returns early without audit. Good.

Now, T031b: audit insert failure rolls back template change. Since audit is in the same transaction, if auditRepo.insert throws, the transaction rolls back (better-sqlite3 rolls back on any throw). To test, inject a mock audit repo whose insert throws. The service takes auditRepo as a constructor dep, so the test can pass a failing one. Good.

Now let me think about the `assessActiveValidation` and gate logic shared between createVersion(activate=true) and activate(id). Let me extract a private method:
```
private runActivationGate(issueType: string, targetStepsJson: string | null, acknowledge: boolean | undefined): {
  targetHasValidator: boolean;
  beforeValidationEnabled: boolean | null;
} {
  validateStepsSchema(targetStepsJson);  // throws TEMPLATE_STEPS_INVALID (row 1)
  const targetHasValidator = hasValidationStep(parseWorkflowSteps(targetStepsJson));
  const currentlyActive = this.repo.getActiveByIssueType(issueType);
  const before = assessActiveValidation(currentlyActive);
  const acknowledgeRequired = !before.valid ? true : !targetHasValidator;
  if (acknowledgeRequired && !acknowledge) {
    throw new AppError(
      VALIDATION_DISABLE_NOT_ACKNOWLEDGED,
      "Activating this template will disable validation for new issues. Pass acknowledge_validation_disabled: true to confirm.",
      undefined,
      {
        validation_enabled_before: before.valid ? before.hasValidator : null,
        validation_enabled_after: targetHasValidator,
      },
    );
  }
  return {
    targetHasValidator,
    beforeValidationEnabled: before.valid ? before.hasValidator : null,
  };
}
```

Then createVersion(activate=true) calls this, and activate(id) calls this. Both then do their specific mutation + audit.

Wait, for activate(id), the target is the existing row. For createVersion(activate=true), the target is the new version (input.steps_json). Both pass the target's steps_json to the gate. Good.

Now, the consequence message for VALIDATION_DISABLE_NOT_ACKNOWLEDGED. The design says "说明后果" (explain consequence). Let me craft: "Activating this template disables the validation step for all newly created issues. Pass acknowledge_validation_disabled: true to confirm this change." And details with before/after.

Now let me think about T032: "after enabling a template that disabled validation, a new Issue's implementation run completing does NOT trigger validation - verify against validator-selector behavior / IssueService.create default template selection".

This test: create a template version with no validator step, activate it, then create a new Issue (which uses getDefault() -> the activated no-validator template), and verify that selectValidator returns WorkflowConfigurationInvalid (no validation step). This verifies the end-to-end: the activated template becomes the default, and validation is off for new issues.

I can test this via selectValidator directly on the new default template, or via IssueService.create + checking the template. The simplest: after activating the no-validator template, call `workflowTemplateRepo.getDefault()` and assert it's the no-validator one, then `selectValidator({workflowTemplate: default, availableValidators: [...]})` returns reason WorkflowConfigurationInvalid. This proves T032 without running a full run.

Actually, the task says "verify against validator-selector behavior / IssueService.create default template selection". So I'll: activate no-validator template, create an Issue via IssueService.create, assert issue.workflow_template_id === noValidatorTemplate.id, and assert selectValidator on that template returns WorkflowConfigurationInvalid. That covers it.

But IssueService.create needs a full TestServices setup (project, workspace, etc.). That's heavier. Let me use createTestServices for the T032 test and a few others that need IssueService. For pure service tests, I'll use a minimal setup.

Actually, let me structure tests in one file `workflow-template-admin.test.ts` with multiple describe blocks. Some use minimal DB+repos+service, some use createTestServices for IssueService integration.

Let me now also think about T020b (concurrent createVersion). SQLite in-memory with better-sqlite3 is single-connection (synchronous). True concurrency isn't possible on one connection. To simulate the version conflict, I can: manually insert a row with the next version number BEFORE calling createVersion, so createVersion's max+1 collides. OR call createVersion twice in a way that the second hits the conflict. But since it's synchronous, the first completes (inserts version N+1), the second computes max+1 = N+2 - no collision.

To simulate T020b, I need to force a collision. Approach:
1. Create version 2 (inactive) via createVersion.
2. Manually delete it but keep max version at 2? No.
3. Better: stub getMaxVersion to return a stale value. But that requires mocking.

Alternative: directly insert a row with version = max+1 between the max computation and insert. But it's synchronous...

Hmm. The cleanest way to test T020b: have two createVersion calls where I manipulate the DB between them. Actually, since createVersion computes max+1 and inserts in one transaction (synchronous), the only way to get a collision is if the unique index already has that (issue_type, version).

Approach: Pre-seed a template with version 2 (inactive). Then call createVersion on the default (v1). It computes max(1,2)+1 = 3. No collision. That doesn't test the conflict.

To test the conflict: I need createVersion to compute max+1 = N, but (issue_type, N) already exists. So I pre-insert version N, then make createVersion compute max+1 = N (i.e., it thinks max is N-1). That requires getMaxVersion to return N-1 while version N exists.

This can happen if: version N-1 is the max EXCEPT for a higher version that... no, getMaxVersion returns MAX(version).

Wait - the real concurrency scenario: two requests both read max=1, both compute version=2, both try to insert. With a single connection, this can't happen naturally. But the unique index catches it if it DID.

To test the mapping: I can directly trigger a unique constraint violation on the version index during a createVersion-like operation. The simplest: call createVersion, but before it, manually set up state so the insert collides.

Actually, here's a clean approach: temporarily replace `repo.getMaxVersion` to return a stale (lower) value, so the computed version collides with an existing one. But I shouldn't mock the repo in an integration test.

Alternative clean approach: Use the repo's insertVersion directly with a version that already exists, and verify the service's conflict mapping. But the conflict mapping is in the service's createVersion catch block.

Hmm. Let me think differently. I can test T020b at two levels:
1. Repo level: verify that inserting a duplicate (issue_type, version) throws a unique constraint error (already covered by migration-v10 test).
2. Service level: verify that when createVersion's insert hits the unique constraint, it maps to TEMPLATE_VERSION_CONFLICT. To trigger this, I can subclass/stub the repo to make getMaxVersion return a value that causes collision.

Actually, the cleanest way: inject a repo whose `getMaxVersion` returns a stale value. The service takes `workflowTemplateRepo` as a dep. In the test, I can create a wrapper repo that delegates to the real one but overrides getMaxVersion to return `real.getMaxVersion() - 1` (stale). Then createVersion computes version = stale_max + 1 = real_max, which already exists -> unique constraint -> mapped to TEMPLATE_VERSION_CONFLICT.

Let me do that. I'll create a test-only wrapper:
```
class StaleMaxVersionRepo extends WorkflowTemplateRepository {
  constructor(private inner: WorkflowTemplateRepository, db) { super(db); }
  getMaxVersion(issueType) { return Math.max(0, this.inner.getMaxVersion(issueType) - 1); }
  // delegate everything else to inner
}
```
Hmm, but the service uses `this.repo` for all calls. If I pass a wrapper, all calls go through it. I need to delegate all methods. That's verbose.

Alternative: use Object.assign or a Proxy. Or simpler - just monkey-patch the getMaxVersion method on the repo instance for that one test:
```
const realGetMaxVersion = repo.getMaxVersion.bind(repo);
repo.getMaxVersion = (issueType) => Math.max(0, realGetMaxVersion(issueType) - 1);
// run createVersion
repo.getMaxVersion = realGetMaxVersion;  // restore
```
Since getMaxVersion is a public method, monkey-patching the instance works. This is a test-only technique. Clean enough.

Actually wait - even simpler. I can pre-insert a row with version 2 via raw SQL, then call createVersion. createVersion computes max(1,2)+1 = 3. No collision. Hmm, that gives version 3, no conflict.

Let me think again. The collision happens when createVersion computes version = V, but V already exists. So I need: max version in DB = V, and createVersion computes V (not V+1). That means getMaxVersion returns V-1 (stale). So I MUST make getMaxVersion stale.

The monkey-patch approach is the most practical. Let me use it.

Actually, there's an even cleaner approach without monkey-patching: I can test the conflict mapping by directly calling the service with a pre-collided state. Specifically:
1. Seed version 1 (default, active) and version 2 (inactive).
2. Monkey-patch repo.getMaxVersion to return 1 (stale; real max is 2).
3. createVersion -> computes version = 2 -> INSERT collides with existing version 2 -> unique constraint -> service maps to TEMPLATE_VERSION_CONFLICT.

Yes. Let me use monkey-patching for this one test. It's a standard test technique.

Alternatively, I realize I can avoid monkey-patching by testing the mapping more directly: call `repo.insertVersion` with a version that already exists, catch the sqlite error, and verify `isSqliteUniqueConstraint` detects it. But that tests the helper, not the service mapping. The service mapping (try/catch -> AppError) is what T020b wants.

Let me go with monkey-patching getMaxVersion for the T020b test. It directly exercises the service's conflict-handling path.

Now, let me also consider: the service's createVersion catch block. The transaction throws the sqlite error. `this.db.transaction(fn)()` rethrows the error. The catch checks `isSqliteUniqueConstraint(error, "workflow_templates.version")`. If true -> TEMPLATE_VERSION_CONFLICT. Else rethrow.

But wait - the gate's AppError (VALIDATION_DISABLE_NOT_ACKNOWLEDGED, TEMPLATE_STEPS_INVALID) is thrown INSIDE the transaction. It propagates out. The catch must NOT catch AppErrors and mis-map them. Since `isSqliteUniqueConstraint` checks for SQLITE_CONSTRAINT_UNIQUE code, an AppError won't match (it's not a sqlite error). So AppErrors pass through the catch (rethrown). Good.

Hmm, actually, the catch is `catch (error) { if (isSqlite...) throw VERSION_CONFLICT; throw error; }`. So AppErrors are rethrown. Good. But I should make sure I don't catch AppError at all. Let me structure:
```
try {
  this.db.transaction(() => { ... })();
} catch (error) {
  if (error instanceof AppError) throw error;  // propagate gate errors
  if (isSqliteUniqueConstraint(error, "workflow_templates.version")) {
    throw new AppError(TEMPLATE_VERSION_CONFLICT, "...");
  }
  throw error;
}
```
The `if (error instanceof AppError) throw error;` is redundant (isSqliteUniqueConstraint would return false for AppError), but it's clearer. Actually, it's NOT redundant for safety - let me keep it explicit. Hmm, but it adds noise. Since isSqliteUniqueConstraint checks `error.code === SQLITE_CONSTRAINT_UNIQUE` and AppError doesn't have that code, it's safe. I'll skip the explicit AppError check to keep it clean. Actually, let me keep it for clarity - no, the existing codebase pattern (mapGraphConstraint) just checks and rethrows. Let me match: just check sqlite constraint, else rethrow.

OK let me now write all the code. Let me set up todos first.

Actually, let me reconsider one thing about the `list` method and issue_type parameter. The route `GET /api/workflow-templates?issue_type=coding`. If issue_type omitted, default to "coding" (the only issue type in v0.2). The list method takes issueType string. Fine.

Let me also double-check: WorkflowTemplateVersionSummary needs `validation_enabled: boolean | null`. For summary, if parse fails, null. Good.

Now, let me also handle the `name` inheritance in createVersion. If input.name is undefined (omitted), inherit source.name. If input.name is provided (including empty string?), use it. The design says name is editable (display only). If empty string provided, should I reject or accept? The route zod has `name: z.string().optional()`. An empty string passes zod. Should I trim/reject? The design doesn't specify. Let me accept whatever string (including empty) - it's display-only. Actually, let me default to source.name if undefined, else use input.name. If input.name is "" (explicitly empty), use "". Fine.

For steps_json: if undefined (omitted), inherit source.steps_json. If null (explicitly), set to null (which makes it an un-activatable draft). If string, use it. The input type is `steps_json?: string | null`. So:
```
const newStepsJson = input.steps_json !== undefined ? input.steps_json : source.steps_json;
```
If input.steps_json is null -> newStepsJson = null. If undefined -> source.steps_json. If string -> that string. Good.

Now let me write everything. Let me start with the todos.

Let me also verify: do I need to add `generateWorkflowTemplateId` and `generateAdminAuditEventId` to id.ts? Yes. Let me add them.

One more thing: the `detail` return type. WorkflowTemplateDetail includes `steps: WorkflowTemplateStep[]`. When parse fails, steps = [] (empty). And validation_enabled = null, parse_error = message. Good.

Let me also check: WorkflowTemplateDetail has `collaboration_topology: string` (not null). The WorkflowTemplate type has it as string. So detail spreads `...template` which has collaboration_topology: string. Good.

Now, the audit `details_json` for deactivate - the design says audit records acknowledge + before/after validation_enabled. For deactivate, there's no acknowledge or validation change (status change only). Let me record: `{}` or maybe `{ reason: "deactivated" }`. The design §7 table says deactivate writes audit. The required fields (T031): "action / target / version / acknowledge_validation_disabled / 前后 validation_enabled / 时间". For deactivate, acknowledge is not applicable (no gate). before/after validation_enabled - the template's validation_enabled doesn't change (only status changes). So before === after === the template's validation_enabled. Let me record: `{ acknowledge_validation_disabled: false, validation_enabled_before: <t.ve>, validation_enabled_after: <t.ve> }`. That's consistent with the T031 requirement. Actually, for deactivate, recording before/after as equal is fine (no validation change, just status). Let me compute the template's validation_enabled for the audit.

Hmm, this is getting verbose. Let me simplify: for deactivate, details = `{ validation_enabled_before: <ve>, validation_enabled_after: <ve> }` (same value, no change). For version_created (activate=false), details = `{ activate: false }`. For version_created (activate=true) and activate, details = `{ acknowledge_validation_disabled: bool, validation_enabled_before: bool|null, validation_enabled_after: bool }`.

Actually, to satisfy T031 uniformly ("acknowledge_validation_disabled / 前后 validation_enabled"), let me include those fields in ALL audit entries (even deactivate and inactive version_created, where they're trivial). For deactivate: acknowledge=false, before=after=template's ve. For inactive version_created: acknowledge=false (not applicable), before=null (no activation), after=new template's ve. Hmm, that's a bit forced for inactive.

Let me be pragmatic: T031's requirement is specifically about the activation gate (where acknowledge matters). For non-activation operations, a minimal details is fine. The test T031 will check the activation audit has the right fields. T031b checks rollback. Let me make:
- version_created (activate=true): `{ activate: true, acknowledge_validation_disabled, validation_enabled_before, validation_enabled_after, source_id }`
- version_created (activate=false): `{ activate: false, source_id }`
- activated: `{ acknowledge_validation_disabled, validation_enabled_before, validation_enabled_after }`
- deactivated: `{}` or `{ reason: "deactivated" }`

The T031 test will verify the activated/version_created(activate=true) audit has the required fields. Good.

Now let me write the code. Starting with todos.

Actually, let me reconsider the audit for `activate(id)` when it's a re-activation (already active). The gate runs, audit writes. That's fine - it records the activation event. Even if idempotent, the user explicitly requested activation. OK.

Let me also reconsider: should `activate(id)` short-circuit if target is already the active row AND no gate issues? The design doesn't say to skip. I'll always run the full gate + mutation + audit. Simpler and correct.

Now, one concern about `activate` repo method deactivating ALL active rows including target, then reactivating target. If target is the ONLY active row: deactivate-all makes 0 active, then activate target makes 1 active. The partial unique index: after deactivate-all, 0 active (OK). After activate, 1 active (OK). Fine. But between the two statements (within the transaction), the invariant temporarily has 0 active. That's fine - it's within a transaction, not observable externally, and the index only checks at statement end (0 active passes, 1 active passes). Good.

Alright, let me write all files now. Let me be efficient.

Let me first add the id generators to id.ts.

Then write:
1. workflow-template.ts (extend repo)
2. validate-steps-schema.ts (new)
3. admin-audit-event.ts (new repo)
4. workflow-template-admin.ts (new service)
5. workflow-templates.ts (new route)
6. workflow-template-admin.test.ts (tests)

Let me write them.

For the repo extension, I need to be careful to keep the existing getDefault/getById and add new methods. Let me re-read the current file structure - it has WorkflowTemplateRow and mapRow as module-private. I'll add methods to the class.

Let me write the repo extension first.

Actually, for `insertVersion`, I need to handle the `source` parameter. The task signature: `insertVersion(source: WorkflowTemplate, input: {name, steps_json}, activate: boolean, newId: string, version: number): WorkflowTemplate`. Let me define an interface for the input.

Let me now write all files. I'll create the todos and then write.
I have enough context. Let me set up todos and start building.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Add id generators (wft_, aev_) to server/src/id.ts",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create server/src/repositories/admin-audit-event.ts (AdminAuditEventRepository)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/workflow-template-admin.ts (WorkflowTemplateAdminService)",
    "status
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:35:17Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\id.ts", "newString": "export function generateEvidenceSummaryId(): string {\n  return `evs_${ulid()}`;\n}\n\n// F008: workflow template admin\nexport function generateWorkflowTemplateId(): string {\n  return `wft_${ulid()}`;\n}\n\nexport function generateAdminAuditEventId(): string {\n  return `aev_${ulid()}`;\n}", "oldString": "export function generateEvidenceSummaryId(): string {\n  return `evs_${ulid()}`;\n}"})`

Step 1: Add id generators.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.

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

2. This is a newly writ
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:35:29Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\nimport type { WorkflowTemplate, IssueType } from \"@personahub/shared/types\";\n\ninterface WorkflowTemplateRow {\n  id: string;\n  name: string;\n  issue_type: string;\n  collaboration_topology: string | null;\n  agent_team_template_id: string | null;\n  validation_policy_id: string | null;\n  steps_json: string | null;\n  handoff_policy_json: string | null;\n  evidence_requirements_json: string | null;\n  status: string;\n  version: n
…[truncated])`


> [reasoning] The comment `// F008: workflow template admin` matches the existing file convention style (the task explicitly says "match file conventions like the `// F00x:` grouping style"). Let me verify the existing files use this style. Looking at errors.ts: `// F006: graph execution errors`, `// F008: workflow template admin & runtime health errors`. Yes, this is the established convention. The comment is a grouping header matching the codebase's `// F00x:` style as instructed. Proceeding.
The `// F008:` comment matches the codebase's established `// F00x:` grouping convention (seen in `errors.ts` lines 78, 87, 92) which the task explicitly requires ("match file conventions like the `// F00x:` grouping style"). Proceeding.

Step 2: Extend the WorkflowTemplateRepository.

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

## assistant · 2026-08-09T10:35:51Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\workflow-template.ts", "newString": "  // F008 T010: version history for an issue_type, ascending by version.\n  listByIssueType(issueType: string): WorkflowTemplate[] {", "oldString": "  // F008 T010: version history for an issue_type, ascending by version.\n  listByIssueType(issueType: string): WorkflowTemplate[] {\n    const rows = this.db.prepare(\n      \"SELECT * FROM workflow_templates WHERE issue_type = ? ORDER BY version
…[truncated])`


> [reasoning] The comments here are necessary. The `// F008 T0xx:` headers match the codebase convention (e.g., `validator-selector.ts:85` `// T054:`, `issue.ts:178` `// design §8.1:`). They reference the spec/design task IDs and capture non-obvious invariants that the design doc spent pages justifying:
- insertVersion: the "no nested transaction, caller computes version in-txn" constraint is a design requirement (T020/T020b) that's invisible from the signature - a future maintainer would naturally add a transaction here, breaking the atomicity guarantee.
- activate: "plain statements only - service wraps in txn" is critical for T031/T031b atomicity.

These are the "necessary comment" category (security/correctness invariants tied to design task IDs). The T010 one-liner is the convention header. I'll keep them but tighten. Actually, the insertVersion block is verbose. Let me trim it to the essential invariant warning, matching the terse style of existing comments. Let me reduce.
These comments are necessary: they encode design invariants (T020/T023/T031) that are invisible from the method signature — a maintainer would naturally add a transaction wrapper to `insertVersion`, breaking the "version-compute + insert + audit in one atomic unit" guarantee (T020b/T031b). They match the codebase's `// T0xx:` convention (`validator-selector.ts:85`, `issue.ts:178`). Let me tighten them to be terse.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:36:09Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\workflow-template.ts", "limit": 50, "offset": 55})`


> [reasoning] Hmm, that edit removed too much - it removed the method bodies. Let me re-read the file to see what happened.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\repositories\workflow-template.ts</path>
<type>file</type>
<content>
55:       "SELECT * FROM workflow_templates WHERE id = ?"
56:     ).get(id) as WorkflowTemplateRow | undefined;
57:     return row ? mapRow(row) : null;
58:   }
59:
60:   // F008 T010: version history for an issue_type, ascending by version.
61:   listByIssueType(issueType: string): WorkflowTemplate[] {
62:     source: WorkflowTemplate,
63:     input: InsertVersionInput,
64:     activate: boolean,
65:     newId: string,
66:     version: number,
67:   ): WorkflowTemplate {
68:     const now = new Date().toISOString();
69:     const status = activate ? "active" : "inactive";
70:     if (activate) {
71:       this.db.prepare(
72:         "UPDATE workflow_templates SET status = 'inacti
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:36:20Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\nimport type { WorkflowTemplate, IssueType } from \"@personahub/shared/types\";\n\ninterface WorkflowTemplateRow {\n  id: string;\n  name: string;\n  issue_type: string;\n  collaboration_topology: string | null;\n  agent_team_template_id: string | null;\n  validation_policy_id: string | null;\n  steps_json: string | null;\n  handoff_policy_json: string | null;\n  evidence_requirements_json: string | null;\n  status: string;\n  version: n
…[truncated])`

The edit mangled the file. Let me rewrite it cleanly.

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

## assistant · 2026-08-09T10:36:39Z

- **tool**: `todowrite({"todos": [{"content": "Add id generators (wft_, aev_) to server/src/id.ts", "priority": "high", "status": "completed"}, {"content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate", "priority": "high", "status": "completed"}, {"content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)", "priority": "high", "status": "in_progress"}, {"content": "C
…[truncated])`


> [reasoning] These comments are necessary - they encode the design's atomicity invariant (T020/T023/T031): "plain statements only, service wraps in transaction". A future maintainer would naturally add `this.db.transaction(...)` to these repo methods, which would break the T031 atomicity guarantee (audit + mutation in one transaction). The codebase already uses this comment style (`// T054:`, `// design §8.1:`). The T010/T020/T023 task-ID headers are the codebase convention. Proceeding.
These are necessary comments encoding the atomicity invariant (T020/T023/T031): "plain statements only, service wraps in transaction" — a maintainer would naturally add a transaction wrapper here, breaking the audit+mutation atomicity guarantee. They match the codebase's `// T0xx:` convention. Proceeding.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Add id generators (wft_, aev_) to server/src/id.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)",
    "status": "in_progress",
    "priority": "high"
  },
  {
    "content": "Create server/src/repositories/admin-audit-event.ts (AdminAuditEventRepository)",
    "status": "pending",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/workflow-template-admin.ts (WorkflowTemplateAdminService)",
    "st
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:36:51Z

- **tool**: `write({"content": "import { ErrorCode } from \"@personahub/shared/errors\";\nimport { AdapterRole } from \"@personahub/shared/types\";\nimport { AppError } from \"../../api/errors.js\";\n\nconst SUPPORTED_SCHEMA_VERSION = 1;\nconst VALID_ROLES = new Set<string>([AdapterRole.Implementation, AdapterRole.Validator]);\n\n// F008 T023c: STRICT write-gate for activation, distinct from the loose\n// parseWorkflowSteps() runtime path (which ignores schema_version, accepts any\n// role string, and silently fil
…[truncated])`

Step 3: Strict validator.

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

## assistant · 2026-08-09T10:37:08Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\n\nexport interface AdminAuditEventInput {\n  id: string;\n  action: string;\n  target_type: string;\n  target_id: string;\n  target_version: number | null;\n  actor_type: string;\n  actor_id: string | null;\n  details_json: string;\n  created_at: string;\n}\n\n// F008 T031: global audit ledger for workflow-template mutations. insert() is\n// a plain statement so the service can keep it in the same transaction as the\n// template mutatio
…[truncated])`


> [reasoning] This comment is necessary: it documents WHY this validator exists as a separate function from `parseWorkflowSteps` - the design (§6, T023c) explicitly mandates two separate functions with different strictness levels, and a maintainer would otherwise "DRY" them together, reintroducing the security hole where broken templates become activatable. This is a security/correctness invariant comment matching the codebase convention. Proceeding.
This comment is necessary: it documents the design-mandated (§6/T023c) separation between the strict write-gate and the loose runtime parser - a maintainer would otherwise DRY them together, reintroducing the hole where broken templates become activatable. Security invariant, matches codebase convention. Proceeding.

Step 4: Audit repo.

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

## assistant · 2026-08-09T10:37:27Z

- **tool**: `todowrite({"todos": [{"content": "Add id generators (wft_, aev_) to server/src/id.ts", "priority": "high", "status": "completed"}, {"content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate", "priority": "high", "status": "completed"}, {"content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)", "priority": "high", "status": "completed"}, {"content": "Cre
…[truncated])`


> [reasoning] This comment is necessary: it documents the T031/T031b atomicity invariant ("plain statement so service keeps it in the same transaction") and the actor_id-always-null design decision (§7). Both are design-mandated invariants a maintainer would violate. Proceeding.
Necessary: documents the T031/T031b atomicity invariant ("plain statement, same transaction as mutation") and the actor_id-always-null design decision (§7) - both design-mandated invariants a maintainer would violate. Proceeding.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Add id generators (wft_, aev_) to server/src/id.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/repositories/admin-audit-event.ts (AdminAuditEventRepository)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/workflow-template-admin.ts (WorkflowTemplateAdminService)",
    "st
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:37:40Z

- **tool**: `write({"content": "import type Database from \"better-sqlite3\";\nimport { ErrorCode } from \"@personahub/shared/errors\";\nimport type {\n  WorkflowTemplate,\n  WorkflowTemplateVersionSummary,\n  WorkflowTemplateDetail,\n  CreateWorkflowTemplateVersionInput,\n} from \"@personahub/shared/types\";\nimport type { WorkflowTemplateRepository } from \"../repositories/workflow-template.js\";\nimport type { AdminAuditEventRepository } from \"../repositories/admin-audit-event.js\";\nimport {\n  parseWorkflowS
…[truncated])`

Step 5: The admin service - the core of the feature.

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

## assistant · 2026-08-09T10:38:06Z

- **tool**: `todowrite({"todos": [{"content": "Add id generators (wft_, aev_) to server/src/id.ts", "priority": "high", "status": "completed"}, {"content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate", "priority": "high", "status": "completed"}, {"content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)", "priority": "high", "status": "completed"}, {"content": "Cre
…[truncated])`


> [reasoning] These comments are all necessary - they encode the design's correctness invariants (T020/T023/T030b/T030c/T030d/T031) that are the explicit subject of the "初稿漏洞已修正" notes. The gate matrix comment documents the four-row decision table that the design spent significant text justifying - without it, the `acknowledgeRequired` formula is opaque and a maintainer would "simplify" it to "always require acknowledge" or "never require", reintroducing the T023e deadlock or the T030 bypass. The T030c comment documents the most critical invariant (currentlyActive vs source separation). All match the codebase's `// T0xx:` / `// design §` convention. Proceeding.
These comments are all necessary: they encode the design's "初稿漏洞已修正" invariants (T020/T023/T030b/T030c/T030d) that are the explicit crux of correctness. The gate-matrix comment documents the four-row decision table - without it, the `acknowledgeRequired` formula is opaque and a maintainer would "simplify" it, reintroducing the T023e deadlock or the T030 bypass. The T030c comment documents the most critical invariant (currentlyActive vs source separation). All match the `// T0xx:` convention. Proceeding.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Add id generators (wft_, aev_) to server/src/id.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/repositories/admin-audit-event.ts (AdminAuditEventRepository)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/workflow-template-admin.ts (WorkflowTemplateAdminService)",
    "st
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:38:19Z

- **tool**: `write({"content": "import type { FastifyPluginAsync } from \"fastify\";\nimport { z } from \"zod\";\nimport { ErrorCode } from \"@personahub/shared/errors\";\nimport type { WorkflowTemplateAdminService } from \"../../services/workflow-template-admin.js\";\nimport { parseRequestBody, AppError } from \"../errors.js\";\n\nexport interface WorkflowTemplateRoutesOptions {\n  workflowTemplateAdminService: WorkflowTemplateAdminService;\n}\n\n// F008 T020/AC-008: only name and steps_json are editable content
…[truncated])`

Step 6: The route plugin.

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

## assistant · 2026-08-09T10:38:34Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\workflow-template.ts"})`


> [reasoning] This comment is necessary: it documents WHY non-editable fields are rejected rather than silently ignored (AC-008 security invariant) - a maintainer would naturally switch to silent-stripping for "robustness", reintroducing the silent-correctness-failure the design §5c explicitly calls out. Matches the codebase's route-boundary comment convention (see adapters.ts:12-24). Proceeding.
Necessary: documents WHY non-editable fields are rejected (not silently stripped) per AC-008 - a maintainer would switch to silent-stripping for "robustness", reintroducing the silent-correctness-failure design §5c explicitly warns against. Matches the route-boundary comment convention (`adapters.ts:12-24`). Proceeding.

Now let me run lsp_diagnostics on the new files before writing tests.

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:38:47Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\validation\\validate-steps-schema.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:38:56Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\admin-audit-event.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:39:09Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\workflow-template-admin.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:39:23Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\api\\routes\\workflow-templates.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:39:32Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\src\\db\\index.ts"})`


> [reasoning] All clean. Now let me write the tests. This is the biggest file. Let me plan the test structure carefully.

I'll create one test file `server/tests/integration/workflow-template-admin.test.ts` with multiple describe blocks covering T010-T032. I'll also create a unit test for the strict validator `server/tests/unit/validate-steps-schema.test.ts` for T023c.

Let me design the test helpers. I need:
- A minimal in-memory DB with migrations applied.
- Repos: WorkflowTemplateRepository, AdminAuditEventRepository.
- The service: WorkflowTemplateAdminService.
- For some tests (T022, T024, T032): IssueRepository + IssueService, which needs more deps. I'll use createTestServices for those, OR construct IssueService manually with minimal deps.

Actually, for T022 (immutability of issue's template), T024 (getDefault regression), T032 (IssueService.create default selection), I need IssueService. createTestServices gives me everything but it's heavy. Let me use createTestServices for those few tests since it already wires workflowTemplateRepo and issueService.

For the pure service tests (detail, createVersion, activate, deactivate, gate, audit), I'll use a minimal setup: openDatabase(":memory:"), repos, service.

Let me check what openDatabase does - it applies migrations. Let me verify.
Let me check `openDatabase` and confirm it applies migrations, then write the tests.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\src\db\index.ts</path>
<type>file</type>
<content>
1: import Database from "better-sqlite3";
2: import { applyMigrations } from "./migrations.js";
3:
4: export function openDatabase(dbPath: string): Database.Database {
5:   const db = new Database(dbPath);
6:   db.pragma("journal_mode = WAL");
7:   db.pragma("foreign_keys = ON");
8:   db.pragma("busy_timeout = 5000");
9:   applyMigrations(db);
10:   return db;
11: }

(End of file - total 11 lines)
</content>
  ```
  </details>

## assistant · 2026-08-09T10:39:47Z

- **tool**: `write({"content": "import { describe, it, expect } from \"vitest\";\nimport { ErrorCode } from \"@personahub/shared/errors\";\nimport { AppError } from \"../../src/api/errors.js\";\nimport { validateStepsSchema } from \"../../src/services/validation/validate-steps-schema.js\";\nimport {\n  parseWorkflowSteps,\n  hasValidationStep,\n  ValidatorSelectorError,\n} from \"../../src/services/validation/validator-selector.js\";\n\nfunction withValidatorSteps(): string {\n  return JSON.stringify({\n    schema
…[truncated])`


> [reasoning] `openDatabase` applies migrations including v10. So `createTestDb()` (which calls `openDatabase(":memory:")`) gives me a fully-migrated in-memory DB with the seed `wft_coding_default` (v1, active, coding) and the two unique indexes.

Now let me write the tests. I'll create:
1. `server/tests/unit/validate-steps-schema.test.ts` - T023c strict validator unit tests.
2. `server/tests/integration/workflow-template-admin.test.ts` - the main integration test covering T010-T032.

Let me write the strict validator unit test first (T023c), then the integration test.

For T023c, I need to verify:
- rejects unsupported schema_version
- rejects unknown role
- rejects malformed/empty steps
- rejects duplicate step id
- rejects unexpected fields
- AND the loose parseWorkflowSteps is untouched (still ignores schema_version, accepts any role, filters malformed). I'll assert parseWorkflowSteps behavior is unchanged for the same inputs.

Let me write the integration test. I'll structure it with helper functions:
- `makeService(db)` -> { repo, auditRepo, service }
- `stepsJson(steps)` helper -> JSON.stringify({schema_version:1, steps})
- `validStepsWithValidator` -> [{id:"implementation",role:"implementation"},{id:"validation",role:"validator"}]
- `validStepsNoValidator` -> [{id:"implementation",role:"implementation"}]

For the route tests (minimal Fastify app), I'll build a helper that constructs Fastify + registers only workflowTemplateRoutes.

Let me think about each test case and map to task IDs:

**T010/T011/T012/T013 (detail projection)**
- T010: listByIssueType returns versions ascending.
- T011: detail returns steps + validation_enabled (true when validator present).
- T012: invalid steps_json -> validation_enabled null + parse_error, request doesn't fail.
- T013: same-origin consistency - admin projection matches validator-selector for several steps_json.

**T020 (createVersion)**
- only name/steps_json accepted; non-editable field -> TEMPLATE_FIELD_NOT_EDITABLE (route-level).
- new id, version=max+1 same txn.
- issue_type + 4 non-editable fields inherited from source.

**T020b (concurrent max+1 -> TEMPLATE_VERSION_CONFLICT)**
- monkey-patch getMaxVersion to return stale value, assert conflict.

**T020c (non-editable fields read-only, inherited)**
- assert the 4 non-editable fields are copied from source, not from input.

**T021 (insertVersion activate:true deactivates siblings -> single active)**
- create version with activate:true, assert only one active.

**T022 (immutability - issue referenced)**
- create issue with default template, createVersion on that template, assert original row unchanged + issue.workflow_template_id unchanged.

**T023 (deactivate last active -> LAST_ACTIVE_TEMPLATE)**
- assert reject; activate/deactivate replace setStatus.

**T023b (single-active invariant)**
- activate old version, double-activate different, activate + insertVersion interleaved -> at most one active.

**T023c (strict validator)** - in unit test file.

**T023d (activate hard-rejects NULL/invalid; inactive draft may save invalid)**
- save invalid draft (ok), activate it (reject).

**T023e (source invalid + target valid -> acknowledge required, before=unknown, allowed)**
- corrupt the active template's steps_json, create valid version with activate:true + acknowledge, assert allowed + audit before=null.

**T030 (activate removed validator -> require acknowledge else 400)**
- active has validator, create/activate no-validator version without acknowledge -> 400; with acknowledge -> ok.

**T030b (four-row matrix)**
- row 1: target invalid -> reject.
- row 2: active valid + target no-validator -> acknowledge required.
- row 3: active invalid + target valid -> acknowledge required, before=unknown, allow.
- row 4 (target valid + keeps validator) -> no acknowledge.

**T030c (from inactive old v1 no-validator, current active v3 has validator -> still requires acknowledge)**
- create v1 no-validator inactive, v2 with validator active, clone from v1 -> v3, activate v3 -> requires acknowledge (because currentlyActive=v2 has validator, target v3 no validator).

Wait, let me re-read T030c: "当前 active v3 有 validator，从无 validator 的 inactive v1 克隆出 v4 并激活，断言仍然要求 acknowledge". So: v1 inactive no-validator, v3 active with-validator. Clone from v1 (no-validator) -> v4, activate v4. Since currentlyActive (v3) has validator and target (v4) has no validator -> acknowledge required. The source (v1) has no validator, so if we (wrongly) compared source->target, "no change" -> no acknowledge (bypass). The test asserts acknowledge IS required (comparing currentlyActive, not source).

**T030d (activate re-reads current active inside txn)**
- Hard to test true concurrency. I'll test: activate(id) re-reads currentlyActive in-txn by verifying the gate uses the CURRENT active, not a stale snapshot. Approach: have v1 active (validator), then manually make v2 active and v1 inactive (simulating a concurrent change) BEFORE calling activate on a no-validator v3. Actually, simpler: the gate already re-reads via getActiveByIssueType inside the txn. To test T030d, I can verify that activate's gate decision reflects the in-txn state.

Hmm, let me think of a concrete test. The concern (T030d): "激活事务内重新读取当前 active 行，不复用请求发起时的快照". The bug would be: service fetches currentlyActive BEFORE the txn, uses that stale snapshot in the gate. My implementation fetches inside the txn (runActivationGate calls getActiveByIssueType). To test:
1. v1 active with validator.
2. Create v2 no-validator (inactive).
3. Call service.activate(v2.id) - but BEFORE the txn reads currentlyActive, change the active row.

Since it's synchronous, I can't interleave. But I can test the LOGIC: the gate uses the in-txn currentlyActive. Let me test by:
- v1 active (validator).
- Manually deactivate v1 and activate a no-validator v2 (raw SQL) - now v2 (no validator) is active.
- Call service.activate(v1.id) - target v1 has validator, currentlyActive v2 has no validator (valid, no validator). before.valid=true, before.hasValidator=false. targetHasValidator=true. acknowledgeRequired = !before.valid(false) ? ... : !targetHasValidator = !true = false. So NO acknowledge required (enabling validation).
- If the service used a stale snapshot (e.g., v1 as active), before would be v1 (validator), target v1 (validator) -> no acknowledge too. Same result. Not a discriminating test.

Let me design a discriminating test for T030d: the key is that the gate sees the CURRENT active, not a request-time snapshot.
- Setup: v1 active with validator.
- Call activate(v2) where v2 has no validator. CurrentlyActive (v1) has validator. Without acknowledge -> 400.
- Now, simulate: between the "request" and the txn, v1 gets deactivated and v3 (no validator) becomes active. Then activate(v2): currentlyActive is v3 (no validator, valid). before.valid=true, before.hasValidator=false. target v2 no validator. acknowledgeRequired = !false : !true = true. Still requires acknowledge. Hmm, still requires.

Actually, the discriminating case:
- v1 active (validator). v2 no-validator (inactive).
- Stale snapshot: currentlyActive = v1 (validator). Target v2 (no validator). acknowledgeRequired = !valid(false)?:!hasValidator(true) = true. Require acknowledge.
- In-txn reality: v1 was deactivated, NO active row (or a no-validator active). If no active row: before.valid=false. acknowledgeRequired = !false = true. Still require.
- If in-txn active is v2 itself (already active): before = v2 (no validator, valid). target v2 (no validator). acknowledgeRequired = !valid(false)?:!hasValidator(true) = true. Still require.

Hmm, it's hard to find a case where stale vs in-txn differ in the gate decision, because the gate is conservative. Let me think...

The case where they differ:
- Stale snapshot: currentlyActive = X (invalid).
- In-txn reality: currentlyActive = Y (valid, has validator).
- Target: no validator.
- Stale: before.valid=false -> acknowledgeRequired=true.
- In-txn: before.valid=true, before.hasValidator=true -> acknowledgeRequired = !true = true.
Both require. Same.

Another case:
- Stale: currentlyActive = X (valid, no validator).
- In-txn: currentlyActive = Y (valid, has validator).
- Target: has validator.
- Stale: before.valid=true, before.hasValidator=false. targetHasValidator=true. acknowledgeRequired = !true = false. No acknowledge.
- In-txn: before.valid=true, before.hasValidator=true. targetHasValidator=true. acknowledgeRequired = !true = false. No acknowledge.
Same.

The ONLY case where stale vs in-txn differ in the DECISION:
- Stale: currentlyActive = X (valid, has validator).
- In-txn: currentlyActive = Y (valid, NO validator).
- Target: no validator.
- Stale: before.hasValidator=true, target no validator -> acknowledgeRequired = !true = true. Require.
- In-txn: before.hasValidator=false, target no validator -> acknowledgeRequired = !false... wait. before.valid=true, targetHasValidator=false. acknowledgeRequired = !before.valid(false) ? ... : !targetHasValidator = !true = true. Require.
Both require. Hmm.

Actually wait, the difference is in the AUDIT before-value, not just the decision. T030d says "激活事务内重新读取当前 active 行，不复用请求发起时的快照；两个并发激活各自基于最新前值判断". The "前值" (before value) in audit must reflect the in-txn state. So I can test:
- v1 active (validator).
- Call activate(v2) where v2 has validator too (no acknowledge needed).
- The audit before-value should be true (v1 has validator).
- Now, change active to a no-validator v3 (raw SQL), then activate(v2-with-validator). Audit before-value should be false (v3 no validator), reflecting in-txn re-read.

But this tests the audit before-value, which is a T031 concern. For T030d specifically, let me test: the gate's acknowledge requirement and audit before-value reflect the in-txn currentlyActive, not a stale snapshot.

Actually, the cleanest T030d test: verify that the audit `validation_enabled_before` matches the in-txn active row, even when I manually change the active row just before calling activate. Since it's synchronous, "just before" = in the test setup. The point is the service reads it fresh inside the txn (not cached from construction). Let me:
1. v1 active (validator).
2. Manually set v1 steps_json to no-validator (raw SQL) - so the active row now has no validator. (Simulating a concurrent change to the active row's content.)
3. Call activate(v2) where v2 has validator, no acknowledge.
4. CurrentlyActive = v1 (now no-validator, valid). before.valid=true, before.hasValidator=false. target v2 has validator. acknowledgeRequired = !true = false. No acknowledge needed -> succeeds.
5. Audit before = false (v1 no validator), after = true (v2 validator).
6. If the service had cached/stale-snapshotted v1 as validator (from step 1's original state), before would be true, and... targetHasValidator=true -> acknowledgeRequired=false. Same decision. But audit before would be true (wrong). So the audit before-value is the discriminator.

Hmm, this is getting complicated. Let me simplify T030d: I'll test that the audit `validation_enabled_before` reflects a change to the active row made between service construction and the activate call. This proves the service re-reads inside the txn (not at construction).

Actually, the simplest proof of T030d: the service doesn't cache currentlyActive at all - it calls getActiveByIssueType inside runActivationGate every time. So any change to the active row before the call is reflected. I'll test:
1. v1 active (validator).
2. Corrupt v1's steps_json (raw SQL) to malformed JSON.
3. Call activate(v2) where v2 has validator, acknowledge=true.
4. before.valid=false (v1 malformed), before=null. Target valid+validator. acknowledgeRequired=true. acknowledge=true -> allowed.
5. Audit before=null (unknown), after=true.
6. This proves the gate saw the CURRENT (corrupted) v1, not a cached valid v1.

This is actually the T023e escape-hatch test combined with T030d. Let me make T030d a focused test: change the active row's validation state between calls and verify the gate/audit reflects the latest.

Let me write a clean T030d test:
1. v1 active (validator).
2. createVersion(v1, {steps_json: no-validator, activate:false}) -> v2 (inactive, no validator).
3. activate(v2) without acknowledge -> 400 (because currentlyActive v1 has validator, target v2 no validator -> require acknowledge). This confirms gate reads currentlyActive.
4. Now manually deactivate v1 and activate v2 via raw SQL (so v2 no-validator is active). Wait, that uses the index... let me use the service: activate(v2, acknowledge=true) -> v2 active. Now v1 inactive.
5. createVersion(v2, {steps_json: with-validator, activate:false}) -> v3 (inactive, with validator).
6. activate(v3) without acknowledge -> should SUCCEED (currentlyActive v2 no validator, target v3 has validator -> enabling, no acknowledge). Audit before=false, after=true.
7. This proves the gate re-read currentlyActive (v2, no validator) for the v3 activation, not a stale v1 (validator). If stale (v1 validator), before=true, target v3 validator -> no acknowledge -> same decision. Hmm, not discriminating on decision.

OK the decision is hard to discriminate because the gate is conservative. The AUDIT before-value is the clean discriminator. Let me test T030d via the audit before-value:
1. v1 active (validator).
2. activate(v1) again with no acknowledge -> audit before=true (v1 validator), after=true. (re-activation, idempotent gate)
3. Manually change v1 steps_json to no-validator (raw SQL).
4. createVersion(v1, {steps_json: with-validator, activate:true}) -> v2. CurrentlyActive v1 (now no-validator). before=false, after=true. acknowledgeRequired: before.valid=true, targetHasValidator=true -> !true=false. No acknowledge. Audit before=false.
5. Assert v2's audit before=false. If the service had cached v1 as validator (stale), before would be true. This proves in-txn re-read.

Wait, in step 4, after createVersion activate:true, v1 is deactivated and v2 is active. The "before" is v1's state (no-validator after the raw SQL change). So audit before=false. Good. This discriminates: stale (v1 validator -> before=true) vs in-txn (v1 no-validator -> before=false).

Actually, I realize the service never caches - it always calls getActiveByIssueType in runActivationGate. So T030d is inherently satisfied. The test just confirms the audit before-value reflects the current state. Let me write it as: change active row's content, then activate, assert audit before-value matches the changed content (not the original).

OK, I think I'm overanalyzing T030d. Let me write a clear test:
- v1 active with validator.
- Raw-SQL update v1.steps_json to a no-validator schema.
- createVersion(v1, {steps_json: with-validator, activate: true}) -> v2.
- v2's audit validation_enabled_before should be false (v1 now has no validator), proving the gate re-read v1's current state inside the txn.

Good. Let me also do the route-level tests for the main endpoints + error codes.

For T032 (end-to-end: disabled validation template -> new issue's impl run completion doesn't trigger validation), I'll use createTestServices:
1. Activate a no-validator template (becomes default).
2. Create an issue via issueService.create -> issue.workflow_template_id === no-validator template id.
3. selectValidator({workflowTemplate: noValidatorTemplate, availableValidators: [...]}) -> reason WorkflowConfigurationInvalid (no validation step).
This proves validation won't trigger.

Actually, T032 says "a new Issue's implementation run completing does NOT trigger validation". The selectValidator check proves the validator selector returns null (no validation). That's the mechanism. I'll assert selectValidator returns WorkflowConfigurationInvalid. Good enough per "verify against validator-selector behavior".

Let me also handle T024 (getDefault regression):
- createVersion (inactive) -> getDefault() still returns v1.
- activate the new version -> getDefault() returns the new version.

For T022 (immutability):
- Use createTestServices. Create issue (uses v1). createVersion(v1, {steps_json: new}) -> v2. Assert v1's row content unchanged (getById(v1) fields identical). Assert issue.workflow_template_id === v1.id (unchanged).

Now, the FailingAuditRepo for T031b: I'll create a test subclass/wrapper of AdminAuditEventRepository that throws on insert. Since the service takes AdminAuditEventRepository as a dep, I can pass a failing one. Let me create a simple class in the test:
```
class FailingAuditRepo extends AdminAuditEventRepository {
  insert(): void { throw new Error("injected audit failure"); }
}
```
But it needs a db for the constructor. I'll pass the same db. The insert throws. Then createVersion/activate should roll back. Assert no new template row, no audit row, and the original state unchanged.

Wait - but FailingAuditRepo extends AdminAuditEventRepository and the service's constructor type is `AdminAuditEventRepository`. Passing a subclass works. Good. But TypeScript structural typing - the service expects `AdminAuditEventRepository`. A subclass instance is assignable. Good.

Now let me write the tests. This is a large file. Let me be comprehensive but efficient.

Let me also write the unit test for the strict validator (T023c) separately since it's a pure function.

Let me check the ValidationBlockReason import for T032.
Now let me write the strict validator unit test (T023c) and the main integration test.

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

## assistant · 2026-08-09T10:40:51Z

- **tool**: `write({"content": "import { describe, it, expect, beforeEach, afterEach } from \"vitest\";\nimport Fastify from \"fastify\";\nimport Database from \"better-sqlite3\";\nimport { createTestServices, createTempDir, disposeTestServices, type TestServices } from \"../helpers.js\";\nimport { openDatabase } from \"../../src/db/index.js\";\nimport { WorkflowTemplateRepository } from \"../../src/repositories/workflow-template.js\";\nimport { AdminAuditEventRepository } from \"../../src/repositories/admin-audit
…[truncated])`


> [reasoning] These comments document the deliberate divergence between strict and loose parsers - the core design point of T023c. They're necessary to prevent a future maintainer from "unifying" the two parsers (which would reintroduce the security hole or break runtime tolerance). Proceeding.
Necessary: documents the deliberate strict/loose divergence that is the core point of T023c - prevents a maintainer from unifying the parsers (reintroducing the security hole or breaking runtime tolerance). Proceeding.

Now the main integration test. Let me write it comprehensively.

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

## assistant · 2026-08-09T10:41:57Z

- **tool**: `read({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts", "limit": 50, "offset": 128})`


> [reasoning] The test comments are BDD-style step annotations (Given/When/Then flow markers) that match the codebase's existing test comment convention (see `validation-validator-selector.test.ts`, `graph-routes-mutations.test.ts:14-21`). They document the non-obvious test setup/intent, especially for the tricky T020b monkey-patch, T030c source-vs-currentlyActive discrimination, and T030d in-txn re-read. These are necessary for the test reviewers to understand WHY each test is structured this way (the design's "初稿漏洞" scenarios). The T030c comment in particular documents the exact bypass the test prevents. Proceeding.

Now let me clean up the T013 test - it has a weird `void AdapterRoleVals` and an over-complex inline selector check. Let me simplify it. Actually, let me first run the tests to see if they pass, then fix issues. But the T013 test has dead code (`AdapterRoleVals`, `cfg`). Let me simplify it before running.

Actually, let me simplify the T013 test - the inline selectValidator logic is convoluted. Let me rewrite it to be cleaner.
These test comments are BDD-style step annotations matching the codebase's test convention (`graph-routes-mutations.test.ts:14-21`), documenting non-obvious setup intent - especially T020b's monkey-patch, T030c's source-vs-currentlyActive bypass, and T030d's in-txn re-read. Necessary for reviewers. But the T013 test has convoluted dead code - let me simplify it.

  <details><summary>tool output</summary>

  ```text
<path>D:\Projects\personahub\server\tests\integration\workflow-template-admin.test.ts</path>
<type>file</type>
<content>
128:     const detail = f.service.detail(DEFAULT_TEMPLATE_ID);
129:     expect(detail.validation_enabled).toBe(false);
130:     expect(detail.parse_error).toBeNull();
131:   });
132:
133:   it("T013: admin projection matches validator-selector for varied steps_json (AC-001 same-origin)", () => {
134:     const cases: Array<{ json: string | null; expected: boolean | null }> = [
135:       { json: WITH_VALIDATOR, expected: true },
136:       { json: NO_VALIDATOR, expected: false },
137:       { json: null, expected: false },
138:       { json: "not json", expected: null },
139:       { json: JSON.stringify({ schema_version: 1, steps: [{ id: "x", role: "reviewer" }] }), ex
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:42:14Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts", "newString": "  it(\"T013: admin projection matches validator-selector for varied steps_json (AC-001 same-origin)\", () => {\n    const cases: Array<{ json: string | null; expected: boolean | null }> = [\n      { json: WITH_VALIDATOR, expected: true },\n      { json: NO_VALIDATOR, expected: false },\n      { json: null, expected: false },\n      { json: \"not json\", expected: null },\n      { j
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.

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

2. This is a newly writ
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:42:31Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts", "newString": "import {\n  ValidationBlockReason,\n} from \"@personahub/shared/types\";\nimport { selectValidator } from \"../../src/services/validation/validator-selector.js\";", "oldString": "import {\n  AdapterRole,\n  ValidationBlockReason,\n  type AdapterConfig,\n  type WorkflowTemplate,\n} from \"@personahub/shared/types\";\nimport { selectValidator } from \"../../src/services/validation/va
…[truncated])`


> [reasoning] This comment explains the non-obvious AC-001 same-origin cross-check logic (why `reason !== WorkflowConfigurationInvalid` maps to validation_enabled). It's a necessary comment documenting the test's correctness reasoning - the mapping between selectValidator's reason codes and the admin's validation_enabled boolean is non-obvious. Proceeding.

Now let me also fix the T022 test which had a dead `original`/`placeholder` line. Let me check and clean it up. Then remove the unused imports (AdapterRole, AdapterConfig, WorkflowTemplate may now be unused in the integration test after the T013 simplification).

Let me check the imports. The integration test imports: AdapterRole, ValidationBlockReason, AdapterConfig, WorkflowTemplate. After simplifying T013:
- AdapterRole: was used in the dead code (Object.values(AdapterRole)). Now unused. Remove.
- AdapterConfig: was used in dead cfg. Now unused. Remove.
- WorkflowTemplate: was used in dead `t`. Now unused? Let me check - T013 no longer uses it. Any other use? No. Remove.
- ValidationBlockReason: still used in T013 and T032. Keep.

Let me also fix the T022 dead lines (`const original = f.repo...; void original;`).

Let me update imports and clean T022.
The AC-001 comment documents the non-obvious mapping between selectValidator's reason codes and validation_enabled. Necessary. Now let me clean up unused imports and the T022 dead code.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:42:48Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts", "newString": "      const before = services.workflowTemplateRepo.getById(DEFAULT_TEMPLATE_ID)!;\n\n      const adminRepo = new AdminAuditEventRepository(services.db);", "oldString": "      const original = f.repo.getById(DEFAULT_TEMPLATE_ID); // placeholder\n      void original;\n      const before = services.workflowTemplateRepo.getById(DEFAULT_TEMPLATE_ID)!;\n\n      const adminRepo = new Admi
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:43:02Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts"})`


> [reasoning] Now the T022 test uses `services` not `f`. But it's inside a describe block that has `f = makeService()` in beforeEach. The T022 test creates its own `services` via createTestServices and doesn't use `f`. That's fine - `f` is unused in that test. But the beforeEach still creates `f` and afterEach closes `f.db`. That's wasteful but harmless. Actually, wait - T022 creates `services` (createTestServices) AND `f` (makeService) is created in beforeEach. Both open DBs. The afterEach closes `f.db` but NOT `services.db` (disposeTestServices closes it in the finally). Actually T022 has its own try/finally with disposeTestServices. So `f` is created and closed but unused in T022. Let me leave it - it's harmless, just slightly wasteful. Actually, to be clean, T022 doesn't need `f` at all. But the beforeEach/afterEach manage `f`. Since T022 is in the same describe, it gets `f` created/closed. That's fine - minor waste.

Now let me run lsp_diagnostics on the test file, then run vitest.

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:43:15Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\tests\\unit\\validate-steps-schema.test.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:43:28Z

- **tool**: `bash({"command": "npx vitest run server/tests/unit/validate-steps-schema.test.ts server/tests/integration/workflow-template-admin.test.ts 2>&1 | tail -80", "workdir": "D:\\Projects\\personahub"})`

Now let me run the scoped vitest tests.

  <details><summary>tool output</summary>

  ```text
[31;1mtail: [31;1mThe term 'tail' is not recognized as a name of a cmdlet, function, script file, or executable program.[0m

[31;1m[31;1mCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.[0m
  ```
  </details>

## assistant · 2026-08-09T10:43:37Z

- **tool**: `bash({"command": "npx vitest run server/tests/unit/validate-steps-schema.test.ts server/tests/integration/workflow-template-admin.test.ts 2>&1 | Select-Object -Last 120", "workdir": "D:\\Projects\\personahub"})`

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m



 [32m�?[39m server/tests/unit/validate-steps-schema.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 8[2mms[22m[39m

 [31m�?[39m server/tests/integration/workflow-template-admin.test.ts [2m([22m[2m36 tests[22m[2m | [22m[31m3 failed[39m[2m)[22m[33m 8155[2mms[22m[39m

   [32m�?[39m F008 Phase 1: detail projection (T010/T011/T012/T013)[2m > [22mT010: listByIssueType returns versions ascending[32m 70[2mms[22m[39m

   [32m�?[39m F008 Phase 1: detail projection (T010/T011/T012/T013)[2m > [22mT011: detail returns steps + validation_enabled=true when validator present[32m 18[2mms[22m[39m

   [32m�?[39m F008 Phase 1: detail projection (T010/T011/T012/T013)[2m > [22mT011: detail return
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:44:14Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\admin-audit-event.ts", "newString": "  getById(id: string): { id: string; action: string; target_type: string; target_id: string; target_version: number | null; actor_type: string; actor_id: string | null; details_json: string; created_at: string } | null {\n    const row = this.db.prepare(\n      \"SELECT id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at FROM admin_audit_events WH
…[truncated])`


> [reasoning] 3 failures:

1. **T013**: `selectValidator` throws when steps_json is "not json" (parseWorkflowSteps throws inside selectValidator). My cross-check calls `selectValidator({workflowTemplate: template, availableValidators: []})` which calls `parseWorkflowSteps(template.steps_json)` which throws for "not json". I need to wrap the selectValidator call in a try/catch too. For the "not json" case, the selector throws, so I should expect `detail.validation_enabled` to be null (which it is). Let me fix the cross-check to handle the throw case.

2. **T020 non-editable field route test**: timed out at 5000ms. The `app.inject` with `payload: { collaboration_topology: "should-be-rejected" }`. The issue is likely that Fastify's `inject` with a JSON payload needs `headers: { "content-type": "application/json" }`. Without it, Fastify might not parse the body, and `request.body` is undefined or a string, so `rejectNonEditableFields` doesn't see the field, then zod parse on `request.body ?? {}` gives empty object, then createVersion runs... Actually, let me think. When using `app.inject({ payload: {...} })`, Fastify automatically serializes the payload to JSON and sets content-type. But maybe not. Let me check the graph-routes-mutations test - it uses `payload` too.

Actually, the timeout suggests the request hangs. Hmm. Let me check - maybe `parseRequestBody` with the raw body. Actually, the issue might be that without content-type, Fastify doesn't parse the body, so `request.body` is the raw string. Then `rejectNonEditableFields(request.body)` receives a string, and `body && typeof body === "object"` is false (string), so it skips. Then `parseRequestBody(createVersionSchema, request.body ?? {})` - request.body is a string (the JSON), not undefined, so `request.body ?? {}` is the string. zod's `safeParse(string)` on an object schema... would fail (string is not object), throwing REQUEST_BODY_INVALID. That's a 400 but not TEMPLATE_FIELD_NOT_EDITABLE. But that shouldn't hang...

Wait, the timeout is 5000ms. Maybe the app.inject is hanging because of an unhandled error. Actually, let me look more carefully. The other route tests in the same file (e.g., "GET /api/workflow-templates") pass fine and use inject. The POST tests later ("POST /:sourceId/versions with activate:true") also pass. So inject works.

The difference: this test sends `payload: { collaboration_topology: "should-be-rejected" }` WITHOUT content-type. The passing POST tests also send payload objects without explicit content-type... and they pass. Hmm.

Wait, let me re-check. The passing POST test "POST /:sourceId/versions with activate:true + no acknowledge" sends `payload: { name: "v2", steps_json: NO_VALIDATOR, activate: true }`. It passes. So inject with object payload works.

So why does the non-editable field test timeout? Let me look at the test again. Oh wait - maybe the issue is that `rejectNonEditableFields` throws an AppError, but the app's error handler... Let me check. The error handler is set. It should catch AppError and return 400.

Hmm, actually maybe the issue is the test runs `buildRouteApp(f.service)` which creates a Fastify app, and the app is NOT closed if an error occurs before `await app.close()`. But the test does `await app.close()` at the end. If inject throws... no, inject returns a response.

Actually, wait - the timeout might be because this is the FIRST test that creates a Fastify app in this describe block, and Fastify app creation + route registration might be slow? No, the later route tests create apps fine.

Let me look at the test order. This test is in the "Phase 2" describe block. The beforeEach creates `f = makeService()`. The test creates `app = buildRouteApp(f.service)`. Hmm.

Actually, I bet the issue is that Fastify `inject` needs the payload to be sent with content-type. Let me check: when you pass `payload` as an object to `inject`, light-my-request (the inject implementation) serializes it. But Fastify needs to parse it. By default, Fastify parses `application/json`. If inject doesn't set the content-type, Fastify won't parse the body, and `request.body` will be undefined.

But the other POST tests work... Let me look at them. "POST /:sourceId/versions with activate:true + no acknowledge" - payload `{ name: "v2", steps_json: NO_VALIDATOR, activate: true }`. This passes and returns 400 (VALIDATION_DISABLE_NOT_ACKNOWLEDGED). For that to work, the body must be parsed (activate is read). So inject DOES parse object payloads.

So why does the non-editable test timeout? Let me look more carefully at the test. Oh! I see - the test is:
```
it("T020: non-editable field in body -> 400 TEMPLATE_FIELD_NOT_EDITABLE (route boundary)", async () => {
    const app = buildRouteApp(f.service);
    const res = await app.inject({...});
    ...
    await app.close();
});
```

Wait, maybe the issue is that the app.inject is fine but something in the error handler causes a hang. Actually, let me reconsider - maybe the AppError thrown by `rejectNonEditableFields` is thrown SYNCHRONOUSLY in the route handler, and Fastify's error handler catches it. That should work.

Hmm, let me actually look at whether the test is hanging on `app.inject` or `app.close`. The timeout is 5000ms (vitest default). Let me add explicit content-type and see. Actually, let me look at the graph-routes-mutations test more carefully to see how it sends payloads.

Actually, I suspect the real issue: when `rejectNonEditableFields` throws, the error handler returns `buildErrorResponse(error)`. But maybe there's an issue with the response. Let me just try adding `headers: { "content-type": "application/json" }` to be safe, and check if that fixes it.

Actually, wait. Let me re-read the timeout. The test "T020: non-editable field in body" timed out. But the LATER test "T020: each non-editable field is rejected" (which loops over fields and does multiple injects) PASSED in 56ms. And "T020: unknown/typo field" passed. So those work. The difference: the first test sends `payload: { collaboration_topology: "should-be-rejected" }` and expects 400. The "each non-editable field" test sends `payload: { [field]: "x" }` and also expects 400, and passes.

So the ONLY difference is... hmm, they're basically the same. Why would the first timeout but the second pass?

Oh! I think I see. The first test is `async () => {...}` but maybe there's an issue with how vitest handles it. Actually, wait - let me look at the line numbers. The timeout points to line 182 which is the `it(...)` declaration.

Actually, maybe the issue is that this test creates a Fastify app that's never properly closed because of an unhandled rejection. But `await app.close()` is there...

Let me try a different approach: maybe the issue is that `app.inject` with a plain object payload and no content-type causes Fastify to hang waiting for the body. Let me add content-type headers explicitly to all POST injects. Actually, the other POST tests pass without it...

Hmm, let me just re-run ONLY that one test to see the actual error, with more output.

Actually, I wonder if it's a flaky timeout. 6.8 seconds for that test. Let me look at the full output more carefully. The test took 6826ms and timed out at 5000ms.

Actually, you know what, let me reconsider. Maybe the issue is that `buildRouteApp` registers the route plugin which is `async`, and the first call to `app.inject` triggers route registration which is lazy. But that's the same for all tests.

Let me just try: add `headers: { "content-type": "application/json" }` to the inject calls and see if it helps. Also, let me check if maybe the payload needs to be a JSON string. Let me look at how graph-routes-mutations sends payloads.

Actually, let me just re-run that single test with more verbose output to diagnose.

3. **T031**: `expect(activated.actor_type).toBe("local_user")` - but `activated.actor_type` is undefined because my `getById`/`listByTarget` query in AdminAuditEventRepository doesn't select `actor_type`. Let me check - the SELECT in listByTarget is: `"SELECT id, action, target_id, target_version, actor_id, details_json, created_at FROM admin_audit_events WHERE target_id = ?"`. It's missing `actor_type`! Let me add it. Actually, I have a redundant check anyway (the raw query). Let me just remove the `expect(activated.actor_type)` line since I check via raw query right after. Or add actor_type to the SELECT. Let me add it to be clean.

Let me fix all three:

1. T013: wrap selectValidator in try/catch.
2. T020 non-editable: investigate - let me add content-type header.
3. T031: add actor_type to the repo SELECT, or remove the redundant assertion.

Let me fix the repo SELECT first (add actor_type to both getById and listByTarget), then fix T013, then re-run to see if T020 non-editable still times out.
Three failures. Let me fix them:
1. T013: `selectValidator` throws on invalid JSON - need try/catch in cross-check.
2. T031: repo SELECT missing `actor_type` column.
3. T020 non-editable: timeout - need to diagnose.

Let me fix the repo SELECT (add `actor_type`) and T013 first, then re-run.

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:44:50Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts", "newString": "    expect(activated.target_id).toBe(noVal.id);\n    expect(activated.target_version).toBe(noVal.version);\n    expect(activated.actor_id).toBeNull();\n    expect(activated.actor_type).toBe(\"local_user\");\n    const details = JSON.parse(activated.details_json);", "oldString": "    expect(activated.target_id).toBe(noVal.id);\n    expect(activated.target_version).toBe(noVal.version
…[truncated])`

Now fix the T031 test (remove redundant raw query, use the typed field) and T013 (try/catch around selectValidator).

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:45:05Z

- **tool**: `edit({"filePath": "D:\\Projects\\personahub\\server\\tests\\integration\\workflow-template-admin.test.ts", "newString": "      // AC-001: cross-check against the validator-selector's own derivation.\n      // selectValidator returns WorkflowConfigurationInvalid iff the template\n      // has no validator step (including null steps_json); for a with-validator\n      // template it returns ValidatorUnavailable (validation on, just no\n      // adapter). So validation_enabled === reason !== WorkflowConf
…[truncated])`

  <details><summary>tool output</summary>

  ```text
Edit applied successfully.
  ```
  </details>

## assistant · 2026-08-09T10:45:34Z

- **tool**: `bash({"command": "npx vitest run server/tests/integration/workflow-template-admin.test.ts -t \"T013\" 2>&1 | Select-Object -Last 30", "workdir": "D:\\Projects\\personahub"})`


> [reasoning] Now the T020 non-editable timeout. Let me investigate. The "each non-editable field" test (which loops) passed. The first non-editable test timed out. This is strange. Let me look at the difference again.

First test:
```
it("T020: non-editable field in body -> 400 TEMPLATE_FIELD_NOT_EDITABLE (route boundary)", async () => {
    const app = buildRouteApp(f.service);
    const res = await app.inject({
      method: "POST",
      url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
      payload: { collaboration_topology: "should-be-rejected" },
    });
    expect(res.statusCode).toBe(400);
    ...
    await app.close();
});
```

The loop test:
```
it("T020: each non-editable field is rejected", async () => {
    const app = buildRouteApp(f.service);
    const fields = [...];
    for (const field of fields) {
      const res = await app.inject({
        method: "POST",
        url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
        payload: { [field]: "x" },
      });
      ...
    }
    await app.close();
});
```

These are essentially identical. The first one timed out at ~6.8s. The second passed in 56ms. This smells like a flaky timeout or a slow first-app-creation issue.

Actually, maybe the issue is that the FIRST Fastify app creation in the test run is slow (JIT compilation, route registration). The first test in the "Phase 2" describe that creates an app is the non-editable test. But wait, the "Phase 1" tests don't create apps. So the non-editable test is the FIRST to create a Fastify app in the entire file run. The subsequent app creations are fast because Fastify is warmed up.

But 6.8s for the first app creation + inject is excessive. Hmm. Actually, maybe it's the `app.inject` that's slow the first time. Or maybe there's a real hang.

Actually, let me reconsider. The error says "Test timed out in 5000ms" and the test took 6826ms. So it ran past 5000ms. The `app.inject` might have hung. But then the loop test (which also uses inject) passed quickly.

Wait - maybe the issue is that the non-editable test's app was never closed (because it timed out before reaching `await app.close()`), and the leftover app interfered with subsequent tests. But the loop test passed, so no interference.

Actually, I bet this is just a slow first-Fastify-boot flake. Let me re-run just that test to confirm. If it's flaky, increasing the timeout or warming up Fastify would help. But actually, let me look at whether there's a real issue.

Hmm, actually - could it be that `rejectNonEditableFields` throws an AppError, and the Fastify error handler returns `buildErrorResponse(error)`, but the handler is `async` (returns a promise), and maybe there's an issue with how the error handler's return value is handled? No, the other tests that throw AppError (VALIDATION_DISABLE_NOT_ACKNOWLEDGED, etc.) work fine.

Let me just re-run the test to see if it's flaky. Let me run only the Phase 2 describe.
Now let me re-run just the previously-failing tests to check if the timeout was a flake.

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m



 [32m�?[39m server/tests/integration/workflow-template-admin.test.ts [2m([22m[2m36 tests[22m[2m | [22m[33m30 skipped[39m[2m)[22m[32m 168[2mms[22m[39m



[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m

[2m      Tests [22m [1m[32m6 passed[39m[22m[2m | [22m[33m30 skipped[39m[90m (36)[39m

[2m   Start at [22m 18:45:59

[2m   Duration [22m 9.00s[2m (transform 2.23s, setup 0ms, collect 6.71s, tests 168ms, environment 0ms, prepare 277ms)[22m
  ```
  </details>

## assistant · 2026-08-09T10:46:11Z

- **tool**: `bash({"command": "npx vitest run server/tests/integration/workflow-template-admin.test.ts -t \"T031\" 2>&1 | Select-Object -Last 30", "workdir": "D:\\Projects\\personahub"})`


> [reasoning] T013 passes now (6 tests matched the -t "T013" filter, all passed). Let me run the T020 non-editable test specifically and the T031 test.

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m



 [32m�?[39m server/tests/integration/workflow-template-admin.test.ts [2m([22m[2m36 tests[22m[2m | [22m[33m34 skipped[39m[2m)[22m[32m 85[2mms[22m[39m



[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m

[2m      Tests [22m [1m[32m2 passed[39m[22m[2m | [22m[33m34 skipped[39m[90m (36)[39m

[2m   Start at [22m 18:46:25

[2m   Duration [22m 8.95s[2m (transform 2.25s, setup 0ms, collect 6.91s, tests 85ms, environment 0ms, prepare 302ms)[22m
  ```
  </details>

## assistant · 2026-08-09T10:46:37Z

- **tool**: `bash({"command": "npx vitest run server/tests/integration/workflow-template-admin.test.ts -t \"non-editable field in body\" 2>&1 | Select-Object -Last 30", "workdir": "D:\\Projects\\personahub"})`

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m



 [32m�?[39m server/tests/integration/workflow-template-admin.test.ts [2m([22m[2m36 tests[22m[2m | [22m[33m35 skipped[39m[2m)[22m[33m 446[2mms[22m[39m

   [33m[2m�?[22m[39m F008 Phase 2: versioned writes (T020/T020b/T020c/T021/T022/T023/T024)[2m > [22mT020: non-editable field in body -> 400 TEMPLATE_FIELD_NOT_EDITABLE (route boundary) [33m 444[2mms[22m[39m



[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m

[2m      Tests [22m [1m[32m1 passed[39m[22m[2m | [22m[33m35 skipped[39m[90m (36)[39m

[2m   Start at [22m 18:46:55

[2m   Duration [22m 7.81s[2m (transform 1.15s, setup 0ms, collect 4.65s, tests 446ms, environment 0ms, prepare 285ms)[22m
  ```
  </details>

## assistant · 2026-08-09T10:47:05Z

- **tool**: `bash({"command": "npx vitest run server/tests/integration/workflow-template-admin.test.ts server/tests/unit/validate-steps-schema.test.ts 2>&1 | Select-Object -Last 25", "workdir": "D:\\Projects\\personahub"})`


> [reasoning] The non-editable field test passes in 444ms when run in isolation. So the earlier timeout was a flake caused by the first Fastify app creation being slow under parallel load (the full run had collect 13.70s). It's not a real issue. Let me run the full file once more to confirm all pass together.
The timeout was a flake (first Fastify boot under load). All three fixes work in isolation. Let me run the full file to confirm all pass together.

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m



 [32m�?[39m server/tests/unit/validate-steps-schema.test.ts [2m([22m[2m21 tests[22m[2m)[22m[32m 9[2mms[22m[39m

 [32m�?[39m server/tests/integration/workflow-template-admin.test.ts [2m([22m[2m36 tests[22m[2m)[22m[33m 780[2mms[22m[39m

   [33m[2m�?[22m[39m F008 Phase 2: versioned writes (T020/T020b/T020c/T021/T022/T023/T024)[2m > [22mT020: non-editable field in body -> 400 TEMPLATE_FIELD_NOT_EDITABLE (route boundary) [33m 311[2mms[22m[39m



[2m Test Files [22m [1m[32m2 passed[39m[22m[90m (2)[39m

[2m      Tests [22m [1m[32m57 passed[39m[22m[90m (57)[39m

[2m   Start at [22m 18:47:17

[2m   Duration [22m 6.37s[2m (transform 1.21s, setup 0ms, collect 4.71s, tests
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:47:25Z

- **tool**: `bash({"command": "npm -w @personahub/server run typecheck 2>&1 | Select-Object -Last 30", "workdir": "D:\\Projects\\personahub"})`

All 57 tests pass. Now let me run typecheck and lsp_diagnostics on all changed files.

  <details><summary>tool output</summary>

  ```text
> @personahub/server@0.1.0 typecheck

> tsc --noEmit
  ```
  </details>

## assistant · 2026-08-09T10:47:37Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\id.ts"})`


> [reasoning] Typecheck passes. Let me run lsp_diagnostics on all the changed/new files to be thorough.
Typecheck passes clean. Let me run lsp_diagnostics on all changed files.

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:47:45Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\repositories\\admin-audit-event.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:47:52Z

- **tool**: `lsp_diagnostics({"filePath": "D:\\Projects\\personahub\\server\\src\\services\\workflow-template-admin.ts"})`

  <details><summary>tool output</summary>

  ```text
No diagnostics found
  ```
  </details>

## assistant · 2026-08-09T10:47:59Z

- **tool**: `bash({"command": "npx vitest run server/tests/integration/issue-creation.test.ts server/tests/unit/validation-validator-selector.test.ts server/tests/integration/migration-v10.test.ts server/tests/unit/issue.test.ts 2>&1 | Select-Object -Last 20", "workdir": "D:\\Projects\\personahub"})`


> [reasoning] All clean. Let me also verify I haven't broken any existing tests by running the workflow-template-related existing tests (e.g., validation-validator-selector, issue-creation) and the migration-v10 test to make sure my repo extension didn't break anything.

Actually, the task says "Run `npx vitest run` scoped to your new test files until green". I've done that. But let me also run a quick regression on the issue-creation test and the validator-selector test since I extended the workflow-template repo (which IssueService uses via getDefault). Let me run those.
Let me run a quick regression on tests that touch the workflow-template repo (issue-creation, validator-selector, migration-v10) to confirm my repo extension didn't break anything.

  <details><summary>tool output</summary>

  ```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mD:/Projects/personahub[39m



 [32m�?[39m .claude/worktrees/F005/server/tests/unit/validation-validator-selector.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 20[2mms[22m[39m

 [32m�?[39m server/tests/unit/validation-validator-selector.test.ts [2m([22m[2m23 tests[22m[2m)[22m[32m 22[2mms[22m[39m

 [32m�?[39m server/tests/integration/migration-v10.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 93[2mms[22m[39m

 [32m�?[39m .claude/worktrees/F005/server/tests/integration/issue-creation.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 873[2mms[22m[39m

 [32m�?[39m server/tests/integration/issue-creation.test.ts [2m([22m[2m6 tests[22m[2m)[22m[33m 826[2mms[22m[39m

 [32m�?[39m .claude/worktrees/F005/serve
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:48:21Z

- **tool**: `todowrite({"todos": [{"content": "Add id generators (wft_, aev_) to server/src/id.ts", "priority": "high", "status": "completed"}, {"content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate", "priority": "high", "status": "completed"}, {"content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)", "priority": "high", "status": "completed"}, {"content": "Cre
…[truncated])`

All regression tests pass. Let me update todos and finalize.

  <details><summary>tool output</summary>

  ```text
[
  {
    "content": "Add id generators (wft_, aev_) to server/src/id.ts",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Extend WorkflowTemplateRepository: listByIssueType, listVersions, getMaxVersion, getActiveByIssueType, countActiveByIssueType, insertVersion, activate, deactivate",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/validation/validate-steps-schema.ts (strict validator)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/repositories/admin-audit-event.ts (AdminAuditEventRepository)",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Create server/src/services/workflow-template-admin.ts (WorkflowTemplateAdminService)",
    "st
…[truncated]
  ```
  </details>

## assistant · 2026-08-09T10:48:29Z

All green. Here's the deliverable report.

## Summary

### Task IDs done and verified
**Phase 1**: T010, T011, T012, T013 ✓
**Phase 2**: T020, T020b, T020c, T021, T022, T023, T023b, T023c, T023d, T023e, T024 ✓
**Phase 3**: T030, T030b (all 4 matrix rows), T030c, T030d, T031, T031b, T032 ✓

(T009 schema/migration was pre-done; Phase 4 runtime-health is out of scope per the brief.)

### Files created
- `server/src/services/validation/validate-steps-schema.ts` — strict write-gate
- `server/src/repositories/admin-audit-event.ts` — `AdminAuditEventRepository`
- `server/src/services/workflow-template-admin.ts` — `WorkflowTemplateAdminService`
- `server/src/api/routes/workflow-templates.ts` — Fastify route plugin
- `server/tests/unit/validate-steps-schema.test.ts` — 21 tests (T023c)
- `server/tests/integration/workflow-template-admin.test.ts` — 36 tests (T010–T032)

### Files modified
- `server/src/id.ts` — added `generateWorkflowTemplateId()` + `generateAdminAuditEventId()`
- `server/src/repositories/workflow-template.ts` — extended with `listByIssueType`/`listVersions`/`getMaxVersion`/`getActiveByIssueType`/`countActiveByIssueType`/`insertVersion`/`activate`/`deactivate`

### Verification
- `npx vitest run` scoped to both new test files: **57 passed**
- Regression (issue-creation, validator-selector, migration-v10, issue): **112 passed**
- `npm -w @personahub/server run typecheck`: **clean**
- `lsp_diagnostics` on all 7 changed/new source files: **no diagnostics**
- No `as any`/`@ts-ignore`/`@ts-expect-error`; no new dependencies; did not touch `server/src/index.ts`, `server/src/api/index.ts`, shared/, schema-v10.ts, migrations.ts, or runtime-health files.

### Constructor signature (for orchestrator wiring)
```ts
new WorkflowTemplateAdminService(
  workflowTemplateRepo: WorkflowTemplateRepository,
  auditRepo: AdminAuditEventRepository,
  db: Database.Database,
)
```

### Wiring snippet (NOT applied — for orchestrator to add to `server/src/index.ts` and `server/src/api/index.ts`)

**`server/src/index.ts`** — after `workflowTemplateRepo` is created (line ~74) and before `registerRoutes`:
```ts
import { AdminAuditEventRepository } from "./repositories/admin-audit-event.js";
import { WorkflowTemplateAdminService } from "./services/workflow-template-admin.js";

// after workflowTemplateRepo is constructed:
const adminAuditRepo = new AdminAuditEventRepository(db);
const workflowTemplateAdminService = new WorkflowTemplateAdminService(
  workflowTemplateRepo,
  adminAuditRepo,
  db,
);
```
Then in the `registerRoutes(app, {...})` call, add to the options object:
```ts
  workflowTemplateAdminService,
```

**`server/src/api/index.ts`**:
```ts
import { workflowTemplateRoutes } from "./routes/workflow-templates.js";
import type { WorkflowTemplateAdminService } from "../services/workflow-template-admin.js";
```
Add to the `Services` interface:
```ts
  workflowTemplateAdminService: WorkflowTemplateAdminService;
```
Add inside `registerRoutes`:
```ts
  app.register(workflowTemplateRoutes, {
    workflowTemplateAdminService: services.workflowTemplateAdminService,
  });
```
