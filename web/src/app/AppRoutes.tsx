import { useLocation } from "@/app/router";
import { readDiagnostics, resolveRoute } from "@/app/route-manifest";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { TasksPage } from "@/pages/TasksPage";
import { TaskDetailPage } from "@/pages/TaskDetailPage";
import { RuntimePage } from "@/pages/runtime-page";
import { RuntimeAdaptersPage } from "@/pages/runtime-adapters-page";
import { SystemDiagnosticsPage } from "@/pages/system-diagnostics-page";
import { LegacyWorkflowsPage } from "@/pages/legacy-workflows-page";
import { NotFoundPage } from "@/pages/NotFoundPage";

// M1 route outlet: resolves the URL against the route manifest and renders
// the canonical page for it. Canonicalization rewrites already happened in the
// ApplicationShell, so unsupported view/tab paths render their base object
// while the URL settles.

export function AppRoutes() {
  const location = useLocation();
  const descriptor = resolveRoute(location.pathname, location.search);
  const diagnostics = readDiagnostics(location.search);

  switch (descriptor.kind) {
    case "root":
    case "projects":
      return <ProjectsPage diagnostics={diagnostics} />;
    case "project":
    case "project-unsupported-tab":
      return <ProjectDetailPage projectId={descriptor.projectId} diagnostics={diagnostics} />;
    case "tasks":
      return <TasksPage projectQuery={descriptor.projectQuery} diagnostics={diagnostics} />;
    case "task":
    case "task-unsupported-view":
      return <TaskDetailPage taskId={descriptor.taskId} diagnostics={diagnostics} />;
    case "runtime":
      return <RuntimePage />;
    case "runtime-adapters":
      return <RuntimeAdaptersPage />;
    case "settings-diagnostics":
      return <SystemDiagnosticsPage />;
    case "settings-legacy-workflows":
      return <LegacyWorkflowsPage />;
    case "not-found":
      return <NotFoundPage attemptedPath={descriptor.attemptedPath} />;
  }
}
