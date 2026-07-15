export const SCHEMA_V2 = `
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
`;
