import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { buildV02Fixture, loadV02SeedSql, loadV02SnapshotSql } from "../fixtures/build-v02-fixture.js";

// F009 T000 — proves the committed v0.2 fixture (raw SQL snapshot + seed) is a
// faithful schema-v10 database that the real v10 → v11 → head migration chain
// upgrades in place, per v02-fixture-contract.md §3. Nothing here goes through
// repositories or services: current code never wrote this data.

// Normalized SHA-256 of server/tests/fixtures/v02-schema-v10.sql (CRLF → LF).
// Regenerate the snapshot with server/tests/fixtures/generate-v02-schema-
// snapshot.mjs and re-audit the diff whenever this fails — never edit the SQL.
const V02_SNAPSHOT_SHA256 = "524b03b521ae9fe14a17faa8e7f8b813b5bbc4f05f7084405234d67405aad5d9";

function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, "\n");
}

function snapshotFingerprint(sql: string): string {
  return createHash("sha256").update(normalizeSql(sql)).digest("hex");
}

function assertSchemaV10Shape(db: Database.Database): void {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  // The frozen source is v10; a snapshot claiming 11 is a source-version drift.
  expect(row.v).toBe(10);
  const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as Array<{
    version: number;
  }>;
  expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // v11 must not have leaked into the fixture: the runs table has no attempt
  // column before the migration under test.
  const runColumns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  expect(runColumns.map((c) => c.name)).not.toContain("validation_attempt");
}

interface CountRow {
  c: number;
}

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as CountRow).c;
}

