import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { effectiveAdapterStatus, listAvailableByCapabilityForWorkspace } from "../../src/services/adapter-availability.js";

// Pure-function coverage for the "exception override" merge: every
// availability check (resolver, validator selector) must route through
// these two functions rather than comparing agent_configs.status directly.

describe("effectiveAdapterStatus", () => {
  it("falls back to the record's global status when there is no override", () => {
    expect(effectiveAdapterStatus({ status: AdapterStatus.Unknown }, null)).toBe(AdapterStatus.Unknown);
  });

  it("an override, when present, wins over the global status regardless of direction", () => {
    const override = { adapter_config_id: "adp_1", workspace_id: "wsp_1", status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null, updated_at: "2026-01-01T00:00:00Z" };
    expect(effectiveAdapterStatus({ status: AdapterStatus.Unknown }, override)).toBe(AdapterStatus.Available);
    expect(effectiveAdapterStatus({ status: AdapterStatus.Available }, { ...override, status: AdapterStatus.Unavailable })).toBe(AdapterStatus.Unavailable);
  });
});

describe("listAvailableByCapabilityForWorkspace", () => {
  let services: TestServices;
  let projectId: string;
  let workspaceId: string;

  beforeEach(() => {
    services = createTestServices();
    const project = services.projectService.create("Test");
    projectId = project.id;
    workspaceId = services.workspaceService.bind(project.id, createTempDir()).id;
  });
  afterEach(() => disposeTestServices(services));

  function makeAdapter(status: AdapterStatus, capabilityTags: AgentCapability[] = [AgentCapability.Validator]) {
    return services.agentConfigRepo.create({
      project_id: projectId, name: `Adapter-${status}`, role: "validator", cli_provider: "codex",
      command: "codex", args: [], capability_tags: capabilityTags, default_model: null, status,
    });
  }

  it("excludes an adapter without the requested capability even if globally Available", () => {
    const adapter = makeAdapter(AdapterStatus.Available, [AgentCapability.Implementation]);
    const candidates = services.agentConfigRepo.listByProject(projectId);

    const result = listAvailableByCapabilityForWorkspace(candidates, [], AgentCapability.Validator);

    expect(result.map((r) => r.id)).not.toContain(adapter.id);
  });

  it("excludes a globally Unknown adapter with no override for this workspace", () => {
    const adapter = makeAdapter(AdapterStatus.Unknown);
    const candidates = services.agentConfigRepo.listByProject(projectId);

    const result = listAvailableByCapabilityForWorkspace(candidates, [], AgentCapability.Validator);

    expect(result.map((r) => r.id)).not.toContain(adapter.id);
  });

  it("includes a globally Unknown adapter that has an Available override for this workspace", () => {
    const adapter = makeAdapter(AdapterStatus.Unknown);
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapter.id, workspace_id: workspaceId,
      status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
    });
    const candidates = services.agentConfigRepo.listByProject(projectId);
    const overrides = services.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId);

    const result = listAvailableByCapabilityForWorkspace(candidates, overrides, AgentCapability.Validator);

    expect(result.map((r) => r.id)).toContain(adapter.id);
  });

  it("excludes a globally Available adapter that has an Unavailable override for this workspace", () => {
    const adapter = makeAdapter(AdapterStatus.Available);
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapter.id, workspace_id: workspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: "isolated workspace can't reach OAuth",
    });
    const candidates = services.agentConfigRepo.listByProject(projectId);
    const overrides = services.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId);

    const result = listAvailableByCapabilityForWorkspace(candidates, overrides, AgentCapability.Validator);

    expect(result.map((r) => r.id)).not.toContain(adapter.id);
  });

  it("an override scoped to a different workspace does not affect this workspace's result", () => {
    const otherWorkspaceId = services.workspaceService.bind(projectId, createTempDir()).id;
    const adapter = makeAdapter(AdapterStatus.Available);
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: adapter.id, workspace_id: otherWorkspaceId,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: null,
    });
    const candidates = services.agentConfigRepo.listByProject(projectId);
    const overrides = services.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId);

    const result = listAvailableByCapabilityForWorkspace(candidates, overrides, AgentCapability.Validator);

    expect(result.map((r) => r.id)).toContain(adapter.id);
  });
});
