import { AdapterAuthType, AgentCapability, CliProvider, type AdapterProviderMetadata } from "@personahub/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * design §10.1: provider -> auth type -> provider-specific fields shown
 * level by level; capability is exactly two checkboxes (Implementation /
 * Validator) — consult is never a configurable capability (§3).
 */

const SELECT_CLASSNAME =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const PROVIDER_LABEL: Record<CliProvider, string> = {
  [CliProvider.Codex]: "Codex CLI",
  [CliProvider.ClaudeCode]: "Claude Code",
  [CliProvider.OpenCode]: "OpenCode",
};

// Public, well-known CLI login commands — not secrets, just usage instructions
// the user runs in their own terminal (design §5.2: PersonaHub never reads or
// stores the token, only auth_type=oauth + the probe result).
const OAUTH_LOGIN_COMMAND: Record<CliProvider, string> = {
  [CliProvider.Codex]: "codex login",
  [CliProvider.ClaudeCode]: "claude login",
  [CliProvider.OpenCode]: "opencode auth login",
};

export type ApiKeyAction = "keep" | "replace" | "clear";

export interface AdapterAuthFieldsValue {
  cliProvider: CliProvider;
  authType: AdapterAuthType;
  modelProvider: string;
  defaultModel: string;
  apiKeyInput: string;
  apiKeyAction: ApiKeyAction;
  capabilityTags: AgentCapability[];
}

export interface AdapterAuthFieldsProps {
  value: AdapterAuthFieldsValue;
  onChange: (next: AdapterAuthFieldsValue) => void;
  providers: AdapterProviderMetadata[];
  /** Provider is immutable after creation — the create/update service never accepts a cli_provider change. */
  providerLocked: boolean;
  hasApiKey: boolean;
}

