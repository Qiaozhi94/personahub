import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProjectPicker } from "@/pages/project-picker";
import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";
import { PageLoading } from "@/components/primitives/page-state";
import { useRuntimeHealth } from "@/hooks/use-runtime-health";
import { useWorkspace } from "@/hooks/use-workspace";
import { diagnosticKey } from "@/components/runtime-health/diagnostic-code";

// /settings/system-diagnostics (A028 settings half): schema and application
// infrastructure facts only. Adapter availability, locks, queues and
// background probes live in /runtime — the same health response is projected
// per surface and never rendered twice with actions.

export function SystemDiagnosticsPage() {
  const [projectId, setProjectId] = useState<string | null>(null);

  return (
    <PageFrame>
      <PageHeading title="系统诊断" />
      <ProjectPicker selectedId={projectId} onSelect={setProjectId} label="按项目查看诊断" />
      {projectId !== null ? <SchemaDiagnostics projectId={projectId} /> : null}
    </PageFrame>
  );
}

function SchemaDiagnostics({ projectId }: { projectId: string }) {
  const { data: workspaceData } = useWorkspace(projectId);
  const workspaceId = workspaceData?.workspace?.id;
  const healthQuery = useRuntimeHealth(projectId, workspaceId);
  const health = healthQuery.data?.health;

  if (healthQuery.isLoading) return <PageLoading label="正在读取诊断" />;

  if (healthQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        诊断读取失败：{(healthQuery.error as { message?: string })?.message ?? "未知错误"}
      </div>
    );
  }

  if (!health) return null;

  const schemaDiagnostics = health.diagnostics.filter((d) => d.code === "schema_version_mismatch");
  const schemaStatus =
    health.schema.status === "current" ? "success" : health.schema.status === "behind" ? "warning" : "destructive";

  return (
    <PageSection title="数据库架构" description="数据库 schema 与应用基础设施只读诊断。">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant={schemaStatus}>
          schema {health.schema.actual_version}/{health.schema.expected_version} ({health.schema.status})
        </Badge>
        <Button variant="outline" size="sm" onClick={() => void healthQuery.refetch()}>
          Refresh
        </Button>
      </div>

      {schemaDiagnostics.length === 0 ? (
        <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs text-success">
          架构版本正常，没有诊断。
        </div>
      ) : (
        <div className="grid gap-1.5">
          {schemaDiagnostics.map((d) => (
            <div
              key={diagnosticKey(d)}
              className="grid gap-1 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs"
            >
              <span className="font-medium">{d.code}</span>
              <p className="text-muted-foreground">{d.detail}</p>
              <p>
                <span className="font-medium">Suggested action: </span>
                {d.suggested_action}
              </p>
            </div>
          ))}
        </div>
      )}
    </PageSection>
  );
}
