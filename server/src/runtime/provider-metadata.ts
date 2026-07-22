import { CliProvider, AdapterAuthType, type AdapterProviderMetadata } from "@personahub/shared/types";

/**
 * Centralized provider/auth-type and OpenCode model_provider->env var
 * mappings (design §5.1, §5.3). Both AdapterConfigService (validation) and
 * runtime/auth-material.ts (env injection) import from here — this is the
 * single source of truth `hasCapability()`-style code elsewhere in this
 * feature insists on: no second copy of "which provider supports what".
 */

export const PROVIDER_SUPPORTED_AUTH_TYPES: Record<CliProvider, AdapterAuthType[]> = {
  [CliProvider.Codex]: [AdapterAuthType.OAuth],
  [CliProvider.ClaudeCode]: [AdapterAuthType.OAuth],
  [CliProvider.OpenCode]: [AdapterAuthType.OAuth, AdapterAuthType.ApiKey],
};

export const PROVIDER_DEFAULT_COMMAND: Record<CliProvider, string> = {
  [CliProvider.Codex]: "codex",
  [CliProvider.ClaudeCode]: "claude",
  [CliProvider.OpenCode]: "opencode",
};

export const PROVIDER_CAPABILITY_DESCRIPTION: Record<CliProvider, string> = {
  [CliProvider.Codex]: "Implementation + validator.",
  [CliProvider.ClaudeCode]: "Implementation + validator. Pre-execution git-push interception via a PreToolUse hook.",
  [CliProvider.OpenCode]: "Implementation + validator. No pre-execution approval channel; credential isolation is the only defense against dangerous commands.",
};

/**
 * OpenCode API-key model_provider allowlist, confirmed by real local probe
 * (server/tests/helpers/opencode-protocol-fixtures.md T007): setting the
 * listed env var made the provider id appear in `opencode models` against an
 * isolated, credential-empty HOME. Providers outside this list are
 * unverified and rejected with ADAPTER_MODEL_PROVIDER_UNSUPPORTED — users
 * cannot specify an arbitrary env var name.
 */
export const OPENCODE_MODEL_PROVIDER_ENV: Readonly<Record<string, string>> = Object.freeze({
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  togetherai: "TOGETHER_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
});

export function isKnownModelProvider(modelProvider: string): boolean {
  return Object.prototype.hasOwnProperty.call(OPENCODE_MODEL_PROVIDER_ENV, modelProvider);
}

export function isValidCliProvider(value: string): value is CliProvider {
  return value === CliProvider.Codex || value === CliProvider.ClaudeCode || value === CliProvider.OpenCode;
}

const ALL_PROVIDERS: CliProvider[] = [CliProvider.Codex, CliProvider.ClaudeCode, CliProvider.OpenCode];

/**
 * T080/design §9.4: drives the Adapter Settings form so the client never
 * hardcodes a second copy of "which provider supports what". Only the
 * OpenCode allowlist's provider keys are exposed — never the underlying env
 * var names or any local secret/path.
 */
export function getProviderMetadata(): AdapterProviderMetadata[] {
  return ALL_PROVIDERS.map((cli_provider) => ({
    cli_provider,
    supported_auth_types: PROVIDER_SUPPORTED_AUTH_TYPES[cli_provider],
    default_command: PROVIDER_DEFAULT_COMMAND[cli_provider],
    capability_description: PROVIDER_CAPABILITY_DESCRIPTION[cli_provider],
    model_provider_allowlist: cli_provider === CliProvider.OpenCode ? Object.keys(OPENCODE_MODEL_PROVIDER_ENV) : [],
  }));
}
