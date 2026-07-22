import { Fragment, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ThreadEventType, type ThreadEvent as ThreadEventData, type Run } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CommandTraceCard } from "@/components/trace/CommandTraceCard";
import { VerificationTraceCard } from "@/components/trace/VerificationTraceCard";
import { FileChangeTraceCard } from "@/components/trace/FileChangeTraceCard";
import { HandoffTraceCard } from "@/components/trace/HandoffTraceCard";
import { ValidationTraceCard } from "@/components/trace/ValidationTraceCard";
import { describeCancellationReason, runPurposeLabel, isConsultRun } from "@/lib/run-display";

interface ThreadEventProps {
  event: ThreadEventData;
  consecutiveOutputChunks?: ThreadEventData[];
  /** T095/T096: cross-referenced to render honest, always-current routing badges — never derived from the event payload alone, since Run state can move on after the event was written. */
  runs?: Run[];
}

/** design's "实际Run card始终以后端返回metadata为准": look up the live Run, never trust a stale event payload for display. */
function findRun(runs: Run[] | undefined, runId: unknown): Run | null {
  if (!runs || typeof runId !== "string") return null;
  return runs.find((r) => r.id === runId) ?? null;
}

function RunRoutingBadges({ run }: { run: Run }) {
  const consult = isConsultRun(run);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <Badge variant={consult ? "secondary" : "brand"} className="text-[10px]">
        {runPurposeLabel(run)}
      </Badge>
      {run.adapter_identity ? (
        <span className="text-muted-foreground">
          {run.adapter_identity.cli_provider}
          {run.adapter_identity.default_model ? ` · ${run.adapter_identity.default_model}` : ""}
        </span>
      ) : (
        // T096: unknown/missing adapter identity — safe fallback, never crash the renderer.
        <span className="text-muted-foreground">unknown provider</span>
      )}
      <span className="text-muted-foreground">· {run.dispatch_source}</span>
      {run.context_source_run_id ? (
        <span className="text-muted-foreground">
          · continues from run {run.context_source_run_id.slice(0, 12)}
        </span>
      ) : null}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  issue_id: "issue_id",
  project_id: "project_id",
  workspace_id: "workspace_id",
  issue_type: "issue_type",
  status: "status",
  workflow_template_id: "workflow_template_id",
  validation_policy_id: "validation_policy_id",
  primary_thread_id: "primary_thread_id",
  run_id: "run_id",
  thread_id: "thread_id",
  stream: "stream",
  sequence: "sequence",
  exit_code: "exit_code",
  failure_reason: "failure_reason",
  error_message: "error_message",
  reason: "reason",
  blocked_by: "blocked_by",
  pre_execution_blocked: "pre_execution_blocked",
  capability_note: "capability_note",
  detected_operation: "detected_operation",
  previous_status: "previous_status",
  max_bytes: "max_bytes",
};

const RUN_OUTPUT_FIELDS = new Set(["run_id", "stream", "sequence"]);
const RUN_TERMINAL_FIELDS = new Set([
  "run_id",
  "exit_code",
  "failure_reason",
  "error_message",
]);
const RUN_STATUS_FIELDS = new Set(["run_id", "previous_status", "status"]);
const ESCALATION_FIELDS = new Set([
  "run_id",
  "blocked_by",
  "pre_execution_blocked",
  "capability_note",
  "detected_operation",
]);

function getBorderClass(type: string): string {
  switch (type) {
    case ThreadEventType.EscalationTriggered:
    case ThreadEventType.RunFailed:
    case ThreadEventType.IssueBlocked:
    case ThreadEventType.FileChangeScanFailed:
      return "border-l-destructive";
    case ThreadEventType.RunCompleted:
    case ThreadEventType.ValidationPassed:
    case ThreadEventType.IssueDone:
      return "border-l-success";
    case ThreadEventType.RunInterrupted:
    case ThreadEventType.RunOutputTruncated:
    case ThreadEventType.ValidationFailed:
    case ThreadEventType.ValidationBlocked:
    case ThreadEventType.ValidationFinding:
      return "border-l-warning";
    case ThreadEventType.RunCancelled:
    case ThreadEventType.ValidationRequested:
    case ThreadEventType.IssueUnblocked:
      return "border-l-secondary";
    default:
      return "border-l-brand";
  }
}

const F003_TRACE_TYPES = new Set<string>([
  ThreadEventType.CommandStarted,
  ThreadEventType.CommandCompleted,
  ThreadEventType.TestCompleted,
  ThreadEventType.FileChangeSummary,
  ThreadEventType.FileChangeScanFailed,
  ThreadEventType.HandoffCreated,
  ThreadEventType.ValidationRequested,
  ThreadEventType.ValidationFinding,
  ThreadEventType.ValidationPassed,
  ThreadEventType.ValidationFailed,
  ThreadEventType.ValidationBlocked,
  ThreadEventType.IssueDone,
  ThreadEventType.IssueUnblocked,
]);

function renderTraceCard(event: ThreadEventData): React.ReactNode | null {
  switch (event.type) {
    case ThreadEventType.CommandStarted:
    case ThreadEventType.CommandCompleted:
      return <CommandTraceCard event={event} />;
    case ThreadEventType.TestCompleted:
      return <VerificationTraceCard event={event} />;
    case ThreadEventType.FileChangeSummary:
    case ThreadEventType.FileChangeScanFailed:
      return <FileChangeTraceCard event={event} />;
    case ThreadEventType.HandoffCreated:
      return <HandoffTraceCard event={event} />;
    case ThreadEventType.ValidationRequested:
    case ThreadEventType.ValidationFinding:
    case ThreadEventType.ValidationPassed:
    case ThreadEventType.ValidationFailed:
    case ThreadEventType.ValidationBlocked:
    case ThreadEventType.IssueDone:
    case ThreadEventType.IssueUnblocked:
      return <ValidationTraceCard event={event} />;
    default:
      return null;
  }
}

