import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorCode, IssuePriority, IssueType, type ConfirmResponse, type RecommendResponse } from "@personahub/shared";
import { IntakeDialog } from "@/components/intake/IntakeDialog";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function createRecommendResponse(overrides: Partial<RecommendResponse> = {}): RecommendResponse {
  return {
    token: {
      payload: {
        nonce: "nonce_1",
        issued_at: "2026-08-08T00:00:00.000Z",
        project_id: "prj_1",
        workspace_id: "wsp_1",
        premise: {
          project_id: "prj_1",
          workspace_id: "wsp_1",
          adapters: {},
          workflow_template_id: "wft_default",
          workflow_template_version: 1,
          graph_definition_id: null,
          graph_definition_version: null,
        },
        recommended: {
          issue_type: {
            value: IssueType.Coding,
            rule: "default_issue_type",
            candidates: [IssueType.Coding],
            excluded: [],
          },
          issue_draft: {
            title: {
              value: "Add feature",
              rule: "goal_summary",
              candidates: ["Add feature"],
              excluded: [],
            },
            goal: {
              value: "Implement the requested feature",
              rule: "verbatim",
              candidates: ["Implement the requested feature"],
              excluded: [],
            },
            priority: {
              value: IssuePriority.Normal,
              rule: "default_priority",
              candidates: [IssuePriority.Normal],
              excluded: [],
            },
          },
          workflow_template: {
            value: { id: "wft_default", version: 1 },
            rule: "default_template",
            candidates: [{ id: "wft_default", version: 1 }],
            excluded: [],
          },
          collaboration_topology: {
            value: { value: "sequential" },
            rule: "single_adapter",
            candidates: [
              { value: "sequential" },
              {
                value: "orchestrator_subagent",
                definition_id: "def_1",
                definition_version: 1,
              },
            ],
            excluded: [],
          },
          agent_roster: {
            value: { sequential: "agt_1" },
            rule: "default_adapter",
            by_node: {
              sequential: {
                candidates: ["agt_1", "agt_2"],
                excluded: [{ id: "agt_3", reason: "capability missing" }],
              },
            },
          },
        },
      },
      signature: "sig_1",
    },
    recommendation_id: "rec_1",
    issue_type: {
      value: IssueType.Coding,
      rule: "default_issue_type",
      candidates: [IssueType.Coding],
      excluded: [],
    },
    issue_draft: {
      title: {
        value: "Add feature",
        rule: "goal_summary",
        candidates: ["Add feature"],
        excluded: [],
      },
      goal: {
        value: "Implement the requested feature",
        rule: "verbatim",
        candidates: ["Implement the requested feature"],
        excluded: [],
      },
      priority: {
        value: IssuePriority.Normal,
        rule: "default_priority",
        candidates: [IssuePriority.Normal],
        excluded: [],
      },
    },
    workflow_template: {
      value: { id: "wft_default", version: 1 },
      rule: "default_template",
      candidates: [{ id: "wft_default", version: 1 }],
      excluded: [],
    },
    collaboration_topology: {
      value: { value: "sequential" },
      rule: "single_adapter",
      candidates: [
        { value: "sequential" },
        { value: "orchestrator_subagent", definition_id: "def_1", definition_version: 1 },
      ],
      excluded: [],
    },
    agent_roster: {
      value: { sequential: "agt_1" },
      rule: "default_adapter",
      by_node: {
        sequential: {
          candidates: ["agt_1", "agt_2"],
          excluded: [{ id: "agt_3", reason: "capability missing" }],
        },
      },
    },
    rosters_by_topology: {
      sequential: {
        value: { sequential: "agt_1" },
        rule: "default_adapter",
        by_node: {
          sequential: {
            candidates: ["agt_1", "agt_2"],
            excluded: [{ id: "agt_3", reason: "capability missing" }],
          },
        },
      },
      orchestrator_subagent: {
        value: {
          review_concurrency: "agt_1",
          review_contract: "agt_1",
          synthesize_findings: "agt_1",
        },
        rule: "default_adapter",
        by_node: {
          review_concurrency: { candidates: ["agt_1", "agt_2"], excluded: [] },
          review_contract: { candidates: ["agt_1", "agt_2"], excluded: [] },
          synthesize_findings: { candidates: ["agt_1", "agt_2"], excluded: [] },
        },
      },
    },
    editable: ["collaboration_topology", "agent_roster"],
    ...overrides,
  };
}

