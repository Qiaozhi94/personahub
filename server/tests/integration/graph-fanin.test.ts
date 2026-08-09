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
import { ThreadEventService } from "../../src/services/thread-event.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { AdapterWorkspaceStatusRepository } from "../../src/repositories/adapter-workspace-status.js";
import {
  GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus,
  RunRole, RunPurpose, ThreadEventType, ActorType,
} from "@personahub/shared/types";
import { getDefinition } from "../../src/runtime/graph/definitions.js";
import { evaluateJoinAndTrigger } from "../../src/services/graph/workflow.js";
import type { GraphWorkflowDeps } from "../../src/services/graph/workflow.js";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_1", "test", "coding", "single", "inactive", 2, now, now);
  db.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_1", "iss_1", "primary", "test", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agt_1", "prj_1", "test", "codex", "codex", "[]", '["implementation"]', "available", now, now);
}

describe("F006 graph execution end-to-end", () => {
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

  it("AC-001: full three-node graph lifecycle — create, execute precursors, join triggers synthesis", () => {
    const definition = getDefinition("wgd_coding_dual_review", 1);
    expect(definition).not.toBeNull();

    // Step 1: Create graph run with 3 node runs
    const graphRun = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });

    const n1 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency",
      status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1",
    });
    const n2 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_contract",
      status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1",
    });
    const n3 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "synthesize_findings",
      status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1",
    });

    // Step 2: Transition precursors to ready → running
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Pending, NodeRunStatus.Ready);
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Ready, NodeRunStatus.Running);
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Pending, NodeRunStatus.Ready);
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Ready, NodeRunStatus.Running);

    // Step 3: Create queued Runs for precursors
    const run1 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "review concurrency",
      status: RunStatus.Queued, role: RunRole.GraphNode, node_run_id: n1.id,
      purpose: RunPurpose.WorkflowBound,
    });
    const run2 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "review contract",
      status: RunStatus.Queued, role: RunRole.GraphNode, node_run_id: n2.id,
      purpose: RunPurpose.WorkflowBound,
    });

    // Step 4: Complete N1 with result event
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Running, NodeRunStatus.Completed);
    runRepo.transitionStatus(run1.id, RunStatus.Queued, RunStatus.Completed, {});

    const n1ResultEvent = threadEventService.write("thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, { node_key: "review_concurrency", findings: [], not_reviewed: [] });
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: n1ResultEvent.id });

    const synthAfterN1 = nodeRunRepo.getById(n3.id)!;
    expect(synthAfterN1.status).toBe(NodeRunStatus.Pending);

    // Step 5: Complete N2 with result event — join should now trigger synthesis
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Running, NodeRunStatus.Completed);
    runRepo.transitionStatus(run2.id, RunStatus.Queued, RunStatus.Completed, {});

    const n2ResultEvent = threadEventService.write("thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, { node_key: "review_contract", findings: [], not_reviewed: [] });
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: n2ResultEvent.id });

    const deps: GraphWorkflowDeps = {
      graphRunRepo, nodeRunRepo, runRepo, issueRepo,
      threadEventService, threadEventRepo,
      adapterDeps: { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      db,
    };

    const graphRunFresh = graphRunRepo.getById(graphRun.id)!;
    const events: Parameters<typeof evaluateJoinAndTrigger>[3] = [];
    evaluateJoinAndTrigger(deps, graphRunFresh, nodeRunRepo.getById(n2.id)!, events);

    // Step 6: Verify synthesis transitioned and got an Attempt
    const synthFinal = nodeRunRepo.getById(n3.id)!;
    expect(synthFinal.status).toBe(NodeRunStatus.Ready);
    expect(synthFinal.join_satisfied_at).not.toBeNull();

    // Verify synthesis has exactly one active Attempt
    const synthRuns = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n3.id);
    expect(synthRuns.length).toBe(1);
    expect(synthRuns[0].status).toBe(RunStatus.Queued);
    expect(synthRuns[0].role).toBe(RunRole.GraphNode);
  });

  it("AC-004: join does not trigger twice — CAS prevents duplicate synthesis Attempt", () => {
    const graphRun = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/test.ts"], target_files_hash: "h1",
    });

    const n1 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency",
      status: NodeRunStatus.Completed, assigned_adapter_config_id: "agt_1",
    });
    const n2 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_contract",
      status: NodeRunStatus.Completed, assigned_adapter_config_id: "agt_1",
    });

    const r1 = threadEventService.write("thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, { node_key: "review_concurrency", findings: [], not_reviewed: [] });
    const r2 = threadEventService.write("thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, { node_key: "review_contract", findings: [], not_reviewed: [] });
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });
    const n3 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "synthesize_findings",
      status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1",
    });

    const deps: GraphWorkflowDeps = {
      graphRunRepo, nodeRunRepo, runRepo, issueRepo,
      threadEventService, threadEventRepo,
      adapterDeps: { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      db,
    };

    const graphRunFresh = graphRunRepo.getById(graphRun.id)!;

    // First join trigger
    evaluateJoinAndTrigger(deps, graphRunFresh, nodeRunRepo.getById(n2.id)!, []);

    const synthAfterFirst = nodeRunRepo.getById(n3.id)!;
    expect(synthAfterFirst.status).toBe(NodeRunStatus.Ready);

    const synthRunsAfterFirst = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n3.id);
    expect(synthRunsAfterFirst.length).toBe(1);

    // Second join trigger — CAS should fail, no duplicate Attempt
    evaluateJoinAndTrigger(deps, graphRunFresh, nodeRunRepo.getById(n2.id)!, []);

    const synthAfterSecond = nodeRunRepo.getById(n3.id)!;
    expect(synthAfterSecond.status).toBe(NodeRunStatus.Ready);

    const synthRunsAfterSecond = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n3.id);
    expect(synthRunsAfterSecond.length).toBe(1);
  });
});