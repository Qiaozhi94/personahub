import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  AdapterStatus, AgentCapability, GraphRunStatus, NodeRunStatus, GraphBlockReason,
  type ProjectedGraphRun, type ProjectedNodeRun, type AdapterConfig,
} from "@personahub/shared";
import { GraphRunCard, StartGraphDialog } from "@/components/thread/ThreadView";
import { renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const TIMESTAMP = "2026-08-07T00:00:00.000Z";

function graphRun(overrides: Partial<ProjectedGraphRun> = {}): ProjectedGraphRun {
  return {
    id: "gr_1",
    status: GraphRunStatus.Running,
    blocked_reason_code: null,
    blocked_node_keys: [],
    definition_id: "wgd_coding_dual_review",
    definition_version: 1,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

function nodeRun(overrides: Partial<ProjectedNodeRun> = {}): ProjectedNodeRun {
  return {
    node_key: "review_concurrency",
    title: "review_concurrency",
    responsibility: "review_concurrency",
    status: NodeRunStatus.Running,
    join_satisfied_at: null,
    result_event_id: null,
    attempts: [],
    ...overrides,
  };
}

function adapter(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    id: "agt_1",
    project_id: "prj_1",
    name: "Codex CLI",
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5",
    status: AdapterStatus.Available,
    last_checked_at: TIMESTAMP,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    auth_type: "oauth" as AdapterConfig["auth_type"],
    model_provider: null,
    has_api_key: false,
    auth_status_message: null,
    is_default: true,
    ...overrides,
  };
}

describe("T054b: Graph Run card cancellation UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.graphRuns.cancel).mockResolvedValue({
      graph_run_id: "gr_1", status: "cancelled", cancelled_node_keys: [], active_run_ids: [],
    });
  });

  it("start graph dialog: selecting all node adapters enables Start and calls the API", async () => {
    vi.mocked(apiClient.issues.startGraph).mockResolvedValue({ graph_run_id: "gr_2" });

    renderWithQuery(
      <StartGraphDialog issueId="iss_1" adapters={[adapter(), adapter({ id: "agt_2", name: "Claude Code" })]} disabled={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start graph/i }));

    await waitFor(() => {
      expect(screen.getByText(/start dual-review graph/i)).toBeInTheDocument();
    });

    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBe(3);

    fireEvent.change(selects[0]!, { target: { value: "agt_1" } });
    fireEvent.change(selects[1]!, { target: { value: "agt_2" } });
    fireEvent.change(selects[2]!, { target: { value: "agt_1" } });

    const startButton = screen.getByRole("button", { name: /^start graph$/i });
    expect(startButton).toBeEnabled();
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(apiClient.issues.startGraph).toHaveBeenCalledWith("iss_1", {
        definitionId: "wgd_coding_dual_review",
        definitionVersion: 1,
        nodeAssignments: { review_concurrency: "agt_1", review_contract: "agt_2", synthesize_findings: "agt_1" },
        premiseHash: null,
      });
    });
  });

  it("shows a Cancel button for a running graph and calls the cancel endpoint", async () => {
    renderWithQuery(
      <GraphRunCard graphRun={graphRun()} nodes={[nodeRun()]} adapters={[adapter()]} />,
    );

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    expect(cancelButton).toBeInTheDocument();

    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(apiClient.graphRuns.cancel).toHaveBeenCalledWith("gr_1");
    });
  });

  it("shows Force Cancel (not Cancel) for a cancelling graph", () => {
    renderWithQuery(
      <GraphRunCard
        graphRun={graphRun({ status: GraphRunStatus.Cancelling })}
        nodes={[nodeRun()]}
        adapters={[adapter()]}
      />,
    );
    expect(screen.getByRole("button", { name: /force cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it("hides the Cancel button for terminal graphs (completed / cancelled)", () => {
    const view = renderWithQuery(
      <GraphRunCard
        graphRun={graphRun({ status: GraphRunStatus.Completed })}
        nodes={[nodeRun()]}
        adapters={[adapter()]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.getByText(GraphRunStatus.Completed)).toBeInTheDocument();

    view.rerenderWithQuery(
      <GraphRunCard
        graphRun={graphRun({ status: GraphRunStatus.Cancelled })}
        nodes={[nodeRun()]}
        adapters={[adapter()]}
      />,
    );
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("shows an enabled retry button for a retryable node while the graph is blocked", () => {
    renderWithQuery(
      <GraphRunCard
        graphRun={graphRun({
          status: GraphRunStatus.Blocked,
          blocked_reason_code: GraphBlockReason.NodeRunFailed,
          blocked_node_keys: ["review_concurrency"],
        })}
        nodes={[nodeRun({ status: NodeRunStatus.Failed, attempts: [] })]}
        adapters={[adapter()]}
      />,
    );
    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeEnabled();
  });

  it("never renders a retry button while the graph is cancelling — retryable requires status Blocked, which is mutually exclusive with Cancelling", () => {
    renderWithQuery(
      <GraphRunCard
        graphRun={graphRun({ status: GraphRunStatus.Cancelling })}
        nodes={[nodeRun({ status: NodeRunStatus.Failed, attempts: [] })]}
        adapters={[adapter()]}
      />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows the resolve-executors reassignment panel for no_capable_adapter block", () => {
    renderWithQuery(
      <GraphRunCard
        graphRun={graphRun({
          status: GraphRunStatus.Blocked,
          blocked_reason_code: GraphBlockReason.NoCapableAdapter,
          blocked_node_keys: ["review_concurrency"],
        })}
        nodes={[nodeRun({ status: NodeRunStatus.Failed })]}
        adapters={[adapter(), adapter({ id: "agt_2", name: "Claude Code" })]}
      />,
    );
    expect(screen.getByText(/reassign executors/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resolve executors/i })).toBeInTheDocument();
  });
});
