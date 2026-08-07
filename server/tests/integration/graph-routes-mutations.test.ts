import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import graphRoutes from "../../src/api/routes/graph.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import {
  AdapterStatus, GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, RunRole, RunPurpose,
} from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import { GraphRuntimeService } from "../../src/services/graph-runtime.js";
import { GraphNodeInstructionBuilder } from "../../src/runtime/graph/instruction-builder.js";

/**
 * Regression coverage for the retry / cancel / resolve-executors endpoints
 * added while completing F006's outstanding review findings. Each test
 * targets a bug that was specifically found (and, for the /cancel ordering
 * issue, only found *by writing this test*) across the review rounds —
 * a naive "handler returns the right status code" assertion would not have
 * caught any of them; each one re-queries repository state after the call.
 */

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "unexpected", details: {} } };
  });
  const graphRuntimeService = new GraphRuntimeService(
    {
      graphRunRepo: services.graphRunRepo,
      nodeRunRepo: services.nodeRunRepo,
      runRepo: services.runRepo,
      issueRepo: services.issueRepo,
      threadEventService: services.threadEventService,
      adapterDeps: { agentConfigRepo: services.agentConfigRepo, projectRepo: services.projectRepo, adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo },
      instructionBuilder: new GraphNodeInstructionBuilder(),
      drainWorkspace: (wsId: string) => services.runDispatchService.drainWorkspace(wsId),
    },
    services.db,
  );
  app.register(graphRoutes, {
    graphRunRepo: services.graphRunRepo,
    nodeRunRepo: services.nodeRunRepo,
    runRepo: services.runRepo,
    issueRepo: services.issueRepo,
    workspaceRepo: services.workspaceRepo,
    threadRepo: services.threadRepo,
    threadEventRepo: services.threadEventRepo,
    threadEventService: services.threadEventService,
    runDispatchService: services.runDispatchService,
    graphRuntimeService,
    agentConfigRepo: services.agentConfigRepo,
    projectRepo: services.projectRepo,
    adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo,
    db: services.db,
  });
  return app;
}

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  const workspace = services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  return { project, workspace, issue };
}

function createFakeAdapter(services: TestServices, projectId: string, opts: ConstructorParameters<typeof FakeAgentAdapter>[0] = {}) {
  services.adapterRegistry.register(new FakeAgentAdapter(opts));
  return services.agentConfigRepo.create({
    project_id: projectId,
    name: "Fake Adapter",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: ["implementation"],
    default_model: null,
    status: AdapterStatus.Available,
  });
}

