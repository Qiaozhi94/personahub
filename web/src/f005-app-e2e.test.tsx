import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import {
  AdapterAuthType, AdapterStatus, AgentCapability, CliProvider,
  IssueStatus, IssueType, IssuePriority, ThreadType, WorkspaceLockState,
} from "@personahub/shared";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

/**
 * T099: acceptance-level walkthrough through the real App shell — configure
 * multiple provider adapters, pick a non-default explicitly, dispatch both
 * a workflow-bound Run and an ad_hoc_consult Run, and confirm a manual
 * validator conflict (409 VALIDATOR_RUN_CONFLICT) surfaces as an inline
 * composer error rather than crashing the UI. The individual mechanisms
 * (adapter CRUD/default, routing preview, grace banner, Run card, Inspector
 * routing) each already have focused component-level coverage elsewhere in
 * this Phase — this file's job is to prove they compose correctly end to
 * end through the real App tree, not to re-derive each one from scratch.
 */
function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

const project = {
  id: "prj_1", name: "Multi-Agent Project", description: null,
  default_workspace_id: "wsp_1", default_coordinator_agent_id: null,
  default_adapter_config_id: "agt_codex",
  created_at: "2026-07-19T00:00:00.000Z", updated_at: "2026-07-19T00:00:00.000Z",
};

const workspace = {
  id: "wsp_1", project_id: "prj_1", local_path: "D:\\repo", git_branch: "main",
  lock_state: WorkspaceLockState.Idle, locked_by_run_id: null, locked_at: null,
  push_credentials_enabled: false, created_at: "2026-07-19T00:00:00.000Z", updated_at: "2026-07-19T00:00:00.000Z",
};

const codexAdapter = {
  id: "agt_codex", project_id: "prj_1", name: "Codex CLI", cli_provider: CliProvider.Codex,
  command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
  default_model: "gpt-5", status: AdapterStatus.Available, last_checked_at: "2026-07-19T00:00:00.000Z",
  created_at: "2026-07-19T00:00:00.000Z", updated_at: "2026-07-19T00:00:00.000Z",
  auth_type: AdapterAuthType.OAuth, model_provider: null, has_api_key: false,
  auth_status_message: null, is_default: true,
};

const claudeAdapter = {
  ...codexAdapter, id: "agt_claude", name: "Claude Code", cli_provider: CliProvider.ClaudeCode,
  command: "claude", is_default: false,
};

function makeIssue(overrides: Partial<typeof baseIssue> = {}) {
  return { ...baseIssue, ...overrides };
}

const baseIssue = {
  id: "iss_1", project_id: "prj_1", workspace_id: "wsp_1", primary_thread_id: "thr_1",
  issue_type: IssueType.Coding, workflow_template_id: "wft_coding_default", validation_policy_id: "vpl_coding_default",
  title: "Multi-agent Issue", goal: "Exercise routing", status: IssueStatus.Running,
  owner_agent_id: null, coordinator_agent_id: null, priority: IssuePriority.Normal, labels: [],
  validation_round_count: 0, blocked_reason_code: null, blocked_reason_message: null,
  validation_dispatch_due_at: null as string | null,
  created_at: "2026-07-19T00:00:00.000Z", updated_at: "2026-07-19T00:00:00.000Z",
  primary_thread: { id: "thr_1", issue_id: "iss_1", thread_type: ThreadType.Primary, title: "Multi-agent Issue" },
};

describe("T099: App acceptance flow — multi-provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [project] });
    vi.mocked(apiClient.projects.get).mockResolvedValue({ project: { ...project, default_workspace: { id: workspace.id, local_path: workspace.local_path, git_branch: workspace.git_branch, lock_state: workspace.lock_state } } });
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [codexAdapter, claudeAdapter] });
    vi.mocked(apiClient.adapters.getProviders).mockResolvedValue({ providers: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1", status: IssueStatus.Running, current_round: null,
      completed_failed_rounds: 0, max_rounds: 3, active_validator_run: null,
      latest_result: null, latest_findings: [], blocker: null, evidence_summary: null,
    });
  });

  it("dispatches an implementation Run to an explicitly-selected non-default adapter (Claude, not the Codex default)", async () => {
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [makeIssue()] });
    vi.mocked(apiClient.issues.get).mockResolvedValue({ issue: makeIssue() });
    vi.mocked(apiClient.runs.create).mockResolvedValue({ run: {} as never });

    renderApp();
    fireEvent.click(await screen.findByText("Multi-agent Issue"));

    fireEvent.change(await screen.findByLabelText("Agent"), { target: { value: "agt_claude" } });
    expect(await screen.findByText("Implementation workflow")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "Implement via Claude" } });
    fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

    await waitFor(() => {
      expect(apiClient.runs.create).toHaveBeenCalledWith("iss_1", {
        instructions: "Implement via Claude", adapter_id: "agt_claude", purpose: undefined,
      });
    });
  });

  it("dispatches an ad_hoc_consult Run without changing Issue status", async () => {
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [makeIssue()] });
    vi.mocked(apiClient.issues.get).mockResolvedValue({ issue: makeIssue() });
    vi.mocked(apiClient.runs.create).mockResolvedValue({ run: {} as never });

    renderApp();
    fireEvent.click(await screen.findByText("Multi-agent Issue"));
    await screen.findByLabelText("Agent");
    fireEvent.click(screen.getByRole("checkbox", { name: /ask \(consult\)/i }));
    expect(await screen.findByText("Consult (does not change Issue status)")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "quick question" } });
    fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

    await waitFor(() => {
      expect(apiClient.runs.create).toHaveBeenCalledWith("iss_1", expect.objectContaining({ purpose: "ad_hoc_consult" }));
    });
  });

  it("a manual validator pick that loses the race (409 VALIDATOR_RUN_CONFLICT) surfaces inline, not a crash", async () => {
    const validatingIssue = makeIssue({ status: IssueStatus.Validating, validation_dispatch_due_at: "2026-07-19T00:00:10.000Z" });
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [validatingIssue] });
    vi.mocked(apiClient.issues.get).mockResolvedValue({ issue: validatingIssue });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [codexAdapter, { ...claudeAdapter, capability_tags: [AgentCapability.Validator] }],
    });
    vi.mocked(apiClient.runs.create).mockRejectedValue({
      code: "VALIDATOR_RUN_CONFLICT",
      message: "A validator run already exists for this issue/round.",
    });

    renderApp();
    fireEvent.click(await screen.findByText("Multi-agent Issue"));
    fireEvent.change(await screen.findByLabelText("Agent"), { target: { value: "agt_claude" } });
    expect(await screen.findByText("Validator workflow")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "I'll validate this" } });
    fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("A validator run already exists for this issue/round.")).toBeInTheDocument();
    });
    // the grace banner (and the rest of the UI) must still be intact — no crash
    expect(screen.getByRole("button", { name: "Start automatic validator now" })).toBeInTheDocument();
  });
});
