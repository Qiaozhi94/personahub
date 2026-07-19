import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus } from "@personahub/shared/types";
import { AppError } from "../../src/api/errors.js";

describe("AgentConfigRepository and AdapterConfigService F004 role validation", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    const project = services.projectService.create("Test");
    projectId = project.id;
  });
  afterEach(() => disposeTestServices(services));

  function createAdapterDirectly(role: string, status: AdapterStatus, name?: string) {
    return services.agentConfigRepo.create({
      project_id: projectId,
      name: name ?? `Adapter-${role}`,
      role,
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [],
      default_model: "gpt-5",
      status,
    });
  }

  describe("listAvailableByProjectAndRole", () => {
    it("returns available validators sorted by created_at, id ASC", () => {
      createAdapterDirectly("implementation", AdapterStatus.Available, "Impl1");
      const v1 = createAdapterDirectly("validator", AdapterStatus.Available, "Val1");
      const v2 = createAdapterDirectly("validator", AdapterStatus.Available, "Val2");
      const v3 = createAdapterDirectly("validator", AdapterStatus.Available, "Val3");

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");
      const expected = [v1, v2, v3].sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
      );

      expect(validators).toHaveLength(3);
      expect(validators.map((a) => a.id)).toEqual(expected.map((a) => a.id));
    });

    it("excludes unavailable validators", () => {
      createAdapterDirectly("validator", AdapterStatus.Available, "ValAvail");
      createAdapterDirectly("validator", AdapterStatus.Unavailable, "ValUnavail");

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");

      expect(validators).toHaveLength(1);
      expect(validators[0].name).toBe("ValAvail");
    });

    it("excludes implementation role adapters", () => {
      createAdapterDirectly("implementation", AdapterStatus.Available, "Impl");
      createAdapterDirectly("validator", AdapterStatus.Available, "Val");

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");

      expect(validators).toHaveLength(1);
      expect(validators[0].role).toBe("validator");
    });

    it("returns empty when no validators exist", () => {
      createAdapterDirectly("implementation", AdapterStatus.Available, "Impl");

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");

      expect(validators).toHaveLength(0);
    });

    it("returns empty when all validators are unavailable", () => {
      createAdapterDirectly("validator", AdapterStatus.Unavailable, "Val1");
      createAdapterDirectly("validator", AdapterStatus.Unavailable, "Val2");

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");

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
        capability_tags: [],
        default_model: null,
        status: AdapterStatus.Available,
      });
      createAdapterDirectly("validator", AdapterStatus.Available, "MyVal");

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");

      expect(validators).toHaveLength(1);
      expect(validators[0].name).toBe("MyVal");
    });

    it("returns available implementation adapters when role=implementation", () => {
      createAdapterDirectly("implementation", AdapterStatus.Available, "Impl1");
      createAdapterDirectly("validator", AdapterStatus.Available, "Val1");

      const impls = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "implementation");

      expect(impls).toHaveLength(1);
      expect(impls[0].role).toBe("implementation");
    });

    it("sort is deterministic by created_at then id", () => {
      const created: { id: string; created_at: string }[] = [];
      for (let i = 0; i < 5; i++) {
        const adapter = createAdapterDirectly("validator", AdapterStatus.Available, `Val${i}`);
        created.push({ id: adapter.id, created_at: adapter.created_at });
      }
      const expectedIds = created.sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
      ).map((a) => a.id);

      const validators = services.agentConfigRepo.listAvailableByProjectAndRole(projectId, "validator");

      expect(validators.map((a) => a.id)).toEqual(expectedIds);
    });
  });

  describe("create role validation", () => {
    it("creates adapter with role=implementation", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Impl",
        role: "implementation",
        cli_provider: "codex",
        command: "codex",
      });

      expect(adapter.role).toBe("implementation");
    });

    it("creates adapter with role=validator", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Val",
        role: "validator",
        cli_provider: "codex",
        command: "codex",
      });

      expect(adapter.role).toBe("validator");
    });

    it("defaults role to implementation when not provided", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Default",
        cli_provider: "codex",
        command: "codex",
      });

      expect(adapter.role).toBe("implementation");
    });

    it("rejects role=consult", () => {
      try {
        services.adapterConfigService.create(projectId, {
          name: "Consult",
          role: "consult",
          cli_provider: "codex",
          command: "codex",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_ROLE_INVALID);
      }
    });

    it("rejects role=reviewer", () => {
      try {
        services.adapterConfigService.create(projectId, {
          name: "Reviewer",
          role: "reviewer",
          cli_provider: "codex",
          command: "codex",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_ROLE_INVALID);
      }
    });

    it("rejects empty role string", () => {
      try {
        services.adapterConfigService.create(projectId, {
          name: "Empty",
          role: "",
          cli_provider: "codex",
          command: "codex",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_ROLE_INVALID);
      }
    });

    it("rejects arbitrary role string", () => {
      try {
        services.adapterConfigService.create(projectId, {
          name: "Arbitrary",
          role: "super-validator",
          cli_provider: "codex",
          command: "codex",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_ROLE_INVALID);
      }
    });
  });

  describe("update role validation", () => {
    it("updates role from implementation to validator", () => {
      const adapter = createAdapterDirectly("implementation", AdapterStatus.Available);

      const updated = services.adapterConfigService.update(adapter.id, { role: "validator" });

      expect(updated.role).toBe("validator");
    });

    it("updates role from validator to implementation", () => {
      const adapter = createAdapterDirectly("validator", AdapterStatus.Available);

      const updated = services.adapterConfigService.update(adapter.id, { role: "implementation" });

      expect(updated.role).toBe("implementation");
    });

    it("rejects updating role to consult", () => {
      const adapter = createAdapterDirectly("implementation", AdapterStatus.Available);

      try {
        services.adapterConfigService.update(adapter.id, { role: "consult" });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_ROLE_INVALID);
      }
    });

    it("rejects updating role to arbitrary string", () => {
      const adapter = createAdapterDirectly("validator", AdapterStatus.Available);

      try {
        services.adapterConfigService.update(adapter.id, { role: "reviewer" });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_ROLE_INVALID);
      }
    });

    it("update without role field does not change role", () => {
      const adapter = createAdapterDirectly("validator", AdapterStatus.Available);

      const updated = services.adapterConfigService.update(adapter.id, { name: "Renamed" });

      expect(updated.role).toBe("validator");
      expect(updated.name).toBe("Renamed");
    });
  });

  describe("identity reading for snapshot", () => {
    it("getById returns adapter with fields needed for identity snapshot", () => {
      const adapter = createAdapterDirectly("validator", AdapterStatus.Available, "MyValidator");

      const fetched = services.agentConfigRepo.getById(adapter.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(adapter.id);
      expect(fetched!.name).toBe("MyValidator");
      expect(fetched!.cli_provider).toBe("codex");
      expect(fetched!.default_model).toBe("gpt-5");
      expect(fetched!.role).toBe("validator");
    });

    it("adapter config changes do not affect existing run identity snapshots", () => {
      const adapter = createAdapterDirectly("implementation", AdapterStatus.Available, "Original");
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
