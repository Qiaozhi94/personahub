import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { loadV02SnapshotSql } from "../fixtures/build-v02-fixture.js";

// BUG-003: v10 → v11 adds the validator attempt dimension. F013 test strategy
// (design §8): migration tests start from the committed release-v10 snapshot and
// run the REAL v10 → v11 → v12 upgrade chain, never a hand-rolled downgrade of a
// fresh install. Parent rows (project/workspace/thread/issue/adapter) are seeded
// so the chain's foreign_key_check passes with the seeded validator runs.

const NOW = "2026-01-01T00:00:00Z";

function buildV10Db(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(loadV02SnapshotSql());
  const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
  if (version.v !== 10) {
    throw new Error(`v02 snapshot is not schema v10 (got ${version.v})`);
  }

  // Minimal consistent parents: the snapshot seeds the default workflow template
  // and validation policy; runs need issue/thread/workspace/adapter rows.
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, 'v11 test', ?, ?)").run(
    "prj_v11",
    NOW,
    NOW,
  );
  db.prepare(
    "INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES (?, ?, '/tmp/v11', '/tmp/v11', 'idle', ?, ?)",
  ).run("wsp_v11", "prj_v11", NOW, NOW);
  db.prepare(
    "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at) VALUES (?, ?, 'Fake', 'implementation', 'fake', 'fake', '[]', '[]', 'available', ?, ?)",
  ).run("adp_v11", "prj_v11", NOW, NOW);
  db.prepare(
    "INSERT INTO issues (id, project_id, workspace_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, labels, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, 'coding', 'wft_coding_default', 'vpl_coding_default', 'v11 test', 'Validating', 'normal', '[]', 1, ?, ?)",
  ).run("iss_v11", "prj_v11", "wsp_v11", NOW, NOW);
  db.prepare(
    "INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, 'primary', 'v11 test', ?, ?)",
  ).run("thr_v11", "iss_v11", NOW, NOW);
  return db;
}

function seedValidatorRun(db: Database.Database, id: string, round: number | null): void {
  // v10 shape: no validation_attempt column yet.
  db.prepare(
    `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, workflow_step, validation_round, dispatch_source, purpose, created_at, updated_at)
     VALUES (?, 'iss_v11', 'thr_v11', 'wsp_v11', 'adp_v11', 'failed', 'x', 'validator', 'validation', ?, 'system', 'workflow_bound', ?, ?)`,
  ).run(id, round, NOW, NOW);
}

describe("BUG-003 schema v11 migration (v10 snapshot → head)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = buildV10Db();
  });

  afterEach(() => {
    db.close();
  });

  it("reaches the head version through the real upgrade chain", () => {
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
    expect(row.v).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
  });

  it("adds validation_attempt to runs", () => {
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("validation_attempt");
  });

  it("backfills existing validator runs as attempt 1 and leaves round-less runs alone", () => {
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
    const insertWithAttempt = (id: string, round: number, attempt: number): void => {
      db.prepare(
        `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, workflow_step, validation_round, validation_attempt, dispatch_source, purpose, created_at, updated_at)
         VALUES (?, 'iss_v11', 'thr_v11', 'wsp_v11', 'adp_v11', 'failed', 'x', 'validator', 'validation', ?, ?, 'system', 'workflow_bound', ?, ?)`,
      ).run(id, round, attempt, NOW, NOW);
    };
    insertWithAttempt("run_a1", 1, 1);

    // This is the insert the old index made impossible — the whole wedge.
    expect(() => insertWithAttempt("run_a2", 1, 2)).not.toThrow();
    expect(() => insertWithAttempt("run_dup", 1, 2)).toThrow(/UNIQUE/i);
  });
});
