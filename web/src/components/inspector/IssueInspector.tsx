import type { IssueWithThread } from "@personahub/shared";

interface IssueInspectorProps {
  issue: IssueWithThread;
  workspacePath: string | null;
}

export function IssueInspector({ issue, workspacePath }: IssueInspectorProps) {
  return (
    <>
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
    </>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-start gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs">{value}</span>
    </div>
  );
}
