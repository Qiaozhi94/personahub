import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useIssueTrace(issueId: string | null) {
  return useQuery({
    queryKey: ["issue-trace", issueId],
    queryFn: () => apiClient.traces.getIssueTrace(issueId!),
    enabled: issueId !== null,
  });
}

export function useRunEvidence(runId: string | null) {
  return useQuery({
    queryKey: ["run-evidence", runId],
    queryFn: () => apiClient.traces.getRunEvidence(runId!),
    enabled: runId !== null,
  });
}

export function useExportTrace() {
  return useMutation({
    mutationFn: async (issueId: string) => {
      const { blob, filename } = await apiClient.traces.exportMarkdown(issueId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
