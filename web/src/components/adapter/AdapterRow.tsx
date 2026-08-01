import { Trash2, RefreshCw, Cpu, Star } from "lucide-react";
import { AdapterStatus, AdapterAuthType, AgentCapability, type AdapterConfig } from "@personahub/shared";
import { useDeleteAdapter, useSetDefaultAdapter, useValidateAdapter } from "@/hooks/use-adapters";
import { toApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_VARIANT, effectiveStatusOf, formatCheckedAt } from "@/components/adapter/adapter-status";

interface AdapterRowProps {
  adapter: AdapterConfig;
  projectId: string;
  workspaceId?: string;
  onEdit: () => void;
}

const CAPABILITY_LABEL: Record<AgentCapability, string> = {
  [AgentCapability.Implementation]: "implementation",
  [AgentCapability.Validator]: "validator",
};

export function AdapterRow({ adapter, projectId, workspaceId, onEdit }: AdapterRowProps) {
  const deleteAdapter = useDeleteAdapter(projectId);
  const validateAdapter = useValidateAdapter(projectId);
  const setDefaultAdapter = useSetDefaultAdapter(projectId);
  const isBusy = deleteAdapter.isPending || validateAdapter.isPending || setDefaultAdapter.isPending;
  const deleteErrorMessage = deleteAdapter.isError ? toApiError(deleteAdapter.error).message : null;
  const authIndicator =
    adapter.auth_type === AdapterAuthType.OAuth
      ? "OAuth"
      : adapter.has_api_key
        ? "API key configured"
        : "API key not set";
  const displayStatus = effectiveStatusOf(adapter);
  const displayLastCheckedAt = adapter.effective_last_checked_at ?? adapter.last_checked_at;
  const displayAuthMessage = adapter.effective_auth_status_message ?? adapter.auth_status_message;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md border border-border bg-background px-2.5 py-1.5",
        isBusy && "opacity-50",
      )}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className="min-w-0 max-w-full truncate text-left text-xs font-medium"
            onClick={onEdit}
            disabled={isBusy}
          >
            {adapter.name}
          </button>
          {adapter.is_default ? (
            <Badge variant="brand" className="shrink-0 gap-1 text-[11px]">
              <Star className="h-2.5 w-2.5" /> Default
            </Badge>
          ) : null}
          {adapter.capability_tags.map((capability) => (
            <Badge key={capability} variant="secondary" className="shrink-0 text-[11px]">
              {CAPABILITY_LABEL[capability]}
            </Badge>
          ))}
          <Badge
            variant={STATUS_VARIANT[displayStatus]}
            className="shrink-0 text-[11px]"
            title={
              adapter.has_workspace_override
                ? `This workspace: ${STATUS_LABEL[displayStatus]} (Project baseline: ${STATUS_LABEL[adapter.status]})`
                : undefined
            }
          >
            {STATUS_LABEL[displayStatus]}
          </Badge>
          {adapter.has_workspace_override ? (
            <Badge
              variant="secondary"
              className="shrink-0 text-[11px]"
              title="This workspace's validated status differs from the Project-global baseline"
            >
              workspace override
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title="Revalidate"
            disabled={isBusy}
            onClick={() => validateAdapter.mutate({ adapterId: adapter.id, workspaceId })}
          >
            <RefreshCw className={cn("h-3 w-3", validateAdapter.isPending && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
            title="Delete"
            disabled={isBusy}
            onClick={() => window.confirm(`Delete adapter "${adapter.name}"?`) && deleteAdapter.mutate(adapter.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5 text-[11px] text-muted-foreground">
        <span>{adapter.cli_provider}</span>
        <span>·</span>
        <span>{adapter.default_model ?? "no default model"}</span>
        <span>·</span>
        <span>{authIndicator}</span>
        <span>·</span>
        <span>{formatCheckedAt(displayLastCheckedAt)}</span>
        {displayStatus === AdapterStatus.Unavailable && displayAuthMessage ? (
          <span className="min-w-0 basis-full break-words text-destructive [overflow-wrap:anywhere]">
            {displayAuthMessage}
          </span>
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
      {deleteErrorMessage ? <p className="pl-5 text-[10px] text-destructive">{deleteErrorMessage}</p> : null}
    </div>
  );
}
