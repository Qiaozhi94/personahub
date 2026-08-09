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
import { resolveEligibleAdapter } from "../../src/services/adapter-eligibility.js";
import { blockGraphOnCancelledPrecursor, type NodeCompletionDeps } from "../../src/services/graph/node-completion.js";
import { ErrorCode } from "@personahub/shared/errors";
import {
  AgentCapability, GraphRunStatus, NodeRunStatus, RunStatus,
  RunRole, RunPurpose, FailureReason,
} from "@personahub/shared/types";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id,name,created_at,updated_at) VALUES (?,?,?,?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id,project_id,local_path,local_path_normalized,lock_state,push_credentials_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id,name,issue_type,collaboration_topology,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wft_1", "test", "coding", "single", "inactive", 2, now, now);
  db.prepare("INSERT INTO validation_policies (id,name,issue_type,max_validation_rounds,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id,project_id,workspace_id,issue_type,workflow_template_id,validation_policy_id,title,status,priority,labels,validation_round_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Running", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id,issue_id,thread_type,title,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("thr_1", "iss_1", "primary", "test", now, now);
  // Two adapters: agt_1 has "implementation" capability (good), agt_2 has "validation" only (bad for implementation nodes)
  db.prepare("INSERT INTO agent_configs (id,project_id,name,cli_provider,command,args,capability_tags,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("agt_1", "prj_1", "good", "codex", "codex", "[]", '["implementation"]', "available", now, now);
  db.prepare("INSERT INTO agent_configs (id,project_id,name,cli_provider,command,args,capability_tags,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("agt_2", "prj_1", "bad", "codex", "codex", "[]", '["validation"]', "available", now, now);
}

describe("F006 graph adapter qualification, escalation, and cancel edge cases", () => {
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

  it("capability regression: adapter without required capability is rejected", () => {
    const result = resolveEligibleAdapter(
      { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      "prj_1", "wsp_1",
      { explicitAdapterId: "agt_2", requiredCapabilities: [AgentCapability.Implementation] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ErrorCode.ADAPTER_CAPABILITY_MISSING);
    }
  });

  it("adapter becomes unavailable while queued - blocked with no_capable_adapter", () => {
    const graphRun = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency",
      status: NodeRunStatus.Ready, assigned_adapter_config_id: "agt_1",
    });
    db.prepare("UPDATE agent_configs SET status='unavailable' WHERE id='agt_1'").run();

    const result = resolveEligibleAdapter(
      { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      "prj_1", "wsp_1",
      { explicitAdapterId: "agt_1", requiredCapabilities: [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ErrorCode.ADAPTER_UNAVAILABLE);
    }
  });

  it("adapter loses capability while queued - blocked with no_capable_adapter", () => {
    const graphRun = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency",
      status: NodeRunStatus.Ready, assigned_adapter_config_id: "agt_2",
    });

    const result = resolveEligibleAdapter(
      { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      "prj_1", "wsp_1",
      { explicitAdapterId: "agt_2", requiredCapabilities: [AgentCapability.Implementation] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe(ErrorCode.ADAPTER_CAPABILITY_MISSING);
    }
  });

  it("graph node completion does not trigger validation - RunRole.GraphNode is excluded", () => {
    const graphRun = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });
    const n1 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency",
      status: NodeRunStatus.Running, assigned_adapter_config_id: "agt_1",
    });
    const graphNodeRun = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "graph node work",
      status: RunStatus.Running, role: RunRole.GraphNode, node_run_id: n1.id,
      purpose: RunPurpose.WorkflowBound,
    });
    expect(RunRole.GraphNode).not.toBe("implementation");

    const implRun = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "impl work",
      status: RunStatus.Queued, role: RunRole.Implementation,
      purpose: RunPurpose.WorkflowBound,
    });

    const graphRow = db.prepare("SELECT role FROM runs WHERE id=?").get(graphNodeRun.id) as { role: string };
    expect(graphRow.role).toBe(RunRole.GraphNode);
    expect(graphRow.role).not.toBe("implementation");

    const implRow = db.prepare("SELECT role FROM runs WHERE id=?").get(implRun.id) as { role: string };
    expect(implRow.role).toBe("implementation");
  });

  it("escalation: cancels running node but leaves queued graph sibling untouched", () => {
    const graphRun = graphRunRepo.create({ issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1", definition_id: "wgd_coding_dual_review", definition_version: 1, status: GraphRunStatus.Running, target_files: ["src/test.ts"], target_files_hash: "h1" });
    const n1 = nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Running, assigned_adapter_config_id: "agt_1" });
    const n2 = nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Ready, assigned_adapter_config_id: "agt_1" });
    const r1 = runRepo.create({ issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1", adapter_config_id: "agt_1", instructions: "n1", status: RunStatus.Running, role: RunRole.GraphNode, node_run_id: n1.id, purpose: RunPurpose.WorkflowBound });
    const r2 = runRepo.create({ issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1", adapter_config_id: "agt_1", instructions: "n2", status: RunStatus.Queued, role: RunRole.GraphNode, node_run_id: n2.id, purpose: RunPurpose.WorkflowBound });
    const queuedGraphCount = db.prepare("SELECT COUNT(*) as cnt FROM runs WHERE node_run_id = ? AND status = 'queued' AND role = ?").get(n2.id, RunRole.GraphNode) as { cnt: number };
    expect(queuedGraphCount.cnt).toBe(1);
    const failResult = runRepo.transitionStatus(r1.id, RunStatus.Running, RunStatus.Failed, { failure_reason: FailureReason.PostHocEscalation });
    expect(failResult.success).toBe(true);
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Running, NodeRunStatus.Failed);
    expect(runRepo.getById(r1.id)!.status).toBe(RunStatus.Failed);
    expect(nodeRunRepo.getById(n1.id)!.status).toBe(NodeRunStatus.Failed);
    expect(runRepo.getById(r2.id)!.status).toBe(RunStatus.Queued);
  });

  it("cancel: single queued node gets cancelled, lock released, graph blocked correctly", () => {
    const graphRun = graphRunRepo.create({ issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1", definition_id: "wgd_coding_dual_review", definition_version: 1, status: GraphRunStatus.Running, target_files: ["src/test.ts"], target_files_hash: "h1" });
    const n1 = nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_concurrency", status: NodeRunStatus.Ready, assigned_adapter_config_id: "agt_1" });
    const n2 = nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "review_contract", status: NodeRunStatus.Running, assigned_adapter_config_id: "agt_1" });
    nodeRunRepo.create({ graph_run_id: graphRun.id, node_key: "synthesize_findings", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });
    const r1 = runRepo.create({ issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1", adapter_config_id: "agt_1", instructions: "n1", status: RunStatus.Queued, role: RunRole.GraphNode, node_run_id: n1.id, purpose: RunPurpose.WorkflowBound });
    runRepo.create({ issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1", adapter_config_id: "agt_1", instructions: "n2", status: RunStatus.Running, role: RunRole.GraphNode, node_run_id: n2.id, purpose: RunPurpose.WorkflowBound });
    const casN1 = nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Ready, NodeRunStatus.Cancelled);
    expect(casN1.success).toBe(true);
    const cancelRun = runRepo.transitionStatus(r1.id, RunStatus.Queued, RunStatus.Cancelled, {});
    expect(cancelRun.success).toBe(true);
    expect(nodeRunRepo.getById(n1.id)!.status).toBe(NodeRunStatus.Cancelled);
    expect(runRepo.getById(r1.id)!.status).toBe(RunStatus.Cancelled);
    const wsRow = db.prepare("SELECT lock_state FROM workspaces WHERE id=?").get("wsp_1") as { lock_state: string };
    expect(wsRow.lock_state).toBe("idle");

    const completionDeps: NodeCompletionDeps = {
      nodeRunRepo, graphRunRepo, runRepo, issueRepo,
      threadEventService, threadEventRepo, agentConfigRepo, projectRepo,
      adapterWorkspaceStatusRepo, db,
    };
    const blocked = blockGraphOnCancelledPrecursor(completionDeps, graphRun.id, "review_concurrency");
    expect(blocked).toBe(true);

    const grAfter = graphRunRepo.getById(graphRun.id)!;
    expect(grAfter.status).toBe(GraphRunStatus.Blocked);
    expect(grAfter.blocked_reason_code).toBe("node_run_cancelled");
    expect(grAfter.blocked_node_keys).toEqual(["review_concurrency"]);
  });
});
