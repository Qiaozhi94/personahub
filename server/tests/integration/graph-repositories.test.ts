import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { RunRepository } from "../../src/repositories/run.js";
import { RunRole, GraphRunStatus, NodeRunStatus, RunStatus } from "@personahub/shared/types";

// T014: GraphRun / NodeRun / Run repository CRUD, CAS, and snapshot mapping.
// Covers: create, getById, list, compareAndSetStatus, target_files parsing,
// node_run_id round-trip, foreign key enforcement.

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_1", "test", "coding", "single", "active", 1, now, now);
  db.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_1", "iss_1", "primary", "test", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agt_1", "prj_1", "test", "codex", "codex", "[]", '["implementation"]', "available", now, now);
  return now;
}

describe("GraphRunRepository", () => {
  let db: Database.Database;
  let repo: GraphRunRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
    repo = new GraphRunRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a graph run and reads it back", () => {
    const gr = repo.create({
      issue_id: "iss_1",
      thread_id: "thr_1",
      workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review",
      definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/a.ts", "src/b.ts"],
      target_files_hash: "abc123",
    });

    expect(gr.id).toBeDefined();
    expect(gr.issue_id).toBe("iss_1");
    expect(gr.status).toBe(GraphRunStatus.Running);
    expect(gr.target_files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(gr.target_files_truncated).toBe(false);
    expect(gr.target_files_dropped_count).toBe(0);
    expect(gr.blocked_reason_code).toBeNull();
    expect(gr.blocked_node_keys).toEqual([]);
  });

  it("getById returns null for unknown id", () => {
    expect(repo.getById("nonexistent")).toBeNull();
  });

  it("getByIssueId returns a graph run for the issue", () => {
    const gr = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Completed,
      target_files: ["test.ts"], target_files_hash: "h1",
    });

    const found = repo.getByIssueId("iss_1");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(gr.id);
  });

  it("getNonTerminalByIssueId returns only non-terminal graph", () => {
    repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Completed,
      target_files: ["test.ts"], target_files_hash: "h1",
    });
    const running = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["test.ts"], target_files_hash: "h2",
    });

    const nonTerminal = repo.getNonTerminalByIssueId("iss_1");
    expect(nonTerminal).not.toBeNull();
    expect(nonTerminal!.id).toBe(running.id);
  });

  it("listNonTerminal returns only running/blocked/cancelling graphs", () => {
    repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Completed,
      target_files: ["test.ts"], target_files_hash: "h1",
    });
    const blocked = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Blocked,
      target_files: ["test.ts"], target_files_hash: "h2",
    });

    const list = repo.listNonTerminal();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(blocked.id);
  });

  it("compareAndSetStatus succeeds when expected status matches", () => {
    const gr = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["test.ts"], target_files_hash: "h1",
    });

    const result = repo.compareAndSetStatus(gr.id, GraphRunStatus.Running, GraphRunStatus.Completed);
    expect(result.success).toBe(true);
    expect(result.graphRun!.status).toBe(GraphRunStatus.Completed);
  });

  it("compareAndSetStatus fails when expected status does not match", () => {
    const gr = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["test.ts"], target_files_hash: "h1",
    });

    const result = repo.compareAndSetStatus(gr.id, GraphRunStatus.Blocked, GraphRunStatus.Completed);
    expect(result.success).toBe(false);
    expect(result.graphRun).toBeNull();
  });

  it("compareAndSetStatus can set blocker fields", () => {
    const gr = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["test.ts"], target_files_hash: "h1",
    });

    const result = repo.compareAndSetStatus(
      gr.id, GraphRunStatus.Running, GraphRunStatus.Blocked,
      { blocked_reason_code: "node_run_failed" as never, blocked_node_keys: ["n1"] },
    );
    expect(result.success).toBe(true);
    expect(result.graphRun!.blocked_reason_code).toBe("node_run_failed");
    expect(result.graphRun!.blocked_node_keys).toEqual(["n1"]);
  });

  it("target_files parses JSON correctly", () => {
    const gr = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["src/a.ts", "src/b.ts"],
      target_files_hash: "h1",
    });

    const fetched = repo.getById(gr.id)!;
    expect(fetched.target_files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("target_files_truncated is parsed as boolean", () => {
    const gr = repo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["a.ts"], target_files_hash: "h1",
      target_files_truncated: true, target_files_dropped_count: 3,
    });

    expect(gr.target_files_truncated).toBe(true);
    expect(gr.target_files_dropped_count).toBe(3);
  });

it("rejects empty target_files array", () => {
    expect(() => {
      repo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        definition_id: "def_1", definition_version: 1,
        status: GraphRunStatus.Running,
        target_files: [], target_files_hash: "h1",
      });
    }).toThrow("target_files must not be empty");
  });
});

