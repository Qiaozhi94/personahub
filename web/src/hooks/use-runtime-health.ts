import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useRuntimeHealth(projectId: string | null, workspaceId?: string) {
  return useQuery({
    queryKey: ["runtime-health", projectId, workspaceId ?? null],
    queryFn: () => apiClient.runtimeHealth.get(projectId!, workspaceId),
    enabled: projectId !== null,
  });
}
