import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { AgentCapability, IssueStatus } from "@personahub/shared";
import { ThreadView } from "@/components/thread/ThreadView";
import { createAdapter, renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

function mockAdapters(...adapters: ReturnType<typeof createAdapter>[]) {
  vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters });
}

describe("T091/T092: composer routing preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
  });

  it("Running + implementation-capable default adapter -> previews Implementation workflow", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }));
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
    expect(await screen.findByText("Implementation workflow")).toBeInTheDocument();
  });

  it("Validating + validator-capable default adapter -> previews Validator workflow", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Validator] }));
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Validating} projectId="prj_1" />);
    expect(await screen.findByText("Validator workflow")).toBeInTheDocument();
  });

  it("Validating + implementation-only adapter (mismatch) -> degrades to Consult preview", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }));
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Validating} projectId="prj_1" />);
    expect(await screen.findByText("Consult (does not change Issue status)")).toBeInTheDocument();
  });

  it("explicit consult toggle previews Consult even when the adapter matches the expected workflow role", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }));
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
    await screen.findByText("Implementation workflow");
    fireEvent.click(screen.getByRole("checkbox", { name: /ask \(consult\)/i }));
    await waitFor(() => {
      expect(screen.getByText("Consult (does not change Issue status)")).toBeInTheDocument();
    });
  });

  it("Done issue disables the composer with an explanatory message", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }));
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Done} projectId="prj_1" />);
    expect(await screen.findByText(/Issue is Done/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toBeDisabled();
  });

  it("Blocked issue disables the composer with an explanatory message", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }));
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Blocked} projectId="prj_1" />);
    expect(await screen.findByText(/Issue is Blocked/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter agent instructions…")).toBeDisabled();
  });

  it("a Run already in progress does NOT disable the composer (consult stays eligible during Validating)", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Validator] }));
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({
      runs: [{
        id: "run_active", issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
        adapter_config_id: "agt_1", status: "running" as never, failure_reason: null,
        instructions: "x", started_at: "2026-07-19T00:00:00.000Z", completed_at: null,
        exit_code: null, error_message: null, role: "validator" as never, workflow_step: "validation",
        validation_round: 1, dispatch_source: "system" as never, adapter_identity: null,
        has_final_message: false, purpose: "workflow_bound" as never, context_source_run_id: null,
        node_run_id: null,
        created_at: "2026-07-19T00:00:00.000Z", updated_at: "2026-07-19T00:00:00.000Z",
      }],
    });
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Validating} projectId="prj_1" />);
    await screen.findByLabelText("Agent");
    expect(screen.getByPlaceholderText("Enter agent instructions…")).not.toBeDisabled();
    expect(screen.queryByText(/already in progress/i)).not.toBeInTheDocument();
  });

  it("submits with purpose:ad_hoc_consult when the consult checkbox is checked", async () => {
    mockAdapters(createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }));
    vi.mocked(apiClient.runs.create).mockResolvedValue({ run: {} as never });
    renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
    await screen.findByLabelText("Agent");
    fireEvent.click(screen.getByRole("checkbox", { name: /ask \(consult\)/i }));
    fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "quick question" } });
    fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

    await waitFor(() => {
      expect(apiClient.runs.create).toHaveBeenCalledWith("iss_1", expect.objectContaining({
        purpose: "ad_hoc_consult",
      }));
    });
  });

  // Review-report regression: canSend used to ignore adapter availability
  // entirely — the composer stayed submit-able with no usable default or an
  // unavailable explicit selection, and users only found out from a failed
  // API call.
  describe("canSend reflects adapter availability, not just adapter presence", () => {
    it("disables send and explains when no adapter is marked default (server would reject as DEFAULT_ADAPTER_UNAVAILABLE)", async () => {
      mockAdapters(createAdapter({ id: "agt_1", is_default: false, capability_tags: [AgentCapability.Implementation] }));
      renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
      await screen.findByLabelText("Agent");
      expect(await screen.findByText(/No available default adapter/i)).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "do something" } });
      fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

      await new Promise((r) => setTimeout(r, 10));
      expect(apiClient.runs.create).not.toHaveBeenCalled();
    });

    it("disables send when the default adapter is Unavailable", async () => {
      mockAdapters(createAdapter({
        id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation],
        status: "unavailable" as never,
      }));
      renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
      await screen.findByLabelText("Agent");
      expect(await screen.findByText(/No available default adapter/i)).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "do something" } });
      fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

      await new Promise((r) => setTimeout(r, 10));
      expect(apiClient.runs.create).not.toHaveBeenCalled();
    });

    it("disables send when the explicitly selected adapter is Unavailable, even though a different adapter is default", async () => {
      mockAdapters(
        createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }),
        createAdapter({
          id: "agt_2", is_default: false, capability_tags: [AgentCapability.Implementation],
          status: "unavailable" as never,
        }),
      );
      renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
      await screen.findByLabelText("Agent");
      fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_2" } });
      expect(await screen.findByText(/Selected adapter is not available/i)).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "do something" } });
      fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

      await new Promise((r) => setTimeout(r, 10));
      expect(apiClient.runs.create).not.toHaveBeenCalled();
    });

    it("re-enables send once the composer falls back to the available default after clearing an unavailable explicit pick", async () => {
      mockAdapters(
        createAdapter({ id: "agt_1", is_default: true, capability_tags: [AgentCapability.Implementation] }),
        createAdapter({
          id: "agt_2", is_default: false, capability_tags: [AgentCapability.Implementation],
          status: "unavailable" as never,
        }),
      );
      vi.mocked(apiClient.runs.create).mockResolvedValue({ run: {} as never });
      renderWithQuery(<ThreadView threadId="thr_1" issueId="iss_1" issueStatus={IssueStatus.Running} projectId="prj_1" />);
      await screen.findByLabelText("Agent");
      fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_2" } });
      await screen.findByText(/Selected adapter is not available/i);
      fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "" } });

      fireEvent.change(screen.getByPlaceholderText("Enter agent instructions…"), { target: { value: "do something" } });
      fireEvent.submit(screen.getByPlaceholderText("Enter agent instructions…").closest("form")!);

      await waitFor(() => {
        expect(apiClient.runs.create).toHaveBeenCalledWith("iss_1", expect.objectContaining({ adapter_id: undefined }));
      });
    });
  });
});
