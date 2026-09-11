import { createInvocationDir } from "../../../e2e/tests/support/invocation-dir.js";
import { buildV02Fixture } from "./build-v02-fixture.js";

// Runs in its own OS process (see f009-v02-fixture.test.ts's concurrency
// regression test — review R3-017): proves the REAL createInvocationDir()
// two overlapping E2E invocations actually call — not a hand-rolled
// mkdtemp — mints an isolated directory per process, so a regression back to
// a fixed/shared path (the original bug: one invocation's setup deleting or
// recreating another's mid-run database) would make two of these collide.
const prefix = process.argv[2];
if (!prefix) {
  throw new Error("usage: concurrent-build-worker.ts <mkdtemp-prefix>");
}

const dir = createInvocationDir(prefix);
const db = buildV02Fixture(dir);
const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
const projectCount = (db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number }).c;
db.close();

process.stdout.write(JSON.stringify({ dir, version: version.v, projectCount }));
