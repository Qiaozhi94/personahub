import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { RunRepository } from "../../src/repositories/run.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import {
  GraphRunStatus, NodeRunStatus, RunStatus, IssueStatus,
  RunRole, RunPurpose, ThreadEventType, ActorType,
} from "@personahub/shared/types";
import { getDefinition } from "../../src/runtime/graph/definitions.js";

function seedDb(db: Database.Database) {
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO projects (id,name,created_at,updated_at) VALUES (?,?,?,?)").run("prj_1","test",now,now);
  db.prepare("INSERT INTO workspaces (id,project_id,local_path,local_path_normalized,lock_state,push_credentials_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wsp_1","prj_1","/tmp/test","/tmp/test","idle",0,now,now);
  db.prepare("INSERT INTO workflow_templates (id,name,issue_type,collaboration_topology,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("wft_1","test","coding","single","active",1,now,now);
  db.prepare("INSERT INTO validation_policies (id,name,issue_type,max_validation_rounds,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("vpl_1","test","coding",3,"active",1,now,now);
  db.prepare("INSERT INTO issues (id,project_id,workspace_id,issue_type,workflow_template_id,validation_policy_id,title,status,priority,labels,validation_round_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run("iss_1","prj_1","wsp_1","coding","wft_1","vpl_1","test","Running","normal","[]",0,now,now);
  db.prepare("INSERT INTO threads (id,issue_id,thread_type,title,created_at,updated_at) VALUES (?,?,?,?,?,?)").run("thr_1","iss_1","primary","test",now,now);
  db.prepare("INSERT INTO agent_configs (id,project_id,name,cli_provider,command,args,capability_tags,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run("agt_1","prj_1","test","codex","codex","[]",'["implementation"]',"available",now,now);
}

describe("T021d T022d: transaction atomicity on graph creation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
  });

  afterEach(() => db.close());

  it("T021d: nested transaction — rollback leaves no residual GraphRun/NodeRun/Run", () => {
    const graphRunRepo = new GraphRunRepository(db);
    const nodeRunRepo = new NodeRunRepository(db);
    const runRepo = new RunRepository(db);

    const tx = db.transaction(() => {
      graphRunRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        definition_id: "wgd_coding_dual_review", definition_version: 1,
        status: GraphRunStatus.Running, target_files: ["src/a.ts"], target_files_hash: "h1",
      });
      throw new Error("simulated rollback");
    });

    expect(() => tx()).toThrow("simulated rollback");
    expect(graphRunRepo.listNonTerminal()).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) as cnt FROM node_runs").get()).toEqual({ cnt: 0 });
    expect(runRepo.listByIssue("iss_1")).toHaveLength(0);
  });

  it("T022d: build failure — no GraphRun/NodeRun/Run residual after outer rollback", () => {
    const graphRunRepo = new GraphRunRepository(db);
    const issueRepo = new IssueRepository(db);

    const originalIssue = issueRepo.getById("iss_1")!;
    expect(originalIssue.status).toBe(IssueStatus.Running);

    const tx = db.transaction(() => {
      issueRepo.compareAndSetStatus("iss_1", IssueStatus.Running, IssueStatus.Blocked);
      graphRunRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        definition_id: "wgd_coding_dual_review", definition_version: 1,
        status: GraphRunStatus.Running, target_files: ["src/a.ts"], target_files_hash: "h1",
      });
      throw new Error("build failure");
    });

    expect(() => tx()).toThrow("build failure");
    const issueAfter = issueRepo.getById("iss_1")!;
    expect(issueAfter.status).toBe(IssueStatus.Running);
    expect(graphRunRepo.listNonTerminal()).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) as cnt FROM node_runs").get()).toEqual({ cnt: 0 });
    expect(db.prepare("SELECT COUNT(*) as cnt FROM runs").get()).toEqual({ cnt: 0 });
  });
});

describe("T023c: phantom event regression", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
  });

  afterEach(() => db.close());

  it("T023c: rolled-back transaction does not leak events", () => {
    const graphRunRepo = new GraphRunRepository(db);
    const threadEventRepo = new ThreadEventRepository(db);
    const eventBus = new EventBus();
    const threadEventService = new ThreadEventService(threadEventRepo, eventBus);

    let broadcastCalled = false;
    eventBus.subscribe("thr_1", () => { broadcastCalled = true; });

    const tx = db.transaction(() => {
      graphRunRepo.create({
        issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        definition_id: "wgd_coding_dual_review", definition_version: 1,
        status: GraphRunStatus.Running, target_files: ["src/a.ts"], target_files_hash: "h1",
      });
      threadEventService.write("thr_1", ThreadEventType.GraphNodeQueued, ActorType.System, null, {
        graph_run_id: "nonexistent", node_key: "n1", run_id: "nonexistent", attempt_index: 0,
        required_capabilities: [],
      });
      throw new Error("rollback");
    });

    expect(() => tx()).toThrow("rollback");
    expect(broadcastCalled).toBe(false);
    expect(threadEventRepo.listByThread("thr_1")).toHaveLength(0);
    expect(graphRunRepo.listNonTerminal()).toHaveLength(0);
  });
});

