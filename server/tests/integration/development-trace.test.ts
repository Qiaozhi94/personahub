import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  RunStatus,
  AdapterStatus,
  ThreadEventType,
  ActorType,
  CommandTraceCapability,
  BaselineStatus,
  FileChangeType,
  TraceSource,
  CommandOutcome,
  EvidenceConfidence,
  type RunTraceSignal,
} from "@personahub/shared/types";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function setupIssueAndRun(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
    command: "fake", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
  });
  const run = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
    adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
  });
  return { project, issue, adapter, run };
}

function makeStarted(itemId: string, cmd: string): RunTraceSignal {
  return { type: "command_started", adapterItemId: itemId, command: cmd, cwd: null, startedAt: null, source: TraceSource.AdapterStructured };
}
function makeCompleted(itemId: string, exit: number, cmd?: string): RunTraceSignal {
  return {
    type: "command_completed", adapterItemId: itemId, command: cmd, cwd: null,
    outcome: exit === 0 ? CommandOutcome.Succeeded : CommandOutcome.Failed,
    exitCode: exit, durationMs: 100, outputSummary: "out", outputTruncated: false,
    source: TraceSource.AdapterStructured,
  };
}

describe("DevelopmentTraceService.prepareRun (T040)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("persists adapter trace capability and baseline before run starts", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    writeFileSync(join(tempDir, "app.ts"), "content");
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;

    services.developmentTraceService.prepareRun({
      run, workspace, traceCapability: CommandTraceCapability.Supported,
    });

    const state = services.runTraceRepo.get(run.id);
    expect(state).not.toBeNull();
    expect(state!.command_trace_capability).toBe(CommandTraceCapability.Supported);
    expect(state!.baseline_status).toBe(BaselineStatus.Captured);
    expect(state!.scanner_type).not.toBeNull();
  });

  it("baseline failure does not prevent Run", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;
    workspace.local_path = "/nonexistent/path/that/does/not/exist";

    services.developmentTraceService.prepareRun({
      run, workspace, traceCapability: CommandTraceCapability.Supported,
    });

    const state = services.runTraceRepo.get(run.id);
    expect(state).not.toBeNull();
    expect(state!.baseline_status).toBe(BaselineStatus.Failed);
  });
});

describe("DevelopmentTraceService.finalizeRun (T042)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("writes file event + handoff + finalized_at in same transaction", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    writeFileSync(join(tempDir, "app.ts"), "original");
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;

    services.developmentTraceService.prepareRun({ run, workspace, traceCapability: CommandTraceCapability.Supported });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });

    writeFileSync(join(tempDir, "app.ts"), "modified");
    writeFileSync(join(tempDir, "new.ts"), "new");
    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: new Date().toISOString(), exit_code: 0 });

    const result = services.developmentTraceService.finalizeRun(run.id);
    expect(result.finalized).toBe(true);
    expect(result.fileEventId).not.toBeNull();
    expect(result.handoffEventId).not.toBeNull();

    const events = services.threadEventService.listByThread(issue.primary_thread_id!);
    const fileEvent = events.find(e => e.type === ThreadEventType.FileChangeSummary);
    const handoffEvent = events.find(e => e.type === ThreadEventType.HandoffCreated);
    expect(fileEvent).toBeDefined();
    expect(handoffEvent).toBeDefined();
    expect(fileEvent!.event_sequence).toBeLessThan(handoffEvent!.event_sequence);

    const state = services.runTraceRepo.get(run.id);
    expect(state!.finalized_at).not.toBeNull();
  });

  it("file event contains totals and preview", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    writeFileSync(join(tempDir, "a.ts"), "a");
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;

    services.developmentTraceService.prepareRun({ run, workspace, traceCapability: CommandTraceCapability.Supported });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    writeFileSync(join(tempDir, "b.ts"), "b");
    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: new Date().toISOString(), exit_code: 0 });

    services.developmentTraceService.finalizeRun(run.id);

    const events = services.threadEventService.listByThread(issue.primary_thread_id!);
    const fileEvent = events.find(e => e.type === ThreadEventType.FileChangeSummary)!;
    expect(fileEvent.payload_json.total_count).toBe(1);
    expect(fileEvent.payload_json.added_count).toBe(1);
    expect(fileEvent.evidence_refs).toContain(`file-change-set:${run.id}`);
  });

  it("handoff contains run status and evidence refs", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    writeFileSync(join(tempDir, "a.ts"), "a");
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;

    services.developmentTraceService.prepareRun({ run, workspace, traceCapability: CommandTraceCapability.Supported });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });

    services.threadEventRepo.create({
      thread_id: issue.primary_thread_id!, type: ThreadEventType.CommandStarted,
      actor_type: ActorType.System, actor_id: null, payload: { run_id: run.id, command: "npm test" }, evidence_refs: [],
    });

    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: new Date().toISOString(), exit_code: 0 });
    services.developmentTraceService.finalizeRun(run.id);

    const events = services.threadEventService.listByThread(issue.primary_thread_id!);
    const handoff = events.find(e => e.type === ThreadEventType.HandoffCreated)!;
    expect(handoff.payload_json.run_status).toBe("completed");
    expect(handoff.payload_json.next_expected_action).toBeDefined();
  });
});

