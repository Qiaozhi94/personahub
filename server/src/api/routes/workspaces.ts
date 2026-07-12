import type { FastifyPluginAsync } from "fastify";
import type { WorkspaceService } from "../../services/workspace.js";

export interface WorkspaceRoutesOptions {
  workspaceService: WorkspaceService;
}

export const workspaceRoutes: FastifyPluginAsync<WorkspaceRoutesOptions> = async (app, opts) => {
  const { workspaceService } = opts;

  app.put("/api/projects/:project_id/workspace", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as { local_path?: string };
    const workspace = workspaceService.bind(project_id, body.local_path ?? "");
    return { workspace };
  });

  app.get("/api/projects/:project_id/workspace", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const workspace = workspaceService.get(project_id);
    return { workspace };
  });

  app.get("/api/workspaces/:workspace_id", async (request) => {
    const { workspace_id } = request.params as { workspace_id: string };
    const workspace = workspaceService.getById(workspace_id);
    return { workspace };
  });
};
