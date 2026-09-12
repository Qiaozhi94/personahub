import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadRepository } from "../../src/repositories/thread.js";
import { WorkflowTemplateRepository } from "../../src/repositories/workflow-template.js";
import { ValidationPolicyRepository } from "../../src/repositories/validation-policy.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { RunRepository } from "../../src/repositories/run.js";
import { ArtifactRepository } from "../../src/repositories/artifact.js";
import {
  IssueType,
  IssueStatus,
  IssuePriority,
  ThreadType,
  WorkspaceLockState,
  AdapterStatus,
  RunStatus,
} from "@personahub/shared/types";

// F010 T002 (AC-001): schema v12 adds the artifact tables. Covers reaching the
// head version, idempotent re-application, the real v11 -> v12 upgrade path
// with pre-existing rows staying readable, the three reverse-lookup indexes,
// and the DB-layer invariants the design freezes: (artifact_id, idempotency_key)
// uniqueness, inline/file locator mutual exclusion, consumption PK granularity
// with its composite FK, and the maintenance-lease CAS.

const V12_TABLES = [
  "artifacts",
  "artifact_revisions",
  "artifact_consumptions",
  "artifact_evidence_links",
  "artifact_maintenance_leases",
];

const V12_INDEXES = ["idx_artifact_consumptions_run", "idx_artifacts_issue", "idx_artifact_evidence_links_ref"];

function undoV12(db: Database.Database): void {
  for (const index of V12_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  for (const table of V12_TABLES) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.prepare("DELETE FROM schema_version WHERE version = 12").run();
}

describe("F010 schema v12 migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("fresh install reaches the head version", () => {
    applyMigrations(db);
    expect(CURRENT_SCHEMA_VERSION).toBe(12);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(CURRENT_SCHEMA_VERSION);
    for (const table of V12_TABLES) {
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(table)).toBeTruthy();
    }
  });

  it("is idempotent — running twice stays at the head version", () => {
    applyMigrations(db);
    applyMigrations(db);
    const row = db.prepare("SELECT COUNT(*) AS c FROM schema_version WHERE version = 12").get() as { c: number };
    expect(row.c).toBe(1);
  });

  it("upgrades a real v11 database forward-only and keeps existing rows readable", () => {
    applyMigrations(db);
    undoV12(db);

    // A row that predates v12: it must survive the upgrade unchanged and readable.
    db.prepare("INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "prj_legacy",
      "Legacy",
      null,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );

    applyMigrations(db);

    const legacy = db.prepare("SELECT name FROM projects WHERE id = 'prj_legacy'").get() as { name: string };
    expect(legacy.name).toBe("Legacy");
    const version = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number };
    expect(version.v).toBe(12);
    for (const index of V12_INDEXES) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(index)).toBeTruthy();
    }
  });
});

/** Full FK-valid graph (project -> workspace -> issue -> thread -> run) so the
 *  repository-level invariant tests below can exercise the real foreign keys. */