export function AdapterAuthFields({ value, onChange, providers, providerLocked, hasApiKey }: AdapterAuthFieldsProps) {
  const meta = providers.find((p) => p.cli_provider === value.cliProvider);
  const supportedAuthTypes = meta?.supported_auth_types ?? [AdapterAuthType.OAuth];
  const modelProviderAllowlist = meta?.model_provider_allowlist ?? [];
  const isOpenCode = value.cliProvider === CliProvider.OpenCode;

  function set(patch: Partial<AdapterAuthFieldsValue>) {
    onChange({ ...value, ...patch });
  }

  function toggleCapability(cap: AgentCapability, checked: boolean) {
    const next = checked
      ? [...value.capabilityTags, cap]
      : value.capabilityTags.filter((c) => c !== cap);
    set({ capabilityTags: next });
  }

  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="adapter-provider">Provider</Label>
        <select
          id="adapter-provider"
          className={SELECT_CLASSNAME}
          value={value.cliProvider}
          disabled={providerLocked}
          onChange={(e) => {
            const cliProvider = e.target.value as CliProvider;
            const nextMeta = providers.find((p) => p.cli_provider === cliProvider);
            set({
              cliProvider,
              authType: nextMeta?.supported_auth_types[0] ?? AdapterAuthType.OAuth,
              modelProvider: "",
              apiKeyInput: "",
              apiKeyAction: "keep",
            });
          }}
        >
          {(providers.length > 0 ? providers.map((p) => p.cli_provider) : Object.values(CliProvider)).map((p) => (
            <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>
          ))}
        </select>
        {/* honest capability note (design §5.1/§10.1): e.g. OpenCode has no
            pre-execution approval channel — never imply otherwise. */}
        {meta ? <p className="text-[11px] text-muted-foreground">{meta.capability_description}</p> : null}
      </div>

      {supportedAuthTypes.length > 1 ? (
        <div className="grid gap-1.5">
          <Label htmlFor="adapter-auth-type">Auth type</Label>
          <select
            id="adapter-auth-type"
            className={SELECT_CLASSNAME}
            value={value.authType}
            onChange={(e) => set({ authType: e.target.value as AdapterAuthType, apiKeyInput: "", apiKeyAction: "keep" })}
          >
            {supportedAuthTypes.map((t) => (
              <option key={t} value={t}>{t === AdapterAuthType.OAuth ? "OAuth (CLI-owned login)" : "API key"}</option>
            ))}
          </select>
        </div>
      ) : null}

      {value.authType === AdapterAuthType.OAuth ? (
        <div className="grid gap-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
          <p className="text-muted-foreground">
            Run this in your own terminal to log in — PersonaHub never reads or stores the token:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-background px-2 py-1 font-mono">{OAUTH_LOGIN_COMMAND[value.cliProvider]}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void navigator.clipboard?.writeText(OAUTH_LOGIN_COMMAND[value.cliProvider]); }}
            >
              Copy
            </Button>
          </div>
          <p className="text-muted-foreground">Then use "Validate login" below to confirm PersonaHub can reach it.</p>
        </div>
      ) : null}

      {isOpenCode ? (
        <div className="grid gap-1.5">
          <Label htmlFor="adapter-model-provider">Model provider</Label>
          {value.authType === AdapterAuthType.ApiKey ? (
            <select
              id="adapter-model-provider"
              className={SELECT_CLASSNAME}
              value={value.modelProvider}
              onChange={(e) => set({ modelProvider: e.target.value })}
            >
              <option value="">Select a model provider…</option>
              {modelProviderAllowlist.map((mp) => (
                <option key={mp} value={mp}>{mp}</option>
              ))}
            </select>
          ) : (
            <Input
              id="adapter-model-provider"
              value={value.modelProvider}
              onChange={(e) => set({ modelProvider: e.target.value })}
              placeholder="e.g. anthropic"
            />
          )}
        </div>
      ) : null}

      {isOpenCode ? (
        <div className="grid gap-1.5">
          <Label htmlFor="adapter-default-model-required">Default model</Label>
          <Input
            id="adapter-default-model-required"
            value={value.defaultModel}
            onChange={(e) => set({ defaultModel: e.target.value })}
            placeholder="gpt-5"
            required
          />
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="adapter-default-model">Default model (optional)</Label>
          <Input
            id="adapter-default-model"
            value={value.defaultModel}
            onChange={(e) => set({ defaultModel: e.target.value })}
            placeholder="gpt-5"
          />
        </div>
      )}

      {value.authType === AdapterAuthType.ApiKey ? (
        <div className="grid gap-1.5">
          <Label htmlFor="adapter-api-key">API key</Label>
          {hasApiKey && value.apiKeyAction !== "replace" ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 rounded-md border border-input bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
                {value.apiKeyAction === "clear" ? "Will be cleared" : "Configured ••••"}
              </span>
              {value.apiKeyAction === "clear" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => set({ apiKeyAction: "keep" })}>
                  Undo
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ apiKeyAction: "replace", apiKeyInput: "" })}>
                    Replace
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ apiKeyAction: "clear" })}>
                    Clear
                  </Button>
                </>
              )}
            </div>
          ) : (
            <Input
              id="adapter-api-key"
              type="password"
              value={value.apiKeyInput}
              onChange={(e) => set({ apiKeyInput: e.target.value, apiKeyAction: "replace" })}
              placeholder="sk-…"
              autoComplete="off"
            />
          )}
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label>Capabilities</Label>
        <div className="flex items-center gap-4">
          <label htmlFor="adapter-capability-implementation" className="flex items-center gap-1.5 text-sm">
            <input
              id="adapter-capability-implementation"
              type="checkbox"
              checked={value.capabilityTags.includes(AgentCapability.Implementation)}
              onChange={(e) => toggleCapability(AgentCapability.Implementation, e.target.checked)}
            />
            Implementation
          </label>
          <label htmlFor="adapter-capability-validator" className="flex items-center gap-1.5 text-sm">
            <input
              id="adapter-capability-validator"
              type="checkbox"
              checked={value.capabilityTags.includes(AgentCapability.Validator)}
              onChange={(e) => toggleCapability(AgentCapability.Validator, e.target.checked)}
            />
            Validator
          </label>
        </div>
      </div>
    </>
  );
}
