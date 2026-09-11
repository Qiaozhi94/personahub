import { describe, expect, it } from "vitest";
import { AgentAdapterRegistry } from "../../src/runtime/adapter-registry.js";
import { registerAgentAdapters } from "../../src/runtime/register-adapters.js";
import { CliProvider } from "@personahub/shared/types";

// review R3-016: the reviewer flagged that server/src/index.ts unconditionally
// registered FakeAgentAdapter — a fixture-only test double that never drives
// a real CLI — in the same production startup path used for a real
// deployment. Proves the default (production) wiring never registers it, and
// that opting in is the only way to get it.

describe("registerAgentAdapters (review R3-016)", () => {
  it("does not register the fake adapter by default", () => {
    const registry = new AgentAdapterRegistry();
    registerAgentAdapters(registry, { enableFakeAdapter: false });
    expect(registry.getByProvider("fake")).toBeUndefined();
  });

  it("still registers all three real providers when the fake adapter is disabled", () => {
    const registry = new AgentAdapterRegistry();
    registerAgentAdapters(registry, { enableFakeAdapter: false });
    expect(registry.getByProvider(CliProvider.Codex)).toBeDefined();
    expect(registry.getByProvider(CliProvider.ClaudeCode)).toBeDefined();
    expect(registry.getByProvider(CliProvider.OpenCode)).toBeDefined();
  });

  it("registers the fake adapter only when explicitly opted in", () => {
    const registry = new AgentAdapterRegistry();
    registerAgentAdapters(registry, { enableFakeAdapter: true });
    expect(registry.getByProvider("fake")).toBeDefined();
  });
});
