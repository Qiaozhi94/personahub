import type { FastifyInstance } from "fastify";
import { projectRoutes } from "./routes/projects.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { issueRoutes } from "./routes/issues.js";
import { threadRoutes } from "./routes/threads.js";
import type { ProjectService } from "../services/project.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { IssueService } from "../services/issue.js";
import type { ThreadService } from "../services/thread.js";

export interface Services {
  projectService: ProjectService;
  workspaceService: WorkspaceService;
  issueService: IssueService;
  threadService: ThreadService;
}

export function registerRoutes(app: FastifyInstance, services: Services): void {
  app.register(projectRoutes, { projectService: services.projectService });
  app.register(workspaceRoutes, { workspaceService: services.workspaceService });
  app.register(issueRoutes, { issueService: services.issueService });
  app.register(threadRoutes, { threadService: services.threadService });
}
