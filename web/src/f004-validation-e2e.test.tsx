import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ActorType,
  IssueStatus,
  ThreadEventType,
  ThreadType,
  TraceCompletenessStatus,
  ValidationFindingSeverity,
  ValidationOutcome,
} from "@personahub/shared";
import type { ThreadEvent, IssueWithThread } from "@personahub/shared";
import { ThreadView } from "@/components/thread/ThreadView";
import { IssueInspector } from "@/components/inspector/IssueInspector";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const TS = "2026-07-19T00:00:00.000Z";

function makeEvent(
  overrides: Partial<ThreadEvent> & { type: string; payload_json: Record<string, unknown> },
): ThreadEvent {
  return {
    id: "evt_1",
    event_sequence: 1,
    thread_id: "thr_1",
    actor_type: ActorType.System,
    actor_id: null,
    evidence_refs: [],
    created_at: TS,
    ...overrides,
  };
}

const baseIssue: IssueWithThread = {
  id: "iss_1",
  project_id: "prj_1",
  workspace_id: "wsp_1",
  primary_thread_id: "thr_1",
  issue_type: "coding" as never,
  workflow_template_id: "wft_default",
  validation_policy_id: "vpl_default",
  title: "Build foundation",
  goal: "Foundation works",
  status: IssueStatus.Running,
  owner_agent_id: null,
  coordinator_agent_id: null,
  priority: "normal" as never,
  labels: [],
  validation_round_count: 0,
  blocked_reason_code: null,
  blocked_reason_message: null,
  created_at: TS,
  updated_at: TS,
  primary_thread: {
    id: "thr_1",
    issue_id: "iss_1",
    thread_type: ThreadType.Primary,
    title: "Build foundation",
  },
};

describe("F004 Validation E2E UI flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.traces.getIssueTrace).mockResolvedValue({
      issue: baseIssue,
      runs: [],
      events: [],
      evidence: [],
      issue_completeness: {
        commands: TraceCompletenessStatus.Complete,
        verification: TraceCompletenessStatus.Complete,
        file_changes: TraceCompletenessStatus.Complete,
        refs: TraceCompletenessStatus.Complete,
        reasons: [],
      },
      next_after_event_id: null,
    });
  });

  it("shows pass-to-Done flow: requested -> passed -> done", async () => {
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });

    const events: ThreadEvent[] = [
      makeEvent({
        id: "evt_0",
        type: ThreadEventType.IssueCreated,
        payload_json: { issue_id: "iss_1" },
      }),
      makeEvent({
        id: "evt_1",
        type: ThreadEventType.RunCompleted,
        payload_json: { run_id: "run_imp", exit_code: 0, status: "completed" },
      }),
      makeEvent({
        id: "evt_2",
        type: ThreadEventType.ValidationRequested,
        payload_json: {
          validation_round: 1,
          policy_id: "vpl_default",
          policy_version: 1,
          implementation_run_id: "run_imp",
          validator_run_id: "run_val",
        },
      }),
      makeEvent({
        id: "evt_3",
        type: ThreadEventType.ValidationPassed,
        payload_json: {
          validation_round: 1,
          summary: "All checks passed",
          finding_count: 0,
          same_origin_validation: true,
          next_status: "Done",
        },
      }),
      makeEvent({
        id: "evt_4",
        type: ThreadEventType.IssueDone,
        payload_json: {
          previous_status: "Validating",
          evidence_summary_id: "evs_1",
          validation_event_id: "evt_3",
        },
      }),
    ];
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events });

    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1",
      status: IssueStatus.Done,
      current_round: null,
      completed_failed_rounds: 0,
      max_rounds: 3,
      active_validator_run: null,
      latest_result: {
        outcome: ValidationOutcome.Passed,
        summary: "All checks passed",
        validation_round: 1,
        finding_count: 0,
        validator_run_id: "run_val",
        created_at: TS,
      },
      latest_findings: [],
      blocker: null,
      evidence_summary: {
        id: "evs_1",
        issue_id: "iss_1",
        thread_id: "thr_1",
        validator_run_id: "run_val",
        implementation_run_id: "run_imp",
        validation_result: ValidationOutcome.Passed,
        evidence_refs: [],
        summary_markdown: "# Summary",
        same_origin_validation: true,
        implementation_identity: { adapter_config_id: "a", name: "Imp", cli_provider: "codex", default_model: "gpt-5" },
        validator_identity: { adapter_config_id: "a", name: "Val", cli_provider: "codex", default_model: "gpt-5" },
        policy_id: "vpl_default",
        policy_version: 1,
        policy_snapshot: {
          policy_id: "vpl_default", version: 1, max_validation_rounds: 3,
          evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: [] },
        },
        policy_snapshot_hash: "sha256:abc",
        created_at: TS,
      },
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Done} projectId="prj_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("issue.created")).toBeInTheDocument();
    });
    expect(screen.getByText("run.completed")).toBeInTheDocument();
    expect(screen.getByText("Validation requested")).toBeInTheDocument();
    expect(screen.getByText("Validation passed")).toBeInTheDocument();
    expect(screen.getByText("Issue Done")).toBeInTheDocument();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IssueInspector issue={{ ...baseIssue, status: IssueStatus.Done }} workspacePath="D:\\repo" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Evidence Summary")).toBeInTheDocument();
    });
    expect(screen.getByText("Same-origin")).toBeInTheDocument();
  });

  it("shows fail-to-findings-to-blocked flow", async () => {
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });

    const events: ThreadEvent[] = [
      makeEvent({
        id: "evt_0",
        type: ThreadEventType.IssueCreated,
        payload_json: { issue_id: "iss_1" },
      }),
      makeEvent({
        id: "evt_1",
        type: ThreadEventType.ValidationRequested,
        payload_json: { validation_round: 3, implementation_run_id: "run_imp" },
      }),
      makeEvent({
        id: "evt_2",
        type: ThreadEventType.ValidationFinding,
        payload_json: {
          validation_round: 3,
          severity: ValidationFindingSeverity.Blocking,
          message: "Missing critical tests",
          file_path: "src/core.ts",
          line: 10,
          finding_index: 0,
        },
      }),
      makeEvent({
        id: "evt_3",
        type: ThreadEventType.ValidationFailed,
        payload_json: {
          validation_round: 3,
          summary: "1 blocking finding",
          finding_count: 1,
          next_status: "Blocked",
        },
      }),
      makeEvent({
        id: "evt_4",
        type: ThreadEventType.ValidationBlocked,
        payload_json: {
          validation_round: 3,
          reason_code: "round_limit_reached",
          summary: "Max validation rounds reached",
          next_status: "Blocked",
        },
      }),
    ];
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Blocked} projectId="prj_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Validation finding")).toBeInTheDocument();
    });
    expect(screen.getByText("Validation failed")).toBeInTheDocument();
    expect(screen.getByText("Validation blocked")).toBeInTheDocument();

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IssueInspector
          issue={{ ...baseIssue, status: IssueStatus.Blocked, blocked_reason_code: "round_limit_reached", blocked_reason_message: "Max validation rounds reached" }}
          workspacePath="D:\\repo"
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Issue Blocked")).toBeInTheDocument();
    });
  });
});
