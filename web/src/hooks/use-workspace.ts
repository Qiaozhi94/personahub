import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useWorkspace(projectId: string | null) {
  return useQuery({
    queryKey: ["workspace", projectId],
    queryFn: () => apiClient.workspaces.getByProject(projectId!),
    enabled: projectId !== null,
  });
}

export function useBindWorkspace(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (localPath: string) => apiClient.workspaces.bind(projectId!, localPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
    },
  });
}
