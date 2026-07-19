import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { RunEvidenceResponse } from "@personahub/shared";

export function useIssueTrace(issueId: string | null) {
  return useQuery({
    queryKey: ["issue-trace", issueId],
    queryFn: () => apiClient.traces.getIssueTrace(issueId!),
    enabled: issueId !== null,
  });
}

const EVIDENCE_FILE_LIMIT = 100;

export function useRunEvidence(runId: string | null) {
  const infinite = useInfiniteQuery<RunEvidenceResponse>({
    queryKey: ["run-evidence", runId],
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      return apiClient.traces.getRunEvidence(
        runId!,
        undefined,
        cursor,
        undefined,
        EVIDENCE_FILE_LIMIT,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_after_file_change_id ?? undefined,
    enabled: runId !== null,
  });

  const allFileChanges = infinite.data
    ? infinite.data.pages.flatMap((p) => p.file_changes)
    : [];

  return {
    ...infinite,
    data: infinite.data
      ? {
          ...infinite.data.pages[0],
          file_changes: allFileChanges,
        }
      : undefined,
    allFileChanges,
  };
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
