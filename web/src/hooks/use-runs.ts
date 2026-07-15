import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunCreateInput } from "@personahub/shared";
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

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, input }: { issueId: string; input: RunCreateInput }) =>
      apiClient.runs.create(issueId, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["runs", variables.issueId] });
      qc.invalidateQueries({ queryKey: ["thread-events"] });
      qc.invalidateQueries({ queryKey: ["issue", variables.issueId] });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => apiClient.runs.cancel(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
  });
}
