import { useState, useEffect, useRef } from "react";
import { XCircle } from "lucide-react";
import {
  FailureReason,
  IssueStatus,
  RunStatus,
  ThreadEventType,
  type IssueWithThread,
} from "@personahub/shared";
import { useRuns, useCancelRun } from "@/hooks/use-runs";
import { useThreadEvents } from "@/hooks/use-thread";
import { toApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EvidenceSection } from "./EvidenceSection.js";
import { ValidationInspectorSection } from "./ValidationInspectorSection.js";
import { UnblockDialog } from "./UnblockDialog.js";

interface IssueInspectorProps {
  issue: IssueWithThread;
  workspacePath: string | null;
}

const RUN_STATUS_VARIANT: Record<
  RunStatus,
  "secondary" | "brand" | "success" | "destructive" | "warning"
> = {
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
};

const BLOCKED_BY_EXPLANATIONS: Record<string, string> = {
  credential_isolation:
    "Push blocked by credential isolation — no push credentials provisioned",
  pre_execution_approval:
    "Push blocked by pre-execution approval — command was rejected before execution",
  post_hoc_detection:
    "Push detected after execution — this is post-hoc detection, not pre-execution blocking",
};

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

  const logEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runLogs.length]);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTargetRunId, setCancelTargetRunId] = useState<string | null>(null);
  const [unblockDialogOpen, setUnblockDialogOpen] = useState(false);

  useEffect(() => {
    function handleUnblockEvent(e: CustomEvent) {
      if (e.detail?.issueId === issue.id) {
        setUnblockDialogOpen(true);
      }
    }
    window.addEventListener("personahub:unblock", handleUnblockEvent as EventListener);
    return () => window.removeEventListener("personahub:unblock", handleUnblockEvent as EventListener);
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
                <Badge variant="destructive" className="text-[10px]">
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

      <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
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

      <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Primary Thread</strong>
        <InspectorRow label="Thread" value={issue.primary_thread?.title ?? "—"} />
      </section>

      {runsQuery.isLoading ? (
        <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
          <strong className="text-sm">Latest Run</strong>
          <span className="text-xs text-muted-foreground">Loading…</span>
        </section>
      ) : latestRun ? (
        <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Latest Run</strong>
            <Badge variant={RUN_STATUS_VARIANT[latestRun.status]} className="text-[10px]">
              {latestRun.status}
            </Badge>
          </div>
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
              <div className="mt-1 max-h-48 overflow-y-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
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
                <div ref={logEndRef} />
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
        <section className="grid gap-2 rounded-lg border border-dashed border-border bg-card p-3.5">
          <strong className="text-sm">Latest Run</strong>
          <span className="text-xs text-muted-foreground">No runs yet</span>
        </section>
      )}

      <EvidenceSection issue={issue} />

      <ValidationInspectorSection issueId={issue.id} />

      <UnblockDialog
        issueId={issue.id}
        open={unblockDialogOpen}
        onOpenChange={() => setUnblockDialogOpen(false)}
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
    <div className="grid grid-cols-[96px_1fr] items-start gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs break-words">{value}</span>
    </div>
  );
}
