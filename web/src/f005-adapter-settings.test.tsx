import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AdapterAuthType, AgentCapability, CliProvider, AdapterStatus } from "@personahub/shared";
import { AdapterSettings } from "@/components/adapter/AdapterSettings";
import { createAdapter, renderWithQuery } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

const PROVIDERS = [
  { cli_provider: CliProvider.Codex, supported_auth_types: [AdapterAuthType.OAuth], default_command: "codex", capability_description: "Implementation + validator.", model_provider_allowlist: [] },
  { cli_provider: CliProvider.ClaudeCode, supported_auth_types: [AdapterAuthType.OAuth], default_command: "claude", capability_description: "Implementation + validator.", model_provider_allowlist: [] },
  { cli_provider: CliProvider.OpenCode, supported_auth_types: [AdapterAuthType.OAuth, AdapterAuthType.ApiKey], default_command: "opencode", capability_description: "Implementation + validator. No pre-execution approval channel.", model_provider_allowlist: ["openai", "anthropic"] },
];

async function openCreateDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Configure adapter" }));
  await waitFor(() => { expect(screen.getByLabelText("Provider")).toBeInTheDocument(); });
}

describe("T085/T086: Adapter dialog — provider/auth cascade and capability checkboxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.adapters.getProviders).mockResolvedValue({ providers: PROVIDERS });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [] });
  });

  it("shows a provider select and defaults to Codex with only Implementation/Validator capability checkboxes (no Consult)", async () => {
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => { expect(screen.getByText("No adapter configured")).toBeInTheDocument(); });
    await openCreateDialog();

    expect(screen.getByLabelText("Provider")).toHaveValue(CliProvider.Codex);
    expect(screen.getByLabelText("Implementation")).toBeInTheDocument();
    expect(screen.getByLabelText("Validator")).toBeInTheDocument();
    expect(screen.queryByLabelText(/consult/i)).not.toBeInTheDocument();
    // Codex only supports OAuth — no auth-type select shown, no API key field
    expect(screen.queryByLabelText("Auth type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("shows an honest per-provider capability note (e.g. OpenCode has no pre-execution approval channel)", async () => {
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => { expect(screen.getByText("No adapter configured")).toBeInTheDocument(); });
    await openCreateDialog();

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: CliProvider.OpenCode } });
    expect(screen.getByText(/no pre-execution approval channel/i)).toBeInTheDocument();
  });

  it("switching provider to OpenCode reveals the auth-type select and, in api_key mode, model provider + API key fields", async () => {
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => { expect(screen.getByText("No adapter configured")).toBeInTheDocument(); });
    await openCreateDialog();

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: CliProvider.OpenCode } });
    expect(screen.getByLabelText("Auth type")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Auth type"), { target: { value: AdapterAuthType.ApiKey } });
    expect(screen.getByLabelText("Model provider")).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Model provider")).getByText("openai")).toBeInTheDocument();
  });

  it("OAuth mode shows a copyable login command and never shows an API key field", async () => {
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => { expect(screen.getByText("No adapter configured")).toBeInTheDocument(); });
    await openCreateDialog();

    expect(screen.getByText("codex login")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("creates an OpenCode API-key adapter with model_provider/default_model/api_key/capability_tags", async () => {
    vi.mocked(apiClient.adapters.create).mockResolvedValue({ adapter: createAdapter({ cli_provider: CliProvider.OpenCode }) });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => { expect(screen.getByText("No adapter configured")).toBeInTheDocument(); });
    await openCreateDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "OpenCode" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "opencode" } });
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: CliProvider.OpenCode } });
    fireEvent.change(screen.getByLabelText("Auth type"), { target: { value: AdapterAuthType.ApiKey } });
    fireEvent.change(screen.getByLabelText("Model provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("Default model"), { target: { value: "gpt-5" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByLabelText("Validator"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(apiClient.adapters.create).toHaveBeenCalledWith("prj_1", expect.objectContaining({
        cli_provider: CliProvider.OpenCode,
        auth_type: AdapterAuthType.ApiKey,
        name: "OpenCode",
        command: "opencode",
        model_provider: "openai",
        default_model: "gpt-5",
        api_key: "sk-test-key",
        capability_tags: expect.arrayContaining([AgentCapability.Implementation, AgentCapability.Validator]),
      }));
    });
  });

  it("editing an adapter locks the provider select and never pre-fills the API key input", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "OC", cli_provider: CliProvider.OpenCode,
      auth_type: AdapterAuthType.ApiKey, model_provider: "openai", has_api_key: true,
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "OC" }));

    await waitFor(() => { expect(screen.getByLabelText("Provider")).toBeInTheDocument(); });
    expect(screen.getByLabelText("Provider")).toBeDisabled();
    expect(screen.getByText("Configured ••••")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("clearing a configured API key sends api_key:null, not the empty string", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "OC", cli_provider: CliProvider.OpenCode,
      auth_type: AdapterAuthType.ApiKey, model_provider: "openai", has_api_key: true,
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.adapters.update).mockResolvedValue({ adapter: { ...adapter, has_api_key: false } });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "OC" }));
    await waitFor(() => { expect(screen.getByText("Configured ••••")).toBeInTheDocument(); });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.adapters.update).toHaveBeenCalledWith("agt_1", expect.objectContaining({ api_key: null }));
    });
  });
});

