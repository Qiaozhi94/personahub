import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import { RunStatus, AdapterStatus, FailureReason } from "@personahub/shared/types";

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SAMPLE_FINAL_MESSAGE = JSON.stringify({
  schema_version: 1,
  outcome: "passed",
  summary: "All checks passed.",
  findings: [],
  evidence_refs: [],
  missing_evidence: [],
  key_decisions: [],
  lessons_candidate: [],
});

function getRawFinalMessage(services: TestServices, runId: string): string | null {
  const row = services.db.prepare("SELECT final_message FROM runs WHERE id = ?").get(runId) as
    | { final_message: string | null }
    | undefined;
  return row?.final_message ?? null;
}

describe("AgentRunner final-message persistence (T034)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("persists finalMessage to runs.final_message when adapter emits it", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      finalMessage: SAMPLE_FINAL_MESSAGE,
      delayMs: 50,
      outputChunks: [],
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const completedRun = services.runRepo.getById(run.id);
    expect(completedRun!.status).toBe(RunStatus.Completed);
    expect(completedRun!.has_final_message).toBe(true);

    const rawMessage = getRawFinalMessage(services, run.id);
    expect(rawMessage).toBe(SAMPLE_FINAL_MESSAGE);
  });

  it("does not expose finalMessage content in public Run object", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      finalMessage: SAMPLE_FINAL_MESSAGE,
      delayMs: 50,
      outputChunks: [],
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const completedRun = services.runRepo.getById(run.id)!;
    expect(completedRun.has_final_message).toBe(true);
    expect("final_message" in completedRun).toBe(false);
    expect("finalMessage" in completedRun).toBe(false);
  });

  it("sets has_final_message=false when adapter emits null finalMessage", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      finalMessage: null,
      delayMs: 50,
      outputChunks: [],
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const completedRun = services.runRepo.getById(run.id);
    expect(completedRun!.status).toBe(RunStatus.Completed);
    expect(completedRun!.has_final_message).toBe(false);

    const rawMessage = getRawFinalMessage(services, run.id);
    expect(rawMessage).toBeNull();
  });

  it("does not persist finalMessage for failed runs", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      exitCode: 1,
      failureReason: FailureReason.AdapterExitNonzero,
      errorMessage: "Command failed",
      finalMessage: SAMPLE_FINAL_MESSAGE,
      delayMs: 50,
      outputChunks: [],
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const failedRun = services.runRepo.getById(run.id);
    expect(failedRun!.status).toBe(RunStatus.Failed);
    expect(failedRun!.has_final_message).toBe(false);

    const rawMessage = getRawFinalMessage(services, run.id);
    expect(rawMessage).toBeNull();
  });

  it("persists finalMessage before onTerminal callback fires", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      finalMessage: SAMPLE_FINAL_MESSAGE,
      delayMs: 50,
      outputChunks: [],
    }));

    let finalMessageAtTerminal: string | null = "not-checked";
    const originalOnRunTerminal = services.runDispatchService.onRunTerminal.bind(services.runDispatchService);
    services.runDispatchService.onRunTerminal = (runId: string, workspaceId: string) => {
      finalMessageAtTerminal = getRawFinalMessage(services, runId);
      originalOnRunTerminal(runId, workspaceId);
    };

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(300);

    expect(finalMessageAtTerminal).toBe(SAMPLE_FINAL_MESSAGE);
    expect(services.runRepo.getById(run.id)!.has_final_message).toBe(true);
  });

  it("terminal callback duplicate does not overwrite finalMessage", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      finalMessage: SAMPLE_FINAL_MESSAGE,
      delayMs: 50,
      outputChunks: [],
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const completedRun = services.runRepo.getById(run.id);
    expect(completedRun!.status).toBe(RunStatus.Completed);
    expect(completedRun!.has_final_message).toBe(true);

    services.runService.transitionToCompleted(run.id, 0);

    const stillCompletedRun = services.runRepo.getById(run.id);
    expect(stillCompletedRun!.has_final_message).toBe(true);
    expect(getRawFinalMessage(services, run.id)).toBe(SAMPLE_FINAL_MESSAGE);
  });

  it("preserves unicode in persisted finalMessage", async () => {
    const unicodeMessage = '{"summary":"✓ 中文 café - 全部通过"}';
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new FakeAgentAdapter({
      finalMessage: unicodeMessage,
      delayMs: 50,
      outputChunks: [],
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    expect(getRawFinalMessage(services, run.id)).toBe(unicodeMessage);
  });

  it("does not persist finalMessage for cancelled runs", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    const adapterInstance = new FakeAgentAdapter({
      finalMessage: SAMPLE_FINAL_MESSAGE,
      delayMs: 5000,
      outputChunks: [],
    });
    services.adapterRegistry.register(adapterInstance);

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(50);

    await services.runDispatchService.cancel(run.id);
    await wait(200);

    const cancelledRun = services.runRepo.getById(run.id);
    expect(cancelledRun!.status).toBe(RunStatus.Cancelled);
    expect(cancelledRun!.has_final_message).toBe(false);
    expect(getRawFinalMessage(services, run.id)).toBeNull();
  });
});
