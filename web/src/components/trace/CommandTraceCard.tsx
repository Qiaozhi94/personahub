import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type ThreadEvent, CommandOutcome } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";

interface CommandTraceCardProps {
  event: ThreadEvent;
}

export function CommandTraceCard({ event }: CommandTraceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const payload = event.payload_json;
  const command = String(payload.command ?? "");
  const outcome = payload.outcome as CommandOutcome | undefined;
  const cwd = payload.cwd ? String(payload.cwd) : null;
  const truncated = Boolean(payload.command_truncated);
  const durationMs = payload.duration_ms as number | null;
  const exitCode = payload.exit_code as number | null;
  const source = String(payload.source ?? "");
  const confidence = String(payload.confidence ?? "");

  const outcomeVariant: Record<string, "destructive" | "success" | "warning" | "secondary"> = {
    [CommandOutcome.Succeeded]: "success",
    [CommandOutcome.Failed]: "destructive",
    [CommandOutcome.Blocked]: "warning",
    [CommandOutcome.Cancelled]: "secondary",
    [CommandOutcome.Unknown]: "secondary",
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse command" : "Expand command"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <pre className="font-mono text-[11px] text-foreground/80 whitespace-pre-wrap break-words max-h-8 overflow-hidden">
            {command.slice(0, 120)}
          </pre>
        </div>
        <div className="flex items-center gap-1.5">
          {truncated ? <Badge variant="warning" className="text-[10px]">Truncated</Badge> : null}
          {outcome ? (
            <Badge variant={outcomeVariant[outcome] ?? "secondary"} className="text-[10px]">
              {outcome}
            </Badge>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 font-mono text-[11px]">
          {cwd ? (<><span className="text-muted-foreground">cwd</span><span>{cwd}</span></>) : null}
          {exitCode !== null && exitCode !== undefined ? (<><span className="text-muted-foreground">exit</span><span>{exitCode}</span></>) : null}
          {durationMs !== null && durationMs !== undefined ? (<><span className="text-muted-foreground">duration</span><span>{durationMs}ms</span></>) : null}
          {source ? (<><span className="text-muted-foreground">source</span><span>{source}</span></>) : null}
          {confidence ? (<><span className="text-muted-foreground">confidence</span><span>{confidence}</span></>) : null}
        </div>
      ) : null}
    </div>
  );
}
