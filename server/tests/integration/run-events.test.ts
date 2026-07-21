import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, ThreadEventType, AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import { MAX_OUTPUT_BYTES } from "../../src/runtime/types.js";

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
    capability_tags: [AgentCapability.Implementation],
    default_model: null,
    status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("Run Event Persistence Integration", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("persists run.queued event when Run is created", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const queuedEvent = events.find(e => e.type === ThreadEventType.RunQueued);
    expect(queuedEvent).toBeDefined();
    expect(queuedEvent!.payload_json.run_id).toBeDefined();
  });

  it("persists run.started event when Run transitions to running", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const startedEvent = events.find(e => e.type === ThreadEventType.RunStarted);
    expect(startedEvent).toBeDefined();
  });

  it("persists run.completed event with exit_code", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const completedEvent = events.find(e => e.type === ThreadEventType.RunCompleted);
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.payload_json.exit_code).toBe(0);
  });

  it("persists run.failed event with failure_reason and error_message", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    services.adapterRegistry.register(new FakeAgentAdapter({
      exitCode: 1,
      errorMessage: "Something went wrong",
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const failedEvent = events.find(e => e.type === ThreadEventType.RunFailed);
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.payload_json.failure_reason).toBe("adapter_exit_nonzero");
    expect(failedEvent!.payload_json.error_message).toBe("Something went wrong");
  });

  it("writes run.output_truncated when output exceeds 1 MiB", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "test" });
    services.workspaceLockService.acquire(issue.workspace_id, run.id);
    services.runService.transitionToRunning(run.id);

    const chunkSize = 8 * 1024;
    const chunkCount = 200;
    const bigChunk = "x".repeat(chunkSize);
    const chunks: string[] = [];
    for (let i = 0; i < chunkCount; i++) {
      chunks.push(bigChunk);
    }

    const truncAdapter = new FakeAgentAdapter({
      outputChunks: chunks,
      outputDelayMs: 1,
      delayMs: 10000,
    });

    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;
    await services.agentRunner.startRun({
      run: services.runRepo.getById(run.id)!,
      adapter: truncAdapter,
      workspace,
      context: "test",
    });

    await wait(5000);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const outputEvents = events.filter(e => e.type === ThreadEventType.RunOutput);
    expect(outputEvents.length).toBeGreaterThan(0);

    const truncatedEvent = events.find(e => e.type === ThreadEventType.RunOutputTruncated);
    expect(truncatedEvent).toBeDefined();
    expect(truncatedEvent!.payload_json.max_bytes).toBe(MAX_OUTPUT_BYTES);
  }, 15000);
});
