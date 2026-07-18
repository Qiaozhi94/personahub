import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";

describe("Database Migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  it("creates schema_version table", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(3);
  });

  it("is idempotent - running twice does not error", () => {
    applyMigrations(db);
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(3);
  });

  it("creates all 11 tables", () => {
    applyMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("workspaces");
    expect(tableNames).toContain("issues");
    expect(tableNames).toContain("threads");
    expect(tableNames).toContain("thread_events");
    expect(tableNames).toContain("workflow_templates");
    expect(tableNames).toContain("validation_policies");
    expect(tableNames).toContain("agent_configs");
    expect(tableNames).toContain("runs");
    expect(tableNames).toContain("run_trace_states");
    expect(tableNames).toContain("run_file_changes");
  });

  it("seeds default coding workflow template", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT * FROM workflow_templates WHERE id = ?").get("wft_coding_default") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("Coding Workflow");
    expect(row.issue_type).toBe("coding");
    expect(row.status).toBe("active");
  });

  it("seeds default coding validation policy", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT * FROM validation_policies WHERE id = ?").get("vpl_coding_default") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("Coding Validation Policy");
    expect(row.issue_type).toBe("coding");
    expect(row.status).toBe("active");
    expect(row.max_validation_rounds).toBe(3);
  });

  it("creates partial unique index for primary threads", () => {
    applyMigrations(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_threads_primary_unique'",
    ).all() as { name: string }[];
    expect(indexes).toHaveLength(1);
  });

  it("creates index on thread_events(thread_id, event_sequence)", () => {
    applyMigrations(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_thread_events_thread_seq'",
    ).all() as { name: string }[];
    expect(indexes).toHaveLength(1);
  });

  it("creates unique index on workspaces(project_id, local_path_normalized)", () => {
    applyMigrations(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_workspaces_project_path'",
    ).all() as { name: string }[];
    expect(indexes).toHaveLength(1);
  });

  it("enforces foreign keys", () => {
    applyMigrations(db);
    expect(() =>
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("wsp_test", "prj_nonexistent", "/tmp", "/tmp", "idle", "2026-01-01", "2026-01-01"),
    ).toThrow();
  });

  it("enforces primary thread uniqueness per issue", () => {
    applyMigrations(db);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("prj_test", "Test", now, now);
    db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("wsp_test", "prj_test", "/tmp", "/tmp", "idle", now, now);
    db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("iss_test", "prj_test", "wsp_test", "coding", "wft_coding_default", "vpl_coding_default", "Test", "Inbox", "normal", "[]", 0, now, now);
    db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("thr_1", "iss_test", "primary", "Test", now, now);

    expect(() =>
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("thr_2", "iss_test", "primary", "Test2", now, now),
    ).toThrow();
  });

  it("v3 creates run_trace_states and run_file_changes tables", () => {
    applyMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('run_trace_states', 'run_file_changes') ORDER BY name",
    ).all() as { name: string }[];
    expect(tables).toHaveLength(2);
  });

  it("v3 creates indexes for trace tables", () => {
    applyMigrations(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_run_trace_states_unfinalized', 'idx_run_file_changes_run_id')",
    ).all() as { name: string }[];
    expect(indexes).toHaveLength(2);
  });

  it("v2 to v3 upgrade preserves existing data", () => {
    const services = createTestServices();
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, createTempDir());
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });

    disposeTestServices(services);

    const freshDb = new Database(":memory:");
    freshDb.pragma("foreign_keys = ON");
    applyMigrations(freshDb);
    const tableCount = freshDb.prepare(
      "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='run_trace_states'",
    ).get() as { c: number };
    expect(tableCount.c).toBe(1);
    freshDb.close();
  });
});

describe("Migration with services", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("default workflow template is accessible via repository", () => {
    const template = services.workflowTemplateRepo.getDefault();
    expect(template).not.toBeNull();
    expect(template!.id).toBe("wft_coding_default");
  });

  it("default validation policy is accessible via repository", () => {
    const policy = services.validationPolicyRepo.getDefault();
    expect(policy).not.toBeNull();
    expect(policy!.id).toBe("vpl_coding_default");
  });
});
