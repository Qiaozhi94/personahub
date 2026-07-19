import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResetRoundsDialog } from "@/components/inspector/ResetRoundsDialog";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("ResetRoundsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Reset Rounds when the note is empty", () => {
    render(
      <Wrapper>
        <ResetRoundsDialog issueId="iss_1" open onOpenChange={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByRole("button", { name: /reset rounds/i })).toBeDisabled();
  });

  it("calls resetRounds on submit and closes on success", async () => {
    vi.mocked(apiClient.validation.resetRounds).mockResolvedValue({} as never);
    const onOpenChange = vi.fn();

    render(
      <Wrapper>
        <ResetRoundsDialog issueId="iss_1" open onOpenChange={onOpenChange} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Granting more rounds" } });
    fireEvent.click(screen.getByRole("button", { name: /reset rounds/i }));

    await waitFor(() => {
      expect(apiClient.validation.resetRounds).toHaveBeenCalledWith("iss_1", "Granting more rounds");
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalled();
    });
  });

  it("shows a server error and keeps the dialog open", async () => {
    vi.mocked(apiClient.validation.resetRounds).mockRejectedValue(new Error("still blocked"));
    const onOpenChange = vi.fn();

    render(
      <Wrapper>
        <ResetRoundsDialog issueId="iss_1" open onOpenChange={onOpenChange} />
      </Wrapper>,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: /reset rounds/i }));

    await waitFor(() => {
      expect(screen.getByText(/still blocked/i)).toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
