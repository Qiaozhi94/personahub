import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import graphRoutes from "../../src/api/routes/graph.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus, AgentCapability, GraphRunStatus, NodeRunStatus, IssueStatus } from "@personahub/shared/types";
import { GraphRuntimeService } from "../../src/services/graph-runtime.js";
import { GraphNodeInstructionBuilder } from "../../src/runtime/graph/instruction-builder.js";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildApp(services: TestServices) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(getErrorStatus(error.code));
      return buildErrorResponse(error);
    }
    reply.code(500);
    return { error: { code: ErrorCode.INTERNAL_ERROR, message: String(error.message ?? "unexpected"), details: {} } };
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
  graphRoutes(app, {
    graphRunRepo: services.graphRunRepo,
    nodeRunRepo: services.nodeRunRepo,
    runRepo: services.runRepo,
    issueRepo: services.issueRepo,
    workspaceRepo: services.workspaceRepo,
    threadRepo: services.threadRepo,
    threadEventService: services.threadEventService,
    runDispatchService: services.runDispatchService,
    graphRuntimeService,
  });
  return app;
}

describe("T063 real-CLI acceptance", () => {
  let services: TestServices;
  let tempDir: string;
  let projectId: string;
  let issueId: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    services.adapterRegistry.register(new CodexCliAdapter());

    const project = services.projectService.create("CLI Test", "acceptance");
    projectId = project.id;
    const workspace = services.workspaceService.bind(project.id, tempDir);

    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "worker.ts"), [
      "let lock = false;",
      "export function doWork() {",
      "  if (lock) throw new Error('re-entrant');",
      "  lock = true;",
      "  try { return 42; }",
      "  finally { lock = false; }",
      "}",
    ].join("\n"));
    writeFileSync(join(tempDir, "src", "api.ts"), [
      "export function fetchData(url: string): string | null {",
      "  const result = '' as string | null;",
      "  return (result?.length ?? 0) > 0 ? result : null;",
      "}",
    ].join("\n"));

    const { issue } = services.issueService.create(project.id, { title: `CLI acceptance ${new Date().toISOString().slice(0, 19)}`, goal: "Verify graph execution" });
    issueId = issue.id;

    services.agentConfigRepo.create({
      project_id: project.id, name: "Codex A", role: "implementation",
      cli_provider: "codex", command: "codex", args: [],
      capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });
    services.agentConfigRepo.create({
      project_id: project.id, name: "Codex B", role: "implementation",
      cli_provider: "codex", command: "codex", args: [],
      capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });
  }, 30000);

  afterEach(() => {
    disposeTestServices(services);
  });

  it("T063: three-node dual-review graph with real Codex adapter", async () => {
    const app = buildApp(services);
    const adapters = services.agentConfigRepo.listByProject(projectId);

    const nodeAssignments: Record<string, string> = {
      review_concurrency: adapters[0].id,
      review_contract: adapters.length > 1 ? adapters[1].id : adapters[0].id,
      synthesize_findings: adapters[0].id,
    };

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/issues/${issueId}/graph-runs`,
      payload: {
        definitionId: "wgd_coding_dual_review",
        definitionVersion: 1,
        nodeAssignments,
        premiseHash: null,
      },
    });

    console.log(`\n  Graph start: ${startResponse.statusCode} body=${startResponse.body.substring(0, 200)}`);
    if (startResponse.statusCode !== 201) {
      console.log(`  RESPONSE BODY: ${startResponse.body}`);
    }
    expect(startResponse.statusCode).toBe(201);
    const body = startResponse.json() as { graph_run_id: string };
    console.log(`  GraphRun ID: ${body.graph_run_id}`);

    let status = GraphRunStatus.Running;
    const maxWait = 600_000;
    const start = Date.now();

    while ((status === GraphRunStatus.Running || status === GraphRunStatus.Cancelling) && Date.now() - start < maxWait) {
      await wait(5000);

      const gr = services.graphRunRepo.getById(body.graph_run_id);
      if (!gr) break;
      status = gr.status;

      const nodeRuns = services.nodeRunRepo.listByGraphRun(body.graph_run_id);
      const runs = services.runRepo.listByIssue(issueId);
      const parts = nodeRuns.map((nr) => {
        const nodeRuns_ = runs.filter((r) => r.node_run_id === nr.id);
        const latest = nodeRuns_.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return `${nr.node_key}:${nr.status}(${nodeRuns_.length}A)/${latest?.status ?? "-"}`;
      });

      console.log(`  [${((Date.now() - start) / 1000).toFixed(0)}s] graph=${status} | ${parts.join(" | ")}`);

      if (gr.blocked_reason_code) {
        console.log(`  BLOCKED: ${gr.blocked_reason_code} keys=${JSON.stringify(gr.blocked_node_keys)}`);
      }
    }

    const duration = ((Date.now() - start) / 1000).toFixed(0);
    const gr = services.graphRunRepo.getById(body.graph_run_id)!;
    console.log(`\n  Final (${duration}s): graph=${gr.status} blocked=${gr.blocked_reason_code ?? "none"}`);

    const nodeRuns = services.nodeRunRepo.listByGraphRun(body.graph_run_id);
    const runs = services.runRepo.listByIssue(issueId);
    for (const nr of nodeRuns) {
      const nodeRuns_ = runs.filter((r) => r.node_run_id === nr.id);
      const latest = nodeRuns_.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      console.log(`    ${nr.node_key}: ${nr.status} attempts=${nodeRuns_.length} latest=${latest?.status ?? "none"} err=${latest?.error_message?.substring(0, 100) ?? "none"}`);
    }

    if (gr.blocked_reason_code && gr.blocked_node_keys) {
      for (const key of (gr.blocked_node_keys as string[])) {
        const nr = services.nodeRunRepo.getByGraphRunAndKey(body.graph_run_id, key);
        if (nr) {
          for (const r of runs.filter((r) => r.node_run_id === nr.id && r.status === "failed")) {
            console.log(`    ${key} run=${r.id} reason=${r.failure_reason} msg=${r.error_message?.substring(0, 300) ?? "none"}`);
          }
        }
      }
    }

    expect(["completed"]).toContain(gr.status);

    if (gr.status === GraphRunStatus.Completed) {
      const issueAfter = services.issueRepo.getById(issueId)!;
      expect(issueAfter.status).toBe(IssueStatus.Ready);
      console.log("  ACCEPTANCE PASSED: three-node graph completed successfully");
    }
  }, 660_000);
});

