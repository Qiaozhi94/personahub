import { useState } from "react";
import type { WorkflowTemplateVersionSummary } from "@personahub/shared";
import { apiClient } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { PageLoading, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { DataTable, type DataTableColumn } from "@/components/primitives/data-table";
import { PageFrame, PageHeading } from "@/pages/page-frame";

// /settings/legacy-workflows (A029 read-only, A030 retired): the workflow
// template list and details remain viewable as migration evidence. Editing
// was retired — new versions, activation and deactivation move to Skills
// revisions (F013); this page calls only the read APIs.

const columns: Array<DataTableColumn<WorkflowTemplateVersionSummary>> = [
  { key: "name", header: "名称" },
  { key: "issue_type", header: "任务类型" },
  { key: "version", header: "版本" },
  { key: "status", header: "状态" },
  { key: "validation_enabled", header: "验证", emptyText: "未声明" },
  { key: "updated_at", header: "更新时间" },
];

export function LegacyWorkflowsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listQuery = useQuery({ queryKey: ["workflow-templates"], queryFn: () => apiClient.workflowTemplates.list() });
  const detailQuery = useQuery({
    queryKey: ["workflow-templates", selectedId],
    queryFn: () => apiClient.workflowTemplates.get(selectedId!),
    enabled: selectedId !== null,
  });

  if (listQuery.isLoading) return <PageLoading label="正在加载历史工作流" />;

  if (listQuery.isError) {
    return (
      <PageFrame>
        <ErrorState
          title="历史工作流加载失败"
          description="请稍后重试。"
          action={{ label: "重试", onAction: () => void listQuery.refetch() }}
        />
      </PageFrame>
    );
  }

  const templates = listQuery.data?.templates ?? [];

  return (
    <PageFrame>
      <StatusBanner
        tone="info"
        title="历史工作流只读"
        description="编辑能力已退役，后续由 Skills 版本接管；此处保留既有模板作为迁移证据。"
      />
      <PageHeading title="历史工作流" />

      <DataTable
        ariaLabel="历史工作流模板"
        columns={columns}
        rows={templates}
        getRowId={(row) => row.id}
        getValue={(row, key) => {
          const value = (row as unknown as Record<string, unknown>)[key];
          if (key === "validation_enabled") {
            if (value === true) return "启用";
            if (value === false) return "停用";
            return null;
          }
          return typeof value === "string" || typeof value === "number" ? String(value) : null;
        }}
        className={
          selectedId === null
            ? undefined
            : "[&_tbody_tr]:cursor-pointer [&_tbody_tr]:hover:bg-secondary/60"
        }
      />

      {/* Row selection uses an explicit list under the table to keep the
          shared table primitive free of interactive-row semantics. */}
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">选择一个模板查看详情：</span>
        <ul className="flex flex-wrap gap-1.5">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                aria-pressed={selectedId === template.id}
                onClick={() => setSelectedId(template.id === selectedId ? null : template.id)}
                className={
                  selectedId === template.id
                    ? "rounded-full border border-primary bg-accent-soft px-3 py-1 text-xs text-primary"
                    : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
                }
              >
                {template.name} v{template.version}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selectedId !== null ? (
        <TemplateDetail
          detailQuery={{
            isLoading: detailQuery.isLoading,
            error: detailQuery.error,
            detail: detailQuery.data?.template ?? null,
          }}
        />
      ) : null}
    </PageFrame>
  );
}

function TemplateDetail({
  detailQuery,
}: {
  detailQuery: { isLoading: boolean; error: unknown; detail: import("@personahub/shared").WorkflowTemplateDetail | null };
}) {
  if (detailQuery.isLoading) return <PageLoading label="正在加载模板详情" />;
  if (detailQuery.error || detailQuery.detail === null) {
    return (
      <ErrorState
        title="模板详情加载失败"
        description="请重新选择模板。"
        action={{ label: "重试", onAction: () => undefined }}
      />
    );
  }

  const template = detailQuery.detail;
  return (
    <section className="grid gap-2 rounded-lg border border-border bg-card p-4" aria-label="模板详情">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {template.name} v{template.version}
        </h2>
        <span className="text-xs text-muted-foreground">{template.status === "active" ? "active" : "inactive"}</span>
      </div>
      <dl className="grid gap-1 text-xs">
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">任务类型</dt>
          <dd>{template.issue_type}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">协作拓扑</dt>
          <dd>{template.collaboration_topology || "未声明"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">验证策略</dt>
          <dd>{template.validation_policy_id ?? "未声明"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 shrink-0 text-muted-foreground">步骤</dt>
          <dd>
            {template.steps.length > 0
              ? template.steps.map((step) => `${step.id} (${step.role})`).join(" → ")
              : "未声明"}
          </dd>
        </div>
        {template.parse_error ? (
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">解析状态</dt>
            <dd className="text-warning">{template.parse_error}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
