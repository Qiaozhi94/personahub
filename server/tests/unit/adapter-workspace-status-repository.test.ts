import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";

// Schema v7 / adapter-availability.ts "exception override" design: this
// table holds only rows that DIFFER from the Project-global agent_configs
// .status baseline. Absence of a row means "fall back to the global status".

describe("AdapterWorkspaceStatusRepository", () => {
  let services: TestServices;
  let adapterId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeEach(() => {
    services = createTestServices();
    const project = services.projectService.create("Test");
    adapterId = services.agentConfigRepo.create({
      project_id: project.id, name: "Adapter", role: "implementation", cli_provider: "codex",
      command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Unknown,
    }).id;
    workspaceId = services.workspaceService.bind(project.id, createTempDir()).id;
    otherWorkspaceId = services.workspaceService.bind(project.id, createTempDir()).id;
  });
  afterEach(() => disposeTestServices(services));

  it("get() returns null when no override row exists for the pair", () => {
    expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)).toBeNull();
  });

  it("upsert() then get() round-trips the written fields", () => {
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Available, last_checked_at: "2026-01-01T00:00:00Z",
      auth_status_message: null,
    });

    const row = services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId);
    expect(row?.status).toBe(AdapterStatus.Available);
    expect(row?.last_checked_at).toBe("2026-01-01T00:00:00Z");
    expect(row?.auth_status_message).toBeNull();
  });

  it("upsert() on an existing pair updates in place rather than duplicating", () => {
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
    });
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: "auth expired",
    });

    const row = services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId);
    expect(row?.status).toBe(AdapterStatus.Unavailable);
    expect(row?.auth_status_message).toBe("auth expired");
    expect(services.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId)).toHaveLength(1);
  });

  it("a write for one workspace does not appear under a sibling workspace of the same adapter", () => {
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: null,
    });

    expect(services.adapterWorkspaceStatusRepo.get(adapterId, otherWorkspaceId)).toBeNull();
  });

  it("listForWorkspace() returns only rows for that workspace, across multiple adapters", () => {
    const secondAdapterId = services.agentConfigRepo.create({
      project_id: services.agentConfigRepo.getById(adapterId)!.project_id,
      name: "Second", role: "implementation", cli_provider: "codex",
      command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Unknown,
    }).id;
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
    });
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: secondAdapterId, workspace_id: workspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: null,
    });
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: otherWorkspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: null,
    });

    const rows = services.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId);
    expect(rows.map((r) => r.adapter_config_id).sort()).toEqual([adapterId, secondAdapterId].sort());
  });

  it("deleteForAdapter() removes all override rows for that adapter across every workspace", () => {
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
    });
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: otherWorkspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: null,
    });

    services.adapterWorkspaceStatusRepo.deleteForAdapter(adapterId);

    expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)).toBeNull();
    expect(services.adapterWorkspaceStatusRepo.get(adapterId, otherWorkspaceId)).toBeNull();
  });

  it("deleteForAdapter() lets AdapterConfigService.delete() succeed despite the FK (no ON DELETE CASCADE)", () => {
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapterId, workspace_id: workspaceId,
      status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
    });

    expect(() => services.adapterConfigService.delete(adapterId)).not.toThrow();
    expect(services.adapterWorkspaceStatusRepo.get(adapterId, workspaceId)).toBeNull();
  });
});
