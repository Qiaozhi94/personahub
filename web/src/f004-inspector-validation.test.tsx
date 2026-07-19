import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  IssueStatus,
  ValidationFindingSeverity,
  ValidationOutcome,
  RunStatus,
} from "@personahub/shared";
import { ValidationInspectorSection } from "@/components/inspector/ValidationInspectorSection";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

describe("ValidationInspectorSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while fetching", () => {
    vi.mocked(apiClient.validation.getValidation).mockReturnValue(new Promise(() => {}));
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    expect(screen.getByText("Validation")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows validating state with round and max", async () => {
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1",
      status: IssueStatus.Validating,
      current_round: 2,
      completed_failed_rounds: 1,
      max_rounds: 3,
      active_validator_run: { id: "run_val", status: RunStatus.Running, started_at: null, completed_at: null, exit_code: null },
      latest_result: null,
      latest_findings: [],
      blocker: null,
      evidence_summary: null,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
    });
    expect(screen.getByText("Validating")).toBeInTheDocument();
  });

  it("shows latest findings with severity and file:line", async () => {
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1",
      status: IssueStatus.Running,
      current_round: null,
      completed_failed_rounds: 1,
      max_rounds: 3,
      active_validator_run: null,
      latest_result: null,
      latest_findings: [
        {
          validation_round: 1,
          finding_index: 0,
          severity: ValidationFindingSeverity.Error,
          message: "Missing null check in utils.ts",
          suggestion: "Add guard clause",
          evidence_refs: [],
          file_path: "src/utils.ts",
          line: 42,
          event_id: "evt_1",
          created_at: "2026-07-19T00:00:00.000Z",
        },
      ],
      blocker: null,
      evidence_summary: null,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Latest Findings")).toBeInTheDocument();
    });
    expect(screen.getByText("Missing null check in utils.ts")).toBeInTheDocument();
    expect(screen.getByText("src/utils.ts:42")).toBeInTheDocument();
  });

  it("shows blocker with reason and unblock button", async () => {
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1",
      status: IssueStatus.Blocked,
      current_round: null,
      completed_failed_rounds: 3,
      max_rounds: 3,
      active_validator_run: null,
      latest_result: null,
      latest_findings: [],
      blocker: {
        reason_code: "round_limit_reached",
        message: "Max validation rounds reached",
        event_id: "evt_block",
      },
      evidence_summary: null,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Max validation rounds reached")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /resolve blocker/i })).toBeInTheDocument();
  });

  it("shows evidence summary state when Done", async () => {
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
        created_at: "2026-07-19T00:00:00.000Z",
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
        summary_markdown: "## Evidence Summary\n\nAll good",
        same_origin_validation: true,
        implementation_identity: { adapter_config_id: "a", name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
        validator_identity: { adapter_config_id: "a", name: "Val", cli_provider: "codex", default_model: "gpt-5" },
        policy_id: "vpl_1",
        policy_version: 1,
        policy_snapshot: {
          policy_id: "vpl_1", version: 1, max_validation_rounds: 3,
          evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: [] },
        },
        policy_snapshot_hash: "sha256:abc",
        created_at: "2026-07-19T00:00:00.000Z",
      },
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Evidence Summary")).toBeInTheDocument();
    });
    expect(screen.getByText("Same-origin")).toBeInTheDocument();
  });

  it("does not show Done when evidence is missing", async () => {
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1",
      status: IssueStatus.Running,
      current_round: null,
      completed_failed_rounds: 0,
      max_rounds: 3,
      active_validator_run: null,
      latest_result: null,
      latest_findings: [],
      blocker: null,
      evidence_summary: null,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Running")).toBeInTheDocument();
    });
    expect(screen.queryByText("Evidence Summary")).not.toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    vi.mocked(apiClient.validation.getValidation).mockRejectedValue(new Error("Network error"));
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ValidationInspectorSection issueId="iss_1" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });
});
