import { buildV02Fixture } from "./build-v02-fixture.js";

// Runs in its own OS process (see f009-v02-fixture.test.ts's concurrency
// regression test — review R3-017): proves two overlapping invocations that
// each own their own directory never interfere with each other, unlike the
// old fixed/shared temp path that a concurrent run could delete out from
// under another in-flight run.
const dir = process.argv[2];
if (!dir) {
  throw new Error("usage: concurrent-build-worker.ts <dir>");
}

const db = buildV02Fixture(dir);
const version = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
const projectCount = (db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number }).c;
db.close();

process.stdout.write(JSON.stringify({ version: version.v, projectCount }));
