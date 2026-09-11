// F009 review R3-017: the bridge between a Playwright config module (which
// must know DB_PATH synchronously, before webServer spawns, to pass it as
// an env var) and that config's globalTeardown script (which runs later, in
// the orchestrator process, and needs the identical path to clean up). No
// fixed/shared path is ever reused across separate invocations, so two
// overlapping runs can never delete or recreate each other's database or
// workspace.
//
// review R3-017 follow-up: Playwright evaluates the config module more than
// once per invocation — once in the orchestrator process, and again in each
// forked worker process (confirmed by logging process.pid across both) —
// because workers need the resolved config's `use`/project options too. A
// naive unconditional mkdtemp here creates a second, never-torn-down
// directory in every worker. Workers are forked *after* the orchestrator's
// own config evaluation finishes and inherit its process.env at fork time,
// so checking for an already-set env var — rather than always minting a new
// one — makes every process within the same invocation converge on the one
// directory the orchestrator created, leaving exactly one for
// globalTeardown to remove.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR_ENV_VAR = "PERSONAHUB_E2E_INVOCATION_DIR";
const OWNER_ENV_VAR = "PERSONAHUB_E2E_INVOCATION_DIR_OWNER_PID";

/**
 * Called from a playwright.*.config.ts module body. Idempotent per OS
 * process tree: the first call (in the orchestrator) mints a fresh mkdtemp
 * directory and records both it and this process's pid as the owner; any
 * later call in the same invocation (a worker process re-evaluating the
 * config, inheriting that env at fork time) returns the same directory
 * instead of minting another one.
 */
export function createInvocationDir(prefix: string): string {
  const existing = process.env[DIR_ENV_VAR];
  if (existing) return existing;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env[DIR_ENV_VAR] = dir;
  process.env[OWNER_ENV_VAR] = String(process.pid);
  return dir;
}

/**
 * True only in the process that actually minted the directory (the
 * orchestrator) — guards one-time setup (building the fixture) so a worker
 * process that inherits the same directory doesn't redo it.
 */
export function isInvocationDirOwner(): boolean {
  return process.env[OWNER_ENV_VAR] === String(process.pid);
}

/** Called from a globalSetup/globalTeardown script — must run in the same
 *  process as the config module that called createInvocationDir(). */
export function invocationDir(): string {
  const dir = process.env[DIR_ENV_VAR];
  if (!dir) {
    throw new Error(
      `${DIR_ENV_VAR} is not set — globalSetup must run in the same process as a config that called createInvocationDir()`,
    );
  }
  return dir;
}
