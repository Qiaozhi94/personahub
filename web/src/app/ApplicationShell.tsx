import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { FolderKanban, ListTodo, Search, Server, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/app/command-palette";
import { SURFACE_REGISTRY, surfaceForPath, type SurfaceDefinition } from "@/app/surface-registry";
import {
  TaskDraftStore,
  taskComposerKey,
  type SubmitTicket,
  type DraftEdit,
  type DraftRecord,
} from "@/app/task-draft-store";
import { useRouter } from "@/app/router";
import { canonicalTarget, resolveRoute } from "@/app/route-manifest";

// ApplicationShell (design.md §2): owns global navigation, the route outlet
// frame, canonical URL rewrites, global feedback, and the TaskDraftStore. It
// sits above the route outlet so switching objects or surfaces never unmounts
// the draft store away. The vertical rail is the only primary navigation.

const DraftStoreContext = createContext<TaskDraftStore | null>(null);

export function useDraftStore(): TaskDraftStore {
  const store = useContext(DraftStoreContext);
  if (!store) throw new Error("useDraftStore must be used inside ApplicationShell");
  return store;
}

/** Convenience binding for the M1 composer key namespace. Values are read on
 *  every render so a draft mutation anywhere in the shell is picked up. */
export function useComposerDraft(taskId: string): {
  record: DraftRecord | null;
  text: string;
  edit: (edit: DraftEdit) => void;
  discard: () => void;
  beginSubmit: () => SubmitTicket | null;
} {
  const store = useDraftStore();
  const key = taskComposerKey(taskId);
  return {
    record: store.record(key),
    text: store.text(key),
    edit: (edit: DraftEdit) => store.edit(key, edit),
    discard: () => store.discard(key),
    beginSubmit: () => store.beginSubmit(key),
  };
}

const SURFACE_ICONS: Partial<Record<SurfaceDefinition["id"], React.ComponentType<{ className?: string }>>> = {
  tasks: ListTodo,
  projects: FolderKanban,
  runtime: Server,
  settings: Settings,
};

export function ApplicationShell({ children }: { children: React.ReactNode }) {
  // One store per mounted shell; useState's initializer keeps it stable
  // without touching refs during render.
  const [draftStore] = useState(() => new TaskDraftStore());

  const { location, navigate } = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Canonical URL rewrites use `replace`: they are programmatic defaults, not
  // user selections, and must not add History entries.
  useEffect(() => {
    const target = canonicalTarget(resolveRoute(location.pathname, location.search));
    if (target !== null) navigate(target, { replace: true });
  }, [location.pathname, location.search, navigate]);

  // Native refresh prompt: registered exactly while a non-empty draft exists,
  // removed the moment all drafts are gone. Drafts never persist.
  const draftVersion = useSyncExternalStore(draftStore.subscribe, draftStore.getSnapshot, draftStore.getSnapshot);
  const hasPendingDraft = draftStore.hasPendingDraft();
  useEffect(() => {
    if (!hasPendingDraft) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome requires returnValue to be set to show the dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasPendingDraft, draftVersion]);

  // Global palette shortcut (Ctrl/Cmd + K).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeSurface = surfaceForPath(location.pathname);

  const enabledSurfaces = SURFACE_REGISTRY.filter((surface) => surface.state === "enabled");
  const daily = enabledSurfaces.filter((surface) => surface.group === "daily");
  const lowFrequency = enabledSurfaces.filter((surface) => surface.group === "low-frequency");

  return (
    <DraftStoreContext.Provider value={draftStore}>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-card px-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-primary to-[#a47de8] text-[13px] font-bold text-primary-foreground"
            >
              P
            </span>
            <span className="text-sm font-semibold">PersonaHub</span>
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-7 items-center gap-2 rounded-md border border-border bg-secondary px-2.5 text-[13px] text-muted-foreground hover:border-border-strong hover:bg-accent"
          >
            <Search className="h-3.5 w-3.5" />
            跳转
            <kbd className="rounded border border-border-strong bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
              Ctrl K
            </kbd>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="工作面" className="flex w-[58px] shrink-0 flex-col gap-0.5 border-r border-border bg-card px-1.5 py-2">
            <RailGroup surfaces={daily} activeSurface={activeSurface} navigate={navigate} />
            <div className="mt-auto grid gap-0.5">
              <RailGroup surfaces={lowFrequency} activeSurface={activeSurface} navigate={navigate} />
            </div>
          </nav>

          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={(to) => {
          setPaletteOpen(false);
          navigate(to);
        }}
      />
    </DraftStoreContext.Provider>
  );
}

function RailGroup({
  surfaces,
  activeSurface,
  navigate,
}: {
  surfaces: SurfaceDefinition[];
  activeSurface: SurfaceDefinition["id"] | null;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}) {
  return (
    <>
      {surfaces.map((surface) => {
        const Icon = SURFACE_ICONS[surface.id];
        const active = surface.id === activeSurface;
        return (
          <button
            key={surface.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (surface.route) navigate(surface.route);
            }}
            className={cn(
              "grid justify-items-center gap-0.5 rounded-lg px-1 py-1.5 text-muted-foreground transition-colors",
              "hover:bg-secondary hover:text-foreground",
              active && "bg-secondary text-primary",
            )}
          >
            {Icon ? <Icon className="h-[17px] w-[17px]" /> : null}
            <span className="text-[11px] leading-none">{surface.label}</span>
          </button>
        );
      })}
    </>
  );
}
