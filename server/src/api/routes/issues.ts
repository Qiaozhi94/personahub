import type { FastifyPluginAsync } from "fastify";
import type { IssueService } from "../../services/issue.js";

export interface IssueRoutesOptions {
  issueService: IssueService;
}

export const issueRoutes: FastifyPluginAsync<IssueRoutesOptions> = async (app, opts) => {
  const { issueService } = opts;

  app.post("/api/projects/:project_id/issues", async (request, reply) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as {
      title?: string;
      goal?: string;
      priority?: string;
      labels?: unknown;
    };
    const result = issueService.create(project_id, {
      title: body.title ?? "",
      goal: body.goal ?? "",
      priority: body.priority,
      labels: body.labels,
    });
    reply.code(201);
    return result;
  });

  app.get("/api/projects/:project_id/issues", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const issues = issueService.list(project_id);
    return { issues };
  });

  app.get("/api/issues/:issue_id", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const issue = issueService.get(issue_id);
    return { issue };
  });
};
