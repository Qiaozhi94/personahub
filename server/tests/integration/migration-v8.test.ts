import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/migrations.js";
import { SCHEMA_V1 } from "../../src/db/schema-v1.js";
import { SCHEMA_V2 } from "../../src/db/schema-v2.js";
import { SCHEMA_V3 } from "../../src/db/schema-v3.js";
import { SCHEMA_V4 } from "../../src/db/schema-v4.js";
import { SCHEMA_V5 } from "../../src/db/schema-v5.js";
import { SCHEMA_V6 } from "../../src/db/schema-v6.js";
import { SCHEMA_V7 } from "../../src/db/schema-v7.js";
import { SCHEMA_V8 } from "../../src/db/schema-v8.js";

// T012: v7 → v8 migration for F006. Covers: v7→v8 upgrade, fresh install
// reaching v8, data preservation, foreign_keys=ON behaviour, new tables
// and indexes, ALTER TABLE runs ADD COLUMN node_run_id compatibility.

function setupV7Db(db: Database.Database): string {
  const now = "2026-01-01T00:00:00Z";
  db.exec(SCHEMA_V1);
  db.exec(SCHEMA_V2);
  db.exec(SCHEMA_V3);
  db.exec(SCHEMA_V4);
  db.exec(SCHEMA_V5);
  db.exec(SCHEMA_V6);
  db.exec(SCHEMA_V7);
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  for (let v = 1; v <= 7; v++) {
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(v, now);
  }
  return now;
}