/** Representative facts from v02-fixture-contract.md §2, asserted pre-upgrade. */
function assertRepresentativeData(db: Database.Database): void {
  // FX-PROJECT: 2 projects, exactly one bound workspace.
  expect(count(db, "SELECT COUNT(*) AS c FROM projects")).toBe(2);
  const bound = db.prepare("SELECT default_workspace_id FROM projects WHERE id = 'prj_v02_alpha'").get() as {
    default_workspace_id: string | null;
  };
  expect(bound.default_workspace_id).toBe("ws_v02_alpha");
  const unbound = db.prepare("SELECT default_workspace_id FROM projects WHERE id = 'prj_v02_beta'").get() as {
    default_workspace_id: string | null;
  };
  expect(unbound.default_workspace_id).toBeNull();

  // FX-TASK: running / blocked / done all present, each with one primary thread.
  const statuses = db.prepare("SELECT id, status FROM issues ORDER BY id").all() as Array<{
    id: string;
    status: string;
  }>;
  expect(statuses.length).toBeGreaterThanOrEqual(2);
  expect(statuses.map((i) => i.status)).toContain("Running");
  expect(statuses.map((i) => i.status)).toContain("Blocked");
  expect(statuses.map((i) => i.status)).toContain("Done");
  const orphanThreads = count(
    db,
    `SELECT COUNT(*) AS c FROM issues i
     WHERE (SELECT COUNT(*) FROM threads t WHERE t.issue_id = i.id AND t.thread_type = 'primary') <> 1`,
  );
  expect(orphanThreads).toBe(0);

  // FX-RUN: ≥3 runs in the shared workspace covering completed / queued / failed.
  const runStatuses = db
    .prepare("SELECT status, COUNT(*) AS c FROM runs WHERE workspace_id = 'ws_v02_alpha' GROUP BY status")
    .all() as Array<{ status: string; c: number }>;
  const byStatus = new Map(runStatuses.map((r) => [r.status, r.c]));
  expect((byStatus.get("completed") ?? 0) + (byStatus.get("failed") ?? 0)).toBeGreaterThanOrEqual(3);
  expect(byStatus.get("queued") ?? 0).toBeGreaterThanOrEqual(1);

  // FX-GRAPH: one completed fan-out/fan-in graph, one blocked graph with a
  // retryable (failed) node; result refs and assignments point at real rows.
  const graphs = db.prepare("SELECT * FROM graph_runs ORDER BY id").all() as Array<{
    id: string;
    status: string;
    blocked_node_keys: string | null;
  }>;
  expect(graphs.map((g) => g.status)).toEqual(["completed", "blocked", "blocked"]);
  const blockedGraph = graphs.find((g) => g.status === "blocked");
  expect(JSON.parse(blockedGraph!.blocked_node_keys ?? "[]")).toEqual(["impl"]);
  expect(
    count(
      db,
      `SELECT COUNT(*) AS c FROM node_runs nr
       JOIN graph_runs g ON g.id = nr.graph_run_id
       WHERE g.status = 'blocked' AND nr.status = 'failed'`,
    ),
  ).toBe(3);
  const danglingResultEvents = count(
    db,
    `SELECT COUNT(*) AS c FROM node_runs WHERE result_event_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM thread_events e WHERE e.id = node_runs.result_event_id)`,
  );
  expect(danglingResultEvents).toBe(0);

  // FX-TRACE: the same run carries ≥2 command events and 2 file changes, and
  // its thread exceeds one trace page (16 events) so pagination has a boundary.
  expect(
    count(
      db,
      `SELECT COUNT(*) AS c FROM thread_events
       WHERE thread_id = 'thr_v02_running' AND type LIKE 'command.%' AND payload_json LIKE '%run_v02_completed%'`,
    ),
  ).toBeGreaterThanOrEqual(4);
  expect(count(db, "SELECT COUNT(*) AS c FROM run_file_changes WHERE run_id = 'run_v02_completed'")).toBe(2);
  const runningEvents = count(db, "SELECT COUNT(*) AS c FROM thread_events WHERE thread_id = 'thr_v02_running'");
  expect(runningEvents).toBe(16);
  expect(count(db, "SELECT COUNT(*) AS c FROM thread_events WHERE type = 'run.output_truncated'")).toBe(1);

  // FX-EVIDENCE: complete group has handoff + test + summary; the partial group
  // (iss_v02_blocked) has handoff + failed test but no summary row.
  expect(count(db, "SELECT COUNT(*) AS c FROM evidence_summaries")).toBe(1);
  const summary = db.prepare("SELECT * FROM evidence_summaries").get() as {
    issue_id: string;
    validator_run_id: string;
    implementation_run_id: string;
  };
  expect(summary.issue_id).toBe("iss_v02_done");
  expect(
    count(db, "SELECT COUNT(*) AS c FROM thread_events WHERE thread_id = 'thr_v02_done' AND type = 'handoff.created'"),
  ).toBe(1);
  expect(
    count(
      db,
      "SELECT COUNT(*) AS c FROM thread_events WHERE thread_id = 'thr_v02_blocked' AND type = 'test.completed'",
    ),
  ).toBe(1);
  expect(count(db, "SELECT COUNT(*) AS c FROM evidence_summaries WHERE issue_id = 'iss_v02_blocked'")).toBe(0);

  // FX-VALIDATION: two failed rounds then a pass, one validator Run per round.
  const rounds = db
    .prepare(
      `SELECT validation_round AS r, status FROM runs
       WHERE issue_id = 'iss_v02_done' AND role = 'validator' ORDER BY validation_round`,
    )
    .all() as Array<{ r: number; status: string }>;
  expect(rounds.map((r) => r.r)).toEqual([1, 2, 3]);
  const roundCount = db.prepare("SELECT validation_round_count AS c FROM issues WHERE id = 'iss_v02_done'").get() as {
    c: number;
  };
  expect(roundCount.c).toBe(3);
  // And a validator Run that died without a verdict (the BUG-003 wedge).
  const wedged = db
    .prepare(
      `SELECT status, failure_reason FROM runs
       WHERE id = 'run_v02_val_b2' AND role = 'validator' AND validation_round = 2`,
    )
    .get() as { status: string; failure_reason: string | null };
  expect(wedged.status).toBe("failed");
  expect(wedged.failure_reason).toBe("output_parse_failed");

  // FX-ADAPTER: implementation + validator, available + unavailable, a
  // workspace override, and a project default.
  const adapters = db
    .prepare("SELECT role, status FROM agent_configs WHERE project_id = 'prj_v02_alpha'")
    .all() as Array<{ role: string; status: string }>;
  expect(adapters.some((a) => a.role === "implementation" && a.status === "available")).toBe(true);
  expect(adapters.some((a) => a.role === "validator" && a.status === "unavailable")).toBe(true);
  expect(count(db, "SELECT COUNT(*) AS c FROM adapter_workspace_status")).toBe(1);
  const adapterDefault = db
    .prepare("SELECT default_adapter_config_id FROM projects WHERE id = 'prj_v02_alpha'")
    .get() as { default_adapter_config_id: string | null };
  expect(adapterDefault.default_adapter_config_id).toBe("adp_v02_codex_impl");

  // FX-WORKFLOW: same issue_type with an active and an inactive version.
  const templateStatuses = db
    .prepare("SELECT status FROM workflow_templates WHERE issue_type = 'coding'")
    .all() as Array<{ status: string }>;
  expect(templateStatuses.map((t) => t.status)).toContain("active");
  expect(templateStatuses.map((t) => t.status)).toContain("inactive");

  // FX-HEALTH inputs: a locked workspace, a queued run, and a pending probe.
  expect(
    count(db, "SELECT COUNT(*) AS c FROM workspaces WHERE lock_state = 'locked' AND locked_by_run_id IS NOT NULL"),
  ).toBe(1);
  expect(count(db, "SELECT COUNT(*) AS c FROM runs WHERE status = 'queued'")).toBeGreaterThanOrEqual(1);
  expect(
    count(db, "SELECT COUNT(*) AS c FROM agent_configs WHERE status = 'unknown' AND last_checked_at IS NULL"),
  ).toBe(1);
}

