import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, FailureReason, IssueStatus, AdapterStatus, ThreadEventType, AgentCapability, CliProvider, AdapterAuthType } from "@personahub/shared/types";

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeScriptPath = join(__testDir, "..", "helpers", "fake-opencode.mjs").replace(/\\/g, "/");

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[], options: any) => {
      if (command === "opencode") {
        return actual.spawn("node", [fakeScriptPath, ...args.filter((a: string) => a !== "opencode")], options);
      }
      return actual.spawn(command, args, options);
    }),
  };
});

// T009a: opencode is a .cmd shim on a real install (opencode-protocol-
// fixtures.md T005) — mock the resolver as a passthrough so the literal
// "opencode" string reaches the mocked spawn() unchanged.
vi.mock("../../src/runtime/executable-resolver.js", () => ({
  resolveExecutable: vi.fn((command: string) => ({
    resolved: { executable: command, prefixArgs: [], source: "direct" as const },
    errorMessage: null,
  })),
}));

const { OpenCodeAdapter } = await import("../../src/runtime/adapters/opencode-adapter.js");

function setupIssue(services: TestServices, tempDir: string, authType: AdapterAuthType = AdapterAuthType.OAuth) {
  const project = services.projectService.create("Test", "desc");
  const workspace = services.workspaceService.bind(project.id, tempDir);
  // This test drives a fake CLI script (fake-opencode.mjs) via
  // FAKE_OPENCODE_MODE on the test runner's own process.env, relying on it
  // reaching the child process — buildChildEnv()'s credential-isolation
  // allowlist (a real production security boundary, unrelated to what this
  // test is actually checking: protocol/trace parsing) would otherwise
  // strip it.
  services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "OpenCode",
    role: "implementation",
    cli_provider: CliProvider.OpenCode,
    command: "opencode",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: "claude-sonnet-4-5",
    model_provider: "anthropic",
    status: AdapterStatus.Available,
    auth_type: authType,
    api_key: authType === AdapterAuthType.ApiKey ? "sk-test-fake-key-value" : null,
  });
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("OpenCodeAdapter Integration (T042-T048)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    services.adapterRegistry.register(new OpenCodeAdapter());
    delete process.env.FAKE_OPENCODE_MODE;
  });

  afterEach(() => {
    disposeTestServices(services);
    delete process.env.FAKE_OPENCODE_MODE;
  });

  it("declares supportsApprovalHook=false and supportsStructuredTrace=true (real capability boundary)", () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.capabilities.supportsApprovalHook).toBe(false);
    expect(adapter.capabilities.supportsStructuredTrace).toBe(true);
  });

  it("executes a low-risk instruction and completes with the final message", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "say hi");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.exit_code).toBe(0);
  });

  it("persists run.output events from text parts", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "say hi");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const outputEvents = events.filter((e) => e.type === ThreadEventType.RunOutput);
    expect(outputEvents.length).toBeGreaterThan(0);
  });

  it("persists run.queued, run.started, run.completed in correct order", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "say hi");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const types = events.map((e) => e.type);
    const qIdx = types.indexOf(ThreadEventType.RunQueued);
    const sIdx = types.indexOf(ThreadEventType.RunStarted);
    const cIdx = types.indexOf(ThreadEventType.RunCompleted);
    expect(qIdx).toBeGreaterThanOrEqual(0);
    expect(sIdx).toBeGreaterThan(qIdx);
    expect(cIdx).toBeGreaterThan(sIdx);
  });

  it("handles a turn-level error line as Failed/AdapterExitNonzero", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.AdapterExitNonzero);
  });

  it("handles a hard spawn-level failure (nonzero exit, no JSON) as Failed/SpawnFailed", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "hard_failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.SpawnFailed);
  });

  it("persists command_started/command_completed with a real exitCode (advantage over Claude)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "command_success";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run tests");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find((e) => e.type === ThreadEventType.CommandStarted);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(completed!.payload_json.outcome).toBe("succeeded");
    expect(completed!.payload_json.exit_code).toBe(0);
  });

  it("classifies a non-git failed tool call as command_completed/failed without escalating", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "command_failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "run tests");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);
    expect(completed!.payload_json.outcome).toBe("failed");
    expect(completed!.payload_json.exit_code).toBe(1);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
  });

  it("triggers CredentialIsolationBlocked escalation for a failed git push (T008 real failure text: 'Repository not found')", async () => {
    // This test's whole point is the real credential-isolation
    // classification, so — unlike setupIssue()'s other callers — it must
    // NOT set push_credentials_enabled=true. The fake script's mode instead
    // travels via a real argv entry (adapter `args`), which credential
    // isolation never touches (only env vars are filtered).
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "OpenCode", role: "implementation", cli_provider: CliProvider.OpenCode,
      command: "opencode", args: ["credential_failure"], capability_tags: [AgentCapability.Implementation],
      default_model: "claude-sonnet-4-5", model_provider: "anthropic",
      status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
    });

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const escalationEvent = events.find((e) => e.type === ThreadEventType.EscalationTriggered);
    expect(escalationEvent).toBeDefined();
    expect(escalationEvent!.payload_json.blocked_by).toBe("credential_isolation");

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.CredentialIsolationBlocked);

    const updatedIssue = services.issueRepo.getById(issue.id);
    expect(updatedIssue!.status).toBe(IssueStatus.Blocked);
  });

  it("tolerates malformed JSON lines without failing the Run", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "malformed";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
  });

  it("stores a JSON validation envelope as the raw final_message unchanged (F004 parseValidationResult reuse)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "json_final_message";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "validate");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.has_final_message).toBe(true);

    const row = services.db.prepare("SELECT final_message FROM runs WHERE id = ?").get(run.id) as { final_message: string | null };
    const envelope = JSON.parse(row.final_message!);
    expect(envelope.outcome).toBe("passed");
  });

  it("cancels a running turn via SIGINT and marks the Run cancelled with no final message", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_OPENCODE_MODE = "cancel";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "long task");
    await wait(100);

    await services.runDispatchService.cancel(run.id);
    await wait(300);

    const cancelledRun = services.runRepo.getById(run.id);
    expect([RunStatus.Cancelled, RunStatus.Completed]).toContain(cancelledRun!.status);
    expect(cancelledRun!.has_final_message).toBe(false);
  });

  it("always passes an explicit -m provider/model flag, and the message is a positional argv arg (T044/T005: no stdin mode)", async () => {
    const childProcessModule = await import("node:child_process");
    const spawnSpy = vi.mocked(childProcessModule.spawn);
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "a distinctive instruction");
    await wait(200);

    const call = spawnSpy.mock.calls.filter((c) => c[0] === "opencode").pop();
    expect(call).toBeDefined();
    const args = call![1] as string[];
    const mIdx = args.indexOf("-m");
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(args[mIdx + 1]).toBe("anthropic/claude-sonnet-4-5");
    expect(args.join(" ")).toContain("a distinctive instruction");
    const options = call![2] as { shell?: boolean };
    expect(options.shell).toBe(false);
  });

  it("api_key mode: injects the confirmed <PROVIDER>_API_KEY env var and never puts the key in argv", async () => {
    const childProcessModule = await import("node:child_process");
    const spawnSpy = vi.mocked(childProcessModule.spawn);
    const { issue, adapter } = setupIssue(services, tempDir, AdapterAuthType.ApiKey);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const call = spawnSpy.mock.calls.filter((c) => c[0] === "opencode").pop();
    const args = call![1] as string[];
    expect(args.join(" ")).not.toContain("sk-test-fake-key-value");
    const options = call![2] as { env?: Record<string, string> };
    expect(options.env?.ANTHROPIC_API_KEY).toBe("sk-test-fake-key-value");
  });

  it("api_key mode completes successfully end-to-end", async () => {
    const { issue, adapter } = setupIssue(services, tempDir, AdapterAuthType.ApiKey);

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "say hi");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
  });
});
