import { spawnSync } from "node:child_process";
import type { AdapterConfig } from "@personahub/shared/types";
import { AdapterAuthType } from "@personahub/shared/types";
import type { AdapterValidationResult } from "../types.js";
import { resolveExecutable } from "../executable-resolver.js";
import { buildOpenCodeApiKeyAuthMaterial } from "../auth-material.js";

/**
 * Pure OpenCode CLI protocol helpers: the `-m provider/model` flag (always
 * mandatory, see opencode-protocol-fixtures.md T005/T044 — omitting it lets
 * OpenCode silently fall back to a free model instead of failing) and the
 * auth-status probe (design §5.2's "minimal no-workspace-write prompt
 * probe" branch, since `opencode auth list`/`providers list` gives no
 * scriptable success/failure signal — T005 confirmed identical exit code
 * for a credentialed vs. an empty-HOME run).
 */

const MINIMAL_PROBE_PROMPT = "Reply with only the number 4.";

export function buildModelFlag(config: Pick<AdapterConfig, "model_provider" | "default_model">): string[] {
  return ["-m", `${config.model_provider}/${config.default_model}`];
}

export async function validateOpenCodeCommand(config: AdapterConfig, apiKey?: string | null): Promise<AdapterValidationResult> {
  const command = config.command?.trim();
  if (!command) {
    return { available: false, errorMessage: "Command is empty." };
  }
  if (!config.model_provider || !config.default_model) {
    return { available: false, errorMessage: "model_provider and default_model are required for opencode (used to build -m provider/model)." };
  }

  const { resolved, errorMessage: resolveError } = resolveExecutable(command);
  if (!resolved) {
    return { available: false, errorMessage: resolveError ?? `Command not found: ${command}` };
  }

  let authEnv: Record<string, string> = {};
  let cleanup: (() => Promise<void>) | null = null;
  if (config.auth_type === AdapterAuthType.ApiKey) {
    if (!apiKey) {
      return { available: false, errorMessage: "api_key is required for opencode API-key auth." };
    }
    try {
      const material = buildOpenCodeApiKeyAuthMaterial(config.model_provider, apiKey);
      authEnv = material.env;
      cleanup = material.cleanup;
    } catch (err) {
      return { available: false, errorMessage: `Failed to build auth material: ${String(err)}` };
    }
  }

  try {
    const result = spawnSync(
      resolved.executable,
      [...resolved.prefixArgs, "run", "--format", "json", ...buildModelFlag(config), MINIMAL_PROBE_PROMPT],
      {
        timeout: 30_000,
        encoding: "utf-8",
        shell: false,
        env: { ...process.env, ...authEnv },
      },
    );

    if (result.error) {
      return { available: false, errorMessage: `Command not found: ${command}` };
    }

    // T005: no single reliable auth-status command exists for OpenCode — a
    // `type:"error"` line in the NDJSON output is the only confirmed,
    // scriptable failure signal for an explicitly-requested provider/model.
    const lines = (result.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const typed = parsed as { type?: string; error?: { name?: string; data?: { message?: string } } };
      if (typed.type === "error") {
        const message = typed.error?.data?.message ?? typed.error?.name ?? "OpenCode reported an error";
        return { available: false, errorMessage: message };
      }
    }

    if (result.status !== 0) {
      return { available: false, errorMessage: `Command exited with code ${result.status}` };
    }

    return { available: true, errorMessage: null };
  } finally {
    if (cleanup) await cleanup();
  }
}