function snapshotRuns(db: Database.Database): Map<string, Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT id, issue_id, thread_id, validation_round, role, status, created_at, updated_at, final_message
       FROM runs`,
    )
    .all() as Array<Record<string, unknown>>;
  return new Map(rows.map((row) => [row.id as string, row]));
}

describe("F009 v0.2 schema-v10 fixture", () => {
  let dir: string;
  let db: Database.Database;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "f009-v02-fixture-"));
    db = buildV02Fixture(dir);
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches the frozen source-commit fingerprint", () => {
    expect(snapshotFingerprint(loadV02SnapshotSql())).toBe(V02_SNAPSHOT_SHA256);
  });

  it("materializes a complete schema-v10 database", () => {
    assertSchemaV10Shape(db);
  });

  it("seeds the representative v0.2 data set", () => {
    assertRepresentativeData(db);
  });

  it("upgrades v10 → v11 → head through the real migration chain", () => {
    const before = snapshotRuns(db);

    applyMigrations(db);

    const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
    expect(version.v).toBe(CURRENT_SCHEMA_VERSION);
    const runColumns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    expect(runColumns.map((c) => c.name)).toContain("validation_attempt");

    // BUG-003 backfill: every historical validator run becomes attempt 1 of
    // its round; nothing else gains an attempt.
    const attemptRows = db
      .prepare(
        "SELECT id, role, validation_round AS r, validation_attempt AS a FROM runs WHERE validation_attempt IS NOT NULL",
      )
      .all() as Array<{ id: string; role: string; r: number | null; a: number | null }>;
    expect(attemptRows.length).toBe(8);
    for (const row of attemptRows) {
      expect(row.role).toBe("validator");
      expect(row.a).toBe(1);
      expect(row.r).not.toBeNull();
    }
    const validators = db.prepare("SELECT id FROM runs WHERE role = 'validator'").all() as Array<{ id: string }>;
    expect(validators.map((v) => v.id).sort()).toEqual([
      "run_v02_rl_val1",
      "run_v02_rl_val2",
      "run_v02_rl_val3",
      "run_v02_val_b1",
      "run_v02_val_b2",
      "run_v02_val_r1",
      "run_v02_val_r2",
      "run_v02_val_r3",
    ]);
    expect(validators.length).toBe(8);

    // Identity conservation: IDs, rounds, threads, timestamps, verdicts.
    const after = snapshotRuns(db);
    expect(after.size).toBe(before.size);
    for (const [id, beforeRow] of before) {
      const afterRow = after.get(id);
      expect(afterRow).toBeDefined();
      expect(afterRow).toEqual(beforeRow);
    }

    // The migrated file still satisfies referential integrity.
    const fkViolations = db.pragma("foreign_key_check") as Array<Record<string, unknown>>;
    expect(fkViolations).toEqual([]);
  });

  it("is idempotent when the same database starts again", () => {
    const countsBefore = {
      schema: count(db, "SELECT COUNT(*) AS c FROM schema_version"),
      runs: count(db, "SELECT COUNT(*) AS c FROM runs"),
      events: count(db, "SELECT COUNT(*) AS c FROM thread_events"),
      summaries: count(db, "SELECT COUNT(*) AS c FROM evidence_summaries"),
    };

    applyMigrations(db);

    const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
    expect(version.v).toBe(CURRENT_SCHEMA_VERSION);
    expect(count(db, "SELECT COUNT(*) AS c FROM schema_version")).toBe(countsBefore.schema);
    expect(count(db, "SELECT COUNT(*) AS c FROM runs")).toBe(countsBefore.runs);
    expect(count(db, "SELECT COUNT(*) AS c FROM thread_events")).toBe(countsBefore.events);
    expect(count(db, "SELECT COUNT(*) AS c FROM evidence_summaries")).toBe(countsBefore.summaries);
  });

  it("rejects a snapshot whose source version drifted to 11", () => {
    const driftedSnapshot = loadV02SnapshotSql().replace(
      "INSERT INTO schema_version (version, applied_at) VALUES (10,",
      "INSERT INTO schema_version (version, applied_at) VALUES (11,",
    );
    expect(driftedSnapshot).not.toBe(loadV02SnapshotSql());

    const driftedDir = mkdtempSync(join(tmpdir(), "f009-v02-drift-"));
    try {
      const drifted = new Database(join(driftedDir, "v02-fixture.sqlite"));
      drifted.pragma("foreign_keys = ON");
      drifted.exec(driftedSnapshot);
      drifted.exec(loadV02SeedSql());
      expect(() => assertSchemaV10Shape(drifted)).toThrow(/Expected 10.*Received 11|to be 10/i);
      drifted.close();
    } finally {
      rmSync(driftedDir, { recursive: true, force: true });
    }
  });

  it("rejects a seed that lost an issue other rows reference", () => {
    const decapitatedSeed = loadV02SeedSql()
      .split("\n")
      .filter((line) => !line.includes("'iss_v02_running', 'prj_v02_alpha', 'ws_v02_alpha'"))
      .join("\n");
    expect(decapitatedSeed).not.toBe(loadV02SeedSql());

    const orphanDir = mkdtempSync(join(tmpdir(), "f009-v02-orphan-"));
    try {
      const orphan = new Database(join(orphanDir, "v02-fixture.sqlite"));
      orphan.pragma("foreign_keys = ON");
      orphan.exec(loadV02SnapshotSql());
      expect(() => orphan.exec(decapitatedSeed)).toThrow(/FOREIGN KEY/i);
      orphan.close();
    } finally {
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });
});
