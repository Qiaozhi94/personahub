import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildV02Fixture } from "../../../server/tests/fixtures/build-v02-fixture.js";

// F009 T021 global setup: materializes the committed v0.2 schema-v10 fixture
// (raw SQL snapshot + seed) into e2e/.tmp and hands the still-v10 database to
// the real server via DB_PATH. The server's openDatabase() then performs the
// genuine first-boot v10 → head migration itself (review R1-008: the setup
// must NOT run applyMigrations here — the upgrade seam under test is "v10
// file meets the current server at startup", exactly like a real upgrade).
// There is no API-seeded second database (v02-fixture-contract.md §3.5).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, "..", "..", ".tmp");

// ws_v02_graphok (F009 review R1-005 J4) needs a real, on-disk workspace with
// at least one file matching a dual_review targetGlob (**/*.ts) — graph
// creation rejects an empty target file set. The path is fixed (not derived
// from dbDir) because it's also the literal local_path baked into the raw
// SQL fixture (v02-representative-seed.sql), which has no template step.
const graphOkWorkspaceDir = "/tmp/f009-graphok-workspace";

export default function buildE2EFixtureDatabase(): void {
  rmSync(dbDir, { recursive: true, force: true });
  mkdirSync(dbDir, { recursive: true });

  rmSync(graphOkWorkspaceDir, { recursive: true, force: true });
  mkdirSync(graphOkWorkspaceDir, { recursive: true });
  writeFileSync(
    path.join(graphOkWorkspaceDir, "config-store.ts"),
    'export const configStore = { rollout: "dual-region" };\n',
  );

  const fixture = buildV02Fixture(dbDir);
  const version = fixture.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
  if (version.v !== 10) {
    throw new Error(`fixture is not a v10 database: MAX(schema_version)=${version.v}`);
  }
  fixture.close();
}
