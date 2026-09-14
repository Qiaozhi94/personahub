import type { FastifyPluginAsync } from "fastify";
import { parseRequestBody } from "../../api/errors.js";
import { z } from "zod";
import type { ProjectService } from "../../services/project.js";
import type { RepositoryRegistry } from "../../services/repository-registry.js";

export interface ProjectRoutesOptions {
  projectService: ProjectService;
  repositoryRegistry: RepositoryRegistry;
}

const repositoriesBodySchema = z.object({
  primary: z
    .object({
      repository_id: z.string(),
      access: z.enum(["read_write", "read_only"]).optional(),
      scope: z.unknown().optional(),
    })
    .nullable()
    .optional(),
  references: z
    .array(
      z.object({
        repository_id: z.string(),
        scope: z.unknown().optional(),
      }),
    )
    .optional(),
});

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (app, opts) => {
  const { projectService, repositoryRegistry } = opts;

  app.post("/api/projects", async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; description?: string; space_id?: string };
    const project = projectService.create(body.name ?? "", body.description, body.space_id);
    reply.code(201);
    return { project };
  });

  // 默认只返回 active 且属于当前选中 Space 的项目；?include_archived=1 与
  // ?space_id= 可覆盖（design §3 / §4）。按 ID 深链不做 Space 过滤。
  app.get("/api/projects", async (request) => {
    const query = request.query as { space_id?: string; include_archived?: string };
    const projects = projectService.list({
      space_id: query.space_id,
      include_archived: query.include_archived === "1",
    });
    return { projects };
  });

  app.get("/api/projects/:project_id", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const project = projectService.get(project_id);
    return { project };
  });

  app.post("/api/projects/:project_id/archive", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const project = projectService.archive(project_id);
    return { project };
  });

  app.post("/api/projects/:project_id/restore", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const project = projectService.restore(project_id);
    return { project };
  });

  // 删除受引用保护：任一引用类别非空即 409 并列出类别（design §3）。
  app.delete("/api/projects/:project_id", async (request, reply) => {
    const { project_id } = request.params as { project_id: string };
    projectService.remove(project_id);
    reply.code(204);
    return null;
  });

  // 整体设置 primary + references（T007）；归档项目在此 fail-closed。
  app.put("/api/projects/:project_id/repositories", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const body = parseRequestBody(repositoriesBodySchema, request.body);
    const project = projectService.getById(project_id);
    if (!project) {
      // 复用 404 语义。
      projectService.get(project_id);
    }
    repositoryRegistry.setProjectRepositories(
      project_id,
      () => {
        const current = projectService.getById(project_id);
        if (current) projectService.assertNotArchived(current);
      },
      body,
    );
    const refs = repositoryRegistry.listProjectRefs(project_id);
    return { project_id, references: refs };
  });

  app.get("/api/projects/:project_id/repositories", async (request) => {
    const { project_id } = request.params as { project_id: string };
    projectService.get(project_id);
    const refs = repositoryRegistry.listProjectRefs(project_id);
    return { project_id, references: refs };
  });
};
