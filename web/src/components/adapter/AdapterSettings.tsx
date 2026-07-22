import { useState, useEffect, type FormEvent } from "react";
import { Trash2, RefreshCw, Cpu, AlertTriangle, Star } from "lucide-react";
import {
  AdapterStatus, CliProvider, AdapterAuthType, AgentCapability,
  type AdapterConfig, type AdapterConfigCreateInput, type AdapterConfigUpdateInput,
} from "@personahub/shared";
import {
  useAdapters, useCreateAdapter, useUpdateAdapter, useDeleteAdapter, useValidateAdapter,
  useAdapterProviders, useSetDefaultAdapter,
} from "@/hooks/use-adapters";
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
import { AdapterAuthFields, type AdapterAuthFieldsValue } from "@/components/adapter/AdapterAuthFields";

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

const CAPABILITY_LABEL: Record<AgentCapability, string> = {
  [AgentCapability.Implementation]: "implementation",
  [AgentCapability.Validator]: "validator",
};

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "never validated";
  try {
    return `checked ${new Date(iso).toLocaleString()}`;
  } catch {
    return "checked at unknown time";
  }
}

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

      {adapters.length > 0 && !adapters.some((a) => a.capability_tags.includes(AgentCapability.Validator)) ? (
        <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No validator configured — auto-validation requires at least one validator adapter
        </div>
      ) : null}

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
  const setDefaultAdapter = useSetDefaultAdapter(projectId);
  const isBusy = deleteAdapter.isPending || validateAdapter.isPending || setDefaultAdapter.isPending;
  const deleteErrorMessage = deleteAdapter.isError ? toApiError(deleteAdapter.error).message : null;

  const authIndicator = adapter.auth_type === AdapterAuthType.OAuth
    ? "OAuth"
    : adapter.has_api_key ? "API key configured" : "API key not set";

  return (
    <div
      className={cn(
        "grid gap-1 rounded-md border border-border bg-background px-2.5 py-1.5",
        isBusy && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2">
        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-xs font-medium"
          onClick={onEdit}
          disabled={isBusy}
        >
          {adapter.name}
        </button>
        {adapter.is_default ? (
          <Badge variant="brand" className="shrink-0 gap-1 text-[9px]">
            <Star className="h-2.5 w-2.5" /> Default
          </Badge>
        ) : null}
        {adapter.capability_tags.map((cap) => (
          <Badge key={cap} variant="secondary" className="shrink-0 text-[9px]">
            {CAPABILITY_LABEL[cap]}
          </Badge>
        ))}
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
      <div className="flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
        <span>{adapter.cli_provider}</span>
        <span>·</span>
        <span>{adapter.default_model ?? "no default model"}</span>
        <span>·</span>
        <span>{authIndicator}</span>
        <span>·</span>
        {/* design §5.2: status is a point-in-time probe result, not a live signal — always pair it with when it was last checked. */}
        <span>{formatCheckedAt(adapter.last_checked_at)}</span>
        {adapter.status === AdapterStatus.Unavailable && adapter.auth_status_message ? (
          <span className="truncate text-destructive">{adapter.auth_status_message}</span>
        ) : null}
        {!adapter.is_default && adapter.status === AdapterStatus.Available ? (
          <Button
            variant="link"
            size="sm"
            className="ml-auto h-auto p-0 text-[10px]"
            disabled={isBusy}
            onClick={() => setDefaultAdapter.mutate(adapter.id)}
          >
            Set as default
          </Button>
        ) : null}
      </div>
      {deleteErrorMessage ? (
        <p className="pl-5 text-[10px] text-destructive">{deleteErrorMessage}</p>
      ) : null}
    </div>
  );
}

interface AdapterDialogProps {
  open: boolean;
  onOpenChange: () => void;
  projectId: string;
  editingAdapter: AdapterConfig | null;
}

function initialAuthFieldsValue(editingAdapter: AdapterConfig | null): AdapterAuthFieldsValue {
  return {
    cliProvider: (editingAdapter?.cli_provider as CliProvider) ?? CliProvider.Codex,
    authType: editingAdapter?.auth_type ?? AdapterAuthType.OAuth,
    modelProvider: editingAdapter?.model_provider ?? "",
    defaultModel: editingAdapter?.default_model ?? "",
    apiKeyInput: "",
    apiKeyAction: "keep",
    capabilityTags: editingAdapter?.capability_tags ?? [AgentCapability.Implementation],
  };
}

function AdapterDialog({ open, onOpenChange, projectId, editingAdapter }: AdapterDialogProps) {
  const isEdit = editingAdapter !== null;

  const { data: providersData } = useAdapterProviders();
  const providers = providersData?.providers ?? [];

  const [name, setName] = useState(editingAdapter?.name ?? "");
  const [command, setCommand] = useState(editingAdapter?.command ?? "");
  const [argsInput, setArgsInput] = useState(editingAdapter?.args?.join(", ") ?? "");
  const [authFields, setAuthFields] = useState<AdapterAuthFieldsValue>(() => initialAuthFieldsValue(editingAdapter));

  useEffect(() => {
    if (open) {
      setName(editingAdapter?.name ?? "");
      setCommand(editingAdapter?.command ?? "");
      setArgsInput(editingAdapter?.args?.join(", ") ?? "");
      setAuthFields(initialAuthFieldsValue(editingAdapter));
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
    setAuthFields(initialAuthFieldsValue(editingAdapter));
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

    // omitted preserves the existing key server-side; "clear" sends null;
    // "replace" sends the new value — never send a stale/empty string.
    const apiKeyPatch = authFields.apiKeyAction === "clear"
      ? { api_key: null }
      : authFields.apiKeyAction === "replace"
        ? { api_key: authFields.apiKeyInput }
        : {};

    if (isEdit && editingAdapter) {
      const input: AdapterConfigUpdateInput = {
        name: name || undefined,
        command: command || undefined,
        args: args.length > 0 ? args : undefined,
        default_model: authFields.defaultModel.trim() || undefined,
        auth_type: authFields.authType,
        model_provider: authFields.modelProvider.trim() || undefined,
        capability_tags: authFields.capabilityTags,
        ...apiKeyPatch,
      };
      updateAdapter.mutate({ adapterId: editingAdapter.id, input }, { onSuccess: handleOpenChange });
    } else {
      const input: AdapterConfigCreateInput = {
        cli_provider: authFields.cliProvider,
        auth_type: authFields.authType,
        name,
        command,
        args: args.length > 0 ? args : undefined,
        default_model: authFields.defaultModel.trim() || undefined,
        model_provider: authFields.modelProvider.trim() || undefined,
        api_key: authFields.authType === AdapterAuthType.ApiKey ? authFields.apiKeyInput || undefined : undefined,
        capability_tags: authFields.capabilityTags,
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

          <AdapterAuthFields
            value={authFields}
            onChange={setAuthFields}
            providers={providers}
            providerLocked={isEdit}
            hasApiKey={editingAdapter?.has_api_key ?? false}
          />

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
