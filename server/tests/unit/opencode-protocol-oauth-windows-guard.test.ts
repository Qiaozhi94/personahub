import { describe, it, expect } from "vitest";
import { AdapterAuthType, AdapterStatus, type AdapterConfig } from "@personahub/shared/types";
import { validateOpenCodeCommand } from "../../src/runtime/adapters/opencode-protocol.js";

function buildConfig(overrides: Partial<AdapterConfig>): AdapterConfig {
  return {
    id: "agt_test", project_id: "prj_test", name: "OpenCode Test",
    cli_provider: "opencode", command: "definitely-not-a-real-binary-xyz", args: [],
    capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Unknown,
    last_checked_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    auth_type: AdapterAuthType.OAuth, model_provider: "openai", has_api_key: false,
    auth_status_message: null, is_default: false,
    ...overrides,
  };
}

/**
 * Review-report regression: OpenCode OAuth validate() used to inherit the
 * operator's full process.env/HOME, so it could see real credentials that
 * the actual credential-isolated dispatch (workspace-context.ts) never
 * exposes to OpenCode on Windows — reporting "available" would be a lie
 * about what a real Run can do. Mirrors the platform-gated style already
 * used for the related HOMEDRIVE/HOMEPATH finding in workspace-context.test.ts.
 */
describe.skipIf(process.platform !== "win32")("validateOpenCodeCommand OAuth Windows guard (real-environment finding, 2026-07-23)", () => {
  it("fails closed for auth_type=oauth without spawning a probe process", async () => {
    const result = await validateOpenCodeCommand(buildConfig({ auth_type: AdapterAuthType.OAuth }));

    expect(result.available).toBe(false);
    expect(result.errorMessage).toMatch(/credential isolation/i);
    // Proves this returned from the guard, not from resolveExecutable
    // failing to find the (deliberately bogus) command.
    expect(result.errorMessage).not.toMatch(/Command not found/i);
  });

  it("does not apply the OAuth guard to api_key auth", async () => {
    const result = await validateOpenCodeCommand(
      buildConfig({ auth_type: AdapterAuthType.ApiKey }),
      "sk-test-key",
    );

    // Falls through to the real resolver/spawn path (and fails there, since
    // the binary doesn't exist) rather than being rejected by the OAuth guard.
    expect(result.available).toBe(false);
    expect(result.errorMessage).toMatch(/Command not found/i);
  });

  // Recheck-report regression: when the target workspace has
  // push_credentials_enabled=true, real dispatch (buildChildEnv()) skips
  // credential isolation entirely and passes through the full process.env —
  // the same environment this probe already runs with — so the guard must
  // not fail closed in that case.
  it("does not apply the OAuth guard when the caller says the target workspace skips credential isolation", async () => {
    const result = await validateOpenCodeCommand(
      buildConfig({ auth_type: AdapterAuthType.OAuth }),
      null,
      { pushCredentialsEnabled: true },
    );

    // Falls through to the real resolver/spawn path (and fails there, since
    // the binary doesn't exist) rather than being rejected by the OAuth guard.
    expect(result.available).toBe(false);
    expect(result.errorMessage).toMatch(/Command not found/i);
  });

  it("still applies the OAuth guard when pushCredentialsEnabled is explicitly false", async () => {
    const result = await validateOpenCodeCommand(
      buildConfig({ auth_type: AdapterAuthType.OAuth }),
      null,
      { pushCredentialsEnabled: false },
    );

    expect(result.available).toBe(false);
    expect(result.errorMessage).toMatch(/credential isolation/i);
  });
});
