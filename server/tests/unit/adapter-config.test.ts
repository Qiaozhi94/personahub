import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus } from "@personahub/shared/types";
import { AppError } from "../../src/api/errors.js";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";

describe("AdapterConfigService", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    const project = services.projectService.create("Test Project", "desc");
    projectId = project.id;
  });
  afterEach(() => disposeTestServices(services));

  describe("create", () => {
    it("creates an adapter with valid codex command", () => {
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Local Codex",
        cli_provider: "codex",
        command: "codex",
        args: [],
        default_model: "gpt-5-codex",
      });
      expect(adapter.id).toMatch(/^adp_/);
      expect(adapter.name).toBe("Local Codex");
      expect(adapter.cli_provider).toBe("codex");
      expect(adapter.command).toBe("codex");
      expect(adapter.args).toEqual([]);
      expect(adapter.default_model).toBe("gpt-5-codex");
    });

    it("rejects unsupported provider", () => {
      try {
        services.adapterConfigService.create(projectId, {
          name: "Test",
          cli_provider: "claude",
          command: "claude",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED);
      }
    });

    it("rejects empty command", () => {
      try {
        services.adapterConfigService.create(projectId, {
          name: "Test",
          cli_provider: "codex",
          command: "",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_COMMAND_REQUIRED);
      }
    });

    it("rejects non-existent project", () => {
      try {
        services.adapterConfigService.create("prj_nonexistent", {
          name: "Test",
          cli_provider: "codex",
          command: "codex",
        });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.PROJECT_NOT_FOUND);
      }
    });
  });

  describe("list", () => {
    it("lists adapters by project", () => {
      services.adapterConfigService.create(projectId, {
        name: "Adapter 1",
        cli_provider: "codex",
        command: "codex",
      });
      services.adapterConfigService.create(projectId, {
        name: "Adapter 2",
        cli_provider: "codex",
        command: "codex",
      });
      const adapters = services.adapterConfigService.list(projectId);
      expect(adapters).toHaveLength(2);
    });
  });

  describe("getById", () => {
    it("returns adapter by id", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "Test",
        cli_provider: "codex",
        command: "codex",
      });
      const found = services.adapterConfigService.getById(created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws ADAPTER_NOT_FOUND for missing adapter", () => {
      try {
        services.adapterConfigService.getById("adp_nonexistent");
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_NOT_FOUND);
      }
    });
  });

  describe("update", () => {
    it("updates adapter name", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "Old Name",
        cli_provider: "codex",
        command: "codex",
      });
      const updated = services.adapterConfigService.update(created.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });

    it("throws ADAPTER_NOT_FOUND for missing adapter", () => {
      try {
        services.adapterConfigService.update("adp_nonexistent", { name: "Test" });
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_NOT_FOUND);
      }
    });
  });

  describe("delete", () => {
    it("deletes adapter with no runs", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "Test",
        cli_provider: "codex",
        command: "codex",
      });
      services.adapterConfigService.delete(created.id);
      try {
        services.adapterConfigService.getById(created.id);
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_NOT_FOUND);
      }
    });

    it("throws ADAPTER_NOT_FOUND for missing adapter", () => {
      try {
        services.adapterConfigService.delete("adp_nonexistent");
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as AppError).code).toBe(ErrorCode.ADAPTER_NOT_FOUND);
      }
    });
  });

  describe("validate", () => {
    it("re-validates adapter and updates status", async () => {
      // Local-only registration: registering CodexCliAdapter in the shared
      // test helpers would make every other "codex"-provider fixture in the
      // suite actually dispatchable, turning many `queued`-status assertions
      // into `running` (real spawn attempts). Scope it to this test instead.
      services.adapterRegistry.register(new CodexCliAdapter());
      const created = services.adapterConfigService.create(projectId, {
        name: "Test",
        cli_provider: "codex",
        command: "codex",
      });
      const validated = await services.adapterConfigService.validate(created.id);
      expect(validated.last_checked_at).not.toBeNull();
      expect([AdapterStatus.Available, AdapterStatus.Unavailable]).toContain(validated.status);
    });
  });
});
