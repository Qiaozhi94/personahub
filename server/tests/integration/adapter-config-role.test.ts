import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import type { AgentAdapter } from "../../src/runtime/types.js";

// AC-001 fix: a resolvable "codex" command now starts Unknown and only
// converges to Available via a real (here, scripted) background probe — see
// AdapterConfigService.autoValidateAfterCreate/Update.
function scriptedCodexAdapter(): AgentAdapter {
  return {
    provider: "codex",
    capabilities: { provider: "codex", supportsApprovalHook: false, supportsStructuredTrace: false, supportsFinalMessage: false, executionTimeoutMs: 60_000 },
    validate: async () => ({ available: true, errorMessage: null }),
    start: () => { throw new Error("not used in this test"); },
  };
}

// F004's original "role" input/query model is superseded by F005's
// capability_tags (design §4.1): `agent_configs.role` is now a deprecated
// internal field, deterministically DERIVED from capability_tags — it is no
// longer accepted as create/update input, and
// `listAvailableByProjectAndRole()` has been deleted in favor of
// `listAvailableByProjectAndCapability()` (T028). This file is rewritten
// in place (not renamed) to keep git history attached to the same path;
// the describe blocks below are the direct successors of the original
// "listAvailableByProjectAndRole" / "create role validation" /
// "update role validation" ones.

