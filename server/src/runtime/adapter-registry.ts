import type { AgentAdapter } from "./types.js";

export class AgentAdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  /**
   * Replaces any existing registration for the same provider. This is the
   * long-standing behavior the test suite already depends on pervasively:
   * `createTestServices()` registers a default `FakeAgentAdapter()`, and
   * individual tests re-register a differently-configured one (custom
   * delays/output/failure modes) for their own scenario. Use
   * `registerUnique()` when accidental double-registration should be a hard
   * error instead (e.g. production startup wiring, or a registry built fresh
   * for a single well-defined set of providers).
   */
  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /** design §6.1: duplicate provider register is a programming error in a context that should never re-register — fail loudly rather than silently replace. */
  registerUnique(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(`Adapter already registered for provider: ${adapter.provider}`);
    }
    this.adapters.set(adapter.provider, adapter);
  }

  getByProvider(provider: string): AgentAdapter | undefined {
    return this.adapters.get(provider);
  }

  getForConfig(adapterConfig: { cli_provider: string }): AgentAdapter {
    const adapter = this.adapters.get(adapterConfig.cli_provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${adapterConfig.cli_provider}`);
    }
    return adapter;
  }
}
