import type { FastifyPluginAsync } from "fastify";
import type { ThreadService } from "../../services/thread.js";

export interface ThreadRoutesOptions {
  threadService: ThreadService;
}

export const threadRoutes: FastifyPluginAsync<ThreadRoutesOptions> = async (app, opts) => {
  const { threadService } = opts;

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
};
