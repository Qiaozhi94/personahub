import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [] });
    renderApp("/tasks?project=prj_a");

    await user.click(await screen.findByRole("button", { name: "推荐创建" }));

    const dialog = await screen.findByRole("dialog", { name: "Intake" });
    expect(dialog).toBeInTheDocument();
    expect(apiClient.intake.recommend).not.toHaveBeenCalled();
    expect(apiClient.intake.confirm).not.toHaveBeenCalled();
  });
});
