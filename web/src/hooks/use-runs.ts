import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useRuns(issueId: string | null) {
  return useQuery({
    queryKey: ["runs", issueId],
    queryFn: () => apiClient.runs.listByIssue(issueId!),
    enabled: issueId !== null,
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      const hasActive = runs.some(r => r.status === "queued" || r.status === "running");
      return hasActive ? 2000 : false;
    },
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => apiClient.runs.get(runId!),
    enabled: runId !== null,
  });
}
