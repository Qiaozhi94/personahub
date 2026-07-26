export const SCHEMA_V7 = `
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
`;
