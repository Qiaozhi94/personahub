import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus } from "@personahub/shared/types";
import { AppError } from "../../src/api/errors.js";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";
import type { AgentAdapter } from "../../src/runtime/types.js";

// These tests drive the availability probe through a *scripted* adapter whose
// validate() returns available:true. create()'s initial status still depends on
// validateCommand() -> resolveExecutable() checking for a real `codex` binary on
// PATH, which does not exist on CI. Mock the resolver as a passthrough so the
// literal command always resolves, keeping these unit tests machine-independent
// (same convention as codex-cli-adapter.test.ts / claude-code-adapter.test.ts).
vi.mock("../../src/runtime/executable-resolver.js", () => ({
  resolveExecutable: vi.fn((command: string) => ({
    resolved: { executable: command, prefixArgs: [], source: "direct" as const },
    errorMessage: null,
  })),
}));

function scriptedCodexAdapter(available: boolean, errorMessage: string | null = null): AgentAdapter {
  return {
    provider: "codex",
    capabilities: { provider: "codex", supportsApprovalHook: false, supportsStructuredTrace: false, supportsFinalMessage: false, executionTimeoutMs: 60_000 },
    validate: async () => ({ available, errorMessage }),
    start: () => { throw new Error("not used in this test"); },
  };
}

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

    // AC-001 fix: a resolvable command is never promoted straight to
    // Available — create() returns Unknown synchronously, and only a real
    // (here, scripted) background probe may converge it, at which point the
    // deferred "first available adapter becomes default" assignment runs.
    it("starts Unknown for a resolvable command and converges to Available (plus default assignment) once the background probe confirms it", async () => {
      services.adapterRegistry.register(scriptedCodexAdapter(true));

      const adapter = services.adapterConfigService.create(projectId, {
        name: "Codex", cli_provider: "codex", command: "codex",
      });
      expect(adapter.status).toBe(AdapterStatus.Unknown);
      expect(adapter.is_default).toBe(false);

      await services.adapterConfigService.shutdown();

      const converged = services.adapterConfigService.getById(adapter.id);
      expect(converged.status).toBe(AdapterStatus.Available);
      expect(converged.is_default).toBe(true);
    });

    it("stays Unknown, and never becomes the Project default, when the background probe reports unavailable", async () => {
      services.adapterRegistry.register(scriptedCodexAdapter(false, "not logged in"));

      const adapter = services.adapterConfigService.create(projectId, {
        name: "Codex", cli_provider: "codex", command: "codex",
      });
      await services.adapterConfigService.shutdown();

      const converged = services.adapterConfigService.getById(adapter.id);
      expect(converged.status).toBe(AdapterStatus.Unavailable);
      expect(converged.is_default).toBe(false);
    });

    it("stays Unknown (not silently promoted) when the background probe itself throws, e.g. no registered adapter for the provider", async () => {
      // Deliberately does not register anything for "codex" — validate()'s
      // registry lookup throws, which autoValidateAfterCreate() must catch
      // and give up on quietly rather than ever assuming Available.
      const adapter = services.adapterConfigService.create(projectId, {
        name: "Codex", cli_provider: "codex", command: "codex",
      });
      await services.adapterConfigService.shutdown();

      const converged = services.adapterConfigService.getById(adapter.id);
      expect(converged.status).toBe(AdapterStatus.Unknown);
      expect(converged.is_default).toBe(false);
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

    // closure-check-report fix: an availability-relevant edit must clear
    // every workspace override for the adapter — otherwise
    // effectiveAdapterStatus() keeps preferring a stale per-workspace
    // Available earned under the OLD config over the freshly-invalidated
    // global Unknown, letting an unverified config change stay silently
    // routable in whichever workspace last validated it.
    describe("invalidates workspace overrides on availability-relevant changes", () => {
      // Registers a real, converging "codex" probe and awaits it so the
      // adapter genuinely starts from a confirmed-Available GLOBAL status
      // (not just a leftover Unknown) — otherwise a test asserting "global
      // status also got invalidated" couldn't distinguish "correctly
      // invalidated" from "never converged in the first place".
      async function createAdapterWithOverride(): Promise<{ adapterId: string; workspaceId: string }> {
        services.adapterRegistry.register(scriptedCodexAdapter(true));
        const created = services.adapterConfigService.create(projectId, {
          name: "A", cli_provider: "codex", command: "codex",
        });
        await services.adapterConfigService.shutdown();
        expect(services.adapterConfigService.getById(created.id).status).toBe(AdapterStatus.Available);

        const workspace = services.workspaceService.bind(projectId, createTempDir());
        services.adapterWorkspaceStatusRepo.upsert({
          adapter_config_id: created.id, workspace_id: workspace.id,
          status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
        });
        return { adapterId: created.id, workspaceId: workspace.id };
      }

      it("clears the override when command changes", async () => {
        const { adapterId, workspaceId } = await createAdapterWithOverride();
        services.adapterConfigService.update(adapterId, { command: "a-different-command" });
        expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)).toBeNull();
      });

      // closure-recheck-report fix: this used to only assert the override
      // was cleared — it missed that the GLOBAL status was left untouched
      // at the old `Available`, so the resolver kept routing to the new,
      // never-probed args without any real probe in between.
      it("clears the override AND invalidates the global status when only args change (args alone used to invalidate nothing)", async () => {
        const { adapterId, workspaceId } = await createAdapterWithOverride();

        const updated = services.adapterConfigService.update(adapterId, { args: ["--some-flag"] });

        expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)).toBeNull();
        expect(updated.status).toBe(AdapterStatus.Unknown);
        await services.adapterConfigService.shutdown();
        expect(services.adapterConfigService.getById(adapterId).status).toBe(AdapterStatus.Available);
      });

      it("clears the override when default_model changes", async () => {
        const { adapterId, workspaceId } = await createAdapterWithOverride();
        services.adapterConfigService.update(adapterId, { default_model: "gpt-5-codex" });
        expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)).toBeNull();
      });

      it("does NOT clear the override for a change unrelated to availability (name only)", async () => {
        const { adapterId, workspaceId } = await createAdapterWithOverride();
        services.adapterConfigService.update(adapterId, { name: "Renamed" });
        expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)?.status).toBe(AdapterStatus.Available);
      });
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

    // adapter_workspace_status has no ON DELETE CASCADE (schema v7) — an
    // adapter with a workspace override row would otherwise fail this
    // delete with a raw FK constraint error.
    it("deletes an adapter that has a workspace-status override row without an FK error", () => {
      const created = services.adapterConfigService.create(projectId, {
        name: "Test", cli_provider: "codex", command: "codex",
      });
      const workspace = services.workspaceService.bind(projectId, createTempDir());
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: created.id, workspace_id: workspace.id,
        status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
      });

      expect(() => services.adapterConfigService.delete(created.id)).not.toThrow();
      expect(services.adapterWorkspaceStatusRepo.get(created.id, workspace.id)).toBeNull();
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
