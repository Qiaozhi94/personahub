import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, AdapterStatus } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Fake Adapter",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
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

  it("second Run queues while first is running", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

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

  it("second Run starts after first completes", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

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

    await wait(800);

    const run1Final = services.runRepo.getById(run1.id);
    const run2Final = services.runRepo.getById(run2.id);

    expect(run1Final!.status).toBe(RunStatus.Completed);
    expect(run2Final!.status).toBe(RunStatus.Completed);

    await wait(400);
  });

  it("workspace lock prevents concurrent execution", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

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
