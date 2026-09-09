import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import { IssuePriority, IssueStatus, IssueType, ThreadType } from "@personahub/shared";

// T014 (FR-004): M1 route manifest behavior — direct access, refresh
// recovery, History traversal, `/` replace semantics, no-guess defaults,
// unsupported sub-path canonicalization, unknown-ID diagnostics, and
// diagnostic clearing on explicit selection.

const TIMESTAMP = "2026-07-16T00:00:00.000Z";

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
    goal: null,
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

function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.projects.list).mockResolvedValue({
    projects: [project("prj_a", "项目甲"), project("prj_b", "项目乙")],
  });
  vi.mocked(apiClient.projects.get).mockResolvedValue({
    project: { ...project("prj_a", "项目甲"), default_workspace: null },
  });
  vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });
  vi.mocked(apiClient.issues.listByProject).mockResolvedValue({ issues: [] });
  vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
  vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
  vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
  vi.mocked(apiClient.issues.getGraph).mockResolvedValue({ current: null, history: [] });
  vi.mocked(apiClient.issues.get).mockImplementation(async (id: string) => ({
    issue: issueWithThread(id, `任务 ${id}`, IssueStatus.Running),
  }));
});

describe("legacy entry and refresh recovery", () => {
  it("replaces `/` with /projects without guessing a project", async () => {
    renderApp("/");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects");
    });
    expect(await screen.findByRole("heading", { name: "项目" })).toBeInTheDocument();
    expect(apiClient.projects.get).not.toHaveBeenCalled();
    expect(apiClient.issues.listByProject).not.toHaveBeenCalled();
  });

  it("resolves a canonical deep link directly (refresh semantics)", async () => {
    renderApp("/tasks/iss_9");

    expect(await screen.findByRole("heading", { name: "任务 iss_9" })).toBeInTheDocument();
    expect(apiClient.issues.get).toHaveBeenCalledWith("iss_9");
  });

  it("resolves a project deep link directly", async () => {
    renderApp("/projects/prj_a");

    expect(await screen.findByRole("heading", { name: "项目甲" })).toBeInTheDocument();
    expect(apiClient.projects.get).toHaveBeenCalledWith("prj_a");
  });
});

describe("History traversal replays the URL", () => {
  it("goes back and forward between surfaces, restoring each view", async () => {
    const user = userEvent.setup();
    renderApp("/projects");

    // User selection: push a new surface.
    await user.click(await screen.findByRole("button", { name: /^任务$/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/tasks"));
    expect(await screen.findByText("先选择一个项目，再查看它的任务。")).toBeInTheDocument();

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/projects"));
    expect(await screen.findByRole("heading", { name: "项目" })).toBeInTheDocument();

    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/tasks"));
    expect(await screen.findByText("先选择一个项目，再查看它的任务。")).toBeInTheDocument();
  });

  it("replays an object URL from History and shows the same object", async () => {
    renderApp("/tasks/iss_1");
    await screen.findByRole("heading", { name: "任务 iss_1" });
    await screen.findByRole("heading", { name: "任务 iss_1" });

    navigate("/tasks/iss_2");
    await screen.findByRole("heading", { name: "任务 iss_2" });

    window.history.back();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/iss_1");
    });
    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "任务 iss_1" })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    // The previously loaded object is refetched for the replayed URL.
    expect(apiClient.issues.get).toHaveBeenLastCalledWith("iss_1");
  });
});

describe("unsupported sub-paths canonicalize to the base object", () => {
  it("replaces /tasks/:id/:view with the task base route and a diagnostic", async () => {
    renderApp("/tasks/iss_7/conversation");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks/iss_7");
    });
    expect(window.location.search).toContain("route_issue=unsupported-view");
    expect(window.location.search).toContain("from=%2Ftasks%2Fiss_7%2Fconversation");
    expect(await screen.findByText("该链接指向的任务视图尚未开放")).toBeInTheDocument();
    expect(apiClient.issues.get).toHaveBeenCalledWith("iss_7");
  });

  it("replaces /projects/:id/:tab with the project base route and a diagnostic", async () => {
    renderApp("/projects/prj_a/files");

    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects/prj_a");
    });
    expect(window.location.search).toContain("route_issue=unsupported-tab");
    expect(await screen.findByText("该链接指向的项目页签尚未开放")).toBeInTheDocument();
  });
});

describe("unknown sub-paths and unregistered surfaces", () => {
  it.each([
    "/sessions/sess_1",
    "/memory",
    "/automation",
    "/capabilities",
    "/stats",
    "/runtime/nope",
    "/settings/unknown",
    "/somewhere/else",
  ])("lands %p on not-found with one recovery action", async (path) => {
    renderApp(path);

    expect(await screen.findByText("页面不存在")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回到项目列表" })).toBeInTheDocument();
  });

  it("returns to a resumable list from not-found", async () => {
    const user = userEvent.setup();
    renderApp("/somewhere");

    await user.click(await screen.findByRole("button", { name: "回到项目列表" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/projects");
    });
    expect(await screen.findByRole("heading", { name: "项目" })).toBeInTheDocument();
  });
});

describe("diagnostics are cleared by explicit selection", () => {
  it("drops not_found/from once the user picks a valid object", async () => {
    const user = userEvent.setup();
    renderApp("/tasks?not_found=iss_gone&from=%2Ftasks%2Fiss_gone");

    expect(await screen.findByText("任务不存在")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /项目甲/ }));

    await waitFor(() => {
      expect(window.location.search).toBe("?project=prj_a");
    });
    expect(window.location.search).not.toContain("not_found");
    expect(window.location.search).not.toContain("from");
  });
});
