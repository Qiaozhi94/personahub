import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { ThreadEventType, AdapterStatus } from "@personahub/shared/types";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeScriptPath = join(__testDir, "..", "helpers", "fake-codex.mjs").replace(/\\/g, "/");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  const workspace = services.workspaceService.bind(project.id, tempDir);
  // This test drives a fake CLI script (fake-codex.mjs) via FAKE_CODEX_MODE
  // on the test runner's own process.env, relying on it reaching the child
  // process — buildChildEnv()'s credential-isolation allowlist (a real
  // production security boundary, unrelated to what this test is actually
  // checking: protocol/trace parsing) would otherwise strip it.
  services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);
  const { issue } = services.issueService.create(project.id, { title: "Real Codex Test", goal: "Run commands and modify files" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Codex CLI", role: "implementation", cli_provider: "codex",
    command: "node", args: [fakeScriptPath], capability_tags: [], default_model: null, status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

describe("Real Codex CLI Protocol Integration (T081)", () => {
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

  it("captures command.started and command.completed from real protocol", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "command_success";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run npm test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find((e) => e.type === ThreadEventType.CommandStarted);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);

    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(started!.payload_json.command).toBe("npm test");
    expect(completed!.payload_json.outcome).toBe("succeeded");
    expect(completed!.payload_json.exit_code).toBe(0);
    expect(completed!.payload_json.duration_ms).toBe(842);
    expect(completed!.payload_json.summary).toBe("test passed\n");
    expect(completed!.evidence_refs).toContain(`event:${started!.id}`);
  });

  it("classifies npm test as verification and writes test.completed", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "command_success";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run npm test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const testEvent = events.find((e) => e.type === ThreadEventType.TestCompleted);

    expect(testEvent).toBeDefined();
    expect(testEvent!.payload_json.test_kind).toBe("test");
    expect(testEvent!.payload_json.result).toBe("passed");
  });

  it("captures failed command with non-zero exit", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "command_failure";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run failing test");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);
    const testEvent = events.find((e) => e.type === ThreadEventType.TestCompleted);

    expect(completed).toBeDefined();
    expect(completed!.payload_json.outcome).toBe("failed");
    expect(completed!.payload_json.exit_code).toBe(1);
    expect(testEvent).toBeDefined();
    expect(testEvent!.payload_json.result).toBe("failed");
  });

  it("records file changes and generates handoff", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    writeFileSync(join(tempDir, "existing.ts"), "old content");
    process.env.FAKE_CODEX_MODE = "command_success";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run npm test");
    await wait(600);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const fileEvent = events.find((e) => e.type === ThreadEventType.FileChangeSummary);
    const handoff = events.find((e) => e.type === ThreadEventType.HandoffCreated);

    expect(fileEvent).toBeDefined();
    expect(handoff).toBeDefined();
    expect(handoff!.payload_json.run_status).toBe("completed");
  });

  it("exports issue trace as Markdown", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "command_success";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run npm test");
    await wait(600);

    const result = services.traceExportService.exportIssueTraceMarkdown(issue.id);

    expect(result.content).toContain("# Real Codex Test - Development Trace");
    expect(result.content).toContain("npm test");
    expect(result.content).toContain("### Commands");
    expect(result.filename).toContain(".md");
  });

  it("handles started-only command (no completed)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    process.env.FAKE_CODEX_MODE = "command_no_exit";

    await services.runDispatchService.dispatch(issue.id, adapter.id, "run hanging command");
    await wait(500);

    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    const started = events.find((e) => e.type === ThreadEventType.CommandStarted);
    const completed = events.find((e) => e.type === ThreadEventType.CommandCompleted);

    expect(started).toBeDefined();
    expect(completed).toBeUndefined();

    const handoff = events.find((e) => e.type === ThreadEventType.HandoffCreated);
    expect(handoff).toBeDefined();
  });
});
