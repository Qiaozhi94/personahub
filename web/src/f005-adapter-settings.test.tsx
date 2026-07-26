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

  // Final-comprehensive-report regression: clearing args/default model in
  // the edit dialog used to convert the empty value to `undefined`, which
  // the server interprets as "omitted -> preserve the existing value" —
  // the clear silently did nothing even though the dialog appeared to save.
  it("clearing args and default model on edit sends [] / null, not undefined (so the server actually clears them)", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "Codex", cli_provider: CliProvider.Codex,
      args: ["--quiet"], default_model: "gpt-5",
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.adapters.update).mockResolvedValue({ adapter: { ...adapter, args: [], default_model: null } });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Codex" }));
    await waitFor(() => { expect(screen.getByLabelText(/Arguments/)).toHaveValue("--quiet"); });

    fireEvent.change(screen.getByLabelText(/Arguments/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Default model/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.adapters.update).toHaveBeenCalledWith("agt_1", expect.objectContaining({
        args: [],
        default_model: null,
      }));
    });
  });
});

describe("T087/T088: Adapter list — provider/model/capability/auth/status/default badge/set default/delete guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.adapters.getProviders).mockResolvedValue({ providers: PROVIDERS });
  });

  // Final-comprehensive-report regression: the warning only checked
  // capability_tags, not status — so a validator-capable adapter that's
  // Unknown/Unavailable made the warning disappear even though the
  // automatic ValidatorSelector (status=available AND capability=validator)
  // would still Block auto-validation.
  it("shows a distinct warning when the only validator-capable adapter is not available", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "Codex", cli_provider: CliProvider.Codex,
      capability_tags: [AgentCapability.Validator], status: AdapterStatus.Unavailable,
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Codex")).toBeInTheDocument(); });
    expect(screen.queryByText(/^No validator configured/)).not.toBeInTheDocument();
    expect(screen.getByText(/Validator configured but not currently available/)).toBeInTheDocument();
  });

  it("shows no validator warning at all when an available validator-capable adapter exists", async () => {
    const adapter = createAdapter({
      id: "agt_1", name: "Codex", cli_provider: CliProvider.Codex,
      capability_tags: [AgentCapability.Validator], status: AdapterStatus.Available,
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Codex")).toBeInTheDocument(); });
    expect(screen.queryByText(/^No validator configured/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Validator configured but not currently available/)).not.toBeInTheDocument();
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

  // F005 workspace-aware availability closure: once a workspace is bound,
  // the list is scoped to it and the badge reflects the workspace-effective
  // status (which can legitimately differ from the Project-global baseline
  // the review flagged as never being surfaced anywhere in the UI before).
  it("shows the workspace-effective status (not the raw global baseline) and an override indicator when they differ", async () => {
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({
      workspace: { id: "wsp_1", project_id: "prj_1", local_path: "/tmp/x", git_branch: null, lock_state: "idle", locked_by_run_id: null, locked_at: null, push_credentials_enabled: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    } as never);
    const adapter = createAdapter({
      id: "agt_1", name: "OpenCode", status: AdapterStatus.Unknown,
      effective_status: AdapterStatus.Available, has_workspace_override: true,
    });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(apiClient.adapters.listByProject).toHaveBeenCalledWith("prj_1", "wsp_1"); });
    expect(screen.getByText("available")).toBeInTheDocument();
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
    expect(screen.getByText("workspace override")).toBeInTheDocument();
  });

  it("Revalidate sends the bound workspace's id to apiClient.adapters.validate", async () => {
    vi.mocked(apiClient.workspaces.getByProject).mockResolvedValue({
      workspace: { id: "wsp_1", project_id: "prj_1", local_path: "/tmp/x", git_branch: null, lock_state: "idle", locked_by_run_id: null, locked_at: null, push_credentials_enabled: true, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    } as never);
    const adapter = createAdapter({ id: "agt_1", name: "Codex" });
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    vi.mocked(apiClient.adapters.validate).mockResolvedValue({ adapter });
    renderWithQuery(<AdapterSettings projectId="prj_1" />);

    await waitFor(() => { expect(screen.getByText("Codex")).toBeInTheDocument(); });
    fireEvent.click(screen.getByTitle("Revalidate"));

    await waitFor(() => { expect(apiClient.adapters.validate).toHaveBeenCalledWith("agt_1", "wsp_1"); });
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
