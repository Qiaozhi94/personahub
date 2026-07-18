export const SCHEMA_V3 = `
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
`;
