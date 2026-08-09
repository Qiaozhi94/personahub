import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";

// T009: v9 → v10 migration for F008. Covers: fresh install reaching v10,
// idempotency, admin_audit_events table shape, and the two workflow_templates
// unique indexes (issue_type+version uniqueness; single-active invariant).

function seedWorkflowTemplate(db: Database.Database): string {
  db.prepare(
    "INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("wft_1", "v100", "coding", "single", "inactive", 100, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
  return "wft_1";
}

describe("T009 schema v10 migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  it("fresh install reaches v10", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(10);
  });

  it("CURRENT_SCHEMA_VERSION matches the applied migration count", () => {
    applyMigrations(db);
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("is idempotent — running twice stays at v10", () => {
    applyMigrations(db);
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(10);
  });

  it("creates admin_audit_events table with expected columns", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(admin_audit_events)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "action",
        "target_type",
        "target_id",
        "target_version",
        "actor_type",
        "actor_id",
        "details_json",
        "created_at",
      ]),
    );
  });

  it("creates the issue_type+version unique index", () => {
    applyMigrations(db);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_workflow_templates_issue_type_version'",
      )
      .all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);
  });

  it("creates the single-active partial unique index", () => {
    applyMigrations(db);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_workflow_templates_one_active'")
      .all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);
  });

  it("rejects two workflow_templates with the same (issue_type, version)", () => {
    applyMigrations(db);
    seedWorkflowTemplate(db);
    expect(() => {
      db.prepare(
        "INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("wft_dup", "dup", "coding", "single", "inactive", 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    }).toThrow(/UNIQUE/);
  });

  it("rejects two active workflow_templates for the same issue_type", () => {
    applyMigrations(db);
    seedWorkflowTemplate(db);
    expect(() => {
      db.prepare(
        "INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("wft_active2", "active2", "coding", "single", "active", 2, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    }).toThrow(/UNIQUE/);
  });

  it("allows multiple inactive rows for the same issue_type", () => {
    applyMigrations(db);
    seedWorkflowTemplate(db);
    expect(() => {
      db.prepare(
        "INSERT INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "wft_inactive2",
        "inactive2",
        "coding",
        "single",
        "inactive",
        2,
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
      );
    }).not.toThrow();
  });

  it("existing seed data (wft_coding_default v1 active) does not collide with the new indexes", () => {
    applyMigrations(db);
    const row = db
      .prepare("SELECT id, version, status FROM workflow_templates WHERE id = 'wft_coding_default'")
      .get() as { id: string; version: number; status: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.version).toBe(1);
    expect(row!.status).toBe("active");
  });

  it("admin_audit_events row is insertable with actor_id NULL", () => {
    applyMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO admin_audit_events (id, action, target_type, target_id, target_version, actor_type, actor_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "aev_1",
        "template.version_created",
        "workflow_template",
        "wft_1",
        2,
        "local_user",
        null,
        "{}",
        "2026-01-01T00:00:00Z",
      );
    }).not.toThrow();
  });
});
