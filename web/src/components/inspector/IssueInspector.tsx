import { useState, useEffect, useRef } from "react";
import { XCircle, RotateCcw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FailureReason,
  IssueStatus,
  RunDispatchSource,
  RunRole,
  RunStatus,
  ThreadEventType,
  GraphRunStatus,
  NodeRunStatus,
  GraphBlockReason,
  type IssueWithThread,
} from "@personahub/shared";
import { useRuns, useCancelRun } from "@/hooks/use-runs";
import { useThreadEvents } from "@/hooks/use-thread";
import { apiClient, toApiError } from "@/lib/api-client";
import { runPurposeLabel } from "@/lib/run-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EvidenceSection } from "./EvidenceSection.js";
import { ValidationInspectorSection } from "./ValidationInspectorSection.js";
import { UnblockDialog } from "./UnblockDialog.js";
import { ResetRoundsDialog } from "./ResetRoundsDialog.js";

interface IssueInspectorProps {
  issue: IssueWithThread;
  workspacePath: string | null;
}

const RUN_STATUS_VARIANT: Record<RunStatus, "secondary" | "brand" | "success" | "destructive" | "warning"> = {
  [RunStatus.Queued]: "secondary",
  [RunStatus.Running]: "brand",
  [RunStatus.Completed]: "success",
  [RunStatus.Failed]: "destructive",
  [RunStatus.Interrupted]: "warning",
  [RunStatus.Cancelled]: "secondary",
};

const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  [FailureReason.AdapterExitNonzero]: "Adapter exited with non-zero code",
  [FailureReason.SpawnFailed]: "Failed to spawn adapter process",
  [FailureReason.ExecutionTimeout]: "Execution timed out",
  [FailureReason.CredentialIsolationBlocked]: "Push blocked by credential isolation",
  [FailureReason.PreExecutionApprovalRejected]: "Push blocked by pre-execution approval",
  [FailureReason.PostHocEscalation]: "Push detected after execution (post-hoc detection)",
  [FailureReason.ServerRestarted]: "Server restarted during execution",
  [FailureReason.OutputParseFailed]: "Failed to parse adapter output",
  [FailureReason.AdapterNoLongerEligible]: "Adapter no longer eligible for graph node",
};

const BLOCKED_BY_EXPLANATIONS: Record<string, string> = {
  credential_isolation:
    "Push blocked by credential isolation — no push credentials provisioned",
  pre_execution_approval:
    "Push blocked by pre-execution approval — command was rejected before execution",
  post_hoc_detection:
    "Push detected after execution — this is post-hoc detection, not pre-execution blocking",
};

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

