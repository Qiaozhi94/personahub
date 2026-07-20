import { OPENCODE_MODEL_PROVIDER_ENV, isKnownModelProvider } from "./provider-metadata.js";

/**
 * design §5.3: material injected into the child env at spawn time, never
 * into the workspace or AgentRunInput.context. `cleanup()` exists for the
 * contingency design describes (a provider requiring a temp config file) —
 * none of the confirmed T007 providers need one, so it's currently a no-op,
 * but the shape stays exception-safe (callers await it in a finally block)
 * so a future provider needing real cleanup doesn't change the call sites.
 */
export interface AdapterAuthMaterial {
  env: Record<string, string>;
  cleanup(): Promise<void>;
}

const NOOP_CLEANUP = async (): Promise<void> => {};

/**
 * OpenCode API-key auth material: maps a confirmed model_provider (T007
 * allowlist, server/tests/helpers/opencode-protocol-fixtures.md) to its one
 * env var. Never accepts an arbitrary provider/env name from the caller —
 * unknown providers are rejected here as defense-in-depth, even though
 * AdapterConfigService already validates this at config-save time.
 */
export function buildOpenCodeApiKeyAuthMaterial(modelProvider: string, apiKey: string): AdapterAuthMaterial {
  if (!isKnownModelProvider(modelProvider)) {
    throw new Error(`Unknown/unsupported OpenCode model_provider: ${modelProvider}`);
  }
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("api_key must not be empty when building OpenCode auth material.");
  }
  const envVarName = OPENCODE_MODEL_PROVIDER_ENV[modelProvider];
  return {
    env: { [envVarName]: trimmedKey },
    cleanup: NOOP_CLEANUP,
  };
}
