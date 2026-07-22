import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ValidationDispatchScheduler } from "../../src/services/validation-dispatch-scheduler.js";
import { ValidationWorkflowService } from "../../src/services/validation/workflow-service.js";
import {
  IssueStatus, RunRole, RunDispatchSource, RunStatus,
  AdapterStatus, AgentCapability,
} from "@personahub/shared/types";

function createGraceWorkflowService(services: TestServices, graceMs: number): ValidationWorkflowService {
  return new ValidationWorkflowService(
    services.db, services.issueRepo, services.runRepo, services.threadEventService, services.threadEventRepo,
    services.validationTraceService, services.agentConfigRepo, services.workflowTemplateRepo,
    services.validationPolicyRepo, services.evidenceSummaryRepo, services.fileChangeRepo,
    graceMs,
  );
}

function setupPendingIssue(services: TestServices, tempDir: string, opts: { validatorCapability?: boolean } = {}) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  if (opts.validatorCapability !== false) {
    services.agentConfigRepo.create({
      project_id: project.id, name: "Val", role: "validator", cli_provider: "codex",
      command: "codex", args: [], capability_tags: [AgentCapability.Validator],
      default_model: "gpt-5", status: AdapterStatus.Available,
    });
  }
  const implRun = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
    adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
  });
  const graceWf = createGraceWorkflowService(services, 60_000);
  graceWf.requestValidation(issue.id, implRun.id); // Phase A only: leaves the slot pending for the scheduler
  return { project, issue, implRun, implAdapter };
}

function makeDue(services: TestServices, issueId: string, msAgo = 1000): void {
  services.db.prepare("UPDATE issues SET validation_dispatch_due_at = ? WHERE id = ?")
    .run(new Date(Date.now() - msAgo).toISOString(), issueId);
}

describe("T067: ValidationDispatchScheduler", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => {
    disposeTestServices(services);
    vi.useRealTimers();
  });

  it("does not claim before due", () => {
    const { issue } = setupPendingIssue(services, tempDir);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.tick();
    expect(services.runRepo.getActiveValidator(issue.id)).toBeNull();
    expect(services.issueRepo.getById(issue.id)!.validation_dispatch_due_at).not.toBeNull();
  });

  it("claims once due has passed", () => {
    const { issue } = setupPendingIssue(services, tempDir);
    makeDue(services, issue.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.tick();
    expect(services.runRepo.getActiveValidator(issue.id)).not.toBeNull();
    expect(services.issueRepo.getById(issue.id)!.validation_dispatch_due_at).toBeNull();
  });

  it("claims for multiple due issues in one tick", () => {
    const { issue: issue1 } = setupPendingIssue(services, tempDir);
    const { issue: issue2 } = setupPendingIssue(services, tempDir);
    makeDue(services, issue1.id);
    makeDue(services, issue2.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.tick();
    expect(services.runRepo.getActiveValidator(issue1.id)).not.toBeNull();
    expect(services.runRepo.getActiveValidator(issue2.id)).not.toBeNull();
  });

  it("stop() halts further scheduled ticks", () => {
    vi.useFakeTimers();
    const { issue } = setupPendingIssue(services, tempDir);
    makeDue(services, issue.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.stop(); // stopping before starting is a no-op, must not throw
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(5000);
    expect(services.runRepo.getActiveValidator(issue.id)).toBeNull();
  });

  it("start() fires tick() on the configured interval until stopped", () => {
    vi.useFakeTimers();
    const { issue } = setupPendingIssue(services, tempDir);
    makeDue(services, issue.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.start();
    vi.advanceTimersByTime(1000);
    expect(services.runRepo.getActiveValidator(issue.id)).not.toBeNull();
    scheduler.stop();
  });

  it("is non-reentrant: a tick already in progress ignores a nested tick call", () => {
    const { issue } = setupPendingIssue(services, tempDir);
    makeDue(services, issue.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    const original = services.validationWorkflowService.claimValidatorSlot.bind(services.validationWorkflowService);
    let claimCallCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (services.validationWorkflowService as any).claimValidatorSlot = (...args: unknown[]) => {
      claimCallCount++;
      if (claimCallCount === 1) {
        scheduler.tick(); // simulate a reentrant call arriving while the outer tick is still mid-flight
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original as any)(...args);
    };
    scheduler.tick();
    expect(claimCallCount).toBe(1); // the nested call was skipped by the ticking guard
    expect(services.runRepo.getActiveValidator(issue.id)).not.toBeNull();
  });

  it("blocks the issue when no validator is available, instead of leaving it stuck", () => {
    const { issue } = setupPendingIssue(services, tempDir, { validatorCapability: false });
    makeDue(services, issue.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.tick();
    const refetched = services.issueRepo.getById(issue.id)!;
    expect(refetched.status).toBe(IssueStatus.Blocked);
    expect(refetched.blocked_reason_code).toBe("validator_unavailable");
  });

  it("dispatches via ValidatorSelector (capability_tags), not the Project default adapter, even when the default has only implementation capability", () => {
    const { project, issue, implAdapter } = setupPendingIssue(services, tempDir);
    const validatorAdapter = services.agentConfigRepo.listAvailableByProjectAndCapability(project.id, AgentCapability.Validator)[0];
    services.projectRepo.setDefaultAdapter(project.id, implAdapter.id);
    makeDue(services, issue.id);
    const scheduler = new ValidationDispatchScheduler(services.issueRepo, services.validationWorkflowService, 1000);
    scheduler.tick();
    const activeValidator = services.runRepo.getActiveValidator(issue.id);
    expect(activeValidator).not.toBeNull();
    expect(activeValidator!.adapter_config_id).toBe(validatorAdapter.id);
    expect(activeValidator!.role).toBe(RunRole.Validator);
  });
});
