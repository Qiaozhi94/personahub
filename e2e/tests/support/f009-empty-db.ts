import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Genuinely empty database global setup (T031 residual "干净数据库首屏" —
// see docs/reviews/journey-test-matrix.md §5.1): the main f009-fixture-db.ts
// setup always materializes the v0.2 fixture, which is never empty, so no
// existing suite ever exercises a real first-boot with zero projects. This
// setup does the opposite — it deletes any prior file and leaves NO database
// at DB_PATH at all. The real server (src/index.ts openDatabase()) creates
// the file and runs the full migration chain itself on first boot, exactly
// like a brand-new local install; only the schema-baked baseline rows
// (wft_coding_default, vpl_coding_default — see schema-v1.ts) exist, and
// every projects/issues/workspaces table starts at zero rows.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, "..", "..", ".tmp-empty");

export default function prepareEmptyDatabaseDir(): void {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });
}
