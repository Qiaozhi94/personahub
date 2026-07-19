import { useState } from "react";
import { type ThreadEvent } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";
import { useRunEvidence } from "@/hooks/use-trace";

interface FileChangeTraceCardProps {
  event: ThreadEvent;
}

export function FileChangeTraceCard({ event }: FileChangeTraceCardProps) {
  const [viewAll, setViewAll] = useState(false);
  const payload = event.payload_json;
  const runId = payload.run_id as string | undefined;
  const scanner = String(payload.scanner ?? "");
  const totalCount = payload.total_count as number ?? 0;
  const added = payload.added_count as number ?? 0;
  const modified = payload.modified_count as number ?? 0;
  const deleted = payload.deleted_count as number ?? 0;
  const renamed = payload.renamed_count as number ?? 0;
  const scanTruncated = Boolean(payload.scan_truncated);
  const preview = payload.preview as Array<{ path: string; change_type: string }> | undefined;
  const previewTruncated = Boolean(payload.preview_truncated);
  const recovered = Boolean(payload.recovered_after_restart);

  const {
    isLoading: evidenceLoading,
    isError: evidenceError,
    allFileChanges,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRunEvidence(viewAll ? runId ?? null : null);

  if (event.type === "file.change_scan_failed") {
    const reasonCode = String(payload.reason_code ?? "unknown");
    const message = payload.message ? String(payload.message) : "File scan failed.";
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="text-[10px]">Scan Failed</Badge>
          {recovered ? <Badge variant="warning" className="text-[10px]">Recovered</Badge> : null}
        </div>
        <p className="mt-1 text-[11px] text-destructive">{message}</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">reason: {reasonCode}</p>
      </div>
    );
  }

  const showViewAll = (previewTruncated || totalCount > 5) && runId;

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-semibold text-foreground">{totalCount} changes</span>
          <span className="text-[10px] text-muted-foreground">{scanner}</span>
        </div>
        {scanTruncated ? <Badge variant="warning" className="text-[10px]">Scan Truncated</Badge> : null}
        {recovered ? <Badge variant="warning" className="text-[10px]">Recovered</Badge> : null}
      </div>
      <div className="mt-1 flex gap-3 text-[11px]">
        {added > 0 ? <span className="text-success">+{added} added</span> : null}
        {modified > 0 ? <span className="text-warning">~{modified} modified</span> : null}
        {deleted > 0 ? <span className="text-destructive">-{deleted} deleted</span> : null}
        {renamed > 0 ? <span className="text-muted-foreground">{renamed} renamed</span> : null}
      </div>
      {viewAll && evidenceLoading ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">Loading...</p>
      ) : viewAll && evidenceError ? (
        <p className="mt-1.5 text-[10px] text-destructive">Failed to load file changes</p>
      ) : viewAll && allFileChanges.length === 0 ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">No file changes recorded</p>
      ) : viewAll ? (
        <>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-muted-foreground max-h-[200px] overflow-auto">
            {allFileChanges.map((fc) => (
              <li key={fc.id}>{fc.path} ({fc.change_type})</li>
            ))}
          </ul>
          {hasNextPage ? (
            <div className="mt-1">
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                disabled={!hasNextPage || isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage ? "Loading more..." : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : preview && preview.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-muted-foreground">
          {preview.slice(0, 5).map((p, i) => (
            <li key={i}>{p.path} ({p.change_type})</li>
          ))}
          {previewTruncated ? <li className="text-muted-foreground/60">... more files</li> : null}
        </ul>
      ) : null}
      {showViewAll ? (
        <button
          type="button"
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setViewAll(!viewAll)}
        >
          {viewAll ? "Show less" : "View all"}
        </button>
      ) : null}
    </div>
  );
}
