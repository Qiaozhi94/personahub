// F012 schema v15 (design §3) — all new tables, column extensions and
// backfills in ONE migration, built up across T002–T005.
//
// T002: `runtime_machines` single-machine root (ADR 0015) and explicit
// `agent_configs` binding columns — `runtime_id` NOT NULL DEFAULT 'local' (no
// "unbound" third state) and nullable `base_url` (ADR 0012 落地表: official
// endpoints genuinely omit it, never a fake string).
//
// T003: `rooms` + threads 1:1 backfill. threads.room_id already exists since
// schema-v1 (no FK, historically all NULL) — the design's ALTER TABLE ADD
// COLUMN is therefore skipped; see design §3.1 implementation note. Every
// historical thread gets exactly one room and keeps its ID untouched
// (不变量 8); the partial unique index enforces 1:1 going forward.

import type Database from "better-sqlite3";
import { generateRoomId } from "../id.js";

const T002_SQL = `
CREATE TABLE IF NOT EXISTS runtime_machines (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO runtime_machines (id, label, kind, created_at)
VALUES ('local', 'This machine', 'local', datetime('now'));

ALTER TABLE agent_configs ADD COLUMN runtime_id TEXT NOT NULL DEFAULT 'local';
ALTER TABLE agent_configs ADD COLUMN base_url TEXT;
`;

