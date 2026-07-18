import { type ThreadEvent, VerificationResult } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";

interface VerificationTraceCardProps {
  event: ThreadEvent;
}

export function VerificationTraceCard({ event }: VerificationTraceCardProps) {
  const payload = event.payload_json;
  const kind = String(payload.test_kind ?? "");
  const result = payload.result as VerificationResult | undefined;
  const exitCode = payload.exit_code as number | null;
  const summary = payload.summary ? String(payload.summary) : null;
  const confidence = String(payload.confidence ?? "");

  const resultVariant: Record<string, "success" | "destructive" | "secondary"> = {
    [VerificationResult.Passed]: "success",
    [VerificationResult.Failed]: "destructive",
    [VerificationResult.Unknown]: "secondary",
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-semibold text-foreground">{kind}</span>
        {result ? (
          <Badge variant={resultVariant[result] ?? "secondary"} className="text-[10px]">
            {result}
          </Badge>
        ) : null}
      </div>
      {summary ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p>
      ) : null}
      <div className="mt-1 flex gap-3 font-mono text-[10px] text-muted-foreground">
        {exitCode !== null && exitCode !== undefined ? <span>exit: {exitCode}</span> : null}
        {confidence ? <span>confidence: {confidence}</span> : null}
      </div>
    </div>
  );
}
