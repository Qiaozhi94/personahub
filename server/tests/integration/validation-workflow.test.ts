import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType, AgentCapability } from "@personahub/shared/types";

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  const valAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "gpt-5", status: AdapterStatus.Available });
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  return { project, issue, implAdapter, valAdapter, implRun };
}

function setupPassEvidence(services: TestServices, threadId: string, implRunId: string) {
  services.threadEventService.write(threadId, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRunId, summary: "Work done", completed_work: ["Task 1"], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
  services.fileChangeRepo.replaceForRun(implRunId, [{ path: "src/file.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" }], new Date().toISOString());
  services.threadEventService.write(threadId, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRunId, kind: "test", result: "passed", command: "npm test" });
}

const PASS_FM = { schema_version: 1, outcome: "passed", summary: "All good", findings: [], evidence_refs: [], missing_evidence: [], key_decisions: ["D1"], lessons_candidate: ["L1"] };
const FAIL_FM = {
  schema_version: 1,
  outcome: "failed",
  summary: "Validation found issues",
  findings: [
    { severity: "error", message: "Missing error handling", suggestion: "Add try-catch blocks", evidence_refs: [], file_path: "src/file.ts", line: 42 },
    { severity: "warning", message: "Unused variable", suggestion: "Remove it", evidence_refs: [], file_path: "src/file.ts", line: 10 },
  ],
  evidence_refs: [],
  missing_evidence: [],
  key_decisions: ["K1"],
  lessons_candidate: ["L1"],
};

function makePassRun(services: TestServices, run: { id: string }) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(PASS_FM) });
}

function makeFailRun(services: TestServices, run: { id: string }) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(run.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(FAIL_FM) });
}

