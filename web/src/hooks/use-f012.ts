import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { DispatchGetResponse, EligibilityResponse } from "@personahub/shared";

// F012 T015 hooks — thin react-query bindings over the F012 API. The session
// page and the dispatch panel share these so countdown/eligibility state has
// one owner per screen.

export function useSession(sessionId: string) {
  return useQuery({
    queryKey: ["f012", "session", sessionId],
    queryFn: () => apiClient.f012.getRoom(sessionId),
  });
}

export function useSendMessage(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; idempotencyKey: string }) =>
      apiClient.f012.sendMessage(sessionId, input.body, input.idempotencyKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "session", sessionId] });
    },
  });
}

export function useConvertToTask(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { project_id?: string | null; goal: string }) =>
      apiClient.f012.convertToTask(sessionId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "session", sessionId] });
    },
  });
}

export function useEligibility(sessionId: string, purpose: string, contextScope: string, enabled: boolean) {
  return useQuery({
    queryKey: ["f012", "eligibility", sessionId, purpose, contextScope],
    queryFn: () => apiClient.f012.eligibility(sessionId, purpose, contextScope, []),
    enabled,
  });
}

export function useConfirmDispatch(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: Parameters<typeof apiClient.f012.confirmDispatch>[1]; idempotencyKey: string }) =>
      apiClient.f012.confirmDispatch(sessionId, input.body, input.idempotencyKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "dispatch", sessionId] });
    },
  });
}

export function useActiveDispatch(sessionId: string, dispatchId: string | null) {
  return useQuery({
    queryKey: ["f012", "dispatch", sessionId, dispatchId],
    queryFn: (): Promise<DispatchGetResponse> => apiClient.f012.getDispatch(dispatchId!),
    enabled: dispatchId !== null,
  });
}

export function useCancelDispatch(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dispatchId: string) => apiClient.f012.cancelDispatch(dispatchId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "dispatch", sessionId] });
    },
  });
}

export function useStartNow(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dispatchId: string) => apiClient.f012.startNow(dispatchId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "dispatch", sessionId] });
    },
  });
}

export function useCancelAttempt(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attemptId: string) => apiClient.f012.cancelAttempt(attemptId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["f012", "dispatch", sessionId] });
    },
  });
}

export type { EligibilityResponse };
