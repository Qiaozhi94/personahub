import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading, ErrorState } from "@/components/primitives/page-state";
import { useRuntimeHealth } from "@/hooks/use-runtime-health";
import { useWorkspace } from "@/hooks/use-workspace";
import { diagnosticKey, renderDiagnosticCode, type DiagnosticRender } from "./diagnostic-code";
import type { HealthDiagnostic, RuntimeHealthSnapshot } from "@personahub/shared";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Clock, Cpu, ListOrdered, Lock } from "lucide-react";

// Runtime projection (A028 runtime half): adapter availability, workspace
// locks, run queues and background probes. Schema / app-infrastructure facts
// are deliberately NOT rendered here — they live only in
// /settings/system-diagnostics (design.md §2 data/action placement).

const RUNTIME_ICONS: Partial<Record<DiagnosticRender["icon"], LucideIcon>> = {
  lock: Lock,
  clock: Clock,
  alert: AlertTriangle,
  queue: ListOrdered,
  adapter: Cpu,
};

const TONE_CLASSES: Record<DiagnosticRender["variant"], string> = {
  destructive: "border-destructive/40 bg-destructive/5",
  warning: "border-warning/40 bg-warning/5",
  info: "border-border bg-background",
};

export function isSchemaDiagnostic(diagnostic: HealthDiagnostic): boolean {
  return diagnostic.code === "schema_version_mismatch";
}

export function RuntimeHealthPanel({ projectId }: { projectId: string }) {
  const { data: workspaceData } = useWorkspace(projectId);
  const workspaceId = workspaceData?.workspace?.id;
  const healthQuery = useRuntimeHealth(projectId, workspaceId);
  const health = healthQuery.data?.health;

  if (healthQuery.isLoading) return <PageLoading label="正在读取运行时" />;

  if (healthQuery.isError) {
    return (
      <ErrorState
        title="运行时读取失败"
        description={(healthQuery.error as { message?: string })?.message ?? "未知错误"}
        action={{ label: "重试", onAction: () => void healthQuery.refetch() }}
      />
    );
  }

  if (!health) return null;

  const runtimeDiagnostics = health.diagnostics.filter((d) => !isSchemaDiagnostic(d));

  return (
    <div className="grid gap-3" data-testid="runtime-health-panel">
      <SummaryRow health={health} onRefresh={() => void healthQuery.refetch()} />

      {runtimeDiagnostics.length === 0 ? (
        <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs text-success">
          没有运行时诊断。
        </div>
      ) : (
        <div className="grid gap-1.5">
          {runtimeDiagnostics.map((d) => (
            <DiagnosticRow key={diagnosticKey(d)} diagnostic={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ health, onRefresh }: { health: RuntimeHealthSnapshot; onRefresh: () => void }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">probe: {health.background.pending_probe_count}</Badge>
          <Badge variant="secondary">reprobe: {health.background.pending_reprobe_count}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <div className="grid max-h-48 gap-2 overflow-y-auto">
        {health.workspaces.map((ws) => (
          <div key={ws.workspace_id} className="grid gap-1.5 rounded-md border border-border p-2.5 text-xs">
            <span className="font-medium">{ws.workspace_id}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {ws.adapters.map((a) => (
                <Badge
                  key={a.id}
                  variant={
                    a.effective_status === "available"
                      ? "success"
                      : a.effective_status === "unknown"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {a.name}: {a.effective_status}
                </Badge>
              ))}
              {ws.adapters.length === 0 ? <span className="text-muted-foreground">no adapters</span> : null}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-muted-foreground">
              <span>
                lock:{" "}
                {ws.lock.locked_by_run_id
                  ? `${ws.lock.locked_by_run_id}${ws.lock.held_ms !== null ? ` (${Math.round(ws.lock.held_ms / 1000)}s)` : ""}`
                  : "free"}
              </span>
              <span>queued: {ws.queue.queued_count}</span>
              <span>running: {ws.queue.running_run_id ?? "none"}</span>
            </div>
          </div>
        ))}
        {health.workspaces.length === 0 ? (
          <span className="text-xs text-muted-foreground">No workspaces in this project.</span>
        ) : null}
      </div>
    </div>
  );
}

function DiagnosticRow({ diagnostic }: { diagnostic: HealthDiagnostic }) {
  const render = renderDiagnosticCode(diagnostic.code);
  const Icon = RUNTIME_ICONS[render.icon] ?? AlertTriangle;
  return (
    <div className={`grid gap-1 rounded-md border px-3 py-2 text-xs ${TONE_CLASSES[render.variant]}`}>
      <div className="flex items-center gap-1.5 font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {render.title}
        {diagnostic.workspace_id ? (
          <Badge variant="outline" className="ml-auto">
            {diagnostic.workspace_id}
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground">{diagnostic.detail}</p>
      <p>
        <span className="font-medium">Suggested action: </span>
        {diagnostic.suggested_action || render.suggestedAction}
      </p>
    </div>
  );
}