const T003_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  space_id    TEXT NOT NULL REFERENCES spaces(id),
  issue_id    TEXT     REFERENCES issues(id),   -- NULL = 独立会话
  title       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('active','ended')),
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_room ON threads(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_issue ON rooms(issue_id);
`;

// T004: dispatches / attempts / snapshots (design §3.2–§3.4). The idempotency
// key is (room_id, client_request_id) — room_id is never NULL (independent
// sessions have one too), so the unique index is safe under SQLite's
// NULL != NULL semantics; issue_id is a redundant query column kept consistent
// by the trigger below.
const T004_SQL = `
CREATE TABLE IF NOT EXISTS dispatches (
  id                        TEXT PRIMARY KEY,
  room_id                   TEXT NOT NULL REFERENCES rooms(id),
  issue_id                  TEXT     REFERENCES issues(id),
  client_request_id         TEXT NOT NULL,
  state                     TEXT NOT NULL CHECK (state IN ('draft','cancelled','starting','dispatched','start_failed')),
  purpose                   TEXT NOT NULL CHECK (purpose IN ('execute','validate','design_cases')),
  runtime_id                TEXT NOT NULL DEFAULT 'local' REFERENCES runtime_machines(id),
  adapter_config_id         TEXT NOT NULL REFERENCES agent_configs(id),
  access_ref                TEXT,
  model                     TEXT NOT NULL,
  depth_raw                 TEXT NOT NULL,
  depth_normalized          TEXT NOT NULL CHECK (depth_normalized IN ('high','medium','low')),
  identity_snapshot_json    TEXT NOT NULL,
  context_scope             TEXT NOT NULL CHECK (context_scope IN ('all','result_only','goal_only')),
  skill_revision_refs_json  TEXT NOT NULL,
  effective_requirements_json TEXT NOT NULL,
  effective_requirements_hash TEXT NOT NULL,
  handoff_refs_json         TEXT NOT NULL,
  task_scope_json           TEXT,
  requirement_override_json TEXT,
  grace_deadline_at         TEXT NOT NULL,
  lease_owner               TEXT,
  lease_expires_at          TEXT,
  graph_node_run_id         TEXT     REFERENCES node_runs(id),
  failed_reason_code        TEXT,
  failed_diagnostics_json   TEXT,
  created_at                TEXT NOT NULL,
  started_at                TEXT,
  ended_at                  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_idem ON dispatches(room_id, client_request_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_open ON dispatches(state, grace_deadline_at) WHERE state IN ('draft','starting');
CREATE INDEX IF NOT EXISTS idx_dispatch_issue ON dispatches(issue_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_dispatch_issue_matches_room
  BEFORE INSERT ON dispatches
  FOR EACH ROW
  WHEN (SELECT issue_id FROM rooms WHERE id = NEW.room_id) IS NOT NEW.issue_id
BEGIN
  SELECT RAISE(ABORT, 'DISPATCH_ISSUE_MISMATCH');
END;

CREATE TABLE IF NOT EXISTS attempts (
  id                      TEXT PRIMARY KEY,
  dispatch_id             TEXT NOT NULL REFERENCES dispatches(id),
  seq                     INTEGER NOT NULL,
  run_id                  TEXT NOT NULL REFERENCES runs(id),
  state                   TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled','interrupted')),
  start_mode              TEXT NOT NULL CHECK (start_mode IN ('cold','resumed')),
  resumed_from_attempt_id TEXT     REFERENCES attempts(id),
  provider_session_id     TEXT,
  cold_start_reason       TEXT,
  created_at              TEXT NOT NULL,
  ended_at                TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_seq ON attempts(dispatch_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_run ON attempts(run_id);

CREATE TABLE IF NOT EXISTS adapter_capability_evidence (
  id              TEXT PRIMARY KEY,
  cli_provider    TEXT NOT NULL,
  cli_version     TEXT NOT NULL,
  capability_key  TEXT NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('supported','unsupported','unverified')),
  probe_command   TEXT NOT NULL,
  probe_result    TEXT NOT NULL,
  probed_at       TEXT NOT NULL,
  missing_reason  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_current
  ON adapter_capability_evidence(cli_provider, cli_version, capability_key);

CREATE TABLE IF NOT EXISTS dispatch_context_snapshots (
  dispatch_id  TEXT PRIMARY KEY REFERENCES dispatches(id),
  scope        TEXT NOT NULL,
  items_json   TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  assembled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatch_capability_snapshots (
  dispatch_id    TEXT NOT NULL REFERENCES dispatches(id),
  capability_key TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('supported','unsupported','unverified')),
  evidence_id    TEXT NOT NULL REFERENCES adapter_capability_evidence(id),
  consequence    TEXT NOT NULL,
  PRIMARY KEY (dispatch_id, capability_key)
);
`;

// T005: three-layer dispatch gates (design §3.6). The runtime row is seeded so
// "暂停全部派工" reads a stable row from the start; revision is monotonic and
// participates in claim linearization (§5.4).
const T005_SQL = `
CREATE TABLE IF NOT EXISTS dispatch_gates (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('runtime','issue','graph')),
  scope_id   TEXT NOT NULL,
  state      TEXT NOT NULL CHECK (state IN ('open','paused')),
  revision   INTEGER NOT NULL,
  reason     TEXT,
  actor      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);

INSERT OR IGNORE INTO dispatch_gates (scope_type, scope_id, state, revision, reason, actor, updated_at)
VALUES ('runtime', 'local', 'open', 0, 'seeded', 'system', datetime('now'));
`;

// T006: persistent DomainOutbox (FR-009, 不变量 13) — F012 is its only owner;
// F011's acceptance.completed reuse is a consumer, never a second outbox.
const T006_SQL = `
CREATE TABLE IF NOT EXISTS domain_outbox (
  id               TEXT PRIMARY KEY,
  topic            TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  dedupe_key       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','in_flight','delivered','poison')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  available_at     TEXT NOT NULL,
  claimed_by       TEXT,
  claim_expires_at TEXT,
  last_error_code  TEXT,
  last_error_detail TEXT,
  created_at       TEXT NOT NULL,
  delivered_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_dedupe ON domain_outbox(topic, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_outbox_ready ON domain_outbox(status, available_at);

CREATE TABLE IF NOT EXISTS domain_outbox_acks (
  event_id  TEXT NOT NULL REFERENCES domain_outbox(id),
  consumer  TEXT NOT NULL,
  acked_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, consumer)
);
`;

/**
 * One room per historical thread; issue/space/title derive from the thread's
 * Issue (design §3.1 回填规则). Runs inside the migration transaction; the
 * 1:1 is guaranteed by construction here and by idx_threads_room afterwards.
 */
function backfillRooms(db: Database.Database): void {
  const threads = db
    .prepare(
      `SELECT t.id AS thread_id, t.issue_id, i.space_id, i.title
       FROM threads t JOIN issues i ON i.id = t.issue_id
       WHERE t.room_id IS NULL
       ORDER BY t.created_at ASC, t.id ASC`,
    )
    .all() as Array<{ thread_id: string; issue_id: string; space_id: string; title: string }>;

  const insertRoom = db.prepare(
    "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES (?, ?, ?, ?, 'active', ?, NULL)",
  );
  const linkThread = db.prepare("UPDATE threads SET room_id = ? WHERE id = ?");
  for (const thread of threads) {
    const roomId = generateRoomId();
    insertRoom.run(roomId, thread.space_id, thread.issue_id, thread.title, new Date().toISOString());
    linkThread.run(roomId, thread.thread_id);
  }
}

export function applyV15(db: Database.Database): void {
  db.transaction(() => {
    db.exec(T002_SQL);
    db.exec(T003_SQL);
    db.exec(T004_SQL);
    db.exec(T005_SQL);
    db.exec(T006_SQL);
    backfillRooms(db);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (15, ?)").run(new Date().toISOString());
  })();
}
