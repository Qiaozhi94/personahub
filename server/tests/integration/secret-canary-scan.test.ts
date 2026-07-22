import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterAuthType, CliProvider, AgentCapability } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

/**
 * T081: a canary API key must never appear in ANY response body across the
 * full surface a client can reach — adapter CRUD/list/validate, Run
 * creation/list/read, Issue trace, and trace export. Registers a
 * FakeAgentAdapter re-keyed to "opencode" so a real dispatch/start cycle
 * runs end to end (AuthMaterial construction happens at spawn time, not in
 * any of these response bodies, but this proves it rather than assuming it).
 */
const CANARY = "sk-CANARY-DO-NOT-LEAK-9f8e7d6c5b4a";

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function assertNoCanary(res: { body: string }, label: string): void {
  expect(res.body, `${label} leaked the canary API key`).not.toContain(CANARY);
}

describe("T081: canary secret scan across API/events/errors/export", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const fakeAsOpenCode = new FakeAgentAdapter({ delayMs: 20, outputDelayMs: 5, finalMessage: "consult done" });
    Object.defineProperty(fakeAsOpenCode, "provider", { value: CliProvider.OpenCode, writable: false });
    services.adapterRegistry.register(fakeAsOpenCode);
  });
  afterEach(() => disposeTestServices(services));

  it("never echoes the canary key across the full create -> dispatch -> read -> export surface", async () => {
    const app = buildApp(services);
    const project = services.projectService.create("Canary");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Canary issue", goal: "Prove no leak" });

    const createRes = await app.inject({
      method: "POST", url: `/api/projects/${project.id}/adapters`,
      payload: {
        name: "OpenCode Canary", cli_provider: CliProvider.OpenCode, command: "opencode",
        auth_type: AdapterAuthType.ApiKey, model_provider: "openai", default_model: "gpt-5",
        api_key: CANARY, capability_tags: [AgentCapability.Implementation],
      },
    });
    assertNoCanary(createRes, "adapter create response");
    const adapter = JSON.parse(createRes.body).adapter;
    expect(adapter.has_api_key).toBe(true);

    const listRes = await app.inject({ method: "GET", url: `/api/projects/${project.id}/adapters` });
    assertNoCanary(listRes, "adapter list response");

    const patchRes = await app.inject({ method: "PATCH", url: `/api/adapters/${adapter.id}`, payload: { name: "Renamed" } });
    assertNoCanary(patchRes, "adapter patch response");

    const validateRes = await app.inject({ method: "POST", url: `/api/adapters/${adapter.id}/validate` });
    assertNoCanary(validateRes, "adapter validate response");

    // invalid combo error path: OAuth + api_key must reject without echoing the key in the error details
    const errorRes = await app.inject({
      method: "POST", url: `/api/projects/${project.id}/adapters`,
      payload: { name: "Bad", cli_provider: CliProvider.Codex, command: "codex", auth_type: AdapterAuthType.OAuth, api_key: CANARY },
    });
    expect(errorRes.statusCode).toBe(400);
    assertNoCanary(errorRes, "adapter create error response");

    const runRes = await app.inject({
      method: "POST", url: `/api/issues/${issue.id}/runs`,
      payload: { instructions: "please check this", adapter_id: adapter.id },
    });
    assertNoCanary(runRes, "run create response");
    const run = JSON.parse(runRes.body).run;

    await wait(150); // let the fake adapter actually run to completion

    const runGetRes = await app.inject({ method: "GET", url: `/api/runs/${run.id}` });
    assertNoCanary(runGetRes, "run get response");

    const runListRes = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/runs` });
    assertNoCanary(runListRes, "run list response");

    const traceRes = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/trace` });
    assertNoCanary(traceRes, "issue trace response");

    const evidenceRes = await app.inject({ method: "GET", url: `/api/runs/${run.id}/evidence` });
    assertNoCanary(evidenceRes, "run evidence response");

    const exportRes = await app.inject({ method: "GET", url: `/api/issues/${issue.id}/trace/export` });
    assertNoCanary(exportRes, "trace export (markdown) response");

    const providersRes = await app.inject({ method: "GET", url: "/api/adapter-providers" });
    assertNoCanary(providersRes, "adapter-providers metadata response");
  });
});
