import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";

// BUG-003: v10 → v11 adds the validator attempt dimension. Covers reaching the
// head version, idempotency, the backfill of pre-existing validator runs, the
// index swap, and — the point of the whole migration — that a second attempt at
// the same round is now insertable while a duplicate (round, attempt) is not.

function seedValidatorRun(
  db: Database.Database,
  id: string,
  round: number | null,
  attempt: number | null = null,
): void {
  const now = "2026-01-01T00:00:00Z";
  const hasAttemptColumn = (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).some(
    (c) => c.name === "validation_attempt",
  );
  if (!hasAttemptColumn) {
    db.prepare(
      `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, workflow_step, validation_round, dispatch_source, purpose, created_at, updated_at)
       VALUES (?, 'iss_1', 'thr_1', 'ws_1', 'ad_1', 'completed', 'x', 'validator', 'validation', ?, 'system', 'workflow_bound', ?, ?)`,
    ).run(id, round, now, now);
    return;
  }
  db.prepare(
    `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, workflow_step, validation_round, validation_attempt, dispatch_source, purpose, created_at, updated_at)
     VALUES (?, 'iss_1', 'thr_1', 'ws_1', 'ad_1', 'completed', 'x', 'validator', 'validation', ?, ?, 'system', 'workflow_bound', ?, ?)`,
  ).run(id, round, attempt, now, now);
}

/** Applies every migration except v11, so v11 can be tested as an upgrade.
 *  Later migrations (v12+) must be undone too — otherwise schema_version would
 *  sit past 11 and the v11 block would never re-run. */
function applyThroughV10(db: Database.Database): void {
  applyMigrations(db);
  // Fresh installs already ran v12; undo it (forward-only chain: tables only).
  db.exec(`
    DROP INDEX IF EXISTS idx_artifact_consumptions_run;
    DROP INDEX IF EXISTS idx_artifacts_issue;
    DROP INDEX IF EXISTS idx_artifact_evidence_links_ref;
    DROP TABLE IF EXISTS artifact_consumptions;
    DROP TABLE IF EXISTS artifact_evidence_links;
    DROP TABLE IF EXISTS artifact_revisions;
    DROP TABLE IF EXISTS artifacts;
    DROP TABLE IF EXISTS artifact_maintenance_leases;
  `);
  db.prepare("DELETE FROM schema_version WHERE version = 12").run();
  // Simulate a v10 database by undoing v11.
  // Drop the index before the column: SQLite refuses to drop an indexed column.
  db.exec("DROP INDEX IF EXISTS idx_runs_validator_per_round_attempt");
  db.exec("ALTER TABLE runs DROP COLUMN validation_attempt");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_validator_per_round
             ON runs(issue_id, validation_round)
             WHERE role = 'validator' AND validation_round IS NOT NULL`);
  db.prepare("DELETE FROM schema_version WHERE version = 11").run();
}

describe("BUG-003 schema v11 migration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Runs reference issues/threads/workspaces; this suite only exercises the
    // runs table and its indexes, so FK enforcement stays off here.
    db.pragma("foreign_keys = OFF");
  });

  afterEach(() => {
    db.close();
  });

  it("fresh install reaches the head version", () => {
    applyMigrations(db);
    // forward-compatible: later migrations (v12+) may raise the head version
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("is idempotent — running twice stays at the head version", () => {
    applyMigrations(db);
    applyMigrations(db);
    const row = db.prepare("SELECT COUNT(*) AS c FROM schema_version WHERE version = 11").get() as { c: number };
    expect(row.c).toBe(1);
  });

  it("adds validation_attempt to runs", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("validation_attempt");
  });

  it("backfills existing validator runs as attempt 1 and leaves round-less runs alone", () => {
    applyThroughV10(db);
    seedValidatorRun(db, "run_round1", 1);
    seedValidatorRun(db, "run_noround", null);

    applyMigrations(db);

    const withRound = db.prepare("SELECT validation_attempt AS a FROM runs WHERE id = 'run_round1'").get() as {
      a: number | null;
    };
    const withoutRound = db.prepare("SELECT validation_attempt AS a FROM runs WHERE id = 'run_noround'").get() as {
      a: number | null;
    };
    expect(withRound.a).toBe(1);
    expect(withoutRound.a).toBeNull();
  });

  it("replaces the per-round index with a per-round-attempt index", () => {
    applyMigrations(db);
    const names = (db.prepare("PRAGMA index_list(runs)").all() as Array<{ name: string }>).map((i) => i.name);
    expect(names).toContain("idx_runs_validator_per_round_attempt");
    expect(names).not.toContain("idx_runs_validator_per_round");
  });

  it("allows a second attempt at the same round but still rejects a duplicate attempt", () => {
    applyMigrations(db);
    seedValidatorRun(db, "run_a1", 1, 1);

    // This is the insert the old index made impossible — the whole wedge.
    expect(() => seedValidatorRun(db, "run_a2", 1, 2)).not.toThrow();
    expect(() => seedValidatorRun(db, "run_dup", 1, 2)).toThrow(/UNIQUE/i);
  });
});
