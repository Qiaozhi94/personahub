-- PersonaHub v0.2 release schema (v10), extracted from source commit
-- 5ef5055 (5ef5055df20e3c61888082f3f11b43fe11e8467e) by
-- server/tests/fixtures/generate-v02-schema-snapshot.mjs. Do not edit by hand:
-- fingerprinted by server/tests/integration/f009-v02-fixture.test.ts.

-- ================= schema v1 =================

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_workspace_id TEXT,
  default_coordinator_agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  local_path TEXT NOT NULL,
  local_path_normalized TEXT NOT NULL,
  git_branch TEXT,
  lock_state TEXT NOT NULL DEFAULT 'idle',
  locked_by_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_project_path
  ON workspaces(project_id, local_path_normalized);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  collaboration_topology TEXT,
  agent_team_template_id TEXT,
  validation_policy_id TEXT,
  steps_json TEXT,
  handoff_policy_json TEXT,
  evidence_requirements_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  pass_conditions_json TEXT,
  fail_conditions_json TEXT,
  evidence_requirements_json TEXT,
  max_validation_rounds INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  primary_thread_id TEXT,
  issue_type TEXT NOT NULL DEFAULT 'coding',
  workflow_template_id TEXT NOT NULL,
  validation_policy_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'Inbox',
  owner_agent_id TEXT,
  coordinator_agent_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  labels TEXT,
  validation_round_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  room_id TEXT,
  thread_type TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_primary_unique
  ON threads(issue_id) WHERE thread_type = 'primary';

