import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType, AgentCapability } from "@personahub/shared/types";

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
  services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Implementation], default_model: "gpt-5", status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "gpt-5", status: AdapterStatus.Available });
  const implAdapterId = services.agentConfigRepo.listAvailableByProjectAndCapability(project.id, AgentCapability.Implementation)[0].id;
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

  it("rejects a second claim attempt as a per-round conflict (terminal, awaiting result)", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const v1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, v1.id, { note: "terminal but not yet processed" });

    // grace=0 already claimed round 1 above; a second Phase B attempt for the
    // same round (e.g. a losing manual pick racing the scheduler) must not
    // create a second validator for a round that already has one, even a
    // terminal one — design's per-round uniqueness constraint.
    const claim = services.validationWorkflowService.claimValidatorSlot(issue.id, { mode: "auto" });

    expect(claim.ok).toBe(false);
    if (!claim.ok) {
      expect(claim.reason).toBe("per_round_conflict");
      if (claim.reason === "per_round_conflict") expect(claim.conflictingRun.id).toBe(v1.id);
    }
    expect(validatorCount(services, issue.id)).toBe(1);
  });

  // BUG-003 regression: the wedge was "a validator that died without a verdict
  // holds round 1 forever". Every resultless terminal status reaches the same
  // code path, so all three are asserted — a fix that only special-cased
  // `interrupted` would leave the identical deadlock behind a cancel or a spawn
  // failure.
  for (const deadStatus of [RunStatus.Interrupted, RunStatus.Cancelled, RunStatus.Failed] as const) {
    it(`supersedes a ${deadStatus} validator with a new attempt at the same round after unblock`, () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const v1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      expect(v1.validation_round).toBe(1);
      expect(v1.validation_attempt).toBe(1);

      const now = new Date().toISOString();
      services.runRepo.transitionStatus(v1.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(v1.id, RunStatus.Running, deadStatus, { completed_at: now });
      services.validationWorkflowService.processValidatorResult(v1.id);

      // The Issue is still blocked — the operator must learn the validator died.
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      // …the round budget was not spent on an attempt that produced no verdict…
      expect(services.issueRepo.getById(issue.id)!.validation_round_count).toBe(0);
      // …and the dead run keeps its own round/attempt (PRD §7.5 immutability).
      expect(services.runRepo.getById(v1.id)!.validation_round).toBe(1);
      expect(services.runRepo.getById(v1.id)!.validation_attempt).toBe(1);

      services.validationRecoveryActionService.unblock(issue.id, "validator died, retrying");
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });

      const retry = services.validationWorkflowService.claimValidatorSlot(issue.id, { mode: "auto" });

      expect(retry.ok).toBe(true);
      if (retry.ok) {
        expect(retry.run.id).not.toBe(v1.id);
        expect(retry.run.validation_round).toBe(1);
        expect(retry.run.validation_attempt).toBe(2);
      }
      expect(validatorCount(services, issue.id)).toBe(2);
      // "Who owns round 1 now" must answer with the live attempt, not the corpse.
      expect(services.runRepo.getValidatorRunByRound(issue.id, 1)!.validation_attempt).toBe(2);
    });
  }

  it("rejects a second claim attempt as an active conflict (queued) current-round validator", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const v1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    const claim = services.validationWorkflowService.claimValidatorSlot(issue.id, { mode: "auto" });
    expect(claim.ok).toBe(false);
    if (!claim.ok) {
      expect(claim.reason).toBe("active_conflict");
      if (claim.reason === "active_conflict") expect(claim.conflictingRun.id).toBe(v1.id);
    }
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
