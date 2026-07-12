import { FolderGit2 } from "lucide-react";

export function NoWorkspace() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
        <FolderGit2 className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">No workspace bound</h2>
        <p className="max-w-xs text-xs text-muted-foreground">
          Bind a local workspace path in the left panel before creating a coding issue.
        </p>
      </div>
    </div>
  );
}
