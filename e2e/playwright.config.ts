import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { SERVER_PORT, WEB_PORT } from "./tests/support/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, ".tmp");

// F009: the E2E database is the pinned v0.2 release fixture (T000 builder +
// real migration chain), rebuilt fresh by the global setup below and then
// opened by the real server through DB_PATH. The server's own startup
// recovery is the only writer between seed and journey — there is no
// API-seeded second database (v02-fixture-contract.md §3.5).
const dbFile = path.join(dbDir, "v02-fixture.sqlite");

export default defineConfig({
  globalSetup: "./tests/support/f009-fixture-db.ts",
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
