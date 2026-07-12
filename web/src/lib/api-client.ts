import {
  ErrorCode,
  type ApiError,
  type IssueCreateInput,
  type IssueCreateResponse,
  type IssueGetResponse,
  type IssueListResponse,
  type ProjectCreateResponse,
  type ProjectGetResponse,
  type ProjectListResponse,
  type ThreadEventListResponse,
  type ThreadGetResponse,
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
  return res.json() as Promise<T>;
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
};