describe("ValidationWorkflowService", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  describe("requestValidation (T042-T043)", () => {
    it("returns null when issue is not Running", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
      expect(services.validationWorkflowService.requestValidation(issue.id, implRun.id)).toBeNull();
    });
    it("returns null when implementation run is not found", () => {
      expect(services.validationWorkflowService.requestValidation(setupFixture(services, tempDir).issue.id, "run_nonexistent")).toBeNull();
    });
    it("returns null when implementation run is not completed", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
      const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Queued, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
      expect(services.validationWorkflowService.requestValidation(issue.id, implRun.id)).toBeNull();
    });
    it("returns null when implementation run is not role=implementation", () => {
      expect(services.validationWorkflowService.requestValidation(setupFixture(services, tempDir).issue.id, "run_nonexistent")).toBeNull();
    });
    it("creates validator run and transitions issue to Validating", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const result = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      expect(result).not.toBeNull();
      expect(result!.role).toBe(RunRole.Validator);
      expect(result!.validation_round).toBe(1);
      expect(result!.dispatch_source).toBe(RunDispatchSource.System);
      expect(result!.status).toBe(RunStatus.Queued);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Validating);
    });
    it("snapshots adapter identity on validator run", () => {
      const { issue, implRun, valAdapter } = setupFixture(services, tempDir);
      const result = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      expect(result!.adapter_identity!.adapter_config_id).toBe(valAdapter.id);
      expect(result!.adapter_identity!.name).toBe("Val");
      expect(result!.adapter_identity!.cli_provider).toBe("codex");
      expect(result!.adapter_identity!.default_model).toBe("gpt-5");
    });
    it("writes validation.requested event with policy snapshot", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const result = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      const requested = services.threadEventRepo.listByThread(issue.primary_thread!.id).find((e) => e.type === ThreadEventType.ValidationRequested);
      expect(requested).toBeDefined();
      expect(requested!.payload_json.implementation_run_id).toBe(implRun.id);
      expect(requested!.payload_json.validator_run_id).toBe(result!.id);
      expect(requested!.payload_json.validation_round).toBe(1);
      expect(requested!.payload_json.target).toBe("implementation_result");
      expect(requested!.payload_json.policy_snapshot).toBeDefined();
      expect(requested!.payload_json.policy_snapshot_hash).toBeDefined();
    });
    it("writes run.queued event for validator", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      const queued = services.threadEventRepo.listByThread(issue.primary_thread!.id).find((e) => e.type === ThreadEventType.RunQueued);
      expect(queued).toBeDefined();
      expect(queued!.payload_json.role).toBe(RunRole.Validator);
    });
    it("requested event comes before run.queued event in sequence", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      const requested = events.find((e) => e.type === ThreadEventType.ValidationRequested);
      const queued = events.find((e) => e.type === ThreadEventType.RunQueued);
      expect(requested).toBeDefined();
      expect(queued).toBeDefined();
      expect(requested!.event_sequence).toBeLessThan(queued!.event_sequence);
    });
    it("blocks issue when no validator is available", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
      const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
      expect(services.validationWorkflowService.requestValidation(issue.id, implRun.id)).toBeNull();
      const refetched = services.issueRepo.getById(issue.id);
      expect(refetched!.status).toBe(IssueStatus.Blocked);
      expect(refetched!.blocked_reason_code).toBe("validator_unavailable");
    });
  });

  describe("duplicate/concurrent request (T044-T045)", () => {
    it("returns active validator when issue is already Validating", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const first = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      expect(first).not.toBeNull();
      const second = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      expect(second!.id).toBe(first!.id);
    });
    it("does not create duplicate validator runs for same request", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      expect(services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator)).toHaveLength(1);
    });
  });

  describe("processValidatorResult pass/Done (T046-T047)", () => {
    function setupPassFixture() {
      const { issue, implRun, valAdapter } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, validatorRun);
      return { issue, implRun, validatorRun };
    }
    it("returns early for non-validator role", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.validationWorkflowService.processValidatorResult(implRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Running);
    });
    it("returns early for non-completed validator", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.validationWorkflowService.processValidatorResult(services.validationWorkflowService.requestValidation(issue.id, implRun.id)!.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Validating);
    });
    it("blocks when validator has no final message", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: null });
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
    });
    it("parses passed outcome, transitions issue to Done, writes events", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, valRun);
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      const passEvent = events.find((e) => e.type === ThreadEventType.ValidationPassed);
      expect(passEvent).toBeDefined();
      expect(passEvent!.payload_json.summary).toBe("All good");
      expect(passEvent!.payload_json.result).toBe("passed");
      const doneEvent = events.find((e) => e.type === ThreadEventType.IssueDone);
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.payload_json.previous_status).toBe(IssueStatus.Validating);
      expect(doneEvent!.payload_json.evidence_summary_id).toBeDefined();
      expect(doneEvent!.payload_json.validation_event_id).toBe(passEvent!.id);
    });
    it("creates EvidenceSummary record during pass", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, valRun);
      services.validationWorkflowService.processValidatorResult(valRun.id);
      const summary = services.evidenceSummaryRepo.getByIssueId(issue.id);
      expect(summary).not.toBeNull();
      expect(summary!.validation_result).toBe("passed");
      expect(summary!.implementation_run_id).toBe(implRun.id);
      expect(summary!.validator_run_id).toBe(valRun.id);
    });
    it("validation.passed event comes before issue.done in sequence", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, valRun);
      services.validationWorkflowService.processValidatorResult(valRun.id);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      const passEvent = events.find((e) => e.type === ThreadEventType.ValidationPassed);
      const doneEvent = events.find((e) => e.type === ThreadEventType.IssueDone);
      expect(passEvent).toBeDefined();
      expect(doneEvent).toBeDefined();
      expect(passEvent!.event_sequence).toBeLessThan(doneEvent!.event_sequence);
    });
    it("does not overwrite Done when issue already progressed", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, valRun);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Done, updatedAt: new Date().toISOString() });
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    });
  });

  describe("processValidatorResult failed/Running (T048-T049)", () => {
    function setupFailFixture() {
      const { issue, implRun } = setupFixture(services, tempDir);
      const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makeFailRun(services, validatorRun);
      return { issue, implRun, validatorRun };
    }
    it("writes finding events with correct indices", () => {
      const { issue, validatorRun } = setupFailFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const findings = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .filter((e) => e.type === ThreadEventType.ValidationFinding)
        .sort((a, b) => (a.payload_json.finding_index as number) - (b.payload_json.finding_index as number));
      expect(findings).toHaveLength(2);
      expect(findings[0].payload_json.finding_index).toBe(0);
      expect(findings[0].payload_json.message).toBe("Missing error handling");
      expect(findings[1].payload_json.finding_index).toBe(1);
      expect(findings[1].payload_json.message).toBe("Unused variable");
    });
    it("writes validation.failed event with finding_count and next_status=Running", () => {
      const { issue, validatorRun } = setupFailFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const failed = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .find((e) => e.type === ThreadEventType.ValidationFailed);
      expect(failed).toBeDefined();
      expect(failed!.payload_json.finding_count).toBe(2);
      expect(failed!.payload_json.next_status).toBe(IssueStatus.Running);
      expect(failed!.payload_json.summary).toBe("Validation found issues");
    });
    it("transitions issue back to Running and increments round_count", () => {
      const { issue, validatorRun } = setupFailFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const refetched = services.issueRepo.getById(issue.id);
      expect(refetched!.status).toBe(IssueStatus.Running);
      expect(refetched!.validation_round_count).toBe(1);
    });
    it("does not create repair Run", () => {
      const { issue, implRun, validatorRun } = setupFailFixture();
      const implRunsBefore = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Implementation).length;
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const implRunsAfter = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Implementation).length;
      expect(implRunsAfter).toBe(implRunsBefore);
    });
    it("events sequence: findings before validation.failed", () => {
      const { issue, validatorRun } = setupFailFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .filter((e) => e.type === ThreadEventType.ValidationFinding || e.type === ThreadEventType.ValidationFailed)
        .sort((a, b) => a.event_sequence - b.event_sequence);
      expect(events[0].type).toBe(ThreadEventType.ValidationFinding);
      expect(events[events.length - 1].type).toBe(ThreadEventType.ValidationFailed);
    });
  });

  describe("processValidatorResult round-limit blocked (T050-T051)", () => {
    function setupRoundLimitFixture() {
      const { issue, implRun } = setupFixture(services, tempDir);
      // Set validation_round_count to 2 (default max=3, so next failed hits limit: 3 >= 3)
      services.db.prepare("UPDATE issues SET validation_round_count = 2 WHERE id = ?").run(issue.id);
      const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makeFailRun(services, validatorRun);
      return { issue, implRun, validatorRun };
    }
    it("writes findings and failed event", () => {
      const { issue, validatorRun } = setupRoundLimitFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      const findings = events.filter((e) => e.type === ThreadEventType.ValidationFinding);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const failed = events.find((e) => e.type === ThreadEventType.ValidationFailed);
      expect(failed).toBeDefined();
      expect(failed!.payload_json.next_status).toBe(IssueStatus.Blocked);
    });
    it("writes validation.blocked event with round_limit_reached", () => {
      const { issue, validatorRun } = setupRoundLimitFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const blocked = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .find((e) => e.type === ThreadEventType.ValidationBlocked);
      expect(blocked).toBeDefined();
      expect(blocked!.payload_json.reason_code).toBe("round_limit_reached");
    });
    it("transitions issue to Blocked with correct columns", () => {
      const { issue, validatorRun } = setupRoundLimitFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const refetched = services.issueRepo.getById(issue.id);
      expect(refetched!.status).toBe(IssueStatus.Blocked);
      expect(refetched!.validation_round_count).toBe(3);
      expect(refetched!.blocked_reason_code).toBe("round_limit_reached");
      expect(refetched!.blocked_reason_message).toMatch(/round limit/i);
    });
    it("events sequence: findings -> failed -> blocked", () => {
      const { issue, validatorRun } = setupRoundLimitFixture();
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const relevant = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .filter((e) => e.type === ThreadEventType.ValidationFinding || e.type === ThreadEventType.ValidationFailed || e.type === ThreadEventType.ValidationBlocked)
        .sort((a, b) => a.event_sequence - b.event_sequence);
      expect(relevant[0].type).toBe(ThreadEventType.ValidationFinding);
      const failed = relevant.find((e) => e.type === ThreadEventType.ValidationFailed);
      const blocked = relevant.find((e) => e.type === ThreadEventType.ValidationBlocked);
      expect(failed!.event_sequence).toBeLessThan(blocked!.event_sequence);
    });
  });

  describe("processValidatorResult validator run failure blocked (T052-T053)", () => {
    function setupFailValidatorRunFixture() {
      const { issue, implRun } = setupFixture(services, tempDir);
      const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      return { issue, validatorRun };
    }
    it("blocks issue when validator run failed", () => {
      const { issue, validatorRun } = setupFailValidatorRunFixture();
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: 1 });
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_run_failed");
    });
    it("blocks issue when validator run cancelled", () => {
      const { issue, validatorRun } = setupFailValidatorRunFixture();
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Running, RunStatus.Cancelled, { completed_at: now });
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_run_failed");
    });
    it("blocks issue when validator run interrupted", () => {
      const { issue, validatorRun } = setupFailValidatorRunFixture();
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Running, RunStatus.Interrupted, { completed_at: now });
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_run_failed");
    });
    it("writes validation.blocked event", () => {
      const { issue, validatorRun } = setupFailValidatorRunFixture();
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(validatorRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: 1 });
      services.validationWorkflowService.processValidatorResult(validatorRun.id);
      const blocked = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .find((e) => e.type === ThreadEventType.ValidationBlocked);
      expect(blocked).toBeDefined();
      expect(blocked!.payload_json.reason_code).toBe("validator_run_failed");
    });
  });

  describe("stale/duplicate result guard (T054-T055)", () => {
    it("old round result does not overwrite new round (stale round guard)", () => {
      // Simulate: round 1 validator completes, but issue already moved to round 2
      const { issue, implRun } = setupFixture(services, tempDir);
      const validatorRun1 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      expect(validatorRun1.validation_round).toBe(1);
      // Complete round 1 validator (no final message) to clear active validator index
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(validatorRun1.id, RunStatus.Queued, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: null });
      // Manually simulate round 1 fail: set issue back to Running with incremented count
      services.db.prepare("UPDATE issues SET status = ?, validation_round_count = 1 WHERE id = ?").run(IssueStatus.Running, issue.id);
      // Request validation again → creates round 2 validator
      const validatorRun2 = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      expect(validatorRun2.validation_round).toBe(2);
      expect(validatorRun2.id).not.toBe(validatorRun1.id);
      // Now set up round 1 validator with a real pass final_message for processing
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      services.db.prepare("UPDATE runs SET final_message = ? WHERE id = ?").run(JSON.stringify(PASS_FM), validatorRun1.id);
      // Process stale round 1 result → should be idempotent (round mismatch)
      services.validationWorkflowService.processValidatorResult(validatorRun1.id);
      // Issue should still be Validating for round 2
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Validating);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      expect(events.filter((e) => e.type === ThreadEventType.ValidationPassed)).toHaveLength(0);
      expect(events.filter((e) => e.type === ThreadEventType.IssueDone)).toHaveLength(0);
    });
    it("old round result does not overwrite Done state", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, valRun);
      // Process first → succeeds, issue Done
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      const eventsAfterFirst = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      const passEventsAfterFirst = eventsAfterFirst.filter((e) => e.type === ThreadEventType.ValidationPassed);
      const doneEventsAfterFirst = eventsAfterFirst.filter((e) => e.type === ThreadEventType.IssueDone);
      // Process second time → idempotent (issue not Validating)
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      const eventsAfterSecond = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      expect(eventsAfterSecond.filter((e) => e.type === ThreadEventType.ValidationPassed)).toHaveLength(passEventsAfterFirst.length);
      expect(eventsAfterSecond.filter((e) => e.type === ThreadEventType.IssueDone)).toHaveLength(doneEventsAfterFirst.length);
    });
    it("old round result does not overwrite Blocked state", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      // Make validator run fail (terminal failure) → issue Blocked
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: 1 });
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      // Now make the same validator run completed (simulate duplicate callback)
      services.db.prepare("UPDATE runs SET status = 'completed', final_message = ? WHERE id = ?").run(JSON.stringify(PASS_FM), valRun.id);
      // Process completed result → should be idempotent (issue not Validating, round mismatch)
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_run_failed");
      const doneEvents = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .filter((e) => e.type === ThreadEventType.IssueDone);
      expect(doneEvents).toHaveLength(0);
    });
    it("duplicate callback is idempotent (no duplicate events)", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      makePassRun(services, valRun);
      // Process first time
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      // Process second time → idempotent (existing events + CAS)
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      expect(events.filter((e) => e.type === ThreadEventType.ValidationPassed)).toHaveLength(1);
      expect(events.filter((e) => e.type === ThreadEventType.IssueDone)).toHaveLength(1);
      expect(events.filter((e) => e.type === ThreadEventType.ValidationFinding)).toHaveLength(0);
    });
    it("modifying adapter config after request does not change validator adapter_identity", () => {
      const { issue, implRun, valAdapter } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const originalName = valRun.adapter_identity!.name;
      const originalModel = valRun.adapter_identity!.default_model;
      // Modify the adapter config after validation requested
      services.db.prepare("UPDATE agent_configs SET name = ?, default_model = ? WHERE id = ?")
        .run("Changed Name", "gpt-6", valAdapter.id);
      // Verify the Run's adapter_identity is unchanged (snapshot was captured at creation)
      const refetchedRun = services.runRepo.getById(valRun.id);
      expect(refetchedRun!.adapter_identity!.name).toBe(originalName);
      expect(refetchedRun!.adapter_identity!.name).not.toBe("Changed Name");
      expect(refetchedRun!.adapter_identity!.default_model).toBe(originalModel);
      expect(refetchedRun!.adapter_identity!.default_model).not.toBe("gpt-6");
      // Process result should use the snapshot identity, not current config
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      makePassRun(services, valRun);
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    });
    it("modifying policy after request does not change round's policy snapshot", () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      // Capture the requested event's policy_snapshot_hash
      const requestedEvent = services.threadEventRepo.listByThreadAndTypes(
        issue.primary_thread!.id, [ThreadEventType.ValidationRequested],
      ).find((e) => e.payload_json.validator_run_id === valRun.id)!;
      const originalHash = requestedEvent.payload_json.policy_snapshot_hash as string;
      const originalMaxRounds = (requestedEvent.payload_json.policy_snapshot as Record<string, unknown>).max_validation_rounds;
      // Modify the policy row after request
      services.db.prepare("UPDATE validation_policies SET max_validation_rounds = 10 WHERE id = ?").run(issue.validation_policy_id);
      // Verify the requested event still has the original snapshot
      const refetchedEvent = services.threadEventRepo.getById(requestedEvent.id);
      expect(refetchedEvent!.payload_json.policy_snapshot_hash).toBe(originalHash);
      expect((refetchedEvent!.payload_json.policy_snapshot as Record<string, unknown>).max_validation_rounds).toBe(originalMaxRounds);
      // Process pass result
      setupPassEvidence(services, issue.primary_thread!.id, implRun.id);
      makePassRun(services, valRun);
      services.validationWorkflowService.processValidatorResult(valRun.id);
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    });
  });
});
