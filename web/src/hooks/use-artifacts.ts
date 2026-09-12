import { useQuery } from "@tanstack/react-query";
import { apiClient, toApiError } from "@/lib/api-client";
import { ErrorCode, type Artifact, type ArtifactProvenance, type ArtifactConsumption } from "@personahub/shared";

/**
 * F010 read-only artifact hooks (design §6): every hook exposes the explicit
 * discriminated read model — loading / empty / ready / missing / invalid /
 * hash_mismatch — instead of collapsing failures into one error bucket.
 * `empty` (successful query, no rows) and `missing` (the resolved entity or
 * archive does not exist) stay distinct, per spec. Failure states carry the
 * stable error code, the ref and a display-safe message. No visible
 * components and no SurfaceRegistry slots live here; views are F011's.
 */

export type ArtifactReadFailureState = {
  state: "missing" | "invalid" | "hash_mismatch";
  code: string;
  ref: string | null;
  message: string;
};

export type ArtifactReadModel<TData> =
  { state: "loading" } | { state: "ready"; data: TData } | { state: "empty" } | ArtifactReadFailureState;

export type ArtifactEntityModel = Artifact;
export type ArtifactRevisionModel = Extract<
  Awaited<ReturnType<typeof apiClient.artifacts.getRevision>>,
  { status: "ready" }
>;
export type ArtifactProvenanceModel = ArtifactProvenance;
export type RunArtifactsModel = ArtifactConsumption[];
export type EvidenceArtifactsModel = Array<{ artifact: Artifact; revision: number }>;

type FailureStatus = "missing" | "invalid" | "hash_mismatch";

function failureState(
  status: FailureStatus,
  code: string,
  ref: string | null,
  message: string,
): ArtifactReadFailureState {
  return { state: status, code, ref, message };
}

/** Maps a thrown ApiError (transport/5xx layer) onto the read model by code. */
function errorState(error: unknown): ArtifactReadFailureState {
  const apiError = toApiError(error);
  if (apiError.code === ErrorCode.ARTIFACT_HASH_MISMATCH) {
    return failureState("hash_mismatch", apiError.code, null, apiError.message);
  }
  if (apiError.code === ErrorCode.ARTIFACT_NOT_FOUND || apiError.code === ErrorCode.ARTIFACT_REVISION_NOT_FOUND) {
    return failureState("missing", apiError.code, null, apiError.message);
  }
  return failureState("invalid", apiError.code, null, apiError.message);
}

/** The failure status is the payload's own server-declared status — never
 *  re-derived per hook, so `missing` and `invalid` cannot merge. */
function useArtifactReadModel<TData, TResponse extends { status: string }>(
  query: ReturnType<typeof useQuery<TResponse, Error>>,
  pick: (payload: TResponse) => TData,
): ArtifactReadModel<TData> {
  if (query.isPending) return { state: "loading" };
  if (query.isError) return errorState(query.error);
  const data = query.data;
  if (data.status === "ready") return { state: "ready", data: pick(data) };
  if (data.status === "empty") return { state: "empty" };
  const failure = data as unknown as { status: FailureStatus; code: string; ref: string | null; message: string };
  return failureState(failure.status, failure.code, failure.ref, failure.message);
}

export function useArtifact(artifactId: string | null): ArtifactReadModel<ArtifactEntityModel> {
  const query = useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: () => apiClient.artifacts.get(artifactId!),
    enabled: artifactId !== null,
  });
  return useArtifactReadModel<typeof query.data, typeof query.data>(
    query,
    (payload) => payload.artifact as ArtifactEntityModel,
  );
}

export function useArtifactRevision(
  artifactId: string | null,
  revision: number | null,
): ArtifactReadModel<ArtifactRevisionModel> {
  const query = useQuery({
    queryKey: ["artifact-revision", artifactId, revision],
    queryFn: () => apiClient.artifacts.getRevision(artifactId!, revision!),
    enabled: artifactId !== null && revision !== null,
  });
  // The full ready payload (artifact + revision + content) is the model so
  // F011 views can render provenance next to the body.
  return useArtifactReadModel<typeof query.data, typeof query.data>(
    query,
    (payload) => payload as unknown as ArtifactRevisionModel,
  );
}

export function useArtifactsByIssue(issueId: string | null): ArtifactReadModel<ArtifactEntityModel[]> {
  const query = useQuery({
    queryKey: ["artifacts-by-issue", issueId],
    queryFn: () => apiClient.artifacts.listByIssue(issueId!),
    enabled: issueId !== null,
  });
  return useArtifactReadModel<typeof query.data, typeof query.data>(
    query,
    (payload) => payload.artifacts as ArtifactEntityModel[],
  );
}

export function useArtifactProvenance(artifactId: string | null): ArtifactReadModel<ArtifactProvenanceModel> {
  const query = useQuery({
    queryKey: ["artifact-provenance", artifactId],
    queryFn: () => apiClient.artifacts.getProvenance(artifactId!),
    enabled: artifactId !== null,
  });
  return useArtifactReadModel<typeof query.data, typeof query.data>(
    query,
    (payload) => payload.provenance as ArtifactProvenanceModel,
  );
}

export function useRunArtifacts(runId: string | null): ArtifactReadModel<RunArtifactsModel> {
  const query = useQuery({
    queryKey: ["run-artifacts", runId],
    queryFn: () => apiClient.artifacts.listByRun(runId!),
    enabled: runId !== null,
  });
  return useArtifactReadModel<typeof query.data, typeof query.data>(
    query,
    (payload) => payload.consumptions as RunArtifactsModel,
  );
}

export function useEvidenceArtifacts(ref: string | null): ArtifactReadModel<EvidenceArtifactsModel> {
  const query = useQuery({
    queryKey: ["evidence-artifacts", ref],
    queryFn: () => apiClient.artifacts.listByEvidenceRef(ref!),
    enabled: ref !== null,
  });
  return useArtifactReadModel<typeof query.data, typeof query.data>(
    query,
    (payload) => payload.items as EvidenceArtifactsModel,
  );
}
