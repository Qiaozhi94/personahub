import { useEffect, useRef } from "react";
import { ErrorCode } from "@personahub/shared";
import { useIssue } from "@/hooks/use-issues";
import { toApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { PageLoading, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { buildUrl, useRouter } from "@/app/router";
import type { Diagnostics } from "@/app/route-manifest";
import { PageFrame, PageSection } from "@/pages/page-frame";

// /tasks/:taskId (FR-004): taskId strictly equals the existing Issue ID. An
// unknown ID replaces to /tasks?not_found=<id>&from=<attempted> — it never
// falls through to another object. The execution and fact sections are the
// transitional hosts owned by the migration matrix (A006–A024).

export function TaskDetailPage({
  taskId,
  diagnostics,
}: {
  taskId: string;
  diagnostics: Diagnostics;
}) {
  const { navigate } = useRouter();
  const issueQuery = useIssue(taskId);
  const redirectedRef = useRef(false);

  const notFound =
    issueQuery.isError && toApiError(issueQuery.error).code === ErrorCode.ISSUE_NOT_FOUND;

  useEffect(() => {
    if (!notFound || redirectedRef.current) return;
    redirectedRef.current = true;
    navigate(
      buildUrl("/tasks", {
        not_found: taskId,
        from: window.location.pathname + window.location.search,
      }),
      { replace: true },
    );
  }, [notFound, taskId, navigate]);

  if (issueQuery.isLoading) {
    return <PageLoading label="正在加载任务" />;
  }

  if (notFound) {
    // Rendered only until the replace lands; never guesses another object.
    return <PageLoading label="正在解析任务" />;
  }

  if (issueQuery.isError) {
    return (
      <PageFrame>
        <ErrorState
          title="任务加载失败"
          description={toApiError(issueQuery.error).message}
          action={{ label: "重试", onAction: () => void issueQuery.refetch() }}
        />
      </PageFrame>
    );
  }

  const issue = issueQuery.data!.issue;

  return (
    <PageFrame>
      {diagnostics.routeIssue === "unsupported-view" ? (
        <StatusBanner tone="info" title="该链接指向的任务视图尚未开放" description="已回到任务页。" />
      ) : null}

      <div className="grid gap-1">
        <h1 className="text-base font-semibold">{issue.title}</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">
            {issue.status}
          </Badge>
          {issue.primary_thread ? null : (
            <span className="text-xs text-muted-foreground">没有关联的执行会话</span>
          )}
        </div>
      </div>

      {issue.goal ? <p className="max-w-2xl text-sm text-muted-foreground">{issue.goal}</p> : null}

      <PageSection
        title="执行与会话（兼容）"
        description="查看执行事件、发送指令、启动或恢复执行。"
      >
        <ExecutionHostPlaceholder taskId={taskId} />
      </PageSection>

      <PageSection
        title="任务详情（兼容）"
        description="查看轨迹、证据与验收事实。"
      >
        <FactsHostPlaceholder taskId={taskId} />
      </PageSection>
    </PageFrame>
  );
}

// The transitional hosts mount in migration steps T011/T012; until then these
// render nothing user-visible so no fake facts or dead controls appear.
function ExecutionHostPlaceholder(_props: { taskId: string }): null {
  return null;
}

function FactsHostPlaceholder(_props: { taskId: string }): null {
  return null;
}
