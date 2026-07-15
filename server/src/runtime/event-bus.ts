import type { ThreadEvent } from "@personahub/shared/types";

type ThreadEventHandler = (event: ThreadEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<ThreadEventHandler>>();

  subscribe(threadId: string, handler: ThreadEventHandler): () => void {
    let set = this.handlers.get(threadId);
    if (!set) {
      set = new Set();
      this.handlers.set(threadId, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) {
        this.handlers.delete(threadId);
      }
    };
  }

  publish(event: ThreadEvent): void {
    const set = this.handlers.get(event.thread_id);
    if (set) {
      for (const handler of set) {
        handler(event);
      }
    }
  }
}
