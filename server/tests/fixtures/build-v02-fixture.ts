import Database from "better-sqlite3";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const GRAPHOK_WORKSPACE_PLACEHOLDER = "__GRAPHOK_WORKSPACE_PATH__";

export function loadV02SnapshotSql(): string {
  return readFileSync(V02_SNAPSHOT_PATH, "utf8");
}

export function loadV02SeedSql(): string {
  return readFileSync(V02_SEED_PATH, "utf8");
}

/**
 * ws_v02_graphok (review R1-005 J4) needs a real, on-disk workspace with a
 * file matching a dual_review targetGlob — graph creation rejects an empty
 * target file set. Review R3-017: a shared fixed path here (the literal
 * /tmp/f009-graphok-workspace this used to be) is a real hazard, not a
 * theoretical one — two overlapping test runs each recursively delete and
 * recreate it, and a run that loses the race sees its fixture project/issue
 * vanish mid-test. Always derived from the caller's own `dir` (already
 * unique per invocation, e.g. mkdtempSync) instead, so this fixture owns no
 * shared filesystem state at all.
 */
function prepareGraphOkWorkspace(dir: string): string {
  const graphOkDir = join(dir, "graphok-workspace");
  mkdirSync(graphOkDir, { recursive: true });
  writeFileSync(join(graphOkDir, "config-store.ts"), 'export const configStore = { rollout: "dual-region" };\n');
  return graphOkDir;
}

/**
 * Creates `<dir>/v02-fixture.sqlite` with the schema-v10 snapshot and the
 * representative seed applied under foreign-key enforcement, then proves the
 * file is internally consistent before handing it back. `dir` must already
 * be a directory this call owns exclusively (e.g. freshly mkdtemp'd) — the
 * graphok workspace is created under it, and nothing here ever deletes an
 * existing path, so a shared/reused `dir` is the caller's own risk, not
 * this function's.
 */
export function buildV02Fixture(dir: string): Database.Database {
  const dbPath = join(dir, "v02-fixture.sqlite");
  const graphOkDir = prepareGraphOkWorkspace(dir);
  const seedSql = loadV02SeedSql().replaceAll(GRAPHOK_WORKSPACE_PLACEHOLDER, graphOkDir);

  // Foreign keys must be ON *before* the seed runs so every relationship in
  // §2 is actually enforced, not merely declared.
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  try {
    db.exec(loadV02SnapshotSql());
    db.exec(seedSql);
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
