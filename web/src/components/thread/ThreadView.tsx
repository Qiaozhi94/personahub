import { useMemo } from "react";
import { IssueStatus, ThreadEventType, type ThreadEvent as ThreadEventData } from "@personahub/shared";
import { useThreadEvents } from "@/hooks/use-thread";
import { useRuns } from "@/hooks/use-runs";
import { toApiError } from "@/lib/api-client";
import { ThreadEvent } from "@/components/thread/ThreadEvent";
import { GraceValidatorBanner } from "@/components/thread/GraceValidatorBanner";
import { Button } from "@/components/ui/button";

interface ThreadViewProps {
  threadId: string;
  issueId: string;
  issueStatus: IssueStatus;
  /** F013：游离任务无 project。派工已移到会话面，此处仅保留兼容入参。 */
  projectId?: string | null;
  /** F005 §8.1: non-null while the manual-validator grace window is still open. */
  validationDispatchDueAt?: string | null;
}

type DisplayEvent =
  ThreadEventData | { merged: true; events: ThreadEventData[]; id: string; type: string; created_at: string };

function mergeConsecutiveOutputEvents(events: ThreadEventData[]): DisplayEvent[] {
  const result: DisplayEvent[] = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i]!;
    if (event.type === ThreadEventType.RunOutput) {
      const start = i;
      while (i < events.length && events[i]!.type === ThreadEventType.RunOutput) {
        i++;
      }
      if (i - start > 1) {
        result.push({
          merged: true,
          events: events.slice(start, i),
          id: events[start]!.id,
          type: ThreadEventType.RunOutput,
          created_at: events[start]!.created_at,
        });
      } else {
        result.push(event);
      }
    } else {
      result.push(event);
      i++;
    }
  }

  return result;
}

export function ThreadView({ threadId, issueId, issueStatus, validationDispatchDueAt }: ThreadViewProps) {
  const { data, isLoading, isError, error, refetch: refetchEvents } = useThreadEvents(threadId);
  const runsQuery = useRuns(issueId);
  const runs = runsQuery.data?.runs ?? [];

  const processedEvents = useMemo(() => {
    const raw = data?.events ?? [];
    return mergeConsecutiveOutputEvents(raw);
  }, [data?.events]);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading thread…</div>;
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-destructive">
        <span>{toApiError(error).message}</span>
        <Button variant="outline" size="sm" onClick={() => void refetchEvents()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-11 py-7">
        {issueStatus === IssueStatus.Validating ? (
          <div className="mx-auto w-full max-w-[720px]">
            <GraceValidatorBanner issueId={issueId} validationDispatchDueAt={validationDispatchDueAt ?? null} />
          </div>
        ) : null}
        {processedEvents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              No events yet in this thread.
            </div>
          </div>
        ) : (
          <>
            {processedEvents.map((event) => {
              if ("merged" in event && event.merged) {
                return (
                  <ThreadEvent
                    key={event.id}
                    event={event.events[0]!}
                    consecutiveOutputChunks={event.events}
                    runs={runs}
                  />
                );
              }
              return <ThreadEvent key={(event as ThreadEventData).id} event={event as ThreadEventData} runs={runs} />;
            })}
          </>
        )}
      </div>
    </div>
  );
}
