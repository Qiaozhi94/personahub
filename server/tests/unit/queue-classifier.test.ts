import { describe, it, expect } from "vitest";
import { classifyQueuedRun } from "../../src/services/queue-classifier.js";
import {
  IssueStatus,
  RunRole,
  RunStatus,
  RunDispatchSource,
  RunPurpose,
  IssueType,
  IssuePriority,
  type Issue,
  type Run,
} from "@personahub/shared/types";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue_1",
    project_id: "proj_1",
    workspace_id: "ws_1",
    primary_thread_id: null,
    issue_type: IssueType.Coding,
    workflow_template_id: "wft_1",
    validation_policy_id: "vpol_1",
    title: "T",
    goal: null,
    status: IssueStatus.Running,
    owner_agent_id: null,
    coordinator_agent_id: null,
    priority: IssuePriority.Normal,
    labels: [],
    validation_round_count: 0,
    blocked_reason_code: null,
    blocked_reason_message: null,
    validation_dispatch_due_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_1",
    issue_id: "issue_1",
    thread_id: "thread_1",
    workspace_id: "ws_1",
    adapter_config_id: "ac_1",
    status: RunStatus.Queued,
    failure_reason: null,
    instructions: "",
    started_at: null,
    completed_at: null,
    exit_code: null,
    error_message: null,
    role: RunRole.Implementation,
    workflow_step: "implementation",
    validation_round: null,
    dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: null,
    has_final_message: false,
    purpose: RunPurpose.WorkflowBound,
    context_source_run_id: null,
    node_run_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("classifyQueuedRun (T041b)", () => {
  describe("issue null", () => {
    it("returns invalid_queued_run when issue is null", () => {
      expect(classifyQueuedRun(makeRun(), null)).toBe("invalid_queued_run");
    });
  });

  describe("issue Blocked", () => {
    it("returns waiting_for_recovery for GraphNode role", () => {
      const run = makeRun({ role: RunRole.GraphNode, node_run_id: "nr_1" });
      const issue = makeIssue({ status: IssueStatus.Blocked });
      expect(classifyQueuedRun(run, issue)).toBe("waiting_for_recovery");
    });

    it("returns invalid_queued_run for Implementation role", () => {
      const run = makeRun({ role: RunRole.Implementation });
      const issue = makeIssue({ status: IssueStatus.Blocked });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });

    it("returns invalid_queued_run for Validator role", () => {
      const run = makeRun({ role: RunRole.Validator, validation_round: 1 });
      const issue = makeIssue({ status: IssueStatus.Blocked });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });

    it("returns invalid_queued_run for Consult role", () => {
      const run = makeRun({ role: RunRole.Consult });
      const issue = makeIssue({ status: IssueStatus.Blocked });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });
  });

  describe("issue Done", () => {
    it("returns invalid_queued_run for any role", () => {
      expect(
        classifyQueuedRun(makeRun({ role: RunRole.Implementation }), makeIssue({ status: IssueStatus.Done })),
      ).toBe("invalid_queued_run");
      expect(
        classifyQueuedRun(
          makeRun({ role: RunRole.Validator, validation_round: 1 }),
          makeIssue({ status: IssueStatus.Done }),
        ),
      ).toBe("invalid_queued_run");
      expect(classifyQueuedRun(makeRun({ role: RunRole.Consult }), makeIssue({ status: IssueStatus.Done }))).toBe(
        "invalid_queued_run",
      );
      expect(
        classifyQueuedRun(
          makeRun({ role: RunRole.GraphNode, node_run_id: "nr_1" }),
          makeIssue({ status: IssueStatus.Done }),
        ),
      ).toBe("invalid_queued_run");
    });
  });

  describe("Implementation role", () => {
    it.each([IssueStatus.Inbox, IssueStatus.Ready, IssueStatus.Running])(
      "returns eligible_but_not_running on %s",
      (status) => {
        const run = makeRun({ role: RunRole.Implementation });
        const issue = makeIssue({ status });
        expect(classifyQueuedRun(run, issue)).toBe("eligible_but_not_running");
      },
    );

    it("returns invalid_queued_run on Validating", () => {
      const run = makeRun({ role: RunRole.Implementation });
      const issue = makeIssue({ status: IssueStatus.Validating });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });
  });

  describe("Validator role", () => {
    it("returns eligible_but_not_running when Validating and round matches", () => {
      const run = makeRun({ role: RunRole.Validator, validation_round: 1 });
      const issue = makeIssue({ status: IssueStatus.Validating, validation_round_count: 0 });
      expect(classifyQueuedRun(run, issue)).toBe("eligible_but_not_running");
    });

    it("returns eligible_but_not_running when round is 2 and count is 1", () => {
      const run = makeRun({ role: RunRole.Validator, validation_round: 2 });
      const issue = makeIssue({ status: IssueStatus.Validating, validation_round_count: 1 });
      expect(classifyQueuedRun(run, issue)).toBe("eligible_but_not_running");
    });

    it("returns invalid_queued_run when issue is not Validating", () => {
      const run = makeRun({ role: RunRole.Validator, validation_round: 1 });
      const issue = makeIssue({ status: IssueStatus.Running });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });

    it("returns invalid_queued_run when round does not match (stale round)", () => {
      const run = makeRun({ role: RunRole.Validator, validation_round: 1 });
      const issue = makeIssue({ status: IssueStatus.Validating, validation_round_count: 2 });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });

    it("returns invalid_queued_run when round is null", () => {
      const run = makeRun({ role: RunRole.Validator, validation_round: null });
      const issue = makeIssue({ status: IssueStatus.Validating, validation_round_count: 0 });
      expect(classifyQueuedRun(run, issue)).toBe("invalid_queued_run");
    });
  });

  describe("Consult role", () => {
    it.each([IssueStatus.Inbox, IssueStatus.Ready, IssueStatus.Running, IssueStatus.Validating])(
      "returns eligible_but_not_running on %s",
      (status) => {
        const run = makeRun({ role: RunRole.Consult });
        const issue = makeIssue({ status });
        expect(classifyQueuedRun(run, issue)).toBe("eligible_but_not_running");
      },
    );
  });

  describe("GraphNode role (non-Blocked)", () => {
    it.each([IssueStatus.Inbox, IssueStatus.Ready, IssueStatus.Running, IssueStatus.Validating])(
      "returns eligible_but_not_running on %s",
      (status) => {
        const run = makeRun({ role: RunRole.GraphNode, node_run_id: "nr_1" });
        const issue = makeIssue({ status });
        expect(classifyQueuedRun(run, issue)).toBe("eligible_but_not_running");
      },
    );
  });
});
