import { buildV02Fixture } from "../../../server/tests/fixtures/build-v02-fixture.js";

// F009 T021: materializes the committed v0.2 schema-v10 fixture (raw SQL
// snapshot + seed) into this invocation's own unique directory (see
// invocation-dir.ts — review R3-017: no fixed/shared path, so two
// overlapping runs can never delete or recreate each other's database or
// workspace) and hands the still-v10 database to the real server via
// DB_PATH. The server's openDatabase() then performs the genuine first-boot
// v10 → head migration itself (review R1-008: this must NOT run
// applyMigrations here — the upgrade seam under test is "v10 file meets the
// current server at startup", exactly like a real upgrade). There is no
// API-seeded second database (v02-fixture-contract.md §3.5).
//
// Called directly from the Playwright config module, at config-load time —
// NOT wired as Playwright's `globalSetup` (review R3-017 follow-up): this
// Playwright version always runs a config's `webServer` plugin setup before
// `globalSetup` (confirmed by reading playwright's own task ordering in
// runner/index.js — createGlobalSetupTasks lists plugin setup ahead of
// globalSetups). With a `globalSetup`-based build, the server would already
// have opened DB_PATH and migrated the (still-empty) file straight to head
// by the time this ran, so writing the v10 snapshot into it afterwards
// collides with columns the head migrations already added. Building the
// fixture at config-load time — before webServer ever starts — is the only
// point that is guaranteed to run first.
export function buildE2EFixtureDatabase(dir: string): void {
  // buildV02Fixture owns dir exclusively (mkdtemp'd fresh by the config
  // module) — it creates the db file and the graphok workspace under dir
  // itself, nothing here needs to delete anything first.
  const fixture = buildV02Fixture(dir);
  const version = fixture.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
  if (version.v !== 10) {
    throw new Error(`fixture is not a v10 database: MAX(schema_version)=${version.v}`);
  }
  fixture.close();
}
