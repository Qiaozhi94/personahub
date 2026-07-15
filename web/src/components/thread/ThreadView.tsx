import { useState, useMemo, type FormEvent } from "react";
import { Send, AlertTriangle } from "lucide-react";
import { IssueStatus, RunStatus, ThreadEventType, type ThreadEvent as ThreadEventData } from "@personahub/shared";
import { useThreadEvents } from "@/hooks/use-thread";
import { useRuns, useCreateRun } from "@/hooks/use-runs";
import { useAdapters } from "@/hooks/use-adapters";
import { toApiError } from "@/lib/api-client";
import { ThreadEvent } from "@/components/thread/ThreadEvent";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ThreadViewProps {
  threadId: string;
  issueId: string;
  issueStatus: string;
  projectId: string;
}

type DisplayEvent =
  | ThreadEventData
  | { merged: true; events: ThreadEventData[]; id: string; type: string; created_at: string };

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

export function ThreadView({ threadId, issueId, issueStatus, projectId }: ThreadViewProps) {
  const { data, isLoading, isError, error } = useThreadEvents(threadId);
  const runsQuery = useRuns(issueId);
  const adaptersQuery = useAdapters(projectId);
  const createRun = useCreateRun();

  const [instructions, setInstructions] = useState("");
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);

  const adapters = adaptersQuery.data?.adapters ?? [];
  const runs = runsQuery.data?.runs ?? [];

  const hasRunningRun = runs.some(
    (r) => r.status === RunStatus.Queued || r.status === RunStatus.Running,
  );

  const availableAdapters = adapters.filter(
    (a) => a.status === "available" || a.status === "unknown",
  );

  const currentAdapterId = selectedAdapterId ?? availableAdapters[0]?.id ?? null;
  const isBlocked = issueStatus === IssueStatus.Blocked;
  const canSend =
    currentAdapterId !== null &&
    !isBlocked &&
    !hasRunningRun &&
    instructions.trim().length > 0;

  function getDisabledMessage(): string | null {
    if (availableAdapters.length === 0) return "Configure an adapter to send instructions";
    if (isBlocked) return "Issue is blocked — resolve the blocker first";
    if (hasRunningRun) return "A run is already in progress";
    return null;
  }

  const disabledMessage = getDisabledMessage();

  const processedEvents = useMemo(() => {
    const raw = data?.events ?? [];
    return mergeConsecutiveOutputEvents(raw);
  }, [data?.events]);

  const createRunError = createRun.isError ? toApiError(createRun.error).message : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSend || !currentAdapterId) return;
    createRun.mutate(
      {
        issueId,
        input: { instructions: instructions.trim(), adapter_id: currentAdapterId },
      },
      {
        onSuccess: () => setInstructions(""),
      },
    );
  }

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-11 py-7">
        {processedEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
            No events yet in this thread.
          </div>
        ) : (
          processedEvents.map((event) => {
            if ("merged" in event && event.merged) {
              return (
                <ThreadEvent
                  key={event.id}
                  event={event.events[0]!}
                  consecutiveOutputChunks={event.events}
                />
              );
            }
            return <ThreadEvent key={(event as ThreadEventData).id} event={event as ThreadEventData} />;
          })
        )}
      </div>

      <div className="shrink-0 border-t border-border px-11 py-4">
        {adaptersQuery.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading adapters…</div>
        ) : (
          <form className="grid gap-2.5" onSubmit={handleSubmit}>
            {availableAdapters.length > 1 ? (
              <div className="flex items-center gap-2">
                <label htmlFor="adapter-select" className="text-xs text-muted-foreground shrink-0">
                  Adapter:
                </label>
                <select
                  id="adapter-select"
                  className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={currentAdapterId ?? ""}
                  onChange={(e) => setSelectedAdapterId(e.target.value)}
                >
                  {availableAdapters.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {disabledMessage ? (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                {disabledMessage}
              </div>
            ) : null}

            <div className="flex items-start gap-2">
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Enter agent instructions…"
                className="min-h-[48px] flex-1 resize-none text-xs"
                disabled={!canSend && disabledMessage !== null}
                rows={2}
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!canSend || createRun.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {createRunError ? (
              <p className="text-xs text-destructive">{createRunError}</p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
