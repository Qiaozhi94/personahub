import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IssueStatus, ValidationOutcome } from "@personahub/shared";
import { ValidationInspectorSection } from "@/components/inspector/ValidationInspectorSection";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const EVIDENCE_SUMMARY = {
  id: "es_1",
  issue_id: "iss_1",
  thread_id: "th_1",
  validator_run_id: "rv",
  implementation_run_id: "ri",
  validation_result: ValidationOutcome.Passed,
  evidence_refs: [],
  summary_markdown: "# Evidence Summary\n\nMY_MARKDOWN_BODY",
  same_origin_validation: false,
  implementation_identity: { adapter_config_id: "a", name: "Impl", cli_provider: "codex", default_model: "m" },
  validator_identity: { adapter_config_id: "b", name: "Val", cli_provider: "codex", default_model: "m" },
  policy_id: "p",
  policy_version: 1,
  policy_snapshot: { policy_id: "p", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: [] } },
  policy_snapshot_hash: "sha256:x",
  created_at: "2026-01-01T00:00:00Z",
};

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ValidationInspectorSection issueId="iss_1" />
    </QueryClientProvider>,
  );
}

describe("T092 Evidence Summary export (Copy/Download)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue({
      issue_id: "iss_1",
      status: IssueStatus.Done,
      current_round: null,
      completed_failed_rounds: 0,
      max_rounds: 3,
      active_validator_run: null,
      latest_result: null,
      latest_findings: [],
      blocker: null,
      evidence_summary: EVIDENCE_SUMMARY,
    });
    vi.mocked(apiClient.runs.listByIssue).mockResolvedValue({ runs: [] });
    vi.mocked(apiClient.threads.getEvents).mockResolvedValue({ events: [] });
  });

  it("copies the evidence summary markdown to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderSection();
    await waitFor(() => expect(screen.getByText(/MY_MARKDOWN_BODY/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("MY_MARKDOWN_BODY")));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("downloads the evidence summary markdown as a file", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderSection();
    await waitFor(() => expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
