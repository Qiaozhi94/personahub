import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import {
  IssueStatus,
  RunRole,
  RunPurpose,
  RunDispatchSource,
  AdapterStatus,
  AgentCapability,
} from "@personahub/shared/types";

/**
 * T077/T078/T079: HTTP-level tests for the read-only Run routes. F012 (T025)
 * removed the legacy POST /api/issues/:issue_id/runs write entry —
 * DispatchService is the only dispatch write path — so this file now covers
 * list/read only; run creation in fixtures goes through the service layer.
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
    return {
      error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "An internal error occurred.", details: {} },
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
    graphRunRepo: services.graphRunRepo,
    nodeRunRepo: services.nodeRunRepo,
    workspaceRepo: services.workspaceRepo,
    threadRepo: services.threadRepo,
    threadEventRepo: services.threadEventRepo,
    graphRuntimeService: services.graphRuntimeService,
    agentConfigRepo: services.agentConfigRepo,
    projectRepo: services.projectRepo,
    adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo,
    db: services.db,
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
  // registers under that provider key — the service-level dispatch goes
  // through the full RunDispatchService pipeline, so it needs a working
  // registered adapter to start the Run, not just the record.
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Impl",
    role: "implementation",
    cli_provider: "fake",
    command: "fake-cli",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5",
    status: AdapterStatus.Available,
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

  describe("GET /api/issues/:issue_id/runs and GET /api/runs/:run_id", () => {
    it("list and read both surface purpose/role/dispatch_source/context_source_run_id", async () => {
      const { issue, adapter } = setupFixture(services, tempDir);
      const app = buildApp(services);
      const created = await services.runDispatchService.dispatch(issue.id, adapter.id, "do the work");

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
