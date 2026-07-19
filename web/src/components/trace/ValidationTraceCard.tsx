import { type ThreadEvent, ValidationFindingSeverity, ThreadEventType } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";

interface ValidationTraceCardProps {
  event: ThreadEvent;
}

export function ValidationTraceCard({ event }: ValidationTraceCardProps) {
  const payload = event.payload_json;

  if (event.type === ThreadEventType.IssueDone) {
    return <IssueDoneCard payload={payload} />;
  }
  if (event.type === ThreadEventType.IssueUnblocked) {
    return <IssueUnblockedCard payload={payload} />;
  }

  const vType = event.type.replace("validation.", "");
  const round = payload.validation_round as number ?? 0;
  const severity = payload.severity as ValidationFindingSeverity | undefined;
  const message = payload.message ? String(payload.message) : null;
  const summary = payload.summary ? String(payload.summary) : null;
  const suggestion = payload.suggestion ? String(payload.suggestion) : null;
  const filePath = payload.file_path ? String(payload.file_path) : null;
  const line = payload.line as number | null;
  const sameOrigin = payload.same_origin_validation as boolean | undefined;
  const findingCount = payload.finding_count as number | undefined;
  const reasonCode = payload.reason_code as string | undefined;
  const nextStatus = payload.next_status as string | undefined;

  const severityVariant: Record<string, "secondary" | "warning" | "destructive"> = {
    [ValidationFindingSeverity.Info]: "secondary",
    [ValidationFindingSeverity.Warning]: "warning",
    [ValidationFindingSeverity.Error]: "destructive",
    [ValidationFindingSeverity.Blocking]: "destructive",
  };

  const resultVariant: Record<string, "success" | "destructive" | "warning"> = {
    passed: "success",
    failed: "destructive",
    blocked: "warning",
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-semibold text-foreground">
            Validation {vType}
          </span>
          <span className="text-[10px] text-muted-foreground">round {round}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {severity ? (
            <Badge variant={severityVariant[severity] ?? "secondary"} className="text-[10px]">
              {severity}
            </Badge>
          ) : null}
          {sameOrigin !== undefined ? (
            <Badge variant={sameOrigin ? "secondary" : "brand"} className="text-[10px]">
              {sameOrigin ? "Same-origin" : "Independent"}
            </Badge>
          ) : null}
          {vType === "passed" || vType === "failed" || vType === "blocked" ? (
            <Badge variant={resultVariant[vType] ?? "secondary"} className="text-[10px]">
              {vType}
            </Badge>
          ) : null}
        </div>
      </div>
      {vType === "requested" ? (
        <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground">
          <span>
            policy: {typeof payload.policy_id === "string" ? payload.policy_id : "—"} v{typeof payload.policy_version === "number" ? payload.policy_version : "—"}
          </span>
        </div>
      ) : null}
      {message ? <p className="mt-1 text-[11px] text-foreground/80">{message}</p> : null}
      {summary ? <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p> : null}
      {suggestion ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Suggestion: {suggestion}
        </p>
      ) : null}
      {filePath ? (
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {filePath}{line ? `:${line}` : ""}
        </p>
      ) : null}
      {findingCount !== undefined && findingCount > 0 ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {findingCount} finding{findingCount !== 1 ? "s" : ""}
        </p>
      ) : null}
      {reasonCode ? (
        <p className="mt-0.5 font-mono text-[10px] text-destructive/70">
          {reasonCode}
        </p>
      ) : null}
      {nextStatus ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {"\u2192"} {nextStatus}
        </p>
      ) : null}
    </div>
  );
}

function IssueDoneCard(_props: { payload: Record<string, unknown> }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-foreground">
          Issue Done
        </span>
        <Badge variant="success" className="text-[10px]">done</Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Evidence Summary</p>
    </div>
  );
}

function IssueUnblockedCard({ payload }: { payload: Record<string, unknown> }) {
  const note = payload.operator_note ? String(payload.operator_note) : null;
  const nextStatus = payload.status ? String(payload.status) : null;

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-foreground">
          Issue Unblocked
        </span>
        {nextStatus ? (
          <span className="text-[10px] text-muted-foreground">
            {"\u2192"} {nextStatus}
          </span>
        ) : null}
      </div>
      {note ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}
