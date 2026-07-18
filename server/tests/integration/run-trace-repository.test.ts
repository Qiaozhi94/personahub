import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { CommandTraceCapability, BaselineStatus, RunStatus, AdapterStatus } from "@personahub/shared/types";

function setupRun(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Fake",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  const run = services.runRepo.create({
    issue_id: issue.id,
    thread_id: issue.primary_thread_id!,
    workspace_id: issue.workspace_id,
    adapter_config_id: adapter.id,
    instructions: "test",
    status: RunStatus.Queued,
  });
  return { project, issue, adapter, run };
}

describe("RunTraceRepository (T010)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("createPending persists command trace capability", () => {
    const { run } = setupRun(services, tempDir);
    const now = new Date().toISOString();
    const created = services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);

    expect(created.run_id).toBe(run.id);
    expect(created.command_trace_capability).toBe(CommandTraceCapability.Supported);
    expect(created.baseline_status).toBe(BaselineStatus.Pending);
    expect(created.finalized_at).toBeNull();
  });

  it("createPending overwrites pending baseline on re-prepare", () => {
    const { run } = setupRun(services, tempDir);
    const now = new Date().toISOString();

    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);
    services.runTraceRepo.saveBaselineFailure(run.id, "timeout", now);

    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Unsupported, new Date().toISOString());
    const state = services.runTraceRepo.get(run.id);
    expect(state!.baseline_status).toBe(BaselineStatus.Pending);
    expect(state!.command_trace_capability).toBe(CommandTraceCapability.Unsupported);
  });

  it("saveBaseline captures baseline with scanner type", () => {
    const { run } = setupRun(services, tempDir);
    const now = new Date().toISOString();

    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);
    services.runTraceRepo.saveBaseline(run.id, "git", '{"head":"abc"}', now);

    const state = services.runTraceRepo.get(run.id);
    expect(state!.baseline_status).toBe(BaselineStatus.Captured);
    expect(state!.scanner_type).toBe("git");
    expect(state!.baseline_json).toBe('{"head":"abc"}');
  });

  it("saveBaselineFailure records reason code", () => {
    const { run } = setupRun(services, tempDir);
    const now = new Date().toISOString();

    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);
    services.runTraceRepo.saveBaselineFailure(run.id, "permission_denied", now);

    const state = services.runTraceRepo.get(run.id);
    expect(state!.baseline_status).toBe(BaselineStatus.Failed);
    expect(state!.baseline_error_code).toBe("permission_denied");
  });

  it("listTerminalUnfinalized returns only terminal started unfinalized runs", () => {
    const { run } = setupRun(services, tempDir);
    const now = new Date().toISOString();

    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0 });

    const unfinalized = services.runTraceRepo.listTerminalUnfinalized();
    expect(unfinalized).toHaveLength(1);
    expect(unfinalized[0].run_id).toBe(run.id);
  });

  it("markFinalized uses CAS on finalized_at IS NULL", () => {
    const { run } = setupRun(services, tempDir);
    const now = new Date().toISOString();

    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, now);

    const first = services.runTraceRepo.markFinalized(run.id, now);
    expect(first).toBe(true);

    const second = services.runTraceRepo.markFinalized(run.id, new Date().toISOString());
    expect(second).toBe(false);

    const state = services.runTraceRepo.get(run.id);
    expect(state!.finalized_at).toBe(now);
  });

  it("get returns null for nonexistent run", () => {
    expect(services.runTraceRepo.get("nonexistent")).toBeNull();
  });
});
