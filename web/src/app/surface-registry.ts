// F009 M1 SurfaceRegistry manifest (design.md §2).
//
// Registry state is exactly `enabled` | `visible-disabled` | `not-registered`.
// `enabled` requires a real route, a real data source, and at least one
// completable user goal; `not-registered` renders no navigation control,
// is not focusable, and deep links land on not-found. M1 declares no
// `visible-disabled` slot: no undelivered primary surface needs a placeholder,
// and a visible promise that cannot be completed is a dead entry.

export type SurfaceId =
  | "tasks"
  | "sessions"
  | "projects"
  | "automation"
  | "memory"
  | "capabilities"
  | "runtime"
  | "stats"
  | "settings";

export type SurfaceRegistryState = "enabled" | "visible-disabled" | "not-registered";

export type SurfaceGroup = "daily" | "low-frequency";

export interface SurfaceDefinition {
  id: SurfaceId;
  /** User-facing label; one object, one name (design.md §6). */
  label: string;
  group: SurfaceGroup;
  state: SurfaceRegistryState;
  /** Default route for enabled surfaces; null otherwise. */
  route: string | null;
}

/** Order and states mirror the frozen M1 SurfaceRegistry manifest 1:1. */
export const SURFACE_REGISTRY: readonly SurfaceDefinition[] = [
  { id: "tasks", label: "任务", group: "daily", state: "enabled", route: "/tasks" },
  { id: "sessions", label: "会话", group: "daily", state: "not-registered", route: null },
  { id: "projects", label: "项目", group: "daily", state: "enabled", route: "/projects" },
  { id: "automation", label: "自动化", group: "daily", state: "not-registered", route: null },
  { id: "memory", label: "记忆", group: "low-frequency", state: "not-registered", route: null },
  { id: "capabilities", label: "能力", group: "low-frequency", state: "not-registered", route: null },
  { id: "runtime", label: "运行时", group: "low-frequency", state: "enabled", route: "/runtime" },
  { id: "stats", label: "统计", group: "low-frequency", state: "not-registered", route: null },
  { id: "settings", label: "设置", group: "low-frequency", state: "enabled", route: "/settings/system-diagnostics" },
] as const;

export function enabledSurfaces(): Array<SurfaceDefinition> {
  return SURFACE_REGISTRY.filter((surface) => surface.state === "enabled");
}

/** Prefixes each enabled surface owns, used for active-nav highlighting. */
export const SURFACE_ROUTE_PREFIXES: Record<SurfaceId, string[]> = {
  tasks: ["/tasks"],
  sessions: [],
  projects: ["/projects"],
  automation: [],
  memory: [],
  capabilities: [],
  runtime: ["/runtime"],
  stats: [],
  settings: ["/settings"],
};

export function surfaceForPath(pathname: string): SurfaceId | null {
  for (const surface of enabledSurfaces()) {
    if (SURFACE_ROUTE_PREFIXES[surface.id].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      return surface.id;
    }
  }
  return null;
}
