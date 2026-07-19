import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AdapterConfigCreateInput, CliProvider } from "@personahub/shared";
import { AdapterSettings } from "@/components/adapter/AdapterSettings";
import { createAdapter, renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

describe("AdapterSettings - role configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes role selector in create form", async () => {
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
    vi.mocked(apiClient.adapters.create).mockResolvedValue({
      adapter: createAdapter({ role: "validator" }),
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => {
      expect(screen.getByText("No adapter configured")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure adapter" }));

    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /role/i })).toBeInTheDocument();
  });

  it("creates adapter with validator role", async () => {
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
    vi.mocked(apiClient.adapters.create).mockResolvedValue({
      adapter: createAdapter({ role: "validator" }),
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => {
      expect(screen.getByText("No adapter configured")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure adapter" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Validator" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "validator" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(apiClient.adapters.create).toHaveBeenCalledWith("prj_1", expect.objectContaining({
        cli_provider: CliProvider.Codex,
        name: "Validator",
        command: "codex",
        role: "validator",
      } satisfies Partial<AdapterConfigCreateInput>));
    });
  });

  it("shows role in adapter list", async () => {
    const implAdapter = createAdapter({ id: "agt_1", name: "Codex Impl", role: "implementation" });
    const valAdapter = createAdapter({ id: "agt_2", name: "Codex Reviewer", role: "validator" });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [implAdapter, valAdapter],
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => {
      expect(screen.getByText("Codex Impl")).toBeInTheDocument();
      expect(screen.getByText("Codex Reviewer")).toBeInTheDocument();
    });
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getByText("validator")).toBeInTheDocument();
  });

  it("shows warning when no validator is configured", async () => {
    const implAdapter = createAdapter({ id: "agt_1", name: "Codex Impl", role: "implementation" });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [implAdapter],
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => {
      expect(screen.getByText(/no validator configured/i)).toBeInTheDocument();
    });
  });

  it("does not show validator warning when validator exists", async () => {
    const valAdapter = createAdapter({ id: "agt_1", name: "Reviewer", role: "validator" });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({
      adapters: [valAdapter],
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => {
      expect(screen.getByText("Reviewer")).toBeInTheDocument();
    });
    expect(screen.queryByText(/no validator configured/i)).not.toBeInTheDocument();
  });

  it("allows editing role on existing adapter", async () => {
    const adapter = createAdapter({ id: "agt_1", name: "Codex", role: "implementation" });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.adapters.update).mockResolvedValue({
      adapter: { ...adapter, role: "validator" },
    });

    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => {
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "validator" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.adapters.update).toHaveBeenCalledWith("agt_1", expect.objectContaining({
        role: "validator",
      }));
    });
  });
});
