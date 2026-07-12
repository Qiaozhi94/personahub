import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueCreateInput } from "@personahub/shared";
import { apiClient } from "@/lib/api-client";

export function useIssues(projectId: string | null) {
  return useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => apiClient.issues.listByProject(projectId!),
    enabled: projectId !== null,
  });
}

export function useIssue(id: string | null) {
  return useQuery({
    queryKey: ["issue", id],
    queryFn: () => apiClient.issues.get(id!),
    enabled: id !== null,
  });
}

export function useCreateIssue(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueCreateInput) => apiClient.issues.create(projectId!, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", projectId] });
    },
  });
}
