import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  RunStatus, FailureReason, IssueStatus, AdapterStatus,
  ThreadEventType, ActorType,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

function setupFullChain(services: TestServices, tempDir: string) {
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
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe("Acceptance Checklist (T056)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("AC-001: user can create, update, delete adapter config with validation", () => {
    const project = services.projectService.create("Test", "desc");
    const adapter = services.adapterConfigService.create(project.id, {
      name: "Codex", cli_provider: "codex", command: "codex",
    });
    expect(adapter.status).toBe(AdapterStatus.Available);

    const updated = services.adapterConfigService.update(adapter.id, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");

    services.adapterConfigService.delete(adapter.id);
    expect(() => services.adapterConfigService.getById(adapter.id)).toThrow();
  });

  it("AC-002: user can input instructions in Thread, system creates Run", async () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({ delayMs: 50 }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    expect(run.id).toMatch(/^run_/);
    expect(run.issue_id).toBe(issue.id);
    expect(run.thread_id).toBe(issue.primary_thread_id);
    await wait(200);
  });

  it("AC-003: Run status transitions queued -> running -> completed", async () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({ delayMs: 50 }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.started_at).not.toBeNull();
    expect(finalRun!.completed_at).not.toBeNull();
    expect(finalRun!.exit_code).toBe(0);
  });

  it("AC-004: run.queued/started/output/completed events persisted as ThreadEvent", async () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({ delayMs: 50 }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const types = events.map(e => e.type);
    expect(types).toContain(ThreadEventType.RunQueued);
    expect(types).toContain(ThreadEventType.RunStarted);
    expect(types).toContain(ThreadEventType.RunOutput);
    expect(types).toContain(ThreadEventType.RunCompleted);
  });

  it("AC-005: same workspace only one Run at a time, others queue", async () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({ delayMs: 200 }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "first");
    await wait(50);
    await services.runDispatchService.dispatch(issue.id, adapter.id, "second");
    await wait(50);

    const runs = services.runRepo.listByIssue(issue.id);
    const runningCount = runs.filter(r => r.status === RunStatus.Running).length;
    const queuedCount = runs.filter(r => r.status === RunStatus.Queued).length;
    expect(runningCount).toBeLessThanOrEqual(1);
    expect(queuedCount + runningCount).toBeGreaterThanOrEqual(2);

    await wait(500);
  });

  it("AC-006: stale running Run recovered as interrupted, lock released", () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id,
      workspace_id: issue.workspace_id, adapter_config_id: adapter.id,
      instructions: "test", status: RunStatus.Running,
    });
    services.workspaceRepo.acquireLock(issue.workspace_id, run.id);

    services.staleRecoveryService.runAll();

    expect(services.runRepo.getById(run.id)!.status).toBe(RunStatus.Interrupted);
    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(false);
  });

  it("AC-007: user can cancel queued Run", () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id,
      workspace_id: issue.workspace_id, adapter_config_id: adapter.id,
      instructions: "test", status: RunStatus.Queued,
    });

    const cancelled = services.runService.cancelQueued(run.id, "user_cancelled");
    expect(cancelled!.status).toBe(RunStatus.Cancelled);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    expect(events.some(e => e.type === ThreadEventType.RunCancelled)).toBe(true);
  });

  it("AC-008: Inspector can display agent status and run logs", async () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      outputChunks: ["Hello world\n", "Done!\n"],
      delayMs: 50,
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.exit_code).toBe(0);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const outputEvents = events.filter(
      e => e.type === ThreadEventType.RunOutput && e.payload_json.run_id === run.id,
    );
    expect(outputEvents.length).toBeGreaterThan(0);
    for (const e of outputEvents) {
      expect(e.payload_json.chunk).toBeDefined();
      expect(e.payload_json.stream).toBeDefined();
      expect(e.payload_json.run_id).toBe(run.id);
    }
  });

  it("AC-009: git push triggers escalation, Issue blocked, capability boundary expressed", async () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      failureReason: FailureReason.PreExecutionApprovalRejected,
      errorMessage: "git push origin main",
      delayMs: 50,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
    await wait(200);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    expect(events.some(e => e.type === ThreadEventType.EscalationTriggered)).toBe(true);
    expect(events.some(e => e.type === ThreadEventType.IssueBlocked)).toBe(true);

    const escalation = events.find(e => e.type === ThreadEventType.EscalationTriggered);
    expect(escalation!.payload_json.pre_execution_blocked).toBe(true);

    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
    await wait(300);
  });

  it("AC-010: events written to SQLite before broadcast, cursor replay works", () => {
    const { issue } = setupFullChain(services, tempDir);
    const threadId = issue.primary_thread!.id;

    const e1 = services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunQueued, ActorType.System, null, { n: 1 },
    );
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunStarted, ActorType.System, null, { n: 2 },
    );

    const afterCursor = services.threadEventService.listByThread(threadId, e1.id);
    expect(afterCursor.length).toBeGreaterThanOrEqual(1);
    expect(afterCursor[0]!.payload_json.n).toBe(2);
  });

  it("AC-011: Blocked Issue queued Runs cancelled with reason", () => {
    const { issue, adapter } = setupFullChain(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id,
      workspace_id: issue.workspace_id, adapter_config_id: adapter.id,
      instructions: "test", status: RunStatus.Queued,
    });

    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Blocked,
      updatedAt: new Date().toISOString(),
    });

    services.runService.startNextQueuedRun(issue.workspace_id);

    expect(services.runRepo.getById(run.id)!.status).toBe(RunStatus.Cancelled);
    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const cancelEvent = events.find(
      e => e.type === ThreadEventType.RunCancelled && e.payload_json.run_id === run.id,
    );
    expect(cancelEvent).toBeDefined();
    expect(cancelEvent!.payload_json.reason).toBe("issue_blocked_before_start");
  });

  it("AC-012: push credentials not provisioned when push_credentials_enabled=false", () => {
    const { issue } = setupFullChain(services, tempDir);
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;
    expect(workspace.push_credentials_enabled).toBe(false);
  });
});
