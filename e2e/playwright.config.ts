import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, ".tmp");
try {
  // Best-effort: start from a clean DB so runs stay fast and .tmp doesn't
  // grow unbounded. Not load-bearing for correctness — tests select their
  // seeded Project by name (see support/app.ts) rather than relying on it
  // being the only one in the DB — so a leftover file lock (e.g. a prior
  // server process still releasing its handle on Windows) just means this
  // run reuses/accumulates on top of the old file instead of failing.
  fs.rmSync(dbDir, { recursive: true, force: true });
} catch {
  // ignore — see comment above.
}
fs.mkdirSync(dbDir, { recursive: true });

const SERVER_PORT = 4321;
const WEB_PORT = 5173;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "npm run dev:server",
      cwd: "..",
      env: {
        DB_PATH: path.join(dbDir, "e2e.db"),
        PORT: String(SERVER_PORT),
        HOST: "127.0.0.1",
      },
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
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
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
