import { useState, useEffect, type FormEvent } from "react";
import { Trash2, RefreshCw, Cpu } from "lucide-react";
import { AdapterStatus, type AdapterConfig, type AdapterConfigCreateInput } from "@personahub/shared";
import { useAdapters, useCreateAdapter, useUpdateAdapter, useDeleteAdapter, useValidateAdapter } from "@/hooks/use-adapters";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AdapterSettingsProps {
  projectId: string;
}

const STATUS_VARIANT: Record<AdapterStatus, "success" | "destructive" | "secondary"> = {
  [AdapterStatus.Available]: "success",
  [AdapterStatus.Unavailable]: "destructive",
  [AdapterStatus.Unknown]: "secondary",
};

const STATUS_LABEL: Record<AdapterStatus, string> = {
  [AdapterStatus.Available]: "available",
  [AdapterStatus.Unavailable]: "unavailable",
  [AdapterStatus.Unknown]: "unknown",
};

export function AdapterSettings({ projectId }: AdapterSettingsProps) {
  const { data, isLoading } = useAdapters(projectId);
  const adapters = data?.adapters ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdapter, setEditingAdapter] = useState<AdapterConfig | null>(null);

  function openCreate() {
    setEditingAdapter(null);
    setDialogOpen(true);
  }

  function openEdit(adapter: AdapterConfig) {
    setEditingAdapter(adapter);
    setDialogOpen(true);
  }

  function handleDialogClose() {
    setDialogOpen(false);
    setEditingAdapter(null);
  }

  if (isLoading) {
    return (
      <section className="grid gap-1.5">
        <div className="flex items-center justify-between px-2.5">
          <span className="text-xs text-muted-foreground">Agent Adapters</span>
        </div>
        <div className="px-2.5 text-xs text-muted-foreground">Loading…</div>
      </section>
    );
  }

  return (
    <section className="grid gap-1.5">
      <div className="flex items-center justify-between px-2.5">
        <span className="text-xs text-muted-foreground">Agent Adapters</span>
        {adapters.length > 0 ? (
          <span className="text-xs text-muted-foreground">{adapters.length}</span>
        ) : null}
      </div>

      {adapters.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-xs text-muted-foreground">
          No adapter configured
        </div>
      ) : (
        <div className="grid gap-1">
          {adapters.map((adapter) => (
            <AdapterRow
              key={adapter.id}
              adapter={adapter}
              projectId={projectId}
              onEdit={() => openEdit(adapter)}
            />
          ))}
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={openCreate}
      >
        Configure adapter
      </Button>

      <AdapterDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        projectId={projectId}
        editingAdapter={editingAdapter}
      />
    </section>
  );
}

interface AdapterRowProps {
  adapter: AdapterConfig;
  projectId: string;
  onEdit: () => void;
}

function AdapterRow({ adapter, projectId, onEdit }: AdapterRowProps) {
  const deleteAdapter = useDeleteAdapter(projectId);
  const validateAdapter = useValidateAdapter(projectId);
  const isBusy = deleteAdapter.isPending || validateAdapter.isPending;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5",
        isBusy && "opacity-50",
      )}
    >
      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-xs font-medium"
        onClick={onEdit}
        disabled={isBusy}
      >
        {adapter.name}
      </button>
      <Badge variant={STATUS_VARIANT[adapter.status]} className="shrink-0 text-[10px]">
        {STATUS_LABEL[adapter.status]}
      </Badge>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title="Revalidate"
        disabled={isBusy}
        onClick={() => validateAdapter.mutate(adapter.id)}
      >
        <RefreshCw className={cn("h-3 w-3", validateAdapter.isPending && "animate-spin")} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
        title="Delete"
        disabled={isBusy}
        onClick={() => {
          if (window.confirm(`Delete adapter "${adapter.name}"?`)) {
            deleteAdapter.mutate(adapter.id);
          }
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

interface AdapterDialogProps {
  open: boolean;
  onOpenChange: () => void;
  projectId: string;
  editingAdapter: AdapterConfig | null;
}

function AdapterDialog({ open, onOpenChange, projectId, editingAdapter }: AdapterDialogProps) {
  const isEdit = editingAdapter !== null;

  const [name, setName] = useState(editingAdapter?.name ?? "");
  const [command, setCommand] = useState(editingAdapter?.command ?? "");
  const [argsInput, setArgsInput] = useState(editingAdapter?.args?.join(", ") ?? "");
  const [defaultModel, setDefaultModel] = useState(editingAdapter?.default_model ?? "");

  useEffect(() => {
    if (open) {
      setName(editingAdapter?.name ?? "");
      setCommand(editingAdapter?.command ?? "");
      setArgsInput(editingAdapter?.args?.join(", ") ?? "");
      setDefaultModel(editingAdapter?.default_model ?? "");
    }
  }, [open, editingAdapter]);

  const createAdapter = useCreateAdapter(projectId);
  const updateAdapter = useUpdateAdapter(projectId);

  const mutation = isEdit ? updateAdapter : createAdapter;
  const errorMessage = mutation.isError ? toApiError(mutation.error).message : null;

  function reset() {
    setName(editingAdapter?.name ?? "");
    setCommand(editingAdapter?.command ?? "");
    setArgsInput(editingAdapter?.args?.join(", ") ?? "");
    setDefaultModel(editingAdapter?.default_model ?? "");
    createAdapter.reset();
    updateAdapter.reset();
  }

  function handleOpenChange() {
    reset();
    onOpenChange();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const args = argsInput
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (isEdit && editingAdapter) {
      updateAdapter.mutate(
        {
          adapterId: editingAdapter.id,
          input: {
            name: name || undefined,
            command: command || undefined,
            args: args.length > 0 ? args : undefined,
            default_model: defaultModel.trim() || undefined,
          },
        },
        { onSuccess: handleOpenChange },
      );
    } else {
      const input: AdapterConfigCreateInput = {
        cli_provider: "codex",
        name,
        command,
        args: args.length > 0 ? args : undefined,
        default_model: defaultModel.trim() || undefined,
      };
      createAdapter.mutate(input, { onSuccess: handleOpenChange });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit adapter" : "Configure adapter"}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="adapter-name">Name</Label>
            <Input
              id="adapter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Codex CLI"
              autoFocus
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adapter-command">Command</Label>
            <Input
              id="adapter-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="codex"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adapter-args">Arguments (comma-separated)</Label>
            <Input
              id="adapter-args"
              value={argsInput}
              onChange={(e) => setArgsInput(e.target.value)}
              placeholder="exec, --model, gpt-5"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adapter-model">Default model (optional)</Label>
            <Input
              id="adapter-model"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="gpt-5"
            />
          </div>
          {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleOpenChange}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !command.trim() || mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
