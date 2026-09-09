import { useState } from "react";
import { ErrorCode } from "@personahub/shared";
import { useIssues } from "@/hooks/use-issues";
import { useProjects } from "@/hooks/use-projects";
import { toApiError } from "@/lib/api-client";
import { CreateIssueDialog } from "@/components/issue/CreateIssueDialog";
import { IssueList } from "@/components/issue/IssueList";
import { PageLoading, EmptyState, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { buildUrl, useRouter } from "@/app/router";
import type { Diagnostics } from "@/app/route-manifest";
import { PageFrame, PageHeading, PageSection } from "@/pages/page-frame";

// /tasks (A004/A005): the task list. Without a `project` query it shows the
// project selection and never guesses the first project; with a valid project
// it lists that project's existing issues. Unknown projects keep their
// diagnostics in the URL and offer exactly one recovery path.

export function TasksPage({
  projectQuery,
  diagnostics,
}: {
  projectQuery: string | null;
  diagnostics: Diagnostics;
}) {
  const { navigate } = useRouter();

  if (projectQuery === null) {
    return (
      <TaskProjectSelection
        diagnostics={diagnostics}
        onSelectProject={(projectId) => navigate(buildUrl("/tasks", { project: projectId }))}
        onGoToProjects={() => navigate("/projects")}
      />
    );
  }

  return (
    <TaskProjectBoard
      projectId={projectQuery}
      diagnostics={diagnostics}
      onReselect={() => navigate("/tasks")}
    />
  );
}

function TaskNotFoundBanner({ diagnostics }: { diagnostics: Diagnostics }) {
  if (!diagnostics.notFound) return null;
  return (
    <StatusBanner tone="warning" title="任务不存在" description="链接指向的任务不存在或已删除。" />
  );
}

function TaskProjectSelection({
  diagnostics,
  onSelectProject,
  onGoToProjects,
}: {
  diagnostics: Diagnostics;
  onSelectProject: (projectId: string) => void;
  onGoToProjects: () => void;
}) {
  const projectsQuery = useProjects();

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
      <TaskNotFoundBanner diagnostics={diagnostics} />
      <PageHeading title="任务" />
      <p className="text-sm text-muted-foreground">先选择一个项目，再查看它的任务。</p>

      {projects.length === 0 ? (
        <EmptyState
          title="还没有项目"
          description="在项目页创建项目后，即可在这里查看任务。"
          action={{ label: "前往项目页", onAction: onGoToProjects }}
        />
      ) : (
        <ul className="grid max-w-xl gap-2">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => onSelectProject(project.id)}
                className="grid w-full gap-0.5 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-border-strong"
              >
                <span className="text-sm font-medium">{project.name}</span>
                <span className="text-xs text-muted-foreground">{project.description ?? "暂无描述"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  );
}

function TaskProjectBoard({
  projectId,
  diagnostics,
  onReselect,
}: {
  projectId: string;
  diagnostics: Diagnostics;
  onReselect: () => void;
}) {
  const { navigate } = useRouter();
  const projectsQuery = useProjects();
  const issuesQuery = useIssues(projectId);
  const [createOpen, setCreateOpen] = useState(false);

  const projects = projectsQuery.data?.projects ?? [];
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const unknownProject =
    (projectsQuery.isSuccess && project === null) ||
    (issuesQuery.isError && toApiError(issuesQuery.error).code === ErrorCode.PROJECT_NOT_FOUND);

  if (projectsQuery.isLoading || issuesQuery.isLoading) {
    return <PageLoading label="正在加载任务" />;
  }

  if (unknownProject) {
    return (
      <PageFrame>
        <TaskNotFoundBanner diagnostics={diagnostics} />
        <EmptyState
          title="项目不存在"
          description="链接指向的项目不存在或已删除。"
          action={{ label: "重新选择项目", onAction: onReselect }}
        />
      </PageFrame>
    );
  }

  const issues = issuesQuery.data?.issues ?? [];

  function openTask(issueId: string) {
    navigate(buildUrl(`/tasks/${encodeURIComponent(issueId)}`));
  }

  return (
    <PageFrame>
      <TaskNotFoundBanner diagnostics={diagnostics} />

      <PageHeading
        title={project !== null ? `任务 · ${project.name}` : "任务"}
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            新建任务
          </button>
        }
      />

      <PageSection title="任务列表" description="选择一个任务查看它的执行与验收事实。">
        {issuesQuery.isError ? (
          <ErrorState
            title="任务列表加载失败"
            description={toApiError(issuesQuery.error).message}
            action={{ label: "重试", onAction: () => void issuesQuery.refetch() }}
          />
        ) : issues.length === 0 ? (
          <EmptyState
            title="该项目还没有任务"
            description="直接创建任务，或稍后通过推荐流程创建。"
            action={{ label: "新建任务", onAction: () => setCreateOpen(true) }}
          />
        ) : (
          <IssueList issues={issues} selectedIssueId={null} onSelect={openTask} />
        )}
      </PageSection>

      <button
        type="button"
        onClick={onReselect}
        className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
      >
        切换项目
      </button>

      <CreateIssueDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(issueId) => navigate(buildUrl(`/tasks/${encodeURIComponent(issueId)}`))}
      />
    </PageFrame>
  );
}
