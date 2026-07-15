import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { ThreadEvent } from "@personahub/shared";

export function useThread(id: string | null) {
  return useQuery({
    queryKey: ["thread", id],
    queryFn: () => apiClient.threads.get(id!),
    enabled: id !== null,
  });
}

export function useThreadEvents(id: string | null, afterEventId?: string) {
  const queryClient = useQueryClient();
  const lastEventId = useRef<string | undefined>(afterEventId);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!id) return;
    if (typeof EventSource === "undefined") return;
    const eventSource = new EventSource(`/api/threads/${id}/events/stream`);
    eventSource.onmessage = (event) => {
      try {
        const parsed: ThreadEvent = JSON.parse(event.data);
        lastEventId.current = parsed.id;
        queryClient.invalidateQueries({ queryKey: ["thread-events", id] });
        queryClient.invalidateQueries({ queryKey: ["runs"] });
      } catch {
        void 0;
      }
    };
    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => {
      setConnected(false);
    };
    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, [id, queryClient]);

  return useQuery({
    queryKey: ["thread-events", id, afterEventId],
    queryFn: () => apiClient.threads.getEvents(id!, afterEventId),
    enabled: id !== null,
    refetchOnWindowFocus: true,
  });
}
