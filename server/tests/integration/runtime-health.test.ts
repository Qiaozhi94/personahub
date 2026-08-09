import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import {
  RuntimeHealthService,
  LOCK_DIAGNOSTIC_GRACE_MS,
  EXPECTED_SCHEMA_VERSION,
} from "../../src/services/runtime-health.js";
import { runtimeHealthRoutes } from "../../src/api/routes/runtime-health.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import {
  IssueStatus,
  RunRole,
  RunStatus,
  RunDispatchSource,
  AdapterStatus,
  AgentCapability,
} from "@personahub/shared/types";
import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../../src/runtime/types.js";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";
import { ClaudeCodeAdapter } from "../../src/runtime/adapters/claude-code-adapter.js";
import { OpenCodeAdapter } from "../../src/runtime/adapters/opencode-adapter.js";

function setupProject(services: TestServices, tempDir: string) {
  const project = services.projectService.create("HealthTest");
  services.workspaceService.bind(project.id, tempDir);
  const workspace = services.workspaceService.get(project.id)!;
  const { issue, primary_thread } = services.issueService.create(project.id, { title: "T", goal: "G" });
  return { project, workspace, issue, threadId: primary_thread.id };
}

function createAdapter(
  services: TestServices,
  projectId: string,
  name: string,
  status: AdapterStatus = AdapterStatus.Available,
) {
  return services.agentConfigRepo.create({
    project_id: projectId,
    name,
    role: "implementation",
    cli_provider: "fake",
    command: "echo",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: null,
    status,
  });
}

function createQueuedRun(
  services: TestServices,
  issueId: string,
  threadId: string,
  workspaceId: string,
  adapterId: string,
  role: RunRole = RunRole.Implementation,
  validationRound: number | null = null,
) {
  return services.runRepo.create({
    issue_id: issueId,
    thread_id: threadId,
    workspace_id: workspaceId,
    adapter_config_id: adapterId,
    instructions: "test",
    status: RunStatus.Queued,
    role,
    dispatch_source: RunDispatchSource.UserExplicit,
    validation_round: validationRound,
  });
}

function lockWorkspace(db: TestServices["db"], workspaceId: string, runId: string, lockedAt: string | null) {
  db.prepare("UPDATE workspaces SET lock_state = 'locked', locked_by_run_id = ?, locked_at = ? WHERE id = ?").run(
    runId,
    lockedAt,
    workspaceId,
  );
}

function setIssueValidatingWithDueAt(db: TestServices["db"], issueId: string, dueAt: string | null) {
  db.prepare("UPDATE issues SET status = 'Validating', validation_dispatch_due_at = ? WHERE id = ?").run(
    dueAt,
    issueId,
  );
}

function makeHealthService(services: TestServices, expectedVersion = EXPECTED_SCHEMA_VERSION) {
  return new RuntimeHealthService(
    services.db,
    services.workspaceRepo,
    services.agentConfigRepo,
    services.adapterWorkspaceStatusRepo,
    services.runRepo,
    services.issueRepo,
    services.adapterConfigService,
    services.runDispatchService,
    expectedVersion,
  );
}

function buildRouteApp(services: TestServices) {
  const healthService = makeHealthService(services);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const status = getErrorStatus(error.code);
      reply.code(status);
      return buildErrorResponse(error);
    }
    reply.code(500);
    return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "Internal error", details: {} } };
  });
  app.register(runtimeHealthRoutes, { runtimeHealthService: healthService, projectRepo: services.projectRepo });
  return app;
}

