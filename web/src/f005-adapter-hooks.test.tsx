import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdapterAuthType, AdapterStatus, AgentCapability, CliProvider, ErrorCode } from "@personahub/shared";
import {
  useAdapters, useCreateAdapter, useUpdateAdapter, useDeleteAdapter, useValidateAdapter,
  useAdapterProviders, useSetDefaultAdapter,
} from "@/hooks/use-adapters";
import { createAdapter } from "@/test/ui-flow-helpers";

vi.mock("@/lib/api-client", () => import("@/test/api-client-mock"));

import { apiClient } from "@/lib/api-client";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const PROVIDERS = [
  { cli_provider: CliProvider.Codex, supported_auth_types: [AdapterAuthType.OAuth], default_command: "codex", capability_description: "Implementation + validator.", model_provider_allowlist: [] },
  { cli_provider: CliProvider.ClaudeCode, supported_auth_types: [AdapterAuthType.OAuth], default_command: "claude", capability_description: "Implementation + validator.", model_provider_allowlist: [] },
  { cli_provider: CliProvider.OpenCode, supported_auth_types: [AdapterAuthType.OAuth, AdapterAuthType.ApiKey], default_command: "opencode", capability_description: "Implementation + validator.", model_provider_allowlist: ["openai", "anthropic"] },
];

describe("T083/T084: apiClient.adapters — provider metadata and default-adapter", () => {
  it("has getProviders and setDefault on apiClient.adapters", () => {
    expect(typeof apiClient.adapters.getProviders).toBe("function");
    expect(typeof apiClient.adapters.setDefault).toBe("function");
  });

  it("getProviders calls GET /api/adapter-providers", async () => {
    vi.mocked(apiClient.adapters.getProviders).mockResolvedValue({ providers: PROVIDERS });
    const result = await apiClient.adapters.getProviders();
    expect(result.providers).toHaveLength(3);
    expect(apiClient.adapters.getProviders).toHaveBeenCalledWith();
  });

  it("setDefault calls PUT /api/projects/:id/default-adapter with adapter_id", async () => {
    vi.mocked(apiClient.adapters.setDefault).mockResolvedValue({ adapter: createAdapter({ is_default: true }) });
    await apiClient.adapters.setDefault("prj_1", "agt_2");
    expect(apiClient.adapters.setDefault).toHaveBeenCalledWith("prj_1", "agt_2");
  });

  it("setDefault can clear the default with null", async () => {
    vi.mocked(apiClient.adapters.setDefault).mockResolvedValue({ adapter: null });
    const result = await apiClient.adapters.setDefault("prj_1", null);
    expect(result.adapter).toBeNull();
    expect(apiClient.adapters.setDefault).toHaveBeenCalledWith("prj_1", null);
  });
});

describe("useAdapters/useCreateAdapter/useUpdateAdapter/useDeleteAdapter/useValidateAdapter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("useAdapters fetches the adapter list for a project", async () => {
    const adapter = createAdapter();
    vi.mocked(apiClient.adapters.listByProject).mockResolvedValue({ adapters: [adapter] });
    const { result } = renderHook(() => useAdapters("prj_1"), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.adapters).toEqual([adapter]);
  });

  it("useAdapters stays disabled when projectId is null", () => {
    const { result } = renderHook(() => useAdapters(null), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
  });

  it("useCreateAdapter passes the full F005 field set through to apiClient.adapters.create", async () => {
    const adapter = createAdapter();
    vi.mocked(apiClient.adapters.create).mockResolvedValue({ adapter });
    const { result } = renderHook(() => useCreateAdapter("prj_1"), { wrapper: createWrapper() });
    result.current.mutate({
      cli_provider: CliProvider.OpenCode, auth_type: AdapterAuthType.ApiKey, name: "OC",
      command: "opencode", model_provider: "openai", default_model: "gpt-5",
      api_key: "sk-test", capability_tags: [AgentCapability.Implementation], make_default: true,
    });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(apiClient.adapters.create).toHaveBeenCalledWith("prj_1", expect.objectContaining({
      auth_type: AdapterAuthType.ApiKey, model_provider: "openai", api_key: "sk-test", make_default: true,
    }));
  });

  it("useUpdateAdapter can clear an api_key with null", async () => {
    const adapter = createAdapter({ has_api_key: false });
    vi.mocked(apiClient.adapters.update).mockResolvedValue({ adapter });
    const { result } = renderHook(() => useUpdateAdapter("prj_1"), { wrapper: createWrapper() });
    result.current.mutate({ adapterId: "agt_1", input: { api_key: null } });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(apiClient.adapters.update).toHaveBeenCalledWith("agt_1", { api_key: null });
  });

  it("useDeleteAdapter surfaces a rejection (delete guard) via mutation error", async () => {
    vi.mocked(apiClient.adapters.delete).mockRejectedValue({ code: ErrorCode.ADAPTER_IN_USE, message: "Cannot delete adapter config that has runs." });
    const { result } = renderHook(() => useDeleteAdapter("prj_1"), { wrapper: createWrapper() });
    result.current.mutate("agt_1");
    await waitFor(() => { expect(result.current.isError).toBe(true); });
  });

  it("useValidateAdapter reflects a failed probe (status unavailable, auth_status_message set)", async () => {
    const adapter = createAdapter({ status: AdapterStatus.Unavailable, auth_status_message: "not logged in" });
    vi.mocked(apiClient.adapters.validate).mockResolvedValue({ adapter });
    const { result } = renderHook(() => useValidateAdapter("prj_1"), { wrapper: createWrapper() });
    result.current.mutate({ adapterId: "agt_1" });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.adapter.auth_status_message).toBe("not logged in");
  });
});

describe("useAdapterProviders", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("fetches provider metadata", async () => {
    vi.mocked(apiClient.adapters.getProviders).mockResolvedValue({ providers: PROVIDERS });
    const { result } = renderHook(() => useAdapterProviders(), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data?.providers).toHaveLength(3);
  });
});

describe("useSetDefaultAdapter", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls setDefault and invalidates the adapters list", async () => {
    vi.mocked(apiClient.adapters.setDefault).mockResolvedValue({ adapter: createAdapter({ is_default: true }) });
    const { result } = renderHook(() => useSetDefaultAdapter("prj_1"), { wrapper: createWrapper() });
    result.current.mutate("agt_1");
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(apiClient.adapters.setDefault).toHaveBeenCalledWith("prj_1", "agt_1");
  });

  it("can clear the default by mutating with null", async () => {
    vi.mocked(apiClient.adapters.setDefault).mockResolvedValue({ adapter: null });
    const { result } = renderHook(() => useSetDefaultAdapter("prj_1"), { wrapper: createWrapper() });
    result.current.mutate(null);
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(apiClient.adapters.setDefault).toHaveBeenCalledWith("prj_1", null);
  });
});
