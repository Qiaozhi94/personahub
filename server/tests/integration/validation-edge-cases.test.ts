import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunStatus, RunRole, RunDispatchSource, AdapterStatus, ThreadEventType, FailureReason } from "@personahub/shared/types";

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available });
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: null } });
  return { project, issue, implAdapter, implRun };
}

function setupWithValidator(services: TestServices, tempDir: string) {
  const { project, issue, implAdapter, implRun } = setupFixture(services, tempDir);
  const valAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available });
  return { project, issue, implAdapter, implRun, valAdapter };
}

describe("Validation edge cases (T083)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("no validator adapter blocks with validator_unavailable", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    services.validationWorkflowService.requestValidation(issue.id, implRun.id);
    const refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.status).toBe(IssueStatus.Blocked);
    expect(refetched!.blocked_reason_code).toBe("validator_unavailable");
    const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
    const blockedEvent = events.find((e) => e.type === ThreadEventType.ValidationBlocked);
    expect(blockedEvent).toBeDefined();
    expect(blockedEvent!.payload_json.reason_code).toBe("validator_unavailable");
  });

  it("invalid JSON finalMessage blocks with result_unparsable", () => {
    const { issue, implRun, valAdapter } = setupWithValidator(services, tempDir);
    const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    expect(valRun).not.toBeNull();
    const now = new Date().toISOString();
    services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
    services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: "this is not valid json at all" });
    services.validationWorkflowService.processValidatorResult(valRun.id);
    const refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.status).toBe(IssueStatus.Blocked);
    expect(refetched!.blocked_reason_code).toBe("result_unparsable");
  });

  it("validator run non-zero exit blocks with validator_run_failed", () => {
    const { issue, implRun, valAdapter } = setupWithValidator(services, tempDir);
    const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    const now = new Date().toISOString();
    services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
    services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: 1, failure_reason: FailureReason.AdapterExitNonzero });
    services.validationWorkflowService.processValidatorResult(valRun.id);
    const refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.status).toBe(IssueStatus.Blocked);
    expect(refetched!.blocked_reason_code).toBe("validator_run_failed");
  });

  it("validator run timeout blocks with validator_run_failed", () => {
    const { issue, implRun, valAdapter } = setupWithValidator(services, tempDir);
    const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    const now = new Date().toISOString();
    services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
    services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: null, failure_reason: FailureReason.ExecutionTimeout });
    services.validationWorkflowService.processValidatorResult(valRun.id);
    const refetched = services.issueRepo.getById(issue.id);
    expect(refetched!.status).toBe(IssueStatus.Blocked);
    expect(refetched!.blocked_reason_code).toBe("validator_run_failed");
  });
});
