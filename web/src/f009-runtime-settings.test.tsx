import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";
import { AdapterStatus } from "@personahub/shared";

// T013 (A025–A029, A030): runtime and settings transitional hosts. Facts are
// split per surface — execution resources only on /runtime, schema only in
// /settings/system-diagnostics, legacy workflow templates read-only — and no
// retired template write action is reachable.

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

function healthResponse(overrides?: { schemaStatus?: "current" | "behind" | "ahead" }) {
  const schemaStatus = overrides?.schemaStatus ?? ("current" as const);
  return {
    health: {
      schema: { actual_version: 10, expected_version: 10, status: schemaStatus },
      background: { pending_probe_count: 2, pending_reprobe_count: 1 },
      workspaces: [
        {
          workspace_id: "ws_a",
          adapters: [
            {
              id: "agt_1",
              name: "Codex",
              effective_status: AdapterStatus.Available,
              last_checked_at: TIMESTAMP,
            },
          ],
          lock: { locked_by_run_id: "run_1", locked_at: TIMESTAMP, held_ms: 65_000 },
          queue: { queued_count: 2, running_run_id: null },
        },
      ],
      diagnostics:
        schemaStatus === "behind"
          ? ([
              {
                code: "schema_version_mismatch",
                workspace_id: null,
                detail: "Database schema is behind.",
                suggested_action: "Run database migrations.",
              },
            ] as import("@personahub/shared").HealthDiagnostic[])
          : [],
    },
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
  vi.mocked(apiClient.projects.list).mockResolvedValue({ projects: [project("prj_a", "项目甲")] });
  vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null });
  vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(healthResponse());
  vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
  vi.mocked(apiClient.workflowTemplates.list).mockResolvedValue({
    templates: [
      {
        id: "wft_v1",
        name: "Coding Workflow",
        issue_type: "coding" as never,
        status: "active",
        version: 1,
        validation_enabled: true,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      },
    ],
  });
  vi.mocked(apiClient.workflowTemplates.get).mockResolvedValue({
    template: {
      id: "wft_v1",
      name: "Coding Workflow",
      issue_type: "coding" as never,
      collaboration_topology: "sequential",
      agent_team_template_id: null,
      validation_policy_id: "vpl_coding_default",
      steps_json: null,
      handoff_policy_json: null,
      evidence_requirements_json: null,
      status: "active",
      version: 1,
      steps: [
        { id: "implementation", role: "implementation" },
        { id: "validation", role: "validator" },
      ],
      validation_enabled: true,
      parse_error: null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    },
  });
});

describe("/runtime (A025/A028 runtime half)", () => {
  it("renders execution resources for an explicitly selected project", async () => {
    const user = userEvent.setup();
    renderApp("/runtime");

    expect(screen.queryByTestId("runtime-health-panel")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("radio", { name: "项目甲" }));

    const panel = await screen.findByTestId("runtime-health-panel");
    expect(panel).toBeInTheDocument();
    expect(await screen.findByText(/Codex: available/)).toBeInTheDocument();
    expect(panel).toHaveTextContent("queued: 2");
    expect(panel).toHaveTextContent("run_1");
    expect(panel).toHaveTextContent("probe: 2");
  });

  it("keeps schema facts out of the runtime surface", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(healthResponse({ schemaStatus: "behind" }));
    renderApp("/runtime");

    await user.click(await screen.findByRole("radio", { name: "项目甲" }));
    await screen.findByTestId("runtime-health-panel");

    expect(screen.queryByText(/schema 10\/10/)).not.toBeInTheDocument();
    expect(screen.queryByText("Database schema is behind.")).not.toBeInTheDocument();
  });
});

describe("/runtime/adapters (A025–A027)", () => {
  it("hosts the adapter configuration as the single write entry", async () => {
    const user = userEvent.setup();
    renderApp("/runtime/adapters");

    await user.click(await screen.findByRole("radio", { name: "项目甲" }));
    expect(await screen.findByText("适配器配置")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiClient.adapters.listByProject).toHaveBeenCalled();
      const calls = vi.mocked(apiClient.adapters.listByProject).mock.calls;
      expect(calls[0]?.[0]).toBe("prj_a");
    });
  });
});

