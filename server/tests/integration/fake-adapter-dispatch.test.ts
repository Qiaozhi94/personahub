import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, ThreadEventType, AdapterStatus } from "@personahub/shared/types";
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

describe("Fake Adapter Dispatch Integration", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("dispatches a Run with FakeAgentAdapter and completes with exit 0", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    const run = await services.runDispatchService.dispatch(
      issue.id, adapter.id, "test instructions",
    );

    expect(run.status).toBe(RunStatus.Queued);
    await wait(300);

    const completedRun = services.runRepo.getById(run.id);
    expect(completedRun!.status).toBe(RunStatus.Completed);
    expect(completedRun!.exit_code).toBe(0);
  });

  it("persists run.queued, run.started, run.output, and run.completed events", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    const run = await services.runDispatchService.dispatch(
      issue.id, adapter.id, "test instructions",
    );
    await wait(300);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const types = events.map(e => e.type);

    expect(types).toContain(ThreadEventType.RunQueued);
    expect(types).toContain(ThreadEventType.RunStarted);
    expect(types).toContain(ThreadEventType.RunOutput);
    expect(types).toContain(ThreadEventType.RunCompleted);

    const order = [
      types.indexOf(ThreadEventType.RunQueued),
      types.indexOf(ThreadEventType.RunStarted),
      types.indexOf(ThreadEventType.RunOutput),
      types.indexOf(ThreadEventType.RunCompleted),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("marks Run as failed when adapter exits non-zero", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    services.adapterRegistry.register(new FakeAgentAdapter({
      exitCode: 1,
      errorMessage: "Command failed",
      outputChunks: ["error output\n"],
    }));

    const run = await services.runDispatchService.dispatch(
      issue.id, adapter.id, "test instructions",
    );
    await wait(300);

    const failedRun = services.runRepo.getById(run.id);
    expect(failedRun!.status).toBe(RunStatus.Failed);
    expect(failedRun!.exit_code).toBe(1);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const types = events.map(e => e.type);
    expect(types).toContain(ThreadEventType.RunFailed);

    await wait(200);
  });

  it("writes run.output events with stream and sequence", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    services.adapterRegistry.register(new FakeAgentAdapter({
      outputChunks: ["chunk1\n", "chunk2\n"],
      outputDelayMs: 10,
      delayMs: 100,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const outputEvents = events.filter(e => e.type === ThreadEventType.RunOutput);

    expect(outputEvents.length).toBeGreaterThanOrEqual(2);
    expect(outputEvents[0]!.payload_json.stream).toBe("stdout");
    expect(outputEvents[0]!.payload_json.sequence).toBe(1);
    expect(outputEvents[1]!.payload_json.sequence).toBe(2);
  });
});
