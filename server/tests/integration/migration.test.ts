import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { SCHEMA_V1 } from "../../src/db/schema-v1.js";
import { SCHEMA_V2 } from "../../src/db/schema-v2.js";
import { SCHEMA_V3 } from "../../src/db/schema-v3.js";
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

  function setupV3Db(): string {
    const now = "2026-01-01T00:00:00Z";
    db.exec(SCHEMA_V1);
    db.exec(SCHEMA_V2);
    db.exec(SCHEMA_V3);
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(1, now);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(2, now);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(3, now);
    return now;
  }

  it("creates schema_version table", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(5);
  });

  it("is idempotent - running twice does not error", () => {
    applyMigrations(db);
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(5);
  });

  it("creates all 12 tables", () => {
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
    expect(tableNames).toContain("evidence_summaries");
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

  it("v4 creates evidence_summaries table", () => {
    applyMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_summaries'",
    ).all() as { name: string }[];
    expect(tables).toHaveLength(1);
  });

  it("v4 adds role column to runs with default implementation", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "role")).toBe(true);
  });

  it("v4 adds workflow_step, validation_round, dispatch_source, final_message, adapter_identity_json to runs", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("workflow_step");
    expect(colNames).toContain("validation_round");
    expect(colNames).toContain("dispatch_source");
    expect(colNames).toContain("final_message");
    expect(colNames).toContain("adapter_identity_json");
  });

  it("v4 adds blocked_reason_code and blocked_reason_message to issues", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("blocked_reason_code");
    expect(colNames).toContain("blocked_reason_message");
  });

  it("v4 creates active validator partial unique index", () => {
    applyMigrations(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_runs_one_active_validator'",
    ).all() as { name: string }[];
    expect(indexes).toHaveLength(1);
  });

  it("v4 creates runs issue_role_created index", () => {
    applyMigrations(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_runs_issue_role_created'",
    ).all() as { name: string }[];
    expect(indexes).toHaveLength(1);
  });

  it("v3 to v4 upgrade gives old runs default role and dispatch_source", () => {
    const now = setupV3Db();

    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_t", "T", now, now);
    db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_t", "prj_t", "/tmp", "/tmp", "idle", now, now);
    db.prepare("INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agc_t", "prj_t", "Fake", "implementation", "fake", "fake", "[]", "[]", "available", now, now);
    db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_t", "prj_t", "wsp_t", "coding", "wft_coding_default", "vpl_coding_default", "T", "Inbox", "normal", "[]", 0, now, now);
    db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_t", "iss_t", "primary", "T", now, now);
    db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("run_t", "iss_t", "thr_t", "wsp_t", "agc_t", "completed", "do", now, now);

    applyMigrations(db);

    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get("run_t") as Record<string, unknown>;
    expect(run.role).toBe("implementation");
    expect(run.dispatch_source).toBe("user_explicit");
    expect(run.workflow_step).toBeNull();
    expect(run.validation_round).toBeNull();
    expect(run.adapter_identity_json).toBeNull();
    expect(run.final_message).toBeNull();
  });

  it("v3 to v4 upgrade preserves existing issue data", () => {
    const now = setupV3Db();
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_t2", "T2", now, now);
    db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_t2", "prj_t2", "/tmp2", "/tmp2", "idle", now, now);
    db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, goal, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_t2", "prj_t2", "wsp_t2", "coding", "wft_coding_default", "vpl_coding_default", "Title", "Goal", "Running", "high", "[\"bug\"]", 2, now, now);

    applyMigrations(db);

    const issue = db.prepare("SELECT * FROM issues WHERE id = ?").get("iss_t2") as Record<string, unknown>;
    expect(issue.title).toBe("Title");
    expect(issue.goal).toBe("Goal");
    expect(issue.status).toBe("Running");
    expect(issue.priority).toBe("high");
    expect(issue.validation_round_count).toBe(2);
    expect(issue.blocked_reason_code).toBeNull();
    expect(issue.blocked_reason_message).toBeNull();
  });

  it("v4 seed updates steps_json with schema_version and steps", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT steps_json FROM workflow_templates WHERE id = ?").get("wft_coding_default") as { steps_json: string };
    const parsed = JSON.parse(row.steps_json);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.steps).toEqual([
      { id: "implementation", role: "implementation" },
      { id: "validation", role: "validator" },
    ]);
  });

  it("v4 seed updates evidence_requirements_json with schema_version and requirements", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT evidence_requirements_json FROM validation_policies WHERE id = ?").get("vpl_coding_default") as { evidence_requirements_json: string };
    const parsed = JSON.parse(row.evidence_requirements_json);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.require_handoff).toBe(true);
    expect(parsed.require_file_trace).toBe(true);
    expect(parsed.require_verification).toBe(true);
    expect(parsed.accepted_verification_kinds).toEqual(["test", "lint", "typecheck", "build"]);
  });

  it("v4 seed does not overwrite custom steps_json", () => {
    const now = setupV3Db();
    const customSteps = JSON.stringify({ schema_version: 1, steps: [{ id: "custom", role: "implementation" }] });
    db.prepare("UPDATE workflow_templates SET steps_json = ? WHERE id = ?").run(customSteps, "wft_coding_default");

    applyMigrations(db);

    const row = db.prepare("SELECT steps_json FROM workflow_templates WHERE id = ?").get("wft_coding_default") as { steps_json: string };
    expect(row.steps_json).toBe(customSteps);
  });

  it("v4 seed does not overwrite custom evidence_requirements_json", () => {
    const now = "2026-01-01T00:00:00Z";
    db.exec(SCHEMA_V1);
    db.exec(SCHEMA_V2);
    db.exec(SCHEMA_V3);
    db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(1, now);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(2, now);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(3, now);
    const customReq = JSON.stringify({ schema_version: 1, require_handoff: false, require_file_trace: false, require_verification: false, accepted_verification_kinds: [] });
    db.prepare("UPDATE validation_policies SET evidence_requirements_json = ? WHERE id = ?").run(customReq, "vpl_coding_default");

    applyMigrations(db);

    const row = db.prepare("SELECT evidence_requirements_json FROM validation_policies WHERE id = ?").get("vpl_coding_default") as { evidence_requirements_json: string };
    expect(row.evidence_requirements_json).toBe(customReq);
  });

  it("v4 evidence_summaries has correct columns", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(evidence_summaries)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("issue_id");
    expect(colNames).toContain("thread_id");
    expect(colNames).toContain("validator_run_id");
    expect(colNames).toContain("implementation_run_id");
    expect(colNames).toContain("validation_result");
    expect(colNames).toContain("evidence_refs");
    expect(colNames).toContain("summary_markdown");
    expect(colNames).toContain("same_origin_validation");
    expect(colNames).toContain("implementation_identity_json");
    expect(colNames).toContain("validator_identity_json");
    expect(colNames).toContain("policy_id");
    expect(colNames).toContain("policy_version");
    expect(colNames).toContain("policy_snapshot_json");
    expect(colNames).toContain("policy_snapshot_hash");
    expect(colNames).toContain("created_at");
  });

  it("v4 active validator unique index prevents duplicate queued validators", () => {
    const now = "2026-01-01T00:00:00Z";
    applyMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_u", "U", now, now);
    db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_u", "prj_u", "/tmp", "/tmp", "idle", now, now);
    db.prepare("INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("agc_u", "prj_u", "Fake", "implementation", "fake", "fake", "[]", "[]", "available", now, now);
    db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_u", "prj_u", "wsp_u", "coding", "wft_coding_default", "vpl_coding_default", "U", "Validating", "normal", "[]", 0, now, now);
    db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_u", "iss_u", "primary", "U", now, now);
    db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("run_v1", "iss_u", "thr_u", "wsp_u", "agc_u", "queued", "validate", "validator", "system", now, now);

    expect(() =>
      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("run_v2", "iss_u", "thr_u", "wsp_u", "agc_u", "running", "validate", "validator", "system", now, now),
    ).toThrow();
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

  it("WorkflowTemplateRepository.getById returns default template", () => {
    const template = services.workflowTemplateRepo.getById("wft_coding_default");
    expect(template).not.toBeNull();
    expect(template!.id).toBe("wft_coding_default");
  });

  it("WorkflowTemplateRepository.getById returns null for unknown id", () => {
    const template = services.workflowTemplateRepo.getById("wft_nonexistent");
    expect(template).toBeNull();
  });

  it("ValidationPolicyRepository.getById returns default policy", () => {
    const policy = services.validationPolicyRepo.getById("vpl_coding_default");
    expect(policy).not.toBeNull();
    expect(policy!.id).toBe("vpl_coding_default");
  });

  it("ValidationPolicyRepository.getById returns null for unknown id", () => {
    const policy = services.validationPolicyRepo.getById("vpl_nonexistent");
    expect(policy).toBeNull();
  });

  it("default workflow template has v4 seed steps_json", () => {
    const template = services.workflowTemplateRepo.getDefault();
    expect(template).not.toBeNull();
    expect(template!.steps_json).not.toBeNull();
    const parsed = JSON.parse(template!.steps_json!);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.steps).toHaveLength(2);
  });

  it("default validation policy has v4 seed evidence_requirements_json", () => {
    const policy = services.validationPolicyRepo.getDefault();
    expect(policy).not.toBeNull();
    expect(policy!.evidence_requirements_json).not.toBeNull();
    const parsed = JSON.parse(policy!.evidence_requirements_json!);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.accepted_verification_kinds).toEqual(["test", "lint", "typecheck", "build"]);
  });
});
