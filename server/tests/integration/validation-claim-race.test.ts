import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ValidationWorkflowService } from "../../src/services/validation/workflow-service.js";
import {
  IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType,
  AdapterStatus, ActorType, AgentCapability,
} from "@personahub/shared/types";

/**
 * T064/T065/T065a: since better-sqlite3 transactions run synchronously on a
 * single-threaded Node process, "manual vs scheduler" races never actually
 * interleave mid-transaction here — whichever claimValidatorSlot() call
 * commits first wins, and the second call's pre-checks (run inside its own
 * transaction) see the winner's committed state. These tests exercise both
 * orderings plus the per-round-conflict variant (T065a) where the round's
 * slot is already terminal, not just active.
 */
function createGraceWorkflowService(services: TestServices, graceMs: number): ValidationWorkflowService {
  return new ValidationWorkflowService(
    services.db, services.issueRepo, services.runRepo, services.threadEventService, services.threadEventRepo,
    services.validationTraceService, services.agentConfigRepo, services.workflowTemplateRepo,
    services.validationPolicyRepo, services.evidenceSummaryRepo, services.fileChangeRepo,
    graceMs,
  );
}

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const autoValidatorAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "AutoVal", role: "validator", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Validator],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const explicitValidatorAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "ManualVal", role: "validator", cli_provider: "claude",
    command: "claude", args: [], capability_tags: [AgentCapability.Validator],
    default_model: "model-y", status: AdapterStatus.Available,
  });
  const implRun = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
    adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
  });
  const graceWf = createGraceWorkflowService(services, 60_000);
  graceWf.requestValidation(issue.id, implRun.id); // Phase A only: leaves the slot open

  return { project, issue, implRun, autoValidatorAdapter, explicitValidatorAdapter, graceWf };
}

function completeWith(services: TestServices, runId: string, fm: object) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(runId, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(runId, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(fm) });
}

const FAIL_FM = { schema_version: 1, outcome: "failed", summary: "issues", findings: [{ severity: "error", message: "X", suggestion: null, evidence_refs: [], file_path: null, line: null }], evidence_refs: [], missing_evidence: [], key_decisions: ["K"], lessons_candidate: ["L"] };

describe("T064/T065/T065a: manual vs scheduler claimValidatorSlot race", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("T064: manual wins — explicit claim inside the grace window clears due, scheduler loser is idempotently silent", () => {
    const { issue, explicitValidatorAdapter, graceWf } = setupFixture(services, tempDir);

    const manual = services.manualRoutingService.dispatch({
      issueId: issue.id, instructions: "manual pick", adapterId: explicitValidatorAdapter.id,
    });
    expect(manual.role).toBe(RunRole.Validator);
    expect(manual.dispatch_source).toBe(RunDispatchSource.UserExplicit);
    expect(services.issueRepo.getById(issue.id)!.validation_dispatch_due_at).toBeNull();

    // scheduler-equivalent auto-claim loses the race
    const loserClaim = graceWf.claimValidatorSlot(issue.id, { mode: "auto" });
    expect(loserClaim.ok).toBe(false);
    if (!loserClaim.ok) {
      expect(loserClaim.reason).toBe("active_conflict");
      if (loserClaim.reason === "active_conflict") expect(loserClaim.conflictingRun.id).toBe(manual.id);
    }

    const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
    expect(validators).toHaveLength(1);
    const requestedEvents = services.threadEventRepo.listByThread(issue.primary_thread!.id)
      .filter((e) => e.type === ThreadEventType.ValidationRequested);
    expect(requestedEvents).toHaveLength(1);
  });

  it("T065: auto (scheduler/due-now) wins — manual loser gets a 409 VALIDATOR_RUN_CONFLICT with the active run's summary, no duplicate event", () => {
    const { issue, explicitValidatorAdapter, graceWf } = setupFixture(services, tempDir);

    const autoClaim = graceWf.claimValidatorSlot(issue.id, { mode: "auto" });
    expect(autoClaim.ok).toBe(true);
    const autoRun = autoClaim.ok ? autoClaim.run : null;
    expect(autoRun!.dispatch_source).toBe(RunDispatchSource.System);
    expect(services.issueRepo.getById(issue.id)!.validation_dispatch_due_at).toBeNull();

    let thrown: unknown;
    try {
      services.manualRoutingService.dispatch({
        issueId: issue.id, instructions: "too late", adapterId: explicitValidatorAdapter.id,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe("VALIDATOR_RUN_CONFLICT");
    expect((thrown as { details?: { conflicting_run_id?: string } }).details?.conflicting_run_id).toBe(autoRun!.id);

    const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
    expect(validators).toHaveLength(1);
    const requestedEvents = services.threadEventRepo.listByThread(issue.primary_thread!.id)
      .filter((e) => e.type === ThreadEventType.ValidationRequested);
    expect(requestedEvents).toHaveLength(1);
  });

  it("T065a: per-round conflict — once this round's validator is terminal, both manual and scheduler are rejected (no same-round retry, no undefined active/per-round confusion)", () => {
    const { issue, implRun, explicitValidatorAdapter, graceWf } = setupFixture(services, tempDir);

    const first = graceWf.claimValidatorSlot(issue.id, { mode: "auto" });
    expect(first.ok).toBe(true);
    const firstRun = first.ok ? first.run : null;
    completeWith(services, firstRun!.id, FAIL_FM);
    // terminal now, but not yet processed into a round-reset — the slot for
    // round 1 is permanently taken, active-validator query is empty (no
    // queued/running run), only the per-round check can catch this.
    expect(services.runRepo.getActiveValidator(issue.id)).toBeNull();

    const schedulerRetry = graceWf.claimValidatorSlot(issue.id, { mode: "auto" });
    expect(schedulerRetry.ok).toBe(false);
    if (!schedulerRetry.ok) {
      expect(schedulerRetry.reason).toBe("per_round_conflict");
      if (schedulerRetry.reason === "per_round_conflict") expect(schedulerRetry.conflictingRun.id).toBe(firstRun!.id);
    }

    let thrown: unknown;
    try {
      services.manualRoutingService.dispatch({
        issueId: issue.id, instructions: "same round retry", adapterId: explicitValidatorAdapter.id,
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string }).code).toBe("VALIDATOR_RUN_CONFLICT");

    const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
    expect(validators).toHaveLength(1);
    expect(services.issueRepo.getById(issue.id)!.validation_round_count).toBe(0);

    // recovery only happens through fail -> Running -> new round, never a same-round retry
    services.validationWorkflowService.processValidatorResult(firstRun!.id);
    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Running);
    const graceWf2 = createGraceWorkflowService(services, 0);
    const secondRoundRun = graceWf2.requestValidation(issue.id, implRun.id);
    expect(secondRoundRun).not.toBeNull();
    expect(secondRoundRun!.validation_round).toBe(2);
  });
});