function GraphInspectorSection({ issueId }: { issueId: string }) {
  const graphQuery = useGraph(issueId);
  const retryNode = useRetryGraphNode();
  const cancelGraph = useCancelGraphRun();
  const retryError = retryNode.isError ? toApiError(retryNode.error).message : null;
  const cancelError = cancelGraph.isError ? toApiError(cancelGraph.error).message : null;

  if (graphQuery.isLoading) {
    return (
      <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Graph Run</strong>
        <span className="text-xs text-muted-foreground">Loading…</span>
      </section>
    );
  }

  const current = graphQuery.data?.current;
  const history = graphQuery.data?.history ?? [];
  const lastTerminal = history.find((h) => h.status === GraphRunStatus.Completed || h.status === GraphRunStatus.Cancelled);

  if (!current) {
    return lastTerminal ? (
      <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Graph Run</strong>
        <InspectorRow label="Status" value={`${lastTerminal.status} (last run ${new Date(lastTerminal.created_at).toLocaleString()})`} />
      </section>
    ) : null;
  }

  const { graph_run, nodes, edges } = current;
  const isBlocked = graph_run.status === GraphRunStatus.Blocked;
  const isCancelling = graph_run.status === GraphRunStatus.Cancelling;
  const isTerminal = graph_run.status === GraphRunStatus.Completed || graph_run.status === GraphRunStatus.Cancelled;
  const activeRunIds = nodes.flatMap((n) => n.attempts.filter((a) => a.status === "running").map((a) => a.run_id));

  return (
    <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between">
        <strong className="text-sm">Graph Run</strong>
        <div className="flex items-center gap-2">
          {!isTerminal ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={cancelGraph.isPending}
              onClick={() => cancelGraph.mutate(graph_run.id)}
            >
              <XCircle className="mr-1 h-3 w-3" />
              {isCancelling ? "Force Cancel" : "Cancel"}
            </Button>
          ) : null}
          <Badge variant={GRAPH_RUN_STATUS_VARIANT[graph_run.status]} className="text-[11px]">
            {graph_run.status}
          </Badge>
        </div>
      </div>

      <InspectorRow label="Definition" value={`${graph_run.definition_id} v${graph_run.definition_version}`} />
      <InspectorRow label="Updated" value={new Date(graph_run.updated_at).toLocaleString()} />

      {graph_run.blocked_reason_code ? (
        <InspectorRow
          label="Blocked reason"
          value={GRAPH_BLOCK_REASON_LABELS[graph_run.blocked_reason_code] ?? graph_run.blocked_reason_code}
        />
      ) : null}

      {isBlocked && graph_run.blocked_node_keys.length > 0 ? (
        <div className="border-t border-border pt-1.5">
          <span className="text-xs text-muted-foreground">Blocked nodes</span>
          <ul className="mt-1 grid gap-1">
            {graph_run.blocked_node_keys.map((key) => {
              const node = nodes.find((n) => n.node_key === key);
              const canRetry =
                node &&
                (node.status === NodeRunStatus.Failed ||
                  node.status === NodeRunStatus.Interrupted ||
                  node.status === NodeRunStatus.Cancelled);
              return (
                <li key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{key}</span>
                  {canRetry ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={retryNode.isPending || isCancelling}
                      onClick={() => retryNode.mutate({ graphRunId: graph_run.id, nodeKey: key })}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Retry
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {isCancelling ? (
        <div className="border-t border-border pt-1.5">
          <p className="text-xs text-warning">Cancelling… waiting for active attempts to exit.</p>
          {activeRunIds.length > 0 ? (
            <div className="mt-1 grid gap-0.5">
              <span className="text-[11px] text-muted-foreground">Active runs</span>
              {activeRunIds.map((id) => (
                <span key={id} className="font-mono text-[11px] text-muted-foreground">
                  {id.slice(0, 12)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {nodes.length > 0 ? (
        <div className="border-t border-border pt-1.5">
          <span className="text-xs text-muted-foreground">Nodes</span>
          <ul className="mt-1 grid gap-1">
            {nodes.map((node) => (
              <li key={node.node_key} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                <span className="min-w-0 truncate text-xs font-medium">{node.node_key}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">{node.attempts.length}</span>
                  <Badge variant={NODE_RUN_STATUS_VARIANT[node.status]} className="text-[11px]">
                    {node.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {edges.length > 0 ? (
        <div className="border-t border-border pt-1.5">
          <span className="text-xs text-muted-foreground">Edges</span>
          <ul className="mt-1 grid gap-1">
            {edges.map((edge) => (
              <li key={`${edge.from}->${edge.to}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {edge.from} → {edge.to}
                </span>
                {edge.outcome ? (
                  <Badge variant={edge.outcome === "completed" ? "success" : "secondary"} className="text-[11px]">
                    {edge.outcome}
                  </Badge>
                ) : (
                  <span className="text-[11px] text-muted-foreground">pending</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {retryError ? <p className="text-xs text-destructive">{retryError}</p> : null}
      {cancelError ? <p className="text-xs text-destructive">{cancelError}</p> : null}
    </section>
  );
}

export function IssueInspector({ issue, workspacePath }: IssueInspectorProps) {
  const runsQuery = useRuns(issue.id);
  const cancelRun = useCancelRun();

  const runs = runsQuery.data?.runs ?? [];
  const latestRun = runs.length > 0 ? runs[0] : null;
  const isBlocked = issue.status === IssueStatus.Blocked;

  const threadId = issue.primary_thread?.id ?? null;
  const eventsQuery = useThreadEvents(threadId);
  const allEvents = eventsQuery.data?.events ?? [];
  const runLogs = latestRun
    ? allEvents.filter(
        (e) => e.type === ThreadEventType.RunOutput && e.payload_json?.run_id === latestRun.id,
      )
    : [];
  const hasTruncation = latestRun
    ? allEvents.some(
        (e) => e.type === ThreadEventType.RunOutputTruncated && e.payload_json?.run_id === latestRun.id,
      )
    : false;

  const logContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = logContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [runLogs.length]);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTargetRunId, setCancelTargetRunId] = useState<string | null>(null);
  const [unblockDialogOpen, setUnblockDialogOpen] = useState(false);
  const [resetRoundsDialogOpen, setResetRoundsDialogOpen] = useState(false);

  useEffect(() => {
    function handleUnblockEvent(e: CustomEvent) {
      if (e.detail?.issueId === issue.id) {
        setUnblockDialogOpen(true);
      }
    }
    function handleResetRoundsEvent(e: CustomEvent) {
      if (e.detail?.issueId === issue.id) {
        setResetRoundsDialogOpen(true);
      }
    }
    window.addEventListener("personahub:unblock", handleUnblockEvent as EventListener);
    window.addEventListener("personahub:reset-rounds", handleResetRoundsEvent as EventListener);
    return () => {
      window.removeEventListener("personahub:unblock", handleUnblockEvent as EventListener);
      window.removeEventListener("personahub:reset-rounds", handleResetRoundsEvent as EventListener);
    };
  }, [issue.id]);

  function openCancelDialog(runId: string) {
    setCancelTargetRunId(runId);
    setCancelDialogOpen(true);
  }

  function handleCancelConfirm() {
    if (cancelTargetRunId) {
      cancelRun.mutate(cancelTargetRunId, {
        onSuccess: () => setCancelDialogOpen(false),
      });
    }
  }

  const cancelError = cancelRun.isError ? toApiError(cancelRun.error).message : null;

  return (
    <>
      {isBlocked ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-3.5">
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="grid gap-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <strong className="text-sm text-destructive">Issue Blocked</strong>
                <Badge variant="destructive" className="text-[11px]">
                  blocked
                </Badge>
              </div>
              {latestRun?.failure_reason ? (
                <p className="text-xs text-destructive/80">
                  {
                    BLOCKED_BY_EXPLANATIONS[
                      latestRun.failure_reason === FailureReason.CredentialIsolationBlocked
                        ? "credential_isolation"
                        : latestRun.failure_reason === FailureReason.PreExecutionApprovalRejected
                          ? "pre_execution_approval"
                          : latestRun.failure_reason === FailureReason.PostHocEscalation
                            ? "post_hoc_detection"
                            : ""
                    ] ?? FAILURE_REASON_LABELS[latestRun.failure_reason]
                  }
                </p>
              ) : null}
              {latestRun?.error_message ? (
                <p className="text-xs text-muted-foreground">
                  {latestRun.error_message}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Issue Inspector</h2>
        <span className="text-xs text-muted-foreground">{issue.title}</span>
      </section>

      <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Issue</strong>
        <InspectorRow label="Status" value={issue.status} />
        <InspectorRow label="Priority" value={issue.priority} />
        <InspectorRow
          label="Labels"
          value={issue.labels.length > 0 ? issue.labels.join(", ") : "—"}
        />
        <InspectorRow label="Round" value={String(issue.validation_round_count)} />
        <InspectorRow label="Workspace" value={workspacePath ?? "—"} />
        <InspectorRow label="Created" value={new Date(issue.created_at).toLocaleString()} />
      </section>

      <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Primary Thread</strong>
        <InspectorRow label="Thread" value={issue.primary_thread?.title ?? "—"} />
      </section>

      {runsQuery.isLoading ? (
        <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
          <strong className="text-sm">Latest Run</strong>
          <span className="text-xs text-muted-foreground">Loading…</span>
        </section>
      ) : latestRun ? (
        <section className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Latest Run</strong>
            <Badge variant={RUN_STATUS_VARIANT[latestRun.status]} className="text-[11px]">
              {latestRun.status}
            </Badge>
          </div>
          {/* T097/T098: routing metadata — never derived client-side, always
              exactly what the server returned on this Run. adapter_identity
              never carries api_key, so nothing here can leak auth material. */}
          <InspectorRow label="Purpose" value={runPurposeLabel(latestRun)} />
          <InspectorRow
            label="Adapter"
            value={latestRun.adapter_identity
              ? `${latestRun.adapter_identity.name} (${latestRun.adapter_identity.cli_provider}${latestRun.adapter_identity.default_model ? ` · ${latestRun.adapter_identity.default_model}` : ""})`
              : "unknown provider"}
          />
          <InspectorRow label="Source" value={latestRun.dispatch_source} />
          {latestRun.context_source_run_id ? (
            <InspectorRow label="Context from" value={`run ${latestRun.context_source_run_id.slice(0, 12)}`} />
          ) : null}
          {latestRun.role === RunRole.Validator && latestRun.dispatch_source === RunDispatchSource.UserExplicit ? (
            <p className="text-xs text-brand">Manually selected validator</p>
          ) : null}
          <InspectorRow
            label="Started"
            value={latestRun.started_at ? new Date(latestRun.started_at).toLocaleString() : "—"}
          />
          <InspectorRow
            label="Completed"
            value={latestRun.completed_at ? new Date(latestRun.completed_at).toLocaleString() : "—"}
          />
          <InspectorRow
            label="Exit code"
            value={latestRun.exit_code !== null ? String(latestRun.exit_code) : "—"}
          />
          {latestRun.failure_reason ? (
            <InspectorRow
              label="Failure"
              value={FAILURE_REASON_LABELS[latestRun.failure_reason] ?? latestRun.failure_reason}
            />
          ) : null}
          {latestRun.error_message ? (
            <div className="border-t border-border pt-1.5">
              <p className="text-xs text-destructive whitespace-pre-wrap break-words">
                {latestRun.error_message}
              </p>
            </div>
          ) : null}

          {runLogs.length > 0 ? (
            <div className="border-t border-border pt-1.5">
              <span className="text-xs text-muted-foreground">Run Logs</span>
              <div
                ref={logContainerRef}
                className="mt-1 max-h-48 overflow-y-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed"
              >
                {runLogs.map((e) => {
                  const chunk = (e.payload_json?.chunk as string) ?? "";
                  const stream = (e.payload_json?.stream as string) ?? "stdout";
                  return (
                    <pre
                      key={e.id}
                      className={stream === "stderr" ? "text-destructive whitespace-pre-wrap break-words" : "whitespace-pre-wrap break-words"}
                    >
                      {chunk}
                    </pre>
                  );
                })}
                {hasTruncation ? (
                  <p className="text-[10px] text-muted-foreground italic">[output truncated at 1 MiB]</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {(latestRun.status === RunStatus.Queued ||
            latestRun.status === RunStatus.Running) ? (
            <div className="border-t border-border pt-1.5">
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                disabled={cancelRun.isPending}
                onClick={() => openCancelDialog(latestRun.id)}
              >
                {cancelRun.isPending ? "Cancelling…" : "Cancel Run"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="grid min-w-0 gap-2 rounded-lg border border-dashed border-border bg-card p-3.5">
          <strong className="text-sm">Latest Run</strong>
          <span className="text-xs text-muted-foreground">No runs yet</span>
        </section>
      )}

      <EvidenceSection issue={issue} />

      <ValidationInspectorSection issueId={issue.id} />

      <GraphInspectorSection issueId={issue.id} />

      <UnblockDialog
        issueId={issue.id}
        open={unblockDialogOpen}
        onOpenChange={() => setUnblockDialogOpen(false)}
      />

      <ResetRoundsDialog
        issueId={issue.id}
        open={resetRoundsDialogOpen}
        onOpenChange={() => setResetRoundsDialogOpen(false)}
      />

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Run</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to cancel this run? This action cannot be undone.
          </p>
          {cancelError ? (
            <p className="text-xs text-destructive">{cancelError}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={cancelRun.isPending}
            >
              Keep running
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelConfirm}
              disabled={cancelRun.isPending}
            >
              {cancelRun.isPending ? "Cancelling…" : "Yes, cancel run"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-start gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}