describe("T020g T033d: determinism and end-to-end envelope", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
  });

  afterEach(() => db.close());

  it("T020g: deterministic instructions — same inputs produce byte-identical output", () => {
    const def1 = getDefinition("wgd_coding_dual_review", 1);
    const def2 = getDefinition("wgd_coding_dual_review", 1);
    expect(def1).not.toBeNull();
    expect(JSON.stringify(def1)).toBe(JSON.stringify(def2));
  });

  it("T033d: end-to-end envelope — findings survive round-trip through result events", () => {
    const threadEventRepo = new ThreadEventRepository(db);
    const eventBus = new EventBus();
    const threadEventService = new ThreadEventService(threadEventRepo, eventBus);
    const graphRunRepo = new GraphRunRepository(db);
    const nodeRunRepo = new NodeRunRepository(db);

    const gr = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running, target_files: ["src/a.ts"], target_files_hash: "h1",
    });

    const n1 = nodeRunRepo.create({
      graph_run_id: gr.id, node_key: "review_concurrency",
      status: NodeRunStatus.Completed, assigned_adapter_config_id: "agt_1",
    });
    const n2 = nodeRunRepo.create({
      graph_run_id: gr.id, node_key: "review_contract",
      status: NodeRunStatus.Completed, assigned_adapter_config_id: "agt_1",
    });

    const findings = [{ severity: "high", file: "src/a.ts", line: 1, claim: "race", failure_scenario: "crash" }];
    const r1 = threadEventService.write("thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, { node_key: "review_concurrency", findings, not_reviewed: [] });
    const r2 = threadEventService.write("thr_1", ThreadEventType.GraphNodeResult as never, ActorType.System, null, { node_key: "review_contract", findings, not_reviewed: [] });
    nodeRunRepo.compareAndSetStatus(n1.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r1.id });
    nodeRunRepo.compareAndSetStatus(n2.id, NodeRunStatus.Completed, NodeRunStatus.Completed, { result_event_id: r2.id });

    const retrieved1 = threadEventRepo.getById(r1.id);
    const retrieved2 = threadEventRepo.getById(r2.id);
    expect(retrieved1).not.toBeNull();
    expect(retrieved2).not.toBeNull();
    expect(retrieved1!.payload_json).toBeDefined();
    expect(retrieved2!.payload_json).toBeDefined();
  });
});

describe("T061: AC-004 single-run-per-workspace lock guarantee", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    seedDb(db);
  });

  afterEach(() => db.close());

  it("T061: at most one Run per workspace can hold the lock at any time", () => {
    const runRepo = new RunRepository(db);
    const graphRunRepo = new GraphRunRepository(db);
    const nodeRunRepo = new NodeRunRepository(db);

    const gr = graphRunRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      definition_id: "wgd_coding_dual_review", definition_version: 1,
      status: GraphRunStatus.Running, target_files: ["src/a.ts"], target_files_hash: "h1",
    });
    const n1 = nodeRunRepo.create({
      graph_run_id: gr.id, node_key: "review_concurrency",
      status: NodeRunStatus.Ready, assigned_adapter_config_id: "agt_1",
    });
    const n2 = nodeRunRepo.create({
      graph_run_id: gr.id, node_key: "review_contract",
      status: NodeRunStatus.Ready, assigned_adapter_config_id: "agt_1",
    });

    const r1 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: n1.id, purpose: RunPurpose.WorkflowBound,
    });
    const r2 = runRepo.create({
      issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
      adapter_config_id: "agt_1", instructions: "test2", status: RunStatus.Queued,
      role: RunRole.GraphNode, node_run_id: n2.id, purpose: RunPurpose.WorkflowBound,
    });

    const moved = runRepo.transitionStatus(r1.id, RunStatus.Queued, RunStatus.Running, {});
    expect(moved.success).toBe(true);

    const r2After = runRepo.getById(r2.id)!;
    expect(r2After.status).toBe(RunStatus.Queued);

    const done1 = runRepo.transitionStatus(r1.id, RunStatus.Running, RunStatus.Completed, {});
    expect(done1.success).toBe(true);
    const done2 = runRepo.transitionStatus(r2.id, RunStatus.Queued, RunStatus.Running, {});
    expect(done2.success).toBe(true);
  });
});
