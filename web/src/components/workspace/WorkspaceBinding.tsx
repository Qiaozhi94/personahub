import { useState, type FormEvent } from "react";
import type { Workspace } from "@personahub/shared";
import { useBindWorkspace } from "@/hooks/use-workspace";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WorkspaceBindingProps {
  projectId: string;
  workspace: Workspace | null | undefined;
}

export function WorkspaceBinding({ projectId, workspace }: WorkspaceBindingProps) {
  const [localPath, setLocalPath] = useState("");
  const bindWorkspace = useBindWorkspace(projectId);

  const errorMessage = bindWorkspace.isError ? toApiError(bindWorkspace.error).message : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!localPath.trim()) return;
    bindWorkspace.mutate(localPath, {
      onSuccess: () => setLocalPath(""),
    });
  }

  return (
    <section className="grid gap-1.5">
      <div className="flex items-center justify-between px-2.5">
        <span className="text-xs text-muted-foreground">Workspace</span>
      </div>
      {workspace ? (
        <div className="break-words rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-muted-foreground">
          {workspace.local_path}
          {workspace.git_branch ? ` (${workspace.git_branch})` : ""}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-xs text-muted-foreground">
          Not bound
        </div>
      )}
      <form className="grid gap-1.5" onSubmit={handleSubmit}>
        <Input
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          placeholder="D:\path\to\workspace"
          className="h-8 text-xs"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!localPath.trim() || bindWorkspace.isPending}
          className="w-full"
        >
          {bindWorkspace.isPending ? "Binding…" : "Bind workspace"}
        </Button>
        {errorMessage ? <p className="px-0.5 text-xs text-destructive">{errorMessage}</p> : null}
      </form>
    </section>
  );
}
