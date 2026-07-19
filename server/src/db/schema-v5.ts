export const SCHEMA_V5 = `
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
`;
