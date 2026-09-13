import type { FastifyPluginAsync } from "fastify";
import type { SpaceService } from "../../services/space.js";

export interface SpaceRoutesOptions {
  spaceService: SpaceService;
}

export const spaceRoutes: FastifyPluginAsync<SpaceRoutesOptions> = async (app, opts) => {
  const { spaceService } = opts;

  app.post("/api/spaces", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string };
    const space = spaceService.create(body.name ?? "");
    reply.code(201);
    return { space };
  });

  // 返回每行的 is_default / is_selected：当前 Space 由服务端事实给出，
  // 前端不自行推断（design §4）。
  app.get("/api/spaces", async () => {
    const spaces = spaceService.list();
    return { spaces };
  });

  app.post("/api/spaces/:space_id/select", async (request) => {
    const { space_id } = request.params as { space_id: string };
    const space = spaceService.select(space_id);
    return { space };
  });

  app.post("/api/spaces/:space_id/archive", async (request) => {
    const { space_id } = request.params as { space_id: string };
    const space = spaceService.archive(space_id);
    return { space };
  });

  app.post("/api/spaces/:space_id/restore", async (request) => {
    const { space_id } = request.params as { space_id: string };
    const space = spaceService.restore(space_id);
    return { space };
  });
};
