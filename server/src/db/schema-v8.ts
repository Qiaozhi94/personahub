export const SCHEMA_V8 = `
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
`;