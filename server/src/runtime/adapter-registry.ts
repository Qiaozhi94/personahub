import type { AgentAdapter } from "./types.js";

export class AgentAdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
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
