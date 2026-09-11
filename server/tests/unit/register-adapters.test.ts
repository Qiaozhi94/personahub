import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentAdapterRegistry } from "../../src/runtime/adapter-registry.js";
import {
  buildProductionAdapterRegistry,
  registerAgentAdapters,
  resolveEnableFakeAdapter,
} from "../../src/runtime/register-adapters.js";
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

describe("resolveEnableFakeAdapter (review R3-016 round-4 follow-up)", () => {
  it("is false when ENABLE_FAKE_ADAPTER is unset — the real production default", () => {
    expect(resolveEnableFakeAdapter({})).toBe(false);
  });

  it("is true only for the exact string '1'", () => {
    expect(resolveEnableFakeAdapter({ ENABLE_FAKE_ADAPTER: "1" })).toBe(true);
  });

  it("stays false for any other value — no truthy-string coercion trap", () => {
    for (const value of ["true", "yes", "TRUE", "01", "0", ""]) {
      expect(resolveEnableFakeAdapter({ ENABLE_FAKE_ADAPTER: value })).toBe(false);
    }
  });
});

describe("buildProductionAdapterRegistry (review R3-016 round-4 follow-up)", () => {
  // This is the exact function server/src/index.ts calls with process.env —
  // exercising it directly closes the round-3 gap where a test only ever
  // called registerAgentAdapters() with a manually-passed boolean, so a
  // hardcoded true at the real call site could regress silently.
  it("builds a registry with no fake adapter for a real, unmodified production env", () => {
    const registry = buildProductionAdapterRegistry(process.env);
    expect(registry.getByProvider("fake")).toBeUndefined();
    expect(registry.getByProvider(CliProvider.Codex)).toBeDefined();
  });

  it("only registers the fake adapter when the env explicitly opts in", () => {
    expect(buildProductionAdapterRegistry({ ENABLE_FAKE_ADAPTER: "1" }).getByProvider("fake")).toBeDefined();
    expect(buildProductionAdapterRegistry({}).getByProvider("fake")).toBeUndefined();
  });
});

describe("server/src/index.ts wiring (review R3-016 round-4 follow-up)", () => {
  // Closes the residual gap buildProductionAdapterRegistry's own unit tests
  // can't: nothing above proves index.ts actually calls that function with
  // an unmodified `process.env`, rather than e.g. a hardcoded env object
  // that always enables the fake adapter regardless of the real environment.
  // A source-scan is the right tool here specifically because the two
  // things it's stitching together (the function's behavior, and index.ts's
  // own startup sequencing) are already independently behavior-tested above
  // and in f009-v344's e2e suite — this only has to prove the wiring between
  // them wasn't silently changed.
  it("calls buildProductionAdapterRegistry with the real process.env, unmodified", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "..", "src", "index.ts"), "utf8");
    expect(source).toMatch(/buildProductionAdapterRegistry\(\s*process\.env\s*\)/);
  });

  it("mutation proof: a hardcoded env object at the call site would fail the check above", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "..", "src", "index.ts"), "utf8");
    const mutated = source.replace(
      "buildProductionAdapterRegistry(process.env)",
      'buildProductionAdapterRegistry({ ENABLE_FAKE_ADAPTER: "1" })',
    );
    expect(mutated).not.toBe(source);
    expect(mutated).not.toMatch(/buildProductionAdapterRegistry\(\s*process\.env\s*\)/);
  });
});
