import { describe, it, expect } from "vitest";
import { AgentAdapterRegistry } from "../../src/runtime/adapter-registry.js";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import type { AgentAdapter, AgentAdapterCapabilities } from "../../src/runtime/types.js";
import { hasCapability } from "../../src/repositories/agent-config.js";
import { AgentCapability, CliProvider } from "@personahub/shared/types";

/** Minimal AgentAdapter stub for registry-mechanism tests (T027) — validate/
 * start are never invoked here, only `provider`/`capabilities` are exercised. */
function stubAdapter(provider: string): AgentAdapter {
  const capabilities: AgentAdapterCapabilities = {
    provider,
    supportsApprovalHook: false,
    supportsStructuredTrace: false,
    supportsFinalMessage: false,
    executionTimeoutMs: 60_000,
  };
  return {
    provider,
    capabilities,
    validate: () => { throw new Error("not implemented in stub"); },
    start: () => { throw new Error("not implemented in stub"); },
  };
}

describe("AgentAdapterRegistry", () => {
  it("registers and retrieves adapter by provider", () => {
    const registry = new AgentAdapterRegistry();
    const fake = new FakeAgentAdapter();
    registry.register(fake);
    expect(registry.getByProvider("fake")).toBe(fake);
  });

  it("returns undefined for unknown provider", () => {
    const registry = new AgentAdapterRegistry();
    expect(registry.getByProvider("unknown")).toBeUndefined();
  });

  it("getForConfig returns adapter matching cli_provider", () => {
    const registry = new AgentAdapterRegistry();
    const fake = new FakeAgentAdapter();
    registry.register(fake);
    const adapter = registry.getForConfig({ cli_provider: "fake" });
    expect(adapter).toBe(fake);
  });

  it("getForConfig throws for unknown provider", () => {
    const registry = new AgentAdapterRegistry();
    expect(() => registry.getForConfig({ cli_provider: "unknown" })).toThrow(
      "No adapter registered for provider: unknown",
    );
  });

  describe("three real providers (T027/T028)", () => {
    it("registers and looks up codex/claude-code/opencode independently", () => {
      const registry = new AgentAdapterRegistry();
      const codex = stubAdapter(CliProvider.Codex);
      const claude = stubAdapter(CliProvider.ClaudeCode);
      const opencode = stubAdapter(CliProvider.OpenCode);
      registry.register(codex);
      registry.register(claude);
      registry.register(opencode);

      expect(registry.getByProvider(CliProvider.Codex)).toBe(codex);
      expect(registry.getByProvider(CliProvider.ClaudeCode)).toBe(claude);
      expect(registry.getByProvider(CliProvider.OpenCode)).toBe(opencode);
    });

    it("getForConfig resolves each provider to its own registered adapter, not a random one", () => {
      const registry = new AgentAdapterRegistry();
      const codex = stubAdapter(CliProvider.Codex);
      const claude = stubAdapter(CliProvider.ClaudeCode);
      registry.register(codex);
      registry.register(claude);

      expect(registry.getForConfig({ cli_provider: CliProvider.ClaudeCode })).toBe(claude);
      expect(registry.getForConfig({ cli_provider: CliProvider.Codex })).toBe(codex);
    });
  });

  describe("register() replaces silently — the test suite depends on this pervasively", () => {
    // Corrects an earlier design assumption ("duplicate register在开发/测试直接
    // throw") against real, already-established codebase convention:
    // createTestServices() always registers a default FakeAgentAdapter(), and
    // dozens of existing tests re-register a differently-configured one for
    // their own scenario. `register()` must keep replacing, or that entire
    // pattern breaks. Strict duplicate-rejection lives in `registerUnique()`
    // instead, for contexts that should never legitimately re-register.
    it("register() replaces an existing provider registration without throwing", () => {
      const registry = new AgentAdapterRegistry();
      const first = stubAdapter(CliProvider.Codex);
      const second = stubAdapter(CliProvider.Codex);
      registry.register(first);
      expect(() => registry.register(second)).not.toThrow();
      expect(registry.getByProvider(CliProvider.Codex)).toBe(second);
    });
  });

  describe("registerUnique() throws on duplicate (design §6.1, for contexts that should never re-register)", () => {
    it("throws when registering a second adapter for the same provider", () => {
      const registry = new AgentAdapterRegistry();
      registry.registerUnique(stubAdapter(CliProvider.Codex));
      expect(() => registry.registerUnique(stubAdapter(CliProvider.Codex))).toThrow(
        /already registered/i,
      );
    });

    it("does not throw when registering distinct providers in sequence", () => {
      const registry = new AgentAdapterRegistry();
      expect(() => {
        registry.registerUnique(stubAdapter(CliProvider.Codex));
        registry.registerUnique(stubAdapter(CliProvider.ClaudeCode));
        registry.registerUnique(stubAdapter(CliProvider.OpenCode));
      }).not.toThrow();
    });
  });
});

describe("hasCapability() — single source of truth for manual routing and ValidatorSelector (T027/T028)", () => {
  it("returns true when the tag is present", () => {
    expect(hasCapability({ capability_tags: [AgentCapability.Validator] }, AgentCapability.Validator)).toBe(true);
  });

  it("returns false when the tag is absent", () => {
    expect(hasCapability({ capability_tags: [AgentCapability.Implementation] }, AgentCapability.Validator)).toBe(false);
  });

  it("returns true for either tag on a multi-capability record", () => {
    const record = { capability_tags: [AgentCapability.Implementation, AgentCapability.Validator] };
    expect(hasCapability(record, AgentCapability.Implementation)).toBe(true);
    expect(hasCapability(record, AgentCapability.Validator)).toBe(true);
  });

  it("returns false for an empty capability_tags array", () => {
    expect(hasCapability({ capability_tags: [] }, AgentCapability.Implementation)).toBe(false);
  });
});