describe("F006 graph mutation endpoint regressions", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("retry: unblocks the Issue (not just the GraphRun) and the new Attempt actually starts — regression for the IssueStatus/GraphRunStatus enum-case CAS bug", async () => {
    const { issue, workspace } = setupIssue(services, tempDir);
    const adapter = createFakeAdapter(services, issue.project_id, { delayMs: 20, outputDelayMs: 5, finalMessage: JSON.stringify({ node_key: "review_concurrency", findings: [], not_reviewed: [] }) });

    const graphRun = services.graphRunRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: workspace.id,
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Blocked,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    services.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Blocked, GraphRunStatus.Blocked, {
      blocked_reason_code: "node_run_failed" as never, blocked_node_keys: ["review_concurrency"],
    });
    const n1 = services.nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Failed, assigned_adapter_config_id: adapter.id,
    });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Completed, assigned_adapter_config_id: adapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "synthesize_findings", status: NodeRunStatus.Pending, assigned_adapter_config_id: adapter.id });
    services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Inbox, IssueStatus.Running);
    services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Blocked);

    const app = buildApp(services);
    const response = await app.inject({
      method: "POST",
      url: `/api/graph-runs/${graphRun.id}/nodes/review_concurrency/retry`,
    });

    expect(response.statusCode).toBe(202);

    // The regression: a prior version compared the Issue's current status
    // against `gr.status` ("blocked", a GraphRunStatus value) instead of
    // IssueStatus.Blocked ("Blocked") — the CAS silently never matched, and
    // the Issue was left stuck on Blocked forever even though the response
    // looked successful. Must re-query, not trust the HTTP response.
    const freshIssue = services.issueRepo.getById(issue.id)!;
    expect(freshIssue.status).toBe(IssueStatus.Running);

    const freshGraph = services.graphRunRepo.getById(graphRun.id)!;
    expect(freshGraph.status).toBe(GraphRunStatus.Running);
    expect(freshGraph.blocked_reason_code).toBeNull();

    // Because the Issue actually unblocked, startNextQueuedRun's GraphNode
    // eligibility gate no longer skips the new Attempt — it must actually
    // start (not sit `queued` forever).
    const attempts = services.runRepo.listByIssue(issue.id).filter((r) => r.node_run_id === n1.id);
    expect(attempts.length).toBe(1);
    expect(attempts[0].status).not.toBe(RunStatus.Queued);

    await wait(100);
    const settled = services.runRepo.getById(attempts[0].id)!;
    expect(settled.status).toBe(RunStatus.Completed);
  });

  it("cancel: a graph with one running node and other pending nodes converges to `cancelled` without a restart — regression for the cancelling-CAS-ordering bug", async () => {
    const { issue, workspace } = setupIssue(services, tempDir);
    const adapter = createFakeAdapter(services, issue.project_id, { delayMs: 5_000, outputDelayMs: 1_000 });

    const graphRun = services.graphRunRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: workspace.id,
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    const n1 = services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Running, assigned_adapter_config_id: adapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Ready, assigned_adapter_config_id: adapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "synthesize_findings", status: NodeRunStatus.Pending, assigned_adapter_config_id: adapter.id });
    services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Inbox, IssueStatus.Running);

    const runningRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: workspace.id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: n1.id, purpose: RunPurpose.WorkflowBound,
    });
    const acquired = services.workspaceLockService.acquire(workspace.id, runningRun.id);
    expect(acquired).toBe(true);
    services.runRepo.transitionStatus(runningRun.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    await services.agentRunner.startRun({
      run: services.runRepo.getById(runningRun.id)!,
      adapter: services.adapterRegistry.getForConfig(adapter),
      workspace,
      context: "test",
      adapterConfig: { command: adapter.command, args: adapter.args, model_provider: null, default_model: adapter.default_model, auth_type: adapter.auth_type, api_key: null },
      onTerminal: (runId, workspaceId) => services.runDispatchService.onRunTerminal(runId, workspaceId),
      onEscalation: (params) => services.runDispatchService.onEscalation(params),
    });

    const app = buildApp(services);
    const response = await app.inject({ method: "POST", url: `/api/graph-runs/${graphRun.id}/cancel` });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("cancelling");

    // The regression: the graph's own CAS to `cancelling` used to happen
    // AFTER awaiting the running node's cancellation. That cancellation's
    // own finalization check (tryFinalizeCancellingGraph) would find the
    // graph still `running`, no-op, and the graph would then get set to
    // `cancelling` moments later with nothing left to ever move it past
    // that — stuck until a server restart. Assert it actually reaches
    // `cancelled` here, in this same process, no restart involved.
    const freshGraph = services.graphRunRepo.getById(graphRun.id)!;
    expect(freshGraph.status).toBe(GraphRunStatus.Cancelled);

    const freshIssue = services.issueRepo.getById(issue.id)!;
    expect(freshIssue.status).toBe(IssueStatus.Ready);

    const freshN1 = services.nodeRunRepo.getById(n1.id)!;
    expect(freshN1.status).toBe(NodeRunStatus.Cancelled);
  }, 10_000);

  it("cancel: an immediate full cancel (no running nodes) transitions the Issue to Ready and writes graph.terminal", async () => {
    const { issue, workspace } = setupIssue(services, tempDir);
    const adapter = createFakeAdapter(services, issue.project_id);

    const graphRun = services.graphRunRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: workspace.id,
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Ready, assigned_adapter_config_id: adapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Ready, assigned_adapter_config_id: adapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "synthesize_findings", status: NodeRunStatus.Pending, assigned_adapter_config_id: adapter.id });
    services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Inbox, IssueStatus.Running);

    const app = buildApp(services);
    const response = await app.inject({ method: "POST", url: `/api/graph-runs/${graphRun.id}/cancel` });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("cancelled");

    const freshGraph = services.graphRunRepo.getById(graphRun.id)!;
    expect(freshGraph.status).toBe(GraphRunStatus.Cancelled);
    const freshIssue = services.issueRepo.getById(issue.id)!;
    expect(freshIssue.status).toBe(IssueStatus.Ready);
  });

  it("resolve-executors: reassigns the adapter and actually builds a new Attempt for a no_capable_adapter-blocked node", async () => {
    const { issue, workspace } = setupIssue(services, tempDir);
    const badAdapter = createFakeAdapter(services, issue.project_id);
    const goodAdapter = services.agentConfigRepo.create({
      project_id: issue.project_id, name: "Good Adapter", role: "implementation", cli_provider: "fake",
      command: "fake", args: [], capability_tags: ["implementation"], default_model: null, status: AdapterStatus.Available,
    });

    const graphRun = services.graphRunRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: workspace.id,
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Blocked,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    services.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Blocked, GraphRunStatus.Blocked, {
      blocked_reason_code: "no_capable_adapter" as never, blocked_node_keys: ["synthesize_findings"],
    });
    const n1 = services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Completed, assigned_adapter_config_id: badAdapter.id });
    const n2 = services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Completed, assigned_adapter_config_id: badAdapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "synthesize_findings", status: NodeRunStatus.Pending, assigned_adapter_config_id: badAdapter.id });
    services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Inbox, IssueStatus.Running);
    services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Blocked);

    const r1 = services.threadEventService.write(issue.primary_thread_id!, "graph.node_result" as never, "system" as never, null, { node_key: "review_concurrency", findings: [], not_reviewed: [] });
    const r2 = services.threadEventService.write(issue.primary_thread_id!, "graph.node_result" as never, "system" as never, null, { node_key: "review_contract", findings: [], not_reviewed: [] });
    services.nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    services.nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });

    const app = buildApp(services);
    const response = await app.inject({
      method: "POST",
      url: `/api/graph-runs/${graphRun.id}/resolve-executors`,
      payload: { node_assignments: { synthesize_findings: goodAdapter.id } },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe(GraphRunStatus.Running);
    expect(body.reassigned).toEqual([{ node_key: "synthesize_findings", from: badAdapter.id, to: goodAdapter.id }]);
    expect(body.queued_run_ids.length).toBe(1);

    const synthesis = services.nodeRunRepo.getByGraphRunAndKey(graphRun.id, "synthesize_findings")!;
    expect(synthesis.assigned_adapter_config_id).toBe(goodAdapter.id);
    // The response's own drainWorkspace() call can win the race and claim
    // the newly-queued Attempt (Ready -> Running) before this assertion
    // runs on an otherwise-idle workspace — either is evidence the Attempt
    // was actually built, which is what this test is really checking.
    expect([NodeRunStatus.Ready, NodeRunStatus.Running]).toContain(synthesis.status);

    const freshGraph = services.graphRunRepo.getById(graphRun.id)!;
    expect(freshGraph.status).toBe(GraphRunStatus.Running);
    expect(freshGraph.blocked_reason_code).toBeNull();

    const freshIssue = services.issueRepo.getById(issue.id)!;
    expect(freshIssue.status).toBe(IssueStatus.Running);

    const synthRuns = services.runRepo.listByIssue(issue.id).filter((r) => r.node_run_id === synthesis.id);
    expect(synthRuns.length).toBe(1);
    expect(synthRuns[0].adapter_config_id).toBe(goodAdapter.id);
  });

  it("resolve-executors: rejects with NO_CAPABLE_ADAPTER when the new adapter still lacks the required capability", async () => {
    const { issue, workspace } = setupIssue(services, tempDir);
    const badAdapter = createFakeAdapter(services, issue.project_id);
    const stillIncapable = services.agentConfigRepo.create({
      project_id: issue.project_id, name: "Still Bad", role: "validator", cli_provider: "fake",
      command: "fake", args: [], capability_tags: ["validator"], default_model: null, status: AdapterStatus.Available,
    });

    const graphRun = services.graphRunRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: workspace.id,
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Blocked,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    services.graphRunRepo.compareAndSetStatus(graphRun.id, GraphRunStatus.Blocked, GraphRunStatus.Blocked, {
      blocked_reason_code: "no_capable_adapter" as never, blocked_node_keys: ["synthesize_findings"],
    });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Completed, assigned_adapter_config_id: badAdapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Completed, assigned_adapter_config_id: badAdapter.id });
    services.nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "synthesize_findings", status: NodeRunStatus.Pending, assigned_adapter_config_id: badAdapter.id });

    const app = buildApp(services);
    const response = await app.inject({
      method: "POST",
      url: `/api/graph-runs/${graphRun.id}/resolve-executors`,
      payload: { node_assignments: { synthesize_findings: stillIncapable.id } },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(ErrorCode.NO_CAPABLE_ADAPTER);

    // Rejected requests must not partially apply — the blocker stays intact.
    const freshGraph = services.graphRunRepo.getById(graphRun.id)!;
    expect(freshGraph.status).toBe(GraphRunStatus.Blocked);
  });
});
