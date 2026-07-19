import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  ThreadEventType,
  ActorType,
  RunStatus,
  RunRole,
  RunDispatchSource,
  AdapterStatus,
  IssueStatus,
  ValidationBlockReason,
  type AdapterIdentitySnapshot,
  type ThreadEvent,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";

function makeIdentity(id: string, name: string, model: string | null = "gpt-5"): AdapterIdentitySnapshot {
  return { adapter_config_id: id, name, cli_provider: "codex", default_model: model };
}

interface SetupResult {
  issueId: string;
  threadId: string;
  workspaceId: string;
  implRunId: string;
  valRunId: string;
  implAdapterId: string;
  valAdapterId: string;
}

function setupIssueWithImplAndValidatorRuns(services: TestServices, tempDir: string, round = 1): SetupResult {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  const threadId = issue.primary_thread_id!;
  const workspaceId = issue.workspace_id;

  const implAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation",
    cli_provider: "codex", command: "codex", args: [], capability_tags: [],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const valAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Val", role: "validator",
    cli_provider: "codex", command: "codex", args: [], capability_tags: [],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });

  const implRun = services.runRepo.create({
    issue_id: issue.id, thread_id: threadId, workspace_id: workspaceId,
    adapter_config_id: implAdapter.id, instructions: "do", status: RunStatus.Queued,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: makeIdentity(implAdapter.id, "Impl"),
  });
  const valRun = services.runRepo.create({
    issue_id: issue.id, thread_id: threadId, workspace_id: workspaceId,
    adapter_config_id: valAdapter.id, instructions: "validate", status: RunStatus.Queued,
    role: RunRole.Validator, dispatch_source: RunDispatchSource.System,
    validation_round: round,
    adapter_identity: makeIdentity(valAdapter.id, "Val"),
  });

  return {
    issueId: issue.id, threadId, workspaceId,
    implRunId: implRun.id, valRunId: valRun.id,
    implAdapterId: implAdapter.id, valAdapterId: valAdapter.id,
  };
}

function makeIssueLevelRef(event: ThreadEvent): string {
  return `event:${event.id}`;
}

