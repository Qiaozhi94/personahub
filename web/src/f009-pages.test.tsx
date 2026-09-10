import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import { IssuePriority, IssueStatus, IssueType, ThreadType, WorkspaceLockState } from "@personahub/shared";

// T010 (A001–A005): project selection/creation, code-directory binding, task
// list/creation, and current-task context in the new surface pages, reusing
// the canonical APIs. Includes the deterministic unknown-ID outcomes.

const TIMESTAMP = "2026-07-16T00:00:00.000Z";

function primaryThread(id: string, issueId: string, title: string) {
  return {
    id,
    issue_id: issueId,
    thread_type: ThreadType.Primary,
    title,
    room_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function project(id: string, name: string, withWorkspace: boolean) {
  return {
    id,
    name,
    description: null,
    default_workspace_id: withWorkspace ? `ws_${id}` : null,
    default_coordinator_agent_id: null,
    default_adapter_config_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

function issue(id: string, title: string, status: IssueStatus) {
  return {
    id,
    project_id: "prj_a",
    workspace_id: "ws_a",
    primary_thread_id: `thr_${id}`,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.projects.list).mockResolvedValue({
    projects: [project("prj_a", "项目甲", true), project("prj_b", "项目乙", false)],
  });
});

describe("ProjectsPage (A001/A002)", () => {
  it("lists projects and opens a project through explicit selection", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: {
        ...project("prj_a", "项目甲", true),
        default_workspace: null,
      },
    });
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });

    renderApp("/projects");

    await user.click(await screen.findByRole("button", { name: /项目甲/ }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/prj_a");
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "项目甲" })).toBeInTheDocument();
    });
    expect(apiClient.projects.get).toHaveBeenCalledWith("prj_a");
  });

  it("creates a project through the canonical API and deep-links to it", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.create).mockResolvedValue({
      project: project("prj_new", "新项目", false),
    });

    renderApp("/projects");

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    await user.type(screen.getByLabelText(/name/i), "新项目");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiClient.projects.create).toHaveBeenCalledWith("新项目", undefined);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/prj_new");
    });
  });
});

describe("ProjectDetailPage (A003)", () => {
  it("binds a code directory through the canonical workspace API", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: { ...project("prj_a", "项目甲", false), default_workspace: null },
    });
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });
    vi.mocked(apiClient.workspaces.bind).mockResolvedValue({
      workspace: {
        id: "ws_a",
        project_id: "prj_a",
        local_path: "/repo/alpha",
        git_branch: "main",
        lock_state: WorkspaceLockState.Idle,
        locked_by_run_id: null,
        locked_at: null,
        push_credentials_enabled: false,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      },
    });

    renderApp("/projects/prj_a");

    await screen.findByRole("heading", { name: "项目甲" });
    await user.type(screen.getByLabelText("代码目录路径"), "/repo/alpha");
    await user.click(screen.getByRole("button", { name: /bind workspace/i }));

    await waitFor(() => {
      expect(apiClient.workspaces.bind).toHaveBeenCalledWith("prj_a", "/repo/alpha");
    });
  });

  it("replaces an unknown project id with a diagnostic project list", async () => {
    vi.mocked(apiClient.projects.get).mockRejectedValue({
      code: "PROJECT_NOT_FOUND",
      message: "not found",
    });

    renderApp("/projects/prj_missing");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects");
    });
    expect(window.location.search).toContain("not_found=prj_missing");
    expect(window.location.search).toContain("from=");
    expect(await screen.findByText("项目不存在")).toBeInTheDocument();
  });
});

