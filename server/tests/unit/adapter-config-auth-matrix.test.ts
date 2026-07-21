import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterAuthType, AgentCapability } from "@personahub/shared/types";
import { AppError } from "../../src/api/errors.js";

// T025: provider/auth field matrix (design §5.1).
//
// | Provider    | OAuth | API key |
// | codex       | yes   | no      |
// | claude-code | yes   | no      |
// | opencode    | yes   | yes (requires model_provider + default_model + api_key) |

function expectAppError(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
    expect.fail("Should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
  }
}

describe("AdapterConfigService provider/auth matrix (T025)", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    projectId = services.projectService.create("T025", "desc").id;
  });
  afterEach(() => disposeTestServices(services));

  describe("Codex and Claude Code — OAuth only, API key rejected", () => {
    it("accepts codex with auth_type=oauth", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Codex", cli_provider: "codex", command: "codex", auth_type: AdapterAuthType.OAuth,
        capability_tags: [AgentCapability.Implementation],
      });
      expect(adapter.auth_type).toBe(AdapterAuthType.OAuth);
      expect(adapter.has_api_key).toBe(false);
    });

    it("rejects codex with auth_type=api_key", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "Codex", cli_provider: "codex", command: "codex", auth_type: AdapterAuthType.ApiKey,
          capability_tags: [AgentCapability.Implementation], api_key: "sk-whatever",
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("accepts claude-code with auth_type=oauth", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Claude", cli_provider: "claude-code", command: "claude", auth_type: AdapterAuthType.OAuth,
        capability_tags: [AgentCapability.Implementation],
      });
      expect(adapter.auth_type).toBe(AdapterAuthType.OAuth);
    });

    it("rejects claude-code with auth_type=api_key", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "Claude", cli_provider: "claude-code", command: "claude", auth_type: AdapterAuthType.ApiKey,
          capability_tags: [AgentCapability.Implementation], api_key: "sk-whatever",
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });
  });

  describe("OpenCode — OAuth or API key", () => {
    // opencode-protocol-fixtures.md T005: omitting `-m provider/model` lets
    // OpenCode silently fall back to a free model instead of failing, so
    // model_provider/default_model are required regardless of auth_type —
    // not just for api_key mode (where the original reason was routing to
    // a confirmed env var).
    it("rejects oauth mode without model_provider", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.OAuth,
          default_model: "claude-sonnet-4-5",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("rejects oauth mode without default_model", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.OAuth,
          model_provider: "anthropic",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("accepts oauth with model_provider/default_model but no api_key — and does not enforce the api-key allowlist", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.OAuth,
        model_provider: "some-oauth-only-provider-not-in-the-api-key-allowlist", default_model: "claude-sonnet-4-5",
        capability_tags: [AgentCapability.Implementation],
      });
      expect(adapter.auth_type).toBe(AdapterAuthType.OAuth);
      expect(adapter.model_provider).toBe("some-oauth-only-provider-not-in-the-api-key-allowlist");
      expect(adapter.has_api_key).toBe(false);
    });

    it("accepts api_key with model_provider + default_model + api_key all present", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
        model_provider: "openai", default_model: "gpt-5", api_key: "sk-test-key",
        capability_tags: [AgentCapability.Implementation],
      });
      expect(adapter.auth_type).toBe(AdapterAuthType.ApiKey);
      expect(adapter.model_provider).toBe("openai");
      expect(adapter.has_api_key).toBe(true);
    });

    it("rejects api_key mode with model_provider missing", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
          default_model: "gpt-5", api_key: "sk-test-key",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("rejects api_key mode with default_model missing", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
          model_provider: "openai", api_key: "sk-test-key",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });

    it("rejects api_key mode with api_key missing", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
          model_provider: "openai", default_model: "gpt-5",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_API_KEY_REQUIRED);
    });

    it("rejects an unverified model_provider not in the confirmed allowlist", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
          model_provider: "totally-made-up-provider", default_model: "x", api_key: "sk-test-key",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_MODEL_PROVIDER_UNSUPPORTED);
    });
  });

  describe("mutually exclusive fields — OAuth must not carry an api_key", () => {
    it("rejects oauth mode with an api_key also provided", () => {
      expectAppError(() =>
        services.adapterConfigService.create(projectId, {
          name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.OAuth,
          api_key: "sk-should-not-be-here",
          capability_tags: [AgentCapability.Implementation],
        }),
      ErrorCode.ADAPTER_AUTH_INVALID);
    });
  });

  describe("switching auth_type clears the stale key", () => {
    it("switching from api_key to oauth on update clears the stored key", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
        model_provider: "openai", default_model: "gpt-5", api_key: "sk-test-key",
        capability_tags: [AgentCapability.Implementation],
      });
      expect(created.has_api_key).toBe(true);

      const updated = services.adapterConfigService.update(created.id, { auth_type: AdapterAuthType.OAuth });

      expect(updated.auth_type).toBe(AdapterAuthType.OAuth);
      expect(updated.has_api_key).toBe(false);
    });
  });

  describe("api_key tri-state on update", () => {
    it("omitted api_key on update preserves the existing key", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
        model_provider: "openai", default_model: "gpt-5", api_key: "sk-test-key",
        capability_tags: [AgentCapability.Implementation],
      });

      const updated = services.adapterConfigService.update(created.id, { name: "Renamed" });

      expect(updated.has_api_key).toBe(true);
      expect(updated.name).toBe("Renamed");
    });

    it("null api_key on update clears it", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
        model_provider: "openai", default_model: "gpt-5", api_key: "sk-test-key",
        capability_tags: [AgentCapability.Implementation],
      });

      const updated = services.adapterConfigService.update(created.id, { api_key: null });

      expect(updated.has_api_key).toBe(false);
    });

    it("a trimmed-empty api_key string on update is rejected", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "OpenCode", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
        model_provider: "openai", default_model: "gpt-5", api_key: "sk-test-key",
        capability_tags: [AgentCapability.Implementation],
      });

      expectAppError(() =>
        services.adapterConfigService.update(created.id, { api_key: "   " }),
      ErrorCode.ADAPTER_API_KEY_REQUIRED);
    });
  });

  describe("trim behavior", () => {
    it("trims model_provider and api_key on create", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "  OpenCode  ", cli_provider: "opencode", command: "opencode", auth_type: AdapterAuthType.ApiKey,
        model_provider: "  openai  ", default_model: "  gpt-5  ", api_key: "  sk-test-key  ",
        capability_tags: [AgentCapability.Implementation],
      });

      expect(adapter.name).toBe("OpenCode");
      expect(adapter.model_provider).toBe("openai");
      expect(adapter.default_model).toBe("gpt-5");
    });
  });
});
