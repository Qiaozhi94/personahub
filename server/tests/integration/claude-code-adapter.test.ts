import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, FailureReason, IssueStatus, AdapterStatus, ThreadEventType, AgentCapability, CliProvider, AdapterAuthType } from "@personahub/shared/types";

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeScriptPath = join(__testDir, "..", "helpers", "fake-claude.mjs").replace(/\\/g, "/");

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((command: string, args: string[], options: any) => {
      if (command === "claude") {
        return actual.spawn("node", [fakeScriptPath, ...args.filter((a: string) => a !== "claude")], options);
      }
      return actual.spawn(command, args, options);
    }),
  };
});

// T009a: on this dev machine "claude" resolves to a real installed native
// exe (server/tests/helpers/claude-protocol-fixtures.md T001), which would
// bypass the child_process mock above entirely. Mock the resolver as a
// passthrough so the literal "claude" command string reaches the mocked
// spawn() unchanged, exactly like codex-cli-adapter.test.ts does for codex.
vi.mock("../../src/runtime/executable-resolver.js", () => ({
  resolveExecutable: vi.fn((command: string) => ({
    resolved: { executable: command, prefixArgs: [], source: "direct" as const },
    errorMessage: null,
  })),
}));

const { ClaudeCodeAdapter } = await import("../../src/runtime/adapters/claude-code-adapter.js");

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  const workspace = services.workspaceService.bind(project.id, tempDir);
  // This test drives a fake CLI script (fake-claude.mjs) via FAKE_CLAUDE_MODE
  // on the test runner's own process.env, relying on it reaching the child
  // process — buildChildEnv()'s credential-isolation allowlist (a real
  // production security boundary, unrelated to what this test is actually
  // checking: protocol/trace parsing) would otherwise strip it.
  services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Claude Code",
    role: "implementation",
    cli_provider: CliProvider.ClaudeCode,
    command: "claude",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: null,
    status: AdapterStatus.Available,
    auth_type: AdapterAuthType.OAuth,
  });
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ClaudeCodeAdapter Integration (T037/T038/T039/T040/T041)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    services.adapterRegistry.register(new ClaudeCodeAdapter());
    delete process.env.FAKE_CLAUDE_MODE;
  });

  afterEach(() => {
    disposeTestServices(services);
    delete process.env.FAKE_CLAUDE_MODE;
  });

  it("executes a low-risk instruction and completes with the final message", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "say hi");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.exit_code).toBe(0);
  });

  it("persists run.output events from assistant text", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "say hi");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const outputEvents = events.filter((e) => e.type === ThreadEventType.RunOutput);
    expect(outputEvents.length).toBeGreaterThan(0);
    expect(outputEvents[0]!.payload_json.stream).toBe("stdout");
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

  it("handles a graceful in-band error result (is_error:true) as Failed/AdapterExitNonzero", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.AdapterExitNonzero);
  });

  it("handles a hard spawn-level failure (nonzero exit, no result line) as Failed/SpawnFailed", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "hard_failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.SpawnFailed);
  });

  it("persists command_started/command_completed trace events for a successful tool call", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "command_success";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run tests");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find((e) => e.type === ThreadEventType.CommandStarted);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(completed!.payload_json.outcome).toBe("succeeded");
    expect(completed!.payload_json.exit_code).toBeNull();
  });

  it("classifies a failed tool call (is_error, no hook denial) as command_completed/failed", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "command_failure";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "run tests");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);
    expect(completed!.payload_json.outcome).toBe("failed");

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
  });

  it("triggers escalation when the PreToolUse hook denies a git push (tool_result_meta permission-rule)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "escalation";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const escalationEvent = events.find((e) => e.type === ThreadEventType.EscalationTriggered);
    expect(escalationEvent).toBeDefined();
    expect(escalationEvent!.payload_json.blocked_by).toBe("pre_execution_approval");
    expect(escalationEvent!.payload_json.pre_execution_blocked).toBe(true);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.PreExecutionApprovalRejected);

    const updatedIssue = services.issueRepo.getById(issue.id);
    expect(updatedIssue!.status).toBe(IssueStatus.Blocked);
  });

  it("falls back to CredentialIsolationBlocked when a git push fails without a hook denial marker", async () => {
    // This test's whole point is the real credential-isolation classification
    // (`!input.workspace.pushCredentialsEnabled` in claude-code-adapter.ts),
    // so — unlike setupIssue()'s other callers — it must NOT set
    // push_credentials_enabled=true. The fake script's mode instead travels
    // via a real argv entry (adapter `args`), which credential isolation
    // never touches (only env vars are filtered).
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Claude Code", role: "implementation", cli_provider: CliProvider.ClaudeCode,
      command: "claude", args: ["credential_failure"], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
    });

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.CredentialIsolationBlocked);
  });

  it("stores a JSON validation envelope as the raw final_message unchanged (F004 parseValidationResult reuse, T041)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "json_final_message";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "validate");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
    expect(finalRun!.has_final_message).toBe(true);

    const row = services.db.prepare("SELECT final_message FROM runs WHERE id = ?").get(run.id) as { final_message: string | null };
    const envelope = JSON.parse(row.final_message!);
    expect(envelope.outcome).toBe("passed");
    expect(envelope.schema_version).toBe(1);
  });

  it("tolerates malformed JSON lines without failing the Run", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "malformed";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(500);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);
  });

  it("cancels a running turn via SIGINT and marks the Run cancelled with no final message", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CLAUDE_MODE = "cancel";

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "long task");
    await wait(100);

    await services.runDispatchService.cancel(run.id);
    await wait(300);

    const cancelledRun = services.runRepo.getById(run.id);
    expect(cancelledRun!.status).toBe(RunStatus.Cancelled);
    expect(cancelledRun!.has_final_message).toBe(false);
  });

  it("writes instructions via stdin, not argv (real protocol contract, T002)", async () => {
    const childProcessModule = await import("node:child_process");
    const spawnSpy = vi.mocked(childProcessModule.spawn);
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "a secret-looking instruction");
    await wait(200);

    const claudeCall = spawnSpy.mock.calls.filter((call) => call[0] === "claude").pop();
    expect(claudeCall).toBeDefined();
    const args = claudeCall![1] as string[];
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args.join(" ")).not.toContain("a secret-looking instruction");
    const options = claudeCall![2] as { shell?: boolean };
    expect(options.shell).toBe(false);
  });

  it("registers a PreToolUse hook via --settings pointing at a real temp script file", async () => {
    const childProcessModule = await import("node:child_process");
    const spawnSpy = vi.mocked(childProcessModule.spawn);
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(200);

    const claudeCall = spawnSpy.mock.calls.filter((call) => call[0] === "claude").pop();
    const args = claudeCall![1] as string[];
    const settingsIdx = args.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    const settings = JSON.parse(args[settingsIdx + 1]!);
    expect(settings.hooks.PreToolUse[0].matcher).toBe("PowerShell|Bash");
  });
});
