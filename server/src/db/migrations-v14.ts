import type Database from "better-sqlite3";
import { SCHEMA_V12_SKILL_TRIGGERS } from "./schema-v12.js";

/**
 * F013 follow-up integrity migration. v12 shipped the tables before the
 * review found that revision files had no composite parent FK and that a
 * draft file row could be moved onto a published revision by changing its key.
 */
export function applyV14(db: Database.Database): void {
  const fkWasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  db.pragma("foreign_keys = OFF");
  if (db.pragma("foreign_keys", { simple: true }) !== 0) {
    throw new Error("v14 migration: failed to disable foreign_keys before table rebuild");
  }
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE skill_revision_files_f013 (
          skill_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          rel_path TEXT NOT NULL,
          content BLOB NOT NULL,
          content_hash TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          PRIMARY KEY (skill_id, version, rel_path),
          FOREIGN KEY (skill_id, version) REFERENCES skill_revisions(skill_id, version)
        );
        INSERT INTO skill_revision_files_f013 (skill_id, version, rel_path, content, content_hash, size_bytes)
          SELECT skill_id, version, rel_path, content, content_hash, size_bytes
          FROM skill_revision_files;
        DROP TABLE skill_revision_files;
        ALTER TABLE skill_revision_files_f013 RENAME TO skill_revision_files;
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS skill_conflict_resolutions (
          space_id TEXT NOT NULL REFERENCES spaces(id),
          display_name_key TEXT NOT NULL,
          keep_skill_id TEXT NOT NULL REFERENCES skills(id),
          candidate_ids_json TEXT NOT NULL,
          resolved_at TEXT NOT NULL,
          PRIMARY KEY (space_id, display_name_key)
        );
      `);
      db.exec("DROP TRIGGER IF EXISTS trg_skill_files_no_update;");
      db.exec(`
        CREATE TRIGGER trg_skill_files_no_update
          BEFORE UPDATE ON skill_revision_files
          FOR EACH ROW
          WHEN (SELECT published_at FROM skill_revisions WHERE skill_id = OLD.skill_id AND version = OLD.version) IS NOT NULL
             OR (SELECT published_at FROM skill_revisions WHERE skill_id = NEW.skill_id AND version = NEW.version) IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'SKILL_REVISION_FROZEN');
        END;
      `);
      // Recreate the other file triggers against the rebuilt table. IF NOT
      // EXISTS keeps this idempotent for databases already partially upgraded.
      db.exec(SCHEMA_V12_SKILL_TRIGGERS);
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0)
        throw new Error(`v14 migration foreign_key_check failed: ${JSON.stringify(violations)}`);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (14, ?)").run(new Date().toISOString());
    })();
  } finally {
    db.pragma(`foreign_keys = ${fkWasOn ? "ON" : "OFF"}`);
    if ((db.pragma("foreign_keys", { simple: true }) === 1) !== fkWasOn) {
      throw new Error("v14 migration: failed to restore foreign_keys state");
    }
  }
}
