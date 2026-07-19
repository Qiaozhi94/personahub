export const SCHEMA_V4 = `
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
`;
