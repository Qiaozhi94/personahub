import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, IssueStatus, FailureReason, AdapterStatus } from "@personahub/shared/types";

function setupTestRun(services: TestServices, tempDir: string, status: RunStatus = RunStatus.Queued) {
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

describe("Issue Blocked prevents queued Run", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("cancels queued Run when Issue is Blocked", () => {
    const { issue, run } = setupTestRun(services, tempDir, RunStatus.Queued);

    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Blocked,
      updatedAt: new Date().toISOString(),
    });

    const result = services.runService.startNextQueuedRun(issue.workspace_id);
    expect(result).toBeNull();

    const cancelledRun = services.runRepo.getById(run.id);
    expect(cancelledRun!.status).toBe(RunStatus.Cancelled);
  });

  it("throws ISSUE_BLOCKED when creating Run on blocked Issue", () => {
    const { issue } = setupTestRun(services, tempDir, RunStatus.Queued);

    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Blocked,
      updatedAt: new Date().toISOString(),
    });

    expect(() =>
      services.runService.create(issue.id, "adp_test", "test instructions"),
    ).toThrow(/blocked/i);
  });

  it("startNextQueuedRun skips blocked Issue and returns null", () => {
    const { issue } = setupTestRun(services, tempDir, RunStatus.Queued);

    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Blocked,
      updatedAt: new Date().toISOString(),
    });

    const result = services.runService.startNextQueuedRun(issue.workspace_id);
    expect(result).toBeNull();
  });
});
