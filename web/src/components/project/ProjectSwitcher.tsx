import { ChevronDown, Plus } from "lucide-react";
import type { Project } from "@personahub/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ProjectSwitcherProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
  onCreateProject: () => void;
}

export function ProjectSwitcher({
  projects,
  selectedProjectId,
  onSelect,
  onCreateProject,
}: ProjectSwitcherProps) {
  const current = projects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-auto w-full justify-start gap-2.5 border-transparent bg-background px-2 py-1.5 shadow-none hover:border-border"
        >
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-bold">
            {(current?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
            {current?.name ?? "Select project"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[268px]">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Projects
        </DropdownMenuLabel>
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            className="gap-2.5"
            onSelect={() => onSelect(project.id)}
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-border bg-background text-[11px] font-bold">
              {project.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span
              className={cn(
                "text-brand",
                project.id === selectedProjectId ? "opacity-100" : "opacity-0",
              )}
            >
              ✓
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2.5" onSelect={onCreateProject}>
          <Plus className="h-3.5 w-3.5" />
          <span>New project</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
