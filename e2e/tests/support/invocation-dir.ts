// F009 review R3-017: the bridge between a Playwright config module (which
// must know DB_PATH synchronously, before webServer spawns, to pass it as
// an env var) and that config's globalSetup script (which runs later, in
// the same process, and needs the identical path to build the fixture into).
// Each config calls createInvocationDir() once at module-load time — a
// fresh mkdtemp directory this invocation owns exclusively — and stores it
// in an env var globalSetup reads back via invocationDir(). No fixed/shared
// path is ever reused across invocations, so two overlapping runs can never
// delete or recreate each other's database or workspace.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_VAR = "PERSONAHUB_E2E_INVOCATION_DIR";

/** Called once from a playwright.*.config.ts module body. */
export function createInvocationDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env[ENV_VAR] = dir;
  return dir;
}

/** Called from a globalSetup/globalTeardown script — must run in the same
 *  process as the config module that called createInvocationDir(). */
export function invocationDir(): string {
  const dir = process.env[ENV_VAR];
  if (!dir) {
    throw new Error(
      `${ENV_VAR} is not set — globalSetup must run in the same process as a config that called createInvocationDir()`,
    );
  }
  return dir;
}
