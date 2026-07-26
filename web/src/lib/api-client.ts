import {
  ErrorCode,
  type AdapterConfigCreateInput,
  type AdapterConfigCreateResponse,
  type AdapterConfigListResponse,
  type AdapterConfigUpdateInput,
  type AdapterConfigUpdateResponse,
  type AdapterConfigValidateResponse,
  type AdapterProvidersResponse,
  type ProjectDefaultAdapterResponse,
  type ApiError,
  type EvidenceSummaryResponse,
  type IssueCreateInput,
  type IssueCreateResponse,
  type IssueGetResponse,
  type IssueListResponse,
  type IssueTraceResponse,
  type IssueValidationResponse,
  type TriggerValidationResponse,
  type ResetValidationRoundsResponse,
  type ProjectCreateResponse,
  type ProjectGetResponse,
  type ProjectListResponse,
  type RunCancelResponse,
  type RunCreateInput,
  type RunCreateResponse,
  type RunEvidenceResponse,
  type RunGetResponse,
  type RunListResponse,
  type ThreadEventListResponse,
  type ThreadGetResponse,
  type UnblockInput,
  type UnblockResponse,
  type WorkspaceBindResponse,
  type WorkspaceByIdResponse,
  type WorkspaceGetResponse,
} from "@personahub/shared";

const API_BASE = "/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const errorBody = await res
      .json()
      .catch(() => ({ error: { code: ErrorCode.INTERNAL_ERROR, message: "Unknown error" } }));
    throw errorBody.error as ApiError;
  }
  // 204 No Content (e.g. DELETE) has no body — res.json() throws a
  // SyntaxError on empty input, which previously surfaced as a false
  // mutation failure even though the server-side delete had succeeded.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function toApiError(error: unknown): ApiError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as ApiError;
  }
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : "Unknown error",
  };
}

export const apiClient = {
  projects: {
    create: (name: string, description?: string) =>
      apiFetch<ProjectCreateResponse>("/projects", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      }),
    list: () => apiFetch<ProjectListResponse>("/projects"),
    get: (id: string) => apiFetch<ProjectGetResponse>(`/projects/${id}`),
  },
  workspaces: {
    bind: (projectId: string, localPath: string) =>
      apiFetch<WorkspaceBindResponse>(`/projects/${projectId}/workspace`, {
        method: "PUT",
        body: JSON.stringify({ local_path: localPath }),
      }),
    getByProject: (projectId: string) =>
      apiFetch<WorkspaceGetResponse>(`/projects/${projectId}/workspace`),
    getById: (id: string) => apiFetch<WorkspaceByIdResponse>(`/workspaces/${id}`),
  },
  issues: {
    create: (projectId: string, input: IssueCreateInput) =>
      apiFetch<IssueCreateResponse>(`/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listByProject: (projectId: string) =>
      apiFetch<IssueListResponse>(`/projects/${projectId}/issues`),
    get: (id: string) => apiFetch<IssueGetResponse>(`/issues/${id}`),
  },
  threads: {
    get: (id: string) => apiFetch<ThreadGetResponse>(`/threads/${id}`),
    getEvents: (id: string, afterEventId?: string) =>
      apiFetch<ThreadEventListResponse>(
        `/threads/${id}/events${afterEventId ? `?after_event_id=${encodeURIComponent(afterEventId)}` : ""}`,
      ),
  },
  adapters: {
    create: (projectId: string, input: AdapterConfigCreateInput) =>
      apiFetch<AdapterConfigCreateResponse>(`/projects/${projectId}/adapters`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listByProject: (projectId: string, workspaceId?: string) =>
      apiFetch<AdapterConfigListResponse>(
        `/projects/${projectId}/adapters${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`,
      ),
    update: (adapterId: string, input: AdapterConfigUpdateInput) =>
      apiFetch<AdapterConfigUpdateResponse>(`/adapters/${adapterId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    delete: (adapterId: string) =>
      apiFetch<void>(`/adapters/${adapterId}`, { method: "DELETE" }),
    validate: (adapterId: string, workspaceId?: string) =>
      apiFetch<AdapterConfigValidateResponse>(`/adapters/${adapterId}/validate`, {
        method: "POST",
        body: JSON.stringify(workspaceId ? { workspace_id: workspaceId } : {}),
      }),
    getProviders: () => apiFetch<AdapterProvidersResponse>("/adapter-providers"),
    setDefault: (projectId: string, adapterId: string | null) =>
      apiFetch<ProjectDefaultAdapterResponse>(`/projects/${projectId}/default-adapter`, {
        method: "PUT",
        body: JSON.stringify({ adapter_id: adapterId }),
      }),
  },
  runs: {
    create: (issueId: string, input: RunCreateInput) =>
      apiFetch<RunCreateResponse>(`/issues/${issueId}/runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (runId: string) => apiFetch<RunGetResponse>(`/runs/${runId}`),
    listByIssue: (issueId: string) =>
      apiFetch<RunListResponse>(`/issues/${issueId}/runs`),
    cancel: (runId: string) =>
      apiFetch<RunCancelResponse>(`/runs/${runId}/cancel`, { method: "POST" }),
  },
  traces: {
    getIssueTrace: (issueId: string, afterEventId?: string, limit?: number) => {
      const params = new URLSearchParams();
      if (afterEventId) params.set("after_event_id", afterEventId);
      if (limit) params.set("limit", String(limit));
      const qs = params.toString();
      return apiFetch<IssueTraceResponse>(`/issues/${issueId}/trace${qs ? `?${qs}` : ""}`);
    },
    getRunEvidence: (
      runId: string,
      afterEventId?: string,
      afterFileChangeId?: string,
      eventLimit?: number,
      fileLimit?: number,
    ) => {
      const params = new URLSearchParams();
      if (afterEventId) params.set("after_event_id", afterEventId);
      if (afterFileChangeId) params.set("after_file_change_id", afterFileChangeId);
      if (eventLimit) params.set("event_limit", String(eventLimit));
      if (fileLimit) params.set("file_limit", String(fileLimit));
      const qs = params.toString();
      return apiFetch<RunEvidenceResponse>(`/runs/${runId}/evidence${qs ? `?${qs}` : ""}`);
    },
    exportMarkdown: async (issueId: string): Promise<{ blob: Blob; filename: string }> => {
      const res = await fetch(`${API_BASE}/issues/${issueId}/trace/export`);
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({ error: { code: ErrorCode.INTERNAL_ERROR, message: "Unknown error" } }));
        throw errorBody.error as ApiError;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] ?? "trace.md";
      const blob = await res.blob();
      return { blob, filename };
    },
  },
  validation: {
    getValidation: (issueId: string) =>
      apiFetch<IssueValidationResponse>(`/issues/${issueId}/validation`),
    getEvidenceSummary: (issueId: string) =>
      apiFetch<EvidenceSummaryResponse>(`/issues/${issueId}/evidence-summary`),
    unblock: (issueId: string, operatorNote: string) =>
      apiFetch<UnblockResponse>(`/issues/${issueId}/unblock`, {
        method: "POST",
        body: JSON.stringify({ operator_note: operatorNote } satisfies UnblockInput),
      }),
    resetRounds: (issueId: string, operatorNote: string) =>
      apiFetch<ResetValidationRoundsResponse>(`/issues/${issueId}/validation-rounds/reset`, {
        method: "POST",
        body: JSON.stringify({ operator_note: operatorNote } satisfies UnblockInput),
      }),
    triggerValidation: (issueId: string) =>
      apiFetch<TriggerValidationResponse>(`/issues/${issueId}/validation`, {
        method: "POST",
      }),
  },
};
