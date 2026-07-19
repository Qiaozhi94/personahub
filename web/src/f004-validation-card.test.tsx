import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActorType, ThreadEventType, ValidationFindingSeverity } from "@personahub/shared";
import type { ThreadEvent } from "@personahub/shared";
import { ValidationTraceCard } from "@/components/trace/ValidationTraceCard";

const BASE_EVENT: Omit<ThreadEvent, "type" | "payload_json"> = {
  id: "evt_1",
  event_sequence: 1,
  thread_id: "thr_1",
  actor_type: ActorType.System,
  actor_id: null,
  evidence_refs: [],
  created_at: "2026-07-19T00:00:00.000Z",
};

describe("ValidationTraceCard", () => {
  it("renders validation.requested with round, validator, policy", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationRequested,
      payload_json: {
        validation_round: 1,
        validator_adapter_config_id: "agt_val",
        policy_id: "vpl_coding_default",
        policy_version: 1,
        policy_snapshot_hash: "sha256:abc",
        implementation_run_id: "run_imp",
        validator_run_id: "run_val",
        target: "implementation_result",
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Validation requested")).toBeInTheDocument();
    expect(screen.getByText("round 1")).toBeInTheDocument();
    expect(screen.getByText("policy: vpl_coding_default v1")).toBeInTheDocument();
  });

  it("renders validation.finding with severity, message, file:line", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationFinding,
      payload_json: {
        validation_round: 1,
        severity: ValidationFindingSeverity.Error,
        message: "Missing null check",
        suggestion: "Add if (x != null) guard",
        file_path: "src/utils.ts",
        line: 42,
        finding_index: 0,
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Validation finding")).toBeInTheDocument();
    expect(screen.getByText(ValidationFindingSeverity.Error)).toBeInTheDocument();
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
    expect(screen.getByText("Suggestion: Add if (x != null) guard")).toBeInTheDocument();
    expect(screen.getByText("src/utils.ts:42")).toBeInTheDocument();
  });

  it("renders validation.finding with Warning severity", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationFinding,
      payload_json: {
        validation_round: 1,
        severity: ValidationFindingSeverity.Warning,
        message: "Consider using const",
        suggestion: null,
        file_path: null,
        line: null,
        finding_index: 0,
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText(ValidationFindingSeverity.Warning)).toBeInTheDocument();
  });

  it("renders validation.passed with summary and same-origin badge", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationPassed,
      payload_json: {
        validation_round: 1,
        summary: "All checks passed",
        finding_count: 0,
        same_origin_validation: true,
        validator_run_id: "run_val",
        implementation_run_id: "run_imp",
        next_status: "Done",
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Validation passed")).toBeInTheDocument();
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("All checks passed")).toBeInTheDocument();
    expect(screen.getByText("Same-origin")).toBeInTheDocument();
  });

  it("renders validation.failed with findings count", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationFailed,
      payload_json: {
        validation_round: 1,
        summary: "3 issues found",
        finding_count: 3,
        next_status: "Running",
        validator_run_id: "run_val",
        implementation_run_id: "run_imp",
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Validation failed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("3 issues found")).toBeInTheDocument();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.getByText("→ Running")).toBeInTheDocument();
  });

  it("renders validation.blocked with reason", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationBlocked,
      payload_json: {
        validation_round: 1,
        reason_code: "round_limit_reached",
        summary: "Max validation rounds reached",
        next_status: "Blocked",
        validator_run_id: null,
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Validation blocked")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText("Max validation rounds reached")).toBeInTheDocument();
    expect(screen.getByText("round_limit_reached")).toBeInTheDocument();
  });

  it("renders issue.done with evidence summary link", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.IssueDone,
      payload_json: {
        previous_status: "Validating",
        evidence_summary_id: "evs_1",
        validation_event_id: "evt_pass",
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Issue Done")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
    expect(screen.getByText("Evidence Summary")).toBeInTheDocument();
  });

  it("renders issue.unblocked with operator note", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.IssueUnblocked,
      payload_json: {
        previous_status: "Blocked",
        status: "Ready",
        operator_note: "Fixed validator configuration",
        previous_block_reason: "validator_unavailable",
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Issue Unblocked")).toBeInTheDocument();
    expect(screen.getByText("→ Ready")).toBeInTheDocument();
    expect(screen.getByText("Fixed validator configuration")).toBeInTheDocument();
  });

  it("renders generic fallback for unknown validation event payload", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationRequested,
      payload_json: { custom_field: 123 } as never,
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Validation requested")).toBeInTheDocument();
  });

  it("shows same-origin badge for non-same-origin (independent validation)", () => {
    const event: ThreadEvent = {
      ...BASE_EVENT,
      type: ThreadEventType.ValidationPassed,
      payload_json: {
        validation_round: 1,
        summary: "Passed",
        finding_count: 0,
        same_origin_validation: false,
        validator_run_id: "run_val",
        implementation_run_id: "run_imp",
        next_status: "Done",
      },
    };
    render(<ValidationTraceCard event={event} />);

    expect(screen.getByText("Independent")).toBeInTheDocument();
  });
});
