import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { SCHEMA_V1 } from "../../src/db/schema-v1.js";
import { SCHEMA_V2 } from "../../src/db/schema-v2.js";
import { SCHEMA_V3 } from "../../src/db/schema-v3.js";
import { SCHEMA_V4 } from "../../src/db/schema-v4.js";
import { SCHEMA_V5 } from "../../src/db/schema-v5.js";

// T014: v5 -> v6 upgrade for F005 (design.md §4.1). Covers: new columns,
// capability_tags backfill (only for the empty-array state F002/F004 always
// wrote), default_adapter_config_id backfill (only when a Project has exactly
// one available adapter — never "pick the first one"), the two new indexes,
// idempotent re-run, and that pre-existing summaries/data are untouched.

function setupV5Db(db: Database.Database): string {
  const now = "2026-01-01T00:00:00Z";
  db.exec(SCHEMA_V1);
  db.exec(SCHEMA_V2);
  db.exec(SCHEMA_V3);
  db.exec(SCHEMA_V4);
  db.exec(SCHEMA_V5);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (let v = 1; v <= 5; v++) {
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(v, now);
  }
  return now;
}

function insertProject(db: Database.Database, id: string, now: string): void {
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, id, now, now);
}

function insertAdapter(
  db: Database.Database,
  id: string,
  projectId: string,
  now: string,
  overrides: { role?: string; status?: string; capability_tags?: string } = {},
): void {
  db.prepare(
    "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id, projectId, id,
    overrides.role ?? "implementation",
    "codex", "codex", "[]",
    overrides.capability_tags ?? "[]",
    overrides.status ?? "available",
    now, now,
  );
}

