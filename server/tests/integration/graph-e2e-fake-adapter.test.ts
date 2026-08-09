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
import { getDefinition } from "../../src/runtime/graph/definitions.js";
import { evaluateJoinAndTrigger } from "../../src/services/graph/workflow.js";
import type { GraphWorkflowDeps } from "../../src/services/graph/workflow.js";
import { GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus, RunRole, RunPurpose, ThreadEventType, ActorType } from "@personahub/shared/types";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_1", "test", "coding", "single", "inactive", 2, now, now);
  db.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_1", "iss_1", "primary", "test", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agt_1", "prj_1", "codex-reviewer", "codex", "codex", "[]", '["implementation"]', "available", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agt_2", "prj_1", "claude-reviewer", "claude", "claude", "[]", '["implementation"]', "available", now, now);
}

describe("T060 graph e2e fake-adapter - wgd_coding_dual_review", () => {
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

  it("AC-001 / T060: three-node dual-review graph - precursors complete with findings_v1, join triggers synthesis", () => {
    const definition = getDefinition("wgd_coding_dual_review", 1);
    expect(definition).not.toBeNull();
    expect(definition!.nodes.map((n) => n.key)).toEqual(
      expect.arrayContaining(["review_concurrency", "review_contract", "synthesize_findings"]),
    );
    const synthEdges = definition!.edges.filter((e) => e.to === "synthesize_findings");
    expect(synthEdges.length).toBe(2);
    expect(synthEdges.every((e) => e.joinGroup === "all_required")).toBe(true);

    expect(issueRepo.getById("iss_1")!.status).toBe(IssueStatus.Inbox);

    const graphRun = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/review-target.ts"], target_files_hash: "h1",
    });
    expect(graphRun.status).toBe(GraphRunStatus.Running);

    const n1 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_concurrency",
      status: NodeRunStatus.Running, assigned_adapter_config_id: "agt_1",
    });
    const n2 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "review_contract",
      status: NodeRunStatus.Running, assigned_adapter_config_id: "agt_2",
    });
    const n3 = nodeRunRepo.create({
      graph_run_id: graphRun.id, node_key: "synthesize_findings",
      status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1",
    });
    expect(n3.status).toBe(NodeRunStatus.Pending);
    expect(n3.join_satisfied_at).toBeNull();

    const run1 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "review concurrency",
      status: RunStatus.Queued, role: RunRole.GraphNode, node_run_id: n1.id,
      purpose: RunPurpose.WorkflowBound,
    });
    const run2 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_2", instructions: "review contract",
      status: RunStatus.Queued, role: RunRole.GraphNode, node_run_id: n2.id,
      purpose: RunPurpose.WorkflowBound,
    });

    const nowIso = new Date().toISOString();
    expect(runRepo.transitionStatus(run1.id, RunStatus.Queued, RunStatus.Running, { started_at: nowIso }).success).toBe(true);
    expect(runRepo.transitionStatus(run2.id, RunStatus.Queued, RunStatus.Running, { started_at: nowIso }).success).toBe(true);

    const n1FindingsPayload = {
      node_key: "review_concurrency",
      findings: [
        {
          severity: "high",
          file: "src/review-target.ts",
          line: 42,
          claim: "CAS write on node_runs races with concurrent synthesis trigger",
          failure_scenario: "two precursors complete simultaneously -> double Attempt created",
        },
      ],
      not_reviewed: ["src/legacy/old.ts"],
    };
    const n2FindingsPayload = {
      node_key: "review_contract",
      findings: [
        {
          severity: "medium",
          file: "src/review-target.ts",
          line: 17,
          claim: "missing null check on result_event_id before thread_event lookup",
          failure_scenario: "result_event_id null -> undefined payload -> synthesis crashes",
        },
      ],
      not_reviewed: [] as string[],
    };

    expect(runRepo.transitionStatus(run1.id, RunStatus.Running, RunStatus.Completed, {
      completed_at: nowIso, final_message: JSON.stringify(n1FindingsPayload),
    }).success).toBe(true);
    expect(runRepo.transitionStatus(run2.id, RunStatus.Running, RunStatus.Completed, {
      completed_at: nowIso, final_message: JSON.stringify(n2FindingsPayload),
    }).success).toBe(true);

    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Running, NodeRunStatus.Completed);
    const n1ResultEvent = threadEventService.write(
      "thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, n1FindingsPayload,
    );
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: n1ResultEvent.id });

    const synthAfterN1 = nodeRunRepo.getById(n3.id)!;
    expect(synthAfterN1.status).toBe(NodeRunStatus.Pending);
    expect(synthAfterN1.join_satisfied_at).toBeNull();

    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Running, NodeRunStatus.Completed);
    const n2ResultEvent = threadEventService.write(
      "thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, n2FindingsPayload,
    );
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: n2ResultEvent.id });

    const deps: GraphWorkflowDeps = {
      graphRunRepo, nodeRunRepo, runRepo, issueRepo,
      threadEventService, threadEventRepo,
      adapterDeps: { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      db,
    };

    const graphRunFresh = graphRunRepo.getById(graphRun.id)!;
    const pendingEvents: Parameters<typeof evaluateJoinAndTrigger>[3] = [];
    const producedEvents = evaluateJoinAndTrigger(deps, graphRunFresh, nodeRunRepo.getById(n2.id)!, pendingEvents);

    const synthFinal = nodeRunRepo.getById(n3.id)!;
    expect(synthFinal.status).toBe(NodeRunStatus.Ready);
    expect(synthFinal.join_satisfied_at).not.toBeNull();

    const synthRuns = runRepo.listByIssue("iss_1").filter((r) => r.node_run_id === n3.id);
    expect(synthRuns.length).toBe(1);
    expect(synthRuns[0].status).toBe(RunStatus.Queued);
    expect(synthRuns[0].role).toBe(RunRole.GraphNode);
    expect(synthRuns[0].purpose).toBe(RunPurpose.WorkflowBound);

    expect(producedEvents).not.toBeNull();
    expect(producedEvents!.length).toBe(4);

    const graphRunFinal = graphRunRepo.getById(graphRun.id)!;
    expect(graphRunFinal.status).toBe(GraphRunStatus.Running);
    expect(graphRunFinal.blocked_reason_code).toBeNull();

    const joinEvents = threadEventRepo.listByThreadAndTypes("thr_1", [ThreadEventType.GraphJoinSatisfied]);
    expect(joinEvents.length).toBe(1);
    expect(joinEvents[0].payload_json).toMatchObject({
      to_node_key: "synthesize_findings",
      satisfied_by: expect.arrayContaining(["review_concurrency", "review_contract"]),
      join_policy: "all_required",
    });

    const edgeEvents = threadEventRepo.listByThreadAndTypes("thr_1", [ThreadEventType.GraphEdgeTraversed]);
    expect(edgeEvents.length).toBe(2);
    const traversedPairs = edgeEvents.map((e) => `${e.payload_json.from_node_key}->${e.payload_json.to_node_key}`);
    expect(traversedPairs).toEqual(
      expect.arrayContaining(["review_concurrency->synthesize_findings", "review_contract->synthesize_findings"]),
    );
    expect(edgeEvents.every((e) => e.payload_json.outcome === "completed")).toBe(true);
    expect(edgeEvents.every((e) => e.payload_json.decided_by === "deterministic_join")).toBe(true);

    const queuedEvents = threadEventRepo.listByThreadAndTypes("thr_1", [ThreadEventType.GraphNodeQueued]);
    expect(queuedEvents.length).toBe(1);
    expect(queuedEvents[0].payload_json).toMatchObject({
      graph_run_id: graphRun.id,
      node_key: "synthesize_findings",
      run_id: synthRuns[0].id,
      attempt_index: 0,
    });

    const resultEvents = threadEventRepo.listByThreadAndTypes("thr_1", [ThreadEventType.GraphNodeResult]);
    expect(resultEvents.length).toBe(2);
    expect(resultEvents.map((e) => e.payload_json.node_key)).toEqual(
      expect.arrayContaining(["review_concurrency", "review_contract"]),
    );
  });
});
