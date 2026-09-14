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
  type IssueGraphResponse,
  type GraphRunCancelResponse,
  type GraphNodeRetryResponse,
  type GraphResolveExecutorsResponse,
  type GraphStartResponse,
  type RecommendResponse,
  type ConfirmResponse,
  type ConfirmationToken,
  type ChosenPlan,
  type WorkflowTemplateListResponse,
  type WorkflowTemplateDetailResponse,
  type CreateWorkflowTemplateVersionInput,
  type CreateWorkflowTemplateVersionResponse,
  type ActivateWorkflowTemplateInput,
  type ActivateWorkflowTemplateResponse,
  type DeactivateWorkflowTemplateResponse,
  type RuntimeHealthResponse,
  type CreateArtifactInput,
  type ReviseArtifactInput,
  type ArtifactRevisionWriteResult,
  type ArtifactListRead,
  type ArtifactEntityRead,
  type ArtifactRevisionRead,
  type ArtifactProvenanceRead,
  type RunArtifactRead,
  type EvidenceArtifactRead,
  type SpaceListResponse,
  type SpaceCreateResponse,
  type SpaceActionResponse,
  type Repository,
  type RepositoryMachinePath,
  type RepositoryResolveResponse,
  type ProjectRepositoryRef,
  type Scope,
  type Skill,
  type SkillListItem,
  type SkillListResponse,
  type SkillRevisionListResponse,
  type SkillRevisionDetailResponse,
  type SkillRevisionFilesResponse,
  type SkillDeliveryListResponse,
  type EffectiveRequirementsResponse,
  type SkillScanResponse,
  type ProjectSkillRef,
  type Project,
  type Room,
  type RuntimeMachineProjection,
  type RoomResponse,
  type SessionMessageResponse,
  type ConvertToTaskResponse,
  type RoomCreateInput,
  type EligibilityResponse,
  type DispatchConfirmResponse,
  type DispatchGetResponse,
  type DispatchStartNowResponse,
  type AttemptCancelResponse,
  type GateUpdateInput,
  type GateResponse,
  type DispatchConfirmInput,
  type AdapterFactsResponse,
} from "@personahub/shared";

