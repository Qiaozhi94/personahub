import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import {
  ThreadEventType,
  RunStatus,
  AdapterStatus,
  TraceSource,
  CommandOutcome,
  EvidenceConfidence,
  type RunTraceSignal,
} from "@personahub/shared/types";

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
    command: "fake", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeStartedSignal(itemId: string, command: string): RunTraceSignal {
  return {
    type: "command_started", adapterItemId: itemId, command, cwd: null,
    startedAt: null, source: TraceSource.AdapterStructured,
  };
}

function makeCompletedSignal(itemId: string, exitCode: number | null, command?: string): RunTraceSignal {
  return {
    type: "command_completed", adapterItemId: itemId, command, cwd: null,
    outcome: exitCode === 0 ? CommandOutcome.Succeeded : exitCode !== null ? CommandOutcome.Failed : CommandOutcome.Unknown,
    exitCode, durationMs: 100, outputSummary: "output", outputTruncated: false,
    source: TraceSource.AdapterStructured,
  };
}

describe("AgentRunner Command Correlation (T037)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("writes command.started and command.completed in order", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeStartedSignal("cmd-1", "npm test"),
        makeCompletedSignal("cmd-1", 0, "npm test"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find(e => e.type === ThreadEventType.CommandStarted);
    const completed = events.find(e => e.type === ThreadEventType.CommandCompleted);

    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(started!.event_sequence).toBeLessThan(completed!.event_sequence);
  });

  it("command.completed evidence_refs include command.started ref", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeStartedSignal("cmd-1", "npm test"),
        makeCompletedSignal("cmd-1", 0, "npm test"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find(e => e.type === ThreadEventType.CommandStarted)!;
    const completed = events.find(e => e.type === ThreadEventType.CommandCompleted)!;

    expect(completed.evidence_refs).toContain(`event:${started.id}`);
    expect(completed.payload_json.command_event_id).toBe(started.id);
  });

  it("writes test.completed for verified npm test command", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeStartedSignal("cmd-1", "npm test"),
        makeCompletedSignal("cmd-1", 0, "npm test"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const testEvent = events.find(e => e.type === ThreadEventType.TestCompleted);
    expect(testEvent).toBeDefined();
    expect(testEvent!.payload_json.test_kind).toBe("test");
    expect(testEvent!.payload_json.result).toBe("passed");
  });

  it("does not write test.completed for non-verification command", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeStartedSignal("cmd-1", "echo hello"),
        makeCompletedSignal("cmd-1", 0, "echo hello"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    expect(events.find(e => e.type === ThreadEventType.TestCompleted)).toBeUndefined();
  });

  it("dedupes duplicate command.started by item id", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeStartedSignal("cmd-1", "npm test"),
        makeStartedSignal("cmd-1", "npm test"),
        makeCompletedSignal("cmd-1", 0, "npm test"),
      ],
      delayMs: 400,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(600);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.filter(e => e.type === ThreadEventType.CommandStarted);
    expect(started).toHaveLength(1);
  });

  it("handles completed-before-started by synthesizing started", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeCompletedSignal("cmd-1", 0, "npm test"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find(e => e.type === ThreadEventType.CommandStarted);
    const completed = events.find(e => e.type === ThreadEventType.CommandCompleted);
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(started!.payload_json.confidence).toBe(EvidenceConfidence.Partial);
  });

  it("redacts command text", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      traceSignals: [
        makeStartedSignal("cmd-1", "npm test --token=secret123"),
        makeCompletedSignal("cmd-1", 0, "npm test --token=secret123"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find(e => e.type === ThreadEventType.CommandStarted)!;
    expect(started.payload_json.command).toContain("[REDACTED]");
    expect(started.payload_json.command).not.toContain("secret123");
  });
});

describe("Adapter without structured trace (T039)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("Run completes normally without trace support", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      supportsStructuredTrace: false,
      traceSignals: [
        makeStartedSignal("cmd-1", "npm test"),
        makeCompletedSignal("cmd-1", 0, "npm test"),
      ],
      delayMs: 300,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    expect(events.find(e => e.type === ThreadEventType.CommandStarted)).toBeUndefined();
    expect(events.find(e => e.type === ThreadEventType.CommandCompleted)).toBeUndefined();
    expect(events.find(e => e.type === ThreadEventType.TestCompleted)).toBeUndefined();
    expect(events.find(e => e.type === ThreadEventType.RunCompleted)).toBeDefined();
  });
});
