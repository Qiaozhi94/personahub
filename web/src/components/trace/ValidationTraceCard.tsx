import { type ThreadEvent, ValidationFindingSeverity } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";

interface ValidationTraceCardProps {
  event: ThreadEvent;
}

export function ValidationTraceCard({ event }: ValidationTraceCardProps) {
  const payload = event.payload_json;
  const vType = event.type.replace("validation.", "");
  const round = payload.validation_round as number ?? 0;
  const severity = payload.severity as ValidationFindingSeverity | undefined;
  const message = payload.message ? String(payload.message) : null;
  const summary = payload.summary ? String(payload.summary) : null;
  const suggestion = payload.suggestion ? String(payload.suggestion) : null;
  const filePath = payload.file_path ? String(payload.file_path) : null;
  const line = payload.line as number | null;

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
          <span className="font-mono text-[12px] font-semibold text-foreground">Validation {vType}</span>
          <span className="text-[10px] text-muted-foreground">round {round}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {severity ? (
            <Badge variant={severityVariant[severity] ?? "secondary"} className="text-[10px]">
              {severity}
            </Badge>
          ) : null}
          {vType === "passed" || vType === "failed" || vType === "blocked" ? (
            <Badge variant={resultVariant[vType] ?? "secondary"} className="text-[10px]">
              {vType}
            </Badge>
          ) : null}
        </div>
      </div>
      {message ? <p className="mt-1 text-[11px] text-foreground/80">{message}</p> : null}
      {summary ? <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p> : null}
      {suggestion ? <p className="mt-0.5 text-[10px] text-muted-foreground">Suggestion: {suggestion}</p> : null}
      {filePath ? (
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {filePath}{line ? `:${line}` : ""}
        </p>
      ) : null}
      <p className="mt-1 text-[9px] italic text-muted-foreground/60">Recorded result - F003 does not change Issue status</p>
    </div>
  );
}
