import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType, AgentCapability } from "@personahub/shared/types";
import { ValidationRecoveryService } from "../../src/services/validation/recovery-service.js";

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Implementation], default_model: "gpt-5", status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "gpt-5", status: AdapterStatus.Available });
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  return { project, issue, implAdapter, implRun };
}

function createRecoveryService(services: TestServices): ValidationRecoveryService {
  return new ValidationRecoveryService(
    services.issueRepo,
    services.runRepo,
    services.validationWorkflowService,
    services.threadEventRepo,
    services.agentConfigRepo,
    services.db,
    services.threadEventService,
  );
}

const PASS_FM = { schema_version: 1, outcome: "passed", summary: "All good", findings: [], evidence_refs: [], missing_evidence: [], key_decisions: ["D1"], lessons_candidate: ["L1"] };

describe("ValidationRecoveryService (T060-T061)", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  describe("T060-1: Completed implementation + Issue Running + no validation", () => {
    it("calls requestValidation when impl completed but no validation requested", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      const refetched = services.issueRepo.getById(issue.id);
      expect(refetched!.status).toBe(IssueStatus.Validating);
      const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
      expect(validators).toHaveLength(1);
    });

    it("does not request validation again when already requested", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.validationWorkflowService.requestValidation(issue.id, implRun.id);
      const validatorCount = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator).length;

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      const afterCount = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator).length;
      expect(afterCount).toBe(validatorCount);
    });

    it("skips issue with no completed implementation run", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
      services.db.prepare("DELETE FROM runs WHERE id = ?").run(implRun.id);

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Running);
    });
  });

  describe("T060-2: Terminal validator + Issue Validating + no result", () => {
    function setupTerminalValidatorFixture() {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(PASS_FM) });
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Work done", completed_work: ["Task 1"], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
      services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/file.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" }], now);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });
      return { issue, implRun, valRun };
    }

    it("processes completed validator result during reconcile", async () => {
      const { issue } = setupTerminalValidatorFixture();

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    });

    it("processes failed validator during reconcile", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: 1 });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_run_failed");
    });

    it("skips validator result that already has a result event", async () => {
      const { issue } = setupTerminalValidatorFixture();
      services.validationWorkflowService.processValidatorResult(
        services.runRepo.listByIssue(issue.id).find((r) => r.role === RunRole.Validator)!.id,
      );
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      expect(events.filter((e) => e.type === ThreadEventType.ValidationPassed)).toHaveLength(1);
    });

    it("reads validation.requested event for implementation_run_id and policy snapshot", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(PASS_FM) });
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Work done", completed_work: ["Task 1"], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
      services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/file.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" }], now);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    });
  });

  describe("T060-3: Validating with no active/terminal validator", () => {
    it("reuses the validator adapter frozen by the latest request", async () => {
      const { project, issue, implRun } = setupFixture(services, tempDir);
      const frozenValidator = services.agentConfigRepo.create({
        project_id: project.id,
        name: "Frozen Val",
        role: "validator",
        cli_provider: "codex",
        command: "codex",
        args: [],
        capability_tags: [AgentCapability.Validator],
        default_model: "gpt-5",
        status: AdapterStatus.Available,
      });
      // Force a later created_at than the "Val" adapter from setupFixture:
      // both are created synchronously and can otherwise tie at millisecond
      // resolution, making the ordering assertion below flaky.
      services.db
        .prepare("UPDATE agent_configs SET created_at = ? WHERE id = ?")
        .run(new Date(Date.now() + 60_000).toISOString(), frozenValidator.id);
      const availableValidators = services.agentConfigRepo.listAvailableByProjectAndCapability(
        project.id,
        AgentCapability.Validator,
      );
      expect(availableValidators[0]?.id).not.toBe(frozenValidator.id);

      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationRequested, ActorType.System, null, {
        issue_id: issue.id, thread_id: issue.primary_thread!.id,
        validation_round: 1, target: "implementation_result",
        policy_id: "vpl_coding_default", policy_version: 1,
        implementation_run_id: implRun.id,
        validator_run_id: "__incomplete__",
        validator_adapter_config_id: frozenValidator.id,
        policy_snapshot: { policy_id: "vpl_coding_default", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: ["test"] } },
        policy_snapshot_hash: "sha256:abc",
      });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      const activeValidator = services.runRepo.getActiveValidator(issue.id);
      expect(activeValidator?.adapter_config_id).toBe(frozenValidator.id);
      expect(activeValidator?.adapter_identity?.adapter_config_id).toBe(frozenValidator.id);
      const replayedRequest = services.threadEventRepo.getLatestByTypeAndPayload(
        issue.primary_thread!.id,
        ThreadEventType.ValidationRequested,
        "validator_run_id",
        activeValidator!.id,
      );
      expect(replayedRequest?.payload_json.validator_adapter_config_id).toBe(frozenValidator.id);
    });

    it("rebuilds validator when requested event exists but creation incomplete", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationRequested, ActorType.System, null, {
        issue_id: issue.id, thread_id: issue.primary_thread!.id,
        validation_round: 1, target: "implementation_result",
        policy_id: "vpl_coding_default", policy_version: 1,
        implementation_run_id: implRun.id,
        validator_run_id: "__incomplete__",
        policy_snapshot: { policy_id: "vpl_coding_default", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: ["test"] } },
        policy_snapshot_hash: "sha256:abc",
      });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Validating);
      const activeValidator = services.runRepo.getActiveValidator(issue.id);
      expect(activeValidator).not.toBeNull();
      expect(activeValidator!.validation_round).toBe(1);
      expect(activeValidator!.instructions).toContain("## Validation Policy");
      const requestedEvent = services.threadEventRepo.getLatestByTypeAndPayload(
        issue.primary_thread!.id,
        ThreadEventType.ValidationRequested,
        "validator_run_id",
        activeValidator!.id,
      );
      expect(requestedEvent).not.toBeNull();
    });

    it("blocks issue when no validator config available", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const validators = services.agentConfigRepo.listAvailableByProjectAndCapability(issue.project_id, AgentCapability.Validator);
      for (const v of validators) {
        services.db.prepare("DELETE FROM agent_configs WHERE id = ?").run(v.id);
      }
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationRequested, ActorType.System, null, {
        issue_id: issue.id, thread_id: issue.primary_thread!.id,
        validation_round: 1, target: "implementation_result",
        policy_id: "vpl_coding_default", policy_version: 1,
        implementation_run_id: implRun.id,
        validator_run_id: "__incomplete__",
        policy_snapshot: { policy_id: "vpl_coding_default", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: ["test"] } },
        policy_snapshot_hash: "sha256:abc",
      });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_unavailable");
    });

    it("blocks issue when no requested event exists for Validating issue", async () => {
      const { issue } = setupFixture(services, tempDir);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("recovery_inconsistent");
    });

    it("blocks issue when no requested event and no completed impl run", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.db.prepare("DELETE FROM runs WHERE id = ?").run(implRun.id);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Running, IssueStatus.Validating);

      const recovery = createRecoveryService(services);
      await recovery.reconcile();

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
    });
  });

  describe("T060-4: Multiple restarts idempotent", () => {
    it("does not create duplicate validator runs across multiple reconciles", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();
      await recovery.reconcile();

      const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
      expect(validators).toHaveLength(1);
    });

    it("does not process same terminal validator result twice across reconciles", async () => {
      const { issue, implRun } = setupFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(PASS_FM) });
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Work done", completed_work: ["Task 1"], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
      services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/file.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" }], now);
      services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });

      const recovery = createRecoveryService(services);
      await recovery.reconcile();
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      const passCount = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .filter((e) => e.type === ThreadEventType.ValidationPassed).length;

      await recovery.reconcile();

      const passCount2 = services.threadEventRepo.listByThread(issue.primary_thread!.id)
        .filter((e) => e.type === ThreadEventType.ValidationPassed).length;
      expect(passCount2).toBe(passCount);
    });
  });
});
