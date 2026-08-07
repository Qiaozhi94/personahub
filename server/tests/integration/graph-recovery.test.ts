import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { RunRepository } from "../../src/repositories/run.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { AdapterWorkspaceStatusRepository } from "../../src/repositories/adapter-workspace-status.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { GraphRecoveryService } from "../../src/services/graph-recovery.js";
import { tryFinalizeCancellingGraph } from "../../src/services/graph/cancelling-finalizer.js";
import {
  GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus,
  RunRole, RunPurpose, ThreadEventType, ActorType,
  GraphBlockReason,
} from "@personahub/shared/types";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_1", "test", "coding", "single", "active", 1, now, now);
  db.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_1", "iss_1", "primary", "test", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agt_1", "prj_1", "test", "codex", "codex", "[]", '["implementation"]', "available", now, now);
}

describe("F006 graph recovery integration", () => {
  let db: Database.Database;
  let graphRunRepo: GraphRunRepository;
  let nodeRunRepo: NodeRunRepository;
  let runRepo: RunRepository;
  let issueRepo: IssueRepository;
  let threadEventRepo: ThreadEventRepository;
  let threadEventService: ThreadEventService;
  let agentConfigRepo: AgentConfigRepository;
  let projectRepo: ProjectRepository;
  let workspaceRepo: WorkspaceRepository;
  let adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);

    graphRunRepo = new GraphRunRepository(db);
    nodeRunRepo = new NodeRunRepository(db);
    runRepo = new RunRepository(db);
    issueRepo = new IssueRepository(db);
    threadEventRepo = new ThreadEventRepository(db);
    agentConfigRepo = new AgentConfigRepository(db);
    projectRepo = new ProjectRepository(db);
    workspaceRepo = new WorkspaceRepository(db);
    adapterWorkspaceStatusRepo = new AdapterWorkspaceStatusRepository(db);

    const eventBus = new EventBus();
    threadEventService = new ThreadEventService(threadEventRepo, eventBus);
  });

  afterEach(() => {
    db.close();
  });

  function setIssueStatus(status: IssueStatus): void {
    issueRepo.updateStatus("iss_1", { status, updatedAt: new Date().toISOString() });
  }

  function createGraphRun(status: GraphRunStatus = GraphRunStatus.Running) {
    return graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status, target_files: ["src/test.ts"], target_files_hash: "h1",
    });
  }

  function createNode(graphRunId: string, key: string, status: NodeRunStatus) {
    return nodeRunRepo.create({
      graph_run_id: graphRunId, node_key: key, status,
      assigned_adapter_config_id: "agt_1",
    });
  }

  function createRun(nodeRunId: string, status: RunStatus) {
    return runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test",
      status, role: RunRole.GraphNode, node_run_id: nodeRunId,
      purpose: RunPurpose.WorkflowBound,
    });
  }

  function writeResultEvent(nodeKey: string) {
    return threadEventService.write("thr_1", ThreadEventType.GraphNodeResult, ActorType.System, null, {
      node_key: nodeKey, findings: [], not_reviewed: [],
    });
  }

  function makeRecoveryService(): GraphRecoveryService {
    return new GraphRecoveryService({
      graphRunRepo, nodeRunRepo, runRepo, issueRepo,
      threadEventService, threadEventRepo,
      agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo, db,
    });
  }

  function makeFinalizerDeps() {
    return { graphRunRepo, nodeRunRepo, issueRepo, threadEventService, db };
  }

  function countTerminalEvents(): number {
    return threadEventRepo.listByThreadAndTypes("thr_1", [ThreadEventType.GraphTerminal]).length;
  }

  describe("GraphRecoveryService", () => {
    it("reconcile detects interrupted NodeRuns and marks them Interrupted", async () => {
      setIssueStatus(IssueStatus.Running);
      const gr = createGraphRun();
      const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
      const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
      const r1 = writeResultEvent("review_concurrency");
      nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
      createRun(n2.id, RunStatus.Interrupted);

      await makeRecoveryService().reconcile();

      const freshN2 = nodeRunRepo.getById(n2.id);
      expect(freshN2).not.toBeNull();
      expect(freshN2!.status).toBe(NodeRunStatus.Interrupted);
    });

    it("reconcile terminalizes all-completed graph", async () => {
      setIssueStatus(IssueStatus.Running);
      const gr = createGraphRun();
      const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
      const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Completed);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Completed);
      const r1 = writeResultEvent("review_concurrency");
      const r2 = writeResultEvent("review_contract");
      nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
      nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });

      await makeRecoveryService().reconcile();

      const fresh = graphRunRepo.getById(gr.id);
      expect(fresh).not.toBeNull();
      expect([GraphRunStatus.Completed, GraphRunStatus.Blocked]).toContain(fresh!.status);
      if (fresh!.status === GraphRunStatus.Completed) {
        expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Ready);
      }
    });

    it("reconcile handles cancelling graph", async () => {
      setIssueStatus(IssueStatus.Running);
      const gr = createGraphRun(GraphRunStatus.Cancelling);
      createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
      const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Cancelled);
      // N2's Run is stale (not in Running status), so handleCancellingGraph cancels N2.
      // Two passes: first cancels N2, second finalizes once all nodes are terminal.
      const svc = makeRecoveryService();
      await svc.reconcile();
      await svc.reconcile();

      expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Cancelled);
      expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Cancelled);
      expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Ready);
      expect(countTerminalEvents()).toBe(1);
    });
  });

  describe("tryFinalizeCancellingGraph", () => {
    it("converges cancelling to cancelled when all nodes are terminal", () => {
      setIssueStatus(IssueStatus.Running);
      const gr = createGraphRun(GraphRunStatus.Cancelling);
      createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
      createNode(gr.id, "review_contract", NodeRunStatus.Cancelled);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Failed);

      tryFinalizeCancellingGraph(makeFinalizerDeps(), gr.id);

      expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Cancelled);
      expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Ready);
      expect(countTerminalEvents()).toBe(1);
    });

    it("does nothing when nodes are not all terminal", () => {
      setIssueStatus(IssueStatus.Running);
      const gr = createGraphRun(GraphRunStatus.Cancelling);
      createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
      createNode(gr.id, "review_contract", NodeRunStatus.Running);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Cancelled);

      tryFinalizeCancellingGraph(makeFinalizerDeps(), gr.id);

      expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Cancelling);
      expect(countTerminalEvents()).toBe(0);
    });
  });

  describe("recovery step 0: definition_version_unavailable guard", () => {
    it("blocks the graph when the definition version is missing, skipping all other steps", async () => {
      setIssueStatus(IssueStatus.Running);
      const gr = graphRunRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        definition_id: "nonexistent_definition", definition_version: 999,
        status: GraphRunStatus.Running, target_files: ["src/test.ts"], target_files_hash: "h1",
      });
      createNode(gr.id, "review_concurrency", NodeRunStatus.Running);
      createNode(gr.id, "review_contract", NodeRunStatus.Pending);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
      createRun(nodeRunRepo.listByGraphRun(gr.id)[0].id, RunStatus.Running);

      await makeRecoveryService().reconcile();

      const grAfter = graphRunRepo.getById(gr.id)!;
      expect(grAfter.status).toBe(GraphRunStatus.Blocked);
      expect(grAfter.blocked_reason_code).toBe(GraphBlockReason.DefinitionVersionUnavailable);
      const issueAfter = issueRepo.getById("iss_1")!;
      expect(issueAfter.status).toBe(IssueStatus.Blocked);
    });

    it("skips a blocked non-version graph (waits for user action)", async () => {
      setIssueStatus(IssueStatus.Blocked);
      const gr = createGraphRun(GraphRunStatus.Blocked);
      graphRunRepo.compareAndSetStatus(gr.id, GraphRunStatus.Blocked, GraphRunStatus.Blocked, {
        blocked_reason_code: GraphBlockReason.NodeRunFailed,
        blocked_node_keys: ["review_concurrency"],
      });
      createNode(gr.id, "review_concurrency", NodeRunStatus.Failed);
      createNode(gr.id, "review_contract", NodeRunStatus.Pending);
      createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);

      const result = await makeRecoveryService().reconcile();

      const grAfter = graphRunRepo.getById(gr.id)!;
      expect(grAfter.status).toBe(GraphRunStatus.Blocked);
      expect(grAfter.blocked_reason_code).toBe(GraphBlockReason.NodeRunFailed);
      expect(result.workspaceIdsToDrain).not.toContain("wsp_1");
    });
  });
});
