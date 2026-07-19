import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from "@personahub/shared/types";

const FAIL_FM = { schema_version: 1, outcome: "failed", summary: "issues", findings: [{ severity: "error", message: "X", suggestion: null, evidence_refs: [], file_path: null, line: null }], evidence_refs: [], missing_evidence: [], key_decisions: ["K"], lessons_candidate: ["L"] };

function completeWith(services: TestServices, runId: string, fm: object) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(runId, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(runId, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(fm) });
}

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  const implAdapterId = services.agentConfigRepo.listAvailableByProjectAndRole(project.id, RunRole.Implementation)[0].id;
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapterId, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapterId, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Work done", completed_work: [], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
  services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/a.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "x" }], new Date().toISOString());
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });
  return { issue, implRun };
}

function validatorCount(services: TestServices, issueId: string): number {
  return (services.db.prepare("SELECT COUNT(*) AS c FROM runs WHERE issue_id = ? AND role = 'validator'").get(issueId) as { c: number }).c;
}

describe("T093 per-round validator uniqueness", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("returns the existing current-round validator instead of creating a second (terminal, awaiting result)", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const v1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, v1.id, { note: "terminal but not yet processed" });

    const v2 = services.validationWorkflowService.requestValidation(issue.id, implRun.id);

    expect(v2).not.toBeNull();
    expect(v2!.id).toBe(v1.id);
    expect(validatorCount(services, issue.id)).toBe(1);
  });

  it("is idempotent for an active (queued) current-round validator", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const v1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    const v2 = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
    expect(v2!.id).toBe(v1.id);
    expect(validatorCount(services, issue.id)).toBe(1);
  });

  it("allows a distinct validator for the next round after a failed round", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const v1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, v1.id, FAIL_FM);
    services.validationWorkflowService.processValidatorResult(v1.id); // failed -> round++ -> Running

    const v2 = services.validationWorkflowService.requestValidation(issue.id, implRun.id);

    expect(v2).not.toBeNull();
    expect(v2!.id).not.toBe(v1.id);
    expect(v2!.validation_round).toBe(2);
    expect(validatorCount(services, issue.id)).toBe(2);
  });
});
