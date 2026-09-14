// F012 T002/T003/T004/T005 (AC-002/AC-004): schema v15 migration — each task
// pins its own touchpoints here as the migration grows. T002 section: the
// runtime_machines single-machine root and the agent_configs binding columns
// (runtime_id NOT NULL DEFAULT 'local', nullable base_url).

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../../src/db/migrations.js";
import { validateBaseUrl } from "../../src/services/adapter-config-contract.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

describe("F012 schema v15 migration (T002)", () => {
  it("fresh install lands on the head version with the runtime root seeded", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number };
    expect(row.v).toBe(CURRENT_SCHEMA_VERSION);

    const machine = db.prepare("SELECT id, label, kind FROM runtime_machines WHERE id = 'local'").get() as {
      id: string;
      label: string;
      kind: string;
    };
    expect(machine).toEqual({ id: "local", label: "This machine", kind: "local" });
    db.close();
  });

  it("agent_configs gains runtime_id NOT NULL DEFAULT 'local' and nullable base_url", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const columns = db.prepare("PRAGMA table_info(agent_configs)").all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const runtimeId = columns.find((c) => c.name === "runtime_id");
    const baseUrl = columns.find((c) => c.name === "base_url");
    expect(runtimeId).toBeDefined();
    expect(runtimeId!.notnull).toBe(1);
    expect(runtimeId!.dflt_value).toBe("'local'");
    expect(baseUrl).toBeDefined();

    // A row inserted without touching the new columns binds to 'local' and has
    // no endpoint — the "no unbound third state" rule (ADR 0015 §1).
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_x', 'P', (SELECT id FROM spaces WHERE is_default = 1), '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, created_at, updated_at) VALUES ('agt_x', 'prj_x', 'Codex', 'implementation', 'codex', 'codex', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    const adapter = db.prepare("SELECT runtime_id, base_url FROM agent_configs WHERE id = 'agt_x'").get() as {
      runtime_id: string;
      base_url: string | null;
    };
    expect(adapter.runtime_id).toBe("local");
    expect(adapter.base_url).toBeNull();
    db.close();
  });
});

