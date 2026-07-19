import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, FailureReason, IssueStatus, AdapterStatus, ThreadEventType } from "@personahub/shared/types";

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeScriptPath = join(__testDir, "..", "helpers", "fake-codex.mjs").replace(/\\/g, "/");

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[], options: any) => {
      if (command === "codex") {
        return actual.spawn("node", [fakeScriptPath, ...args], options);
      }
      return actual.spawn(command, args, options);
    }),
  };
});

// T009a: the adapter resolves the configured command through resolveExecutable()
// before spawning. On this dev machine "codex" resolves to the real installed
// CLI (a shim to node.exe + codex.js), which would bypass the child_process
// mock above entirely. Mock the resolver as a passthrough for "codex" so the
// literal command string still reaches the mocked spawn() unchanged.
vi.mock("../../src/runtime/executable-resolver.js", () => ({
  resolveExecutable: vi.fn((command: string) => ({
    resolved: { executable: command, prefixArgs: [], source: "direct" as const },
    errorMessage: null,
  })),
}));

const { CodexCliAdapter } = await import("../../src/runtime/adapters/codex-cli-adapter.js");

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Codex CLI",
    role: "implementation",
    cli_provider: "codex",
    command: "codex",
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

describe("CodexCliAdapter Integration (T053)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    services.adapterRegistry.register(new CodexCliAdapter());
    delete process.env.FAKE_CODEX_MODE;
  });

  afterEach(() => {
    disposeTestServices(services);
    delete process.env.FAKE_CODEX_MODE;
  });

  it("executes a low-risk instruction through real CodexCliAdapter and completes", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    const run = await services.runDispatchService.dispatch(
      issue.id, adapter.id, "echo hello world",
    );

    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.exit_code).toBe(0);
  });

  it("persists run.output events from CodexCliAdapter agent_message_delta", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const outputEvents = events.filter(e => e.type === ThreadEventType.RunOutput);
    expect(outputEvents.length).toBeGreaterThan(0);
    expect(outputEvents[0]!.payload_json.stream).toBe("stdout");
  });

  it("persists run.queued, run.started, run.completed in correct order", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const types = events.map(e => e.type);
    const qIdx = types.indexOf(ThreadEventType.RunQueued);
    const sIdx = types.indexOf(ThreadEventType.RunStarted);
    const cIdx = types.indexOf(ThreadEventType.RunCompleted);

    expect(qIdx).toBeGreaterThanOrEqual(0);
    expect(sIdx).toBeGreaterThan(qIdx);
    expect(cIdx).toBeGreaterThan(sIdx);
  });

  it("handles adapter process exit with non-zero code as failed", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
  });

  it("triggers escalation when Codex sends git push approval request", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "escalation";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const escalationEvent = events.find(e => e.type === ThreadEventType.EscalationTriggered);
    expect(escalationEvent).toBeDefined();
    expect(escalationEvent!.payload_json.blocked_by).toBe("pre_execution_approval");
    expect(escalationEvent!.payload_json.pre_execution_blocked).toBe(true);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.PreExecutionApprovalRejected);

    const updatedIssue = services.issueRepo.getById(issue.id);
    expect(updatedIssue!.status).toBe(IssueStatus.Blocked);
  });
});

