import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

// Minimal history router for the M1 route manifest. URL is the single source
// of truth for selection state: programmatic canonicalization uses `replace`,
// user selections use `push`; popstate replays the URL so History traversal
// restores exactly the addressed object.

export interface RouterLocation {
  pathname: string;
  search: string;
}

export interface Router {
  location: RouterLocation;
  navigate(to: string, options?: { replace?: boolean }): void;
}

type Listener = () => void;

export function readWindowLocation(): RouterLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

export type RouterStore = ReturnType<typeof createRouterStore>;

function createRouterStore() {
  const listeners = new Set<Listener>();
  // useSyncExternalStore requires a referentially stable snapshot; cache the
  // last read location and invalidate it on every history mutation.
  let locationSnapshot = readWindowLocation();

  function notify(): void {
    locationSnapshot = readWindowLocation();
    for (const listener of listeners) listener();
  }

  function navigate(to: string, options?: { replace?: boolean }): void {
    if (options?.replace) {
      window.history.replaceState(null, "", to);
    } else {
      window.history.pushState(null, "", to);
    }
    notify();
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    window.addEventListener("popstate", notify);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("popstate", notify);
    };
  }

  return { getLocation: () => locationSnapshot, navigate, subscribe };
}

const RouterContext = createContext<RouterStore | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => createRouterStore(), []);
  return <RouterContext.Provider value={store}>{children}</RouterContext.Provider>;
}

export function useRouterStore(): RouterStore {
  const store = useContext(RouterContext);
  if (!store) throw new Error("useRouterStore must be used inside RouterProvider");
  return store;
}

export function useLocation(): RouterLocation {
  const store = useRouterStore();
  return useSyncExternalStore(store.subscribe, store.getLocation, store.getLocation);
}

export function useRouter(): Router {
  const store = useRouterStore();
  return { location: useLocation(), navigate: store.navigate };
}

/** Builds a URL string from pathname + query params, skipping empty values. */
export function buildUrl(
  pathname: string,
  params: Record<string, string | null | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
