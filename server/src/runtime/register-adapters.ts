import { AgentAdapterRegistry } from "./adapter-registry.js";
import { FakeAgentAdapter } from "./adapters/fake-adapter.js";
import { CodexCliAdapter } from "./adapters/codex-cli-adapter.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code-adapter.js";
import { OpenCodeAdapter } from "./adapters/opencode-adapter.js";

/**
 * Registers every AgentAdapter provider the server knows about. Split out of
 * index.ts (whose module body unconditionally boots the real server on
 * import) so tests can assert the fake adapter is absent by default without
 * booting anything (review R3-016).
 */
export function registerAgentAdapters(registry: AgentAdapterRegistry, options: { enableFakeAdapter: boolean }): void {
  if (options.enableFakeAdapter) {
    // Fixture-only "fake" provider: never a real CLI. Graph node dispatches
    // get a node_key-matched finalMessage from FakeAgentAdapter itself (see
    // its "## Node:" detection); anything else — a validator round trigger —
    // falls back to this default, a deterministic failing round so fixtures
    // that live-trigger validation (F009 journey) get a real, parseable
    // verdict instead of blocking on "no final message".
    registry.register(
      new FakeAgentAdapter({
        finalMessage: JSON.stringify({
          schema_version: 1,
          outcome: "failed",
          summary: "Fixture CLI validator: deterministic failing round for fixture-driven journeys.",
          // A "failed" outcome requires >=1 finding (result-parser.ts invariant)
          // or parseValidationResult rejects the envelope as unparsable.
          findings: [
            {
              severity: "warning",
              message: "Fixture CLI validator: no real review was performed.",
              suggestion: null,
              evidence_refs: [],
              file_path: null,
              line: null,
            },
          ],
          evidence_refs: [],
          missing_evidence: [],
          key_decisions: [],
          lessons_candidate: [],
        }),
      }),
    );
  }
  registry.register(new CodexCliAdapter());
  registry.register(new ClaudeCodeAdapter());
  registry.register(new OpenCodeAdapter());
}

/**
 * The actual opt-in policy: only `ENABLE_FAKE_ADAPTER=1` turns the fake
 * adapter on — every other value (unset, "0", "true", "yes", ...) keeps it
 * off. Exported and pure (a plain env object in, a boolean out) so a test
 * exercises the exact policy `server/src/index.ts` uses, without needing to
 * boot the real server to reach it (review R3-016).
 */
export function resolveEnableFakeAdapter(env: NodeJS.ProcessEnv): boolean {
  return env.ENABLE_FAKE_ADAPTER === "1";
}

/**
 * The single call `server/src/index.ts` makes for its production adapter
 * registry — resolving the opt-in policy from a real env object and
 * registering every adapter in one step. Kept as one importable function
 * (rather than index.ts inlining `resolveEnableFakeAdapter` + `new
 * AgentAdapterRegistry()` + `registerAgentAdapters` itself) specifically so
 * a test can call the exact production code path with a controlled `env`
 * and assert on the resulting registry, instead of only exercising
 * `registerAgentAdapters` with a manually-passed boolean that could drift
 * from what index.ts actually computes (review R3-016).
 */
export function buildProductionAdapterRegistry(env: NodeJS.ProcessEnv): AgentAdapterRegistry {
  const registry = new AgentAdapterRegistry();
  registerAgentAdapters(registry, { enableFakeAdapter: resolveEnableFakeAdapter(env) });
  return registry;
}
