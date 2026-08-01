import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AdapterStatus, AgentCapability, type AdapterConfig } from "@personahub/shared";
import { useAdapters } from "@/hooks/use-adapters";
import { useWorkspace } from "@/hooks/use-workspace";
import { Button } from "@/components/ui/button";
import { AdapterDialog } from "@/components/adapter/AdapterDialog";
import { AdapterRow } from "@/components/adapter/AdapterRow";
import { effectiveStatusOf } from "@/components/adapter/adapter-status";

interface AdapterSettingsProps {
  projectId: string;
}

export function AdapterSettings({ projectId }: AdapterSettingsProps) {
  const { data: workspaceData } = useWorkspace(projectId);
  const workspaceId = workspaceData?.workspace?.id;
  const { data, isLoading } = useAdapters(projectId, workspaceId);
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

  const hasValidator = adapters.some((adapter) => adapter.capability_tags.includes(AgentCapability.Validator));
  const hasAvailableValidator = adapters.some(
    (adapter) =>
      adapter.capability_tags.includes(AgentCapability.Validator) &&
      effectiveStatusOf(adapter) === AdapterStatus.Available,
  );

  return (
    <section className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between px-2.5">
        <span className="text-xs text-muted-foreground">Agent Adapters</span>
        {adapters.length > 0 ? <span className="text-xs text-muted-foreground">{adapters.length}</span> : null}
      </div>

      {adapters.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-xs text-muted-foreground">
          No adapter configured
        </div>
      ) : (
        <div className="grid min-w-0 gap-1">
          {adapters.map((adapter) => (
            <AdapterRow
              key={adapter.id}
              adapter={adapter}
              projectId={projectId}
              workspaceId={workspaceId}
              onEdit={() => openEdit(adapter)}
            />
          ))}
        </div>
      )}

      {adapters.length > 0 && !hasValidator ? (
        <ValidatorWarning>
          No validator configured — auto-validation requires at least one validator adapter
        </ValidatorWarning>
      ) : adapters.length > 0 && !hasAvailableValidator ? (
        <ValidatorWarning>
          Validator configured but not currently available — auto-validation will fail until it validates as available
        </ValidatorWarning>
      ) : null}

      <Button variant="secondary" size="sm" className="w-full" onClick={openCreate}>
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

function ValidatorWarning({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-[11px] text-warning">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {children}
    </div>
  );
}
