import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useThread(id: string | null) {
  return useQuery({
    queryKey: ["thread", id],
    queryFn: () => apiClient.threads.get(id!),
    enabled: id !== null,
  });
}

export function useThreadEvents(id: string | null, afterEventId?: string) {
  return useQuery({
    queryKey: ["thread-events", id, afterEventId],
    queryFn: () => apiClient.threads.getEvents(id!, afterEventId),
    enabled: id !== null,
  });
}
