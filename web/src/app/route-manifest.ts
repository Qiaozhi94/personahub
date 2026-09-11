import { buildUrl } from "./router";

// M1 route manifest (design.md §4). Published canonical routes only —
// `/sessions/:sessionId`, `/tasks/:taskId/:view` and `/projects/:projectId/:tab`
// are NOT registered in M1 and get deterministic canonicalization instead.
// `taskId` strictly equals the existing Issue ID and `projectId` the existing
// Project ID; no historical URL aliases are invented.

export type RouteDescriptor =
  | { kind: "root" }
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "project-unsupported-tab"; projectId: string; tab: string }
  | { kind: "tasks"; projectQuery: string | null }
  | { kind: "task"; taskId: string }
  | { kind: "task-unsupported-view"; taskId: string; view: string }
  | { kind: "runtime" }
  | { kind: "runtime-adapters" }
  | { kind: "settings-diagnostics" }
  | { kind: "settings-legacy-workflows" }
  | { kind: "not-found"; attemptedPath: string };

/** Diagnostics that ride along in the query string but never define identity. */
export const DIAGNOSTIC_KEYS = ["not_found", "from", "route_issue"] as const;

export interface Diagnostics {
  notFound: string | null;
  from: string | null;
  routeIssue: string | null;
}

export function readDiagnostics(search: string): Diagnostics {
  const params = new URLSearchParams(search);
  return {
    notFound: params.get("not_found"),
    from: params.get("from"),
    routeIssue: params.get("route_issue"),
  };
}

/** Strips diagnostic params, leaving any remaining query (e.g. `project`). */
export function stripDiagnostics(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  for (const key of DIAGNOSTIC_KEYS) params.delete(key);
  return params;
}

export function resolveRoute(pathname: string, search: string): RouteDescriptor {
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length === 0) return { kind: "root" };

  const first = segments[0]!;
  const second = segments[1];
  const third = segments[2];

  if (first === "tasks") {
    if (segments.length === 1) {
      const params = stripDiagnostics(search);
      return { kind: "tasks", projectQuery: params.get("project") };
    }
    if (segments.length === 2) return { kind: "task", taskId: decodeSegment(second!) };
    if (segments.length === 3) {
      return { kind: "task-unsupported-view", taskId: decodeSegment(second!), view: decodeSegment(third!) };
    }
    return { kind: "not-found", attemptedPath: pathname };
  }

  if (first === "projects") {
    if (segments.length === 1) return { kind: "projects" };
    if (segments.length === 2) return { kind: "project", projectId: decodeSegment(second!) };
    if (segments.length === 3) {
      return { kind: "project-unsupported-tab", projectId: decodeSegment(second!), tab: decodeSegment(third!) };
    }
    return { kind: "not-found", attemptedPath: pathname };
  }

  if (first === "runtime") {
    if (segments.length === 1) return { kind: "runtime" };
    if (segments.length === 2 && second === "adapters") return { kind: "runtime-adapters" };
    return { kind: "not-found", attemptedPath: pathname };
  }

  if (first === "settings") {
    if (segments.length === 2 && second === "system-diagnostics") return { kind: "settings-diagnostics" };
    if (segments.length === 2 && second === "legacy-workflows") return { kind: "settings-legacy-workflows" };
    return { kind: "not-found", attemptedPath: pathname };
  }

  return { kind: "not-found", attemptedPath: pathname };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Canonical target for descriptors whose URL must be rewritten before the
 * route renders. Returns null when the URL is already canonical. The rewrite
 * is always issued with `replace` so it never adds a History entry.
 */
export function canonicalTarget(descriptor: RouteDescriptor): string | null {
  switch (descriptor.kind) {
    case "root":
      // Published legacy entry: replace to the project list, never guessing an
      // object and never adding a History item.
      return "/projects";
    case "task-unsupported-view":
      return buildUrl(`/tasks/${encodeURIComponent(descriptor.taskId)}`, {
        route_issue: "unsupported-view",
        from: `${descriptorBase(descriptor)}/${encodeURIComponent(descriptor.view)}`,
      });
    case "project-unsupported-tab":
      return buildUrl(`/projects/${encodeURIComponent(descriptor.projectId)}`, {
        route_issue: "unsupported-tab",
        from: `${descriptorBase(descriptor)}/${encodeURIComponent(descriptor.tab)}`,
      });
    default:
      return null;
  }
}

function descriptorBase(
  descriptor: Extract<RouteDescriptor, { kind: "task-unsupported-view" | "project-unsupported-tab" }>,
): string {
  const base =
    descriptor.kind === "task-unsupported-view"
      ? `/tasks/${encodeURIComponent(descriptor.taskId)}`
      : `/projects/${encodeURIComponent(descriptor.projectId)}`;
  return base;
}