function seedV7Data(db: Database.Database, now: string): { projectId: string; workspaceId: string; issueId: string; threadId: string; adapterId: string; runId: string } {
  const projectId = "prj_test";
  const workspaceId = "wsp_test";
  const issueId = "iss_test";
  const threadId = "thr_test";
  const adapterId = "agt_test";
  const runId = "run_test";

  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(projectId, "test", now, now);
  db.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(workspaceId, projectId, "/tmp/test", "/tmp/test", "idle", 0, now, now);
  db.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_test", "test", "coding", "single", "active", 1, now, now);
  db.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_test", "test", "coding", 3, "active", 1, now, now);
  db.prepare("INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(issueId, projectId, workspaceId, "coding", "wft_test", "vpl_test", "test issue", "Inbox", "normal", "[]", 0, now, now);
  db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(threadId, issueId, "primary", "test thread", now, now);
  db.prepare("INSERT INTO agent_configs (id, project_id, name, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(adapterId, projectId, "test", "codex", "codex", "[]", '["implementation"]', "available", now, now);
  db.prepare(`INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, workflow_step, dispatch_source, purpose, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, issueId, threadId, workspaceId, adapterId, "completed", "do it", "implementation", "implementation", "user_explicit", "workflow_bound", now, now);

  return { projectId, workspaceId, issueId, threadId, adapterId, runId };
}

describe("T012 schema v8 migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  describe("fresh install reaches v8", () => {
    it("schema_version max is 8", () => {
      applyMigrations(db);
      const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(row.v).toBe(8);
    });

    it("is idempotent — running twice does not error and stays at 8", () => {
      applyMigrations(db);
      applyMigrations(db);
      const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(row.v).toBe(8);
    });

    it("creates graph_runs table", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(graph_runs)").all() as Array<{ name: string; notnull: number }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain("id");
      expect(names).toContain("issue_id");
      expect(names).toContain("thread_id");
      expect(names).toContain("workspace_id");
      expect(names).toContain("definition_id");
      expect(names).toContain("definition_version");
      expect(names).toContain("status");
      expect(names).toContain("blocked_reason_code");
      expect(names).toContain("blocked_node_keys");
      expect(names).toContain("target_files_json");
      expect(names).toContain("target_files_hash");
      expect(names).toContain("target_files_truncated");
      expect(names).toContain("target_files_dropped_count");
      expect(names).toContain("created_at");
      expect(names).toContain("updated_at");
    });

    it("creates node_runs table with NOT NULL assigned_adapter_config_id", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(node_runs)").all() as Array<{ name: string; notnull: number }>;
      const adapterCol = cols.find((c) => c.name === "assigned_adapter_config_id");
      expect(adapterCol).toBeDefined();
      expect(adapterCol!.notnull).toBe(1);
    });

    it("creates node_runs table with expected columns", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(node_runs)").all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain("id");
      expect(names).toContain("graph_run_id");
      expect(names).toContain("node_key");
      expect(names).toContain("status");
      expect(names).toContain("join_satisfied_at");
      expect(names).toContain("result_event_id");
      expect(names).toContain("assigned_adapter_config_id");
      expect(names).toContain("created_at");
      expect(names).toContain("updated_at");
    });

    it("runs table has node_run_id column", () => {
      applyMigrations(db);
      const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toContain("node_run_id");
    });

    it("creates partial unique index for non-terminal graph runs", () => {
      applyMigrations(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_graph_runs%'",
      ).all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain("idx_graph_runs_one_nonterminal_per_issue");
    });

    it("creates partial unique index for active graph attempts", () => {
      applyMigrations(db);
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_runs%graph%'",
      ).all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain("idx_runs_one_active_graph_attempt");
    });
  });

  describe("v7 → v8 upgrade data preservation", () => {
    it("preserves existing runs after v7→v8 upgrade", () => {
      const now = setupV7Db(db);
      const { runId } = seedV7Data(db, now);

      applyMigrations(db);

      const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Record<string, unknown>;
      expect(run).toBeDefined();
      expect(run.status).toBe("completed");
      expect(run.node_run_id).toBeNull();
    });

    it("existing runs have node_run_id defaulting to NULL", () => {
      const now = setupV7Db(db);
      seedV7Data(db, now);

      applyMigrations(db);

      const rows = db.prepare("SELECT node_run_id FROM runs").all() as Array<{ node_run_id: string | null }>;
      for (const row of rows) {
        expect(row.node_run_id).toBeNull();
      }
    });

    it("existing runs can still be written to after ALTER TABLE", () => {
      const now = setupV7Db(db);
      const { runId } = seedV7Data(db, now);

      applyMigrations(db);

      db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?")
        .run("failed", "2026-02-01T00:00:00Z", runId);

      const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string };
      expect(run.status).toBe("failed");
    });

    it("preserves all existing tables after v7→v8 upgrade", () => {
      const now = setupV7Db(db);
      seedV7Data(db, now);

      applyMigrations(db);

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain("projects");
      expect(names).toContain("workspaces");
      expect(names).toContain("issues");
      expect(names).toContain("threads");
      expect(names).toContain("thread_events");
      expect(names).toContain("runs");
      expect(names).toContain("agent_configs");
      expect(names).toContain("graph_runs");
      expect(names).toContain("node_runs");
    });
  });

  describe("v8 foreign key enforcement", () => {
    it("graph_runs FK to issues is enforced", () => {
      applyMigrations(db);
      expect(() => {
        db.prepare(
          "INSERT INTO graph_runs (id, issue_id, thread_id, workspace_id, definition_id, definition_version, status, target_files_json, target_files_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run("gr_1", "nonexistent", "thr_1", "wsp_1", "def_1", 1, "running", "[]", "abc", "2026", "2026");
      }).toThrow();
    });

    it("node_runs FK to graph_runs is enforced", () => {
      applyMigrations(db);
      expect(() => {
        db.prepare(
          "INSERT INTO node_runs (id, graph_run_id, node_key, status, assigned_adapter_config_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run("nr_1", "nonexistent", "n1", "pending", "agt_1", "2026", "2026");
      }).toThrow();
    });

    it("node_runs assigned_adapter_config_id must NOT be NULL", () => {
      applyMigrations(db);
      expect(() => {
        db.prepare(
          "INSERT INTO node_runs (id, graph_run_id, node_key, status, assigned_adapter_config_id, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        ).run("nr_1", "gr_1", "n1", "pending", "2026", "2026");
      }).toThrow();
    });
  });

  describe("v8 migration transaction and retry safety", () => {
    it("v8 DDL and version insert are in the same transaction", () => {
      applyMigrations(db);
      expect(() => applyMigrations(db)).not.toThrow();
      const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(row.v).toBe(8);
    });

    it("v7 to v8 file-based migration preserves data and is idempotent on retry", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "personahub-test-"));
      const dbPath = join(tmpDir, "test.db");

      try {
      const fileDb = new Database(dbPath);

      const now = "2026-01-01T00:00:00Z";
      fileDb.exec(SCHEMA_V1);
      fileDb.exec(SCHEMA_V2);
      fileDb.exec(SCHEMA_V3);
      fileDb.exec(SCHEMA_V4);
      fileDb.exec(SCHEMA_V5);
      fileDb.exec(SCHEMA_V6);
      fileDb.exec(SCHEMA_V7);
      fileDb.exec(
        `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
      );
      for (let v = 1; v <= 7; v++) {
        fileDb.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(v, now);
      }

      fileDb.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("prj_1", "test", now, now);
      fileDb.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wsp_1", "prj_1", "/tmp/test", "/tmp/test", "idle", 0, now, now);
      fileDb.prepare("INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("wft_1", "test", "coding", "single", "active", 1, now, now);
      fileDb.prepare("INSERT INTO validation_policies (id, name, issue_type, max_validation_rounds, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("vpl_1", "test", "coding", 3, "active", 1, now, now);

      fileDb.close();

      // Reopen and apply v8 migration.
      const reopened = new Database(dbPath);
      reopened.pragma("foreign_keys = ON");
      applyMigrations(reopened);

      // Verify v8 was applied.
      const version = reopened.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(version.v).toBe(8);

      // Verify v7 data survived.
      const project = reopened.prepare("SELECT name FROM projects WHERE id = ?").get("prj_1") as { name: string };
      expect(project.name).toBe("test");

      // Verify new tables exist.
      const tables = reopened.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('graph_runs','node_runs')").all() as Array<{ name: string }>;
      expect(tables).toHaveLength(2);

      // Verify runs has node_run_id column.
      const cols = reopened.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "node_run_id")).toBe(true);

      // Verify migration is idempotent on retry.
      expect(() => applyMigrations(reopened)).not.toThrow();
      const version2 = reopened.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(version2.v).toBe(8);

      reopened.close();
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
      }
    });

    it("v8 migration rolls back atomically when version INSERT fails", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "personahub-test-"));
      const dbPath = join(tmpDir, "test.db");

      try {
        // Set up a v7 database with seed data.
        const fileDb = new Database(dbPath);
        const now = "2026-01-01T00:00:00Z";
        fileDb.exec(SCHEMA_V1);
        fileDb.exec(SCHEMA_V2);
        fileDb.exec(SCHEMA_V3);
        fileDb.exec(SCHEMA_V4);
        fileDb.exec(SCHEMA_V5);
        fileDb.exec(SCHEMA_V6);
        fileDb.exec(SCHEMA_V7);
        fileDb.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
        for (let v = 1; v <= 7; v++) {
          fileDb.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(v, now);
        }
        fileDb.close();

        // Inject a trigger that makes version INSERT fail.
        const faultDb = new Database(dbPath);
        faultDb.exec(`CREATE TRIGGER fail_v8_version
          BEFORE INSERT ON schema_version
          WHEN NEW.version = 8
          BEGIN SELECT RAISE(ABORT, 'injected fault'); END;`);

        // Migration should fail — DDL and version INSERT must roll back together.
        expect(() => applyMigrations(faultDb)).toThrow();
        faultDb.close();

        // Reopen: verify nothing from v8 persisted.
        const checkDb = new Database(dbPath);
        const version = checkDb.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
        expect(version.v).toBe(7);

        const tables = checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='graph_runs'").get() as { name: string } | undefined;
        expect(tables).toBeUndefined();

        const cols = checkDb.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
        expect(cols.some((c) => c.name === "node_run_id")).toBe(false);

        checkDb.close();

        // Clean up trigger and retry — migration should succeed.
        const retryDb = new Database(dbPath);
        retryDb.exec("DROP TRIGGER fail_v8_version");
        expect(() => applyMigrations(retryDb)).not.toThrow();
        const v8 = retryDb.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
        expect(v8.v).toBe(8);
        retryDb.close();
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
      }
    });
  });
});