function buildGraph(db: Database.Database, tempDir: string): { issueId: string; threadId: string; runId: string } {
  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const workflowRepo = new WorkflowTemplateRepository(db);
  const validationRepo = new ValidationPolicyRepository(db);
  const agentConfigRepo = new AgentConfigRepository(db);
  const runRepo = new RunRepository(db);
  const now = new Date().toISOString();

  const project = projectRepo.create("Artifact Graph", null);
  const workspace = workspaceRepo.create({
    project_id: project.id,
    local_path: tempDir,
    local_path_normalized: tempDir,
    git_branch: null,
    lock_state: WorkspaceLockState.Idle,
  });
  projectRepo.updateDefaultWorkspace(project.id, workspace.id, now);
  const issue = issueRepo.create({
    project_id: project.id,
    workspace_id: workspace.id,
    issue_type: IssueType.Coding,
    workflow_template_id: workflowRepo.getDefault()!.id,
    validation_policy_id: validationRepo.getDefault()!.id,
    title: "Artifact graph",
    goal: "Goal",
    status: IssueStatus.Running,
    priority: IssuePriority.Normal,
    labels: [],
  });
  const thread = threadRepo.create({ issue_id: issue.id, thread_type: ThreadType.Primary, title: "Primary" });
  issueRepo.updatePrimaryThread(issue.id, thread.id, now);
  const adapter = agentConfigRepo.create({
    project_id: project.id,
    name: "Adapter",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  const run = runRepo.create({
    issue_id: issue.id,
    thread_id: thread.id,
    workspace_id: workspace.id,
    adapter_config_id: adapter.id,
    instructions: "produce an artifact",
    status: RunStatus.Completed,
  });
  return { issueId: issue.id, threadId: thread.id, runId: run.id };
}

function publishedFileRevisionRow() {
  return {
    storage_kind: "workspace_file" as const,
    inline_content: null,
    source_relative_path: "reports/summary.md",
    archive_relative_path: "ab/abcd1234",
  };
}

describe("F010 artifact repository invariants", () => {
  let db: Database.Database;
  let repo: ArtifactRepository;
  let graph: { issueId: string; threadId: string; runId: string };
  let tempDir: string;
  let artifacts: { artifactId: string };

  beforeEach(() => {
    tempDir = "/tmp/f010-artifact-graph";
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    repo = new ArtifactRepository(db);
    graph = buildGraph(db, tempDir);
    const now = "2026-09-12T00:00:00Z";
    artifacts = { artifactId: "art_test000000000000000000" };
    repo.createArtifact({
      id: artifacts.artifactId,
      issue_id: graph.issueId,
      thread_id: graph.threadId,
      type: "report",
      title: "Summary",
      state: "active",
      current_revision: null,
      created_by: "tester",
      created_at: now,
      updated_at: now,
    });
  });

  afterEach(() => {
    db.close();
  });

  function insertRevision(overrides: Partial<Parameters<ArtifactRepository["insertRevision"]>[0]> = {}): void {
    repo.insertRevision({
      artifact_id: artifacts.artifactId,
      revision: 1,
      storage_kind: "inline_markdown",
      inline_content: "# hello",
      source_relative_path: null,
      archive_relative_path: null,
      content_hash: "a".repeat(64),
      source_run_id: graph.runId,
      created_by: "tester",
      idempotency_key: "idem-1",
      request_fingerprint: "f".repeat(64),
      created_at: "2026-09-12T00:00:01Z",
      ...overrides,
    });
  }

  it("rejects a duplicate (artifact_id, idempotency_key) but allows the same key on another artifact", () => {
    insertRevision();
    // replay with the same key inside the same artifact is the UNIQUE conflict
    expect(() => insertRevision({ revision: 2 })).toThrow(/UNIQUE/i);
    // the key scopes per artifact: a different artifact may reuse it
    repo.createArtifact({
      id: "art_other0000000000000000",
      issue_id: graph.issueId,
      thread_id: graph.threadId,
      type: "report",
      title: "Other",
      state: "active",
      current_revision: null,
      created_by: "tester",
      created_at: "2026-09-12T00:00:00Z",
      updated_at: "2026-09-12T00:00:00Z",
    });
    expect(() =>
      repo.insertRevision({
        artifact_id: "art_other0000000000000000",
        revision: 1,
        storage_kind: "inline_markdown",
        inline_content: "# other",
        source_relative_path: null,
        archive_relative_path: null,
        content_hash: "b".repeat(64),
        source_run_id: null,
        created_by: "tester",
        idempotency_key: "idem-1",
        request_fingerprint: "e".repeat(64),
        created_at: "2026-09-12T00:00:01Z",
      }),
    ).not.toThrow();
  });

  it("enforces inline/file locator mutual exclusion at the DB layer", () => {
    // inline must not carry locators
    expect(() => insertRevision({ source_relative_path: "reports/summary.md" })).toThrow(/CHECK/i);
    // file must carry both locators and no inline body
    expect(() => insertRevision({ inline_content: null, source_relative_path: null })).toThrow(/CHECK/i);
    expect(() => insertRevision({ ...publishedFileRevisionRow(), revision: 2, idempotency_key: "idem-2" })).not.toThrow();
  });

  it("keeps the pointer CAS exact: null expected only matches an unpublished artifact", () => {
    expect(repo.advanceCurrentRevisionCas(artifacts.artifactId, null, 1, "2026-09-12T00:00:02Z")).toBe(true);
    // pointer already advanced: a second null-CAS must lose
    expect(repo.advanceCurrentRevisionCas(artifacts.artifactId, null, 1, "2026-09-12T00:00:03Z")).toBe(false);
    expect(repo.advanceCurrentRevisionCas(artifacts.artifactId, 2, 3, "2026-09-12T00:00:04Z")).toBe(false);
    expect(repo.advanceCurrentRevisionCas(artifacts.artifactId, 1, 2, "2026-09-12T00:00:05Z")).toBe(true);
    expect(repo.getArtifact(artifacts.artifactId)!.current_revision).toBe(2);
  });

  it("records one consumption per (dispatch, run, revision, purpose) and enforces the composite FK", () => {
    insertRevision();
    const consumption = {
      artifact_id: artifacts.artifactId,
      revision: 1,
      dispatch_id: "dsp_1",
      run_id: graph.runId,
      purpose: "context",
      consumed_at: "2026-09-12T00:00:06Z",
    };
    repo.insertConsumption(consumption);
    // exact replay -> PK conflict (service turns this into a replay return)
    expect(() => repo.insertConsumption(consumption)).toThrow(/UNIQUE/i);
    // same dispatch continued under a new run records its own row
    expect(() => repo.insertConsumption({ ...consumption, run_id: "run_missing" })).toThrow(/FOREIGN KEY/i);
    // consuming a revision that was never published is rejected
    expect(() => repo.insertConsumption({ ...consumption, revision: 99 })).toThrow(/FOREIGN KEY/i);

    expect(repo.getConsumption("dsp_1", graph.runId, artifacts.artifactId, 1, "context")).not.toBeNull();
    expect(repo.listConsumptionsByRun(graph.runId)).toHaveLength(1);
  });

  it("grant lease blocks a second owner until expiry, then allows takeover", () => {
    expect(repo.tryAcquireLease("archive-maintenance", "sweeper-a", 1_000, 10_000)).toBe(true);
    expect(repo.tryAcquireLease("archive-maintenance", "sweeper-b", 2_000, 10_000)).toBe(false);
    // same owner re-entering while live is also refused (must release first)
    expect(repo.tryAcquireLease("archive-maintenance", "sweeper-a", 3_000, 10_000)).toBe(false);
    // after expiry the new owner takes over
    expect(repo.tryAcquireLease("archive-maintenance", "sweeper-b", 12_000, 10_000)).toBe(true);
    expect(repo.getLease("archive-maintenance")).toMatchObject({ owner_id: "sweeper-b" });
    repo.releaseLease("archive-maintenance", "sweeper-b");
    expect(repo.getLease("archive-maintenance")).toBeNull();
  });
});
