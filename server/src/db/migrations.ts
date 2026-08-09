import type Database from "better-sqlite3";
import { SCHEMA_V1 } from "./schema-v1.js";
import { SCHEMA_V2 } from "./schema-v2.js";
import { SCHEMA_V3 } from "./schema-v3.js";
import { SCHEMA_V4 } from "./schema-v4.js";
import { SCHEMA_V5 } from "./schema-v5.js";
import { SCHEMA_V6 } from "./schema-v6.js";
import { SCHEMA_V7 } from "./schema-v7.js";
import { SCHEMA_V8 } from "./schema-v8.js";
import { SCHEMA_V9 } from "./schema-v9.js";
import { SCHEMA_V10 } from "./schema-v10.js";

/** Single source of truth for the current schema version — consumers (e.g.
 *  RuntimeHealthService's expected_version) must reference this instead of
 *  re-declaring the literal. */
export const CURRENT_SCHEMA_VERSION = 10;

export function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null } | undefined;
  const currentVersion = row?.v ?? 0;

  if (currentVersion < 1) {
    db.exec(SCHEMA_V1);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
  }

  if (currentVersion < 2) {
    db.exec(SCHEMA_V2);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
  }

  if (currentVersion < 3) {
    db.exec(SCHEMA_V3);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(3, new Date().toISOString());
  }

  if (currentVersion < 4) {
    db.exec(SCHEMA_V4);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(4, new Date().toISOString());
  }

  if (currentVersion < 5) {
    db.exec(SCHEMA_V5);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(5, new Date().toISOString());
  }

  if (currentVersion < 6) {
    db.exec(SCHEMA_V6);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(6, new Date().toISOString());
  }

  if (currentVersion < 7) {
    db.exec(SCHEMA_V7);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(7, new Date().toISOString());
  }

  if (currentVersion < 8) {
    db.transaction(() => {
      db.exec(SCHEMA_V8);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(8, new Date().toISOString());
    })();
  }

  if (currentVersion < 9) {
    db.transaction(() => {
      db.exec(SCHEMA_V9);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(9, new Date().toISOString());
    })();
  }

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.transaction(() => {
      db.exec(SCHEMA_V10);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        CURRENT_SCHEMA_VERSION,
        new Date().toISOString(),
      );
    })();
  }
}
