import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RuntimeHealthService } from "../../services/runtime-health.js";
import type { ProjectRepository } from "../../repositories/project.js";
import { parseRequestBody } from "../errors.js";
import { AppError } from "../errors.js";
import { ErrorCode } from "@personahub/shared/errors";

export interface RuntimeHealthRoutesOptions {
  runtimeHealthService: RuntimeHealthService;
  projectRepo: ProjectRepository;
}

const healthQuerySchema = z.object({
  workspace_id: z.string().optional(),
});

export const runtimeHealthRoutes: FastifyPluginAsync<RuntimeHealthRoutesOptions> = async (app, opts) => {
  const { runtimeHealthService, projectRepo } = opts;

  app.get("/api/projects/:project_id/health/runtime", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const query = parseRequestBody(healthQuerySchema, request.query ?? {});

    const project = projectRepo.getById(project_id);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    const health = runtimeHealthService.collect(project_id, query.workspace_id);
    return { health };
  });
};
