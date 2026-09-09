import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { buildV02Fixture } from "../../../server/tests/fixtures/build-v02-fixture.js";
import { applyMigrations } from "../../../server/src/db/migrations.js";

// F009 T021 global setup: the E2E database IS the T000 fixture — the v0.2
// schema-v10 snapshot + representative seed, materialized fresh into
// e2e/.tmp, upgraded through the real v10 → v11 → head migration chain, and
// then handed to the server via DB_PATH. No API-seeded second database exists
// (v02-fixture-contract.md §3.5): the only writes after the seed come from
// the server's own startup recovery, exactly like a real upgrade.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, "..", "..", ".tmp");

export default function buildE2EFixtureDatabase(): void {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });

  const fixture = buildV02Fixture(dbDir);
  applyMigrations(fixture);
  const version = fixture.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
  if (version.v < 11) {
    throw new Error(`fixture upgrade failed: schema version ${version.v}`);
  }
  fixture.close();
}