describe("IntakeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recommends and renders the recommendation panel", async () => {
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(createRecommendResponse());

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Build a new feature" },
    });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await waitFor(() => {
      expect(apiClient.intake.recommend).toHaveBeenCalledWith("prj_1", "Build a new feature");
    });

    expect(screen.getByText("当前只有 coding 候选")).toBeInTheDocument();
    expect(screen.getByText("Add feature")).toBeInTheDocument();
    expect(screen.getByText(/Matched rule: default_priority/i)).toBeInTheDocument();
    expect(screen.getAllByText(/candidate:/i).some((el) => el.textContent?.includes("normal"))).toBe(true);
    expect(screen.getByLabelText(/Adapter for sequential/i)).toBeInTheDocument();
    expect(screen.getByText(/capability missing/i)).toBeInTheDocument();
  });

  it("shows the suggested action when recommend is blocked", async () => {
    vi.mocked(apiClient.intake.recommend).mockRejectedValue({
      code: ErrorCode.NO_AVAILABLE_ADAPTER,
      message: "No available adapter",
      details: { suggested_action: "Add an available adapter to the project" },
    });

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Do work" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await waitFor(() => {
      expect(screen.getByText("Add an available adapter to the project")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Adapter for sequential/i)).not.toBeInTheDocument();
  });

  it("renders topology and roster as editable, and the rest as read-only", async () => {
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(createRecommendResponse());

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByText("Sequential");

    const topologyButton = screen.getByRole("button", { name: /orchestrator \+ subagent/i });
    expect(topologyButton).not.toBeDisabled();

    const rosterSelect = screen.getByLabelText(/Adapter for sequential/i);
    expect(rosterSelect).not.toBeDisabled();

    expect(screen.getByText("当前只有 coding 候选")).toBeInTheDocument();
    expect(screen.getAllByText("v0.2 不可调整").length).toBeGreaterThanOrEqual(2);
  });

  it("confirms a sequential plan with the chosen adapter and calls onCreated", async () => {
    const recommendResponse = createRecommendResponse();
    const confirmResponse: ConfirmResponse = {
      issue_id: "iss_new",
      target_kind: "run",
      target_id: "run_1",
      diff: [],
    };
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(recommendResponse);
    vi.mocked(apiClient.intake.confirm).mockResolvedValue(confirmResponse);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={onOpenChange} onCreated={onCreated} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByText("Sequential");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText(/Adapter for sequential/i), {
      target: { value: "agt_2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(apiClient.intake.confirm).toHaveBeenCalledWith("prj_1", recommendResponse.token, {
        topology: "sequential",
        adapter_config_id: "agt_2",
      });
    });
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith("iss_new");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not call confirm when cancelled after a recommendation", async () => {
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(createRecommendResponse());

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByText("Sequential");

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(apiClient.intake.confirm).not.toHaveBeenCalled();
  });

  it("enters stale state when confirm returns RECOMMENDATION_STALE", async () => {
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(createRecommendResponse());
    vi.mocked(apiClient.intake.confirm).mockRejectedValue({
      code: ErrorCode.RECOMMENDATION_STALE,
      message: "Recommendation is stale",
    });

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByText("Sequential");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(apiClient.intake.confirm).toHaveBeenCalled();
    });
    expect(await screen.findByRole("button", { name: /re-run recommendation/i })).toBeInTheDocument();
  });

  it("confirms an orchestrator-subagent plan with per-node assignments", async () => {
    const recommendResponse = createRecommendResponse({
      collaboration_topology: {
        value: {
          value: "orchestrator_subagent",
          definition_id: "def_1",
          definition_version: 1,
        },
        rule: "multi_node_graph",
        candidates: [
          { value: "sequential" },
          { value: "orchestrator_subagent", definition_id: "def_1", definition_version: 1 },
        ],
        excluded: [],
      },
      agent_roster: {
        value: { analyze: "agt_1", implement: "agt_2", synthesize_findings: "agt_1" },
        rule: "capability_match",
        by_node: {
          analyze: { candidates: ["agt_1", "agt_2"], excluded: [] },
          implement: { candidates: ["agt_2"], excluded: [] },
          synthesize_findings: { candidates: ["agt_1", "agt_3"], excluded: [] },
        },
      },
      rosters_by_topology: {
        sequential: {
          value: { sequential: "agt_1" },
          rule: "capability_match",
          by_node: {
            sequential: { candidates: ["agt_1", "agt_2"], excluded: [] },
          },
        },
        orchestrator_subagent: {
          value: { analyze: "agt_1", implement: "agt_2", synthesize_findings: "agt_1" },
          rule: "capability_match",
          by_node: {
            analyze: { candidates: ["agt_1", "agt_2"], excluded: [] },
            implement: { candidates: ["agt_2"], excluded: [] },
            synthesize_findings: { candidates: ["agt_1", "agt_3"], excluded: [] },
          },
        },
      },
    });
    const confirmResponse: ConfirmResponse = {
      issue_id: "iss_graph",
      target_kind: "graph",
      target_id: "gr_1",
      diff: [],
    };
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(recommendResponse);
    vi.mocked(apiClient.intake.confirm).mockResolvedValue(confirmResponse);
    const onCreated = vi.fn();

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={onCreated} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByLabelText(/Adapter for analyze/i);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText(/Adapter for synthesize_findings/i), {
      target: { value: "agt_3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => {
      expect(apiClient.intake.confirm).toHaveBeenCalledWith("prj_1", recommendResponse.token, {
        topology: "orchestrator_subagent",
        definition_id: "def_1",
        definition_version: 1,
        node_assignments: {
          analyze: "agt_1",
          implement: "agt_2",
          synthesize_findings: "agt_3",
        },
      });
    });
    expect(onCreated).toHaveBeenCalledWith("iss_graph");
  });

  it("switching topology from sequential to orchestrator rebuilds the roster and confirms a graph plan", async () => {
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(createRecommendResponse());
    vi.mocked(apiClient.intake.confirm).mockResolvedValue({
      issue_id: "iss_graph",
      target_kind: "graph",
      target_id: "gr_1",
      diff: [],
    } as ConfirmResponse);
    const onCreated = vi.fn();

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={onCreated} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByLabelText(/Adapter for sequential/i);
    fireEvent.click(screen.getByRole("button", { name: /Orchestrator \+ subagent/i }));
    await screen.findByLabelText(/Adapter for review_concurrency/i);
    expect(screen.queryByLabelText(/Adapter for sequential/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => {
      expect(apiClient.intake.confirm).toHaveBeenCalledWith("prj_1", expect.anything(), {
        topology: "orchestrator_subagent",
        definition_id: "def_1",
        definition_version: 1,
        node_assignments: {
          review_concurrency: "agt_1",
          review_contract: "agt_1",
          synthesize_findings: "agt_1",
        },
      });
    });
    expect(onCreated).toHaveBeenCalledWith("iss_graph");
  });

  it("switching topology from orchestrator to sequential rebuilds the roster and confirms a run plan", async () => {
    const recommendResponse = createRecommendResponse({
      collaboration_topology: {
        value: { value: "orchestrator_subagent", definition_id: "def_1", definition_version: 1 },
        rule: "multi_node_graph",
        candidates: [
          { value: "sequential" },
          { value: "orchestrator_subagent", definition_id: "def_1", definition_version: 1 },
        ],
        excluded: [],
      },
    });
    vi.mocked(apiClient.intake.recommend).mockResolvedValue(recommendResponse);
    vi.mocked(apiClient.intake.confirm).mockResolvedValue({
      issue_id: "iss_seq",
      target_kind: "run",
      target_id: "run_1",
      diff: [],
    } as ConfirmResponse);
    const onCreated = vi.fn();

    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={vi.fn()} onCreated={onCreated} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    await screen.findByLabelText(/Adapter for review_concurrency/i);
    fireEvent.click(screen.getByRole("button", { name: /^Sequential$/i }));
    await screen.findByLabelText(/Adapter for sequential/i);
    expect(screen.queryByLabelText(/Adapter for review_concurrency/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => {
      expect(apiClient.intake.confirm).toHaveBeenCalledWith("prj_1", expect.anything(), {
        topology: "sequential",
        adapter_config_id: "agt_1",
      });
    });
    expect(onCreated).toHaveBeenCalledWith("iss_seq");
  });

  it("ignores a recommend response that resolves after the dialog is closed (stale request)", async () => {
    let resolveRecommend!: (value: RecommendResponse) => void;
    vi.mocked(apiClient.intake.recommend).mockReturnValue(
      new Promise<RecommendResponse>((resolve) => {
        resolveRecommend = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    render(
      <Wrapper>
        <IntakeDialog projectId="prj_1" open onOpenChange={onOpenChange} onCreated={vi.fn()} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /recommend/i }));

    // Close via the Dialog's close control while the request is in flight →
    // reset() bumps the generation (the in-form Cancel is disabled while loading).
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Resolve the stale request after the dialog was closed.
    await act(async () => {
      resolveRecommend(createRecommendResponse());
    });

    // The stale response must not be applied: still the idle form, no panel.
    expect(screen.getByLabelText("Goal")).toBeInTheDocument();
    expect(screen.queryByText("当前只有 coding 候选")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
  });
});