describe("AgentConfigRepository and AdapterConfigService F005 capability derivation", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    services.adapterRegistry.register(scriptedCodexAdapter());
    const project = services.projectService.create("Test");
    projectId = project.id;
  });
  afterEach(() => disposeTestServices(services));

  function createAdapterDirectly(capabilityTags: AgentCapability[], status: AdapterStatus, name?: string) {
    return services.agentConfigRepo.create({
      project_id: projectId,
      name: name ?? `Adapter-${capabilityTags.join("+")}`,
      role: capabilityTags.includes(AgentCapability.Validator) ? "validator" : "implementation",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: capabilityTags,
      default_model: "gpt-5",
      status,
    });
  }

  describe("listAvailableByProjectAndCapability", () => {
    it("returns available validators sorted by created_at, id ASC", () => {
      createAdapterDirectly([AgentCapability.Implementation], AdapterStatus.Available, "Impl1");
      const v1 = createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "Val1");
      const v2 = createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "Val2");
      const v3 = createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "Val3");

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);
      const expected = [v1, v2, v3].sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
      );

      expect(validators).toHaveLength(3);
      expect(validators.map((a) => a.id)).toEqual(expected.map((a) => a.id));
    });

    it("excludes unavailable validators", () => {
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "ValAvail");
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Unavailable, "ValUnavail");

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(validators).toHaveLength(1);
      expect(validators[0].name).toBe("ValAvail");
    });

    it("excludes implementation-only adapters", () => {
      createAdapterDirectly([AgentCapability.Implementation], AdapterStatus.Available, "Impl");
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "Val");

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(validators).toHaveLength(1);
      expect(validators[0].capability_tags).toContain(AgentCapability.Validator);
    });

    it("returns empty when no validators exist", () => {
      createAdapterDirectly([AgentCapability.Implementation], AdapterStatus.Available, "Impl");

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(validators).toHaveLength(0);
    });

    it("returns empty when all validators are unavailable", () => {
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Unavailable, "Val1");
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Unavailable, "Val2");

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(validators).toHaveLength(0);
    });

    it("excludes adapters from other projects", () => {
      const otherProject = services.projectService.create("Other");
      services.agentConfigRepo.create({
        project_id: otherProject.id,
        name: "OtherVal",
        role: "validator",
        cli_provider: "codex",
        command: "codex",
        args: [],
        capability_tags: [AgentCapability.Validator],
        default_model: null,
        status: AdapterStatus.Available,
      });
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "MyVal");

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(validators).toHaveLength(1);
      expect(validators[0].name).toBe("MyVal");
    });

    it("returns available implementation adapters when filtered by Implementation", () => {
      createAdapterDirectly([AgentCapability.Implementation], AdapterStatus.Available, "Impl1");
      createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "Val1");

      const impls = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Implementation);

      expect(impls).toHaveLength(1);
      expect(impls[0].capability_tags).toContain(AgentCapability.Implementation);
    });

    it("a multi-capability adapter is returned for both Implementation and Validator queries", () => {
      const multi = createAdapterDirectly([AgentCapability.Implementation, AgentCapability.Validator], AdapterStatus.Available, "Multi");

      const impls = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Implementation);
      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(impls.map((a) => a.id)).toContain(multi.id);
      expect(validators.map((a) => a.id)).toContain(multi.id);
    });

    it("sort is deterministic by created_at then id", () => {
      const created: { id: string; created_at: string }[] = [];
      for (let i = 0; i < 5; i++) {
        const adapter = createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, `Val${i}`);
        created.push({ id: adapter.id, created_at: adapter.created_at });
      }
      const expectedIds = created.sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
      ).map((a) => a.id);

      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);

      expect(validators.map((a) => a.id)).toEqual(expectedIds);
    });
  });

  describe("role is derived from capability_tags, never accepted as create input", () => {
    it("capability_tags=[implementation] derives role=implementation", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Impl",
        cli_provider: "codex",
        command: "codex",
        capability_tags: [AgentCapability.Implementation],
      });

      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("implementation");
    });

    it("capability_tags=[validator] derives role=validator", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Val",
        cli_provider: "codex",
        command: "codex",
        capability_tags: [AgentCapability.Validator],
      });

      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("validator");
    });

    it("defaults capability_tags (and thus role) to implementation when omitted", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Default",
        cli_provider: "codex",
        command: "codex",
      });

      expect(adapter.capability_tags).toEqual([AgentCapability.Implementation]);
      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("implementation");
    });

    // Final-comprehensive-report regression: create() used to treat an
    // explicit empty array the same as "omitted" and silently upgrade it to
    // [implementation] — losing the user's deliberate "consult-only, no
    // workflow capability" choice (design §7.2 rule 6). update() already
    // preserved [] correctly via an `!== undefined` check; create() must
    // match that semantics, not just its own historical default.
    it("preserves an explicitly empty capability_tags array on create (consult-only adapter), unlike an omitted field", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "ConsultOnly",
        cli_provider: "codex",
        command: "codex",
        capability_tags: [],
      });

      expect(adapter.capability_tags).toEqual([]);
      expect(services.agentConfigRepo.getById(adapter.id)?.capability_tags).toEqual([]);
      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("implementation");
      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);
      expect(validators.map((v) => v.id)).not.toContain(adapter.id);
      const implementers = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Implementation);
      expect(implementers.map((v) => v.id)).not.toContain(adapter.id);
    });

    it("capability_tags=[implementation, validator] derives role=validator (validator takes precedence for the deprecated column)", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Multi",
        cli_provider: "codex",
        command: "codex",
        capability_tags: [AgentCapability.Implementation, AgentCapability.Validator],
      });

      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("validator");
    });

    it("the derived role never appears on the public DTO", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "NoRoleLeak",
        cli_provider: "codex",
        command: "codex",
        capability_tags: [AgentCapability.Validator],
      });

      expect("role" in adapter).toBe(false);
    });
  });

  describe("update capability_tags re-derives role", () => {
    it("changing capability_tags from implementation to validator updates the derived role", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Switchable", cli_provider: "codex", command: "codex",
        capability_tags: [AgentCapability.Implementation],
      });
      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("implementation");

      services.adapterConfigService.update(adapter.id, { capability_tags: [AgentCapability.Validator] });

      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("validator");
    });

    it("update without capability_tags does not change the derived role", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Stable", cli_provider: "codex", command: "codex",
        capability_tags: [AgentCapability.Validator],
      });

      services.adapterConfigService.update(adapter.id, { name: "Renamed" });

      expect(services.agentConfigRepo.getById(adapter.id)?.role).toBe("validator");
    });

    // Regression for the review-report finding: PATCH used to only re-derive
    // `role` (deprecated) and never persisted `capability_tags` itself, so
    // the DTO/routing kept using the stale value even though the derived
    // role looked updated.
    it("changing capability_tags from implementation to validator persists capability_tags and updates routing", async () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "RoutingSwitchable", cli_provider: "codex", command: "codex",
        capability_tags: [AgentCapability.Implementation],
      });
      expect(services.agentConfigRepo.getById(adapter.id)?.capability_tags).toEqual([AgentCapability.Implementation]);
      expect(
        services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator),
      ).toHaveLength(0);

      services.adapterConfigService.update(adapter.id, { capability_tags: [AgentCapability.Validator] });
      // AC-001 fix: the edit invalidates status back to Unknown; a real
      // (here, scripted) probe must converge it back to Available before
      // listAvailableByProjectAndCapability() (which filters on Available)
      // will surface it again.
      await services.adapterConfigService.shutdown();

      const updated = services.agentConfigRepo.getById(adapter.id);
      expect(updated?.capability_tags).toEqual([AgentCapability.Validator]);
      const fetched = services.adapterConfigService.getById(adapter.id);
      expect(fetched.capability_tags).toEqual([AgentCapability.Validator]);
      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Validator);
      expect(validators.map((v) => v.id)).toContain(adapter.id);
      const implementers = services.agentConfigRepo.listAvailableByProjectAndCapability(projectId, AgentCapability.Implementation);
      expect(implementers.map((v) => v.id)).not.toContain(adapter.id);
    });

    it("update without capability_tags does not change the persisted capability_tags", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "TagsStable", cli_provider: "codex", command: "codex",
        capability_tags: [AgentCapability.Validator],
      });

      services.adapterConfigService.update(adapter.id, { name: "Renamed" });

      expect(services.agentConfigRepo.getById(adapter.id)?.capability_tags).toEqual([AgentCapability.Validator]);
    });
  });

  describe("identity reading for snapshot", () => {
    it("getById returns adapter with fields needed for identity snapshot", () => {
      const adapter = createAdapterDirectly([AgentCapability.Validator], AdapterStatus.Available, "MyValidator");

      const fetched = services.agentConfigRepo.getById(adapter.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(adapter.id);
      expect(fetched!.name).toBe("MyValidator");
      expect(fetched!.cli_provider).toBe("codex");
      expect(fetched!.default_model).toBe("gpt-5");
      expect(fetched!.role).toBe("validator");
    });

    it("adapter config changes do not affect existing run identity snapshots", () => {
      const adapter = createAdapterDirectly([AgentCapability.Implementation], AdapterStatus.Available, "Original");
      const identity = {
        adapter_config_id: adapter.id,
        name: adapter.name,
        cli_provider: adapter.cli_provider,
        default_model: adapter.default_model,
      };

      services.agentConfigRepo.update(adapter.id, {
        name: "Changed",
        default_model: "gpt-6",
        updated_at: new Date().toISOString(),
      });

      expect(identity.name).toBe("Original");
      expect(identity.default_model).toBe("gpt-5");

      const fetched = services.agentConfigRepo.getById(adapter.id);
      expect(fetched!.name).toBe("Changed");
      expect(fetched!.default_model).toBe("gpt-6");
    });
  });
});
