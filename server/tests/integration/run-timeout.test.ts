import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, FailureReason, AdapterStatus, ThreadEventType } from "@personahub/shared/types";
import type { AgentAdapter, AgentAdapterCapabilities, AgentRunInput, RunHandle, AdapterValidationResult } from "../../src/runtime/types.js";

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Hanging Adapter",
    role: "implementation",
    cli_provider: "hanging",
    command: "hanging",
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

class HangingAgentAdapter implements AgentAdapter {
  readonly provider = "hanging";
  readonly capabilities: AgentAdapterCapabilities = {
    provider: "hanging",
    supportsApprovalHook: false,
    supportsStructuredTrace: false,
    executionTimeoutMs: 100,
  };

  async validate(): Promise<AdapterValidationResult> {
    return { available: true, errorMessage: null };
  }

  async start(input: AgentRunInput): Promise<RunHandle> {
    const handle: RunHandle = {
      runId: input.runId,
      onOutput() {},
      onTrace() {},
      onExit() {},
      async cancel() {},
    };
    return handle;
  }
}

describe("Run Execution Timeout", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    services.adapterRegistry.register(new HangingAgentAdapter());
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("times out a hanging Run and sets failure_reason = execution_timeout", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(150);

    const timedOutRun = services.runRepo.getById(
      services.runRepo.listByIssue(issue.id)[0]!.id,
    );
    expect(timedOutRun!.status).toBe(RunStatus.Failed);
    expect(timedOutRun!.failure_reason).toBe(FailureReason.ExecutionTimeout);
  });

  it("releases workspace lock after timeout", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test");
    await wait(50);

    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(true);

    await wait(400);

    expect(services.workspaceLockService.isLocked(issue.workspace_id)).toBe(false);
  });
});
