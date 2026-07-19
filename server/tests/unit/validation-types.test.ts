import { describe, it, expect } from "vitest";
import {
  RunRole,
  RunDispatchSource,
  AdapterRole,
  ValidationOutcome,
  ValidationBlockReason,
  IssueStatus,
  ThreadEventType,
  type Run,
  type Issue,
  type ValidationFinding,
  type ValidationResultEnvelope,
  type AdapterIdentitySnapshot,
  type ValidationEvidenceRequirements,
  type ValidationPolicySnapshot,
  type EvidenceSummary,
  type ValidationResultSummary,
  type ValidationFindingRecord,
  type IssueValidationResponse,
  type EvidenceSummaryResponse,
  type UnblockInput,
  type UnblockResponse,
  ValidationFindingSeverity,
  VerificationKind,
  type RunSummary,
} from "@personahub/shared/types";

describe("F004 Shared Validation Contract", () => {
  describe("RunRole enum", () => {
    it("has exact values from design §3", () => {
      expect(RunRole.Implementation).toBe("implementation");
      expect(RunRole.Validator).toBe("validator");
    });
  });

  describe("RunDispatchSource enum", () => {
    it("has exact values from design §3", () => {
      expect(RunDispatchSource.UserExplicit).toBe("user_explicit");
      expect(RunDispatchSource.System).toBe("system");
    });
  });

  describe("AdapterRole enum", () => {
    it("has exact values from design §3", () => {
      expect(AdapterRole.Implementation).toBe("implementation");
      expect(AdapterRole.Validator).toBe("validator");
    });
  });

  describe("ValidationOutcome enum", () => {
    it("has exact values from design §3", () => {
      expect(ValidationOutcome.Passed).toBe("passed");
      expect(ValidationOutcome.Failed).toBe("failed");
      expect(ValidationOutcome.Blocked).toBe("blocked");
    });
  });

  describe("ValidationBlockReason enum", () => {
    it("has exact values from design §3", () => {
      expect(ValidationBlockReason.ValidatorUnavailable).toBe("validator_unavailable");
      expect(ValidationBlockReason.ValidatorRunFailed).toBe("validator_run_failed");
      expect(ValidationBlockReason.ResultUnparsable).toBe("result_unparsable");
      expect(ValidationBlockReason.EvidenceMissing).toBe("evidence_missing");
      expect(ValidationBlockReason.EvidenceScopeMismatch).toBe("evidence_scope_mismatch");
      expect(ValidationBlockReason.RoundLimitReached).toBe("round_limit_reached");
      expect(ValidationBlockReason.WorkflowConfigurationInvalid).toBe("workflow_configuration_invalid");
      expect(ValidationBlockReason.RecoveryInconsistent).toBe("recovery_inconsistent");
    });
  });

  describe("Run extended fields", () => {
    it("type system includes role, workflow_step, validation_round, dispatch_source, adapter_identity", () => {
      const run: Run = {
        id: "run_1",
        issue_id: "iss_1",
        thread_id: "thr_1",
        workspace_id: "wsp_1",
        adapter_config_id: "agc_1",
        status: "queued" as never,
        failure_reason: null,
        instructions: "test",
        started_at: null,
        completed_at: null,
        exit_code: null,
        error_message: null,
        role: RunRole.Implementation,
        workflow_step: "implementation",
        validation_round: null,
        dispatch_source: RunDispatchSource.UserExplicit,
        adapter_identity: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      expect(run.role).toBe(RunRole.Implementation);
      expect(run.workflow_step).toBe("implementation");
      expect(run.validation_round).toBeNull();
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.adapter_identity).toBeNull();
    });

    it("supports validator role with validation step and round", () => {
      const run: Run = {
        id: "run_2",
        issue_id: "iss_1",
        thread_id: "thr_1",
        workspace_id: "wsp_1",
        adapter_config_id: "agc_2",
        status: "queued" as never,
        failure_reason: null,
        instructions: "validate",
        started_at: null,
        completed_at: null,
        exit_code: null,
        error_message: null,
        role: RunRole.Validator,
        workflow_step: "validation",
        validation_round: 1,
        dispatch_source: RunDispatchSource.System,
        adapter_identity: {
          adapter_config_id: "agc_2",
          name: "Codex Reviewer",
          cli_provider: "codex",
          default_model: "gpt-5",
        },
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      expect(run.role).toBe(RunRole.Validator);
      expect(run.workflow_step).toBe("validation");
      expect(run.validation_round).toBe(1);
      expect(run.dispatch_source).toBe(RunDispatchSource.System);
      expect(run.adapter_identity).not.toBeNull();
    });
  });

  describe("Issue extended fields", () => {
    it("type system includes blocked_reason_code and blocked_reason_message", () => {
      const issue: Issue = {
        id: "iss_1",
        project_id: "prj_1",
        workspace_id: "wsp_1",
        primary_thread_id: "thr_1",
        issue_type: "coding" as never,
        workflow_template_id: "wft_1",
        validation_policy_id: "vpl_1",
        title: "Test",
        goal: "Goal",
        status: IssueStatus.Blocked,
        owner_agent_id: null,
        coordinator_agent_id: null,
        priority: "normal" as never,
        labels: [],
        validation_round_count: 0,
        blocked_reason_code: ValidationBlockReason.ValidatorUnavailable,
        blocked_reason_message: "No validator configured",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      expect(issue.blocked_reason_code).toBe(ValidationBlockReason.ValidatorUnavailable);
      expect(issue.blocked_reason_message).toBe("No validator configured");
    });

    it("allows null blocked_reason fields for unblocked issues", () => {
      const issue: Issue = {
        id: "iss_2",
        project_id: "prj_1",
        workspace_id: "wsp_1",
        primary_thread_id: null,
        issue_type: "coding" as never,
        workflow_template_id: "wft_1",
        validation_policy_id: "vpl_1",
        title: "Test",
        goal: "Goal",
        status: IssueStatus.Inbox,
        owner_agent_id: null,
        coordinator_agent_id: null,
        priority: "normal" as never,
        labels: [],
        validation_round_count: 0,
        blocked_reason_code: null,
        blocked_reason_message: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      expect(issue.blocked_reason_code).toBeNull();
      expect(issue.blocked_reason_message).toBeNull();
    });

    it("allows string blocked_reason_code for forward compatibility", () => {
      const issue: Issue = {
        id: "iss_3",
        project_id: "prj_1",
        workspace_id: "wsp_1",
        primary_thread_id: null,
        issue_type: "coding" as never,
        workflow_template_id: "wft_1",
        validation_policy_id: "vpl_1",
        title: "Test",
        goal: "Goal",
        status: IssueStatus.Blocked,
        owner_agent_id: null,
        coordinator_agent_id: null,
        priority: "normal" as never,
        labels: [],
        validation_round_count: 0,
        blocked_reason_code: "custom_future_reason",
        blocked_reason_message: "Custom",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      expect(issue.blocked_reason_code).toBe("custom_future_reason");
    });
  });

  describe("ThreadEventType extended values", () => {
    it("has IssueDone = issue.done", () => {
      expect(ThreadEventType.IssueDone).toBe("issue.done");
    });

    it("has IssueUnblocked = issue.unblocked", () => {
      expect(ThreadEventType.IssueUnblocked).toBe("issue.unblocked");
    });

    it("preserves existing validation event types", () => {
      expect(ThreadEventType.ValidationRequested).toBe("validation.requested");
      expect(ThreadEventType.ValidationFinding).toBe("validation.finding");
      expect(ThreadEventType.ValidationPassed).toBe("validation.passed");
      expect(ThreadEventType.ValidationFailed).toBe("validation.failed");
      expect(ThreadEventType.ValidationBlocked).toBe("validation.blocked");
    });
  });

  describe("ValidationFinding interface", () => {
    it("has correct shape from design §3", () => {
      const finding: ValidationFinding = {
        severity: ValidationFindingSeverity.Error,
        message: "Test failed",
        suggestion: "Fix the test",
        evidence_refs: ["event:evt_1"],
        file_path: "src/test.ts",
        line: 42,
      };
      expect(finding.severity).toBe(ValidationFindingSeverity.Error);
      expect(finding.message).toBe("Test failed");
      expect(finding.suggestion).toBe("Fix the test");
      expect(finding.evidence_refs).toEqual(["event:evt_1"]);
      expect(finding.file_path).toBe("src/test.ts");
      expect(finding.line).toBe(42);
    });

    it("allows null suggestion, file_path, line", () => {
      const finding: ValidationFinding = {
        severity: ValidationFindingSeverity.Info,
        message: "Note",
        suggestion: null,
        evidence_refs: [],
        file_path: null,
        line: null,
      };
      expect(finding.suggestion).toBeNull();
      expect(finding.file_path).toBeNull();
      expect(finding.line).toBeNull();
    });
  });

  describe("ValidationResultEnvelope interface", () => {
    it("has schema_version as literal 1", () => {
      const envelope: ValidationResultEnvelope = {
        schema_version: 1,
        outcome: ValidationOutcome.Passed,
        summary: "All good",
        findings: [],
        evidence_refs: ["event:evt_1"],
        missing_evidence: [],
        key_decisions: ["decision1"],
        lessons_candidate: ["lesson1"],
      };
      expect(envelope.schema_version).toBe(1);
      expect(envelope.outcome).toBe(ValidationOutcome.Passed);
    });

    it("supports failed outcome with findings", () => {
      const envelope: ValidationResultEnvelope = {
        schema_version: 1,
        outcome: ValidationOutcome.Failed,
        summary: "Issues found",
        findings: [
          {
            severity: ValidationFindingSeverity.Blocking,
            message: "Missing test",
            suggestion: "Add test",
            evidence_refs: [],
            file_path: null,
            line: null,
          },
        ],
        evidence_refs: [],
        missing_evidence: ["test:evidence"],
        key_decisions: [],
        lessons_candidate: [],
      };
      expect(envelope.outcome).toBe(ValidationOutcome.Failed);
      expect(envelope.findings).toHaveLength(1);
    });
  });

  describe("AdapterIdentitySnapshot interface", () => {
    it("has correct shape from design §3", () => {
      const snapshot: AdapterIdentitySnapshot = {
        adapter_config_id: "agc_1",
        name: "Codex",
        cli_provider: "codex",
        default_model: "gpt-5",
      };
      expect(snapshot.adapter_config_id).toBe("agc_1");
      expect(snapshot.name).toBe("Codex");
      expect(snapshot.cli_provider).toBe("codex");
      expect(snapshot.default_model).toBe("gpt-5");
    });

    it("allows null default_model", () => {
      const snapshot: AdapterIdentitySnapshot = {
        adapter_config_id: "agc_2",
        name: "Fake",
        cli_provider: "fake",
        default_model: null,
      };
      expect(snapshot.default_model).toBeNull();
    });
  });

  describe("ValidationEvidenceRequirements interface", () => {
    it("has correct shape from design §3", () => {
      const req: ValidationEvidenceRequirements = {
        require_handoff: true,
        require_file_trace: true,
        require_verification: true,
        accepted_verification_kinds: [VerificationKind.Test, VerificationKind.Lint, VerificationKind.Typecheck, VerificationKind.Build],
      };
      expect(req.require_handoff).toBe(true);
      expect(req.require_file_trace).toBe(true);
      expect(req.require_verification).toBe(true);
      expect(req.accepted_verification_kinds).toHaveLength(4);
    });
  });

  describe("ValidationPolicySnapshot interface", () => {
    it("has correct shape from design §3", () => {
      const snapshot: ValidationPolicySnapshot = {
        policy_id: "vpl_1",
        version: 1,
        max_validation_rounds: 3,
        evidence_requirements: {
          require_handoff: true,
          require_file_trace: true,
          require_verification: true,
          accepted_verification_kinds: [VerificationKind.Test],
        },
      };
      expect(snapshot.policy_id).toBe("vpl_1");
      expect(snapshot.version).toBe(1);
      expect(snapshot.max_validation_rounds).toBe(3);
      expect(snapshot.evidence_requirements.require_handoff).toBe(true);
    });
  });

  describe("EvidenceSummary interface", () => {
    it("has correct shape from design §4.1 and §9", () => {
      const summary: EvidenceSummary = {
        id: "evs_1",
        issue_id: "iss_1",
        thread_id: "thr_1",
        validator_run_id: "run_val",
        implementation_run_id: "run_impl",
        validation_result: ValidationOutcome.Passed,
        evidence_refs: ["event:evt_pass"],
        summary_markdown: "# Summary",
        same_origin_validation: false,
        implementation_identity: {
          adapter_config_id: "agc_impl",
          name: "Codex",
          cli_provider: "codex",
          default_model: "gpt-5",
        },
        validator_identity: {
          adapter_config_id: "agc_val",
          name: "Codex Reviewer",
          cli_provider: "codex",
          default_model: "gpt-5",
        },
        policy_id: "vpl_1",
        policy_version: 1,
        policy_snapshot: {
          policy_id: "vpl_1",
          version: 1,
          max_validation_rounds: 3,
          evidence_requirements: {
            require_handoff: true,
            require_file_trace: true,
            require_verification: true,
            accepted_verification_kinds: [VerificationKind.Test],
          },
        },
        policy_snapshot_hash: "sha256:abc123",
        created_at: "2026-01-01T00:00:00Z",
      };
      expect(summary.id).toBe("evs_1");
      expect(summary.validation_result).toBe(ValidationOutcome.Passed);
      expect(summary.same_origin_validation).toBe(false);
      expect(summary.implementation_identity.adapter_config_id).toBe("agc_impl");
      expect(summary.validator_identity.adapter_config_id).toBe("agc_val");
      expect(summary.policy_snapshot_hash).toBe("sha256:abc123");
    });
  });

  describe("API DTOs", () => {
    it("IssueValidationResponse has correct shape from design §7.1", () => {
      const response: IssueValidationResponse = {
        issue_id: "iss_1",
        status: IssueStatus.Validating,
        current_round: 1,
        completed_failed_rounds: 0,
        max_rounds: 3,
        active_validator_run: null,
        latest_result: null,
        latest_findings: [],
        blocker: null,
        evidence_summary: null,
      };
      expect(response.issue_id).toBe("iss_1");
      expect(response.status).toBe(IssueStatus.Validating);
      expect(response.max_rounds).toBe(3);
    });

    it("IssueValidationResponse with full data", () => {
      const runSummary: RunSummary = {
        id: "run_1",
        status: "running" as never,
        started_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        exit_code: null,
      };
      const response: IssueValidationResponse = {
        issue_id: "iss_1",
        status: IssueStatus.Validating,
        current_round: 2,
        completed_failed_rounds: 1,
        max_rounds: 3,
        active_validator_run: runSummary,
        latest_result: {
          outcome: ValidationOutcome.Failed,
          summary: "Issues found",
          validation_round: 1,
          finding_count: 2,
          validator_run_id: "run_val_1",
          created_at: "2026-01-01T00:00:00Z",
        },
        latest_findings: [
          {
            validation_round: 1,
            finding_index: 0,
            severity: ValidationFindingSeverity.Error,
            message: "Bug",
            suggestion: null,
            evidence_refs: [],
            file_path: "src/test.ts",
            line: 10,
            event_id: "evt_1",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        blocker: {
          reason_code: ValidationBlockReason.ValidatorUnavailable,
          message: "No validator",
          event_id: "evt_2",
        },
        evidence_summary: null,
      };
      expect(response.active_validator_run).not.toBeNull();
      expect(response.latest_result?.outcome).toBe(ValidationOutcome.Failed);
      expect(response.latest_findings).toHaveLength(1);
      expect(response.blocker?.reason_code).toBe(ValidationBlockReason.ValidatorUnavailable);
    });

    it("EvidenceSummaryResponse has correct shape", () => {
      const response: EvidenceSummaryResponse = {
        evidence_summary: {
          id: "evs_1",
          issue_id: "iss_1",
          thread_id: "thr_1",
          validator_run_id: "run_val",
          implementation_run_id: "run_impl",
          validation_result: ValidationOutcome.Passed,
          evidence_refs: [],
          summary_markdown: "# Summary",
          same_origin_validation: true,
          implementation_identity: {
            adapter_config_id: "agc_1",
            name: "Codex",
            cli_provider: "codex",
            default_model: null,
          },
          validator_identity: {
            adapter_config_id: "agc_2",
            name: "Codex Reviewer",
            cli_provider: "codex",
            default_model: null,
          },
          policy_id: "vpl_1",
          policy_version: 1,
          policy_snapshot: {
            policy_id: "vpl_1",
            version: 1,
            max_validation_rounds: 3,
            evidence_requirements: {
              require_handoff: true,
              require_file_trace: true,
              require_verification: true,
              accepted_verification_kinds: [VerificationKind.Test],
            },
          },
          policy_snapshot_hash: "sha256:abc",
          created_at: "2026-01-01T00:00:00Z",
        },
      };
      expect(response.evidence_summary.id).toBe("evs_1");
    });

    it("UnblockInput has operator_note field", () => {
      const input: UnblockInput = { operator_note: "Reviewed and resolved" };
      expect(input.operator_note).toBe("Reviewed and resolved");
    });

    it("UnblockResponse has issue field", () => {
      const response: UnblockResponse = {
        issue: {
          id: "iss_1",
          project_id: "prj_1",
          workspace_id: "wsp_1",
          primary_thread_id: null,
          issue_type: "coding" as never,
          workflow_template_id: "wft_1",
          validation_policy_id: "vpl_1",
          title: "Test",
          goal: "Goal",
          status: IssueStatus.Ready,
          owner_agent_id: null,
          coordinator_agent_id: null,
          priority: "normal" as never,
          labels: [],
          validation_round_count: 1,
          blocked_reason_code: null,
          blocked_reason_message: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      };
      expect(response.issue.status).toBe(IssueStatus.Ready);
    });

    it("ValidationResultSummary has correct shape", () => {
      const summary: ValidationResultSummary = {
        outcome: ValidationOutcome.Passed,
        summary: "All checks passed",
        validation_round: 1,
        finding_count: 0,
        validator_run_id: "run_val_1",
        created_at: "2026-01-01T00:00:00Z",
      };
      expect(summary.outcome).toBe(ValidationOutcome.Passed);
      expect(summary.finding_count).toBe(0);
    });

    it("ValidationFindingRecord has correct shape", () => {
      const record: ValidationFindingRecord = {
        validation_round: 1,
        finding_index: 0,
        severity: ValidationFindingSeverity.Warning,
        message: "Warning issue",
        suggestion: "Consider fixing",
        evidence_refs: ["event:evt_1"],
        file_path: "src/test.ts",
        line: 5,
        event_id: "evt_1",
        created_at: "2026-01-01T00:00:00Z",
      };
      expect(record.validation_round).toBe(1);
      expect(record.finding_index).toBe(0);
      expect(record.severity).toBe(ValidationFindingSeverity.Warning);
    });
  });
});
