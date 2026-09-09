import { createContext, useContext, useSyncExternalStore } from "react";
import type { SubmitTicket, TaskDraftStore } from "@/app/task-draft-store";

// The shell-owned draft store travels through context so any component inside
// ApplicationShell (e.g. the thread composer) reads and mutates the same store
// the shell uses for its beforeunload hint. Kept in its own module so
// components can depend on it without importing the shell itself.

export const DraftStoreContext = createContext<TaskDraftStore | null>(null);

export function useDraftStore(): TaskDraftStore {
  const store = useContext(DraftStoreContext);
  if (!store) throw new Error("useDraftStore must be used inside ApplicationShell");
  return store;
}

/** Convenience binding for the M1 composer key namespace. Values are read on
 *  every render so a draft mutation anywhere in the shell is picked up. */
export function useComposerDraft(taskId: string): {
  text: string;
  record: ReturnType<TaskDraftStore["record"]>;
  edit: (edit: Parameters<TaskDraftStore["edit"]>[1]) => void;
  discard: () => void;
  beginSubmit: () => SubmitTicket | null;
  resolve: (ticket: SubmitTicket, outcome: "success" | "failure") => boolean;
} {
  const store = useDraftStore();
  // Subscribe so composer-driven consumers re-render when any draft mutation
  // lands (the shell holds the same subscription for the refresh hint).
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const key = `task:${taskId}:composer`;
  return {
    text: store.text(key),
    record: store.record(key),
    edit: (edit) => store.edit(key, edit),
    discard: () => store.discard(key),
    beginSubmit: () => store.beginSubmit(key),
    resolve: (ticket, outcome) => store.resolveSubmit(ticket, outcome),
  };
}

