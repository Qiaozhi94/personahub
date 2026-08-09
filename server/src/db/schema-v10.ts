export const SCHEMA_V10 = `
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
`;