describe("F012 schema v15 migration (T003 rooms backfill)", () => {
  /** Roll the DB back to a v14 state so the v15 replay can be exercised. */
  function undoV15(db: Database.Database): void {
    db.exec("DROP TABLE IF EXISTS dispatch_capability_snapshots");
    db.exec("DROP TABLE IF EXISTS dispatch_context_snapshots");
    db.exec("DROP TABLE IF EXISTS attempts");
    db.exec("DROP TABLE IF EXISTS dispatches");
    db.exec("DROP TABLE IF EXISTS adapter_capability_evidence");
    db.exec("DROP TABLE IF EXISTS domain_outbox_acks");
    db.exec("DROP TABLE IF EXISTS domain_outbox");
    db.exec("DROP TABLE IF EXISTS dispatch_gates");
    db.exec("DROP TRIGGER IF EXISTS trg_dispatch_issue_matches_room");
    db.exec("DROP TABLE IF EXISTS rooms");
    db.exec("DROP INDEX IF EXISTS idx_threads_room");
    db.exec("DROP TABLE IF EXISTS runtime_machines");
    db.exec("ALTER TABLE agent_configs DROP COLUMN runtime_id");
    db.exec("ALTER TABLE agent_configs DROP COLUMN base_url");
    db.prepare("DELETE FROM schema_version WHERE version = 15").run();
  }

  function insertLegacyThread(db: Database.Database, threadId: string, issueId: string, title: string): string {
    const spaceId = (db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(`prj_${threadId}`, "P", spaceId);
    db.prepare(
      "INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES (?, ?, '/tmp/x', '/tmp/x', 'idle', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(`wsp_${threadId}`, `prj_${threadId}`);
    db.prepare(
      "INSERT INTO issues (id, project_id, workspace_id, space_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, validation_round_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'coding', 'wft_coding_default', 'vpl_coding_default', ?, 'Inbox', 'normal', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(issueId, `prj_${threadId}`, `wsp_${threadId}`, spaceId, title);
    db.prepare(
      "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES (?, ?, NULL, 'primary', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(threadId, issueId, title);
    return spaceId;
  }

  it("a real v14 database backfills exactly one room per historical thread and keeps thread IDs", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyMigrations(db);
    undoV15(db);
    const spaceId = insertLegacyThread(db, "thr_legacy_1", "iss_legacy_1", "Fix the login bug");
    insertLegacyThread(db, "thr_legacy_2", "iss_legacy_2", "Write the docs");
    applyMigrations(db);

    const rows = db
      .prepare(
        `SELECT t.id AS thread_id, t.room_id, r.space_id, r.issue_id, r.title, r.state
         FROM threads t JOIN rooms r ON r.id = t.room_id ORDER BY t.id`,
      )
      .all() as Array<{ thread_id: string; room_id: string; space_id: string; issue_id: string; title: string; state: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.thread_id)).toEqual(["thr_legacy_1", "thr_legacy_2"]);
    for (const row of rows) {
      expect(row.room_id).toMatch(/^room_/);
      expect(row.space_id).toBe(spaceId);
      expect(row.state).toBe("active");
    }
    expect(rows[0].issue_id).toBe("iss_legacy_1");
    expect(rows[0].title).toBe("Fix the login bug");

    // The 1:1 partial index is in place: a second thread cannot claim a room.
    expect(() =>
      db.prepare(
        "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_x', 'iss_legacy_1', ?, 'primary', 'dup', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')",
      ).run(rows[0].room_id),
    ).toThrow();
    db.close();
  });

  it("backfill is idempotent — threads that already carry a room are left alone", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const roomCount = (db.prepare("SELECT COUNT(*) AS c FROM rooms").get() as { c: number }).c;
    const linked = (db.prepare("SELECT COUNT(*) AS c FROM threads WHERE room_id IS NOT NULL").get() as { c: number }).c;
    expect(linked).toBe(roomCount);
    db.close();
  });
});

describe("F012 schema v15 migration (T004 dispatch/attempts/snapshots)", () => {
  interface Graph {
    db: Database.Database;
    roomId: string;
    issueId: string;
    adapterId: string;
  }

  function buildGraph(db: Database.Database): Graph {
    const spaceId = (db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_g', 'P', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(spaceId);
    db.prepare(
      "INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES ('wsp_g', 'prj_g', '/tmp/g', '/tmp/g', 'idle', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO issues (id, project_id, workspace_id, space_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, validation_round_count, created_at, updated_at) VALUES ('iss_g', 'prj_g', 'wsp_g', ?, 'coding', 'wft_coding_default', 'vpl_coding_default', 'G', 'Inbox', 'normal', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(spaceId);
    db.prepare(
      "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_g', 'iss_g', NULL, 'primary', 'G', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_g', ?, 'iss_g', 'G', 'active', '2026-01-01T00:00:00Z', NULL)",
    ).run(spaceId);
    db.prepare(
      "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, created_at, updated_at) VALUES ('adp_g', 'prj_g', 'codex-gpt5.6-high', 'implementation', 'codex', 'codex', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    return { db, roomId: "room_g", issueId: "iss_g", adapterId: "adp_g" };
  }

  const DISPATCH_COLUMNS = `(id, room_id, issue_id, client_request_id, state, purpose, runtime_id, adapter_config_id, access_ref, model, depth_raw, depth_normalized, identity_snapshot_json, context_scope, skill_revision_refs_json, effective_requirements_json, effective_requirements_hash, handoff_refs_json, task_scope_json, requirement_override_json, grace_deadline_at, created_at)`;

  function dispatchValues(g: Graph, overrides: Record<string, string | null> = {}): Record<string, string | null> {
    return {
      id: "dsp_1", room_id: g.roomId, issue_id: g.issueId, client_request_id: "crq_1", state: "draft",
      purpose: "execute", runtime_id: "local", adapter_config_id: g.adapterId, access_ref: null,
      model: "gpt-5.6-sol", depth_raw: "high", depth_normalized: "high", identity_snapshot_json: "{}",
      context_scope: "all", skill_revision_refs_json: "[]", effective_requirements_json: "{}",
      effective_requirements_hash: "sha256:x", handoff_refs_json: "[]", task_scope_json: null,
      requirement_override_json: null, grace_deadline_at: "2026-01-01T00:00:10Z", created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  function insertDispatch(g: Graph, overrides: Record<string, string | null> = {}): void {
    g.db.prepare(
      `INSERT INTO dispatches ${DISPATCH_COLUMNS} VALUES (@id, @room_id, @issue_id, @client_request_id, @state, @purpose, @runtime_id, @adapter_config_id, @access_ref, @model, @depth_raw, @depth_normalized, @identity_snapshot_json, @context_scope, @skill_revision_refs_json, @effective_requirements_json, @effective_requirements_hash, @handoff_refs_json, @task_scope_json, @requirement_override_json, @grace_deadline_at, @created_at)`,
    ).run(dispatchValues(g, overrides));
  }

  it("accepts a draft dispatch and enforces the (room_id, client_request_id) idempotency key", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const g = buildGraph(db);
    insertDispatch(g);
    // The unique index rejects the duplicate row; idempotent replay (returning
    // the winner's draft) is the service layer's job in T010.
    expect(() => insertDispatch(g, { id: "dsp_2" })).toThrow(/UNIQUE constraint failed/);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM dispatches").get() as { c: number }).c;
    expect(count).toBe(1);
    db.close();
  });

  it("trigger keeps dispatches.issue_id consistent with rooms.issue_id (design §3.2)", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const g = buildGraph(db);
    expect(() => insertDispatch(g, { id: "dsp_bad", issue_id: "iss_other" })).toThrow(/DISPATCH_ISSUE_MISMATCH/);
    // a task-bound room also rejects a NULL issue_id (NULL vs 'iss_g' mismatch)
    expect(() => insertDispatch(g, { id: "dsp_null", issue_id: null })).toThrow(/DISPATCH_ISSUE_MISMATCH/);
    db.close();
  });

  it("enforces state and purpose CHECKs, and 1:1 attempt→run with (dispatch, seq) uniqueness", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const g = buildGraph(db);
    expect(() => insertDispatch(g, { state: "running" })).toThrow();
    expect(() => insertDispatch(g, { purpose: "chat" })).toThrow();

    insertDispatch(g, { state: "dispatched" });
    db.prepare(
      "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_r', 'iss_g', NULL, 'room', 'r', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, instructions, created_at, updated_at) VALUES ('run_1', 'iss_g', 'thr_r', 'wsp_g', 'adp_g', 'do', '2026-01-01T00:00:01Z', '2026-01-01T00:00:01Z')",
    ).run();
    db.prepare(
      "INSERT INTO attempts (id, dispatch_id, seq, run_id, state, start_mode, created_at) VALUES ('atm_1', 'dsp_1', 1, 'run_1', 'queued', 'cold', '2026-01-01T00:00:01Z')",
    ).run();
    db.prepare(
      "INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, instructions, created_at, updated_at) VALUES ('run_2', 'iss_g', 'thr_r', 'wsp_g', 'adp_g', 'do', '2026-01-01T00:00:02Z', '2026-01-01T00:00:02Z')",
    ).run();
    expect(() => {
      db.prepare(
        "INSERT INTO attempts (id, dispatch_id, seq, run_id, state, start_mode, created_at) VALUES ('atm_2', 'dsp_1', 1, 'run_2', 'queued', 'cold', '2026-01-01T00:00:02Z')",
      ).run();
    }).toThrow(); // duplicate (dispatch, seq)
    expect(() => {
      db.prepare(
        "INSERT INTO attempts (id, dispatch_id, seq, run_id, state, start_mode, created_at) VALUES ('atm_3', 'dsp_1', 2, 'run_1', 'queued', 'cold', '2026-01-01T00:00:03Z')",
      ).run();
    }).toThrow(); // run already owned by atm_1
    db.close();
  });
});

describe("F012 schema v15 migration (T005 gates / T006 outbox tables)", () => {
  it("seeds the runtime gate row at ('runtime','local','open') with revision 0", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const gate = db
      .prepare("SELECT scope_type, scope_id, state, revision, actor FROM dispatch_gates")
      .get() as { scope_type: string; scope_id: string; state: string; revision: number; actor: string };
    expect(gate).toEqual({ scope_type: "runtime", scope_id: "local", state: "open", revision: 0, actor: "system" });
    db.close();
  });

  it("rejects unknown gate scopes and states", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    expect(() =>
      db.prepare(
        "INSERT INTO dispatch_gates (scope_type, scope_id, state, revision, reason, actor, updated_at) VALUES ('machine', 'm1', 'open', 0, NULL, 'u', '2026-01-01T00:00:00Z')",
      ).run(),
    ).toThrow();
    expect(() =>
      db.prepare(
        "INSERT INTO dispatch_gates (scope_type, scope_id, state, revision, reason, actor, updated_at) VALUES ('issue', 'iss_1', 'frozen', 0, NULL, 'u', '2026-01-01T00:00:00Z')",
      ).run(),
    ).toThrow();
    db.close();
  });

  it("outbox dedupe key absorbs a second enqueue of the same domain fact", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const insert = db.prepare(
      "INSERT INTO domain_outbox (id, topic, payload_json, dedupe_key, status, attempts, available_at, created_at) VALUES (?, 'dispatch.test', '{}', ?, 'pending', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    );
    insert.run("obx_1", "dispatch:dsp_1:dispatched");
    expect(() => insert.run("obx_2", "dispatch:dsp_1:dispatched")).toThrow(/UNIQUE constraint failed/);
    // per-(event, consumer) acks are individually unique but coexist
    const ack = db.prepare("INSERT INTO domain_outbox_acks (event_id, consumer, acked_at) VALUES (?, ?, '2026-01-01T00:00:01Z')");
    ack.run("obx_1", "sse-broadcast");
    ack.run("obx_1", "issue-service");
    expect(() => ack.run("obx_1", "sse-broadcast")).toThrow(/UNIQUE constraint failed/);
    db.close();
  });
});

describe("base_url contract shape (T002, ADR 0012)", () => {
  it("accepts empty/undefined as NULL and preserves https URLs", () => {
    expect(validateBaseUrl(undefined)).toBeNull();
    expect(validateBaseUrl(null)).toBeNull();
    expect(validateBaseUrl("  ")).toBeNull();
    expect(validateBaseUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("allows http:// only for loopback hosts", () => {
    expect(validateBaseUrl("http://localhost:4096")).toBe("http://localhost:4096");
    expect(validateBaseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(validateBaseUrl("http://[::1]:9000")).toBe("http://[::1]:9000");
    expect(() => validateBaseUrl("http://api.example.com")).toThrow(AppError);
    expect(() => validateBaseUrl("http://192.168.1.10")).toThrow(AppError);
  });

  it("rejects non-http(s) schemes and unparseable values with a stable code", () => {
    expect(() => validateBaseUrl("ftp://files.example.com")).toThrow(AppError);
    try {
      validateBaseUrl("not a url");
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ADAPTER_BASE_URL_INVALID);
      expect((error as AppError).field).toBe("base_url");
    }
  });
});
