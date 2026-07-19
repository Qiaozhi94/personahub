import { useState } from "react";
import { IssueStatus, ValidationFindingSeverity, ValidationBlockReason } from "@personahub/shared";
import { useValidationStatus } from "@/hooks/use-validation";
import { toApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ValidationInspectorSectionProps {
  issueId: string | null;
}

export function ValidationInspectorSection({ issueId }: ValidationInspectorSectionProps) {
  const validationQuery = useValidationStatus(issueId);
  const [copied, setCopied] = useState(false);

  if (!issueId) {
    return null;
  }

  if (validationQuery.isLoading) {
    return (
      <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Validation</strong>
        <span className="text-xs text-muted-foreground">Loading…</span>
      </section>
    );
  }

  if (validationQuery.isError) {
    return (
      <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
        <strong className="text-sm">Validation</strong>
        <span className="text-xs text-destructive">
          Error loading: {toApiError(validationQuery.error).message}
        </span>
      </section>
    );
  }

  const data = validationQuery.data;
  if (!data) {
    return null;
  }

  const statusBadgeVariant: Record<string, "brand" | "success" | "destructive" | "warning" | "secondary"> = {
    [IssueStatus.Validating]: "brand",
    [IssueStatus.Done]: "success",
    [IssueStatus.Blocked]: "destructive",
    [IssueStatus.Running]: "warning",
    [IssueStatus.Inbox]: "secondary",
    [IssueStatus.Ready]: "secondary",
  };

  const findingSeverityVariant: Record<string, "secondary" | "warning" | "destructive"> = {
    [ValidationFindingSeverity.Info]: "secondary",
    [ValidationFindingSeverity.Warning]: "warning",
    [ValidationFindingSeverity.Error]: "destructive",
    [ValidationFindingSeverity.Blocking]: "destructive",
  };

  const hasEvidenceSummary = data.evidence_summary !== null;
  const summaryMarkdown = data.evidence_summary?.summary_markdown ?? "";
  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };
  const handleDownloadSummary = () => {
    const blob = new Blob([summaryMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-summary-${issueId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <section className="grid gap-2 rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between">
        <strong className="text-sm">Validation</strong>
        <div className="flex items-center gap-1.5">
          {hasEvidenceSummary ? (
            <Badge variant={data.evidence_summary?.same_origin_validation ? "secondary" : "brand"} className="text-[10px]">
              {data.evidence_summary!.same_origin_validation ? "Same-origin" : "Independent"}
            </Badge>
          ) : null}
          <Badge variant={statusBadgeVariant[data.status] ?? "secondary"} className="text-[10px]">
            {data.status}
          </Badge>
        </div>
      </div>

      {data.current_round ? (
        <InspectorRow
          label="Round"
          value={`${data.current_round} / ${data.max_rounds}`}
        />
      ) : null}
      {data.completed_failed_rounds > 0 ? (
        <InspectorRow label="Failures" value={String(data.completed_failed_rounds)} />
      ) : null}

      {data.blocker ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-semibold text-destructive">Blocked</p>
          <p className="mt-0.5 text-[11px] text-destructive/80">{data.blocker.message}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {data.blocker.reason_code}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              const event = new CustomEvent("personahub:unblock", {
                detail: { issueId },
              });
              window.dispatchEvent(event);
            }}
          >
            Resolve Blocker…
          </Button>
          {data.blocker.reason_code === ValidationBlockReason.RoundLimitReached ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("personahub:reset-rounds", { detail: { issueId } }));
              }}
            >
              Reset Rounds…
            </Button>
          ) : null}
        </div>
      ) : null}

      {data.latest_findings.length > 0 ? (
        <div className="border-t border-border pt-1.5">
          <p className="text-xs font-semibold text-foreground">Latest Findings</p>
          <div className="mt-1 grid gap-1">
            {data.latest_findings.slice(0, 10).map((f) => (
              <div
                key={f.event_id}
                className="rounded border border-border bg-muted/20 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant={findingSeverityVariant[f.severity] ?? "secondary"}
                    className="text-[9px]"
                  >
                    {f.severity}
                  </Badge>
                  {f.file_path ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {f.file_path}{f.line ? `:${f.line}` : ""}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-foreground/80">{f.message}</p>
                {f.suggestion ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {f.suggestion}
                  </p>
                ) : null}
              </div>
            ))}
            {data.latest_findings.length > 10 ? (
              <p className="text-[10px] text-muted-foreground">
                +{data.latest_findings.length - 10} more findings
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasEvidenceSummary ? (
        <div className="border-t border-border pt-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Evidence Summary</p>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleCopySummary}>
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleDownloadSummary}>
                Download
              </Button>
            </div>
          </div>
          <div className="mt-1 max-h-48 overflow-y-auto rounded bg-muted/30 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
            {data.evidence_summary!.summary_markdown}
          </div>
        </div>
      ) : null}
    </section>
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
