import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActorType,
  AdapterStatus,
  FailureReason,
  IssuePriority,
  IssueStatus,
  IssueType,
  RunStatus,
  ThreadEventType,
  ThreadType,
  type AdapterConfig,
  type IssueWithThread,
  type Run,
} from "@personahub/shared";
import { AdapterSettings } from "@/components/adapter/AdapterSettings";
import { ThreadView } from "@/components/thread/ThreadView";
import { IssueInspector } from "@/components/inspector/IssueInspector";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    projects: { create: vi.fn(), list: vi.fn(), get: vi.fn() },
    workspaces: { bind: vi.fn(), getByProject: vi.fn(), getById: vi.fn() },
    issues: { create: vi.fn(), listByProject: vi.fn(), get: vi.fn() },
    threads: { get: vi.fn(), getEvents: vi.fn() },
    adapters: {
      create: vi.fn(), listByProject: vi.fn(), update: vi.fn(),
      delete: vi.fn(), validate: vi.fn(),
    },
    runs: { create: vi.fn(), get: vi.fn(), listByIssue: vi.fn(), cancel: vi.fn() },
  },
  toApiError: vi.fn((error: unknown) => ({
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown error",
  })),
}));

import { apiClient } from "@/lib/api-client";

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const adapter: AdapterConfig = {
  id: "agt_1",
  project_id: "prj_1",
  name: "Codex CLI",
  role: "implementation",
  cli_provider: "codex",
  command: "codex",
  args: ["--quiet"],
  capability_tags: [],
  default_model: "gpt-5",
  status: AdapterStatus.Available,
  last_checked_at: "2026-07-16T00:00:00.000Z",
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
};

const baseIssue: IssueWithThread = {
  id: "iss_1",
  project_id: "prj_1",
  workspace_id: "wsp_1",
  primary_thread_id: "thr_1",
  issue_type: IssueType.Coding,
  workflow_template_id: "wft_coding_default",
  validation_policy_id: "vpl_coding_default",
  title: "Implement command center",
  goal: "Run Codex from the Thread",
  status: IssueStatus.Running,
  owner_agent_id: null,
  coordinator_agent_id: null,
  priority: IssuePriority.Normal,
  labels: [],
  validation_round_count: 0,
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
  primary_thread: {
    id: "thr_1", issue_id: "iss_1", thread_type: ThreadType.Primary,
    title: "Implement command center",
  },
};

const runningRun: Run = {
  id: "run_1",
  issue_id: "iss_1",
  thread_id: "thr_1",
  workspace_id: "wsp_1",
  adapter_config_id: "agt_1",
  status: RunStatus.Running,
  failure_reason: null,
  instructions: "Implement it",
  started_at: "2026-07-16T00:01:00.000Z",
  completed_at: null,
  exit_code: null,
  error_message: null,
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:01:00.000Z",
};

describe("F002 UI flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("creates an adapter from Agent Settings", async () => {
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
    vi.mocked(apiClient.adapters.create).mockResolvedValue({ adapter });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    expect(await screen.findByText("No adapter configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure adapter" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Codex CLI" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText(/Arguments/), { target: { value: "--quiet, --json" } });
    fireEvent.change(screen.getByLabelText(/Default model/), { target: { value: "gpt-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(apiClient.adapters.create).toHaveBeenCalledWith("prj_1", {
        cli_provider: "codex",
        name: "Codex CLI",
        command: "codex",
        args: ["--quiet", "--json"],
        default_model: "gpt-5",
      });
    });
  });

  it("updates an existing adapter", async () => {
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.adapters.update).mockResolvedValue({
      adapter: { ...adapter, name: "Codex Primary", command: "codex-new" },
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Codex CLI" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Codex Primary" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "codex-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.adapters.update).toHaveBeenCalledWith("agt_1", {
        name: "Codex Primary",
        command: "codex-new",
        args: ["--quiet"],
        default_model: "gpt-5",
      });
    });
  });

  it("submits Thread instructions to the selected adapter", async () => {
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.runs.create).mockResolvedValue({ run: runningRun });

    renderWithQuery(
      <ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Inbox} projectId="prj_1" />,
    );
    const input = await screen.findByPlaceholderText("Enter agent instructions…");
    fireEvent.change(input, { target: { value: "  Implement the API  " } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(apiClient.runs.create).toHaveBeenCalledWith("iss_1", {
        instructions: "Implement the API",
        adapter_id: "agt_1",
      });
    });
  });

  it("shows Run status and logs, then cancels a running Run", async () => {
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [runningRun] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({
      events: [{
        id: "evt_out", event_sequence: 3, thread_id: "thr_1",
        type: ThreadEventType.RunOutput, actor_type: ActorType.System, actor_id: null,
        payload_json: { run_id: "run_1", stream: "stdout", sequence: 1, chunk: "Working..." },
        evidence_refs: [], created_at: "2026-07-16T00:01:01.000Z",
      }],
    });
    vi.mocked(apiClient.runs.cancel).mockResolvedValue({
      run: { ...runningRun, status: RunStatus.Cancelled, completed_at: "2026-07-16T00:02:00.000Z" },
    });

    renderWithQuery(<IssueInspector issue={baseIssue} workspacePath={"D:\\repo"} />);
    expect(await screen.findByText("Working...")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel run" }));

    await waitFor(() => {
      expect(apiClient.runs.cancel).toHaveBeenCalledWith("run_1");
    });
  });

  it("shows the escalation blocker and its capability boundary", async () => {
    const blockedIssue = { ...baseIssue, status: IssueStatus.Blocked };
    const failedRun: Run = {
      ...runningRun,
      status: RunStatus.Failed,
      failure_reason: FailureReason.PreExecutionApprovalRejected,
      completed_at: "2026-07-16T00:02:00.000Z",
      error_message: "git push origin main",
    };
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [failedRun] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });

    renderWithQuery(<IssueInspector issue={blockedIssue} workspacePath={"D:\\repo"} />);
    expect(await screen.findByText("Issue Blocked")).toBeInTheDocument();
    expect(await screen.findByText(/rejected before execution/i)).toBeInTheDocument();
    expect((await screen.findAllByText("git push origin main")).length).toBeGreaterThan(0);
  });
});
