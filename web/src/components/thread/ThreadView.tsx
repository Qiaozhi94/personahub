import { useState, useMemo, type FormEvent } from "react";
import { Send, AlertTriangle, RotateCcw, XCircle, Wrench } from "lucide-react";
import {
  IssueStatus,
  ThreadEventType,
  AdapterStatus,
  GraphRunStatus,
  NodeRunStatus,
  GraphBlockReason,
  type ThreadEvent as ThreadEventData,
  type ProjectedNodeRun,
  type ProjectedGraphRun,
  type AdapterConfig,
} from "@personahub/shared";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useThreadEvents } from "@/hooks/use-thread";
import { useRuns, useCreateRun } from "@/hooks/use-runs";
import { useAdapters } from "@/hooks/use-adapters";
import { apiClient, toApiError } from "@/lib/api-client";
import { ThreadEvent } from "@/components/thread/ThreadEvent";
import { AgentSelector } from "@/components/thread/AgentSelector";
import { GraceValidatorBanner } from "@/components/thread/GraceValidatorBanner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";

interface ThreadViewProps {
  threadId: string;
  issueId: string;
  issueStatus: IssueStatus;
  projectId: string;
  /** F005 §8.1: non-null while the manual-validator grace window is still open. */
  validationDispatchDueAt?: string | null;
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

const GRAPH_RUN_STATUS_VARIANT: Record<
  GraphRunStatus,
  "secondary" | "brand" | "success" | "destructive" | "warning"
> = {
  [GraphRunStatus.Running]: "brand",
  [GraphRunStatus.Blocked]: "destructive",
  [GraphRunStatus.Cancelling]: "warning",
  [GraphRunStatus.Completed]: "success",
  [GraphRunStatus.Cancelled]: "secondary",
};

const NODE_RUN_STATUS_VARIANT: Record<
  NodeRunStatus,
  "secondary" | "brand" | "success" | "destructive" | "warning"
> = {
  [NodeRunStatus.Pending]: "secondary",
  [NodeRunStatus.Ready]: "brand",
  [NodeRunStatus.Running]: "brand",
  [NodeRunStatus.Completed]: "success",
  [NodeRunStatus.Failed]: "destructive",
  [NodeRunStatus.Cancelled]: "secondary",
  [NodeRunStatus.Interrupted]: "warning",
};

const GRAPH_BLOCK_REASON_LABELS: Record<GraphBlockReason, string> = {
  [GraphBlockReason.NodeRunFailed]: "A node run failed",
  [GraphBlockReason.NodeRunCancelled]: "A node run was cancelled",
  [GraphBlockReason.JoinUnsatisfiable]: "Join conditions cannot be satisfied",
  [GraphBlockReason.NoCapableAdapter]: "No capable adapter for node",
  [GraphBlockReason.ResultUnparsable]: "Node result could not be parsed",
  [GraphBlockReason.ResultTooLarge]: "Node result was too large",
  [GraphBlockReason.DefinitionVersionUnavailable]: "Graph definition version unavailable",
  [GraphBlockReason.RecoveryInconsistent]: "Graph recovery state is inconsistent",
};

function useGraph(issueId: string) {
  return useQuery({
    queryKey: ["issue-graph", issueId],
    queryFn: () => apiClient.issues.getGraph(issueId),
    refetchInterval: (query) => {
      const status = query.state.data?.current?.graph_run.status;
      return status === GraphRunStatus.Running || status === GraphRunStatus.Cancelling ? 2000 : false;
    },
  });
}

function useRetryGraphNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ graphRunId, nodeKey }: { graphRunId: string; nodeKey: string }) =>
      apiClient.graphRuns.retryNode(graphRunId, nodeKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-graph"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
  });
}

function useCancelGraphRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (graphRunId: string) => apiClient.graphRuns.cancel(graphRunId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-graph"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
  });
}

function useResolveExecutors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ graphRunId, nodeAssignments }: { graphRunId: string; nodeAssignments: Record<string, string> }) =>
      apiClient.graphRuns.resolveExecutors(graphRunId, nodeAssignments),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-graph"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
  });
}

function useStartGraph() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, nodeAssignments }: { issueId: string; nodeAssignments: Record<string, string> }) =>
      apiClient.issues.startGraph(issueId, {
        definitionId: "wgd_coding_dual_review",
        definitionVersion: 1,
        nodeAssignments,
        premiseHash: null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-graph"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
  });
}

const GRAPH_DEFINITION_NODES = [
  { key: "review_concurrency", label: "Review: concurrency & state" },
  { key: "review_contract", label: "Review: contracts & boundaries" },
  { key: "synthesize_findings", label: "Synthesize findings" },
];

