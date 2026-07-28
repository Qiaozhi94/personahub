import { type IssueWithThread, ThreadEventType, type TraceCompletenessStatus, type RunTraceSummary } from "@personahub/shared";
import { useIssueTrace, useExportTrace } from "@/hooks/use-trace";
import { useThreadEvents } from "@/hooks/use-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toApiError } from "@/lib/api-client";

interface EvidenceSectionProps {
  issue: IssueWithThread;
}

const COMPLETESS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" }> = {
  complete: { label: "Complete", variant: "success" },
  partial: { label: "Partial", variant: "warning" },
  unavailable: { label: "Unavailable", variant: "destructive" },
};

export function EvidenceSection({ issue }: EvidenceSectionProps) {
  const threadId = issue.primary_thread?.id ?? null;
  const traceQuery = useIssueTrace(issue.id);
  const eventsQuery = useThreadEvents(threadId);
  const exportMutation = useExportTrace();

  if (!traceQuery.data) {
    return null;
  }

  const trace = traceQuery.data;
  const events = eventsQuery.data?.events ?? [];

  const latestRun = trace.runs.find((r: RunTraceSummary) => r.trace_applicable);
  const ic = latestRun?.completeness ?? trace.issue_completeness;
  const runEvents = latestRun
    ? events.filter((e) => e.payload_json.run_id === latestRun.run.id)
    : [];

  const tests = runEvents.filter((e) => e.type === ThreadEventType.TestCompleted);
  const passed = tests.filter((e) => e.payload_json.result === "passed").length;
  const failed = tests.filter((e) => e.payload_json.result === "failed").length;

  const fileEvent = runEvents.find(
    (e) => e.type === ThreadEventType.FileChangeSummary || e.type === ThreadEventType.FileChangeScanFailed,
  );
  const fileTotal = fileEvent?.payload_json.total_count as number ?? 0;
  const fileFailed = fileEvent?.type === ThreadEventType.FileChangeScanFailed;

  const handoff = runEvents.find((e) => e.type === ThreadEventType.HandoffCreated);
  const validation = runEvents.filter((e) => e.type.startsWith("validation.")).pop();

  const dims: Array<[string, TraceCompletenessStatus]> = [
    ["Commands", ic.commands],
    ["Verification", ic.verification],
    ["Files", ic.file_changes],
    ["Refs", ic.refs],
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">Evidence</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate(issue.id)}
        >
          {exportMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Export Markdown
        </Button>
      </div>

      {exportMutation.isError ? (
        <p className="text-[10px] text-destructive">
          Export failed: {toApiError(exportMutation.error).message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
        {dims.map(([label, status]) => {
          const cfg = COMPLETESS_LABELS[status] ?? COMPLETESS_LABELS.unavailable!;
          return (
            <div
              key={label}
              className="flex min-w-0 items-center justify-between gap-1 rounded-md border border-border bg-muted/20 px-2 py-1"
            >
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">{label}</span>
              <Badge variant={cfg.variant} className="shrink-0 text-[9px]">{cfg.label}</Badge>
            </div>
          );
        })}
      </div>

      {tests.length > 0 ? (
        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-foreground">Verification</span>
          <div className="flex gap-2 text-[11px]">
            <span className="text-success">{passed} passed</span>
            <span className="text-destructive">{failed} failed</span>
          </div>
        </div>
      ) : null}

      {fileEvent ? (
        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-foreground">Changed Files</span>
          {fileFailed ? (
            <p className="text-[10px] text-destructive">Scan failed</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">{fileTotal} files changed</p>
          )}
        </div>
      ) : null}

      {handoff ? (
        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-foreground">Handoff</span>
          <p className="text-[10px] text-muted-foreground">
            {String(handoff.payload_json.summary ?? "")}
          </p>
          {handoff.payload_json.next_expected_action ? (
            <p className="text-[10px] text-muted-foreground">
              Next: {String(handoff.payload_json.next_expected_action)}
            </p>
          ) : null}
        </div>
      ) : null}

      {validation ? (
        <div className="space-y-0.5">
          <span className="text-[11px] font-semibold text-foreground">Validation Result</span>
          <p className="text-[10px] text-muted-foreground">
            {validation.type.replace("validation.", "")} - {String(validation.payload_json.summary ?? "")}
          </p>
          <p className="text-[9px] italic text-muted-foreground/60">Recorded result</p>
        </div>
      ) : null}
    </div>
  );
}
