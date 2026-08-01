import { useEffect, useMemo, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { useWorkspace } from "@/hooks/use-workspace";
import { useIssue, useIssues } from "@/hooks/use-issues";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProjectSwitcher } from "@/components/project/ProjectSwitcher";
import { CreateProjectDialog } from "@/components/project/CreateProjectDialog";
import { WorkspaceBinding } from "@/components/workspace/WorkspaceBinding";
import { AdapterSettings } from "@/components/adapter/AdapterSettings";
import { IssueList } from "@/components/issue/IssueList";
import { CreateIssueDialog } from "@/components/issue/CreateIssueDialog";
import { ThreadView } from "@/components/thread/ThreadView";
import { IssueInspector } from "@/components/inspector/IssueInspector";
import { NoProject } from "@/components/empty-states/NoProject";
import { NoWorkspace } from "@/components/empty-states/NoWorkspace";
import { NoIssue } from "@/components/empty-states/NoIssue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);

  const projectsQuery = useProjects();
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data?.projects]);

  useEffect(() => {
    if (selectedProjectId === null && projects.length > 0) {
      setSelectedProjectId(projects[0]!.id);
    }
  }, [projects, selectedProjectId]);

  const workspaceQuery = useWorkspace(selectedProjectId);
  const workspace = workspaceQuery.data?.workspace ?? null;

  const issuesQuery = useIssues(selectedProjectId);
  const issues = issuesQuery.data?.issues ?? [];

  const issueQuery = useIssue(selectedIssueId);
  const issue = issueQuery.data?.issue ?? null;

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedIssueId(null);
  }

  if (projectsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">PersonaHub — loading…</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <>
        <NoProject onCreateProject={() => setCreateProjectOpen(true)} />
        <CreateProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} onCreated={selectProject} />
      </>
    );
  }

  return (
    <>
      <AppLayout
        left={
          <>
            <ProjectSwitcher
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelect={selectProject}
              onCreateProject={() => setCreateProjectOpen(true)}
            />

            <Button
              variant="outline"
              className="w-full justify-start gap-2 border-dashed border-border-strong text-secondary-foreground"
              disabled={!workspace}
              onClick={() => setCreateIssueOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New coding issue
            </Button>

            <section className="grid gap-1.5">
              <div className="flex items-center justify-between px-2.5">
                <span className="text-xs text-muted-foreground">Issues</span>
                <span className="text-xs text-muted-foreground">{issues.length}</span>
              </div>
              <IssueList issues={issues} selectedIssueId={selectedIssueId} onSelect={setSelectedIssueId} />
            </section>

            {selectedProjectId ? <WorkspaceBinding projectId={selectedProjectId} workspace={workspace} /> : null}

            {selectedProjectId ? <AdapterSettings projectId={selectedProjectId} /> : null}

            <section className="mt-auto grid gap-1.5">
              <div className="px-2.5 text-xs text-muted-foreground">Configuration</div>
              <Button variant="ghost" className="w-full justify-start gap-2 text-secondary-foreground" disabled>
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Button>
            </section>
          </>
        }
        center={
          <>
            <header className="flex items-center justify-between gap-4 border-b border-border px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div>
                  <h1 className="truncate text-[17px] font-semibold leading-tight">
                    {issue ? issue.title : "Select an issue"}
                  </h1>
                  {issue ? (
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[11px]">
                        {issue.status}
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            <section className="min-h-0 overflow-hidden">
              {!workspace ? (
                <NoWorkspace />
              ) : !issue ? (
                <NoIssue />
              ) : issue.primary_thread ? (
                <ThreadView
                  threadId={issue.primary_thread.id}
                  issueId={issue.id}
                  issueStatus={issue.status}
                  projectId={selectedProjectId!}
                  validationDispatchDueAt={issue.validation_dispatch_due_at}
                />
              ) : (
                <NoIssue />
              )}
            </section>
          </>
        }
        right={
          issue ? (
            <IssueInspector issue={issue} workspacePath={workspace?.local_path ?? null} />
          ) : (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Issue Inspector</h2>
              <span className="text-xs text-muted-foreground">Select an issue to see details</span>
            </section>
          )
        }
      />

      <CreateProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} onCreated={selectProject} />

      {selectedProjectId ? (
        <CreateIssueDialog
          projectId={selectedProjectId}
          open={createIssueOpen}
          onOpenChange={setCreateIssueOpen}
          onCreated={setSelectedIssueId}
        />
      ) : null}
    </>
  );
}
