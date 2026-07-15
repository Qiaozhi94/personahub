import type Database from "better-sqlite3";
import { SCHEMA_V1 } from "./schema-v1.js";
import { SCHEMA_V2 } from "./schema-v2.js";

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
}
