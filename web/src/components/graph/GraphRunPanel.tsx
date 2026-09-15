import { useState } from "react";
import { RotateCcw, XCircle, Wrench } from "lucide-react";
import {
  IssueStatus,
  GraphRunStatus,
  NodeRunStatus,
  GraphBlockReason,
  type ProjectedNodeRun,
  type ProjectedGraphRun,
  type AdapterConfig,
} from "@personahub/shared";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdapters } from "@/hooks/use-adapters";
import { useIssue } from "@/hooks/use-issues";
import { apiClient, toApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const GRAPH_RUN_STATUS_VARIANT: Record<GraphRunStatus, "secondary" | "brand" | "success" | "destructive" | "warning"> =
  {
    [GraphRunStatus.Running]: "brand",
    [GraphRunStatus.Blocked]: "destructive",
    [GraphRunStatus.Cancelling]: "warning",
    [GraphRunStatus.Completed]: "success",
    [GraphRunStatus.Cancelled]: "secondary",
  };

const NODE_RUN_STATUS_VARIANT: Record<NodeRunStatus, "secondary" | "brand" | "success" | "destructive" | "warning"> = {
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
        {/* No unconditional DialogClose (review R1-010): the dialog stays
            open while the request is pending and on failure, so the error and
            the node assignments remain visible for an in-place retry. */}
        <Button
          size="sm"
          className="w-full"
          disabled={!allAssigned || startGraph.isPending}
          onClick={() => {
            startGraph.mutate(
              { issueId, nodeAssignments: assignments },
              {
                onSuccess: () => {
                  setAssignments({});
                  setOpen(false);
                },
              },
            );
          }}
        >
          {startGraph.isPending ? "Starting…" : "Start Graph"}
        </Button>
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
  const isNoCapableAdapter = isBlocked && graphRun.blocked_reason_code === GraphBlockReason.NoCapableAdapter;
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const blockedNodeKeys = isBlocked ? graphRun.blocked_node_keys : [];
  const defaultFor = (key: string) =>
    assignments[key] ?? nodes.find((n) => n.node_key === key)?.attempts[0]?.adapter_config_id ?? "";

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
        {isCancelling ? <p className="text-xs text-warning">Cancelling… waiting for active attempts to exit.</p> : null}
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
              onClick={() => resolveExecutors.mutate({ graphRunId: graphRun.id, nodeAssignments: assignments })}
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

/** F012 (T016): the graph surface lives on the session face — start, run card,
 *  node retry and executor re-selection. It fetches its own issue/adapters so
 *  the session page only needs the room's issue id. */
export function GraphRunPanel({ issueId }: { issueId: string }) {
  const issueQuery = useIssue(issueId);
  const issueStatus = issueQuery.data?.issue.status;
  const projectId = issueQuery.data?.issue.project_id ?? null;
  const adaptersQuery = useAdapters(projectId);
  const graphQuery = useGraph(issueId);
  const adapters = adaptersQuery.data?.adapters ?? [];

  if (issueStatus === undefined) return null;

  if (graphQuery.data?.current) {
    return (
      <GraphRunCard
        graphRun={graphQuery.data.current.graph_run}
        nodes={graphQuery.data.current.nodes}
        adapters={adapters}
      />
    );
  }

  if (issueStatus === IssueStatus.Inbox) {
    return <StartGraphDialog issueId={issueId} adapters={adapters} disabled={adaptersQuery.isLoading} />;
  }

  return null;
}
