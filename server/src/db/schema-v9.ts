export const SCHEMA_V9 = `
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
`;
