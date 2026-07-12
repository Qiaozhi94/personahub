import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NoProjectProps {
  onCreateProject: () => void;
}

export function NoProject({ onCreateProject }: NoProjectProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
        <FolderPlus className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">No projects yet</h2>
        <p className="max-w-xs text-xs text-muted-foreground">
          Create a project to bind a workspace and start tracking coding issues.
        </p>
      </div>
      <Button onClick={onCreateProject}>Create project</Button>
    </div>
  );
}