describe("DevelopmentTraceService idempotent finalization (T044)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("duplicate finalization produces no duplicate events", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    writeFileSync(join(tempDir, "a.ts"), "a");
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;

    services.developmentTraceService.prepareRun({ run, workspace, traceCapability: CommandTraceCapability.Supported });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: new Date().toISOString(), exit_code: 0 });

    services.developmentTraceService.finalizeRun(run.id);
    services.developmentTraceService.finalizeRun(run.id);

    const events = services.threadEventService.listByThread(issue.primary_thread_id!);
    const fileEvents = events.filter(e => e.type === ThreadEventType.FileChangeSummary);
    const handoffEvents = events.filter(e => e.type === ThreadEventType.HandoffCreated);
    expect(fileEvents).toHaveLength(1);
    expect(handoffEvents).toHaveLength(1);
  });
});

describe("DevelopmentTraceService failure paths (T046)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("writes scan_failed when baseline failed", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;
    workspace.local_path = "/nonexistent/path";

    services.developmentTraceService.prepareRun({ run, workspace, traceCapability: CommandTraceCapability.Supported });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: new Date().toISOString(), exit_code: 0 });

    const result = services.developmentTraceService.finalizeRun(run.id);
    expect(result.finalized).toBe(true);

    const events = services.threadEventService.listByThread(issue.primary_thread_id!);
    const scanFailed = events.find(e => e.type === ThreadEventType.FileChangeScanFailed);
    expect(scanFailed).toBeDefined();
    const handoff = events.find(e => e.type === ThreadEventType.HandoffCreated);
    expect(handoff).toBeDefined();
  });

  it("finalizeRunWithoutWorkspace writes ownership_lost scan_failed", () => {
    const { run, issue } = setupIssueAndRun(services, tempDir);
    writeFileSync(join(tempDir, "a.ts"), "a");
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;

    services.developmentTraceService.prepareRun({ run, workspace, traceCapability: CommandTraceCapability.Supported });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: new Date().toISOString(), exit_code: 0 });

    const result = services.developmentTraceService.finalizeRunWithoutWorkspace(run.id, "workspace_ownership_lost");
    expect(result.finalized).toBe(true);

    const events = services.threadEventService.listByThread(issue.primary_thread_id!);
    const scanFailed = events.find(e => e.type === ThreadEventType.FileChangeScanFailed);
    expect(scanFailed).toBeDefined();
    expect(scanFailed!.payload_json.reason_code).toBe("workspace_ownership_lost");
    expect(scanFailed!.payload_json.recovered_after_restart).toBe(true);

    const fileChanges = services.fileChangeRepo.listByRun(run.id);
    expect(fileChanges).toHaveLength(0);
  });

  it("does not finalize queued never-started Run", () => {
    const { run } = setupIssueAndRun(services, tempDir);

    const result = services.developmentTraceService.finalizeRun(run.id);
    expect(result.finalized).toBe(false);
  });
});

describe("ValidationTraceService (T048)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("writes validation.requested event", () => {
    const { issue } = setupIssueAndRun(services, tempDir);
    const event = services.validationTraceService.writeRequested({
      issueId: issue.id, threadId: issue.primary_thread_id!, workspaceId: issue.workspace_id,
      validationRound: 1, target: "implementation", policyId: "vpl_test",
    });
    expect(event.type).toBe(ThreadEventType.ValidationRequested);
    expect(event.payload_json.validation_round).toBe(1);
    expect(event.payload_json.target).toBe("implementation");
  });

  it("writes validation.finding with severity", () => {
    const { issue } = setupIssueAndRun(services, tempDir);
    const event = services.validationTraceService.writeFinding({
      issueId: issue.id, threadId: issue.primary_thread_id!, workspaceId: issue.workspace_id,
      validationRound: 1, severity: "error", message: "Test failed", filePath: "src/app.ts", line: 42,
    });
    expect(event.type).toBe(ThreadEventType.ValidationFinding);
    expect(event.payload_json.severity).toBe("error");
    expect(event.payload_json.file_path).toBe("src/app.ts");
    expect(event.payload_json.line).toBe(42);
  });

  it("writes validation.passed result", () => {
    const { issue } = setupIssueAndRun(services, tempDir);
    const event = services.validationTraceService.writePassed({
      issueId: issue.id, threadId: issue.primary_thread_id!, workspaceId: issue.workspace_id,
      validationRound: 1, summary: "All tests passed",
    });
    expect(event.type).toBe(ThreadEventType.ValidationPassed);
    expect(event.payload_json.summary).toBe("All tests passed");
  });

  it("writes validation.failed with finding_count", () => {
    const { issue } = setupIssueAndRun(services, tempDir);
    const event = services.validationTraceService.writeFailed({
      issueId: issue.id, threadId: issue.primary_thread_id!, workspaceId: issue.workspace_id,
      validationRound: 1, summary: "2 tests failed", findingCount: 2,
    });
    expect(event.type).toBe(ThreadEventType.ValidationFailed);
    expect(event.payload_json.finding_count).toBe(2);
  });

  it("writes validation.blocked with reason_code", () => {
    const { issue } = setupIssueAndRun(services, tempDir);
    const event = services.validationTraceService.writeBlocked({
      issueId: issue.id, threadId: issue.primary_thread_id!, workspaceId: issue.workspace_id,
      validationRound: 1, summary: "Blocked", reasonCode: "validator_unavailable",
    });
    expect(event.type).toBe(ThreadEventType.ValidationBlocked);
    expect(event.payload_json.reason_code).toBe("validator_unavailable");
  });

  it("rejects cross-thread scope", () => {
    const { issue } = setupIssueAndRun(services, tempDir);
    expect(() =>
      services.validationTraceService.writeRequested({
        issueId: issue.id, threadId: "other-thread", workspaceId: issue.workspace_id,
        validationRound: 1, target: "impl", policyId: "p",
      }),
    ).toThrow();
  });
});
