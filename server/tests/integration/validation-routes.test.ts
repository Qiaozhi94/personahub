import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { buildPolicySnapshot, hashPolicySnapshot } from "../../src/services/validation/policy-gate.js";
import {
  IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType,
  AdapterStatus, ActorType, ValidationOutcome, AgentCapability,
} from "@personahub/shared/types";

function setupValidatingFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation",
    cli_provider: "codex", command: "codex", args: [], capability_tags: [],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const implRun = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
    adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
  });
  return { project, issue, implAdapter, implRun };
}

function setupDoneFixture(services: TestServices, tempDir: string) {
  const { project, issue, implAdapter, implRun } = setupValidatingFixture(services, tempDir);
  const valAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Val", role: "validator",
    cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const valRun = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
    adapter_config_id: valAdapter.id, instructions: "", status: RunStatus.Completed,
    role: RunRole.Validator, dispatch_source: RunDispatchSource.System, validation_round: 1,
    adapter_identity: { adapter_config_id: valAdapter.id, name: "Val", cli_provider: "codex", default_model: "gpt-5" },
  });
  const policySnapshot = {
    policy_id: "vpl_coding_default", version: 1, max_validation_rounds: 3,
    evidence_requirements: {
      require_handoff: true, require_file_trace: true, require_verification: true,
      accepted_verification_kinds: ["test", "lint", "typecheck", "build"],
    },
  };
  const implIdentity = { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" };
  const valIdentity = { adapter_config_id: valAdapter.id, name: "Val", cli_provider: "codex", default_model: "gpt-5" };
  services.evidenceSummaryRepo.createIfAbsent({
    issue_id: issue.id, thread_id: issue.primary_thread!.id,
    validator_run_id: valRun.id, implementation_run_id: implRun.id,
    validation_result: ValidationOutcome.Passed, evidence_refs: [],
    summary_markdown: "# Summary", same_origin_validation: true,
    implementation_identity: implIdentity, validator_identity: valIdentity,
    policy_id: policySnapshot.policy_id, policy_version: policySnapshot.version,
    policy_snapshot: policySnapshot, policy_snapshot_hash: "sha256:abc",
  });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Done, updatedAt: new Date().toISOString() });
  return { project, issue, implRun, valRun, valAdapter };
}

function buildApp(services: TestServices) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const status = getErrorStatus(error.code);
      reply.code(status);
      return buildErrorResponse(error);
    }
    reply.code(500);
    return {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: error.message ?? "An internal error occurred.",
        details: {},
      },
    };
  });
  registerRoutes(app, {
    projectService: services.projectService,
    workspaceService: services.workspaceService,
    issueService: services.issueService,
    threadService: services.threadService,
    adapterConfigService: services.adapterConfigService,
    runService: services.runService,
    runDispatchService: services.runDispatchService,
    threadEventService: services.threadEventService,
    eventBus: services.eventBus,
    traceQueryService: services.traceQueryService,
    traceExportService: services.traceExportService,
    validationQueryService: services.validationQueryService,
    validationRecoveryActionService: services.validationRecoveryActionService,
    validationWorkflowService: services.validationWorkflowService,
    evidenceSummaryRepo: services.evidenceSummaryRepo,
    issueRepo: services.issueRepo,
    runRepo: services.runRepo,
  });
  return app;
}