describe("NodeRunRepository", () => {
  let db: Database.Database;
  let graphRepo: GraphRunRepository;
  let nodeRepo: NodeRunRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
    graphRepo = new GraphRunRepository(db);
    nodeRepo = new NodeRunRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function createGraph() {
    return graphRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["test.ts"], target_files_hash: "h1",
    });
  }

  it("creates a node run and reads it back", () => {
    const gr = createGraph();
    const nr = nodeRepo.create({
      graph_run_id: gr.id,
      node_key: "review_concurrency",
      status: NodeRunStatus.Pending,
      assigned_adapter_config_id: "agt_1",
    });

    expect(nr.id).toBeDefined();
    expect(nr.graph_run_id).toBe(gr.id);
    expect(nr.node_key).toBe("review_concurrency");
    expect(nr.status).toBe(NodeRunStatus.Pending);
    expect(nr.assigned_adapter_config_id).toBe("agt_1");
    expect(nr.join_satisfied_at).toBeNull();
    expect(nr.result_event_id).toBeNull();
  });

  it("listByGraphRun returns all nodes for a graph", () => {
    const gr = createGraph();
    nodeRepo.create({ graph_run_id: gr.id, node_key: "n1", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });
    nodeRepo.create({ graph_run_id: gr.id, node_key: "n2", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });

    const list = nodeRepo.listByGraphRun(gr.id);
    expect(list).toHaveLength(2);
    expect(list.map((n) => n.node_key).sort()).toEqual(["n1", "n2"]);
  });

  it("getByGraphRunAndKey finds the right node", () => {
    const gr = createGraph();
    nodeRepo.create({ graph_run_id: gr.id, node_key: "n1", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });
    nodeRepo.create({ graph_run_id: gr.id, node_key: "n2", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });

    const found = nodeRepo.getByGraphRunAndKey(gr.id, "n2");
    expect(found).not.toBeNull();
    expect(found!.node_key).toBe("n2");
  });

  it("compareAndSetStatus succeeds on matching expected status", () => {
    const gr = createGraph();
    const nr = nodeRepo.create({ graph_run_id: gr.id, node_key: "n1", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });

    const result = nodeRepo.compareAndSetStatus(nr.id, NodeRunStatus.Pending, NodeRunStatus.Ready);
    expect(result.success).toBe(true);
    expect(result.nodeRun!.status).toBe(NodeRunStatus.Ready);
  });

  it("compareAndSetStatus fails on wrong expected status", () => {
    const gr = createGraph();
    const nr = nodeRepo.create({ graph_run_id: gr.id, node_key: "n1", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });

    const result = nodeRepo.compareAndSetStatus(nr.id, NodeRunStatus.Running, NodeRunStatus.Ready);
    expect(result.success).toBe(false);
  });

  it("compareAndSetStatus can set join_satisfied_at", () => {
    const gr = createGraph();
    const nr = nodeRepo.create({ graph_run_id: gr.id, node_key: "n1", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });

    const result = nodeRepo.compareAndSetStatus(
      nr.id, NodeRunStatus.Pending, NodeRunStatus.Ready,
      { join_satisfied_at: "2026-01-02T00:00:00Z" },
    );
    expect(result.success).toBe(true);
    expect(result.nodeRun!.join_satisfied_at).toBe("2026-01-02T00:00:00Z");
  });

  it("hasAnyReference detects adapter references", () => {
    const gr = createGraph();
    nodeRepo.create({ graph_run_id: gr.id, node_key: "n1", status: NodeRunStatus.Pending, assigned_adapter_config_id: "agt_1" });

    expect(nodeRepo.hasAnyReference("agt_1")).toBe(true);
    expect(nodeRepo.hasAnyReference("nonexistent")).toBe(false);
  });
});

describe("RunRepository node_run_id", () => {
  let db: Database.Database;
  let runRepo: RunRepository;
  let graphRepo: GraphRunRepository;
  let nodeRepo: NodeRunRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
    runRepo = new RunRepository(db);
    graphRepo = new GraphRunRepository(db);
    nodeRepo = new NodeRunRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function createNodeRunForTest(): string {
    const gr = graphRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "def_1", definition_version: 1,
      status: GraphRunStatus.Running,
      target_files: ["test.ts"], target_files_hash: "h1",
    });
    const nr = nodeRepo.create({
      graph_run_id: gr.id, node_key: "n1",
      status: NodeRunStatus.Pending,
      assigned_adapter_config_id: "agt_1",
    });
    return nr.id;
  }

  it("creates a run with node_run_id and reads it back", () => {
    const nodeRunId = createNodeRunForTest();
    const run = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });

    expect(run.node_run_id).toBe(nodeRunId);
    expect(run.role).toBe(RunRole.GraphNode);
  });

  it("creates a non-graph run with null node_run_id", () => {
    const run = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
    });

    expect(run.node_run_id).toBeNull();
    expect(run.role).toBe(RunRole.Implementation);
  });

  it("throws when GraphNode role is set without node_run_id", () => {
    expect(() => {
      runRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
        role: RunRole.GraphNode,
      });
    }).toThrow("Invariant violation");
  });

  it("throws when node_run_id is set without GraphNode role", () => {
    expect(() => {
      runRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
        node_run_id: "nr_1",
      });
    }).toThrow("Invariant violation");
  });

  it("GraphNode workflow_step is null", () => {
    const nodeRunId = createNodeRunForTest();
    const run = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });

    expect(run.workflow_step).toBeNull();
  });
});