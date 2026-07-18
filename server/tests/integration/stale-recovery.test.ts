import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { IssueStatus, RunStatus, FailureReason, AdapterStatus } from "@personahub/shared/types";

function setupTestRun(services: TestServices, tempDir: string, status: RunStatus = RunStatus.Running) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Test Adapter",
    role: "implementation",
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  const run = services.runRepo.create({
    issue_id: issue.id,
    thread_id: issue.primary_thread!.id,
    workspace_id: issue.workspace_id,
    adapter_config_id: adapter.id,
    instructions: "test",
    status,
  });
  return { project, issue, adapter, run };
}

describe("StaleRecoveryService", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("marks stale running Runs as interrupted", async () => {
    const { run } = setupTestRun(services, tempDir, RunStatus.Running);

    await services.staleRecoveryService.runAll();

    const recovered = services.runRepo.getById(run.id);
    expect(recovered!.status).toBe(RunStatus.Interrupted);
    expect(recovered!.failure_reason).toBe(FailureReason.ServerRestarted);
  });

  it("releases workspace lock after stale recovery", async () => {
    const { issue, run } = setupTestRun(services, tempDir, RunStatus.Running);
    services.workspaceRepo.acquireLock(issue.workspace_id, run.id);

    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(true);
    await services.staleRecoveryService.runAll();
    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(false);
  });

  it("does not touch queued Runs", async () => {
    const { run } = setupTestRun(services, tempDir, RunStatus.Queued);

    await services.staleRecoveryService.runAll();

    const untouched = services.runRepo.getById(run.id);
    expect(untouched!.status).toBe(RunStatus.Queued);
  });

  it("cleans up stale locks pointing to terminal runs", async () => {
    const { issue, run } = setupTestRun(services, tempDir, RunStatus.Completed);
    services.workspaceRepo.acquireLock(issue.workspace_id, run.id);

    await services.staleRecoveryService.runAll();

    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(false);
  });
});
