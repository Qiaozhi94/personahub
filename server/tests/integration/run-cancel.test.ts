import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, ThreadEventType, ActorType, AdapterStatus } from "@personahub/shared/types";

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

describe("Run Cancel", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("cancels a queued Run", () => {
    const { run } = setupTestRun(services, tempDir, RunStatus.Queued);

    const cancelled = services.runService.cancelQueued(run.id, "user_cancelled");
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe(RunStatus.Cancelled);
  });

  it("returns current run without change for terminal status", () => {
    const { run } = setupTestRun(services, tempDir, RunStatus.Completed);

    const result = services.runService.cancelQueued(run.id, "user_cancelled");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(RunStatus.Completed);
  });

  it("returns null for running Run (handled by runner, not cancelQueued)", () => {
    const { run } = setupTestRun(services, tempDir, RunStatus.Running);

    const result = services.runService.cancelQueued(run.id, "user_cancelled");
    expect(result).toBeNull();
  });
});

describe("Event Replay - after_event_id cursor", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("returns only events after the cursor", () => {
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    const threadId = issue.primary_thread!.id;

    const e1 = services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunQueued, ActorType.System, null, { seq: 1 },
    );
    const e2 = services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunStarted, ActorType.System, null, { seq: 2 },
    );
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunCompleted, ActorType.System, null, { seq: 3 },
    );

    const afterCursor = services.threadEventService.listByThread(threadId, e1.id);
    expect(afterCursor.length).toBe(2);
    expect(afterCursor[0]!.id).toBe(e2.id);
  });

  it("returns events ordered by event_sequence", () => {
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    const threadId = issue.primary_thread!.id;

    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunQueued, ActorType.System, null, { n: 1 },
    );
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunStarted, ActorType.System, null, { n: 2 },
    );
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunCompleted, ActorType.System, null, { n: 3 },
    );

    const events = services.threadEventService.listByThread(threadId);
    const sequences = events.map(e => e.event_sequence);
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sequences).toEqual(sorted);
  });
});
