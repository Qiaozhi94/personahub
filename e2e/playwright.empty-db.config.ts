import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { SERVER_PORT, WEB_PORT } from "./tests/support/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, ".tmp-empty");

// T031 residual "干净数据库首屏" (docs/reviews/journey-test-matrix.md §5.1):
// a separate config, not a project inside playwright.config.ts, because that
// config's single webServer is shared by every spec via the v0.2 fixture —
// there is no way to give one spec file a different DB_PATH within it.
// DB_PATH points at a file that does not exist; the real server creates and
// migrates it from scratch on boot (see support/f009-empty-db.ts).
const dbFile = path.join(dbDir, "empty.sqlite");

export default defineConfig({
  globalSetup: "./tests/support/f009-empty-db.ts",
  testDir: "./tests",
  testMatch: /f009-empty-database\.spec\.ts/,
  outputDir: "./test-results-empty-db",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
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
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npx vite --port ${WEB_PORT} --host 127.0.0.1`,
      cwd: "../web",
      env: {
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${SERVER_PORT}`,
      },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
