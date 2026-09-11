// F009 review R3-017 (round 4, independent verification): the reviewer
// directly observed leaked /tmp/personahub-e2e-* directories after every
// real Playwright run, meaning cleanup was not actually removing the
// directory `invocation-dir.ts` creates. That bug can only be caught by
// really running Playwright end to end and checking the filesystem
// afterwards — no unit test can substitute for it, since the defect was in
// process-lifecycle plumbing (env var sharing across a forked worker
// process), not in any single function's logic.
//
// This runs the real main E2E config against one small, fast spec and
// asserts that whatever personahub-e2e-* directories appear under the OS
// temp dir during the run are gone once the process exits — proving
// createInvocationDir()'s worker-process dedup and its exit-handler cleanup
// both hold for a genuine invocation, not just for a hand-driven repro.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const e2eDir = join(__dirname, "..", "..");

function listInvocationDirs() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("personahub-e2e-")));
}

const before = listInvocationDirs();

console.log("Running a real Playwright invocation to observe its invocation-dir lifecycle...");
execFileSync("npx", ["playwright", "test", "--config=playwright.config.ts", "f009-command-palette"], {
  cwd: e2eDir,
  stdio: "inherit",
});

const after = listInvocationDirs();
const leaked = [...after].filter((name) => !before.has(name));

if (leaked.length > 0) {
  console.error(
    `FAIL: ${leaked.length} invocation director${leaked.length === 1 ? "y" : "ies"} leaked after the run completed: ${leaked.join(", ")}`,
  );
  process.exit(1);
}

console.log("PASS: no invocation directories leaked (createInvocationDir dedup + exit-handler cleanup both held).");