CREATE TABLE IF NOT EXISTS thread_events (
  id TEXT PRIMARY KEY,
  event_sequence INTEGER NOT NULL,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  payload_json TEXT NOT NULL,
  evidence_refs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_events_thread_seq
  ON thread_events(thread_id, event_sequence);

INSERT OR IGNORE INTO workflow_templates (id, name, issue_type, collaboration_topology, status, version, created_at, updated_at)
VALUES ('wft_coding_default', 'Coding Workflow', 'coding', 'sequential', 'active', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO validation_policies (id, name, issue_type, status, version, max_validation_rounds, created_at, updated_at)
VALUES ('vpl_coding_default', 'Coding Validation Policy', 'coding', 'active', 1, 3, datetime('now'), datetime('now'));

-- ================= schema v2 =================

CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'implementation',
  cli_provider TEXT NOT NULL DEFAULT 'codex',
  command TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '[]',
  capability_tags TEXT NOT NULL DEFAULT '[]',
  default_model TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_project
  ON agent_configs(project_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  adapter_config_id TEXT NOT NULL REFERENCES agent_configs(id),
  status TEXT NOT NULL DEFAULT 'queued',
  failure_reason TEXT,
  instructions TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  exit_code INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_workspace_status
  ON runs(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_runs_issue
  ON runs(issue_id, created_at DESC);

ALTER TABLE workspaces ADD COLUMN push_credentials_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN locked_at TEXT;

-- ================= schema v3 =================

CREATE TABLE IF NOT EXISTS run_trace_states (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  command_trace_capability TEXT NOT NULL DEFAULT 'unknown',
  baseline_status TEXT NOT NULL DEFAULT 'pending',
  scanner_type TEXT,
  baseline_json TEXT,
  baseline_error_code TEXT,
  baseline_captured_at TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_trace_states_unfinalized
  ON run_trace_states(finalized_at, baseline_status);

CREATE TABLE IF NOT EXISTS run_file_changes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  path TEXT NOT NULL,
  previous_path TEXT,
  change_type TEXT NOT NULL,
  before_fingerprint TEXT,
  after_fingerprint TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, path)
);

CREATE INDEX IF NOT EXISTS idx_run_file_changes_run_id
  ON run_file_changes(run_id, id);

-- ================= schema v4 =================

ALTER TABLE runs ADD COLUMN role TEXT NOT NULL DEFAULT 'implementation';
ALTER TABLE runs ADD COLUMN workflow_step TEXT;
ALTER TABLE runs ADD COLUMN validation_round INTEGER;
ALTER TABLE runs ADD COLUMN dispatch_source TEXT NOT NULL DEFAULT 'user_explicit';
ALTER TABLE runs ADD COLUMN final_message TEXT;
ALTER TABLE runs ADD COLUMN adapter_identity_json TEXT;

ALTER TABLE issues ADD COLUMN blocked_reason_code TEXT;
ALTER TABLE issues ADD COLUMN blocked_reason_message TEXT;

CREATE TABLE IF NOT EXISTS evidence_summaries (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  validator_run_id TEXT NOT NULL REFERENCES runs(id),
  implementation_run_id TEXT NOT NULL REFERENCES runs(id),
  validation_result TEXT NOT NULL,
  evidence_refs TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  same_origin_validation INTEGER NOT NULL,
  implementation_identity_json TEXT NOT NULL,
  validator_identity_json TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_snapshot_json TEXT NOT NULL,
  policy_snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_validator
  ON runs(issue_id)
  WHERE role = 'validator' AND status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_runs_issue_role_created
  ON runs(issue_id, role, created_at DESC);

UPDATE workflow_templates
SET steps_json = '{"schema_version":1,"steps":[{"id":"implementation","role":"implementation"},{"id":"validation","role":"validator"}]}', updated_at = datetime('now')
WHERE id = 'wft_coding_default' AND steps_json IS NULL;

UPDATE validation_policies
SET evidence_requirements_json = '{"schema_version":1,"require_handoff":true,"require_file_trace":true,"require_verification":true,"accepted_verification_kinds":["test","lint","typecheck","build"]}', updated_at = datetime('now')
WHERE id = 'vpl_coding_default' AND evidence_requirements_json IS NULL;

-- ================= schema v5 =================

-- Per-round validator uniqueness (defense-in-depth for the T093 service rule):
-- at most one validator Run per (issue, round), regardless of terminal status.
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_validator_per_round
  ON runs(issue_id, validation_round)
  WHERE role = 'validator' AND validation_round IS NOT NULL;

-- Rebuild evidence_summaries with invariant CHECK constraints. SQLite cannot
-- ALTER-ADD a CHECK, so the table is recreated and its rows copied over.
CREATE TABLE evidence_summaries_v5 (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL UNIQUE REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  validator_run_id TEXT NOT NULL REFERENCES runs(id),
  implementation_run_id TEXT NOT NULL REFERENCES runs(id),
  validation_result TEXT NOT NULL CHECK (validation_result = 'passed'),
  evidence_refs TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  same_origin_validation INTEGER NOT NULL CHECK (same_origin_validation IN (0, 1)),
  implementation_identity_json TEXT NOT NULL,
  validator_identity_json TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_snapshot_json TEXT NOT NULL,
  policy_snapshot_hash TEXT NOT NULL CHECK (policy_snapshot_hash LIKE 'sha256:%'),
  created_at TEXT NOT NULL
);
INSERT INTO evidence_summaries_v5 SELECT * FROM evidence_summaries;
DROP TABLE evidence_summaries;
ALTER TABLE evidence_summaries_v5 RENAME TO evidence_summaries;

-- ================= schema v6 =================

-- F005 manual multi-agent routing (docs/features/0.1/F005-multi-agent-manual-routing/design.md §4.1).

ALTER TABLE agent_configs ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'oauth';
ALTER TABLE agent_configs ADD COLUMN model_provider TEXT;
ALTER TABLE agent_configs ADD COLUMN api_key TEXT;
ALTER TABLE agent_configs ADD COLUMN auth_status_message TEXT;

ALTER TABLE projects ADD COLUMN default_adapter_config_id TEXT;

ALTER TABLE runs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'workflow_bound';
ALTER TABLE runs ADD COLUMN context_source_run_id TEXT;

ALTER TABLE issues ADD COLUMN validation_dispatch_due_at TEXT;

CREATE INDEX IF NOT EXISTS idx_issues_validation_due
  ON issues(status, validation_dispatch_due_at)
  WHERE status = 'Validating' AND validation_dispatch_due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runs_issue_purpose_created
  ON runs(issue_id, purpose, created_at DESC);

-- capability_tags backfill: only touches the empty-array state F002/F004 always
-- wrote (services/adapter-config.ts hardcoded capability_tags: [] until F005
-- T026). An adapter that already has a non-empty capability_tags value (e.g.
-- set by a later, already-migrated write) is left untouched.
UPDATE agent_configs
SET capability_tags = CASE WHEN role = 'validator' THEN '["validator"]' ELSE '["implementation"]' END
WHERE capability_tags = '[]';

-- default_adapter_config_id backfill: only when a Project has EXACTLY one
-- available adapter. Zero or two-or-more available adapters is left NULL —
-- this is a deliberate departure from "pick the first available adapter"
-- (design §7.1 explicitly forbids that heuristic: it would silently turn an
-- arbitrary row into a default the user never actually chose). Projects left
-- NULL here are resolved by the UI forcing an explicit choice on first
-- omitted-adapter dispatch (DEFAULT_ADAPTER_UNAVAILABLE, design §10.2).
UPDATE projects
SET default_adapter_config_id = (
  SELECT ac.id FROM agent_configs ac
  WHERE ac.project_id = projects.id AND ac.status = 'available'
)
WHERE default_adapter_config_id IS NULL
  AND (
    SELECT COUNT(*) FROM agent_configs ac
    WHERE ac.project_id = projects.id AND ac.status = 'available'
  ) = 1;

-- ================= schema v7 =================

-- Workspace-aware adapter availability (F005 code-review follow-up,
-- 2026-07-24). agent_configs.status stays the Project-global, conservative
-- baseline (used whenever no workspace is named) — this table only holds
-- EXCEPTIONS for a specific (adapter_config_id, workspace_id) pair whose
-- effective availability genuinely differs from that baseline (e.g. an
-- OpenCode OAuth adapter that's globally Unknown but confirmed Available in
-- one specific workspace with push_credentials_enabled=true). No row here
-- for a given pair means "no override — use the global status".

CREATE TABLE IF NOT EXISTS adapter_workspace_status (
  adapter_config_id TEXT NOT NULL REFERENCES agent_configs(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL,
  last_checked_at TEXT,
  auth_status_message TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (adapter_config_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_adapter_workspace_status_workspace
  ON adapter_workspace_status(workspace_id);

-- ================= schema v8 =================

-- F006: Orchestrated Coding Graph Slice — graph_runs + node_runs tables.
-- Runs are narrowed to Attempts (node_run_id FK), and graph-level
-- lifecycle is modelled in these two tables. See design.md §4.

CREATE TABLE IF NOT EXISTS graph_runs (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  definition_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  blocked_reason_code TEXT,
  blocked_node_keys TEXT,
  target_files_json TEXT NOT NULL,
  target_files_hash TEXT NOT NULL,
  target_files_truncated INTEGER NOT NULL DEFAULT 0,
  target_files_dropped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS node_runs (
  id TEXT PRIMARY KEY,
  graph_run_id TEXT NOT NULL REFERENCES graph_runs(id),
  node_key TEXT NOT NULL,
  status TEXT NOT NULL,
  join_satisfied_at TEXT,
  result_event_id TEXT REFERENCES thread_events(id),
  assigned_adapter_config_id TEXT NOT NULL REFERENCES agent_configs(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (graph_run_id, node_key)
);

ALTER TABLE runs ADD COLUMN node_run_id TEXT REFERENCES node_runs(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_runs_one_nonterminal_per_issue
  ON graph_runs(issue_id) WHERE status IN ('running', 'blocked', 'cancelling');

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_one_active_graph_attempt
  ON runs(node_run_id) WHERE node_run_id IS NOT NULL AND status IN ('queued', 'running');

-- ================= schema v9 =================

-- F007: Coordinator Agent & Routing Recommendation — intake_confirmations + app_secrets.
-- intake_confirmations records ONLY successfully-confirmed tokens (all columns
-- NOT NULL, no status column). The recommendation phase is strictly zero-write;
-- the confirmation token's only durable identity is the nonce column (design §1/§6).

CREATE TABLE IF NOT EXISTS intake_confirmations (
  nonce TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  recommendation_id TEXT NOT NULL,
  chosen_json TEXT NOT NULL,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('graph', 'run')),
  target_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);

-- app_secrets: token-signing HMAC key, co-lifespan with the database file
-- (no separate secret store or extra file to back up). Row created on first
-- boot and reused across restarts; corrupt/empty value is a fatal startup
-- error, never silently regenerated (design §1).
CREATE TABLE IF NOT EXISTS app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ================= schema v10 =================

-- F008: Workflow Template Admin & Runtime Health.
-- admin_audit_events: global audit ledger for workflow-template mutations. The
-- table carries no project_id / workspace_id because workflow_templates itself
-- has neither (schema-v1) — template edits happen before any affected Issue
-- exists, so there is no thread_event row to attach the audit to. actor_id is
-- always NULL: the app has no auth, so the ledger answers "when/what/which
-- version/what was acknowledged", never "who" (design §7).

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_version INTEGER,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Two invariants for workflow_templates, enforced at the database layer for
-- ALL writers (not just those that remember to call activate()):

-- 1. No two rows may share (issue_type, version) — blocks concurrent
--    insertVersion() both computing max(version)+1 and colliding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_issue_type_version
  ON workflow_templates(issue_type, version);

-- 2. At most one active row per issue_type — the single-active invariant.
--    The partial unique index makes it hold for every write path, even a
--    naive INSERT with status='active' that never deactivates its siblings.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_templates_one_active
  ON workflow_templates(issue_type) WHERE status = 'active';

-- ================= schema_version bookkeeping =================
-- applyMigrations() owns this table in live databases; the snapshot pins
-- the recorded chain at 1..10 so the file is a complete v10 database.
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
INSERT INTO schema_version (version, applied_at) VALUES (1, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (2, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (3, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (4, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (5, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (6, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (7, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (8, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (9, '2026-08-09T12:26:55.000Z');
INSERT INTO schema_version (version, applied_at) VALUES (10, '2026-08-09T12:26:55.000Z');
