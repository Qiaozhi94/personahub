import type Database from "better-sqlite3";
import type {
  Artifact,
  ArtifactState,
  ArtifactStorageKind,
  ArtifactRevision,
  ArtifactConsumption,
  ArtifactEvidenceLink,
} from "@personahub/shared/types";

/**
 * F010 Artifact repository. Not exported to routes or F012 — `ArtifactService`
 * (writes) and `ArtifactResolver` (reads) are the only callers (design §2).
 * Revision content columns are never UPDATEd; a new revision is a new row.
 */

interface ArtifactRow {
  id: string;
  issue_id: string;
  thread_id: string;
  type: string;
  title: string;
  state: string;
  current_revision: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  artifact_id: string;
  revision: number;
  storage_kind: string;
  inline_content: string | null;
  source_relative_path: string | null;
  archive_relative_path: string | null;
  content_hash: string;
  source_run_id: string | null;
  created_by: string;
  idempotency_key: string;
  request_fingerprint: string;
  created_at: string;
}

interface ConsumptionRow {
  artifact_id: string;
  revision: number;
  dispatch_id: string;
  run_id: string;
  purpose: string;
  consumed_at: string;
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    issue_id: row.issue_id,
    thread_id: row.thread_id,
    type: row.type,
    title: row.title,
    state: row.state as ArtifactState,
    current_revision: row.current_revision,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRevision(row: RevisionRow): ArtifactRevision {
  return {
    artifact_id: row.artifact_id,
    revision: row.revision,
    storage_kind: row.storage_kind as ArtifactStorageKind,
    inline_content: row.inline_content,
    source_relative_path: row.source_relative_path,
    archive_relative_path: row.archive_relative_path,
    content_hash: row.content_hash,
    source_run_id: row.source_run_id,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function mapConsumption(row: ConsumptionRow): ArtifactConsumption {
  return {
    artifact_id: row.artifact_id,
    revision: row.revision,
    dispatch_id: row.dispatch_id,
    run_id: row.run_id,
    purpose: row.purpose,
    consumed_at: row.consumed_at,
  };
}

export interface ArtifactLease {
  name: string;
  owner_id: string;
  expires_at_ms: number;
}

export class ArtifactRepository {
  constructor(private db: Database.Database) {}

  // -- artifacts ------------------------------------------------------------

  createArtifact(row: Artifact): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (id, issue_id, thread_id, type, title, state, current_revision, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.issue_id,
        row.thread_id,
        row.type,
        row.title,
        row.state,
        row.current_revision,
        row.created_by,
        row.created_at,
        row.updated_at,
      );
  }

  getArtifact(id: string): Artifact | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
    return row ? mapArtifact(row) : null;
  }

  listByIssue(issueId: string): Artifact[] {
    const rows = this.db
      .prepare("SELECT * FROM artifacts WHERE issue_id = ? ORDER BY created_at ASC, id ASC")
      .all(issueId) as ArtifactRow[];
    return rows.map(mapArtifact);
  }

  /** Pointer CAS. `expected = null` matches a not-yet-published pointer
   *  (create path); a number must match exactly (revise path). */
  advanceCurrentRevisionCas(artifactId: string, expected: number | null, next: number, updatedAt: string): boolean {
    const result =
      expected === null
        ? this.db
            .prepare("UPDATE artifacts SET current_revision = ?, updated_at = ? WHERE id = ? AND current_revision IS NULL")
            .run(next, updatedAt, artifactId)
        : this.db
            .prepare("UPDATE artifacts SET current_revision = ?, updated_at = ? WHERE id = ? AND current_revision = ?")
            .run(next, updatedAt, artifactId, expected);
    return result.changes === 1;
  }

  retireArtifact(id: string, updatedAt: string): void {
    this.db.prepare("UPDATE artifacts SET state = 'retired', updated_at = ? WHERE id = ?").run(updatedAt, id);
  }

  // -- revisions ------------------------------------------------------------

  insertRevision(row: RevisionRow): void {
    this.db
      .prepare(
        `INSERT INTO artifact_revisions
           (artifact_id, revision, storage_kind, inline_content, source_relative_path, archive_relative_path,
            content_hash, source_run_id, created_by, idempotency_key, request_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.artifact_id,
        row.revision,
        row.storage_kind,
        row.inline_content,
        row.source_relative_path,
        row.archive_relative_path,
        row.content_hash,
        row.source_run_id,
        row.created_by,
        row.idempotency_key,
        row.request_fingerprint,
        row.created_at,
      );
  }

  getRevision(artifactId: string, revision: number): ArtifactRevision | null {
    const row = this.db
      .prepare("SELECT * FROM artifact_revisions WHERE artifact_id = ? AND revision = ?")
      .get(artifactId, revision) as RevisionRow | undefined;
    return row ? mapRevision(row) : null;
  }

  getRevisionByIdempotencyKey(artifactId: string, idempotencyKey: string): ArtifactRevision | null {
    const row = this.db
      .prepare("SELECT * FROM artifact_revisions WHERE artifact_id = ? AND idempotency_key = ?")
      .get(artifactId, idempotencyKey) as RevisionRow | undefined;
    return row ? mapRevision(row) : null;
  }

  listRevisions(artifactId: string): ArtifactRevision[] {
    const rows = this.db
      .prepare("SELECT * FROM artifact_revisions WHERE artifact_id = ? ORDER BY revision ASC")
      .all(artifactId) as RevisionRow[];
    return rows.map(mapRevision);
  }

  /** Every archive locator referenced by any published revision — the
   *  manifest back-check the orphan sweeper relies on. */
  listReferencedArchivePaths(): string[] {
    const rows = this.db
      .prepare("SELECT archive_relative_path FROM artifact_revisions WHERE archive_relative_path IS NOT NULL")
      .all() as Array<{ archive_relative_path: string }>;
    return rows.map((r) => r.archive_relative_path);
  }

  // -- consumptions ---------------------------------------------------------

  insertConsumption(row: ConsumptionRow): void {
    this.db
      .prepare(
        `INSERT INTO artifact_consumptions (artifact_id, revision, dispatch_id, run_id, purpose, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.artifact_id, row.revision, row.dispatch_id, row.run_id, row.purpose, row.consumed_at);
  }

  getConsumption(
    dispatchId: string,
    runId: string,
    artifactId: string,
    revision: number,
    purpose: string,
  ): ArtifactConsumption | null {
    const row = this.db
      .prepare(
        `SELECT * FROM artifact_consumptions
         WHERE dispatch_id = ? AND run_id = ? AND artifact_id = ? AND revision = ? AND purpose = ?`,
      )
      .get(dispatchId, runId, artifactId, revision, purpose) as ConsumptionRow | undefined;
    return row ? mapConsumption(row) : null;
  }

  listConsumptionsByArtifact(artifactId: string): ArtifactConsumption[] {
    const rows = this.db
      .prepare("SELECT * FROM artifact_consumptions WHERE artifact_id = ? ORDER BY consumed_at ASC")
      .all(artifactId) as ConsumptionRow[];
    return rows.map(mapConsumption);
  }

  listConsumptionsByRun(runId: string): ArtifactConsumption[] {
    const rows = this.db
      .prepare("SELECT * FROM artifact_consumptions WHERE run_id = ? ORDER BY consumed_at ASC")
      .all(runId) as ConsumptionRow[];
    return rows.map(mapConsumption);
  }

  // -- evidence links -------------------------------------------------------

  insertEvidenceLink(row: ArtifactEvidenceLink): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO artifact_evidence_links (artifact_id, revision, evidence_ref)
         VALUES (?, ?, ?)`,
      )
      .run(row.artifact_id, row.revision, row.evidence_ref);
  }

  listEvidenceLinksByArtifact(artifactId: string): ArtifactEvidenceLink[] {
    const rows = this.db
      .prepare("SELECT artifact_id, revision, evidence_ref FROM artifact_evidence_links WHERE artifact_id = ? ORDER BY revision ASC, evidence_ref ASC")
      .all(artifactId) as ArtifactEvidenceLink[];
    return rows;
  }

  listByEvidenceRef(ref: string): Array<{ artifact_id: string; revision: number }> {
    const rows = this.db
      .prepare("SELECT artifact_id, revision FROM artifact_evidence_links WHERE evidence_ref = ? ORDER BY artifact_id ASC, revision ASC")
      .all(ref) as Array<{ artifact_id: string; revision: number }>;
    return rows;
  }

  // -- maintenance leases ---------------------------------------------------

  /** CAS lease acquisition: succeeds when the lease is absent or expired.
   *  A live lease held by someone else (including a previous incarnation of
   *  the same sweeper) is never stolen before expiry. */
  tryAcquireLease(name: string, ownerId: string, nowMs: number, durationMs: number): boolean {
    const existing = this.db.prepare("SELECT owner_id, expires_at_ms FROM artifact_maintenance_leases WHERE name = ?").get(name) as
      | { owner_id: string; expires_at_ms: number }
      | undefined;
    if (!existing) {
      this.db
        .prepare("INSERT INTO artifact_maintenance_leases (name, owner_id, expires_at_ms) VALUES (?, ?, ?)")
        .run(name, ownerId, nowMs + durationMs);
      return true;
    }
    if (existing.expires_at_ms > nowMs) {
      return false;
    }
    const result = this.db
      .prepare("UPDATE artifact_maintenance_leases SET owner_id = ?, expires_at_ms = ? WHERE name = ? AND expires_at_ms <= ?")
      .run(ownerId, nowMs + durationMs, name, nowMs);
    return result.changes === 1;
  }

  releaseLease(name: string, ownerId: string): void {
    this.db.prepare("DELETE FROM artifact_maintenance_leases WHERE name = ? AND owner_id = ?").run(name, ownerId);
  }

  getLease(name: string): ArtifactLease | null {
    const row = this.db.prepare("SELECT name, owner_id, expires_at_ms FROM artifact_maintenance_leases WHERE name = ?").get(name) as
      | ArtifactLease
      | undefined;
    return row ?? null;
  }
}
