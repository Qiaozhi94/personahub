export const SCHEMA_V6 = `
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
`;