describe("T014 schema v6 migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => db.close());

  describe("fresh install reaches the head version", () => {
    it("schema_version max is 8", () => {
      applyMigrations(db);
      const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(row.v).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("is idempotent - running twice does not error and stays at 8", () => {
      applyMigrations(db);
      applyMigrations(db);
      const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(row.v).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  describe("new columns exist", () => {
    it("agent_configs gets auth_type/model_provider/api_key/auth_status_message", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(agent_configs)").all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("auth_type");
      expect(names).toContain("model_provider");
      expect(names).toContain("api_key");
      expect(names).toContain("auth_status_message");
    });

    it("projects gets default_adapter_config_id", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      expect(cols.some((c) => c.name === "default_adapter_config_id")).toBe(true);
    });

    it("runs gets purpose/context_source_run_id", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("purpose");
      expect(names).toContain("context_source_run_id");
    });

    it("issues gets validation_dispatch_due_at", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(issues)").all() as { name: string }[];
      expect(cols.some((c) => c.name === "validation_dispatch_due_at")).toBe(true);
    });
  });

  describe("new indexes exist", () => {
    it("creates idx_issues_validation_due", () => {
      applyMigrations(db);
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_issues_validation_due'").get();
      expect(idx).toBeTruthy();
    });

    it("creates idx_runs_issue_purpose_created", () => {
      applyMigrations(db);
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_runs_issue_purpose_created'").get();
      expect(idx).toBeTruthy();
    });
  });

  describe("v5 -> v6 upgrade preserves and correctly defaults existing rows", () => {
    it("old Codex adapter is interpreted as auth_type=oauth", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_1", now);
      insertAdapter(db, "agc_1", "prj_1", now);

      applyMigrations(db);

      const row = db.prepare("SELECT auth_type FROM agent_configs WHERE id = ?").get("agc_1") as { auth_type: string };
      expect(row.auth_type).toBe("oauth");
    });

    it("old Run defaults to purpose=workflow_bound", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_2", now);
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_2", "prj_2", "/tmp2", "/tmp2", "idle", now, now);
      insertAdapter(db, "agc_2", "prj_2", now);
      db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_2", "prj_2", "wsp_2", "coding", "wft_coding_default", "vpl_coding_default", "T", "Running", "normal", "[]", 0, now, now);
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_2", "iss_2", "primary", "T", now, now);
      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("run_2", "iss_2", "thr_2", "wsp_2", "agc_2", "completed", "do", now, now);

      applyMigrations(db);

      const row = db.prepare("SELECT purpose, context_source_run_id FROM runs WHERE id = ?").get("run_2") as { purpose: string; context_source_run_id: string | null };
      expect(row.purpose).toBe("workflow_bound");
      expect(row.context_source_run_id).toBeNull();
    });

    it("existing evidence_summaries rows are untouched", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_3", now);
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_3", "prj_3", "/tmp3", "/tmp3", "idle", now, now);
      insertAdapter(db, "agc_3", "prj_3", now, { role: "validator" });
      db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_3", "prj_3", "wsp_3", "coding", "wft_coding_default", "vpl_coding_default", "T", "Done", "normal", "[]", 1, now, now);
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_3", "iss_3", "primary", "T", now, now);
      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("run_val_3", "iss_3", "thr_3", "wsp_3", "agc_3", "completed", "validate", "validator", now, now);
      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("run_impl_3", "iss_3", "thr_3", "wsp_3", "agc_3", "completed", "do", now, now);
      db.prepare(
        `INSERT INTO evidence_summaries (id, issue_id, thread_id, validator_run_id, implementation_run_id, validation_result, evidence_refs, summary_markdown, same_origin_validation, implementation_identity_json, validator_identity_json, policy_id, policy_version, policy_snapshot_json, policy_snapshot_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("es_3", "iss_3", "thr_3", "run_val_3", "run_impl_3", "passed", "[]", "md", 0, "{}", "{}", "p", 1, "{}", "sha256:abc", now);

      applyMigrations(db);

      const row = db.prepare("SELECT * FROM evidence_summaries WHERE id = ?").get("es_3") as Record<string, unknown>;
      expect(row.validation_result).toBe("passed");
      expect(row.summary_markdown).toBe("md");
    });
  });

  describe("capability_tags backfill — only touches the empty-array state F002/F004 always wrote", () => {
    it("backfills [\"implementation\"] for an empty-array implementation-role adapter", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_4", now);
      insertAdapter(db, "agc_4", "prj_4", now, { role: "implementation", capability_tags: "[]" });

      applyMigrations(db);

      const row = db.prepare("SELECT capability_tags FROM agent_configs WHERE id = ?").get("agc_4") as { capability_tags: string };
      expect(JSON.parse(row.capability_tags)).toEqual(["implementation"]);
    });

    it("backfills [\"validator\"] for an empty-array validator-role adapter", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_5", now);
      insertAdapter(db, "agc_5", "prj_5", now, { role: "validator", capability_tags: "[]" });

      applyMigrations(db);

      const row = db.prepare("SELECT capability_tags FROM agent_configs WHERE id = ?").get("agc_5") as { capability_tags: string };
      expect(JSON.parse(row.capability_tags)).toEqual(["validator"]);
    });

    it("does not overwrite an adapter that already has non-empty capability_tags", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_6", now);
      insertAdapter(db, "agc_6", "prj_6", now, { role: "implementation", capability_tags: '["validator"]' });

      applyMigrations(db);

      const row = db.prepare("SELECT capability_tags FROM agent_configs WHERE id = ?").get("agc_6") as { capability_tags: string };
      expect(JSON.parse(row.capability_tags)).toEqual(["validator"]);
    });
  });

  describe("default_adapter_config_id backfill — never guesses when ambiguous", () => {
    it("backfills the single available adapter when a Project has exactly one", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_solo", now);
      insertAdapter(db, "agc_solo", "prj_solo", now, { status: "available" });

      applyMigrations(db);

      const row = db.prepare("SELECT default_adapter_config_id FROM projects WHERE id = ?").get("prj_solo") as { default_adapter_config_id: string | null };
      expect(row.default_adapter_config_id).toBe("agc_solo");
    });

    it("leaves NULL when a Project has zero available adapters", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_none", now);

      applyMigrations(db);

      const row = db.prepare("SELECT default_adapter_config_id FROM projects WHERE id = ?").get("prj_none") as { default_adapter_config_id: string | null };
      expect(row.default_adapter_config_id).toBeNull();
    });

    it("leaves NULL when a Project has two or more available adapters (does not pick 'the first one')", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_many", now);
      insertAdapter(db, "agc_many_1", "prj_many", now, { status: "available" });
      insertAdapter(db, "agc_many_2", "prj_many", now, { status: "available" });

      applyMigrations(db);

      const row = db.prepare("SELECT default_adapter_config_id FROM projects WHERE id = ?").get("prj_many") as { default_adapter_config_id: string | null };
      expect(row.default_adapter_config_id).toBeNull();
    });

    it("counts only available adapters — one available + one unavailable still backfills to the available one", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_mixed", now);
      insertAdapter(db, "agc_mixed_ok", "prj_mixed", now, { status: "available" });
      insertAdapter(db, "agc_mixed_bad", "prj_mixed", now, { status: "unavailable" });

      applyMigrations(db);

      const row = db.prepare("SELECT default_adapter_config_id FROM projects WHERE id = ?").get("prj_mixed") as { default_adapter_config_id: string | null };
      expect(row.default_adapter_config_id).toBe("agc_mixed_ok");
    });

    it("migration re-run is idempotent and does not clobber an already-backfilled default", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_idem", now);
      insertAdapter(db, "agc_idem", "prj_idem", now, { status: "available" });

      applyMigrations(db);
      applyMigrations(db);

      const row = db.prepare("SELECT default_adapter_config_id FROM projects WHERE id = ?").get("prj_idem") as { default_adapter_config_id: string | null };
      expect(row.default_adapter_config_id).toBe("agc_idem");
    });
  });

  describe("role='consult' — no table rebuild needed, existing partial unique index unaffected", () => {
    it("accepts a Run with role='consult' without violating NOT NULL or any CHECK", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_7", now);
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_7", "prj_7", "/tmp7", "/tmp7", "idle", now, now);
      insertAdapter(db, "agc_7", "prj_7", now);
      db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_7", "prj_7", "wsp_7", "coding", "wft_coding_default", "vpl_coding_default", "T", "Running", "normal", "[]", 0, now, now);
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_7", "iss_7", "primary", "T", now, now);

      applyMigrations(db);

      expect(() =>
        db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, purpose, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run("run_consult_7", "iss_7", "thr_7", "wsp_7", "agc_7", "completed", "look into X", "consult", "ad_hoc_consult", now, now),
      ).not.toThrow();

      const row = db.prepare("SELECT role, purpose FROM runs WHERE id = ?").get("run_consult_7") as { role: string; purpose: string };
      expect(row.role).toBe("consult");
      expect(row.purpose).toBe("ad_hoc_consult");
    });

    it("F004 active-validator and per-round-attempt unique indexes still exist and only match role='validator'", () => {
      applyMigrations(db);
      const activeIdx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_runs_one_active_validator'").get() as { sql: string };
      // BUG-003 / schema-v11 renamed the per-round index when it gained the attempt column.
      const roundIdx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_runs_validator_per_round_attempt'").get() as { sql: string };
      expect(activeIdx.sql).toContain("role = 'validator'");
      expect(roundIdx.sql).toContain("role = 'validator'");
    });
  });

  describe("T016: active-validator uniqueness applies across manual and system dispatch_source alike", () => {
    it("a manual (user_explicit) validator Run collides with an existing system-dispatched active validator", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_8", now);
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_8", "prj_8", "/tmp8", "/tmp8", "idle", now, now);
      insertAdapter(db, "agc_8", "prj_8", now, { role: "validator" });
      db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_8", "prj_8", "wsp_8", "coding", "wft_coding_default", "vpl_coding_default", "T", "Validating", "normal", "[]", 0, now, now);
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_8", "iss_8", "primary", "T", now, now);

      applyMigrations(db);

      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("run_sys_8", "iss_8", "thr_8", "wsp_8", "agc_8", "queued", "validate", "validator", "system", now, now);

      expect(() =>
        db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run("run_manual_8", "iss_8", "thr_8", "wsp_8", "agc_8", "running", "validate", "validator", "user_explicit", now, now),
      ).toThrow();
    });

    it("a system validator Run collides with an existing manual (user_explicit) active validator", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_9", now);
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_9", "prj_9", "/tmp9", "/tmp9", "idle", now, now);
      insertAdapter(db, "agc_9", "prj_9", now, { role: "validator" });
      db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_9", "prj_9", "wsp_9", "coding", "wft_coding_default", "vpl_coding_default", "T", "Validating", "normal", "[]", 0, now, now);
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_9", "iss_9", "primary", "T", now, now);

      applyMigrations(db);

      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("run_manual_9", "iss_9", "thr_9", "wsp_9", "agc_9", "queued", "validate", "validator", "user_explicit", now, now);

      expect(() =>
        db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run("run_sys_9", "iss_9", "thr_9", "wsp_9", "agc_9", "running", "validate", "validator", "system", now, now),
      ).toThrow();
    });

    it("a consult Run does not collide with an active validator (different role, no shared index predicate)", () => {
      const now = setupV5Db(db);
      insertProject(db, "prj_10", now);
      db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("wsp_10", "prj_10", "/tmp10", "/tmp10", "idle", now, now);
      insertAdapter(db, "agc_10", "prj_10", now, { role: "validator" });
      db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("iss_10", "prj_10", "wsp_10", "coding", "wft_coding_default", "vpl_coding_default", "T", "Validating", "normal", "[]", 0, now, now);
      db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("thr_10", "iss_10", "primary", "T", now, now);

      applyMigrations(db);

      db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("run_active_val_10", "iss_10", "thr_10", "wsp_10", "agc_10", "running", "validate", "validator", "system", now, now);

      expect(() =>
        db.prepare("INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, purpose, dispatch_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run("run_consult_10", "iss_10", "thr_10", "wsp_10", "agc_10", "running", "look into Y", "consult", "ad_hoc_consult", "user_explicit", now, now),
      ).not.toThrow();
    });
  });
});
