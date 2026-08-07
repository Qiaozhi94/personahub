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
import { getDefinition } from "../../src/runtime/graph/definitions.js";
import {
  GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus,
  RunRole, RunPurpose, ThreadEventType, ActorType, FailureReason,
  GraphBlockReason,
} from "@personahub/shared/types";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?,?,?,?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id,project_id,local_path,local_path_normalized,lock_state,push_credentials_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id,name,issue_type,collaboration_topology,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wft_1", "test", "coding", "single", "active", 1, now, now);
  db.prepare("INSERT INTO validation_policies (id,name,issue_type,max_validation_rounds,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id,project_id,workspace_id,issue_type,workflow_template_id,validation_policy_id,title,status,priority,labels,validation_round_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Running", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id,issue_id,thread_type,title,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("thr_1", "iss_1", "primary", "test", now, now);
  db.prepare("INSERT INTO agent_configs (id,project_id,name,cli_provider,command,args,capability_tags,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("agt_1", "prj_1", "test", "codex", "codex", "[]", '["implementation"]', "available", now, now);
}

describe("F006 graph recovery semantics regression", () => {
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

  function countTerminalEvents(): number {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM thread_events WHERE type = ?").get("graph.terminal") as { cnt: number };
    return row.cnt;
  }

  function setRunFinalMessage(runId: string, nodeKey: string): void {
    db.prepare("UPDATE runs SET final_message = ? WHERE id = ?").run(
      JSON.stringify({ node_key: nodeKey, findings: [], not_reviewed: [] }),
      runId,
    );
  }

  it("terminalize: success path - all nodes Completed, graphRun becomes Completed, Issue becomes Ready", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Completed);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Completed);
    const r1 = writeResultEvent("review_concurrency");
    const r2 = writeResultEvent("review_contract");
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });

    await makeRecoveryService().reconcile();

    const fresh = graphRunRepo.getById(gr.id)!;
    expect(fresh.status).toBe(GraphRunStatus.Completed);
    expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Ready);
    expect(countTerminalEvents()).toBe(1);
  });

  it("terminalize: failure path - one node Failed, graphRun becomes Blocked", async () => {
    const gr = createGraphRun();
    createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    createNode(gr.id, "review_contract", NodeRunStatus.Failed);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);

    await makeRecoveryService().reconcile();

    const fresh = graphRunRepo.getById(gr.id)!;
    expect(fresh.status).toBe(GraphRunStatus.Blocked);
    expect(fresh.blocked_reason_code).toBe(GraphBlockReason.RecoveryInconsistent);
    expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Blocked);
  });

  it("recovery semantics ①②: restart preserves completed state, completed nodes not rerun", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    const r1 = writeResultEvent("review_concurrency");
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    createRun(n1.id, RunStatus.Completed);
    createRun(n2.id, RunStatus.Running);

    await makeRecoveryService().reconcile();

    const freshN1 = nodeRunRepo.getById(n1.id)!;
    expect(freshN1.status).toBe(NodeRunStatus.Completed);
    const n1Runs = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n1.id);
    expect(n1Runs.length).toBe(1);
    expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Running);
  });

  it("recovery semantics ③④: interrupted NodeRun can be retried with new Attempt", async () => {
    const gr = createGraphRun();
    createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    createRun(n2.id, RunStatus.Interrupted);

    await makeRecoveryService().reconcile();

    expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Interrupted);

    const casRes = nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Interrupted, NodeRunStatus.Ready);
    expect(casRes.success).toBe(true);
    const newRun = createRun(n2.id, RunStatus.Queued);

    const n2Runs = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n2.id);
    expect(n2Runs.length).toBe(2);
    expect(newRun.node_run_id).toBe(n2.id);
  });

  it("recovery semantics ⑤: fan-in does not converge prematurely - precursor incomplete", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Completed);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    const n3 = createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    const r1 = writeResultEvent("review_concurrency");
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    createRun(n2.id, RunStatus.Running);

    await makeRecoveryService().reconcile();

    expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Running);
    expect(nodeRunRepo.getById(n3.id)!.status).toBe(NodeRunStatus.Pending);
    expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Running);
  });

  it("fault injection: crash after transaction one (NodeRun stuck Running, Run Finished) - replay fixes it", async () => {
    const gr = createGraphRun();
    const n1 = createNode(gr.id, "review_concurrency", NodeRunStatus.Running);
    const n2 = createNode(gr.id, "review_contract", NodeRunStatus.Running);
    const n3 = createNode(gr.id, "synthesize_findings", NodeRunStatus.Pending);
    const run1 = createRun(n1.id, RunStatus.Completed);
    setRunFinalMessage(run1.id, "review_concurrency");
    const run2 = createRun(n2.id, RunStatus.Completed);
    setRunFinalMessage(run2.id, "review_contract");

    await makeRecoveryService().reconcile();

    expect(nodeRunRepo.getById(n1.id)!.status).toBe(NodeRunStatus.Completed);
    expect(nodeRunRepo.getById(n2.id)!.status).toBe(NodeRunStatus.Completed);
    expect(nodeRunRepo.getById(n3.id)!.status).toBe(NodeRunStatus.Ready);
    expect(graphRunRepo.getById(gr.id)!.status).toBe(GraphRunStatus.Running);
  });
});
