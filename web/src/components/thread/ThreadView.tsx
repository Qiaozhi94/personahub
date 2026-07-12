import { useThreadEvents } from "@/hooks/use-thread";
import { toApiError } from "@/lib/api-client";
import { ThreadEvent } from "@/components/thread/ThreadEvent";

interface ThreadViewProps {
  threadId: string;
}

export function ThreadView({ threadId }: ThreadViewProps) {
  const { data, isLoading, isError, error } = useThreadEvents(threadId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading thread…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        {toApiError(error).message}
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        No events yet in this thread.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 overflow-auto px-11 py-7">
      {events.map((event) => (
        <ThreadEvent key={event.id} event={event} />
      ))}
    </div>
  );
}