describe("T087/T088: Adapter list — provider/model/capability/auth/status/default badge/set default/delete guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.adapters.getProviders).mockResolvedValue({ providers: PROVIDERS });
  });

  it("shows provider, model, capabilities, auth indicator, status, and last_checked_at", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "Codex", cli_provider: CliProvider.Codex, default_model: "gpt-5",
      capability_tags: [AgentCapability.Implementation, AgentCapability.Validator],
      status: AdapterStatus.Available, last_checked_at: "2026-07-19T00:00:00.000Z",
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Codex")).toBeInTheDocument(); });
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getByText("validator")).toBeInTheDocument();
    expect(screen.getByText("OAuth")).toBeInTheDocument();
    expect(screen.getByText("available")).toBeInTheDocument();
    expect(screen.getByText(/checked/)).toBeInTheDocument();
  });

  it("shows the sanitized auth_status_message when unavailable", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "Codex", status: AdapterStatus.Unavailable,
      auth_status_message: "not logged in",
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    await waitFor(() => { expect(screen.getByText("not logged in")).toBeInTheDocument(); });
  });

  it("shows a Default badge on the Project default adapter and a 'Set as default' action on others", async () => {
    const defaultAdapter = createAdapter({ id: "agt_1", name: "Primary", is_default: true });
    const otherAdapter = createAdapter({ id: "agt_2", name: "Secondary", is_default: false, status: AdapterStatus.Available });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [defaultAdapter, otherAdapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Primary")).toBeInTheDocument(); });
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set as default" })).toBeInTheDocument();
  });

  it("clicking 'Set as default' calls apiClient.adapters.setDefault", async () => {
    const otherAdapter = createAdapter({ id: "agt_2", name: "Secondary", is_default: false, status: AdapterStatus.Available });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [otherAdapter] });
    vi.mocked(apiClient.adapters.setDefault).mockResolvedValue({ adapter: { ...otherAdapter, is_default: true } });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Secondary")).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));

    await waitFor(() => {
      expect(apiClient.adapters.setDefault).toHaveBeenCalledWith("prj_1", "agt_2");
    });
  });

  it("does not show 'Set as default' for an unavailable adapter", async () => {
    const adapter = createAdapter({ id: "agt_1", name: "Broken", status: AdapterStatus.Unavailable, is_default: false });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Broken")).toBeInTheDocument(); });
    expect(screen.queryByRole("button", { name: "Set as default" })).not.toBeInTheDocument();
  });

  it("surfaces a delete-guard error (ADAPTER_IN_USE) inline instead of silently failing", async () => {
    const adapter = createAdapter({ id: "agt_1", name: "Codex" });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.adapters.delete).mockRejectedValue({
      code: "ADAPTER_IN_USE", message: "Cannot delete adapter config that has runs.",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Codex")).toBeInTheDocument(); });
    fireEvent.click(screen.getByTitle("Delete"));

    await waitFor(() => {
      expect(screen.getByText("Cannot delete adapter config that has runs.")).toBeInTheDocument();
    });
  });
});
