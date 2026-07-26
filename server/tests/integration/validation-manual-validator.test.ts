import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ValidationWorkflowService } from "../../src/services/validation/workflow-service.js";
import {
  IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType,
  AdapterStatus, ActorType, AgentCapability,
} from "@personahub/shared/types";

/**
 * T069: proves the manual-dispatch path (ManualRoutingService -> claimValidatorSlot
 * explicit mode) produces exactly the same terminal outcomes F004's automatic
 * path does — same EvidenceSummary identity/same-origin computation, same
 * parser/gate/state machine, no separate result route. Grace is set >0 here
 * so Phase A leaves the slot unclaimed for a human to pick explicitly,
 * rather than the auto-claim that fires at grace=0 in every other test file.
 */
function createGraceWorkflowService(services: TestServices, graceMs: number): ValidationWorkflowService {
  return new ValidationWorkflowService(
    services.db, services.issueRepo, services.runRepo, services.threadEventService, services.threadEventRepo,
    services.validationTraceService, services.agentConfigRepo, services.workflowTemplateRepo,
    services.validationPolicyRepo, services.evidenceSummaryRepo, services.fileChangeRepo,
    services.adapterWorkspaceStatusRepo, graceMs,
  );
}

function setupFixture(services: TestServices, tempDir: string, cliProvider: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const implRun = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
    adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
  });
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, {
    run_id: implRun.id, summary: "Work done", completed_work: ["Task 1"], known_risks: [],
    missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false,
  });
  services.fileChangeRepo.replaceForRun(implRun.id, [
    { path: "src/file.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" },
  ], new Date().toISOString());
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.TestCompleted, ActorType.System, null, {
    run_id: implRun.id, kind: "test", result: "passed", command: "npm test",
  });

  const graceWf = createGraceWorkflowService(services, 60_000);
  graceWf.requestValidation(issue.id, implRun.id); // Phase A only: leaves the slot open for an explicit manual pick

  const validatorAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "ManualValidator", role: "validator", cli_provider: cliProvider,
    command: cliProvider, args: [], capability_tags: [AgentCapability.Validator],
    default_model: "model-x", status: AdapterStatus.Available,
  });
  return { project, issue, implAdapter, implRun, validatorAdapter };
}

function completeWith(services: TestServices, runId: string, fm: object) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(runId, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(runId, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(fm) });
}

const PASS_FM = { schema_version: 1, outcome: "passed", summary: "All good", findings: [], evidence_refs: [], missing_evidence: [], key_decisions: ["D1"], lessons_candidate: ["L1"] };
const FAIL_FM = {
  schema_version: 1, outcome: "failed", summary: "Validation found issues",
  findings: [{ severity: "error", message: "Missing error handling", suggestion: "Add try-catch", evidence_refs: [], file_path: "src/file.ts", line: 42 }],
  evidence_refs: [], missing_evidence: [], key_decisions: ["K1"], lessons_candidate: ["L1"],
};

describe("T069: manual validator dispatch (explicit adapter) pass/fail", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("manual Claude-provider validator: pass -> Done, EvidenceSummary carries the explicit adapter identity", () => {
    const { issue, implRun, implAdapter, validatorAdapter } = setupFixture(services, tempDir, "claude");

    const run = services.manualRoutingService.dispatch({
      issueId: issue.id, instructions: "please validate this round", adapterId: validatorAdapter.id,
    });
    expect(run.role).toBe(RunRole.Validator);
    expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
    expect(run.adapter_identity!.adapter_config_id).toBe(validatorAdapter.id);
    // Regression: claimValidatorSlot() must bind the frozen implementation
    // Run id so RunContextBuilder never falls back to "no prior handoff".
    expect(run.context_source_run_id).toBe(implRun.id);
    // Regression: the composer text the user sent alongside picking a
    // validator must reach the assembled prompt, not be silently dropped.
    const persisted = services.runRepo.getById(run.id)!;
    expect(persisted.instructions).toContain("## User Validation Request");
    expect(persisted.instructions).toContain("please validate this round");

    completeWith(services, run.id, PASS_FM);
    services.validationWorkflowService.processValidatorResult(run.id);

    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    const summary = services.evidenceSummaryRepo.getByIssueId(issue.id)!;
    expect(summary.validation_result).toBe("passed");
    expect(summary.implementation_run_id).toBe(implRun.id);
    expect(summary.validator_run_id).toBe(run.id);
    expect(summary.validator_identity.adapter_config_id).toBe(validatorAdapter.id);
    expect(summary.implementation_identity.adapter_config_id).toBe(implAdapter.id);
    expect(summary.same_origin_validation).toBe(false); // distinct implementation vs validator adapters
  });

  it("manual OpenCode-provider validator: fail -> round reset, findings written", () => {
    const { issue, validatorAdapter } = setupFixture(services, tempDir, "opencode");

    const run = services.manualRoutingService.dispatch({
      issueId: issue.id, instructions: "please validate this round", adapterId: validatorAdapter.id,
    });

    completeWith(services, run.id, FAIL_FM);
    services.validationWorkflowService.processValidatorResult(run.id);

    const refetched = services.issueRepo.getById(issue.id)!;
    expect(refetched.status).toBe(IssueStatus.Running);
    expect(refetched.validation_round_count).toBe(1);
    const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
    const findingEvent = events.find((e) => e.type === ThreadEventType.ValidationFinding);
    expect(findingEvent).toBeDefined();
    expect(findingEvent!.payload_json.severity).toBe("error");
    const failedEvent = events.find((e) => e.type === ThreadEventType.ValidationFailed);
    expect(failedEvent).toBeDefined();
  });

  it("a manual pick after the round's slot is already taken gets a typed 409 conflict, not a silent duplicate", () => {
    const { issue, validatorAdapter } = setupFixture(services, tempDir, "claude");
    services.manualRoutingService.dispatch({ issueId: issue.id, instructions: "first pick", adapterId: validatorAdapter.id });

    expect(() => services.manualRoutingService.dispatch({
      issueId: issue.id, instructions: "second pick", adapterId: validatorAdapter.id,
    })).toThrow(/validator run already exists/i);

    const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
    expect(validators).toHaveLength(1);
  });

  // Workspace-override design (adapter-availability.ts): explicit-mode
  // claimValidatorSlot() (design §8.2) must resolve availability the same
  // workspace-aware way resolveAdapter() does — via effectiveAdapterStatus,
  // not the raw global agent_configs.status column.
  it("an explicit validator pick succeeds via a workspace-scoped Available override even though it is globally Unknown", () => {
    const { issue, validatorAdapter } = setupFixture(services, tempDir, "claude");
    services.agentConfigRepo.update(validatorAdapter.id, { status: AdapterStatus.Unknown, updated_at: new Date().toISOString() });
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: validatorAdapter.id, workspace_id: issue.workspace_id,
      status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
    });

    const run = services.manualRoutingService.dispatch({
      issueId: issue.id, instructions: "please validate this round", adapterId: validatorAdapter.id,
    });

    expect(run.role).toBe(RunRole.Validator);
    expect(run.adapter_identity!.adapter_config_id).toBe(validatorAdapter.id);
  });

  it("an explicit validator pick is rejected via a workspace-scoped Unavailable override even though it is globally Available", () => {
    const { issue, validatorAdapter } = setupFixture(services, tempDir, "claude");
    services.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: validatorAdapter.id, workspace_id: issue.workspace_id,
      status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: "isolated workspace",
    });

    expect(() => services.manualRoutingService.dispatch({
      issueId: issue.id, instructions: "please validate this round", adapterId: validatorAdapter.id,
    })).toThrow(/not available/i);
  });
});
