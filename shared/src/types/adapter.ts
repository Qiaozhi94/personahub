/**
 * F005 adapter/routing contract: provider identity, auth type, and per-adapter
 * capability. See docs/features/0.1/F005-multi-agent-manual-routing/design.md §3.
 */

export enum CliProvider {
  Codex = "codex",
  ClaudeCode = "claude-code",
  OpenCode = "opencode",
}

export enum AdapterAuthType {
  OAuth = "oauth",
  ApiKey = "api_key",
}

/**
 * Describes which workflow role an adapter can carry. Consult is NOT a
 * capability here — every adapter can always handle a consult Run; making it
 * configurable would only create a failure mode (user unchecks it, mismatch
 * fallback has nothing to fall back to) with no user benefit. Consult is a
 * routing purpose/role instead (see RunPurpose / RunRole).
 */
export enum AgentCapability {
  Implementation = "implementation",
  Validator = "validator",
}

export enum RunPurpose {
  WorkflowBound = "workflow_bound",
  AdHocConsult = "ad_hoc_consult",
}

export interface AdapterProviderMetadata {
  cli_provider: CliProvider;
  supported_auth_types: AdapterAuthType[];
  default_command: string;
  capability_description: string;
  /** Confirmed OpenCode API-key model_provider allowlist; empty for other providers. */
  model_provider_allowlist: string[];
}

export interface AdapterProvidersResponse {
  providers: AdapterProviderMetadata[];
}
