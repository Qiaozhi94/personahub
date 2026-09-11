import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vi as vitestVi } from "vitest";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import { ApplicationShell, useDraftStore } from "@/app/ApplicationShell";
import { RouterProvider } from "@/app/router";
import { SURFACE_REGISTRY } from "@/app/surface-registry";
import { useLocation } from "@/app/router";

// T003 (FR-001/FR-005): the M1 SurfaceRegistry manifest and the ApplicationShell
// rail. Only enabled surfaces render navigation controls; not-registered
// surfaces have no control, and the rail groups daily entries above
// low-frequency entries (BC-007/BC-070).

const ENABLED_LABELS = ["任务", "项目", "运行时", "设置"];
const NOT_REGISTERED_LABELS = ["会话", "自动化", "记忆", "能力", "统计"];

function renderShell(path = "/projects"): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.replaceState(null, "", path);
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <ApplicationShell>
          <div data-testid="route-outlet">outlet</div>
        </ApplicationShell>
      </RouterProvider>
    </QueryClientProvider>,
  );
}

describe("M1 SurfaceRegistry manifest", () => {
  it("declares all nine V3.44 primary slots in order", () => {
    expect(SURFACE_REGISTRY.map((surface) => surface.id)).toEqual([
      "tasks",
      "sessions",
      "projects",
      "automation",
      "memory",
      "capabilities",
      "runtime",
      "stats",
      "settings",
    ]);
  });

  it("enables exactly tasks, projects, runtime and settings with real routes", () => {
    const enabled = SURFACE_REGISTRY.filter((surface) => surface.state === "enabled");
    expect(enabled.map((surface) => surface.id)).toEqual(["tasks", "projects", "runtime", "settings"]);
    expect(enabled.map((surface) => surface.route)).toEqual([
      "/tasks",
      "/projects",
      "/runtime",
      "/settings/system-diagnostics",
    ]);
    for (const surface of enabled) {
      expect(surface.label.length).toBeGreaterThan(0);
    }
  });

  it("declares no visible-disabled slot in M1", () => {
    expect(SURFACE_REGISTRY.some((surface) => surface.state === "visible-disabled")).toBe(false);
  });

  it("splits daily entries from low-frequency entries", () => {
    const daily = SURFACE_REGISTRY.filter((surface) => surface.group === "daily").map((s) => s.id);
    const low = SURFACE_REGISTRY.filter((surface) => surface.group === "low-frequency").map((s) => s.id);
    expect(daily).toEqual(["tasks", "sessions", "projects", "automation"]);
    expect(low).toEqual(["memory", "capabilities", "runtime", "stats", "settings"]);
  });
});

