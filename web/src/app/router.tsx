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
    const wasEmpty = listeners.size === 0;
    listeners.add(listener);
    // Register the window listener once for the store's lifetime and remove
    // it only when the LAST subscriber goes away (review R1-009): browsers
    // dedupe identical listeners, so a per-subscriber remove would detach the
    // shared popstate handling while other subscribers are still listening.
    if (wasEmpty) window.addEventListener("popstate", notify);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("popstate", notify);
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
export function buildUrl(pathname: string, params: Record<string, string | null | undefined> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