const API_BASE = "/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Only send `Content-Type: application/json` when there is a body. Sending it
  // on a bodyless POST (e.g. /runs/:id/cancel, /graph-runs/:id/cancel) makes
  // Fastify's JSON parser reject the empty body (FST_ERR_CTP_EMPTY_JSON_BODY).
  const hasBody = options?.body !== undefined && options?.body !== null;
  const init: RequestInit = { ...options };
  if (hasBody) init.headers = { "Content-Type": "application/json", ...options?.headers };
  const res = await fetch(`${API_BASE}${path}`, init);
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
  f012: {
    createRoom: (input: RoomCreateInput) =>
      apiFetch<{ room: Room }>("/rooms", { method: "POST", body: JSON.stringify(input) }),
    getRoom: (roomId: string, before?: number) =>
      apiFetch<RoomResponse>(`/rooms/${roomId}${before ? `?before=${before}` : ""}`),
    sendMessage: (roomId: string, body: string, idempotencyKey: string | null) =>
      apiFetch<SessionMessageResponse>(`/rooms/${roomId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      }),
    endRoom: (roomId: string) => apiFetch<{ room: Room }>(`/rooms/${roomId}/end`, { method: "POST" }),
    convertToTask: (roomId: string, input: { project_id?: string | null; goal: string }) =>
      apiFetch<ConvertToTaskResponse>(`/rooms/${roomId}/convert-to-task`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    eligibility: (roomId: string, purpose: string, contextScope: string, skillRefs: string[]) => {
      const params = new URLSearchParams({ purpose, context_scope: contextScope });
      for (const ref of skillRefs) params.append("skill_refs", ref);
      return apiFetch<EligibilityResponse>(`/rooms/${roomId}/eligibility?${params.toString()}`);
    },
    confirmDispatch: (roomId: string, input: DispatchConfirmInput, idempotencyKey: string) =>
      apiFetch<DispatchConfirmResponse>(`/rooms/${roomId}/dispatches`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    cancelDispatch: (dispatchId: string) =>
      apiFetch<DispatchConfirmResponse>(`/dispatches/${dispatchId}/cancel`, { method: "POST" }),
    startNow: (dispatchId: string) =>
      apiFetch<DispatchStartNowResponse>(`/dispatches/${dispatchId}/start-now`, { method: "POST" }),
    getDispatch: (dispatchId: string) => apiFetch<DispatchGetResponse>(`/dispatches/${dispatchId}`),
    cancelAttempt: (attemptId: string) =>
      apiFetch<AttemptCancelResponse>(`/attempts/${attemptId}/cancel`, { method: "POST" }),
    setGate: (scopeType: string, scopeId: string, input: GateUpdateInput) =>
      apiFetch<GateResponse>(`/gates/${scopeType}/${scopeId}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    runtimeMachine: (machineId: string) => apiFetch<RuntimeMachineProjection>(`/runtime/machines/${machineId}`),
    adapterFacts: (adapterConfigId: string) => apiFetch<AdapterFactsResponse>(`/runtime/adapters/${adapterConfigId}`),
  },
  spaces: {
    list: () => apiFetch<SpaceListResponse>("/spaces"),
    create: (name: string) =>
      apiFetch<SpaceCreateResponse>("/spaces", { method: "POST", body: JSON.stringify({ name }) }),
    select: (id: string) => apiFetch<SpaceActionResponse>(`/spaces/${id}/select`, { method: "POST" }),
    archive: (id: string) => apiFetch<SpaceActionResponse>(`/spaces/${id}/archive`, { method: "POST" }),
    restore: (id: string) => apiFetch<SpaceActionResponse>(`/spaces/${id}/restore`, { method: "POST" }),
  },
  repositories: {
    resolve: (source: string) =>
      apiFetch<RepositoryResolveResponse>("/repositories:resolve", {
        method: "POST",
        body: JSON.stringify({ source }),
      }),
    create: (source: string) =>
      apiFetch<{ repository: Repository }>("/repositories", {
        method: "POST",
        body: JSON.stringify({ source }),
      }),
    get: (repositoryId: string) =>
      apiFetch<{
        repository: Repository;
        machine_path: Omit<RepositoryMachinePath, "repository_id"> | null;
      }>(`/repositories/${repositoryId}`),
    authorize: (repositoryId: string, rawPath: string, access: "read_write" | "read_only", scope?: Scope) =>
      apiFetch<{ machine_path: unknown }>(`/repositories/${repositoryId}/authorize`, {
        method: "POST",
        body: JSON.stringify(scope === undefined ? { raw_path: rawPath, access } : { raw_path: rawPath, access, scope }),
      }),
    listByProject: (projectId: string) =>
      apiFetch<{ project_id: string; references: ProjectRepositoryRef[] }>(`/projects/${projectId}/repositories`),
    setForProject: (
      projectId: string,
      input: {
        primary?: { repository_id: string; access?: "read_write" | "read_only"; scope?: Scope } | null;
        references?: Array<{ repository_id: string; scope?: Scope }>;
      },
    ) =>
      apiFetch<{ project_id: string; references: ProjectRepositoryRef[] }>(`/projects/${projectId}/repositories`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
  },
  skills: {
    list: (spaceId?: string) =>
      apiFetch<SkillListResponse>(`/skills${spaceId ? `?space_id=${encodeURIComponent(spaceId)}` : ""}`),
    get: (id: string) => apiFetch<{ skill: Skill }>(`/skills/${id}`),
    revisions: (id: string) => apiFetch<SkillRevisionListResponse>(`/skills/${id}/revisions`),
    revisionDetail: (id: string, version: number) =>
      apiFetch<SkillRevisionDetailResponse>(`/skills/${id}/revisions/${version}`),
    files: (id: string, version: number) =>
      apiFetch<SkillRevisionFilesResponse>(`/skills/${id}/revisions/${version}/files`),
    delivery: (id: string, version: number) =>
      apiFetch<SkillDeliveryListResponse>(`/skills/${id}/revisions/${version}/delivery`),
    effectiveRequirements: (id: string, version?: number) =>
      apiFetch<EffectiveRequirementsResponse>(
        `/skills/${id}/effective-requirements${version ? `?version=${version}` : ""}`,
      ),
    scan: () => apiFetch<SkillScanResponse>("/skills:scan", { method: "POST" }),
    resolveConflict: (id: string, spaceId: string, keepSkillId: string) =>
      apiFetch<{ skills: SkillListItem[] }>(`/skills/${id}/resolve-conflict`, {
        method: "POST",
        body: JSON.stringify({ space_id: spaceId, keep_skill_id: keepSkillId }),
      }),
    activate: (id: string, version?: number) =>
      apiFetch<{ skill_id: string; version: number }>(`/skills/${id}/activate`, {
        method: "POST",
        body: JSON.stringify(version ? { version } : {}),
      }),
    disable: (id: string) => apiFetch<{ skill: Skill }>(`/skills/${id}/disable`, { method: "POST" }),
    setProjectDefault: (projectId: string, skillId: string | null, pinnedVersion?: number | null) =>
      apiFetch<{ project_id: string; skill_id: string | null; pinned_version: number | null }>(
        `/projects/${projectId}/default-skill`,
        { method: "PUT", body: JSON.stringify({ skill_id: skillId, pinned_version: pinnedVersion ?? null }) },
      ),
    listProjectRefs: (projectId: string) => apiFetch<{ refs: ProjectSkillRef[] }>(`/projects/${projectId}/skills`),
  },

  projects: {
    create: (name: string, description?: string) =>
      apiFetch<ProjectCreateResponse>("/projects", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      }),
    list: () => apiFetch<ProjectListResponse>("/projects"),
    get: (id: string) => apiFetch<ProjectGetResponse>(`/projects/${id}`),
    listBySpace: (spaceId?: string, includeArchived?: boolean) => {
      const params = new URLSearchParams();
      if (spaceId) params.set("space_id", spaceId);
      if (includeArchived) params.set("include_archived", "1");
      const query = params.toString();
      return apiFetch<ProjectListResponse>(`/projects${query ? `?${query}` : ""}`);
    },
    archive: (id: string) => apiFetch<{ project: Project }>(`/projects/${id}/archive`, { method: "POST" }),
    restore: (id: string) => apiFetch<{ project: Project }>(`/projects/${id}/restore`, { method: "POST" }),
    remove: (id: string) => apiFetch<null>(`/projects/${id}`, { method: "DELETE" }),
  },
  workspaces: {
    bind: (projectId: string, localPath: string) =>
      apiFetch<WorkspaceBindResponse>(`/projects/${projectId}/workspace`, {
        method: "PUT",
        body: JSON.stringify({ local_path: localPath }),
      }),
    getByProject: (projectId: string) => apiFetch<WorkspaceGetResponse>(`/projects/${projectId}/workspace`),
    getById: (id: string) => apiFetch<WorkspaceByIdResponse>(`/workspaces/${id}`),
  },
  issues: {
    create: (projectId: string, input: IssueCreateInput) =>
      apiFetch<IssueCreateResponse>(`/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listByProject: (projectId: string) => apiFetch<IssueListResponse>(`/projects/${projectId}/issues`),
    get: (id: string) => apiFetch<IssueGetResponse>(`/issues/${id}`),
    getGraph: (id: string) => apiFetch<IssueGraphResponse>(`/issues/${id}/graph`),
    startGraph: (
      issueId: string,
      input: {
        definitionId: string;
        definitionVersion: number;
        nodeAssignments: Record<string, string>;
        premiseHash?: string | null;
      },
    ) =>
      apiFetch<GraphStartResponse>(`/issues/${issueId}/graph-runs`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  graphRuns: {
    get: (id: string) => apiFetch<IssueGraphResponse["current"]>(`/graph-runs/${id}`),
    cancel: (id: string) => apiFetch<GraphRunCancelResponse>(`/graph-runs/${id}/cancel`, { method: "POST" }),
    retryNode: (graphRunId: string, nodeKey: string) =>
      apiFetch<GraphNodeRetryResponse>(`/graph-runs/${graphRunId}/nodes/${encodeURIComponent(nodeKey)}/retry`, {
        method: "POST",
      }),
    resolveExecutors: (graphRunId: string, nodeAssignments: Record<string, string>) =>
      apiFetch<GraphResolveExecutorsResponse>(`/graph-runs/${graphRunId}/resolve-executors`, {
        method: "POST",
        body: JSON.stringify({ node_assignments: nodeAssignments }),
      }),
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
    delete: (adapterId: string) => apiFetch<void>(`/adapters/${adapterId}`, { method: "DELETE" }),
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
    listByIssue: (issueId: string) => apiFetch<RunListResponse>(`/issues/${issueId}/runs`),
    cancel: (runId: string) => apiFetch<RunCancelResponse>(`/runs/${runId}/cancel`, { method: "POST" }),
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
        const errorBody = await res
          .json()
          .catch(() => ({ error: { code: ErrorCode.INTERNAL_ERROR, message: "Unknown error" } }));
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
    getValidation: (issueId: string) => apiFetch<IssueValidationResponse>(`/issues/${issueId}/validation`),
    getEvidenceSummary: (issueId: string) => apiFetch<EvidenceSummaryResponse>(`/issues/${issueId}/evidence-summary`),
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
  intake: {
    recommend: (projectId: string, goal: string) =>
      apiFetch<RecommendResponse>(`/projects/${projectId}/intake/recommend`, {
        method: "POST",
        body: JSON.stringify({ goal }),
      }),
    confirm: (projectId: string, token: ConfirmationToken, chosen: ChosenPlan) =>
      apiFetch<ConfirmResponse>(`/projects/${projectId}/intake/confirm`, {
        method: "POST",
        body: JSON.stringify({ token, chosen }),
      }),
  },
  workflowTemplates: {
    list: (issueType?: string) =>
      apiFetch<WorkflowTemplateListResponse>(
        `/workflow-templates${issueType ? `?issue_type=${encodeURIComponent(issueType)}` : ""}`,
      ),
    get: (id: string) => apiFetch<WorkflowTemplateDetailResponse>(`/workflow-templates/${id}`),
    createVersion: (sourceId: string, input: CreateWorkflowTemplateVersionInput) =>
      apiFetch<CreateWorkflowTemplateVersionResponse>(`/workflow-templates/${sourceId}/versions`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    activate: (id: string, input?: ActivateWorkflowTemplateInput) =>
      apiFetch<ActivateWorkflowTemplateResponse>(`/workflow-templates/${id}/activate`, {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      }),
    deactivate: (id: string) =>
      apiFetch<DeactivateWorkflowTemplateResponse>(`/workflow-templates/${id}/deactivate`, {
        method: "POST",
      }),
  },
  runtimeHealth: {
    get: (projectId: string, workspaceId?: string) =>
      apiFetch<RuntimeHealthResponse>(
        `/projects/${projectId}/health/runtime${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ""}`,
      ),
  },
  // F010 read surface. Typed refs travel only in the query string and are
  // encoded exactly once here; the server handles the decoded raw ref.
  artifacts: {
    create: (input: CreateArtifactInput) =>
      apiFetch<ArtifactRevisionWriteResult>("/artifacts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    revise: (artifactId: string, input: ReviseArtifactInput) =>
      apiFetch<ArtifactRevisionWriteResult>(`/artifacts/${encodeURIComponent(artifactId)}/revisions`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listByIssue: (issueId: string) => apiFetch<ArtifactListRead>(`/artifacts?issue_id=${encodeURIComponent(issueId)}`),
    get: (artifactId: string) => apiFetch<ArtifactEntityRead>(`/artifacts/${encodeURIComponent(artifactId)}`),
    getRevision: (artifactId: string, revision: number) =>
      apiFetch<ArtifactRevisionRead>(`/artifacts/${encodeURIComponent(artifactId)}/revisions/${revision}`),
    getProvenance: (artifactId: string) =>
      apiFetch<ArtifactProvenanceRead>(`/artifacts/${encodeURIComponent(artifactId)}/provenance`),
    listByRun: (runId: string) => apiFetch<RunArtifactRead>(`/runs/${encodeURIComponent(runId)}/artifacts`),
    listByEvidenceRef: (ref: string) =>
      apiFetch<EvidenceArtifactRead>(`/evidence/artifacts?ref=${encodeURIComponent(ref)}`),
  },
};
