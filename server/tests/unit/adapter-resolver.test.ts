import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { resolveAdapter } from "../../src/services/adapter-resolver.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus, RunDispatchSource, AgentCapability } from "@personahub/shared/types";

// T053: AdapterResolver — design §7.1. Uses real repos (createTestServices())
// rather than hand-mocked ones, so the "same project"/"available" checks
// are exercised against the real schema, not an assumption about it.

describe("resolveAdapter (T053/T054)", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    projectId = services.projectService.create("Test Project").id;
  });
  afterEach(() => disposeTestServices(services));

  function makeAdapter(overrides: Partial<Parameters<TestServices["agentConfigRepo"]["create"]>[0]> = {}) {
    return services.agentConfigRepo.create({
      project_id: projectId,
      name: "Adapter",
      role: "implementation",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [AgentCapability.Implementation],
      default_model: null,
      status: AdapterStatus.Available,
      ...overrides,
    });
  }

  describe("explicit adapter id", () => {
    it("resolves an explicit, available, same-project adapter with source=user_explicit", () => {
      const adapter = makeAdapter();
      const result = resolveAdapter(services, projectId, adapter.id);
      expect(result).toEqual({ ok: true, adapterConfigId: adapter.id, source: RunDispatchSource.UserExplicit });
    });

    it("rejects an explicit adapter from a different project", () => {
      const otherProjectId = services.projectService.create("Other Project").id;
      const otherAdapter = services.agentConfigRepo.create({
        project_id: otherProjectId, name: "Other", role: "implementation", cli_provider: "codex",
        command: "codex", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
      });
      const result = resolveAdapter(services, projectId, otherAdapter.id);
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.ADAPTER_NOT_FOUND });
    });

    it("rejects a nonexistent explicit adapter id", () => {
      const result = resolveAdapter(services, projectId, "adp_nonexistent");
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.ADAPTER_NOT_FOUND });
    });

    it("rejects an explicit but unavailable adapter", () => {
      const adapter = makeAdapter({ status: AdapterStatus.Unavailable });
      const result = resolveAdapter(services, projectId, adapter.id);
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.ADAPTER_UNAVAILABLE });
    });
  });

  describe("omitted adapter id falls back to Project default", () => {
    it("resolves the Project default with source=user_default", () => {
      const adapter = makeAdapter();
      services.projectRepo.setDefaultAdapter(projectId, adapter.id);
      const result = resolveAdapter(services, projectId, undefined);
      expect(result).toEqual({ ok: true, adapterConfigId: adapter.id, source: RunDispatchSource.UserDefault });
    });

    it("returns DEFAULT_ADAPTER_UNAVAILABLE when the Project has no default set", () => {
      makeAdapter();
      const result = resolveAdapter(services, projectId, undefined);
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE });
    });

    it("returns DEFAULT_ADAPTER_UNAVAILABLE when the default adapter has since become unavailable — never falls back to another adapter", () => {
      const adapter = makeAdapter();
      const other = makeAdapter({ name: "Other available" });
      services.projectRepo.setDefaultAdapter(projectId, adapter.id);
      services.agentConfigRepo.update(adapter.id, { status: AdapterStatus.Unavailable, updated_at: new Date().toISOString() });

      const result = resolveAdapter(services, projectId, undefined);
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE });
      // Confirms no silent "pick another available adapter" fallback happened.
      expect((result as { ok: false }).ok).toBe(false);
      void other;
    });

    it("returns DEFAULT_ADAPTER_UNAVAILABLE when the default adapter config was deleted (stale reference)", () => {
      const adapter = makeAdapter();
      services.projectRepo.setDefaultAdapter(projectId, adapter.id);
      services.agentConfigRepo.delete(adapter.id);

      const result = resolveAdapter(services, projectId, undefined);
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE });
    });
  });

  describe("deterministic source, no random fallback", () => {
    it("never picks 'first in list' when default is unset — always the same DEFAULT_ADAPTER_UNAVAILABLE error", () => {
      makeAdapter({ name: "A" });
      makeAdapter({ name: "B" });
      makeAdapter({ name: "C" });
      const result = resolveAdapter(services, projectId, undefined);
      expect(result).toEqual({ ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE });
    });

    it("resolving the same input twice yields the identical result", () => {
      const adapter = makeAdapter();
      const r1 = resolveAdapter(services, projectId, adapter.id);
      const r2 = resolveAdapter(services, projectId, adapter.id);
      expect(r1).toEqual(r2);
    });
  });
});
