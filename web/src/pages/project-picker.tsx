import { useProjects } from "@/hooks/use-projects";
import { PageLoading, EmptyState, ErrorState } from "@/components/primitives/page-state";

// Explicit project scope for the transitional runtime / settings hosts.
// The health and adapter APIs are project-scoped in v0.2; the picker never
// guesses a project and keeps its choice out of the route identity.

export function ProjectPicker({
  selectedId,
  onSelect,
  label,
}: {
  selectedId: string | null;
  onSelect: (projectId: string) => void;
  label: string;
}) {
  const projectsQuery = useProjects();

  if (projectsQuery.isLoading) return <PageLoading label="正在加载项目" />;
  if (projectsQuery.isError) {
    return (
      <ErrorState
        title="项目列表加载失败"
        description="请稍后重试。"
        action={{ label: "重试", onAction: () => void projectsQuery.refetch() }}
      />
    );
  }

  const projects = projectsQuery.data?.projects ?? [];
  if (projects.length === 0) {
    return (
      <EmptyState
        title="还没有项目"
        description="先创建项目，这里才会出现可执行资源。"
        action={{ label: "前往项目页", onAction: () => (window.location.href = "/projects") }}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            role="radio"
            aria-checked={project.id === selectedId}
            onClick={() => onSelect(project.id)}
            className={
              project.id === selectedId
                ? "rounded-full border border-primary bg-accent-soft px-3 py-1 text-xs text-primary"
                : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
            }
          >
            {project.name}
          </button>
        ))}
      </div>
    </div>
  );
}
