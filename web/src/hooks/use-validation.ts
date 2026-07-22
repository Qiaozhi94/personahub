import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useValidationStatus(issueId: string | null) {
  return useQuery({
    queryKey: ["validation-status", issueId],
    queryFn: () => apiClient.validation.getValidation(issueId!),
    enabled: issueId !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const idleStatuses = new Set(["Done", "Blocked", "Running", "Inbox", "Ready"]);
      return idleStatuses.has(data.status) ? false : 3000;
    },
  });
}

export function useEvidenceSummary(issueId: string | null) {
  return useQuery({
    queryKey: ["evidence-summary", issueId],
    queryFn: () => apiClient.validation.getEvidenceSummary(issueId!),
    enabled: issueId !== null,
  });
}

export function useUnblock(issueId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ operator_note }: { operator_note: string }) =>
      apiClient.validation.unblock(issueId!, operator_note.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validation-status", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
      qc.invalidateQueries({ queryKey: ["thread-events"] });
    },
  });
}

export function useResetRounds(issueId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ operator_note }: { operator_note: string }) =>
      apiClient.validation.resetRounds(issueId!, operator_note.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validation-status", issueId] });
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
      qc.invalidateQueries({ queryKey: ["thread-events"] });
    },
  });
}

export function useTriggerValidation(issueId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.validation.triggerValidation(issueId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validation-status", issueId] });
      qc.invalidateQueries({ queryKey: ["runs", issueId] });
      qc.invalidateQueries({ queryKey: ["thread-events"] });
      // clears validation_dispatch_due_at once Phase B claims the slot —
      // the grace banner reads this off the Issue, not validation-status.
      qc.invalidateQueries({ queryKey: ["issue", issueId] });
    },
  });
}
