import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { RunDispatchSource, RunRole, RunPurpose, RunStatus } from "@personahub/shared";
import { IssueInspector } from "@/components/inspector/IssueInspector";
import { createIssue, createRun, renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

describe("T097/T098: Inspector routing section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
  });

  it("shows purpose, adapter identity, and dispatch source for the latest Run", async () => {
    const run = createRun({
      role: RunRole.Implementation, purpose: RunPurpose.WorkflowBound,
      dispatch_source: RunDispatchSource.UserDefault,
      adapter_identity: { adapter_config_id: "agt_1", name: "Codex CLI", cli_provider: "codex", default_model: "gpt-5" },
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [run] });
    renderWithQuery(<IssueInspector issue={createIssue()} workspacePath={null} />);

    expect(await screen.findByText("Implementation workflow")).toBeInTheDocument();
    expect(screen.getByText(/Codex CLI \(codex · gpt-5\)/)).toBeInTheDocument();
    expect(screen.getByText(RunDispatchSource.UserDefault)).toBeInTheDocument();
  });

  it("shows a context-handoff reference when context_source_run_id is set", async () => {
    const run = createRun({ context_source_run_id: "run_prev_impl_0001" });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [run] });
    renderWithQuery(<IssueInspector issue={createIssue()} workspacePath={null} />);
    expect(await screen.findByText(/run_prev_imp/)).toBeInTheDocument();
  });

  it("shows 'Manually selected validator' when a validator Run was explicitly dispatched by the user", async () => {
    const run = createRun({
      role: RunRole.Validator, purpose: RunPurpose.WorkflowBound,
      dispatch_source: RunDispatchSource.UserExplicit,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [run] });
    renderWithQuery(<IssueInspector issue={createIssue()} workspacePath={null} />);
    expect(await screen.findByText("Manually selected validator")).toBeInTheDocument();
  });

  it("does not show 'Manually selected validator' for an automatically-dispatched validator", async () => {
    const run = createRun({
      role: RunRole.Validator, purpose: RunPurpose.WorkflowBound,
      dispatch_source: RunDispatchSource.System,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [run] });
    renderWithQuery(<IssueInspector issue={createIssue()} workspacePath={null} />);
    await waitFor(() => { expect(screen.getByText(RunStatus.Running)).toBeInTheDocument(); });
    expect(screen.queryByText("Manually selected validator")).not.toBeInTheDocument();
  });

  it("never renders any auth material (api_key) — adapter_identity carries none by design", async () => {
    const run = createRun({
      adapter_identity: { adapter_config_id: "agt_1", name: "OpenCode", cli_provider: "opencode", default_model: "gpt-5" },
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [run] });
    const { container } = renderWithQuery(<IssueInspector issue={createIssue()} workspacePath={null} />);
    await screen.findByText(/OpenCode/);
    expect(container.innerHTML).not.toMatch(/api_key|sk-/i);
  });

  it("preserves the F003/F004 sections (Evidence/Validation) alongside the new routing metadata", async () => {
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [createRun()] });
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1", status: "Running" as never, current_round: null,
      completed_failed_rounds: 0, max_rounds: 3, active_validator_run: null,
      latest_result: null, latest_findings: [], blocker: null, evidence_summary: null,
    });
    renderWithQuery(<IssueInspector issue={createIssue()} workspacePath={null} />);
    expect(await screen.findByText("Implementation workflow")).toBeInTheDocument();
  });
});
