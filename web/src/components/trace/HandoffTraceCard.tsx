import { type ThreadEvent } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";

interface HandoffTraceCardProps {
  event: ThreadEvent;
}

export function HandoffTraceCard({ event }: HandoffTraceCardProps) {
  const payload = event.payload_json;
  const runStatus = String(payload.run_status ?? "");
  const summary = payload.summary ? String(payload.summary) : "";
  const nextAction = payload.next_expected_action ? String(payload.next_expected_action) : null;
  const knownRisks = payload.known_risks as string[] | undefined;
  const missingEvidence = payload.missing_evidence as string[] | undefined;
  const refsTruncated = Boolean(payload.evidence_refs_truncated);

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-foreground">Handoff</span>
        <Badge variant="secondary" className="text-[10px]">{runStatus}</Badge>
        {refsTruncated ? <Badge variant="warning" className="text-[10px]">Refs Truncated</Badge> : null}
      </div>
      {summary ? <p className="mt-1 text-[11px] text-foreground/80">{summary}</p> : null}
      {nextAction ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          <span className="font-semibold">Next:</span> {nextAction}
        </p>
      ) : null}
      {knownRisks && knownRisks.length > 0 ? (
        <div className="mt-1.5">
          <span className="text-[10px] font-semibold text-warning">Risks:</span>
          <ul className="ml-3 space-y-0.5">
            {knownRisks.map((risk, i) => (
              <li key={i} className="text-[10px] text-muted-foreground">{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {missingEvidence && missingEvidence.length > 0 ? (
        <div className="mt-1.5">
          <span className="text-[10px] font-semibold text-destructive">Missing:</span>
          <ul className="ml-3 space-y-0.5">
            {missingEvidence.map((m, i) => (
              <li key={i} className="font-mono text-[10px] text-muted-foreground">{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
