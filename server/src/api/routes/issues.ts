import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import type { IssueService } from "../../services/issue.js";
import type { SpaceService } from "../../services/space.js";

export interface IssueRoutesOptions {
  issueService: IssueService;
  spaceService: SpaceService;
}

export const issueRoutes: FastifyPluginAsync<IssueRoutesOptions> = async (app, opts) => {
  const { issueService, spaceService } = opts;

  // 游离任务创建契约（design §3）：space_id 必填、project_id 可省略；
  // space_id 缺省不从"当前选中 Space"隐式推断，前端负责显式带上。
  app.post("/api/issues", async (request, reply) => {
    const body = (request.body ?? {}) as {
      space_id?: string;
      project_id?: string;
      title?: string;
      goal?: string;
      priority?: string;
      labels?: unknown;
    };
    const result = issueService.create(body.project_id ?? null, {
      title: body.title ?? "",
      goal: body.goal ?? "",
      priority: body.priority,
      labels: body.labels,
      space_id: body.space_id,
    });
    reply.code(201);
    return result;
  });

  // v0.2 兼容入口：project 路径下 space 取项目归属（F012 接管前保留）。
  app.post("/api/projects/:project_id/issues", async (request, reply) => {
    const { project_id } = request.params as { project_id: string };
    const body = (request.body ?? {}) as {
      title?: string;
      goal?: string;
      priority?: string;
      labels?: unknown;
      space_id?: string;
    };
    const result = issueService.create(project_id, {
      title: body.title ?? "",
      goal: body.goal ?? "",
      priority: body.priority,
      labels: body.labels,
      space_id: body.space_id,
    });
    reply.code(201);
    return result;
  });

  app.get("/api/projects/:project_id/issues", async (request) => {
    const { project_id } = request.params as { project_id: string };
    const issues = issueService.list(project_id);
    return { issues };
  });

  // Space 作用域任务列表；显式 space_id 可覆盖当前选中 Space（design §4）。
  app.get("/api/issues", async (request) => {
    const query = request.query as { space_id?: string };
    const spaceId = query.space_id ?? spaceService.getSelected()?.id;
    if (!spaceId) {
      throw new AppError(ErrorCode.SPACE_NOT_FOUND, "No Space selected; pass space_id explicitly.");
    }
    const issues = issueService.listBySpace(spaceId);
    return { issues };
  });

  app.get("/api/issues/:issue_id", async (request) => {
    const { issue_id } = request.params as { issue_id: string };
    const issue = issueService.get(issue_id);
    return { issue };
  });
};
