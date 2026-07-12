import type { FastifyPluginAsync } from "fastify";
import type { ProjectService } from "../../services/project.js";

export interface ProjectRoutesOptions {
  projectService: ProjectService;
}

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (app, opts) => {
  const { projectService } = opts;

  app.post("/api/projects", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; description?: string };
    const project = projectService.create(body.name ?? "", body.description);
    reply.code(201);
    return { project };
  });

  app.get("/api/projects", async () => {
    const projects = projectService.list();
    return { projects };
  });

  app.get("/api/projects/:project_id", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const project = projectService.get(project_id);
    return { project };
  });
};
