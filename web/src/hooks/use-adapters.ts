import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdapterConfigCreateInput, AdapterConfigUpdateInput } from "@personahub/shared";
import { apiClient } from "@/lib/api-client";

export function useAdapters(projectId: string | null) {
  return useQuery({
    queryKey: ["adapters", projectId],
    queryFn: () => apiClient.adapters.listByProject(projectId!),
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
    mutationFn: (adapterId: string) => apiClient.adapters.validate(adapterId),
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
