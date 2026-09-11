import { useRef, useState } from "react";
import type { Project } from "@personahub/shared";
import { useProjects } from "@/hooks/use-projects";
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
import { PageLoading, EmptyState, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { buildUrl, useRouter } from "@/app/router";
import type { Diagnostics } from "@/app/route-manifest";
import { PageFrame } from "@/pages/page-frame";

// /projects (A001/A002): list existing projects and create new ones.
// Selection is always a user action — the page never guesses an object.

export function ProjectsPage({ diagnostics }: { diagnostics: Diagnostics }) {
  const { navigate } = useRouter();
  const projectsQuery = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);

  function openProject(project: Project) {
    navigate(buildUrl(`/projects/${encodeURIComponent(project.id)}`));
  }

  if (projectsQuery.isLoading) {
    return <PageLoading label="正在加载项目" />;
  }

  if (projectsQuery.isError) {
    return (
      <PageFrame>
        <ErrorState
          title="项目列表加载失败"
          description="请稍后重试。"
          action={{ label: "重试", onAction: () => void projectsQuery.refetch() }}
        />
      </PageFrame>
    );
  }

  const projects = projectsQuery.data?.projects ?? [];

  return (
    <PageFrame>
      {diagnostics.notFound ? (
        <StatusBanner tone="warning" title="项目不存在" description="链接指向的项目不存在或已删除。" />
      ) : null}

      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">项目</h1>
        {/* Exactly one executable recovery action when the list is empty —
            it lives in the EmptyState below, not here too (BC-046 / R1-007,
            same pattern as TasksPage's heading action). */}
        {projects.length > 0 ? (
          <button
            ref={createTriggerRef}
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            新建项目
          </button>
        ) : null}
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="还没有项目"
          description="创建第一个项目，绑定代码目录后即可开始派工。"
          action={{ label: "新建项目", onAction: () => setCreateOpen(true) }}
          actionRef={createTriggerRef}
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => openProject(project)}
                className="grid w-full gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-border-strong"
              >
                <span className="text-sm font-medium">{project.name}</span>
                <span className="text-xs text-muted-foreground">{project.description ?? "暂无描述"}</span>
                <span className="text-xs text-faint">
                  {project.default_workspace_id ? "已绑定代码目录" : "未绑定代码目录"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(projectId) => navigate(buildUrl(`/projects/${encodeURIComponent(projectId)}`))}
        restoreFocusRef={createTriggerRef}
      />
    </PageFrame>
  );
}
