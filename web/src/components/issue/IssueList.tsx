import type { Issue } from "@personahub/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface IssueListProps {
  issues: Issue[];
  selectedIssueId: string | null;
  onSelect: (issueId: string) => void;
}

function statusBadgeVariant(status: Issue["status"]) {
  switch (status) {
    case "Done":
      return "success" as const;
    case "Blocked":
      return "destructive" as const;
    case "Validating":
      return "warning" as const;
    case "Running":
      return "brand" as const;
    default:
      return "outline" as const;
  }
}

export function IssueList({ issues, selectedIssueId, onSelect }: IssueListProps) {
  if (issues.length === 0) {
    return <p className="px-2.5 text-xs text-muted-foreground">No issues yet.</p>;
  }

  return (
    <div className="grid gap-0.5">
      {issues.map((issue) => (
        <button
          key={issue.id}
          type="button"
          onClick={() => onSelect(issue.id)}
          className={cn(
            "grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-background",
            issue.id === selectedIssueId && "border-border bg-background",
          )}
        >
          <span className="truncate text-[13px] font-semibold text-secondary-foreground">
            {issue.title}
          </span>
          <Badge variant={statusBadgeVariant(issue.status)} className="justify-self-end">
            {issue.status}
          </Badge>
        </button>
      ))}
    </div>
  );
}