describe("ApplicationShell rail", () => {
  beforeEach(() => {
    vitestVi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders navigation controls for enabled surfaces only", () => {
    renderShell();
    for (const label of ENABLED_LABELS) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}$`) })).toBeInTheDocument();
    }
    for (const label of NOT_REGISTERED_LABELS) {
      expect(screen.queryByRole("button", { name: new RegExp(`^${label}$`) })).not.toBeInTheDocument();
    }
  });

  it("places the daily group above the low-frequency group", () => {
    renderShell("/tasks");
    const nav = screen.getByRole("navigation", { name: "工作面" });
    const labels = Array.from(nav.querySelectorAll("button > span")).map((span) => span.textContent);
    expect(labels).toEqual(["任务", "项目", "运行时", "设置"]);
  });

  it("highlights the active surface for the current URL", () => {
    renderShell("/tasks");
    const tasksButton = screen.getByRole("button", { name: /^任务$/ });
    expect(tasksButton).toHaveAttribute("aria-current", "page");
    const projectsButton = screen.getByRole("button", { name: /^项目$/ });
    expect(projectsButton).not.toHaveAttribute("aria-current");
  });

  it("switches surfaces through the router on click", async () => {
    const user = userEvent.setup();
    renderShell("/projects");
    await user.click(screen.getByRole("button", { name: /^任务$/ }));
    expect(window.location.pathname).toBe("/tasks");
    expect(screen.getByRole("button", { name: /^任务$/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("Command palette (BC-030)", () => {
  beforeEach(() => {
    vitestVi.mocked(apiClient.projects.list).mockResolvedValue({
      projects: [
        {
          id: "prj_1",
          name: "Alpha Platform",
          description: null,
          default_workspace_id: null,
          default_coordinator_agent_id: null,
          default_adapter_config_id: null,
          created_at: "2026-07-01T08:00:00.000Z",
          updated_at: "2026-07-01T08:00:00.000Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens with Ctrl+K, lists only registered targets, and navigates on Enter", async () => {
    const user = userEvent.setup();
    renderShell("/projects");

    await user.keyboard("{Control>}k");
    const dialog = await screen.findByRole("dialog", { name: "跳转" });
    expect(dialog).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    const optionLabels = screen.getAllByRole("option").map((option) => option.textContent);
    expect(optionLabels.some((text) => text!.includes("会话"))).toBe(false);
    expect(optionLabels.some((text) => text!.includes("任务"))).toBe(true);
    expect(optionLabels.some((text) => text!.includes("Alpha Platform"))).toBe(true);

    await user.type(screen.getByRole("combobox", { name: "跳转目标" }), "任务");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "跳转目标" }), { key: "Enter" });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/tasks");
      expect(screen.queryByRole("dialog", { name: "跳转" })).not.toBeInTheDocument();
    });
  });

  it("closes on Escape without navigating", async () => {
    const user = userEvent.setup();
    renderShell("/projects");
    await user.click(screen.getByRole("button", { name: /^跳转/ }));
    const dialog = await screen.findByRole("dialog", { name: "跳转" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "跳转" })).not.toBeInTheDocument());
    expect(window.location.pathname).toBe("/projects");
  });
});

describe("Shell draft store (T004 wiring)", () => {
  const draftStoreProbeRef: { current: import("@/app/task-draft-store").TaskDraftStore | null } = { current: null };

  function DraftProbe(): null {
    const store = useDraftStore();
    draftStoreProbeRef.current = store;
    return null;
  }

  afterEach(() => {
    vi.clearAllMocks();
    draftStoreProbeRef.current = null;
  });

  it("registers the beforeunload hint exactly while a non-empty draft exists", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [] });
    window.history.replaceState(null, "", "/tasks");
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider>
          <ApplicationShell>
            <DraftProbe />
          </ApplicationShell>
        </RouterProvider>
      </QueryClientProvider>,
    );
    const store = draftStoreProbeRef.current!;
    const dispatchUnload = (): boolean => window.dispatchEvent(new Event("beforeunload", { cancelable: true }));

    // No draft anywhere: the refresh must not be blocked.
    expect(dispatchUnload()).toBe(true);

    act(() => {
      store.edit("task:iss_1:composer", { text: "实现校验逻辑" });
    });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    act(() => {
      store.discard("task:iss_1:composer");
    });
    expect(dispatchUnload()).toBe(true);
  });
});

describe("router popstate listener lifetime (review R1-009)", () => {
  function LocationProbe({ label }: { label: string }): React.JSX.Element {
    const location = useLocation();
    return (
      <p>
        {label}:{location.pathname}
      </p>
    );
  }

  it("keeps remaining subscribers updating after one unmounts", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [] });
    window.history.replaceState(null, "", "/projects");

    const view = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider>
          <ApplicationShell>
            <LocationProbe label="A" />
            <LocationProbe label="B" />
          </ApplicationShell>
        </RouterProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("A:/projects");

    // Unmount exactly one subscriber.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <RouterProvider>
          <ApplicationShell>
            <LocationProbe label="A" />
          </ApplicationShell>
        </RouterProvider>
      </QueryClientProvider>,
    );

    act(() => {
      window.history.pushState(null, "", "/tasks");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      expect(screen.getByText("A:/tasks")).toBeInTheDocument();
    });

    // Unmounting the last subscriber detaches the window listener.
    const removed: string[] = [];
    const originalRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "removeEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      removed.push(type);
      return originalRemove(type, listener, options);
    }) as typeof window.removeEventListener);
    view.unmount();
    expect(removed).toContain("popstate");
    vi.restoreAllMocks();
  });
});
