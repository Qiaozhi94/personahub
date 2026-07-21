import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, RunRole, RunPurpose, FailureReason, IssueStatus, AdapterStatus, AgentCapability, ThreadEventType } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

// T057/T058/T059/T060/T061: consult never drives Issue state (design §7.3),
// but safety (git-push escalation -> Blocked) applies unconditionally
// (design §7.3's own explicit carve-out), and consult stays eligible to run
// during Validating (design §7.5) without polluting the validator's context.

function setupIssue(services: TestServices, tempDir: string, capabilityTags: AgentCapability[] = []) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "Fake Adapter",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: capabilityTags,
    default_model: null,
    status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Consult state impact & escalation (T057-T061)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    delete process.env.FAKE_CLAUDE_MODE;
  });
  afterEach(() => disposeTestServices(services));

  it("T057/T058: a completed consult Run never drives Issue state and never triggers the F004 validation hook", async () => {
    // No Implementation capability -> classifier degrades this dispatch to consult.
    const { issue, adapter } = setupIssue(services, tempDir, []);
    services.adapterRegistry.register(new FakeAgentAdapter({ exitCode: 0, finalMessage: "just looking", delayMs: 30 }));

    expect(issue.status).toBe(IssueStatus.Inbox);

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "just take a look");
    expect(run.role).toBe(RunRole.Consult);
    expect(run.purpose).toBe(RunPurpose.AdHocConsult);
    await wait(300);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Completed);

    const finalIssue = services.issueRepo.getById(issue.id);
    // Consult must never advance Inbox -> Running, unlike a workflow-bound
    // implementation Run.
    expect(finalIssue!.status).toBe(IssueStatus.Inbox);
    expect(finalIssue!.validation_round_count).toBe(0);

    // T058: no validation.requested / validation.dispatch_pending event —
    // the F004 workflow hook only fires for role=Implementation Completed.
    const events = services.threadEventService.listByThread(issue.primary_thread!.id);
    expect(events.some((e) => e.type === ThreadEventType.ValidationRequested)).toBe(false);
  });

  it("T057: a workflow-bound implementation Run DOES advance Inbox -> Running (contrast case)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir, [AgentCapability.Implementation]);
    services.adapterRegistry.register(new FakeAgentAdapter({ exitCode: 0, finalMessage: "done", delayMs: 30 }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "implement it");
    expect(run.role).toBe(RunRole.Implementation);
    expect(run.purpose).toBe(RunPurpose.WorkflowBound);

    const runningIssue = services.issueRepo.getById(issue.id);
    expect(runningIssue!.status).toBe(IssueStatus.Running);
  });

  it("T059/T060: a dangerous operation in a consult Run still Blocks the Issue, and the escalation event carries purpose/role", async () => {
    const { issue, adapter } = setupIssue(services, tempDir, []); // no capability -> consult
    services.adapterRegistry.register(new FakeAgentAdapter({
      exitCode: null,
      failureReason: FailureReason.PreExecutionApprovalRejected,
      errorMessage: "git push origin main",
      delayMs: 50,
    }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
    expect(run.role).toBe(RunRole.Consult);
    await wait(300);

    const escalationEvent = services.threadEventService
      .listByThread(issue.primary_thread!.id)
      .find((e) => e.type === ThreadEventType.EscalationTriggered);
    expect(escalationEvent).toBeDefined();
    expect(escalationEvent!.payload_json.purpose).toBe(RunPurpose.AdHocConsult);
    expect(escalationEvent!.payload_json.role).toBe(RunRole.Consult);

    const finalIssue = services.issueRepo.getById(issue.id);
    expect(finalIssue!.status).toBe(IssueStatus.Blocked);

    const finalRun = services.runRepo.getById(run.id);
    expect(finalRun!.status).toBe(RunStatus.Failed);
    expect(finalRun!.failure_reason).toBe(FailureReason.PreExecutionApprovalRejected);
  });

  it("T059: escalation from a consult Run still cancels other eligible queued workflow Runs on the same Issue", async () => {
    const { issue, adapter } = setupIssue(services, tempDir, []); // consult-only adapter
    const implAdapter = services.agentConfigRepo.create({
      project_id: issue.project_id, name: "Impl", role: "implementation", cli_provider: "fake",
      command: "fake", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });

    services.adapterRegistry.register(new FakeAgentAdapter({
      failureReason: FailureReason.PreExecutionApprovalRejected,
      errorMessage: "git push",
      delayMs: 100,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "consult that will escalate");
    await wait(50);
    const queuedWorkflowRun = await services.runDispatchService.dispatch(issue.id, implAdapter.id, "queued workflow work");
    await wait(300);

    const queuedRunFinal = services.runRepo.getById(queuedWorkflowRun.id);
    expect(queuedRunFinal!.status).toBe(RunStatus.Cancelled);
  });

  it("T061: a consult Run stays eligible to start while the Issue is Validating (design §7.5)", async () => {
    const { issue } = setupIssue(services, tempDir, []);
    services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });

    const consultAdapter = services.agentConfigRepo.create({
      project_id: issue.project_id, name: "Consult-only", role: "implementation", cli_provider: "fake",
      command: "fake", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
    });
    services.adapterRegistry.register(new FakeAgentAdapter({ exitCode: 0, finalMessage: "peek", delayMs: 30 }));

    const run = await services.runDispatchService.dispatch(issue.id, consultAdapter.id, "peek during validation");
    expect(run.role).toBe(RunRole.Consult);
    await wait(300);

    const finalRun = services.runRepo.getById(run.id);
    // Must have actually STARTED and completed, not been cancelled as
    // issue_state_changed_before_start (the bug this task fixes: consult
    // must not be treated as "not validator therefore ineligible").
    expect(finalRun!.status).toBe(RunStatus.Completed);

    const finalIssue = services.issueRepo.getById(issue.id);
    expect(finalIssue!.status).toBe(IssueStatus.Validating);
  });

  it("T061: an implementation Run queued/started while Validating is still correctly ineligible (contrast case)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir, [AgentCapability.Implementation]);
    services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });

    // Classifier degrades an Implementation-capable adapter to consult
    // while Validating (it doesn't have Validator capability), so this Run
    // is itself created as consult — construct a raw implementation Run
    // directly to exercise the drain-eligibility path in isolation.
    const workspace = services.workspaceRepo.getById(issue.workspace_id)!;
    const rawImplRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: workspace.id,
      adapter_config_id: adapter.id, instructions: "stale", status: RunStatus.Queued,
      role: RunRole.Implementation,
    });

    await services.runDispatchService.drainWorkspace(workspace.id);
    await wait(100);

    const finalRun = services.runRepo.getById(rawImplRun.id);
    expect(finalRun!.status).toBe(RunStatus.Cancelled);
  });
});
