import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { SERVER_PORT, WEB_PORT } from "./tests/support/env.js";
import { createInvocationDir, isInvocationDirOwner } from "./tests/support/invocation-dir.js";
import { buildE2EFixtureDatabase } from "./tests/support/f009-fixture-db.js";

// F009: the E2E database is the pinned v0.2 release fixture (T000 builder +
// real migration chain), rebuilt fresh below and then opened by the real
// server through DB_PATH. The server's own startup recovery is the only
// writer between seed and journey — there is no API-seeded second database
// (v02-fixture-contract.md §3.5).
//
// review R3-017: this directory must be freshly mkdtemp'd here, at config
// module load, not a fixed path under e2e/ — a fixed path that setup
// recursively deletes on every invocation is a real hazard: two overlapping
// runs (e.g. one from a previous invocation whose server process is still
// alive) delete and recreate each other's database and workspace mid-test.
// outputDir and playwright-report intentionally stay at their normal fixed
// locations — CI's "Upload Playwright report on failure" step references
// e2e/playwright-report/ by that exact path, and Playwright's own clearing
// of its configured outputDir at run start is a separate, well-tested
// mechanism from this project's own ad hoc recursive deletes.
const invocationDir = createInvocationDir("personahub-e2e-");
const dbFile = path.join(invocationDir, "v02-fixture.sqlite");

// review R3-017 follow-up: build the fixture here, at config-load time, not
// via Playwright's `globalSetup` hook. This Playwright version always runs a
// config's `webServer` plugin setup before `globalSetup` (see
// f009-fixture-db.ts for the full explanation) — by the time a `globalSetup`
// script ran, the server had already opened this (nonexistent) DB_PATH and
// migrated it straight to head, so writing the v10 snapshot afterwards
// collided with columns the head migrations already added. Config-load time
// is the only point guaranteed to run before webServer starts.
//
// review R3-017 follow-up #2: Playwright also re-evaluates this config
// module inside each worker process it forks — `createInvocationDir` makes
// those inherit the same directory, but only the owning (orchestrator)
// process should actually build into it; a worker rebuilding the same
// already-built file hits the identical "duplicate column name" collision.
if (isInvocationDirOwner()) {
  buildE2EFixtureDatabase(invocationDir);
}

export default defineConfig({
  globalTeardown: "./tests/support/invocation-dir-teardown.ts",
  testDir: "./tests",
  // Runs under its own config (playwright.empty-db.config.ts) against a
  // genuinely empty database — this config's webServer always seeds the
  // v0.2 fixture, so running it here would assert empty-state copy against
  // a non-empty database and fail for the wrong reason.
  testIgnore: /f009-empty-database\.spec\.ts/,
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev:server",
      cwd: "..",
      env: {
        DB_PATH: dbFile,
        PORT: String(SERVER_PORT),
        HOST: "127.0.0.1",
        // review R3-016: the fake adapter is opt-in only; this fixture's
        // validator dispatch relies on it for a deterministic verdict.
        ENABLE_FAKE_ADAPTER: "1",
      },
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      // Always spawn fresh: this suite's whole data-isolation story rests
      // on owning the DB file, which only holds if it also owns the
      // server process writing to it (see support/env.ts).
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Not `npm run dev:web` (bare `vite`): with no --host, Vite's default
      // bind resolves to ::1 on this host, so a health check against the
      // literal 127.0.0.1 Playwright uses everywhere else never connects.
      command: `npx vite --port ${WEB_PORT} --host 127.0.0.1`,
      cwd: "../web",
      env: {
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${SERVER_PORT}`,
      },
      url: `http://127.0.0.1:${WEB_PORT}`,
      // Always spawn fresh: this suite's whole data-isolation story rests
      // on owning the DB file, which only holds if it also owns the
      // server process writing to it (see support/env.ts).
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
