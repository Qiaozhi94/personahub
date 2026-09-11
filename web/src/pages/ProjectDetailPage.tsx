import { useEffect, useRef } from "react";
import { ErrorCode } from "@personahub/shared";
import { useProject } from "@/hooks/use-projects";
import { useWorkspace } from "@/hooks/use-workspace";
import { toApiError } from "@/lib/api-client";
import { PageLoading, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { WorkspaceBinding } from "@/components/workspace/WorkspaceBinding";
import { buildUrl, useRouter } from "@/app/router";
import type { Diagnostics } from "@/app/route-manifest";
import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";

// /projects/:projectId (A003): compatible project page. projectId strictly
// equals the existing Project ID; an unknown ID replaces to
// /projects?not_found=<id>&from=<attempted>. Code-directory binding keeps its
// canonical API and lives only here while F013 owns the final repository
// registry.

export function ProjectDetailPage({ projectId, diagnostics }: { projectId: string; diagnostics: Diagnostics }) {
  const { navigate } = useRouter();
  const projectQuery = useProject(projectId);
  const workspaceQuery = useWorkspace(projectId);
  const redirectedRef = useRef(false);

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

  return (
    <PageFrame>
      {diagnostics.routeIssue === "unsupported-tab" ? (
        <StatusBanner tone="info" title="该链接指向的项目页签尚未开放" description="已回到项目页。" />
      ) : null}

      <PageHeading title={project.name} />

      {project.description ? <p className="max-w-2xl text-sm text-muted-foreground">{project.description}</p> : null}

      <PageSection title="代码目录（兼容）" description="查看和绑定本地代码目录；后续版本将在此提供完整的仓库管理。">
        {workspaceQuery.isLoading ? (
          <PageLoading label="正在加载代码目录" />
        ) : workspaceQuery.isError ? (
          <ErrorState
            title="代码目录加载失败"
            description={toApiError(workspaceQuery.error).message}
            action={{ label: "重试", onAction: () => void workspaceQuery.refetch() }}
          />
        ) : (
          <WorkspaceBinding projectId={projectId} workspace={workspaceQuery.data?.workspace ?? null} />
        )}
      </PageSection>
    </PageFrame>
  );
}
