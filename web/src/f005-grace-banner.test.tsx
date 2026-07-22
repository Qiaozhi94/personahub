import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { GraceValidatorBanner } from "@/components/thread/GraceValidatorBanner";
import { renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

describe("T093/T094: GraceValidatorBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when validation_dispatch_due_at is null", () => {
    const { container } = renderWithQuery(
      <GraceValidatorBanner issueId="iss_1" validationDispatchDueAt={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a countdown hint and the exact button label 'Start automatic validator now' (never 'Use default now')", () => {
    const dueAt = new Date(Date.now() + 8000).toISOString();
    renderWithQuery(<GraceValidatorBanner issueId="iss_1" validationDispatchDueAt={dueAt} />);
    expect(screen.getByRole("button", { name: "Start automatic validator now" })).toBeInTheDocument();
    expect(screen.queryByText(/use default now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/project default/i)).not.toBeInTheDocument();
  });

  it("clicking the button calls triggerValidation (POST /api/issues/:id/validation, ValidatorSelector path)", async () => {
    vi.mocked(apiClient.validation.triggerValidation).mockResolvedValue({ run: {} } as never);
    const dueAt = new Date(Date.now() + 8000).toISOString();
    renderWithQuery(<GraceValidatorBanner issueId="iss_1" validationDispatchDueAt={dueAt} />);

    fireEvent.click(screen.getByRole("button", { name: "Start automatic validator now" }));

    await waitFor(() => {
      expect(apiClient.validation.triggerValidation).toHaveBeenCalledWith("iss_1");
    });
  });

  it("shows an error message when the mutation fails", async () => {
    vi.mocked(apiClient.validation.triggerValidation).mockRejectedValue({ code: "VALIDATOR_UNAVAILABLE", message: "No validator adapter is available." });
    const dueAt = new Date(Date.now() + 8000).toISOString();
    renderWithQuery(<GraceValidatorBanner issueId="iss_1" validationDispatchDueAt={dueAt} />);

    fireEvent.click(screen.getByRole("button", { name: "Start automatic validator now" }));

    await waitFor(() => {
      expect(screen.getByText("No validator adapter is available.")).toBeInTheDocument();
    });
  });

  it("counts down toward zero and shows 'any moment now' once due has passed", () => {
    const dueAt = new Date(Date.now() + 3000).toISOString();
    renderWithQuery(<GraceValidatorBanner issueId="iss_1" validationDispatchDueAt={dueAt} />);
    expect(screen.getByText(/~3s|~2s/)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText(/any moment now/)).toBeInTheDocument();
  });
});