function getRelevantFields(type: string): Set<string> {
  switch (type) {
    case ThreadEventType.RunOutput:
      return RUN_OUTPUT_FIELDS;
    case ThreadEventType.RunCompleted:
    case ThreadEventType.RunFailed:
      return RUN_TERMINAL_FIELDS;
    case ThreadEventType.RunStarted:
    case ThreadEventType.RunCancelled:
    case ThreadEventType.RunInterrupted:
      return RUN_STATUS_FIELDS;
    case ThreadEventType.EscalationTriggered:
      return ESCALATION_FIELDS;
    default:
      return new Set();
  }
}

const BLOCKED_BY_LABELS: Record<string, string> = {
  credential_isolation:
    "Push blocked by credential isolation — no push credentials provisioned",
  pre_execution_approval:
    "Push blocked by pre-execution approval — command was rejected before execution",
  post_hoc_detection:
    "Push detected after execution — this is post-hoc detection, not pre-execution blocking",
};

export function ThreadEvent({ event, consecutiveOutputChunks, runs }: ThreadEventProps) {
  const [outputExpanded, setOutputExpanded] = useState(false);
  const payload = event.payload_json;
  const relevantFields = getRelevantFields(event.type);
  const cancellationText = event.type === ThreadEventType.RunCancelled
    ? describeCancellationReason(payload.reason)
    : null;
  const queuedRun = event.type === ThreadEventType.RunQueued
    ? findRun(runs, payload.run_id)
    : null;

  const fields = Object.keys(FIELD_LABELS).filter((key) => {
    if (!(key in payload)) return false;
    if (relevantFields.size > 0) return relevantFields.has(key);
    return true;
  });

  const isRunOutput = event.type === ThreadEventType.RunOutput;
  const hasConsecutive = consecutiveOutputChunks && consecutiveOutputChunks.length > 1;

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[720px] gap-1.5 rounded-lg border border-l-[3px] border-border bg-card px-3.5 py-3",
        getBorderClass(event.type),
        (event.type === ThreadEventType.EscalationTriggered ||
          event.type === ThreadEventType.IssueBlocked) &&
          "bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12.5px] font-semibold text-foreground">
            {event.type}
          </span>
          {event.type === ThreadEventType.RunOutputTruncated ? (
            <Badge variant="warning" className="text-[10px]">
              Output truncated at 1 MiB
            </Badge>
          ) : null}
          {event.type === ThreadEventType.IssueBlocked ? (
            <Badge variant="destructive" className="text-[10px]">
              Issue blocked
            </Badge>
          ) : null}
          {event.type === ThreadEventType.RunCancelled && payload.reason ? (
            <Badge variant="secondary" className="text-[10px]">
              {String(payload.reason)}
            </Badge>
          ) : null}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {new Date(event.created_at).toLocaleString()}
        </span>
      </div>

      {event.type === ThreadEventType.EscalationTriggered ? (
        <div className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
          {payload.blocked_by ? (
            <p className="text-destructive">
              {BLOCKED_BY_LABELS[String(payload.blocked_by)] ?? String(payload.blocked_by)}
            </p>
          ) : null}
          {payload.capability_note ? (
            <p className="text-muted-foreground">{String(payload.capability_note)}</p>
          ) : null}
          {payload.detected_operation ? (
            <p className="text-muted-foreground">
              Detected: {String(payload.detected_operation)}
            </p>
          ) : null}
        </div>
      ) : null}

      {event.type === ThreadEventType.IssueBlocked && payload.reason ? (
        <p className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {String(payload.reason)}
        </p>
      ) : null}

      {queuedRun ? <RunRoutingBadges run={queuedRun} /> : null}

      {cancellationText ? (
        <p className="rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
          {cancellationText}
        </p>
      ) : null}

      {isRunOutput ? (
        <div className="overflow-hidden rounded-md border border-border bg-muted/30">
          {hasConsecutive ? (
            <>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[11px] text-muted-foreground">
                  Output · {consecutiveOutputChunks!.length} chunks
                </span>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setOutputExpanded(!outputExpanded)}
                >
                  {outputExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <div
                className={cn(
                  "overflow-hidden transition-all",
                  outputExpanded ? "max-h-[600px] overflow-auto" : "max-h-8",
                )}
              >
                <pre className="px-3 pb-2 font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                  {outputExpanded
                    ? consecutiveOutputChunks!
                        .map((e) => String(e.payload_json.chunk ?? ""))
                        .join("")
                    : String(consecutiveOutputChunks![0]?.payload_json.chunk ?? "")}
                </pre>
              </div>
            </>
          ) : (
            <pre className="max-h-[300px] overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
              {String(payload.chunk ?? "")}
            </pre>
          )}
        </div>
      ) : null}

      {F003_TRACE_TYPES.has(event.type) ? renderTraceCard(event) : null}

      {fields.length > 0 && !F003_TRACE_TYPES.has(event.type) ? (
        <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 font-mono text-xs">
          {fields.map((key) => (
            <Fragment key={key}>
              <span className="text-muted-foreground">{FIELD_LABELS[key]}</span>
              <span
                className={cn(
                  "text-foreground break-words",
                  key === "error_message" && "text-destructive",
                )}
              >
                {String(payload[key])}
              </span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
