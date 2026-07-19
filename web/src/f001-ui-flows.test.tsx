import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IssuePriority,
  ThreadType,
  type IssueWithThread,
} from "@personahub/shared";
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
import { WorkspaceBinding } from "@/components/workspace/WorkspaceBinding";
import { CreateIssueDialog } from "@/components/issue/CreateIssueDialog";
import { IssueInspector } from "@/components/inspector/IssueInspector";
import {
  createIssue,
  createWorkspace,
  renderWithQuery,
} from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const workspace = (id: string, path: string) => createWorkspace({ id, local_path: path });

const issue: IssueWithThread = createIssue({ labels: ["foundation"] });

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
        default_adapter_config_id: null,
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

    view.rerenderWithQuery(
      <WorkspaceBinding projectId="prj_1" workspace={workspace("wsp_1", "D:\\repo-one")} />,
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
