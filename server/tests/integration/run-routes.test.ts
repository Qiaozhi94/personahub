import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import {
  IssueStatus, RunRole, RunPurpose, RunDispatchSource, AdapterStatus, AgentCapability,
} from "@personahub/shared/types";

/**
 * T077/T078/T079: HTTP-level tests for Run creation/list/read. The route
 * (server/src/api/routes/runs.ts) only ever reads instructions/adapter_id/
 * purpose off the request body — role/dispatch_source/workflow_step are
 * always server-derived by ManualRoutingService and never accepted as
 * input, so a client "forcing" them is proven here by showing the response
 * always reflects server-derived values regardless of what extra fields a
 * raw payload carries.
 */
function buildApp(services: TestServices) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const status = getErrorStatus(error.code);
      reply.code(status);
      return buildErrorResponse(error);
    }
    reply.code(500);
    return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "An internal error occurred.", details: {} } };
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

function setupFixture(services: TestServices, tempDir: string, status: IssueStatus = IssueStatus.Inbox) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  if (status !== IssueStatus.Inbox) {
    services.issueRepo.updateStatus(issue.id, { status, updatedAt: new Date().toISOString() });
  }
  // "fake" matches the FakeAgentAdapter createTestServices() already
  // registers under that provider key — this route test goes through the
  // full RunDispatchService pipeline (unlike ManualRoutingService.dispatch()
  // unit tests elsewhere), so it actually needs a working registered adapter
  // to start the Run, not just create the record.
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation", cli_provider: "fake",
    command: "fake-cli", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  services.projectRepo.setDefaultAdapter(project.id, adapter.id);
  return { project, issue, adapter };
}

describe("Run routes (T077-T079)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });
  afterEach(() => disposeTestServices(services));

  describe("POST /api/issues/:issue_id/runs", () => {
    it("creates a workflow-bound implementation Run when adapter_id is explicit", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "do the work", adapter_id: adapter.id },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.run.role).toBe(RunRole.Implementation);
      expect(body.run.purpose).toBe(RunPurpose.WorkflowBound);
      expect(body.run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
    });

    it("omitted adapter_id resolves the Project default adapter", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "do the work" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.run.adapter_config_id).toBe(adapter.id);
      expect(body.run.dispatch_source).toBe(RunDispatchSource.UserDefault);
    });

    it("explicit purpose=ad_hoc_consult always produces role=consult regardless of Issue status", async () => {
      const { issue, adapter } = setupFixture(services, tempDir, IssueStatus.Running);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "just a question", adapter_id: adapter.id, purpose: "ad_hoc_consult" },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.run.role).toBe(RunRole.Consult);
      expect(body.run.purpose).toBe(RunPurpose.AdHocConsult);
    });

    // Final-comprehensive-report regression: purpose used to be a plain
    // `=== "ad_hoc_consult" ? ... : undefined` coercion — any other string,
    // including an attempt to force "workflow_bound" (which design §7.4
    // explicitly forbids the client from doing), silently fell through to
    // "auto" instead of the documented RUN_PURPOSE_INVALID 400.
    it("rejects an attempt to force purpose=workflow_bound with RUN_PURPOSE_INVALID", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "do the work", adapter_id: adapter.id, purpose: "workflow_bound" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.RUN_PURPOSE_INVALID);
    });

    it("rejects an unknown purpose value with RUN_PURPOSE_INVALID", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "do the work", adapter_id: adapter.id, purpose: "not_a_real_purpose" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.RUN_PURPOSE_INVALID);
    });

    // final-recheck-report regression: instructions/adapter_id had no
    // runtime type check — a wrong JS type (e.g. a number) would reach
    // ManualRoutingService's `.trim()` and throw an uncaught TypeError,
    // surfacing as a 500 instead of a client-correctable 400.
    it("rejects instructions sent as a number with REQUEST_BODY_INVALID (400, not a 500 TypeError)", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: 12345, adapter_id: adapter.id },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
    });

    it("purpose omitted (auto) still derives workflow_bound from Issue status + adapter capability", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "do the work", adapter_id: adapter.id, purpose: "auto" },
      });
      const body = JSON.parse(res.body);
      expect(body.run.purpose).toBe(RunPurpose.WorkflowBound);
    });

    it("ignores a client-supplied role/dispatch_source/workflow_step — response always reflects server-derived values", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: {
          instructions: "do the work", adapter_id: adapter.id,
          role: "validator", dispatch_source: "system", workflow_step: "validation",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.run.role).toBe(RunRole.Implementation);
      expect(body.run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(body.run.workflow_step).toBe("implementation");
    });

    it("rejects instructions-empty with 400", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "  ", adapter_id: adapter.id },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.RUN_INSTRUCTIONS_REQUIRED);
    });

    it("returns 409 for a Done issue", async () => {
      const { issue, adapter } = setupFixture(services, tempDir, IssueStatus.Done);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "too late", adapter_id: adapter.id },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS);
    });

    it("returns 409 for a Blocked issue", async () => {
      const { issue, adapter } = setupFixture(services, tempDir, IssueStatus.Blocked);
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "too late", adapter_id: adapter.id },
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS);
    });

    it("returns 404 for a non-existent issue", async () => {
      const app = buildApp(services);
      const res = await app.inject({
        method: "POST", url: "/api/issues/issue_nonexistent/runs",
        payload: { instructions: "do it" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/issues/:issue_id/runs and GET /api/runs/:run_id", () => {
    it("list and read both surface purpose/role/dispatch_source/context_source_run_id", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const created = JSON.parse((await app.inject({
        method: "POST", url: `/api/issues/${issue.id}/runs`,
        payload: { instructions: "do the work", adapter_id: adapter.id },
      })).body).run;

      const listRes = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/runs` });
      expect(listRes.statusCode).toBe(200);
      const listed = JSON.parse(listRes.body).runs.find((r: { id: string }) => r.id === created.id);
      expect(listed.purpose).toBe(RunPurpose.WorkflowBound);
      expect(listed.role).toBe(RunRole.Implementation);
      expect(listed.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(listed.context_source_run_id).toBeNull();

      const getRes = await app.inject({ method: "GET", url: `/api/runs/${created.id}` });
      expect(getRes.statusCode).toBe(200);
      const fetched = JSON.parse(getRes.body).run;
      expect(fetched.purpose).toBe(RunPurpose.WorkflowBound);
      expect(fetched.role).toBe(RunRole.Implementation);
    });
  });
});
