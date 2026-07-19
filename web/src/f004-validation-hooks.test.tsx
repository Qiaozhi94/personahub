import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IssueStatus, ValidationOutcome } from "@personahub/shared";
import { useValidationStatus, useEvidenceSummary, useUnblock, useTriggerValidation } from "@/hooks/use-validation";

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

describe("apiClient.validation", () => {
  it("has validation namespace on apiClient", () => {
    expect(apiClient.validation).toBeDefined();
    expect(typeof apiClient.validation.getValidation).toBe("function");
    expect(typeof apiClient.validation.getEvidenceSummary).toBe("function");
    expect(typeof apiClient.validation.unblock).toBe("function");
    expect(typeof apiClient.validation.triggerValidation).toBe("function");
  });

  it("getValidation calls GET /api/issues/:id/validation", async () => {
    const mockResponse = {
      issue_id: "iss_1", status: IssueStatus.Validating, current_round: 1,
      completed_failed_rounds: 0, max_rounds: 3, active_validator_run: null,
      latest_result: null, latest_findings: [], blocker: null, evidence_summary: null,
    };
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue(mockResponse);
    const result = await apiClient.validation.getValidation("iss_1");
    expect(result).toEqual(mockResponse);
    expect(apiClient.validation.getValidation).toHaveBeenCalledWith("iss_1");
  });

  it("getEvidenceSummary calls GET /api/issues/:id/evidence-summary", async () => {
    const mockResponse = {
      evidence_summary: {
        id: "evs_1", issue_id: "iss_1", thread_id: "thr_1", validator_run_id: "run_v",
        implementation_run_id: "run_imp", validation_result: ValidationOutcome.Passed,
        evidence_refs: [], summary_markdown: "# Summary", same_origin_validation: true,
        implementation_identity: { adapter_config_id: "a", name: "X", cli_provider: "codex", default_model: "gpt-5" },
        validator_identity: { adapter_config_id: "a", name: "X", cli_provider: "codex", default_model: "gpt-5" },
        policy_id: "vpl_1", policy_version: 1,
        policy_snapshot: { policy_id: "vpl_1", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: [] } },
        policy_snapshot_hash: "sha256:abc", created_at: "2026-07-19T00:00:00.000Z",
      },
    };
    vi.mocked(apiClient.validation.getEvidenceSummary).mockResolvedValue(mockResponse);
    const result = await apiClient.validation.getEvidenceSummary("iss_1");
    expect(result).toEqual(mockResponse);
    expect(apiClient.validation.getEvidenceSummary).toHaveBeenCalledWith("iss_1");
  });

  it("unblock calls POST /api/issues/:id/unblock", async () => {
    vi.mocked(apiClient.validation.unblock).mockResolvedValue({} as never);
    await apiClient.validation.unblock("iss_1", "Resolved manually");
    expect(apiClient.validation.unblock).toHaveBeenCalledWith("iss_1", "Resolved manually");
  });

  it("triggerValidation calls POST /api/issues/:id/validation", async () => {
    const mockResponse = {
      issue_id: "iss_1", status: IssueStatus.Validating, current_round: 1,
      completed_failed_rounds: 0, max_rounds: 3, active_validator_run: null,
      latest_result: null, latest_findings: [], blocker: null, evidence_summary: null,
    };
    vi.mocked(apiClient.validation.triggerValidation).mockResolvedValue(mockResponse);
    const result = await apiClient.validation.triggerValidation("iss_1");
    expect(result).toEqual(mockResponse);
    expect(apiClient.validation.triggerValidation).toHaveBeenCalledWith("iss_1");
  });
});

describe("useValidationStatus", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns loading state initially", () => {
    vi.mocked(apiClient.validation.getValidation).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useValidationStatus("iss_1"), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it("fetches validation status when issueId is non-null", async () => {
    const mockData = {
      issue_id: "iss_1", status: IssueStatus.Running, current_round: null,
      completed_failed_rounds: 0, max_rounds: 3, active_validator_run: null,
      latest_result: null, latest_findings: [], blocker: null, evidence_summary: null,
    };
    vi.mocked(apiClient.validation.getValidation).mockResolvedValue(mockData);
    const { result } = renderHook(() => useValidationStatus("iss_1"), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual(mockData);
  });

  it("stays disabled when issueId is null", () => {
    const { result } = renderHook(() => useValidationStatus(null), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useEvidenceSummary", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("fetches evidence summary when issueId is set", async () => {
    const mockData = {
      evidence_summary: {
        id: "evs_1", issue_id: "iss_1", thread_id: "thr_1", validator_run_id: "run_v",
        implementation_run_id: "run_imp", validation_result: ValidationOutcome.Passed,
        evidence_refs: [], summary_markdown: "# Summary", same_origin_validation: false,
        implementation_identity: { adapter_config_id: "a", name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
        validator_identity: { adapter_config_id: "b", name: "Val", cli_provider: "codex", default_model: "gpt-5-turbo" },
        policy_id: "vpl_1", policy_version: 1,
        policy_snapshot: { policy_id: "vpl_1", version: 1, max_validation_rounds: 3, evidence_requirements: { require_handoff: true, require_file_trace: true, require_verification: true, accepted_verification_kinds: [] } },
        policy_snapshot_hash: "sha256:abc", created_at: "2026-07-19T00:00:00.000Z",
      },
    };
    vi.mocked(apiClient.validation.getEvidenceSummary).mockResolvedValue(mockData);
    const { result } = renderHook(() => useEvidenceSummary("iss_1"), { wrapper: createWrapper() });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(result.current.data).toEqual(mockData);
  });

  it("stays disabled when issueId is null", () => {
    const { result } = renderHook(() => useEvidenceSummary(null), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useUnblock", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls unblock mutation and resolves on success", async () => {
    vi.mocked(apiClient.validation.unblock).mockResolvedValue({} as never);
    const { result } = renderHook(() => useUnblock("iss_1"), { wrapper: createWrapper() });
    result.current.mutate({ operator_note: "Fixed validator config" });
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(apiClient.validation.unblock).toHaveBeenCalledWith("iss_1", "Fixed validator config");
  });
});

describe("useTriggerValidation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls triggerValidation and resolves on success", async () => {
    const mockData = {
      issue_id: "iss_1", status: IssueStatus.Validating, current_round: 1,
      completed_failed_rounds: 0, max_rounds: 3, active_validator_run: null,
      latest_result: null, latest_findings: [], blocker: null, evidence_summary: null,
    };
    vi.mocked(apiClient.validation.triggerValidation).mockResolvedValue(mockData);
    const { result } = renderHook(() => useTriggerValidation("iss_1"), { wrapper: createWrapper() });
    result.current.mutate();
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); });
    expect(apiClient.validation.triggerValidation).toHaveBeenCalledWith("iss_1");
  });
});
