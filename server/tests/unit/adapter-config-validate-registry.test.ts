import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import type { AgentAdapter, AgentAdapterCapabilities, AdapterValidationResult } from "../../src/runtime/types.js";

// T033/T034: AdapterConfigService.validate() must go through the registry's
// adapter.validate() — not a hardcoded local `--version` check — so each
// provider's own real auth probe (e.g. Claude's `auth status`, confirmed in
// Phase 1) is what actually determines availability, once Phase 5/6 wire
// real adapters in. This file proves the SERVICE mechanism generically via a
// scripted fake adapter; the real Codex path is covered by the existing
// adapter-config.test.ts "re-validates adapter" test (still passing, proving
// no regression for the one real provider available today).

function scriptedAdapter(provider: string, result: AdapterValidationResult): AgentAdapter {
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
    validate: async () => result,
    start: () => { throw new Error("not used in this test"); },
  };
}

describe("AdapterConfigService.validate() goes through the registry (T033/T034)", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    projectId = services.projectService.create("T033").id;
  });
  afterEach(() => disposeTestServices(services));

  it("uses the registered adapter's own validate() result, not a hardcoded check", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted", { available: false, errorMessage: "scripted: auth expired" }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "Scripted", role: "implementation", cli_provider: "scripted",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.status).toBe(AdapterStatus.Unavailable);
    expect(validated.auth_status_message).toBe("scripted: auth expired");
  });

  it("updates status to Available when the registered adapter reports available", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted-ok", { available: true, errorMessage: null }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "ScriptedOk", role: "implementation", cli_provider: "scripted-ok",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Unavailable,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.status).toBe(AdapterStatus.Available);
    expect(validated.auth_status_message).toBeNull();
  });

  it("updates last_checked_at on every validate() call", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted-time", { available: true, errorMessage: null }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "ScriptedTime", role: "implementation", cli_provider: "scripted-time",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Unknown,
    });
    expect(adapter.last_checked_at).toBeNull();

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.last_checked_at).not.toBeNull();
  });

  it("a version-string success does not by itself imply availability — the adapter's own probe result is authoritative", async () => {
    // Simulates the real finding from T001/T033: `--version` succeeding is
    // not proof of login. A scripted adapter whose validate() distinguishes
    // "binary found" from "authenticated" must have its own (false) verdict
    // honored, not overridden by any generic success heuristic.
    services.adapterRegistry.register(scriptedAdapter("scripted-authcheck", {
      available: false,
      errorMessage: "binary found, but not logged in",
    }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "AuthCheck", role: "implementation", cli_provider: "scripted-authcheck",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.status).toBe(AdapterStatus.Unavailable);
    expect(validated.auth_status_message).toBe("binary found, but not logged in");
  });
});
