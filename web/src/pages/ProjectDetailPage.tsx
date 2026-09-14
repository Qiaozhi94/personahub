import { useEffect, useRef, useState } from "react";
import { ErrorCode } from "@personahub/shared";
import { useProject } from "@/hooks/use-projects";
import { toApiError } from "@/lib/api-client";
import { PageLoading, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { buildUrl, useRouter } from "@/app/router";
import type { Diagnostics, ProjectTab } from "@/app/route-manifest";
import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";
import { ProjectFilesTab } from "@/pages/project-tabs/ProjectFilesTab";
import { ProjectSkillsTab } from "@/pages/project-tabs/ProjectSkillsTab";
import { ProjectSettingsTab } from "@/pages/project-tabs/ProjectSettingsTab";

// /projects/:projectId（默认）与 /projects/:projectId/:tab（F013 注册的
// 文件 / skills / 设置三个页签；"项目记忆" tab 无真实数据，不注册）。
// projectId 严格等于既有 Project ID；未知 ID replace 到 /projects?not_found=<id>。
// 按 ID 深链不做 Space 过滤（切换 Space 后旧深链不得 404，design §4）。

const TAB_LABELS: Record<ProjectTab, string> = {
  files: "文件",
  skills: "Skills",
  settings: "设置",
};

export function ProjectDetailPage({
  projectId,
  diagnostics,
  tab,
}: {
  projectId: string;
  diagnostics: Diagnostics;
  tab?: ProjectTab;
}) {
  const { navigate } = useRouter();
  const projectQuery = useProject(projectId);
  const redirectedRef = useRef(false);
  const [activeTab, setActiveTab] = useState<ProjectTab>(tab ?? "files");

  useEffect(() => {
    if (tab) setActiveTab(tab);
  }, [tab]);

  const notFound = projectQuery.isError && toApiError(projectQuery.error).code === ErrorCode.PROJECT_NOT_FOUND;

  useEffect(() => {
    if (!notFound || redirectedRef.current) return;
    redirectedRef.current = true;
    navigate(
      buildUrl("/projects", {
        not_found: projectId,
        from: window.location.pathname + window.location.search,
      }),
      { replace: true },
    );
  }, [notFound, projectId, navigate]);

  if (projectQuery.isLoading) {
    return <PageLoading label="正在加载项目" />;
  }

  if (notFound) {
    // Rendered only until the replace lands; never guesses another object.
    return <PageLoading label="正在解析项目" />;
  }

  if (projectQuery.isError) {
    return (
      <PageFrame>
        <ErrorState
          title="项目加载失败"
          description={toApiError(projectQuery.error).message}
          action={{ label: "重试", onAction: () => void projectQuery.refetch() }}
        />
      </PageFrame>
    );
  }

  const project = projectQuery.data!.project;

  const switchTab = (next: ProjectTab): void => {
    setActiveTab(next);
    navigate(buildUrl(`/projects/${encodeURIComponent(projectId)}/${next}`));
  };

  return (
    <PageFrame>
      {diagnostics.routeIssue === "unsupported-tab" ? (
        <StatusBanner tone="info" title="该链接指向的项目页签尚未开放" description="已回到项目页。" />
      ) : null}
      {project.state === "archived" ? (
        <StatusBanner
          tone="info"
          title="该项目已归档"
          description="归档项目的写入被拒绝；历史任务的文件、执行与证据仍可读。"
        />
      ) : null}

      <PageHeading title={project.name} />

      {project.description ? <p className="max-w-2xl text-sm text-muted-foreground">{project.description}</p> : null}

      <nav aria-label="项目页签" className="flex gap-2 border-b border-border pb-2">
        {(Object.keys(TAB_LABELS) as ProjectTab[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-current={activeTab === candidate}
            onClick={() => switchTab(candidate)}
            className={activeTab === candidate ? "font-semibold" : "text-muted-foreground"}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </nav>

      {activeTab === "files" ? (
        <PageSection title="文件" description="主代码目录与只读参考仓库；真实路径授权以机器为单位管理。">
          <ProjectFilesTab projectId={projectId} legacyWorkspacePath={project.default_workspace?.local_path ?? null} />
        </PageSection>
      ) : null}

      {activeTab === "skills" ? <ProjectSkillsTab projectId={projectId} /> : null}

      {activeTab === "settings" ? <ProjectSettingsTab projectId={projectId} project={project} /> : null}
    </PageFrame>
  );
}
