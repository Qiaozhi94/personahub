import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

// F009 P001 representative test: the production entry is the V3.44
// ApplicationShell hosting the M1 route manifest. The published legacy entry
// `/` replaces to the project list and never guesses a project; navigation
// controls exist only for enabled surfaces.

function renderApp(path = "/"): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  window.history.replaceState(null, "", path);
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App — published legacy entry `/`", () => {
  it("replaces `/` with the project list and shows no guessed selection", async () => {
    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [
        {
          id: "prj_test1",
          name: "Test Project",
          description: null,
          default_workspace_id: null,
          default_coordinator_agent_id: null,
          default_adapter_config_id: null,
          created_at: "2026-07-13T00:00:00.000Z",
          updated_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    renderApp("/");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "项目" })).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe("/projects");
    expect(apiClient.projects.get).not.toHaveBeenCalled();
    expect(apiClient.issues.listByProject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
  });

  it("offers a recoverable empty state when no projects exist", async () => {
    vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [] });

    renderApp("/");

    await waitFor(() => {
      expect(screen.getByText("还没有项目")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "新建项目" }).length).toBeGreaterThan(0);
  });
});

describe("App — surface navigation", () => {
  it("exposes rail controls for enabled surfaces only", async () => {
    vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [] });

    renderApp("/projects");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "项目" })).toBeInTheDocument();
    });
    for (const label of ["任务", "项目", "运行时", "设置"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`) })).toBeInTheDocument();
    }
    for (const label of ["会话", "自动化", "记忆", "能力", "统计"]) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}$`) })).not.toBeInTheDocument();
    }
  });

  it("navigates to the task surface through user selection only", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [
        {
          id: "prj_test1",
          name: "Test Project",
          description: null,
          default_workspace_id: null,
          default_coordinator_agent_id: null,
          default_adapter_config_id: null,
          created_at: "2026-07-13T00:00:00.000Z",
          updated_at: "2026-07-13T00:00:00.000Z",
        },
      ],
    });

    renderApp("/projects");
    await user.click(await screen.findByRole("button", { name: /^任务$/ }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks");
    });
    // No `project` query: the task surface asks the user to pick a project.
    expect(screen.getByText("先选择一个项目，再查看它的任务。")).toBeInTheDocument();
    expect(apiClient.issues.listByProject).not.toHaveBeenCalled();
  });
});