describe("/settings/system-diagnostics (A028 settings half)", () => {
  it("shows schema status and schema diagnostics only", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(healthResponse({ schemaStatus: "behind" }));
    renderApp("/settings/system-diagnostics");

    await user.click(await screen.findByRole("radio", { name: "项目甲" }));

    expect(await screen.findByText(/schema 10\/10 \(behind\)/)).toBeInTheDocument();
    expect(screen.getByText("Database schema is behind.")).toBeInTheDocument();
    // Runtime facts stay on the runtime surface.
    expect(screen.queryByText("queued: 2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-health-panel")).not.toBeInTheDocument();
  });
});

describe("/settings/legacy-workflows (A029 read-only, A030 retired)", () => {
  it("lists templates read-only and opens details via the read API", async () => {
    const user = userEvent.setup();
    renderApp("/settings/legacy-workflows");

    const table = await screen.findByRole("table", { name: "历史工作流模板" });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "名称",
      "任务类型",
      "版本",
      "状态",
      "验证",
      "更新时间",
    ]);
    expect(screen.getByRole("cell", { name: "Coding Workflow" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Coding Workflow v1/ }));
    await waitFor(() => {
      expect(apiClient.workflowTemplates.get).toHaveBeenCalledWith("wft_v1");
    });
    expect(await screen.findByText(/implementation \(implementation\)/)).toBeInTheDocument();
  });

  it("offers no retired template write actions (A030)", async () => {
    renderApp("/settings/legacy-workflows");

    await screen.findByRole("table", { name: "历史工作流模板" });
    expect(apiClient.workflowTemplates.createVersion).not.toHaveBeenCalled();
    expect(apiClient.workflowTemplates.activate).not.toHaveBeenCalled();
    expect(apiClient.workflowTemplates.deactivate).not.toHaveBeenCalled();
    for (const forbidden of [/create version/i, /activate/i, /deactivate/i, /new version/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });
});

describe("review R1-004/R1-006/R1-007 regressions", () => {
  it("exposes a settings catalog with exactly the two real sub-pages", async () => {
    renderApp("/settings/system-diagnostics");

    const catalog = screen.getByRole("navigation", { name: "设置目录" });
    const entries = Array.from(catalog.querySelectorAll("a")).map((a) => a.textContent);
    expect(entries).toEqual(["系统诊断", "历史工作流"]);
    expect(catalog.querySelector('a[aria-current="page"]')?.textContent).toBe("系统诊断");
  });

  it("drives the legacy detail/list views through the shared tabs primitive", async () => {
    const user = userEvent.setup();
    renderApp("/settings/legacy-workflows");

    const tablist = await screen.findByRole("tablist", { name: "历史工作流视图" });
    expect(tablist).toHaveAttribute("tabindex", "0");
    const listTab = screen.getByRole("tab", { name: "模板列表" });
    const detailTab = screen.getByRole("tab", { name: "模板详情" });
    // The detail tab is not reachable until a template is selected.
    expect(detailTab).toBeDisabled();
    expect(listTab).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: /Coding Workflow v1/ }));
    expect(detailTab).toBeEnabled();

    act(() => {
      fireEvent.keyDown(listTab, { key: "ArrowRight" });
    });
    await waitFor(() => {
      expect(detailTab).toHaveAttribute("aria-selected", "true");
    });
    expect(document.activeElement).toBe(detailTab);

    act(() => {
      fireEvent.keyDown(detailTab, { key: "Home" });
    });
    await waitFor(() => {
      expect(listTab).toHaveAttribute("aria-selected", "true");
    });
  });

  it("retries a failed template detail load for real", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.workflowTemplates.get)
      .mockRejectedValueOnce({ code: "X", message: "boom" })
      .mockRejectedValueOnce({ code: "X", message: "boom" }); // retry: 1 consumes the second
    renderApp("/settings/legacy-workflows");

    await user.click(await screen.findByRole("button", { name: /Coding Workflow v1/ }));
    expect(await screen.findByText("模板详情加载失败", {}, { timeout: 4000 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("region", { name: "模板详情" })).toBeInTheDocument();
    // initial + react-query retry(1) + the explicit 重试 click
    expect(vi.mocked(apiClient.workflowTemplates.get).mock.calls.length).toBe(3);
  });

  it("shows a retryable ErrorState when the diagnostics query fails", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.runtimeHealth.get).mockRejectedValueOnce({ code: "X", message: "boom" });
    renderApp("/settings/system-diagnostics");

    await user.click(await screen.findByRole("radio", { name: "项目甲" }));
    expect(await screen.findByText("诊断读取失败")).toBeInTheDocument();

    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(healthResponse());
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/schema 10\/10/)).toBeInTheDocument();
  });
});
