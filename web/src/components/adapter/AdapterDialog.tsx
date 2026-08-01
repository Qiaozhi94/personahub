import { useEffect, useState, type FormEvent } from "react";
import {
  AdapterAuthType,
  AgentCapability,
  CliProvider,
  type AdapterConfig,
  type AdapterConfigCreateInput,
  type AdapterConfigUpdateInput,
} from "@personahub/shared";
import { useAdapterProviders, useCreateAdapter, useUpdateAdapter } from "@/hooks/use-adapters";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdapterAuthFields, type AdapterAuthFieldsValue } from "@/components/adapter/AdapterAuthFields";

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

export function AdapterDialog({ open, onOpenChange, projectId, editingAdapter }: AdapterDialogProps) {
  const isEdit = editingAdapter !== null;
  const { data: providersData } = useAdapterProviders();
  const providers = providersData?.providers ?? [];
  const [name, setName] = useState(editingAdapter?.name ?? "");
  const [command, setCommand] = useState(editingAdapter?.command ?? "");
  const [argsInput, setArgsInput] = useState(editingAdapter?.args?.join(", ") ?? "");
  const [authFields, setAuthFields] = useState<AdapterAuthFieldsValue>(() => initialAuthFieldsValue(editingAdapter));
  const createAdapter = useCreateAdapter(projectId);
  const updateAdapter = useUpdateAdapter(projectId);
  const mutation = isEdit ? updateAdapter : createAdapter;
  const errorMessage = mutation.isError ? toApiError(mutation.error).message : null;

  useEffect(() => {
    if (open) {
      setName(editingAdapter?.name ?? "");
      setCommand(editingAdapter?.command ?? "");
      setArgsInput(editingAdapter?.args?.join(", ") ?? "");
      setAuthFields(initialAuthFieldsValue(editingAdapter));
    }
  }, [open, editingAdapter]);

  function resetForm() {
    setName(editingAdapter?.name ?? "");
    setCommand(editingAdapter?.command ?? "");
    setArgsInput(editingAdapter?.args?.join(", ") ?? "");
    setAuthFields(initialAuthFieldsValue(editingAdapter));
  }

  function handleOpenChange() {
    resetForm();
    createAdapter.reset();
    updateAdapter.reset();
    onOpenChange();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const args = argsInput
      .split(",")
      .map((arg) => arg.trim())
      .filter(Boolean);
    const apiKeyPatch =
      authFields.apiKeyAction === "clear"
        ? { api_key: null }
        : authFields.apiKeyAction === "replace"
          ? { api_key: authFields.apiKeyInput }
          : {};

    if (isEdit && editingAdapter) {
      const input: AdapterConfigUpdateInput = {
        name: name || undefined,
        command: command || undefined,
        args,
        default_model: authFields.defaultModel.trim() || null,
        auth_type: authFields.authType,
        model_provider: authFields.modelProvider.trim() || null,
        capability_tags: authFields.capabilityTags,
        ...apiKeyPatch,
      };
      updateAdapter.mutate({ adapterId: editingAdapter.id, input }, { onSuccess: handleOpenChange });
      return;
    }

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
              onChange={(event) => setName(event.target.value)}
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
              onChange={(event) => setCommand(event.target.value)}
              placeholder="codex"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adapter-args">Arguments (comma-separated)</Label>
            <Input
              id="adapter-args"
              value={argsInput}
              onChange={(event) => setArgsInput(event.target.value)}
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
            <Button type="submit" disabled={!name.trim() || !command.trim() || mutation.isPending}>
              {mutation.isPending ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
