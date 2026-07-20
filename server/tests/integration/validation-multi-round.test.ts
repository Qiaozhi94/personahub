import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunStatus, RunRole, RunDispatchSource, AdapterStatus, ThreadEventType, ValidationBlockReason, AgentCapability } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import { ValidationRecoveryService } from "../../src/services/validation/recovery-service.js";

const FAILED_FM = JSON.stringify({
  schema_version: 1,
  outcome: "failed",
  summary: "Tests still failing",
  findings: [
    {
      severity: "error",
      message: "Test assertion failed",
      suggestion: "Fix the assertion",
      evidence_refs: [],
      file_path: "src/test.js",
      line: 42,
    },
  ],
  evidence_refs: [],
  missing_evidence: [],
  key_decisions: [],
  lessons_candidate: [],
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRoundIncrement(
  svc: TestServices,
  issueId: string,
  expectedRound: number,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const issue = svc.issueRepo.getById(issueId);
    if (issue!.validation_round_count === expectedRound) return;
    await wait(50);
  }
  const final = svc.issueRepo.getById(issueId);
  throw new Error(
    `Timed out waiting for round ${expectedRound}, got round=${final!.validation_round_count} status=${final!.status}`,
  );
}

describe("Validation multi-round (T082)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => disposeTestServices(services));

  it("3 rounds of fail leads to Blocked with round_limit_reached", async () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, {
      title: "T",
      goal: "G",
    });
    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Running,
      updatedAt: new Date().toISOString(),
    });

    // Register FakeAdapter that produces a failed validation result
    services.adapterRegistry.register(
      new FakeAgentAdapter({
        exitCode: 0,
        finalMessage: FAILED_FM,
        delayMs: 50,
        outputDelayMs: 10,
      }),
    );

    // Create adapter configs (both use "fake" provider)
    const implAdapter = services.agentConfigRepo.create({
      project_id: project.id,
      name: "Impl",
      role: "implementation",
      cli_provider: "fake",
      command: "fake",
      args: [],
      capability_tags: [],
      default_model: null,
      status: AdapterStatus.Available,
    });
    services.agentConfigRepo.create({
      project_id: project.id,
      name: "Val",
      role: "validator",
      cli_provider: "fake",
      command: "fake",
      args: [],
      capability_tags: [AgentCapability.Validator],
      default_model: null,
      status: AdapterStatus.Available,
    });

    // Round 1: dispatch impl → validator fails → round_count becomes 1
    await services.runDispatchService.dispatch(issue.id, implAdapter.id, "fix it");
    await waitForRoundIncrement(services, issue.id, 1);

    let refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.status).toBe(IssueStatus.Running);

    // Round 2
    await services.runDispatchService.dispatch(issue.id, implAdapter.id, "fix it");
    await waitForRoundIncrement(services, issue.id, 2);

    refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.status).toBe(IssueStatus.Running);

    // Round 3: final round → Blocked with round_limit_reached
    await services.runDispatchService.dispatch(issue.id, implAdapter.id, "fix it");
    await waitForRoundIncrement(services, issue.id, 3);

    refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.validation_round_count).toBe(3);
    expect(refetched!.blocked_reason_code).toBe("round_limit_reached");

    // Verify findings are persisted across rounds
    const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
    const findings = events.filter(
      (e) => e.type === ThreadEventType.ValidationFinding,
    );
    expect(findings.length).toBe(3); // 1 finding per round × 3 rounds

    // Verify no auto-created repair Runs
    const implRuns = services.runRepo
      .listByIssue(issue.id)
      .filter((r) => r.role === RunRole.Implementation);
    expect(implRuns.length).toBe(3);
  });
});

describe("Validation recovery (T084)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => disposeTestServices(services));

  it("unblock preserves round count and fails on non-Blocked issue", () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, {
      title: "T",
      goal: "G",
    });

    // Set up as Running with an existing round count
    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Running,
      updatedAt: new Date().toISOString(),
    });
    services.db
      .prepare("UPDATE issues SET validation_round_count = 2 WHERE id = ?")
      .run(issue.id);

    // Unblock should NOT work on Running issue (409)
    expect(() =>
      services.validationRecoveryActionService.unblock(issue.id, "fix applied"),
    ).toThrow();

    // Use CAS to properly block the issue with validation block reason
    const casResult = services.issueRepo.compareAndSetStatus(
      issue.id,
      IssueStatus.Running,
      IssueStatus.Blocked,
      {
        blocked_reason_code: ValidationBlockReason.RoundLimitReached,
        blocked_reason_message: "Round limit reached",
      },
    );
    expect(casResult.success).toBe(true);

    const result = services.validationRecoveryActionService.unblock(
      issue.id,
      "Verified fix by operator",
    );
    expect(result.status).toBe(IssueStatus.Ready);
    // Round count should be preserved (only status changed, not round count)
    expect(result.validation_round_count).toBe(2);
  });

  it("reconcile requests validation for completed impl without validation.requested", async () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, {
      title: "T",
      goal: "G",
    });
    services.issueRepo.updateStatus(issue.id, {
      status: IssueStatus.Running,
      updatedAt: new Date().toISOString(),
    });

    const implAdapter = services.agentConfigRepo.create({
      project_id: project.id,
      name: "Impl",
      role: "implementation",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [],
      default_model: null,
      status: AdapterStatus.Available,
    });
    // Create a validator adapter so reconcile can find one
    services.agentConfigRepo.create({
      project_id: project.id,
      name: "Val",
      role: "validator",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [AgentCapability.Validator],
      default_model: null,
      status: AdapterStatus.Available,
    });

    // Create completed impl run without validation.requested
    services.runRepo.create({
      issue_id: issue.id,
      thread_id: issue.primary_thread!.id,
      workspace_id: issue.workspace_id,
      adapter_config_id: implAdapter.id,
      instructions: "do it",
      status: RunStatus.Completed,
      role: RunRole.Implementation,
      dispatch_source: RunDispatchSource.UserExplicit,
      adapter_identity: {
        adapter_config_id: implAdapter.id,
        name: "Impl",
        cli_provider: "codex",
        default_model: null,
      },
    });

    const recoveryService = new ValidationRecoveryService(
      services.issueRepo,
      services.runRepo,
      services.validationWorkflowService,
      services.threadEventRepo,
      services.agentConfigRepo,
    );

    await recoveryService.reconcile();

    // Verify validation was requested
    const events = services.threadEventRepo.listByThread(
      issue.primary_thread!.id,
    );
    const requested = events.find(
      (e) => e.type === ThreadEventType.ValidationRequested,
    );
    expect(requested).toBeDefined();
    expect(requested!.payload_json.validation_round).toBe(1);
  });
});