describe("F004 T036: ValidationTraceService extensions", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => disposeTestServices(services));

  describe("existing event types keep payload contract", () => {
    it("writeRequested stores validator_run_id and implementation_run_id separately", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const event = services.validationTraceService.writeRequested({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, target: "implementation_result", policyId: "vpl_test",
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(event.type).toBe(ThreadEventType.ValidationRequested);
      expect(event.payload_json.validator_run_id).toBe(ctx.valRunId);
      expect(event.payload_json.implementation_run_id).toBe(ctx.implRunId);
      expect(event.payload_json.run_id).toBeUndefined();
      expect(event.payload_json.validation_round).toBe(1);
    });

    it("writeFinding stores finding_index and validator/implementation run ids", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const event = services.validationTraceService.writeFinding({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, severity: "error", message: "boom",
        filePath: "src/app.ts", line: 42, findingIndex: 3,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(event.type).toBe(ThreadEventType.ValidationFinding);
      expect(event.payload_json.finding_index).toBe(3);
      expect(event.payload_json.validator_run_id).toBe(ctx.valRunId);
      expect(event.payload_json.implementation_run_id).toBe(ctx.implRunId);
      expect(event.payload_json.run_id).toBeUndefined();
    });

    it("writePassed stores validator_run_id and implementation_run_id", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const event = services.validationTraceService.writePassed({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, summary: "ok", findingCount: 0,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(event.type).toBe(ThreadEventType.ValidationPassed);
      expect(event.payload_json.validator_run_id).toBe(ctx.valRunId);
      expect(event.payload_json.implementation_run_id).toBe(ctx.implRunId);
    });

    it("writeFailed stores finding_count and run ids", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const event = services.validationTraceService.writeFailed({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, summary: "fail", findingCount: 2,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(event.type).toBe(ThreadEventType.ValidationFailed);
      expect(event.payload_json.finding_count).toBe(2);
      expect(event.payload_json.validator_run_id).toBe(ctx.valRunId);
    });

    it("writeBlocked stores reason_code", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const event = services.validationTraceService.writeBlocked({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, summary: "blocked",
        reasonCode: ValidationBlockReason.ValidatorUnavailable,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(event.type).toBe(ThreadEventType.ValidationBlocked);
      expect(event.payload_json.reason_code).toBe(ValidationBlockReason.ValidatorUnavailable);
    });
  });

  describe("new event types: issue.done and issue.unblocked", () => {
    it("writeIssueDone stores previous_status, evidence_summary_id, validation_event_id", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const passed = services.validationTraceService.writePassed({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, summary: "ok", findingCount: 0,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      const done = services.validationTraceService.writeIssueDone({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, previousStatus: IssueStatus.Validating,
        evidenceSummaryId: "esm_1", validationEventId: passed.id,
        evidenceRefs: [makeIssueLevelRef(passed)],
      });
      expect(done.type).toBe(ThreadEventType.IssueDone);
      expect(done.payload_json.previous_status).toBe(IssueStatus.Validating);
      expect(done.payload_json.evidence_summary_id).toBe("esm_1");
      expect(done.payload_json.validation_event_id).toBe(passed.id);
      expect(done.payload_json.validation_round).toBe(1);
      expect(done.evidence_refs).toContain(makeIssueLevelRef(passed));
    });

    it("writeIssueUnblocked stores operator_note, previous_status, previous_block_reason", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const unblocked = services.validationTraceService.writeIssueUnblocked({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        previousStatus: IssueStatus.Blocked,
        operatorNote: "Reviewed and resolved.",
        previousBlockReason: ValidationBlockReason.ValidatorUnavailable,
      });
      expect(unblocked.type).toBe(ThreadEventType.IssueUnblocked);
      expect(unblocked.payload_json.previous_status).toBe(IssueStatus.Blocked);
      expect(unblocked.payload_json.status).toBe(IssueStatus.Ready);
      expect(unblocked.payload_json.operator_note).toBe("Reviewed and resolved.");
      expect(unblocked.payload_json.previous_block_reason).toBe(ValidationBlockReason.ValidatorUnavailable);
    });
  });

  describe("validator_run_id source validation", () => {
    it("rejects validator run belonging to a different issue", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const other = setupIssueWithImplAndValidatorRuns(services, tempDir);
      expect(() =>
        services.validationTraceService.writeRequested({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, target: "implementation_result", policyId: "vpl_test",
          validatorRunId: other.valRunId, implementationRunId: ctx.implRunId,
        }),
      ).toThrow();
    });

    it("rejects validator run with mismatched validation_round", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir, 1);
      expect(() =>
        services.validationTraceService.writePassed({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 2, summary: "ok", findingCount: 0,
          validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
        }),
      ).toThrow();
    });

    it("rejects validator run with mismatched workspace (T096)", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      let caught: unknown;
      try {
        services.validationTraceService.writePassed({
          issueId: ctx.issueId, threadId: ctx.threadId,
          workspaceId: "different-workspace",
          validationRound: 1, summary: "ok", findingCount: 0,
          validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
        });
      } catch (err) {
        caught = err;
      }
      expect((caught as { code?: string }).code).toBe(ErrorCode.EVIDENCE_SCOPE_MISMATCH);
    });

    it("rejects validator run that is not a validator role", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      expect(() =>
        services.validationTraceService.writePassed({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, summary: "ok", findingCount: 0,
          validatorRunId: ctx.implRunId, implementationRunId: ctx.implRunId,
        }),
      ).toThrow();
    });

    it("rejects implementation_run_id that does not belong to the issue", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const other = setupIssueWithImplAndValidatorRuns(services, tempDir);
      expect(() =>
        services.validationTraceService.writePassed({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, summary: "ok", findingCount: 0,
          validatorRunId: ctx.valRunId, implementationRunId: other.implRunId,
        }),
      ).toThrow();
    });
  });

  describe("independent implementation_run_id evidence scope", () => {
    it("rejects implementation-evidence ref scoped to a different run", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const other = setupIssueWithImplAndValidatorRuns(services, tempDir);
      expect(() =>
        services.validationTraceService.writePassed({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, summary: "ok", findingCount: 0,
          validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
          evidenceRefs: [`file-change-set:${other.implRunId}`],
        }),
      ).toThrow();
    });

    it("accepts file-change-set ref scoped to implementation_run_id", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      expect(() =>
        services.validationTraceService.writePassed({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, summary: "ok", findingCount: 0,
          validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
          evidenceRefs: [`file-change-set:${ctx.implRunId}`],
        }),
      ).not.toThrow();
    });
  });

  describe("issue-level ref vs run-level ref layered validation", () => {
    it("accepts issue-level ref (event:<validation.passed>) without run scope enforcement", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const passed = services.validationTraceService.writePassed({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, summary: "ok", findingCount: 0,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(() =>
        services.validationTraceService.writeIssueDone({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, previousStatus: IssueStatus.Validating,
          evidenceSummaryId: "esm_1", validationEventId: passed.id,
          evidenceRefs: [makeIssueLevelRef(passed)],
        }),
      ).not.toThrow();
    });

    it("rejects issue-level ref crossing thread boundary", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const other = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const passed = services.validationTraceService.writePassed({
        issueId: other.issueId, threadId: other.threadId, workspaceId: other.workspaceId,
        validationRound: 1, summary: "ok", findingCount: 0,
        validatorRunId: other.valRunId, implementationRunId: other.implRunId,
      });
      expect(() =>
        services.validationTraceService.writeIssueDone({
          issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
          validationRound: 1, previousStatus: IssueStatus.Validating,
          evidenceSummaryId: "esm_1", validationEventId: passed.id,
          evidenceRefs: [makeIssueLevelRef(passed)],
        }),
      ).toThrow();
    });
  });

  describe("pending broadcasts", () => {
    it("write methods do not broadcast; broadcast() sends later", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const published: ThreadEvent[] = [];
      const unsub = services.eventBus.subscribe(ctx.threadId, (e) => published.push(e));

      const requested = services.validationTraceService.writeRequested({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, target: "implementation_result", policyId: "vpl_test",
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(published).toHaveLength(0);

      services.validationTraceService.broadcast(requested);
      expect(published).toHaveLength(1);
      expect(published[0].id).toBe(requested.id);
      unsub();
    });

    it("broadcastAll sends a sequence of pending events in order", () => {
      const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
      const published: ThreadEvent[] = [];
      const unsub = services.eventBus.subscribe(ctx.threadId, (e) => published.push(e));

      const finding = services.validationTraceService.writeFinding({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, severity: "warning", message: "w", findingIndex: 0,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      const failed = services.validationTraceService.writeFailed({
        issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
        validationRound: 1, summary: "fail", findingCount: 1,
        validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
      });
      expect(published).toHaveLength(0);

      services.validationTraceService.broadcastAll([finding, failed]);
      expect(published.map((e) => e.id)).toEqual([finding.id, failed.id]);
      unsub();
    });
  });

  describe("backward compat: writes without run ids still work", () => {
    it("writeRequested without run ids succeeds (event scope only)", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      const event = services.validationTraceService.writeRequested({
        issueId: issue.id, threadId: issue.primary_thread_id!, workspaceId: issue.workspace_id,
        validationRound: 1, target: "implementation", policyId: "vpl_test",
      });
      expect(event.type).toBe(ThreadEventType.ValidationRequested);
      expect(event.payload_json.validation_round).toBe(1);
    });

    it("rejects cross-thread scope even without run ids", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      expect(() =>
        services.validationTraceService.writeRequested({
          issueId: issue.id, threadId: "other-thread", workspaceId: issue.workspace_id,
          validationRound: 1, target: "impl", policyId: "p",
        }),
      ).toThrow();
    });
  });

  it("actor is always System", () => {
    const ctx = setupIssueWithImplAndValidatorRuns(services, tempDir);
    const event = services.validationTraceService.writeBlocked({
      issueId: ctx.issueId, threadId: ctx.threadId, workspaceId: ctx.workspaceId,
      validationRound: 1, summary: "blocked",
      reasonCode: ValidationBlockReason.ValidatorUnavailable,
      validatorRunId: ctx.valRunId, implementationRunId: ctx.implRunId,
    });
    expect(event.actor_type).toBe(ActorType.System);
  });
});
