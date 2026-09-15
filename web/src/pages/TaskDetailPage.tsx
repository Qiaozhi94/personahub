import { useEffect, useRef } from "react";
import { ErrorCode } from "@personahub/shared";
import { useIssue, useEnsureIssueSession } from "@/hooks/use-issues";
import { useWorkspace } from "@/hooks/use-workspace";
import { toApiError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageLoading, ErrorState } from "@/components/primitives/page-state";
import { StatusBanner } from "@/components/primitives/feedback";
import { IssueInspector } from "@/components/inspector/IssueInspector";
import { ThreadView } from "@/components/thread/ThreadView";
import { useDraftStore } from "@/app/draft-store-context";
import { taskComposerKey } from "@/app/task-draft-store";
import { buildUrl, useRouter } from "@/app/router";
import type { Diagnostics } from "@/app/route-manifest";
import { PageFrame, PageSection } from "@/pages/page-frame";

// /tasks/:taskId (FR-004): taskId strictly equals the existing Issue ID. An
// unknown ID replaces to /tasks?not_found=<id>&from=<attempted> — it never
// falls through to another object. Execution now lives on the session
// surface (/sessions/:sessionId); this page keeps the F011-owned compat
// detail area (migration matrix P008, M4).

export function TaskDetailPage({ taskId, diagnostics }: { taskId: string; diagnostics: Diagnostics }) {
  const { navigate } = useRouter();
  const issueQuery = useIssue(taskId);
  const workspaceQuery = useWorkspace(issueQuery.data?.issue.project_id ?? null);
  const ensureSession = useEnsureIssueSession();
  const draftStore = useDraftStore();
  const redirectedRef = useRef(false);

  const notFound = issueQuery.isError && toApiError(issueQuery.error).code === ErrorCode.ISSUE_NOT_FOUND;

  useEffect(() => {
    if (!notFound || redirectedRef.current) return;
    redirectedRef.current = true;
    // The object is gone: clear its draft, keep the generation high-water.
    draftStore.objectMissing(taskComposerKey(taskId));
    navigate(
      buildUrl("/tasks", {
        not_found: taskId,
        from: window.location.pathname + window.location.search,
      }),
      { replace: true },
    );
  }, [notFound, taskId, navigate, draftStore]);

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
  const sessionError = ensureSession.isError ? toApiError(ensureSession.error).message : null;

  function openSession() {
    ensureSession.mutate(taskId, {
      onSuccess: (res) => navigate(buildUrl(`/sessions/${encodeURIComponent(res.session_id)}`)),
    });
  }

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
        </div>
      </div>

      {issue.goal ? <p className="max-w-2xl text-sm text-muted-foreground">{issue.goal}</p> : null}

      <PageSection title="会话与执行" description="派工、执行与介入动作都在会话面完成。">
        <div className="grid gap-2">
          <Button type="button" onClick={openSession} disabled={ensureSession.isPending} className="w-fit">
            {ensureSession.isPending ? "正在打开…" : "打开会话"}
          </Button>
          {sessionError ? <p className="text-xs text-destructive">{sessionError}</p> : null}
        </div>
      </PageSection>

      <PageSection title="执行与会话（兼容）" description="只读的线程事件与验证横幅；派工与介入在会话面。">
        {issue.primary_thread ? (
          <ThreadView
            threadId={issue.primary_thread.id}
            issueId={issue.id}
            issueStatus={issue.status}
            validationDispatchDueAt={issue.validation_dispatch_due_at}
          />
        ) : (
          <p className="text-sm text-muted-foreground">没有关联的执行会话。</p>
        )}
      </PageSection>

      <PageSection title="任务详情（兼容）" description="查看轨迹、证据与验收事实，并执行验证与恢复动作。">
        <IssueInspector issue={issue} workspacePath={workspaceQuery.data?.workspace?.local_path ?? null} />
      </PageSection>
    </PageFrame>
  );
}
