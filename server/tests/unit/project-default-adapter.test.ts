import { describe, it, expect } from "vitest";
import { createTestDb, createTestServices, disposeTestServices, createTempDir } from "../helpers.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";

// T021: ProjectRepository default-adapter primitives (set/clear/cross-project/
// unavailable), plus the two cross-repo orchestration behaviors design
// requires: auto-defaulting the first available adapter, and guarding
// deletion of the current default (both exercised via the real service stack
// since they're orchestration, not a single repository's own invariant).

function setupAdapter(
  agentConfigRepo: AgentConfigRepository,
  projectId: string,
  overrides: { status?: AdapterStatus; name?: string } = {},
) {
  return agentConfigRepo.create({
    project_id: projectId,
    name: overrides.name ?? "Adapter",
    role: "implementation",
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: null,
    status: overrides.status ?? AdapterStatus.Available,
  });
}

describe("ProjectRepository default adapter (T021)", () => {
  it("setDefaultAdapter sets default_adapter_config_id when the adapter is available and same-project", () => {
    const db = createTestDb();
    const projectRepo = new ProjectRepository(db);
    const agentConfigRepo = new AgentConfigRepository(db);
    const project = projectRepo.create("P1", null);
    const adapter = setupAdapter(agentConfigRepo, project.id);

    const result = projectRepo.setDefaultAdapter(project.id, adapter.id);

    expect(result.success).toBe(true);
    expect(projectRepo.getById(project.id)?.default_adapter_config_id).toBe(adapter.id);
  });

  it("clearDefaultAdapter sets default_adapter_config_id back to null", () => {
    const db = createTestDb();
    const projectRepo = new ProjectRepository(db);
    const agentConfigRepo = new AgentConfigRepository(db);
    const project = projectRepo.create("P2", null);
    const adapter = setupAdapter(agentConfigRepo, project.id);
    projectRepo.setDefaultAdapter(project.id, adapter.id);

    projectRepo.clearDefaultAdapter(project.id);

    expect(projectRepo.getById(project.id)?.default_adapter_config_id).toBeNull();
  });

  it("rejects setting a default from a different Project (cross-project)", () => {
    const db = createTestDb();
    const projectRepo = new ProjectRepository(db);
    const agentConfigRepo = new AgentConfigRepository(db);
    const projectA = projectRepo.create("A", null);
    const projectB = projectRepo.create("B", null);
    const adapterOfB = setupAdapter(agentConfigRepo, projectB.id);

    const result = projectRepo.setDefaultAdapter(projectA.id, adapterOfB.id);

    expect(result).toEqual({ success: false, reason: "cross_project" });
    expect(projectRepo.getById(projectA.id)?.default_adapter_config_id).toBeNull();
  });

  it("rejects setting an unavailable adapter as default", () => {
    const db = createTestDb();
    const projectRepo = new ProjectRepository(db);
    const agentConfigRepo = new AgentConfigRepository(db);
    const project = projectRepo.create("P3", null);
    const adapter = setupAdapter(agentConfigRepo, project.id, { status: AdapterStatus.Unavailable });

    const result = projectRepo.setDefaultAdapter(project.id, adapter.id);

    expect(result).toEqual({ success: false, reason: "unavailable" });
    expect(projectRepo.getById(project.id)?.default_adapter_config_id).toBeNull();
  });

  it("rejects setting a nonexistent adapter id as default", () => {
    const db = createTestDb();
    const projectRepo = new ProjectRepository(db);
    const project = projectRepo.create("P4", null);

    const result = projectRepo.setDefaultAdapter(project.id, "adp_does_not_exist");

    expect(result).toEqual({ success: false, reason: "adapter_not_found" });
  });

  it("clearDefaultAdapter on a Project with no default is a harmless no-op", () => {
    const db = createTestDb();
    const projectRepo = new ProjectRepository(db);
    const project = projectRepo.create("P5", null);

    expect(() => projectRepo.clearDefaultAdapter(project.id)).not.toThrow();
    expect(projectRepo.getById(project.id)?.default_adapter_config_id).toBeNull();
  });
});

describe("First available adapter auto-becomes default (T021/T022, service orchestration)", () => {
  it("creating the first available adapter for a Project with no default sets it as default", () => {
    const services = createTestServices();
    try {
      const project = services.projectService.create("Auto Default");
      const adapter = services.adapterConfigService.create(project.id, {
        name: "First", cli_provider: "codex", command: "codex", args: [], default_model: null,
      });

      expect(adapter.is_default).toBe(true);
      expect(services.projectRepo.getById(project.id)?.default_adapter_config_id).toBe(adapter.id);
    } finally {
      disposeTestServices(services);
    }
  });

  it("creating a second available adapter does not change an already-set default", () => {
    const services = createTestServices();
    try {
      const project = services.projectService.create("Second Adapter");
      const first = services.adapterConfigService.create(project.id, {
        name: "First", cli_provider: "codex", command: "codex", args: [], default_model: null,
      });
      const second = services.adapterConfigService.create(project.id, {
        name: "Second", cli_provider: "codex", command: "codex", args: [], default_model: null,
      });

      expect(first.is_default).toBe(true);
      expect(second.is_default).toBe(false);
      expect(services.projectRepo.getById(project.id)?.default_adapter_config_id).toBe(first.id);
    } finally {
      disposeTestServices(services);
    }
  });

  it("creating an unavailable adapter first does not auto-default it", () => {
    const services = createTestServices();
    try {
      const project = services.projectService.create("Unavailable First");
      const badAdapter = services.adapterConfigService.create(project.id, {
        name: "Bad", cli_provider: "codex", command: "definitely-not-a-real-binary-xyz", args: [], default_model: null,
      });

      expect(badAdapter.is_default).toBe(false);
      expect(services.projectRepo.getById(project.id)?.default_adapter_config_id).toBeNull();
    } finally {
      disposeTestServices(services);
    }
  });
});

describe("Delete guard for the current default adapter (T021/T022, service orchestration)", () => {
  it("blocks deleting the current default when another adapter still exists", () => {
    const services = createTestServices();
    try {
      const project = services.projectService.create("Delete Guard");
      const first = services.adapterConfigService.create(project.id, {
        name: "First", cli_provider: "codex", command: "codex", args: [], default_model: null,
      });
      services.adapterConfigService.create(project.id, {
        name: "Second", cli_provider: "codex", command: "codex", args: [], default_model: null,
      });

      let thrown: unknown;
      try {
        services.adapterConfigService.delete(first.id);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe(ErrorCode.ADAPTER_IN_USE);
      expect(services.projectRepo.getById(project.id)?.default_adapter_config_id).toBe(first.id);
    } finally {
      disposeTestServices(services);
    }
  });

  it("allows deleting the default when it is the Project's only adapter, and clears the default", () => {
    const services = createTestServices();
    try {
      const project = services.projectService.create("Solo Delete");
      const only = services.adapterConfigService.create(project.id, {
        name: "Only", cli_provider: "codex", command: "codex", args: [], default_model: null,
      });

      expect(() => services.adapterConfigService.delete(only.id)).not.toThrow();
      expect(services.projectRepo.getById(project.id)?.default_adapter_config_id).toBeNull();
    } finally {
      disposeTestServices(services);
    }
  });
});
