import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  AdapterStatus,
  type HealthDiagnostic,
  type HealthDiagnosticCode,
  type RuntimeHealthResponse,
} from "@personahub/shared";
import { RuntimeHealthDialog } from "@/components/runtime-health/RuntimeHealthDialog";
import { renderWithQuery } from "@/test/ui-flow-helpers";
import { renderDiagnosticCode } from "@/components/runtime-health/diagnostic-code";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const ALL_CODES: HealthDiagnosticCode[] = [
  "stale_lock_confirmed",
  "stale_lock_suspected",
  "lock_timestamp_invalid",
  "queue_starved",
  "waiting_for_recovery",
  "invalid_queued_run",
  "waiting_for_validation_due",
  "validation_dispatch_overdue",
  "no_available_adapter",
  "schema_version_mismatch",
];

function healthResponse(
  diagnostics: HealthDiagnostic[],
  overrides: Partial<RuntimeHealthResponse["health"]> = {},
): RuntimeHealthResponse {
  return {
    health: {
      schema: { actual_version: 10, expected_version: 10, status: "current" },
      background: { pending_probe_count: 0, pending_reprobe_count: 0 },
      workspaces: [],
      diagnostics,
      ...overrides,
    },
  };
}

describe("T054: Runtime health dialog — five categories and exhaustive diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({ workspace: null } as never);
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(healthResponse([]));
  });

  it("shows a loading state while the health query is pending", () => {
    vi.mocked(apiClient.runtimeHealth.get).mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an error state when the health query fails", async () => {
    vi.mocked(apiClient.runtimeHealth.get).mockRejectedValue({
      code: "PROJECT_NOT_FOUND",
      message: "Project not found.",
    });
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load runtime health/)).toBeInTheDocument();
    });
  });

  it("reports healthy when there are no diagnostics", async () => {
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/All systems healthy/)).toBeInTheDocument();
    });
  });

  it("calls the health endpoint scoped to the bound workspace when one exists", async () => {
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({
      workspace: {
        id: "wsp_1",
        project_id: "prj_1",
        local_path: "/tmp/x",
        git_branch: null,
        lock_state: "idle",
        locked_by_run_id: null,
        locked_at: null,
        push_credentials_enabled: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    } as never);
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);
    await waitFor(() => {
      expect(apiClient.runtimeHealth.get).toHaveBeenCalledWith("prj_1", "wsp_1");
    });
  });

  it("shows the five-category summary: schema, background, adapter, lock, queue", async () => {
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(
      healthResponse([], {
        background: { pending_probe_count: 1, pending_reprobe_count: 2 },
        workspaces: [
          {
            workspace_id: "wsp_1",
            adapters: [
              {
                id: "agt_1",
                name: "Codex",
                effective_status: AdapterStatus.Available,
                last_checked_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            lock: { locked_by_run_id: "run_1", locked_at: "2026-01-01T00:00:00.000Z", held_ms: 120_000 },
            queue: { queued_count: 3, running_run_id: "run_1" },
          },
        ],
      }),
    );
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/schema 10\/10 \(current\)/)).toBeInTheDocument();
    });
    expect(screen.getByText(/probes: 1/)).toBeInTheDocument();
    expect(screen.getByText(/reprobes: 2/)).toBeInTheDocument();
    expect(screen.getByText("wsp_1")).toBeInTheDocument();
    expect(screen.getByText(/Codex: available/)).toBeInTheDocument();
    expect(screen.getByText(/run_1 \(120s\)/)).toBeInTheDocument();
    expect(screen.getByText("queued: 3")).toBeInTheDocument();
  });

  it.each(ALL_CODES)("renders the %s diagnostic branch with title, detail and suggested action", async (code) => {
    const render = renderDiagnosticCode(code);
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(
      healthResponse([
        { code, workspace_id: null, detail: `detail-for-${code}`, suggested_action: `action-for-${code}` },
      ]),
    );
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(render.title)).toBeInTheDocument();
    });
    expect(screen.getByText(`detail-for-${code}`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`action-for-${code}`))).toBeInTheDocument();
  });

  it("shows the workspace badge on workspace-scoped diagnostics", async () => {
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(
      healthResponse([{ code: "queue_starved", workspace_id: "wsp_1", detail: "d", suggested_action: "a" }]),
    );
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("wsp_1")).toBeInTheDocument();
    });
  });

  it("renders multiple same-code diagnostics for one workspace without duplicate-key warnings", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(
        healthResponse([
          {
            code: "waiting_for_recovery",
            workspace_id: "wsp_1",
            run_id: "run_1",
            detail: "Queued run run_1 (role graph_node) is waiting for issue-level recovery.",
            suggested_action: "a",
          },
          {
            code: "waiting_for_recovery",
            workspace_id: "wsp_1",
            run_id: "run_2",
            detail: "Queued run run_2 (role graph_node) is waiting for issue-level recovery.",
            suggested_action: "a",
          },
          {
            code: "invalid_queued_run",
            workspace_id: "wsp_1",
            run_id: "run_3",
            detail: "Queued run run_3 (role implementation) is no longer eligible for execution.",
            suggested_action: "b",
          },
        ]),
      );
      renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);

      await waitFor(() => {
        expect(screen.getAllByText("Waiting for recovery")).toHaveLength(2);
      });
      expect(screen.getByText("Invalid queued run")).toBeInTheDocument();
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("diagnosticKey stays stable when live detail numbers change across refetches", async () => {
    const { diagnosticKey } = await import("@/components/runtime-health/diagnostic-code");
    // Same run, different held_ms in detail — key must not change.
    const before = diagnosticKey({
      code: "stale_lock_suspected",
      workspace_id: "wsp_1",
      run_id: "run_1",
      detail: "held_ms=1000",
      suggested_action: "a",
    });
    const after = diagnosticKey({
      code: "stale_lock_suspected",
      workspace_id: "wsp_1",
      run_id: "run_1",
      detail: "held_ms=9000",
      suggested_action: "a",
    });
    expect(after).toBe(before);
    // Same issue, different remaining_ms — key must not change.
    const dueBefore = diagnosticKey({
      code: "waiting_for_validation_due",
      workspace_id: "wsp_1",
      issue_id: "iss_1",
      detail: "remaining_ms=4000",
      suggested_action: "a",
    });
    const dueAfter = diagnosticKey({
      code: "waiting_for_validation_due",
      workspace_id: "wsp_1",
      issue_id: "iss_1",
      detail: "remaining_ms=2000",
      suggested_action: "a",
    });
    expect(dueAfter).toBe(dueBefore);
    // Different runs of the same code in the same workspace stay unique.
    expect(
      diagnosticKey({
        code: "invalid_queued_run",
        workspace_id: "wsp_1",
        run_id: "run_1",
        detail: "d",
        suggested_action: "a",
      }),
    ).not.toBe(
      diagnosticKey({
        code: "invalid_queued_run",
        workspace_id: "wsp_1",
        run_id: "run_2",
        detail: "d",
        suggested_action: "a",
      }),
    );
  });

  it("renders multiple diagnostics of different codes at once", async () => {
    vi.mocked(apiClient.runtimeHealth.get).mockResolvedValue(
      healthResponse([
        { code: "schema_version_mismatch", workspace_id: null, detail: "schema detail", suggested_action: "migrate" },
        {
          code: "no_available_adapter",
          workspace_id: "wsp_1",
          detail: "adapter detail",
          suggested_action: "configure",
        },
      ]),
    );
    renderWithQuery(<RuntimeHealthDialog open projectId="prj_1" onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Schema version mismatch")).toBeInTheDocument();
      expect(screen.getByText("No available adapter")).toBeInTheDocument();
    });
  });
});
