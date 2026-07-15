import type { FastifyPluginAsync } from "fastify";
import type { ThreadService } from "../../services/thread.js";
import type { ThreadEventService } from "../../services/thread-event.js";
import type { EventBus } from "../../runtime/event-bus.js";
import type { ThreadEvent } from "@personahub/shared/types";

export interface ThreadRoutesOptions {
  threadService: ThreadService;
  threadEventService: ThreadEventService;
  eventBus: EventBus;
}

function formatSSEMessage(event: ThreadEvent): string {
  const data = JSON.stringify({
    id: event.id,
    event_sequence: event.event_sequence,
    thread_id: event.thread_id,
    type: event.type,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    payload_json: event.payload_json,
    evidence_refs: event.evidence_refs,
    created_at: event.created_at,
  });
  return `id: ${event.id}\ndata: ${data}\n\n`;
}

export const threadRoutes: FastifyPluginAsync<ThreadRoutesOptions> = async (app, opts) => {
  const { threadService, threadEventService, eventBus } = opts;

  app.get("/api/threads/:thread_id", async (request) => {
    const { thread_id } = request.params as { thread_id: string };
    const thread = threadService.get(thread_id);
    return { thread };
  });

  app.get("/api/threads/:thread_id/events", async (request) => {
    const { thread_id } = request.params as { thread_id: string };
    const query = request.query as { after_event_id?: string };
    const events = threadService.getEvents(thread_id, query.after_event_id);
    return { events };
  });

  app.get("/api/threads/:thread_id/events/stream", async (request, reply) => {
    const { thread_id } = request.params as { thread_id: string };
    const query = request.query as { after_event_id?: string };
    const lastEventIdHeader = request.headers["last-event-id"] as string | undefined;

    const afterEventId = query.after_event_id ?? lastEventIdHeader;

    const thread = threadService.get(thread_id);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`retry: 3000\n\n`);

    const buffer: ThreadEvent[] = [];
    let subscribed = false;

    const unsubscribe = eventBus.subscribe(thread.id, (event: ThreadEvent) => {
      if (!subscribed) {
        buffer.push(event);
        return;
      }
      try {
        reply.raw.write(formatSSEMessage(event));
      } catch {
        unsubscribe();
      }
    });

    const historicalEvents = threadEventService.listByThread(thread.id, afterEventId);
    const sentIds = new Set<string>();
    let lastSeq = 0;
    for (const event of historicalEvents) {
      reply.raw.write(formatSSEMessage(event));
      sentIds.add(event.id);
      lastSeq = event.event_sequence;
    }

    subscribed = true;
    for (const event of buffer) {
      if (!sentIds.has(event.id) && event.event_sequence > lastSeq) {
        reply.raw.write(formatSSEMessage(event));
        lastSeq = event.event_sequence;
      }
    }

    request.raw.on("close", () => {
      unsubscribe();
    });
  });
};
