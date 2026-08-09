import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestServices,
  createTempDir,
  cleanupTempDir,
  disposeTestServices,
  type TestServices,
} from "../helpers.js";
import { registerRoutes } from "../../src/api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import type { ConfirmationToken, ChosenPlan } from "@personahub/shared/types";

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
    recommendationService: services.recommendationService,
    intakeService: services.intakeService,
    intakeConfirmationRepo: services.intakeConfirmationRepo,
    db: services.db,
  });
  return app;
}

describe("F007 intake HTTP API (T030/T031/T032/T033)", () => {
  let services: TestServices;
  let tempDir: string;
  let projectId: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Intake");
    services.workspaceService.bind(project.id, tempDir);
    projectId = project.id;
    app = buildApp(services);
  });

  afterEach(async () => {
    await app.close();
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  function seedImplAdapter(): string {
    const rec = services.agentConfigRepo.create({
      project_id: projectId,
      name: "Impl",
      role: "implementation",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [AgentCapability.Implementation],
      default_model: null,
      status: AdapterStatus.Available,
    });
    return rec.id;
  }

  it("T033: empty goal returns 400 ISSUE_GOAL_REQUIRED", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCode.ISSUE_GOAL_REQUIRED);
  });

  it("T030: recommend returns 200 with token + recommendation_id", async () => {
    seedImplAdapter();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recommendation_id).toBeTruthy();
    expect(body.token.signature).toBeTruthy();
    expect(body.token.payload.project_id).toBe(projectId);
    expect(body.issue_type.value).toBe("coding");
    expect(body.collaboration_topology.value.value).toBe("sequential");
  });

  it("T033: overlong goal is recommended (truncated for matching, full goal stored on confirm)", async () => {
    const adapterId = seedImplAdapter();
    const longGoal = "implement the payment retry with " + "x".repeat(9000);
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: longGoal },
    });
    expect(rec.statusCode).toBe(200);
    const body = rec.json();
    expect(body.token.payload.recommended.issue_draft.goal.value).toBe(longGoal);

    const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
    const confirm = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token: body.token, chosen },
    });
    expect(confirm.statusCode).toBe(201);
    const issue = services.issueRepo.getById(confirm.json().issue_id)!;
    expect(issue.goal).toBe(longGoal);
  });

  it("T032: no available adapter returns 409 with suggested_action", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "do a thing" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCode.NO_AVAILABLE_ADAPTER);
    expect(body.error.details.suggested_action).toBeTruthy();
  });

  it("T031: confirm sequential returns 201 and creates the Issue", async () => {
    const adapterId = seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    const { token } = rec.json() as { token: ConfirmationToken };
    const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.target_kind).toBe("run");
    expect(body.issue_id).toBeTruthy();
    expect(body.target_id).toBeTruthy();
  });

  it("same token replayed returns 200 with the existing result (idempotent)", async () => {
    const adapterId = seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    const { token } = rec.json() as { token: ConfirmationToken };
    const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().issue_id).toBe(first.json().issue_id);
  });

  it("H1: forged signature on a confirmed nonce is rejected (verify precedes replay)", async () => {
    const adapterId = seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    const token = rec.json().token as ConfirmationToken;
    const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
    const ok = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen },
    });
    expect(ok.statusCode).toBe(201);
    const forged: ConfirmationToken = { ...token, signature: "forged" };
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token: forged, chosen },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCode.CONFIRMATION_TOKEN_INVALID);
  });

  it("H1: a confirmed token replayed on a different project route is rejected", async () => {
    const adapterId = seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    const token = rec.json().token as ConfirmationToken;
    const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
    const ok = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen },
    });
    expect(ok.statusCode).toBe(201);
    const otherProject = services.projectService.create("Other");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${otherProject.id}/intake/confirm`,
      payload: { token, chosen },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCode.CONFIRMATION_TOKEN_INVALID);
  });

  it("T031: confirm with tampered token returns 400 CONFIRMATION_TOKEN_INVALID", async () => {
    const adapterId = seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    const token = rec.json().token as ConfirmationToken;
    const tampered: ConfirmationToken = { ...token, payload: { ...token.payload, project_id: "prj_evil" } };
    const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token: tampered, chosen },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCode.CONFIRMATION_TOKEN_INVALID);
  });

  it("T031: internally inconsistent chosen is rejected at the zod boundary", async () => {
    seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "implement the payment retry" },
    });
    const token = rec.json().token as ConfirmationToken;
    const bad = {
      topology: "sequential",
      adapter_config_id: "agt_x",
      node_assignments: {},
      definition_id: "x",
      definition_version: 1,
    };
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen: bad },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCode.REQUEST_BODY_INVALID);
  });

  it("T031: confirm orchestrator_subagent returns 201 with graph target", async () => {
    writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
    const adapterId = seedImplAdapter();
    const rec = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/recommend`,
      payload: { goal: "conduct a multi-perspective review of concurrency" },
    });
    const body = rec.json();
    expect(body.collaboration_topology.value.value).toBe("orchestrator_subagent");
    const token = body.token as ConfirmationToken;
    const nodeAssignments: Record<string, string> = {};
    for (const key of Object.keys(body.agent_roster.by_node)) nodeAssignments[key] = adapterId;
    const chosen: ChosenPlan = {
      topology: "orchestrator_subagent",
      definition_id: "wgd_coding_dual_review",
      definition_version: 1,
      node_assignments: nodeAssignments,
    };
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/intake/confirm`,
      payload: { token, chosen },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().target_kind).toBe("graph");
  });
});
