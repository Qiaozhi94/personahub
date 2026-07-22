import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IssueStatus, type IssueCreateInput } from "@personahub/shared";
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
    // F005 §8.1: validation_dispatch_due_at can change server-side without
    // any client action (the ValidationDispatchScheduler auto-claims once
    // due) — poll while Validating so the grace countdown/banner stays true
    // to the server, not just refresh on the user's own mutations.
    refetchInterval: (query) => (query.state.data?.issue.status === IssueStatus.Validating ? 2000 : false),
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
