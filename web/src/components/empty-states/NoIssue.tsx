import { MessagesSquare } from "lucide-react";

export function NoIssue() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
        <MessagesSquare className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Select an issue</h2>
        <p className="max-w-xs text-xs text-muted-foreground">
          Choose a coding issue from the left, or create a new one to see its thread here.
        </p>
      </div>
    </div>
  );
}
