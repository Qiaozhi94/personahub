import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunStatus, FailureReason, IssueStatus, AdapterStatus, ThreadEventType } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";

function setupIssue(services: TestServices, tempDir: string) {
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
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ESCALATION_REASONS = [
  { reason: FailureReason.PreExecutionApprovalRejected, blockedBy: "pre_execution_approval", preBlocked: true },
  { reason: FailureReason.CredentialIsolationBlocked, blockedBy: "credential_isolation", preBlocked: true },
  { reason: FailureReason.PostHocEscalation, blockedBy: "post_hoc_detection", preBlocked: false },
];

describe("Git Push Escalation Path (T054)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  for (const scenario of ESCALATION_REASONS) {
    it(`triggers escalation with blocked_by=${scenario.blockedBy} and correct event order`, async () => {
      const { issue, adapter } = setupIssue(services, tempDir);

      services.adapterRegistry.register(new FakeAgentAdapter({
        exitCode: null,
        failureReason: scenario.reason,
        errorMessage: "git push origin main",
        delayMs: 50,
      }));

      const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "git push");
      await wait(300);

      const events = services.threadEventService.listByThread(issue.primary_thread!.id);
      const types = events.map(e => e.type);

      const escalationIdx = types.indexOf(ThreadEventType.EscalationTriggered);
      const failedIdx = types.indexOf(ThreadEventType.RunFailed);
      const blockedIdx = types.indexOf(ThreadEventType.IssueBlocked);

      expect(escalationIdx).toBeGreaterThanOrEqual(0);
      expect(failedIdx).toBeGreaterThan(escalationIdx);
      expect(blockedIdx).toBeGreaterThan(failedIdx);

      const escalationEvent = events.find(e => e.type === ThreadEventType.EscalationTriggered);
      expect(escalationEvent!.payload_json.blocked_by).toBe(scenario.blockedBy);
      expect(escalationEvent!.payload_json.pre_execution_blocked).toBe(scenario.preBlocked);
      expect(escalationEvent!.payload_json.detected_operation).toBe("git push origin main");

      const failedRun = services.runRepo.getById(run.id);
      expect(failedRun!.status).toBe(RunStatus.Failed);
      expect(failedRun!.failure_reason).toBe(scenario.reason);

      const updatedIssue = services.issueRepo.getById(issue.id);
      expect(updatedIssue!.status).toBe(IssueStatus.Blocked);

      await wait(300);
    });
  }

  it("cancels queued Runs for same Issue after escalation", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    services.adapterRegistry.register(new FakeAgentAdapter({
      failureReason: FailureReason.PreExecutionApprovalRejected,
      errorMessage: "git push",
      delayMs: 100,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "first - will escalate");
    await wait(50);

    const queuedRun = await services.runDispatchService.dispatch(issue.id, adapter.id, "second - should be cancelled");
    await wait(300);

    const queuedRunFinal = services.runRepo.getById(queuedRun.id);
    expect(queuedRunFinal!.status).toBe(RunStatus.Cancelled);

    await wait(300);
  });
});
