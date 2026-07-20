import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  IssueStatus,
  ThreadEventType,
  ActorType,
  RunStatus,
  RunRole,
  RunDispatchSource,
  AdapterStatus,
  ValidationOutcome,
  AgentCapability,
  type Issue,
  type AdapterIdentitySnapshot,
  type ValidationPolicySnapshot,
} from "@personahub/shared/types";
import { ValidationQueryService } from "../../src/services/validation/query.js";
import { EvidenceSummaryRepository } from "../../src/repositories/evidence-summary.js";

function makeIdentity(id: string, name: string): AdapterIdentitySnapshot {
  return { adapter_config_id: id, name, cli_provider: "codex", default_model: "gpt-5" };
}

function makePolicySnapshot(): ValidationPolicySnapshot {
  return {
    policy_id: "vpl_coding_default",
    version: 1,
    max_validation_rounds: 3,
    evidence_requirements: {
      require_handoff: true,
      require_file_trace: true,
      require_verification: true,
      accepted_verification_kinds: ["test", "lint", "typecheck", "build"],
    },
  };
}

describe("F004 T040: ValidationQueryService", () => {
  let services: TestServices;
  let tempDir: string;
  let service: ValidationQueryService;
  let projectId: string;
  let issueId: string;
  let threadId: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    const project = services.projectService.create("Test");
    projectId = project.id;
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    issueId = issue.id;
    threadId = issue.primary_thread_id!;
    const evidenceSummaryRepo = new EvidenceSummaryRepository(services.db);
    service = new ValidationQueryService(
      services.issueRepo,
      services.runRepo,
      evidenceSummaryRepo,
      services.validationPolicyRepo,
      services.threadEventRepo,
    );
  });

  afterEach(() => disposeTestServices(services));

  it("returns current_round, max_rounds, completed_failed_rounds from Issue + Policy", () => {
    services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Running, {
      validation_round_count: 2,
    });
    const result = service.getValidationStatus(issueId);
    expect(result.completed_failed_rounds).toBe(2);
    expect(result.max_rounds).toBe(3);
    expect(result.current_round).toBeNull();
    expect(result.issue_id).toBe(issueId);
  });

  it("returns active_validator_run from RunRepository.getActiveValidator", () => {
    services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Validating, {
      validation_round_count: 1,
    });
    const valConfig = services.agentConfigRepo.create({
      project_id: projectId, name: "Val", role: "validator", cli_provider: "codex",
      command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "gpt-5", status: AdapterStatus.Available,
    });
    services.runRepo.create({
      issue_id: issueId,
      thread_id: threadId,
      workspace_id: services.issueRepo.getById(issueId)!.workspace_id,
      adapter_config_id: valConfig.id,
      instructions: "validate",
      status: RunStatus.Queued,
      role: RunRole.Validator,
      dispatch_source: RunDispatchSource.System,
      validation_round: 2,
      adapter_identity: makeIdentity(valConfig.id, "Validator"),
    });
    const result = service.getValidationStatus(issueId);
    expect(result.active_validator_run).not.toBeNull();
    expect(result.active_validator_run!.id).toBeDefined();
    expect(result.active_validator_run!.status).toBe(RunStatus.Queued);
  });

  it("returns null active_validator_run when no validator is active", () => {
    const result = service.getValidationStatus(issueId);
    expect(result.active_validator_run).toBeNull();
  });

  describe("latest_result", () => {
    it("returns latest_result from validation.passed event", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationPassed, ActorType.System, null, {
        issue_id: issueId,
        thread_id: threadId,
        validation_round: 1,
        summary: "All checks passed",
        result: "passed",
        validator_run_id: "run_val",
      });
      const result = service.getValidationStatus(issueId);
      expect(result.latest_result).not.toBeNull();
      expect(result.latest_result!.outcome).toBe("passed");
      expect(result.latest_result!.summary).toBe("All checks passed");
      expect(result.latest_result!.validation_round).toBe(1);
    });

    it("returns latest_result from validation.failed event", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationFailed, ActorType.System, null, {
        issue_id: issueId,
        thread_id: threadId,
        validation_round: 1,
        summary: "Missing evidence",
        finding_count: 2,
      });
      const result = service.getValidationStatus(issueId);
      expect(result.latest_result!.outcome).toBe("failed");
      expect(result.latest_result!.finding_count).toBe(2);
    });

    it("returns latest_result from validation.blocked event", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationBlocked, ActorType.System, null, {
        issue_id: issueId,
        thread_id: threadId,
        validation_round: 1,
        summary: "Evaluator unavailable",
        reason_code: "validator_unavailable",
      });
      const result = service.getValidationStatus(issueId);
      expect(result.latest_result!.outcome).toBe("blocked");
      expect(result.latest_result!.summary).toBe("Evaluator unavailable");
    });

    it("returns latest from multiple result events (most recent)", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationFailed, ActorType.System, null, {
        validation_round: 1, issue_id: issueId, thread_id: threadId, summary: "fail1", finding_count: 1,
      });
      services.threadEventService.write(threadId, ThreadEventType.ValidationPassed, ActorType.System, null, {
        validation_round: 2, issue_id: issueId, thread_id: threadId, summary: "pass2", result: "passed",
      });
      const result = service.getValidationStatus(issueId);
      expect(result.latest_result!.outcome).toBe("passed");
      expect(result.latest_result!.validation_round).toBe(2);
    });

    it("returns null latest_result when no validation result events exist", () => {
      const result = service.getValidationStatus(issueId);
      expect(result.latest_result).toBeNull();
    });
  });

  describe("latest_findings", () => {
    function writeFinding(round: number, message: string, findingIndex = 0): void {
      services.threadEventService.write(threadId, ThreadEventType.ValidationFinding, ActorType.System, null, {
        issue_id: issueId,
        thread_id: threadId,
        validation_round: round,
        severity: "error",
        message,
        finding_index: findingIndex,
      });
    }

    it("returns findings from latest round when result event exists", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationFailed, ActorType.System, null, {
        issue_id: issueId, thread_id: threadId, validation_round: 2, summary: "fail", finding_count: 2,
      });
      writeFinding(1, "old finding");
      writeFinding(2, "latest finding 1", 0);
      writeFinding(2, "latest finding 2", 1);

      const result = service.getValidationStatus(issueId);
      expect(result.latest_findings).toHaveLength(2);
      expect(result.latest_findings.every(f => f.validation_round === 2)).toBe(true);
      expect(result.latest_findings.map(f => f.finding_index)).toEqual([0, 1]);
      expect(result.latest_findings.map(f => f.message)).toEqual(["latest finding 1", "latest finding 2"]);
    });

    it("returns empty when no findings for latest round", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationPassed, ActorType.System, null, {
        issue_id: issueId, thread_id: threadId, validation_round: 1, summary: "pass", result: "passed",
      });
      const result = service.getValidationStatus(issueId);
      expect(result.latest_findings).toHaveLength(0);
    });

    it("returns empty when no validation has occurred", () => {
      const result = service.getValidationStatus(issueId);
      expect(result.latest_findings).toEqual([]);
    });
  });

  describe("blocker", () => {
    it("returns blocker from Issue fields + latest validation.blocked event id", () => {
      services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Blocked, {
        blocked_reason_code: "validator_unavailable",
        blocked_reason_message: "No validator available",
      });
      const blockedEvent = services.threadEventService.write(threadId, ThreadEventType.ValidationBlocked, ActorType.System, null, {
        issue_id: issueId, thread_id: threadId, validation_round: 1, summary: "blocked", reason_code: "validator_unavailable",
      });
      const result = service.getValidationStatus(issueId);
      expect(result.blocker).not.toBeNull();
      expect(result.blocker!.reason_code).toBe("validator_unavailable");
      expect(result.blocker!.message).toBe("No validator available");
      expect(result.blocker!.event_id).toBe(blockedEvent.id);
    });

    it("returns null blocker when issue has no blocker reason", () => {
      services.threadEventService.write(threadId, ThreadEventType.ValidationBlocked, ActorType.System, null, {
        issue_id: issueId, thread_id: threadId, validation_round: 1, summary: "blocked",
      });
      const result = service.getValidationStatus(issueId);
      expect(result.blocker).toBeNull();
    });
  });

  describe("evidence_summary", () => {
    it("returns evidence_summary when issue is Done and summary exists", () => {
      const workspaceId = services.issueRepo.getById(issueId)!.workspace_id;
      const implAdapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Impl", role: "implementation", cli_provider: "codex",
        command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available,
      });
      const valAdapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Val", role: "validator", cli_provider: "codex",
        command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "gpt-5", status: AdapterStatus.Available,
      });
      const implRun = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapter.id, instructions: "impl", status: RunStatus.Completed,
      });
      const valRun = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapter.id, instructions: "val", status: RunStatus.Completed,
        role: RunRole.Validator, dispatch_source: RunDispatchSource.System, validation_round: 1,
        adapter_identity: makeIdentity(valAdapter.id, "Val"),
      });

      const evidenceSummaryRepo = new EvidenceSummaryRepository(services.db);
      evidenceSummaryRepo.createIfAbsent({
        issue_id: issueId, thread_id: threadId, validator_run_id: valRun.id, implementation_run_id: implRun.id,
        validation_result: ValidationOutcome.Passed, evidence_refs: [], summary_markdown: "# Summary\nDone.",
        same_origin_validation: true, implementation_identity: makeIdentity(implAdapter.id, "Impl"),
        validator_identity: makeIdentity(valAdapter.id, "Val"),
        policy_id: "vpl_coding_default", policy_version: 1,
        policy_snapshot: makePolicySnapshot(), policy_snapshot_hash: "sha256:abc",
      });
      services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Done);

      const result = service.getValidationStatus(issueId);
      expect(result.evidence_summary).not.toBeNull();
      expect(result.evidence_summary!.issue_id).toBe(issueId);
      expect(result.evidence_summary!.implementation_run_id).toBe(implRun.id);
    });

    it("returns null evidence_summary when issue is not Done", () => {
      const result = service.getValidationStatus(issueId);
      expect(result.evidence_summary).toBeNull();
    });
  });

  describe("response fields when no validation has occurred", () => {
    it("returns null for all optional fields", () => {
      const result = service.getValidationStatus(issueId);
      expect(result.current_round).toBeNull();
      expect(result.latest_result).toBeNull();
      expect(result.latest_findings).toEqual([]);
      expect(result.active_validator_run).toBeNull();
      expect(result.blocker).toBeNull();
      expect(result.evidence_summary).toBeNull();
      expect(result.status).toBe(IssueStatus.Inbox);
    });
  });

  describe("handles issues in various states", () => {
    const states: IssueStatus[] = [
      IssueStatus.Inbox,
      IssueStatus.Running,
      IssueStatus.Validating,
      IssueStatus.Done,
      IssueStatus.Blocked,
    ];

    states.forEach((status) => {
      it(`reflects status ${status}`, () => {
        if (status === IssueStatus.Validating) {
          services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Validating);
        } else if (status === IssueStatus.Done) {
          services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, IssueStatus.Done);
        } else {
          services.issueRepo.compareAndSetStatus(issueId, IssueStatus.Inbox, status);
        }
        const result = service.getValidationStatus(issueId);
        expect(result.status).toBe(status);
      });
    });
  });
});
