import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActorType,
  IssuePriority,
  IssueStatus,
  IssueType,
  ThreadType,
  WorkspaceLockState,
  type IssueWithThread,
  type Workspace,
} from "@personahub/shared";
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
import { WorkspaceBinding } from "@/components/workspace/WorkspaceBinding";
import { CreateIssueDialog } from "@/components/issue/CreateIssueDialog";
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

const workspace = (id: string, path: string): Workspace => ({
  id,
  project_id: "prj_1",
  local_path: path,
  git_branch: "main",
  lock_state: WorkspaceLockState.Idle,
  locked_by_run_id: null,
  locked_at: null,
  push_credentials_enabled: false,
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
});

const issue: IssueWithThread = {
  id: "iss_1",
  project_id: "prj_1",
  workspace_id: "wsp_1",
  primary_thread_id: "thr_1",
  issue_type: IssueType.Coding,
  workflow_template_id: "wft_coding_default",
  validation_policy_id: "vpl_coding_default",
  title: "Build foundation",
  goal: "Foundation works",
  status: IssueStatus.Inbox,
  owner_agent_id: null,
  coordinator_agent_id: null,
  priority: IssuePriority.Normal,
  labels: ["foundation"],
  validation_round_count: 0,
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
  primary_thread: {
    id: "thr_1",
    issue_id: "iss_1",
    thread_type: ThreadType.Primary,
    title: "Build foundation",
  },
};

describe("F001 UI flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
  });

  it("creates a Project from the dialog", async () => {
    vi.mocked(apiClient.projects.create).mockResolvedValue({
      project: {
        id: "prj_1",
        name: "PersonaHub",
        description: "Agent workspace",
        default_workspace_id: null,
        default_coordinator_agent_id: null,
        created_at: "2026-07-16T00:00:00.000Z",
        updated_at: "2026-07-16T00:00:00.000Z",
      },
    });
    const onCreated = vi.fn();

    renderWithQuery(
      <CreateProjectDialog open onOpenChange={vi.fn()} onCreated={onCreated} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "PersonaHub" } });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Agent workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(apiClient.projects.create).toHaveBeenCalledWith("PersonaHub", "Agent workspace");
      expect(onCreated).toHaveBeenCalledWith("prj_1");
    });
  });

  it("binds a Workspace and supports replacing the displayed default path", async () => {
    vi.mocked(apiClient.workspaces.bind)
      .mockResolvedValueOnce({ workspace: workspace("wsp_1", "D:\\repo-one") })
      .mockResolvedValueOnce({ workspace: workspace("wsp_2", "D:\\repo-two") });
    const view = renderWithQuery(
      <WorkspaceBinding projectId="prj_1" workspace={null} />,
    );
    const input = screen.getByPlaceholderText(/path.*workspace/i);

    fireEvent.change(input, { target: { value: "D:\\repo-one" } });
    fireEvent.click(screen.getByRole("button", { name: "Bind workspace" }));
    await waitFor(() => {
      expect(apiClient.workspaces.bind).toHaveBeenCalledWith("prj_1", "D:\\repo-one");
    });

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceBinding projectId="prj_1" workspace={workspace("wsp_1", "D:\\repo-one")} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("D:\\repo-one (main)")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/path.*workspace/i), {
      target: { value: "D:\\repo-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bind workspace" }));
    await waitFor(() => {
      expect(apiClient.workspaces.bind).toHaveBeenLastCalledWith("prj_1", "D:\\repo-two");
    });
  });

  it("creates a coding Issue with its requested fields", async () => {
    vi.mocked(apiClient.issues.create).mockResolvedValue({
      issue,
      primary_thread: {
        id: "thr_1",
        issue_id: "iss_1",
        room_id: null,
        thread_type: ThreadType.Primary,
        title: "Build foundation",
        created_at: "2026-07-16T00:00:00.000Z",
        updated_at: "2026-07-16T00:00:00.000Z",
      },
    });
    const onCreated = vi.fn();

    renderWithQuery(
      <CreateIssueDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={onCreated} />,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Build foundation" } });
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Foundation works" } });
    fireEvent.click(screen.getByRole("button", { name: "high" }));
    fireEvent.change(screen.getByLabelText(/Labels/), { target: { value: "foundation, v0.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(apiClient.issues.create).toHaveBeenCalledWith("prj_1", {
        title: "Build foundation",
        goal: "Foundation works",
        priority: IssuePriority.High,
        labels: ["foundation", "v0.1"],
      });
      expect(onCreated).toHaveBeenCalledWith("iss_1");
    });
  });

  it("shows the Issue primary Thread in the Inspector", async () => {
    renderWithQuery(<IssueInspector issue={issue} workspacePath={"D:\\repo-one"} />);

    expect(await screen.findByText("Primary Thread")).toBeInTheDocument();
    expect(screen.getAllByText("Build foundation").length).toBeGreaterThan(0);
    expect(screen.getByText("D:\\repo-one")).toBeInTheDocument();
  });
});
