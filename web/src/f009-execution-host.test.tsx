import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import {
  AdapterAuthType,
  AdapterStatus,
  AgentCapability,
  IssuePriority,
  IssueStatus,
  IssueType,
  ThreadType,
} from "@personahub/shared";

// T011 (A006–A015): the execution host on /tasks/:taskId mounts the thread
// view (A008/A009/A010/A012–A015) with composer drafts owned by the shell
// store (UX-004), and /tasks hosts the intake recommend/confirm flow
// (A006/A007). Each write still goes through the canonical API.

const TIMESTAMP = "2026-07-16T00:00:00.000Z";

function issueWithThread(id: string, title: string, status: IssueStatus) {
  return {
    id,
    project_id: "prj_a",
    workspace_id: "ws_a",
    primary_thread_id: `thr_${id}`,
    primary_thread: {
      id: `thr_${id}`,
      issue_id: id,
      thread_type: ThreadType.Primary,
      title,
      room_id: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    },
    issue_type: IssueType.Coding,
    workflow_template_id: "wft_coding_default",
    validation_policy_id: "vpl_coding_default",
    title,
    goal: "目标",
    status,
    owner_agent_id: null,
    coordinator_agent_id: null,
    priority: IssuePriority.Normal,
    labels: [],
    validation_round_count: 0,
    blocked_reason_code: null,
    blocked_reason_message: null,
    validation_dispatch_due_at: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function project(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    default_workspace_id: null,
    default_coordinator_agent_id: null,
    default_adapter_config_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function renderApp(path = "/"): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  window.history.replaceState(null, "", path);
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

/** Navigates like a real History traversal: pushState + popstate replay. */
function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [project("prj_a", "项目甲")] });
  vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
  vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
  vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
  vi.mocked(apiClient.issues.getGraph).mockResolvedValue({ current: null, history: [] });
});

describe("composer drafts owned by the shell (UX-004)", () => {
  it("keeps a task's draft while visiting another task, then restores it", async () => {
    vi.mocked(apiClient.issues.get).mockImplementation(async (id: string) => ({
      issue: issueWithThread(id, `任务 ${id}`, IssueStatus.Running),
    }));
    renderApp("/tasks/iss_1");

    const composer = await screen.findByPlaceholderText("Enter agent instructions…");
    fireEvent.change(composer, { target: { value: "iss1 的草稿" } });
    expect(composer).toHaveValue("iss1 的草稿");

    navigate("/tasks/iss_2");
    await waitFor(() => {
      // Re-query each poll: the previous task's composer is unmounted during
      // the transition and findBy would otherwise pin the detached node.
      expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("");
    });
    expect(await screen.findByRole("heading", { name: "任务 iss_2" })).toBeInTheDocument();

    navigate("/tasks/iss_1");
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("iss1 的草稿");
    });
  });

  it("clears the draft on a matching success and keeps it on failure", async () => {
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: issueWithThread("iss_1", "任务一", IssueStatus.Running),
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [
        {
          id: "agt_1",
          project_id: "prj_a",
          name: "Codex",
          cli_provider: "codex",
          command: "codex",
          args: [],
          capability_tags: [AgentCapability.Implementation],
          default_model: null,
          status: AdapterStatus.Available,
          last_checked_at: TIMESTAMP,
          auth_type: AdapterAuthType.OAuth,
          model_provider: null,
          has_api_key: false,
          auth_status_message: null,
          is_default: true,
          created_at: TIMESTAMP,
          updated_at: TIMESTAMP,
        },
      ],
    });
    renderApp("/tasks/iss_1");

    const composer = await screen.findByPlaceholderText("Enter agent instructions…");
    fireEvent.change(composer, { target: { value: "派工指令" } });

    // Failure keeps the record and the selection.
    vi.mocked(apiClient.runs.create).mockRejectedValue({ code: "RUN_CONFLICT", message: "conflict" });
    fireEvent.submit(composer.closest("form")!);
    await screen.findByText("conflict");
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("派工指令");

    // A matching success clears exactly the submitted version.
    vi.mocked(apiClient.runs.create).mockResolvedValue({ run: {} } as never);
    fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("");
    });
  });

  it("keeps the draft when a late success no longer matches the revision", async () => {
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: issueWithThread("iss_1", "任务一", IssueStatus.Running),
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [
        {
          id: "agt_1",
          project_id: "prj_a",
          name: "Codex",
          cli_provider: "codex",
          command: "codex",
          args: [],
          capability_tags: [AgentCapability.Implementation],
          default_model: null,
          status: AdapterStatus.Available,
          last_checked_at: TIMESTAMP,
          auth_type: AdapterAuthType.OAuth,
          model_provider: null,
          has_api_key: false,
          auth_status_message: null,
          is_default: true,
          created_at: TIMESTAMP,
          updated_at: TIMESTAMP,
        },
      ],
    });
    // Hold the response so the submit stays pending while we keep typing.
    let releaseSuccess: (() => void) | undefined;
    vi.mocked(apiClient.runs.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSuccess = () => resolve({ run: {} } as never);
        }),
    );
    renderApp("/tasks/iss_1");

    const composer = await screen.findByPlaceholderText("Enter agent instructions…");
    const user = userEvent.setup();
    await user.type(composer, "第一版");
    fireEvent.submit(composer.closest("form")!);
    await user.type(screen.getByPlaceholderText("Enter agent instructions…"), "，又补充了一句");
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("第一版，又补充了一句");

    // The old ticket's success arrives: it must not clear the newer revision.
    releaseSuccess?.();
    await waitFor(() => {
      expect(apiClient.runs.create).toHaveBeenCalledOnce();
    });
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("第一版，又补充了一句");
  });
});

