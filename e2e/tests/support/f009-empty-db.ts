import { invocationDir } from "./invocation-dir.js";

// T031 residual "干净数据库首屏" (docs/reviews/journey-test-matrix.md §5.1):
// the main f009-fixture-db.ts setup always materializes the v0.2 fixture,
// which is never empty, so no other suite ever exercises a real first-boot
// with zero projects. This config's DB_PATH points at a file inside this
// invocation's own unique directory (see invocation-dir.ts — review R3-017:
// no fixed/shared path) that does not exist; the real server creates and
// migrates it from scratch on boot, exactly like a brand-new local install.
// mkdtemp already guarantees the directory is fresh, so there is nothing
// left for this setup to do beyond confirming the bridge actually worked.

export default function prepareEmptyDatabaseDir(): void {
  invocationDir();
}
