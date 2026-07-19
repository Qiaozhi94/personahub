import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnblockDialog } from "@/components/inspector/UnblockDialog";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("UnblockDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog with textarea when open", () => {
    render(
      <Wrapper>
        <UnblockDialog issueId="iss_1" open onOpenChange={vi.fn()} />
      </Wrapper>
    );

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unblock/i })).toBeInTheDocument();
  });

  it("disables submit when note is empty", () => {
    render(
      <Wrapper>
        <UnblockDialog issueId="iss_1" open onOpenChange={vi.fn()} />
      </Wrapper>
    );

    const button = screen.getByRole("button", { name: /unblock/i });
    expect(button).toBeDisabled();
  });

  it("enables submit when note is non-empty", () => {
    render(
      <Wrapper>
        <UnblockDialog issueId="iss_1" open onOpenChange={vi.fn()} />
      </Wrapper>
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Fixed config" } });
    expect(screen.getByRole("button", { name: /unblock/i })).toBeEnabled();
  });

  it("calls unblock mutation on submit and closes on success", async () => {
    vi.mocked(apiClient.validation.unblock).mockResolvedValue({} as never);
    const onOpenChange = vi.fn();

    render(
      <Wrapper>
        <UnblockDialog issueId="iss_1" open onOpenChange={onOpenChange} />
      </Wrapper>
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Fixed validator config" } });
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));

    await waitFor(() => {
      expect(apiClient.validation.unblock).toHaveBeenCalledWith("iss_1", "Fixed validator config");
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalled();
    });
  });

  it("shows error on server conflict", async () => {
    vi.mocked(apiClient.validation.unblock).mockRejectedValue({
      code: "INVALID_ISSUE_TRANSITION",
      message: "Issue is not blocked by validation",
    });

    render(
      <Wrapper>
        <UnblockDialog issueId="iss_1" open onOpenChange={vi.fn()} />
      </Wrapper>
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Trying..." } });
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));

    await waitFor(() => {
      expect(screen.getByText(/issue is not blocked by validation/i)).toBeInTheDocument();
    });
  });

  it("does not automatically trigger a new Run or validation after unblock", async () => {
    vi.mocked(apiClient.validation.unblock).mockResolvedValue({} as never);
    vi.mocked(apiClient.runs.create).mockResolvedValue({} as never);
    vi.mocked(apiClient.validation.triggerValidation).mockResolvedValue({} as never);

    render(
      <Wrapper>
        <UnblockDialog issueId="iss_1" open onOpenChange={vi.fn()} />
      </Wrapper>
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Fixed" } });
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));

    await waitFor(() => {
      expect(apiClient.validation.unblock).toHaveBeenCalled();
    });
    expect(apiClient.runs.create).not.toHaveBeenCalled();
  });
});