describe("intake host on /tasks (A006/A007)", () => {
  it("opens the recommend flow from the task board without writing anything", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({
      issues: [issueWithThread("iss_1", "任务一", IssueStatus.Running)],
    });
    renderApp("/tasks?project=prj_a");

    await user.click(await screen.findByRole("button", { name: "推荐创建" }));

    const dialog = await screen.findByRole("dialog", { name: "Intake" });
    expect(dialog).toBeInTheDocument();
    expect(apiClient.intake.recommend).not.toHaveBeenCalled();
    expect(apiClient.intake.confirm).not.toHaveBeenCalled();
  });
});

describe("facts host on /tasks/:taskId (A011, A016–A024)", () => {
  it("renders the inspector facts and keeps validation writes canonical", async () => {
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: issueWithThread("iss_1", "任务一", IssueStatus.Running),
    });
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });
    renderApp("/tasks/iss_1");

    // The facts host renders the inspector with task, run and validation
    // facts; trace/validation queries stay pending in this assertion.
    expect(await screen.findByRole("heading", { name: "任务一" })).toBeInTheDocument();
    expect(await screen.findByText("Issue Inspector")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});

describe("review R1-002/R1-003 regressions", () => {
  const codexAdapter = {
    id: "agt_codex",
    project_id: "prj_a",
    name: "Codex",
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: ["implementation"] as never,
    default_model: null,
    status: "available" as never,
    last_checked_at: TIMESTAMP,
    auth_type: "oauth" as never,
    model_provider: null,
    has_api_key: false,
    auth_status_message: null,
    is_default: true,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
  const claudeAdapter = { ...codexAdapter, id: "agt_claude", name: "Claude", is_default: false };

  function primeAdapterMocks(): void {
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [codexAdapter, claudeAdapter],
    });
    vi.mocked(apiClient.runs.create).mockResolvedValue({ run: {} } as never);
  }

  it("keeps adapter and consult selection per task key across cached navigations", async () => {
    primeAdapterMocks();
    vi.mocked(apiClient.issues.get).mockImplementation(async (id: string) => ({
      issue: issueWithThread(id, `任务 ${id}`, IssueStatus.Running),
    }));
    renderApp("/tasks/iss_1");

    const select = await screen.findByLabelText("Agent");
    await userEvent.selectOptions(select, "agt_claude");
    await userEvent.click(screen.getByRole("checkbox", { name: "Ask (consult)" }));
    fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), {
      target: { value: "iss1 指令" },
    });

    navigate("/tasks/iss_2");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent")).toHaveValue("");
    });
    fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), {
      target: { value: "iss2 指令" },
    });
    expect(screen.getByRole("checkbox", { name: "Ask (consult)" })).not.toBeChecked();

    navigate("/tasks/iss_1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent")).toHaveValue("agt_claude");
    });
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("iss1 指令");
    expect(screen.getByRole("checkbox", { name: "Ask (consult)" })).toBeChecked();

    // Submitting on iss_2 posts iss_2's own selection, never iss_1's.
    navigate("/tasks/iss_2");
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("iss2 指令");
    });
    fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);
    await waitFor(() => {
      expect(apiClient.runs.create).toHaveBeenCalled();
    });
    const firstCreateCall = vi.mocked(apiClient.runs.create).mock.calls[0]!;
    const payload = firstCreateCall[1];
    // iss_2 has no explicit selection: the payload must not carry iss_1's
    // claude pick — the server resolves the project default instead.
    expect(payload.adapter_id).toBeUndefined();
    expect(payload.purpose).toBeUndefined();
  });

  it("offers a production discard action that clears the draft and survives late responses", async () => {
    primeAdapterMocks();
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: issueWithThread("iss_1", "任务一", IssueStatus.Running),
    });
    let releaseSuccess: (() => void) | undefined;
    vi.mocked(apiClient.runs.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSuccess = () => resolve({ run: {} } as never);
        }),
    );
    renderApp("/tasks/iss_1");

    const composer = await screen.findByPlaceholderText("Enter agent instructions…");
    await userEvent.type(composer, "待丢弃的指令");
    expect(screen.getByRole("button", { name: "丢弃草稿" })).toBeInTheDocument();

    fireEvent.submit(composer.closest("form")!);
    // Discard stays available while the submit is pending.
    await screen.findByRole("button", { name: "丢弃草稿" });
    await userEvent.click(screen.getByRole("button", { name: "丢弃草稿" }));
    expect(screen.queryByRole("button", { name: "丢弃草稿" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("");

    // The superseded success response must not resurrect or clear anything.
    releaseSuccess?.();
    await waitFor(() => expect(apiClient.runs.create).toHaveBeenCalledOnce());
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toHaveValue("");
  });

  it("keeps the graph dialog open with its error on failure and closes only on success", async () => {
    primeAdapterMocks();
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: issueWithThread("iss_empty", "空白任务", IssueStatus.Inbox),
    });
    renderApp("/tasks/iss_empty");

    await screen.findByRole("button", { name: "Start Graph" }).then((button) => userEvent.click(button));
    const dialog = await screen.findByRole("dialog", { name: "Start dual-review graph" });
    const selects = within(dialog).getAllByRole("combobox");
    for (const select of selects) {
      await userEvent.selectOptions(select, "agt_codex");
    }

    vi.mocked(apiClient.issues.startGraph).mockRejectedValueOnce({ code: "GRAPH_CONFLICT", message: "graph conflict" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start Graph" }));
    expect(await screen.findByText("graph conflict")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Start dual-review graph" })).toBeInTheDocument();

    vi.mocked(apiClient.issues.startGraph).mockResolvedValueOnce({ graph_run_id: "grun_1" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Start Graph" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Start dual-review graph" })).not.toBeInTheDocument();
    });
    expect(apiClient.issues.startGraph).toHaveBeenCalledTimes(2);
  });

  it("retries a failed thread-events load for real (review R2-CODE-R1-007)", async () => {
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: issueWithThread("iss_1", "任务一", IssueStatus.Running),
    });
    vi.mocked(apiClient.threads.getEvents).mockRejectedValueOnce({ code: "X", message: "boom" });
    renderApp("/tasks/iss_1");

    expect(await screen.findByText("boom")).toBeInTheDocument();

    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => {
      expect(screen.queryByText("boom")).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toBeInTheDocument();
  });
});
