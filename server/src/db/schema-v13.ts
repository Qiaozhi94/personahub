export const SCHEMA_V13 = `
-- F010: Artifact & Provenance Foundation. Frozen contract in
-- docs/features/0.3/F010-artifact-foundation-provenance/design.md §3; this
-- migration is its SQL projection. Forward-only: new tables and indexes only,
-- no existing column is touched.

-- artifacts: the addressable entity. issue_id is the v0.3 sole ownership
-- column (Project / Workspace derive from the Issue); thread_id owns creation
-- and event replay. current_revision is a pure pointer — it is set to 1 by the
-- create transaction after revision 1 publishes and never refers to a draft.
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'retired')),
  current_revision INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- artifact_revisions: published content only. Rows are immutable — no writer
-- may UPDATE content columns; a new revision is a new row. storage payloads
-- are mutually exclusive at the DB layer: inline fills only the body, a
-- workspace file fills both locators (source = mutable provenance pointer,
-- archive = immutable content-addressed copy the resolver reads).
CREATE TABLE IF NOT EXISTS artifact_revisions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('inline_markdown', 'workspace_file')),
  inline_content TEXT,
  source_relative_path TEXT,
  archive_relative_path TEXT,
  content_hash TEXT NOT NULL,
  source_run_id TEXT REFERENCES runs(id),
  created_by TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, revision),
  UNIQUE (artifact_id, idempotency_key),
  CHECK (
    (storage_kind = 'inline_markdown'
      AND inline_content IS NOT NULL
      AND source_relative_path IS NULL
      AND archive_relative_path IS NULL)
    OR
    (storage_kind = 'workspace_file'
      AND inline_content IS NULL
      AND source_relative_path IS NOT NULL
      AND archive_relative_path IS NOT NULL)
  )
);

-- artifact_consumptions: which dispatch/run actually read which revision.
-- Idempotency granularity is the full PK (dispatch, run, revision, purpose):
-- a replayed recordConsumption returns the original row, and a continued
-- dispatch under a new Run records its own row so Run -> Artifact lookups
-- never miss. dispatch_id is a deliberate soft reference — the dispatches
-- table is owned by F012 and does not exist yet; F012 must validate dispatch
-- existence and run ownership inside its transaction (design §3).
CREATE TABLE IF NOT EXISTS artifact_consumptions (
  artifact_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  dispatch_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  purpose TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  PRIMARY KEY (dispatch_id, run_id, artifact_id, revision, purpose),
  FOREIGN KEY (artifact_id, revision) REFERENCES artifact_revisions(artifact_id, revision)
);

-- artifact_evidence_links: relation rows only — no Evidence/Run state is
-- copied. Both directions (Artifact -> Evidence and Evidence -> Artifact) read
-- this same table.
CREATE TABLE IF NOT EXISTS artifact_evidence_links (
  artifact_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  evidence_ref TEXT NOT NULL,
  PRIMARY KEY (artifact_id, revision, evidence_ref),
  FOREIGN KEY (artifact_id, revision) REFERENCES artifact_revisions(artifact_id, revision)
);

-- artifact_maintenance_leases: DB-level CAS leases. Only the orphan sweeper
-- takes the 'archive-maintenance' lease; publication never participates, so
-- distinct Artifacts can publish concurrently (design §3).
CREATE TABLE IF NOT EXISTS artifact_maintenance_leases (
  name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

-- idx_artifact_consumptions_run backs GET /api/runs/:id/artifacts,
-- idx_artifacts_issue backs GET /api/artifacts?issue_id=..., and
-- idx_artifact_evidence_links_ref backs GET /api/evidence/artifacts?ref=... .
-- None of these query keys is a leftmost prefix of the respective primary
-- key, so each query has its own index (design §3) instead of a table scan.
CREATE INDEX IF NOT EXISTS idx_artifact_consumptions_run
  ON artifact_consumptions(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_issue
  ON artifacts(issue_id, state);
CREATE INDEX IF NOT EXISTS idx_artifact_evidence_links_ref
  ON artifact_evidence_links(evidence_ref);
`;
