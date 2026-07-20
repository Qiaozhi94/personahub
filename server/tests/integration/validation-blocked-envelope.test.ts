import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType, AgentCapability } from "@personahub/shared/types";

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Implementation], default_model: "gpt-5", status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "gpt-5", status: AdapterStatus.Available });
  const implAdapterId = services.agentConfigRepo.listAvailableByProjectAndCapability(project.id, AgentCapability.Implementation)[0].id;
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapterId, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapterId, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Work done", completed_work: [], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
  return { project, issue, implRun, threadId: issue.primary_thread!.id };
}

function completeWith(services: TestServices, runId: string, fm: object) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(runId, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(runId, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(fm) });
}

const BLOCKED_MISSING = { schema_version: 1, outcome: "blocked", summary: "Cannot validate: payment module test evidence is missing", findings: [], evidence_refs: [], missing_evidence: ["test-run for the payment module"], key_decisions: ["K1"], lessons_candidate: ["L1"] };
const BLOCKED_FINDINGS = { schema_version: 1, outcome: "blocked", summary: "Cannot validate due to blocking defects", findings: [{ severity: "blocking", message: "BLOCKING_ISSUE_X", suggestion: "fix it", evidence_refs: [], file_path: "src/a.ts", line: 3 }], evidence_refs: [], missing_evidence: [], key_decisions: ["K1"], lessons_candidate: ["L1"] };

describe("T091 blocked envelope submission", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("drives the Issue to Blocked with blocker columns and a validation.blocked event", () => {
    const { issue, implRun, threadId } = setupFixture(services, tempDir);
    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, validatorRun.id, BLOCKED_MISSING);

    services.validationWorkflowService.processValidatorResult(validatorRun.id);

    const updated = services.issueRepo.getById(issue.id)!;
    expect(updated.status).toBe(IssueStatus.Blocked);
    expect(updated.blocked_reason_code).toBe("evidence_missing");
    expect(updated.blocked_reason_message).toContain("Cannot validate");
    const blockedEvents = services.threadEventRepo.listByThreadAndTypes(threadId, [ThreadEventType.ValidationBlocked], undefined, 10);
    const ev = blockedEvents.find((e) => e.payload_json.validator_run_id === validatorRun.id);
    expect(ev).toBeDefined();
    expect(ev!.payload_json.reason_code).toBe("evidence_missing");
    expect(ev!.payload_json.missing_evidence).toEqual(["test-run for the payment module"]);
  });

  it("persists validator findings when the blocked envelope carries them", () => {
    const { issue, implRun, threadId } = setupFixture(services, tempDir);
    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, validatorRun.id, BLOCKED_FINDINGS);

    services.validationWorkflowService.processValidatorResult(validatorRun.id);

    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
    const findings = services.threadEventRepo.listByThreadAndTypes(threadId, [ThreadEventType.ValidationFinding], undefined, 10);
    expect(findings.some((e) => e.payload_json.message === "BLOCKING_ISSUE_X" && e.payload_json.validator_run_id === validatorRun.id)).toBe(true);
  });

  it("does not increment the validation round for a validator-declared block", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const before = services.issueRepo.getById(issue.id)!.validation_round_count;
    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, validatorRun.id, BLOCKED_MISSING);

    services.validationWorkflowService.processValidatorResult(validatorRun.id);

    expect(services.issueRepo.getById(issue.id)!.validation_round_count).toBe(before);
  });

  it("is idempotent under duplicate/restart callbacks (one blocked event)", () => {
    const { issue, implRun, threadId } = setupFixture(services, tempDir);
    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, validatorRun.id, BLOCKED_MISSING);

    services.validationWorkflowService.processValidatorResult(validatorRun.id);
    services.validationWorkflowService.processValidatorResult(validatorRun.id); // duplicate / restart recovery re-entry

    const blockedEvents = services.threadEventRepo
      .listByThreadAndTypes(threadId, [ThreadEventType.ValidationBlocked], undefined, 50)
      .filter((e) => e.payload_json.validator_run_id === validatorRun.id);
    expect(blockedEvents.length).toBe(1);
  });
});
