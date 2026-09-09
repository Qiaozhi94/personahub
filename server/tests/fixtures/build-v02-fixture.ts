import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// F009 T000 fixture builder (v02-fixture-contract.md §1): materializes the
// committed v10 text snapshot + representative seed into a fresh SQLite file
// inside the caller's test temp directory. Deliberately dumb SQL execution —
// no repositories, no services, no applyMigrations(): the whole point is to
// prove the *migration chain* can upgrade data the current code never wrote.

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));

export const V02_SNAPSHOT_PATH = join(FIXTURES_DIR, "v02-schema-v10.sql");
export const V02_SEED_PATH = join(FIXTURES_DIR, "v02-representative-seed.sql");

export function loadV02SnapshotSql(): string {
  return readFileSync(V02_SNAPSHOT_PATH, "utf8");
}

export function loadV02SeedSql(): string {
  return readFileSync(V02_SEED_PATH, "utf8");
}

/**
 * Creates `<dir>/v02-fixture.sqlite` with the schema-v10 snapshot and the
 * representative seed applied under foreign-key enforcement, then proves the
 * file is internally consistent before handing it back.
 */
export function buildV02Fixture(dir: string): Database.Database {
  const dbPath = join(dir, "v02-fixture.sqlite");
  // Foreign keys must be ON *before* the seed runs so every relationship in
  // §2 is actually enforced, not merely declared.
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  try {
    db.exec(loadV02SnapshotSql());
    db.exec(loadV02SeedSql());
  } catch (error) {
    db.close();
    throw error;
  }

  const fkViolations = db.pragma("foreign_key_check") as Array<Record<string, unknown>>;
  if (fkViolations.length > 0) {
    const summary = fkViolations
      .slice(0, 5)
      .map((row) => `${row.table}/${row.rowid} ← ${row.parent}`)
      .join(", ");
    db.close();
    throw new Error(`v02 fixture has foreign key violations: ${summary}`);
  }

  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  if (integrity !== "ok") {
    db.close();
    throw new Error(`v02 fixture failed integrity_check: ${integrity}`);
  }

  return db;
}
