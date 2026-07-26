import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterConfigCreateInput, AdapterConfigUpdateInput } from "@personahub/shared";
import { apiClient } from "@/lib/api-client";

/**
 * `workspaceId` (F005 workspace-aware availability closure): when provided,
 * each returned adapter also carries `effective_status`/
 * `effective_last_checked_at`/`effective_auth_status_message`/
 * `has_workspace_override` — the workspace-effective view
 * (`effectiveAdapterStatus()` server-side), which is what actually
 * determines routability/validator-selection for THIS workspace and can
 * differ from the Project-global `status`. Omitted: identical to the old
 * global-only behavior.
 */
export function useAdapters(projectId: string | null, workspaceId?: string) {
  return useQuery({
    queryKey: ["adapters", projectId, workspaceId ?? null],
    queryFn: () => apiClient.adapters.listByProject(projectId!, workspaceId),
    enabled: projectId !== null,
  });
}

export function useCreateAdapter(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdapterConfigCreateInput) =>
      apiClient.adapters.create(projectId!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adapters", projectId] });
    },
  });
}

export function useUpdateAdapter(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ adapterId, input }: { adapterId: string; input: AdapterConfigUpdateInput }) =>
      apiClient.adapters.update(adapterId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adapters", projectId] });
    },
  });
}

export function useDeleteAdapter(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (adapterId: string) => apiClient.adapters.delete(adapterId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adapters", projectId] });
    },
  });
}

export function useValidateAdapter(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ adapterId, workspaceId }: { adapterId: string; workspaceId?: string }) =>
      apiClient.adapters.validate(adapterId, workspaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adapters", projectId] });
    },
  });
}

/** Provider metadata is static/global (not Project-scoped) — a single shared cache entry. */
export function useAdapterProviders() {
  return useQuery({
    queryKey: ["adapter-providers"],
    queryFn: () => apiClient.adapters.getProviders(),
    staleTime: Infinity,
  });
}

export function useSetDefaultAdapter(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (adapterId: string | null) => apiClient.adapters.setDefault(projectId!, adapterId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adapters", projectId] });
    },
  });
}
