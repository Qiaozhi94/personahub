import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import { IssueStatus, IssueType, IssuePriority, ThreadType, ThreadEventType, ActorType, WorkspaceLockState } from "@personahub/shared";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

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

describe("App - NoProject empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows NoProject when projects list is empty", async () => {
    vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [] });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /create project/i })).toBeInTheDocument();
  });
});

describe("App - with existing project", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [
        {
          id: "prj_test1",
          name: "Test Project",
          description: null,
          default_workspace_id: null,
          default_coordinator_agent_id: null,
          created_at: "2026-07-13T00:00:00.000Z",
          updated_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: {
        id: "prj_test1",
        name: "Test Project",
        description: null,
        default_workspace_id: null,
        default_coordinator_agent_id: null,
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
        default_workspace: null,
      },
    });

    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });
    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [] });
  });

  it("renders project name in switcher", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
    });
  });

  it("shows NoWorkspace state when project has no workspace", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText(/no workspace bound/i)).toBeInTheDocument();
    });
  });

  it("disables New coding issue button when no workspace", async () => {
    renderApp();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /new coding issue/i });
      expect(btn).toBeDisabled();
    });
  });
});

describe("App - with workspace bound", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [
        {
          id: "prj_test1",
          name: "Test Project",
          description: null,
          default_workspace_id: "wsp_test1",
          default_coordinator_agent_id: null,
          created_at: "2026-07-13T00:00:00.000Z",
          updated_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: {
        id: "prj_test1",
        name: "Test Project",
        description: null,
        default_workspace_id: "wsp_test1",
        default_coordinator_agent_id: null,
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
        default_workspace: {
          id: "wsp_test1",
          local_path: "D:\\Projects\\personahub",
          git_branch: "main",
          lock_state: WorkspaceLockState.Idle,
        },
      },
    });

    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({
      workspace: {
        id: "wsp_test1",
        project_id: "prj_test1",
        local_path: "D:\\Projects\\personahub",
        git_branch: "main",
        lock_state: WorkspaceLockState.Idle,
        locked_by_run_id: null,
        locked_at: null,
        push_credentials_enabled: false,
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
      },
    });

    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [] });
  });

  it("shows workspace path in left panel", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText(/D:\\Projects\\personahub/i)).toBeInTheDocument();
    });
  });

  it("enables New coding issue button when workspace is bound", async () => {
    renderApp();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /new coding issue/i });
      expect(btn).toBeEnabled();
    });
  });

  it("shows NoIssue state when no issue is selected", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText(/choose a coding issue/i)).toBeInTheDocument();
    });
  });
});

describe("App - with issue selected", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [
        {
          id: "prj_test1",
          name: "Test Project",
          description: null,
          default_workspace_id: "wsp_test1",
          default_coordinator_agent_id: null,
          created_at: "2026-07-13T00:00:00.000Z",
          updated_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(apiClient.projects.get).mockResolvedValue({
      project: {
        id: "prj_test1",
        name: "Test Project",
        description: null,
        default_workspace_id: "wsp_test1",
        default_coordinator_agent_id: null,
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
        default_workspace: {
          id: "wsp_test1",
          local_path: "D:\\Projects\\personahub",
          git_branch: "main",
          lock_state: WorkspaceLockState.Idle,
        },
      },
    });

    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({
      workspace: {
        id: "wsp_test1",
        project_id: "prj_test1",
        local_path: "D:\\Projects\\personahub",
        git_branch: "main",
        lock_state: WorkspaceLockState.Idle,
        locked_by_run_id: null,
        locked_at: null,
        push_credentials_enabled: false,
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
      },
    });

    vi.mocked(apiClient.issues.listByProject).mockResolvedValue({
      issues: [
        {
          id: "iss_test1",
          project_id: "prj_test1",
          workspace_id: "wsp_test1",
          primary_thread_id: "thr_test1",
          issue_type: IssueType.Coding,
          workflow_template_id: "wft_coding_default",
          validation_policy_id: "vpl_coding_default",
          title: "Test Issue",
          goal: "Test goal",
          status: IssueStatus.Inbox,
          owner_agent_id: null,
          coordinator_agent_id: null,
          priority: IssuePriority.Normal,
          labels: [],
          validation_round_count: 0,
          blocked_reason_code: null,
          blocked_reason_message: null,
          created_at: "2026-07-13T00:00:00.000Z",
          updated_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(apiClient.issues.get).mockResolvedValue({
      issue: {
        id: "iss_test1",
        project_id: "prj_test1",
        workspace_id: "wsp_test1",
        primary_thread_id: "thr_test1",
        issue_type: IssueType.Coding,
        workflow_template_id: "wft_coding_default",
        validation_policy_id: "vpl_coding_default",
        title: "Test Issue",
        goal: "Test goal",
        status: IssueStatus.Inbox,
        owner_agent_id: null,
        coordinator_agent_id: null,
        priority: IssuePriority.Normal,
        labels: [],
        validation_round_count: 0,
        blocked_reason_code: null,
        blocked_reason_message: null,
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z",
        primary_thread: {
          id: "thr_test1",
          issue_id: "iss_test1",
          thread_type: ThreadType.Primary,
          title: "Test Issue",
        },
      },
    });

    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({
      events: [
        {
          id: "evt_test1",
          event_sequence: 1,
          thread_id: "thr_test1",
          type: ThreadEventType.IssueCreated,
          actor_type: ActorType.User,
          actor_id: null,
          payload_json: {
            issue_id: "iss_test1",
            project_id: "prj_test1",
            workspace_id: "wsp_test1",
            issue_type: "coding",
            status: "Inbox",
          },
          evidence_refs: [],
          created_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });
  });

  it("renders issue title in center panel header", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Test Issue")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Test Issue"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /test issue/i })).toBeInTheDocument();
    });
  });

  it("shows issue.created event in thread view", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Test Issue")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Test Issue"));

    await waitFor(() => {
      expect(screen.getByText("issue.created")).toBeInTheDocument();
    });
  });

  it("shows Inbox status badge", async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getAllByText("Inbox").length).toBeGreaterThan(0);
    });
  });
});