export function StartGraphDialog({
  issueId,
  adapters,
  disabled,
}: {
  issueId: string;
  adapters: AdapterConfig[];
  disabled: boolean;
}) {
  const startGraph = useStartGraph();
  const [open, setOpen] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const allAssigned = GRAPH_DEFINITION_NODES.every((n) => assignments[n.key]);
  const error = startGraph.isError ? toApiError(startGraph.error).message : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={disabled || adapters.length === 0}
        >
          Start Graph
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Start dual-review graph</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2.5 py-2">
          <p className="text-[11px] text-muted-foreground">
            Runs a two-perspective code review (concurrency × contracts) that converges into a merged findings report.
          </p>
          {GRAPH_DEFINITION_NODES.map((node) => {
            const selected = assignments[node.key] ?? "";
            return (
              <div key={node.key} className="flex items-center justify-between gap-2">
                <span className="text-xs">{node.label}</span>
                <select
                  className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                  value={selected}
                  onChange={(e) => setAssignments((prev) => ({ ...prev, [node.key]: e.target.value }))}
                >
                  <option value="" disabled>
                    Select adapter…
                  </option>
                  {adapters.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogClose asChild>
          <Button
            size="sm"
            className="w-full"
            disabled={!allAssigned || startGraph.isPending}
            onClick={() => {
              startGraph.mutate({ issueId, nodeAssignments: assignments });
            }}
          >
            {startGraph.isPending ? "Starting…" : "Start Graph"}
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export function GraphRunCard({
  graphRun,
  nodes,
  adapters,
}: {
  graphRun: ProjectedGraphRun;
  nodes: ProjectedNodeRun[];
  adapters: AdapterConfig[];
}) {
  const retryNode = useRetryGraphNode();
  const cancelGraph = useCancelGraphRun();
  const resolveExecutors = useResolveExecutors();
  const isCancelling = graphRun.status === GraphRunStatus.Cancelling;
  const isBlocked = graphRun.status === GraphRunStatus.Blocked;
  const isTerminal = graphRun.status === GraphRunStatus.Completed || graphRun.status === GraphRunStatus.Cancelled;
  const retryError = retryNode.isError ? toApiError(retryNode.error).message : null;
  const cancelError = cancelGraph.isError ? toApiError(cancelGraph.error).message : null;
  const isNoCapableAdapter =
    isBlocked && graphRun.blocked_reason_code === GraphBlockReason.NoCapableAdapter;
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const blockedNodeKeys = isBlocked ? graphRun.blocked_node_keys : [];
  const defaultFor = (key: string) => assignments[key] ?? nodes.find((n) => n.node_key === key)?.attempts[0]?.adapter_config_id ?? "";

  return (
    <Card className="border-border bg-card">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Graph Run</CardTitle>
          <div className="flex items-center gap-2">
            {!isTerminal ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={cancelGraph.isPending}
                onClick={() => cancelGraph.mutate(graphRun.id)}
              >
                <XCircle className="mr-1 h-3 w-3" />
                {isCancelling ? "Force Cancel" : "Cancel"}
              </Button>
            ) : null}
            <Badge variant={GRAPH_RUN_STATUS_VARIANT[graphRun.status]} className="text-[11px]">
              {graphRun.status}
            </Badge>
          </div>
        </div>
        {graphRun.blocked_reason_code ? (
          <p className="text-xs text-destructive">
            {GRAPH_BLOCK_REASON_LABELS[graphRun.blocked_reason_code] ?? graphRun.blocked_reason_code}
          </p>
        ) : null}
        {isCancelling ? (
          <p className="text-xs text-warning">Cancelling… waiting for active attempts to exit.</p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-2 p-4 pt-0">
        {nodes.map((node) => {
          const isBlockedNode = isBlocked && graphRun.blocked_node_keys.includes(node.node_key);
          const retryable =
            isBlockedNode &&
            (node.status === NodeRunStatus.Failed ||
              node.status === NodeRunStatus.Interrupted ||
              node.status === NodeRunStatus.Cancelled);
          return (
            <div
              key={node.node_key}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/50 px-3 py-2"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-medium">{node.node_key}</span>
                <span className="text-[11px] text-muted-foreground">
                  {node.attempts.length} attempt{node.attempts.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={NODE_RUN_STATUS_VARIANT[node.status]} className="text-[11px]">
                  {node.status}
                </Badge>
                {retryable ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={retryNode.isPending || isCancelling}
                    onClick={() => retryNode.mutate({ graphRunId: graphRun.id, nodeKey: node.node_key })}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        {retryError ? <p className="text-xs text-destructive">{retryError}</p> : null}
        {cancelError ? <p className="text-xs text-destructive">{cancelError}</p> : null}
        {isNoCapableAdapter ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Reassign executors</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              The assigned adapter for one or more nodes is no longer eligible. Pick a replacement to resume.
            </p>
            {blockedNodeKeys.map((key) => {
              const selected = defaultFor(key);
              return (
                <div key={key} className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs">{key}</span>
                  <select
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                    value={selected}
                    disabled={resolveExecutors.isPending}
                    onChange={(e) => setAssignments((prev) => ({ ...prev, [key]: e.target.value }))}
                  >
                    <option value="" disabled>
                      Select adapter…
                    </option>
                    {adapters.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 px-2 text-[11px]"
              disabled={
                resolveExecutors.isPending ||
                blockedNodeKeys.length === 0 ||
                blockedNodeKeys.some((key) => !assignments[key])
              }
              onClick={() =>
                resolveExecutors.mutate({ graphRunId: graphRun.id, nodeAssignments: assignments })
              }
            >
              <Wrench className="mr-1 h-3 w-3" />
              Resolve Executors
            </Button>
            {resolveExecutors.isError ? (
              <p className="mt-2 text-xs text-destructive">{toApiError(resolveExecutors.error).message}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ThreadView({ threadId, issueId, issueStatus, projectId, validationDispatchDueAt }: ThreadViewProps) {
  const { data, isLoading, isError, error } = useThreadEvents(threadId);
  const runsQuery = useRuns(issueId);
  const adaptersQuery = useAdapters(projectId);
  const createRun = useCreateRun();
  const graphQuery = useGraph(issueId);

  const [instructions, setInstructions] = useState("");
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);
  const [explicitConsult, setExplicitConsult] = useState(false);

  const adapters = adaptersQuery.data?.adapters ?? [];
  const runs = runsQuery.data?.runs ?? [];

  // design §7.4/T091: terminal Issue status is the only hard block — a Run
  // already in progress does not disable sending, it just queues FIFO
  // (consult stays eligible during Validating even with an active validator,
  // per F005 §7.5/Phase 8's queue-drain fix).
  const isTerminal = issueStatus === IssueStatus.Done || issueStatus === IssueStatus.Blocked;

  const defaultAdapter = adapters.find((a) => a.is_default && a.status === AdapterStatus.Available) ?? null;
  const resolvedAdapter = selectedAdapterId
    ? (adapters.find((a) => a.id === selectedAdapterId && a.status === AdapterStatus.Available) ?? null)
    : defaultAdapter;

  const canSend = !isTerminal && instructions.trim().length > 0 && resolvedAdapter !== null;

  function getDisabledMessage(): string | null {
    if (adapters.length === 0) return "Configure an adapter to send instructions";
    if (isTerminal) return `Issue is ${issueStatus} — no new instructions can be dispatched`;
    if (!resolvedAdapter) {
      return selectedAdapterId
        ? "Selected adapter is not available — choose a different one"
        : "No available default adapter — select one explicitly";
    }
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
    if (!canSend) return;
    createRun.mutate(
      {
        issueId,
        input: {
          instructions: instructions.trim(),
          adapter_id: selectedAdapterId ?? undefined,
          purpose: explicitConsult ? "ad_hoc_consult" : undefined,
        },
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
        {issueStatus === IssueStatus.Validating ? (
          <div className="mx-auto w-full max-w-[720px]">
            <GraceValidatorBanner issueId={issueId} validationDispatchDueAt={validationDispatchDueAt ?? null} />
          </div>
        ) : null}
        {processedEvents.length === 0 && !graphQuery.data?.current ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
              No events yet in this thread.
            </div>
            {issueStatus === IssueStatus.Inbox ? (
              <StartGraphDialog issueId={issueId} adapters={adapters} disabled={adaptersQuery.isLoading} />
            ) : null}
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
            {graphQuery.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading graph run…</div>
            ) : graphQuery.data?.current ? (
              <GraphRunCard
                graphRun={graphQuery.data.current.graph_run}
                nodes={graphQuery.data.current.nodes}
                adapters={adapters}
              />
            ) : null}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-11 py-4">
        {adaptersQuery.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading adapters…</div>
        ) : (
          <form className="grid gap-2.5" onSubmit={handleSubmit}>
            <AgentSelector
              adapters={adapters}
              selectedAdapterId={selectedAdapterId}
              onSelect={setSelectedAdapterId}
              issueStatus={issueStatus}
              explicitConsult={explicitConsult}
              onExplicitConsultChange={setExplicitConsult}
            />

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
                disabled={isTerminal}
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
