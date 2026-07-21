import { spawnSync } from "node:child_process";
import type { AdapterConfig } from "@personahub/shared/types";
import type { AdapterValidationResult } from "../types.js";
import { resolveExecutable } from "../executable-resolver.js";

/**
 * Pure Claude Code CLI protocol helpers: auth-status probe and PreToolUse
 * hook-denial detection. `--version` is NOT a valid auth probe here (T001:
 * confirmed to succeed identically regardless of login state) — `auth
 * status` is the only reliable non-interactive login check.
 */

interface ClaudeAuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  // email/orgId/orgName are real fields on the raw response (T001 PII
  // warning) — deliberately not read here, never propagated upstream.
}

export function validateClaudeCommand(config: AdapterConfig): AdapterValidationResult {
  const command = config.command?.trim();
  if (!command) {
    return { available: false, errorMessage: "Command is empty." };
  }
  const { resolved, errorMessage: resolveError } = resolveExecutable(command);
  if (!resolved) {
    return { available: false, errorMessage: resolveError ?? `Command not found: ${command}` };
  }

  let result;
  try {
    result = spawnSync(resolved.executable, [...resolved.prefixArgs, "auth", "status"], {
      timeout: 10_000,
      encoding: "utf-8",
      shell: false,
    });
  } catch (err) {
    return { available: false, errorMessage: `Failed to validate command: ${String(err)}` };
  }

  if (result.error) {
    return { available: false, errorMessage: `Command not found: ${command}` };
  }

  // `auth status` exits 1 for a well-formed "not logged in" JSON body (T001)
  // — exit code alone cannot distinguish that from a genuine crash, so the
  // JSON body (when parseable) is authoritative, not the exit code.
  let parsed: ClaudeAuthStatus;
  try {
    parsed = JSON.parse(result.stdout ?? "") as ClaudeAuthStatus;
  } catch {
    return { available: false, errorMessage: `Command exited with code ${result.status}` };
  }

  if (parsed.loggedIn === true) {
    return { available: true, errorMessage: null };
  }
  return { available: false, errorMessage: `Not logged in (authMethod: ${parsed.authMethod ?? "none"})` };
}

/**
 * T035 re-verification (claude-protocol-fixtures.md): a hook-denied tool
 * call carries a top-level `tool_result_meta: [{ id, non_execution_kind }]`
 * array — a structured, non-fragile signal, checked by the normalizer.
 * `HOOK_DENY_REASON` is the fixed string PersonaHub's own PreToolUse hook
 * script (T040) writes as `permissionDecisionReason`; used here only as a
 * defense-in-depth fallback for hosts/versions where `tool_result_meta`
 * might not be present, matching the exact string our own hook controls.
 */
export const HOOK_DENY_REASON = "PersonaHub PreToolUse hook: git push blocked (no push credentials)";