describe("TasksPage (A004/A005)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({
      issues: [issue("iss_1", "任务一", IssueStatus.Running), issue("iss_2", "任务二", IssueStatus.Done)],
    });
  });

  it("asks for a project when no query is given and never guesses the first", async () => {
    renderApp("/tasks");

    expect(apiClient.issues.listByProject).not.toHaveBeenCalled();
    expect(await screen.findByText("先选择一个项目，再查看它的任务。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /项目甲/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /项目乙/ })).toBeInTheDocument();
  });

  it("lists the selected project's tasks after an explicit push", async () => {
    const user = userEvent.setup();

    renderApp("/tasks");

    await user.click(await screen.findByRole("button", { name: /项目甲/ }));

    await waitFor(() => {
      expect(window.location.search).toContain("project=prj_a");
    });
    expect(apiClient.issues.listByProject).toHaveBeenCalledWith("prj_a");
    expect(await screen.findByText("任务一")).toBeInTheDocument();
  });

  it("opens a task through user selection and shows its context", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: {
        ...issue("iss_1", "任务一", IssueStatus.Running),
        primary_thread: primaryThread("thr_iss_1", "iss_1", "任务一"),
      },
    });

    renderApp("/tasks?project=prj_a");

    await user.click(await screen.findByRole("button", { name: /任务一/ }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/iss_1");
    });
    expect(await screen.findByRole("heading", { name: "任务一" })).toBeInTheDocument();
    expect(apiClient.issues.get).toHaveBeenCalledWith("iss_1");
  });

  it("creates a task through the canonical API and opens it", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.issues.create).mockResolvedValue({
      issue: {
        ...issue("iss_new", "新任务", IssueStatus.Inbox),
        primary_thread: primaryThread("thr_iss_new", "iss_new", "新任务"),
      },
      primary_thread: primaryThread("thr_iss_new", "iss_new", "新任务"),
    });

    renderApp("/tasks?project=prj_a");

    await user.click(await screen.findByRole("button", { name: "新建任务" }));
    await user.type(screen.getByLabelText(/title/i), "新任务");
    await user.type(screen.getByLabelText(/goal/i), "完成标准");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(apiClient.issues.create).toHaveBeenCalledWith("prj_a", {
        title: "新任务",
        goal: "完成标准",
        priority: IssuePriority.Normal,
        labels: undefined,
      });
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/iss_new");
    });
  });

  it("keeps diagnostics and offers one recovery path for an unknown project", async () => {
    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [project("prj_a", "项目甲", true)],
    });
    vi.mocked(apiClient.issues.listByProject).mockRejectedValue({
      code: "PROJECT_NOT_FOUND",
      message: "not found",
    });

    renderApp("/tasks?project=prj_missing&from=%2Ftasks%2Fiss_gone");

    await waitFor(() => {
      expect(window.location.search).toContain("project=prj_missing");
    });
    expect(await screen.findByText("项目不存在")).toBeInTheDocument();
    // The URL keeps its diagnostics; recovery is a single explicit action.
    expect(window.location.search).toContain("from=");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "重新选择项目" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks");
      expect(window.location.search).toBe("");
    });
  });
});

describe("TaskDetailPage unknown id (FR-004)", () => {
  it("replaces an unknown task id with a diagnostic task selection", async () => {
    vi.mocked(apiClient.issues.get).mockRejectedValue({
      code: "ISSUE_NOT_FOUND",
      message: "not found",
    });

    renderApp("/tasks/iss_missing");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks");
    });
    expect(window.location.search).toContain("not_found=iss_missing");
    expect(window.location.search).toContain("from=");
    expect(await screen.findByText("任务不存在")).toBeInTheDocument();
  });
});

describe("review R1-006/R1-007 regressions", () => {
  it("keeps exactly one create action when the task list is empty", async () => {
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [] });
    renderApp("/tasks?project=prj_a");

    expect(await screen.findByText("该项目还没有任务")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建任务" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "推荐创建" })).not.toBeInTheDocument();
  });

  it("filters the task list through the label dropdown (BC-006)", async () => {
    const user = userEvent.setup();
    const labeled = [
      { ...issue("iss_1", "任务一", IssueStatus.Running), labels: ["parser"] },
      { ...issue("iss_2", "任务二", IssueStatus.Done), labels: ["ingest"] },
    ];
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: labeled });
    renderApp("/tasks?project=prj_a");

    expect(await screen.findByText("任务一")).toBeInTheDocument();
    expect(screen.getByText("任务二")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("按标签筛选"), "parser");
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(screen.queryByText("任务二")).not.toBeInTheDocument();
    expect(screen.getByText("1 项")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("按标签筛选"), "all");
    expect(screen.getByText("任务二")).toBeInTheDocument();
  });
});