describe("Validation routes (T063-T066)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  describe("GET /api/issues/:issue_id/validation", () => {
    it("returns 200 with IssueValidationResponse for existing issue", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/validation` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.issue_id).toBe(issue.id);
      expect(body.status).toBe(IssueStatus.Validating);
    });

    it("returns 404 for non-existent issue", async () => {
      const app = buildApp(services);
      const res = await app.inject({ method: "GET", url: "/api/issues/issue_nonexistent/validation" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/issues/:issue_id/evidence-summary", () => {
    it("returns 200 with evidence summary when issue is Done", async () => {
      const { issue } = setupDoneFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/evidence-summary` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.evidence_summary).toBeDefined();
      expect(body.evidence_summary.issue_id).toBe(issue.id);
    });

    it("returns 404 when issue is not Done", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/evidence-summary` });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for non-existent issue", async () => {
      const app = buildApp(services);
      const res = await app.inject({ method: "GET", url: "/api/issues/issue_nonexistent/evidence-summary" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/issues/:issue_id/validation-rounds/reset", () => {
    function blockRoundLimit(issueId: string, reason: string, roundCount: number) {
      services.db.prepare("UPDATE issues SET status = ?, blocked_reason_code = ?, blocked_reason_message = ?, validation_round_count = ? WHERE id = ?")
        .run(IssueStatus.Blocked, reason, "blocked", roundCount, issueId);
    }

    it("returns 200, keeps the Issue Blocked and clears the round count", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      blockRoundLimit(issue.id, "round_limit_reached", 3);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/validation-rounds/reset`,
        payload: { operator_note: "granting more rounds" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.issue.status).toBe(IssueStatus.Blocked);
      expect(body.issue.validation_round_count).toBe(0);
    });

    it("returns 400 when operator_note is missing", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      blockRoundLimit(issue.id, "round_limit_reached", 3);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/validation-rounds/reset`, payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects reset for non round_limit_reached blockers", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      blockRoundLimit(issue.id, "evidence_missing", 1);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/validation-rounds/reset`,
        payload: { operator_note: "x" },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe("POST /api/issues/:issue_id/unblock", () => {
    it("returns 200 with updated Issue", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
        blocked_reason_code: "validator_unavailable",
        blocked_reason_message: "No validator",
      });
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/unblock`,
        payload: { operator_note: "Configured validator" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.issue.status).toBe(IssueStatus.Ready);
    });

    it("returns 400 when operator_note is missing", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
        blocked_reason_code: "validator_unavailable",
        blocked_reason_message: "No validator",
      });
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/unblock`,
        payload: { operator_note: "" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when operator_note field is missing", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Validating, IssueStatus.Blocked, {
        blocked_reason_code: "validator_unavailable",
        blocked_reason_message: "No validator",
      });
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/unblock`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 when issue is not Blocked", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/unblock`,
        payload: { operator_note: "test" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("POST /api/issues/:issue_id/validation", () => {
    it("returns 200 when issue is Validating and has active validator (idempotent)", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.create({
        project_id: issue.project_id, name: "Val", role: "validator",
        cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator],
        default_model: "gpt-5", status: AdapterStatus.Available,
      });
      const valRun = services.runRepo.create({
        issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
        adapter_config_id: valAdapter.id, instructions: "", status: RunStatus.Queued,
        role: RunRole.Validator, dispatch_source: RunDispatchSource.System, validation_round: 1,
        adapter_identity: { adapter_config_id: valAdapter.id, name: "Val", cli_provider: "codex", default_model: "gpt-5" },
      });
      const app = buildApp(services);
      const res = await app.inject({ method: "POST", url: `/api/issues/${issue.id}/validation` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.run.id).toBe(valRun.id);
    });

    it("returns 200 when issue is Validating and creates new validator", async () => {
      const { issue, implRun } = setupValidatingFixture(services, tempDir);
      services.agentConfigRepo.create({
        project_id: issue.project_id, name: "Val", role: "validator",
        cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator],
        default_model: "gpt-5", status: AdapterStatus.Available,
      });
      // setupValidatingFixture jumps straight to Validating without going
      // through Phase A (requestValidation) — write the validation.
      // dispatch_pending event Phase A would have produced so the route's
      // claimValidatorSlot() Phase B call has frozen fields to read.
      const policy = services.validationPolicyRepo.getById(issue.validation_policy_id)!;
      const policySnapshot = buildPolicySnapshot(policy.id, policy.version, policy.max_validation_rounds, policy.evidence_requirements_json);
      const policySnapshotHash = hashPolicySnapshot(policySnapshot);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationDispatchPending, ActorType.System, null, {
        issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
        validation_round: 1, implementation_run_id: implRun.id,
        policy_id: policy.id, policy_version: policy.version,
        policy_snapshot: policySnapshot, policy_snapshot_hash: policySnapshotHash,
        dispatch_due_at: new Date().toISOString(),
      });
      const app = buildApp(services);
      const res = await app.inject({ method: "POST", url: `/api/issues/${issue.id}/validation` });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.run).toBeDefined();
      expect(body.run.role).toBe(RunRole.Validator);
    });

    it("returns 409 when issue is not Validating", async () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
      const app = buildApp(services);
      const res = await app.inject({ method: "POST", url: `/api/issues/${issue.id}/validation` });
      expect(res.statusCode).toBe(409);
    });

    it("returns 404 for non-existent issue", async () => {
      const app = buildApp(services);
      const res = await app.inject({ method: "POST", url: "/api/issues/issue_nonexistent/validation" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("T067: SSE replay of validation events", () => {
    it("replays validation.requested, findings, results, done, unblocked via cursor", () => {
      const { issue, implRun } = setupValidatingFixture(services, tempDir);
      const t = issue.primary_thread!.id;
      const e1 = services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.RunQueued, ActorType.System, null, { n: 1 },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationRequested, ActorType.System, null,
        { issue_id: issue.id, validation_round: 1, implementation_run_id: implRun.id },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationFinding, ActorType.System, null,
        { issue_id: issue.id, validation_round: 1, severity: "error" },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationPassed, ActorType.System, null,
        { issue_id: issue.id, validation_round: 1 },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationFailed, ActorType.System, null,
        { issue_id: issue.id, validation_round: 2 },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationBlocked, ActorType.System, null,
        { issue_id: issue.id, validation_round: 2, reason_code: "round_limit_reached" },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.IssueDone, ActorType.System, null,
        { issue_id: issue.id, previous_status: IssueStatus.Validating },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.IssueUnblocked, ActorType.System, null,
        { issue_id: issue.id, previous_status: IssueStatus.Blocked, operator_note: "Fixed" },
      );
      const after = services.threadEventService.listByThread(t, e1.id);
      expect(after.some(e => e.type === ThreadEventType.ValidationRequested)).toBe(true);
      expect(after.some(e => e.type === ThreadEventType.ValidationFinding)).toBe(true);
      expect(after.some(e => e.type === ThreadEventType.ValidationPassed)).toBe(true);
      expect(after.some(e => e.type === ThreadEventType.ValidationFailed)).toBe(true);
      expect(after.some(e => e.type === ThreadEventType.ValidationBlocked)).toBe(true);
      expect(after.some(e => e.type === ThreadEventType.IssueDone)).toBe(true);
      expect(after.some(e => e.type === ThreadEventType.IssueUnblocked)).toBe(true);
    });

    it("cursor replay returns deterministic event sequence", () => {
      const { issue } = setupValidatingFixture(services, tempDir);
      const t = issue.primary_thread!.id;
      const e1 = services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationRequested, ActorType.System, null, { v: 1 },
      );
      services.threadEventService.writeAndBroadcast(
        t, ThreadEventType.ValidationFinding, ActorType.System, null, { v: 2 },
      );
      const afterCursor = services.threadEventService.listByThread(t, e1.id);
      expect(afterCursor.length).toBeGreaterThanOrEqual(1);
      expect(afterCursor[0]!.payload_json.v).toBe(2);
      expect(afterCursor.some(e => e.type === ThreadEventType.ValidationFinding)).toBe(true);
    });
  });
});
