import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, IssueStatus, FailureReason, AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";

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
    capability_tags: [AgentCapability.Implementation],
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

  it("rejects creating Run on blocked Issue with RUN_NOT_ALLOWED_FOR_ISSUE_STATUS", () => {
    const { issue, adapter } = setupTestRun(services, tempDir, RunStatus.Queued);

    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Blocked,
      updatedAt: new Date().toISOString(),
    });

    try {
      services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "test instructions" });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS);
    }
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
