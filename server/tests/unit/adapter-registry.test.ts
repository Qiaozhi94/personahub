import { describe, it, expect } from "vitest";
import { AgentAdapterRegistry } from "../../src/runtime/adapter-registry.js";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

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
});
