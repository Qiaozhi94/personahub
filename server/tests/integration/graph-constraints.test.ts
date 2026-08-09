import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { RunRepository } from "../../src/repositories/run.js";
import { GraphConstraintError } from "../../src/db/sqlite-errors.js";
import { RunRole, GraphRunStatus, NodeRunStatus, RunStatus } from "@personahub/shared/types";

// T016: unique index behavior, role/node_run_id invariant, and error mapping.
// Covers: idx_graph_runs_one_nonterminal_per_issue, idx_runs_one_active_graph_attempt,
// UNIQUE(graph_run_id, node_key), and the error messages from sqlite-errors.ts.

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_1", "test", now, now);
  db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_1", "test", "coding", "single", "inactive", 2, now, now);
  db.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_1", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_2", "prj_1", "wsp_1", "coding", "wft_1", "vpl_1", "test2", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_1", "iss_1", "primary", "test", now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_2", "iss_2", "primary", "test2", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agt_1", "prj_1", "test", "codex", "codex", "[]", '["implementation"]', "available", now, now);
  return now;
}

function createGraphRun(repo: GraphRunRepository, issueId: string, threadId: string, status: GraphRunStatus = GraphRunStatus.Running) {
  return repo.create({
    issue_id: issueId, thread_id: threadId, workspace_id: "wsp_1",
    definition_id: "def_1", definition_version: 1,
    status,
    target_files: ["test.ts"], target_files_hash: "h1",
  });
}

function createNodeRun(repo: NodeRunRepository, graphRunId: string, nodeKey: string, status: NodeRunStatus = NodeRunStatus.Pending) {
  return repo.create({
    graph_run_id: graphRunId, node_key: nodeKey, status,
    assigned_adapter_config_id: "agt_1",
  });
}

describe("idx_graph_runs_one_nonterminal_per_issue", () => {
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

  it("prevents two running graphs for the same issue", () => {
    createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    expect(() => {
      createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    }).toThrow(GraphConstraintError);
  });

  it("prevents running + blocked for the same issue", () => {
    createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    expect(() => {
      createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Blocked);
    }).toThrow(GraphConstraintError);
  });

  it("prevents running + cancelling for the same issue", () => {
    createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    expect(() => {
      createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Cancelling);
    }).toThrow(GraphConstraintError);
  });

  it("allows a new graph after the previous one is completed", () => {
    const gr = createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    repo.compareAndSetStatus(gr.id, GraphRunStatus.Running, GraphRunStatus.Completed);

    const gr2 = createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    expect(gr2.id).toBeDefined();
  });

  it("allows a new graph after the previous one is cancelled", () => {
    const gr = createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    repo.compareAndSetStatus(gr.id, GraphRunStatus.Running, GraphRunStatus.Cancelled);

    const gr2 = createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    expect(gr2.id).toBeDefined();
  });

  it("allows graphs for different issues simultaneously", () => {
    createGraphRun(repo, "iss_1", "thr_1", GraphRunStatus.Running);
    const gr2 = createGraphRun(repo, "iss_2", "thr_2", GraphRunStatus.Running);
    expect(gr2.id).toBeDefined();
  });
});

describe("idx_runs_one_active_graph_attempt", () => {
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

  function createNodeRunId(): string {
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

  it("prevents two active attempts for the same node_run_id", () => {
    const nodeRunId = createNodeRunId();
    runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });

    expect(() => {
      runRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
        role: RunRole.GraphNode, node_run_id: nodeRunId,
      });
    }).toThrow(GraphConstraintError);
  });

  it("prevents queued + running for the same node_run_id", () => {
    const nodeRunId = createNodeRunId();
    runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });

    expect(() => {
      runRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Running,
        role: RunRole.GraphNode, node_run_id: nodeRunId,
      });
    }).toThrow(GraphConstraintError);
  });

  it("allows a new attempt after the previous one is completed", () => {
    const nodeRunId = createNodeRunId();
    const run = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });
    runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Completed, {});

    const run2 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });
    expect(run2.id).toBeDefined();
  });

  it("does not prevent non-graph runs with null node_run_id", () => {
    runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
    });
    runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
    });
    // Should not throw — index only applies when node_run_id IS NOT NULL
  });
});

describe("UNIQUE(graph_run_id, node_key)", () => {
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

  it("prevents duplicate node_key in the same graph", () => {
    const gr = createGraphRun(graphRepo, "iss_1", "thr_1");
    createNodeRun(nodeRepo, gr.id, "n1");
    expect(() => {
      createNodeRun(nodeRepo, gr.id, "n1");
    }).toThrow(GraphConstraintError);
  });

  it("allows same node_key in different graphs", () => {
    const gr1 = createGraphRun(graphRepo, "iss_1", "thr_1");
    createNodeRun(nodeRepo, gr1.id, "n1");

    const gr2 = createGraphRun(graphRepo, "iss_2", "thr_2");
    const nr2 = createNodeRun(nodeRepo, gr2.id, "n1");
    expect(nr2.id).toBeDefined();
  });
});

describe("error mapping does not leak SQLite internals", () => {
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

  function createNodeRunId(): string {
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

  it("active attempt conflict error contains error code, not SQLITE_CONSTRAINT", () => {
    const nodeRunId = createNodeRunId();
    runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: nodeRunId,
    });

    try {
      runRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
        role: RunRole.GraphNode, node_run_id: nodeRunId,
      });
      expect.unreachable("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphConstraintError);
      expect((error as GraphConstraintError).kind).toBe("active_attempt");
      expect((error as Error).message).not.toContain("SQLITE_CONSTRAINT");
    }
  });

  it("non-terminal graph conflict error contains descriptive code", () => {
    const graphRepo = new GraphRunRepository(db);
    createGraphRun(graphRepo, "iss_1", "thr_1", GraphRunStatus.Running);

    try {
      createGraphRun(graphRepo, "iss_1", "thr_1", GraphRunStatus.Running);
      expect.unreachable("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphConstraintError);
      expect((error as GraphConstraintError).kind).toBe("nonterminal_graph");
      expect((error as Error).message).not.toContain("SQLITE_CONSTRAINT");
    }
  });
});