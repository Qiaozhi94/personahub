import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActorType,
  FailureReason,
  IssueStatus,
  RunStatus,
  ThreadEventType,
  ThreadType,
  type IssueWithThread,
  type Run,
} from "@personahub/shared";
import { AdapterSettings } from "@/components/adapter/AdapterSettings";
import { ThreadView } from "@/components/thread/ThreadView";
import { IssueInspector } from "@/components/inspector/IssueInspector";
import {
  createAdapter,
  createIssue,
  createRun,
  renderWithQuery,
} from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const adapter = createAdapter();

const baseIssue: IssueWithThread = createIssue({
  title: "Implement command center",
  goal: "Run Codex from the Thread",
  status: IssueStatus.Running,
  primary_thread: {
    id: "thr_1",
    issue_id: "iss_1",
    thread_type: ThreadType.Primary,
    title: "Implement command center",
  },
});

const runningRun: Run = createRun();

describe("F002 UI flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(apiClient.adapters.create).toHaveBeenCalledWith("prj_1", expect.objectContaining({
        cli_provider: "codex",
        name: "Codex CLI",
        command: "codex",
        args: ["--quiet", "--json"],
        default_model: "gpt-5",
        role: "implementation",
      }));
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
      expect(apiClient.adapters.update).toHaveBeenCalledWith("agt_1", expect.objectContaining({
        name: "Codex Primary",
        command: "codex-new",
        args: ["--quiet"],
        default_model: "gpt-5",
        role: "implementation",
      }));
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
