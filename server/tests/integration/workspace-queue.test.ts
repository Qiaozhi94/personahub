import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, AdapterStatus, IssueStatus, RunRole, AgentCapability } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  return { project, issue };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("Same Workspace Serial Execution", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

function createImplAdapter(services: TestServices, projectId: string) {
  return services.agentConfigRepo.create({
    project_id: projectId, name: "Fake", role: "implementation",
    cli_provider: "fake", command: "fake", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: null, status: AdapterStatus.Available,
  });
}

function createValAdapter(services: TestServices, projectId: string) {
  return services.agentConfigRepo.create({
    project_id: projectId, name: "Val", role: "validator",
    cli_provider: "fake", command: "fake", args: [], capability_tags: [AgentCapability.Validator],
    default_model: null, status: AdapterStatus.Available,
  });
}

  it("second Run queues while first is running", async () => {
    const { issue, project } = setupIssue(services, tempDir);
    const adapter = createImplAdapter(services, project.id);

    services.adapterRegistry.register(new FakeAgentAdapter({
      outputDelayMs: 10,
      delayMs: 200,
    }));

    const run1 = await services.runDispatchService.dispatch(issue.id, adapter.id, "first");
    await wait(50);

    const run2 = await services.runDispatchService.dispatch(issue.id, adapter.id, "second");
    await wait(10);

    const run1State = services.runRepo.getById(run1.id);
    const run2State = services.runRepo.getById(run2.id);

    expect(run1State!.status).toBe(RunStatus.Running);
    expect(run2State!.status).toBe(RunStatus.Queued);
  });

  it("second Run is cancelled when workflow hook transitions issue after first completes", async () => {
    const { issue, project } = setupIssue(services, tempDir);
    const adapter = createImplAdapter(services, project.id);
    // Register a validator adapter so the workflow hook can create a validator Run
    // instead of blocking the issue
    createValAdapter(services, project.id);

    services.adapterRegistry.register(new FakeAgentAdapter({
      outputDelayMs: 10,
      delayMs: 300,
    }));

    const run1 = await services.runDispatchService.dispatch(issue.id, adapter.id, "first");
    await wait(50);

    const run2 = await services.runDispatchService.dispatch(issue.id, adapter.id, "second");
    await wait(50);

    expect(services.runRepo.getById(run1.id)!.status).toBe(RunStatus.Running);
    expect(services.runRepo.getById(run2.id)!.status).toBe(RunStatus.Queued);

    await wait(2500);

    const run1Final = services.runRepo.getById(run1.id);
    const run2Final = services.runRepo.getById(run2.id);

    // run1 completes
    expect(run1Final!.status).toBe(RunStatus.Completed);
    // run2 is an implementation run — ineligible when issue is Validating → cancelled
    expect(run2Final!.status).toBe(RunStatus.Cancelled);

    // Validator run was created, ran, but had no final message → result_unparsable
    const issueAfter = services.issueRepo.getById(issue.id)!;
    expect(issueAfter.blocked_reason_code).toBe("result_unparsable");

    await wait(400);
  });

  it("workspace lock prevents concurrent execution", async () => {
    const { issue, project } = setupIssue(services, tempDir);
    const adapter = createImplAdapter(services, project.id);

    services.adapterRegistry.register(new FakeAgentAdapter({
      delayMs: 200,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "first");
    await wait(10);

    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(true);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "second");
    await wait(10);

    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(true);
  });
});