describe("RuntimeHealth (F008 Phase 4)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });
  afterEach(() => disposeTestServices(services));

  describe("T040 - five categories collected", () => {
    it("collects schema, background, workspaces (with adapters under workspace), and queue", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter1");

      const health = makeHealthService(services).collect(project.id);

      expect(health.schema).toEqual({
        actual_version: 10,
        expected_version: 10,
        status: "current",
      });
      expect(health.background).toEqual({
        pending_probe_count: 0,
        pending_reprobe_count: 0,
      });
      expect(health.workspaces).toHaveLength(1);
      const ws = health.workspaces[0];
      expect(ws.workspace_id).toBe(workspace.id);
      expect(ws.adapters).toHaveLength(1);
      expect(ws.adapters[0]).toMatchObject({
        id: adapter.id,
        name: "Adapter1",
        effective_status: AdapterStatus.Available,
      });
      expect(ws.lock).toEqual({ locked_by_run_id: null, locked_at: null, held_ms: null });
      expect(ws.queue).toEqual({ queued_count: 0, running_run_id: null });
    });
  });

  describe("T040d - schema_version_mismatch", () => {
    it("reports behind when expected > actual", () => {
      const { project } = setupProject(services, tempDir);
      const health = makeHealthService(services, 99).collect(project.id);
      expect(health.schema.status).toBe("behind");
      const mismatch = health.diagnostics.find((d) => d.code === "schema_version_mismatch");
      expect(mismatch).toBeDefined();
      expect(mismatch!.detail).toContain("behind");
    });

    it("reports ahead when actual > expected", () => {
      const { project } = setupProject(services, tempDir);
      const health = makeHealthService(services, 1).collect(project.id);
      expect(health.schema.status).toBe("ahead");
      const mismatch = health.diagnostics.find((d) => d.code === "schema_version_mismatch");
      expect(mismatch).toBeDefined();
      expect(mismatch!.detail).toContain("ahead");
    });

    it("does not report mismatch when current", () => {
      const { project } = setupProject(services, tempDir);
      const health = makeHealthService(services, 10).collect(project.id);
      expect(health.diagnostics.find((d) => d.code === "schema_version_mismatch")).toBeUndefined();
    });
  });

  describe("T040e - same adapter differs across workspaces", () => {
    it("presents adapter separately per workspace, not merged", () => {
      const project = services.projectService.create("MultiWs");
      const tempDir2 = createTempDir();
      services.workspaceService.bind(project.id, tempDir);
      const wsA = services.workspaceService.get(project.id)!;
      services.workspaceService.bind(project.id, tempDir2);
      const wsB = services.workspaceService.get(project.id)!;

      const adapter = createAdapter(services, project.id, "SharedAdapter", AdapterStatus.Available);

      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: adapter.id,
        workspace_id: wsB.id,
        status: AdapterStatus.Unavailable,
        last_checked_at: new Date().toISOString(),
        auth_status_message: "broken in B",
      });

      const health = makeHealthService(services).collect(project.id);
      expect(health.workspaces).toHaveLength(2);

      const wsAEntry = health.workspaces.find((w) => w.workspace_id === wsA.id);
      const wsBEntry = health.workspaces.find((w) => w.workspace_id === wsB.id);
      expect(wsAEntry!.adapters[0].effective_status).toBe(AdapterStatus.Available);
      expect(wsBEntry!.adapters[0].effective_status).toBe(AdapterStatus.Unavailable);
    });
  });

  describe("T040b - healthSnapshot accessors", () => {
    it("AdapterConfigService.healthSnapshot returns count without exposing Set", () => {
      const snapshot = services.adapterConfigService.healthSnapshot();
      expect(snapshot).toEqual({ pendingProbeCount: 0 });
      expect(typeof snapshot.pendingProbeCount).toBe("number");
    });

    it("RunDispatchService.healthSnapshot returns count without exposing Set", () => {
      const snapshot = services.runDispatchService.healthSnapshot();
      expect(snapshot).toEqual({ pendingReprobeCount: 0 });
      expect(typeof snapshot.pendingReprobeCount).toBe("number");
    });
  });

  describe("T041 - stale_lock grading (prerequisite: adapter executionTimeoutMs)", () => {
    it("all v0.2 adapters set executionTimeoutMs === DEFAULT_EXECUTION_TIMEOUT_MS", () => {
      const adapters = [new FakeAgentAdapter(), new CodexCliAdapter(), new ClaudeCodeAdapter(), new OpenCodeAdapter()];
      for (const adapter of adapters) {
        expect(adapter.capabilities.executionTimeoutMs).toBe(DEFAULT_EXECUTION_TIMEOUT_MS);
      }
    });

    const THRESHOLD = DEFAULT_EXECUTION_TIMEOUT_MS + LOCK_DIAGNOSTIC_GRACE_MS;

    function setupLockedWorkspace(holderStatus: RunStatus, lockedAtOffsetMs: number | null) {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      const holderRun = services.runRepo.create({
        issue_id: issue.id,
        thread_id: threadId,
        workspace_id: workspace.id,
        adapter_config_id: adapter.id,
        instructions: "",
        status: holderStatus,
        role: RunRole.Implementation,
        dispatch_source: RunDispatchSource.UserExplicit,
      });
      if (holderStatus === RunStatus.Running) {
        services.db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(new Date().toISOString(), holderRun.id);
      }
      const lockedAt = lockedAtOffsetMs !== null ? new Date(Date.now() - lockedAtOffsetMs).toISOString() : null;
      lockWorkspace(services.db, workspace.id, holderRun.id, lockedAt);
      return { project, workspace, holderRun };
    }

    it("threshold - 1ms: no stale_lock diagnostic", () => {
      const { project, workspace } = setupLockedWorkspace(RunStatus.Running, THRESHOLD - 1);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      expect(
        health.diagnostics.filter((d) => d.code.startsWith("stale_lock") || d.code === "lock_timestamp_invalid"),
      ).toHaveLength(0);
    });

    it("exactly equal to threshold: no stale_lock diagnostic (strict greater-than)", () => {
      const { project, workspace } = setupLockedWorkspace(RunStatus.Running, THRESHOLD);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      expect(
        health.diagnostics.filter((d) => d.code.startsWith("stale_lock") || d.code === "lock_timestamp_invalid"),
      ).toHaveLength(0);
    });

    it("over threshold: stale_lock_suspected", () => {
      const { project, workspace, holderRun } = setupLockedWorkspace(RunStatus.Running, THRESHOLD + 1);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      const diag = health.diagnostics.find((d) => d.code === "stale_lock_suspected");
      expect(diag).toBeDefined();
      expect(diag!.workspace_id).toBe(workspace.id);
      expect(diag!.detail).toContain(holderRun.id);
    });

    it("locked_at illegal + holder missing: stale_lock_confirmed", () => {
      const { project, workspace, holderRun } = setupLockedWorkspace(RunStatus.Running, THRESHOLD + 1);
      services.db.prepare("DELETE FROM runs WHERE id = ?").run(holderRun.id);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      const diag = health.diagnostics.find((d) => d.code === "stale_lock_confirmed");
      expect(diag).toBeDefined();
    });

    it("locked_at illegal + holder terminal: stale_lock_confirmed", () => {
      const { project, workspace } = setupLockedWorkspace(RunStatus.Completed, null);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      const diag = health.diagnostics.find((d) => d.code === "stale_lock_confirmed");
      expect(diag).toBeDefined();
    });

    it("locked_at illegal + holder running: lock_timestamp_invalid (no release suggestion)", () => {
      const { project, workspace } = setupLockedWorkspace(RunStatus.Running, null);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      const diag = health.diagnostics.find((d) => d.code === "lock_timestamp_invalid");
      expect(diag).toBeDefined();
      expect(diag!.suggested_action).not.toMatch(/release/i);
    });

    it("locked_at in the future + holder running: lock_timestamp_invalid", () => {
      const { project, workspace, holderRun } = setupLockedWorkspace(RunStatus.Running, THRESHOLD + 1);
      const futureLockedAt = new Date(Date.now() + 60_000).toISOString();
      lockWorkspace(services.db, workspace.id, holderRun.id, futureLockedAt);
      const health = makeHealthService(services).collect(project.id, workspace.id);
      const diag = health.diagnostics.find((d) => d.code === "lock_timestamp_invalid");
      expect(diag).toBeDefined();
    });
  });

  describe("T041b/T041c - queue classifier in health", () => {
    it("Blocked graph node queued: NOT reported as queue_starved, reported as waiting_for_recovery", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Blocked, updatedAt: new Date().toISOString() });
      const now = new Date().toISOString();
      services.db
        .prepare(
          `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, failure_reason, instructions, role, workflow_step, validation_round, dispatch_source, adapter_identity_json, started_at, completed_at, exit_code, error_message, purpose, context_source_run_id, node_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', NULL, '', 'graph_node', NULL, NULL, 'system', NULL, NULL, NULL, NULL, NULL, 'workflow_bound', NULL, NULL, ?, ?)`,
        )
        .run("run_graph_test", issue.id, threadId, workspace.id, adapter.id, now, now);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      expect(health.diagnostics.find((d) => d.code === "queue_starved")).toBeUndefined();
      const recovery = health.diagnostics.find((d) => d.code === "waiting_for_recovery");
      expect(recovery).toBeDefined();
      expect(recovery!.workspace_id).toBe(workspace.id);
    });

    it("eligible_but_not_running + lock occupied: no queue_starved diagnostic", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);
      const otherRun = services.runRepo.create({
        issue_id: issue.id,
        thread_id: threadId,
        workspace_id: workspace.id,
        adapter_config_id: adapter.id,
        instructions: "",
        status: RunStatus.Running,
        role: RunRole.Implementation,
        dispatch_source: RunDispatchSource.UserExplicit,
      });
      services.db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(new Date().toISOString(), otherRun.id);
      lockWorkspace(services.db, workspace.id, otherRun.id, new Date().toISOString());

      const health = makeHealthService(services).collect(project.id, workspace.id);
      expect(health.diagnostics.find((d) => d.code === "queue_starved")).toBeUndefined();
    });

    it("eligible + lock free: single queue_starved diagnostic", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const starved = health.diagnostics.filter((d) => d.code === "queue_starved");
      expect(starved).toHaveLength(1);
      expect(starved[0].workspace_id).toBe(workspace.id);
    });

    it("invalid_queued_run surfaced as public diagnostic", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Done, updatedAt: new Date().toISOString() });

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const invalid = health.diagnostics.find((d) => d.code === "invalid_queued_run");
      expect(invalid).toBeDefined();
      expect(invalid!.workspace_id).toBe(workspace.id);
    });

    it("eligible_but_not_running never appears as a public diagnostic code", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      expect(
        health.diagnostics.find((d) => (d as { code: string }).code === "eligible_but_not_running"),
      ).toBeUndefined();
    });

    it("drain still works after classifier extraction (regression)", async () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
      const run = createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id, RunRole.Implementation);

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.status).toBe(RunStatus.Running);
    });
  });

  describe("T041e - waiting_for_validation_due", () => {
    it("Validating issue waiting for due time, queued_count 0: waiting_for_validation_due, NOT queue_starved", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      createAdapter(services, project.id, "Adapter");
      const futureDueAt = new Date(Date.now() + 60_000).toISOString();
      setIssueValidatingWithDueAt(services.db, issue.id, futureDueAt);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const waiting = health.diagnostics.find((d) => d.code === "waiting_for_validation_due");
      expect(waiting).toBeDefined();
      expect(waiting!.workspace_id).toBe(workspace.id);
      expect(health.diagnostics.find((d) => d.code === "queue_starved")).toBeUndefined();
    });
  });

  describe("T041f - validation dispatch due-time boundaries", () => {
    it("not yet due: waiting_for_validation_due with positive remaining_ms", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      createAdapter(services, project.id, "Adapter");
      const futureDueAt = new Date(Date.now() + 30_000).toISOString();
      setIssueValidatingWithDueAt(services.db, issue.id, futureDueAt);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const waiting = health.diagnostics.find((d) => d.code === "waiting_for_validation_due");
      expect(waiting).toBeDefined();
      expect(waiting!.detail).toContain("remaining_ms=");
    });

    it("within grace window (just past due): waiting_for_validation_due", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      createAdapter(services, project.id, "Adapter");
      const justPastDueAt = new Date(Date.now() - 2_000).toISOString();
      setIssueValidatingWithDueAt(services.db, issue.id, justPastDueAt);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const waiting = health.diagnostics.find((d) => d.code === "waiting_for_validation_due");
      expect(waiting).toBeDefined();
      expect(health.diagnostics.find((d) => d.code === "validation_dispatch_overdue")).toBeUndefined();
    });

    it("past grace window: validation_dispatch_overdue with overdue_ms", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      createAdapter(services, project.id, "Adapter");
      const overdueDueAt = new Date(Date.now() - 30_000).toISOString();
      setIssueValidatingWithDueAt(services.db, issue.id, overdueDueAt);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const overdue = health.diagnostics.find((d) => d.code === "validation_dispatch_overdue");
      expect(overdue).toBeDefined();
      expect(overdue!.workspace_id).toBe(workspace.id);
      expect(overdue!.detail).toContain("overdue_ms=");
      expect(health.diagnostics.find((d) => d.code === "waiting_for_validation_due")).toBeUndefined();
    });
  });

  describe("T041d - no_available_adapter", () => {
    it("workspace with zero Available adapters: no_available_adapter diagnostic", () => {
      const { project, workspace } = setupProject(services, tempDir);
      createAdapter(services, project.id, "UnavailableAdapter", AdapterStatus.Unavailable);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      const diag = health.diagnostics.find((d) => d.code === "no_available_adapter");
      expect(diag).toBeDefined();
      expect(diag!.workspace_id).toBe(workspace.id);
    });

    it("workspace with Available adapter: no no_available_adapter diagnostic", () => {
      const { project, workspace } = setupProject(services, tempDir);
      createAdapter(services, project.id, "AvailableAdapter", AdapterStatus.Available);

      const health = makeHealthService(services).collect(project.id, workspace.id);
      expect(health.diagnostics.find((d) => d.code === "no_available_adapter")).toBeUndefined();
    });
  });

  describe("T042 - read-only (FR-006)", () => {
    it("calling collect triggers no probe, acquires no lock, writes no rows", () => {
      const { project, workspace, issue, threadId } = setupProject(services, tempDir);
      const adapter = createAdapter(services, project.id, "Adapter");
      createQueuedRun(services, issue.id, threadId, workspace.id, adapter.id);

      const probeCountBefore = services.adapterConfigService.healthSnapshot().pendingProbeCount;
      const reprobeCountBefore = services.runDispatchService.healthSnapshot().pendingReprobeCount;
      const wsBefore = services.db
        .prepare("SELECT lock_state, locked_by_run_id, locked_at FROM workspaces WHERE id = ?")
        .get(workspace.id);
      const runCountBefore = (services.db.prepare("SELECT COUNT(*) as c FROM runs").get() as { c: number }).c;
      const issueCountBefore = (services.db.prepare("SELECT COUNT(*) as c FROM issues").get() as { c: number }).c;
      const adapterCountBefore = (services.db.prepare("SELECT COUNT(*) as c FROM agent_configs").get() as { c: number })
        .c;

      makeHealthService(services).collect(project.id, workspace.id);

      const probeCountAfter = services.adapterConfigService.healthSnapshot().pendingProbeCount;
      const reprobeCountAfter = services.runDispatchService.healthSnapshot().pendingReprobeCount;
      const wsAfter = services.db
        .prepare("SELECT lock_state, locked_by_run_id, locked_at FROM workspaces WHERE id = ?")
        .get(workspace.id);
      const runCountAfter = (services.db.prepare("SELECT COUNT(*) as c FROM runs").get() as { c: number }).c;
      const issueCountAfter = (services.db.prepare("SELECT COUNT(*) as c FROM issues").get() as { c: number }).c;
      const adapterCountAfter = (services.db.prepare("SELECT COUNT(*) as c FROM agent_configs").get() as { c: number })
        .c;

      expect(probeCountAfter).toBe(probeCountBefore);
      expect(reprobeCountAfter).toBe(reprobeCountBefore);
      expect(wsAfter).toEqual(wsBefore);
      expect(runCountAfter).toBe(runCountBefore);
      expect(issueCountAfter).toBe(issueCountBefore);
      expect(adapterCountAfter).toBe(adapterCountBefore);
    });
  });

  describe("T043 - route", () => {
    it("valid workspace_id returns health", async () => {
      const { project, workspace } = setupProject(services, tempDir);
      createAdapter(services, project.id, "Adapter");
      const app = buildRouteApp(services);

      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/health/runtime?workspace_id=${workspace.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.health).toBeDefined();
      expect(body.health.workspaces).toHaveLength(1);
      expect(body.health.workspaces[0].workspace_id).toBe(workspace.id);
      await app.close();
    });

    it("invalid workspace_id returns WORKSPACE_NOT_FOUND", async () => {
      const { project } = setupProject(services, tempDir);
      const app = buildRouteApp(services);

      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/health/runtime?workspace_id=ws_nonexistent`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
      await app.close();
    });

    it("cross-project workspace_id returns WORKSPACE_NOT_FOUND", async () => {
      const { project } = setupProject(services, tempDir);
      const otherProject = services.projectService.create("Other");
      services.workspaceService.bind(otherProject.id, createTempDir());
      const otherWorkspace = services.workspaceService.get(otherProject.id)!;
      const app = buildRouteApp(services);

      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/health/runtime?workspace_id=${otherWorkspace.id}`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
      await app.close();
    });

    it("omitted workspace_id aggregates all project workspaces", async () => {
      const project = services.projectService.create("Aggregate");
      services.workspaceService.bind(project.id, tempDir);
      const wsA = services.workspaceService.get(project.id)!;
      const tempDir2 = createTempDir();
      services.workspaceService.bind(project.id, tempDir2);
      const wsB = services.workspaceService.get(project.id)!;
      createAdapter(services, project.id, "Adapter");
      const app = buildRouteApp(services);

      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/health/runtime`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.health.workspaces).toHaveLength(2);
      const wsIds = body.health.workspaces.map((w: { workspace_id: string }) => w.workspace_id);
      expect(wsIds).toContain(wsA.id);
      expect(wsIds).toContain(wsB.id);
      await app.close();
    });

    it("nonexistent project returns PROJECT_NOT_FOUND", async () => {
      const app = buildRouteApp(services);

      const response = await app.inject({
        method: "GET",
        url: "/api/projects/proj_nonexistent/health/runtime",
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("PROJECT_NOT_FOUND");
      await app.close();
    });
  });
});
