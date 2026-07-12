export const SCHEMA_V1 = `
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
`;
