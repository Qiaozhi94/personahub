import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/primitives/app-dialog";
import { useProjects } from "@/hooks/use-projects";
import { enabledSurfaces } from "@/app/surface-registry";

// Global navigation palette (BC-030): opens with the trigger or Ctrl/Cmd+K,
// lists registered navigation targets and existing projects — real data only,
// never an undelivered surface. Arrow keys move, Enter selects, Escape closes
// and focus returns to the previously focused element (via AppDialog).

interface PaletteOption {
  key: string;
  label: string;
  hint: string | null;
  target: string;
}

function usePaletteOptions(): { options: PaletteOption[]; loading: boolean } {
  const projectsQuery = useProjects();
  const options: PaletteOption[] = enabledSurfaces().map((surface) => ({
    key: `surface:${surface.id}`,
    label: surface.label,
    hint: "工作面",
    target: surface.route ?? "/",
  }));
  for (const project of projectsQuery.data?.projects ?? []) {
    options.push({
      key: `project:${project.id}`,
      label: project.name,
      hint: "项目",
      target: `/projects/${encodeURIComponent(project.id)}`,
    });
  }
  return { options, loading: projectsQuery.isLoading };
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (to: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { options, loading } = usePaletteOptions();

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = options.filter((option) => {
    const q = query.trim().toLowerCase();
    return q === "" || option.label.toLowerCase().includes(q) || option.hint?.toLowerCase().includes(q);
  });
  const clampedIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  function select(option: PaletteOption | undefined): void {
    if (!option) return;
    onNavigate(option.target);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(filtered[clampedIndex]);
    }
  }

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex, open]);

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title="跳转" className="max-w-xl gap-2 p-4">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded="true"
        aria-controls="personahub-palette-list"
        aria-label="跳转目标"
        aria-activedescendant={filtered[clampedIndex] ? `palette-option-${clampedIndex}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="输入名称过滤"
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <ul
        ref={listRef}
        id="personahub-palette-list"
        role="listbox"
        aria-label="跳转选项"
        className="grid max-h-80 gap-0.5 overflow-y-auto"
      >
        {loading ? <li className="px-3 py-2 text-sm text-muted-foreground">正在加载项目</li> : null}
        {!loading && filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">没有匹配的跳转目标</li>
        ) : null}
        {filtered.map((option, index) => (
          <li
            key={option.key}
            id={`palette-option-${index}`}
            data-index={index}
            role="option"
            aria-selected={index === clampedIndex}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => select(option)}
            className="flex cursor-pointer items-center justify-between rounded-md px-3 py-1.5 text-sm data-[active=true]:bg-accent"
            data-active={index === clampedIndex}
          >
            <span>{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
          </li>
        ))}
      </ul>
    </AppDialog>
  );
}
