import Fastify from "fastify";
import cors from "@fastify/cors";
import { ErrorCode } from "@personahub/shared/errors";
import { openDatabase } from "./db/index.js";
import { ProjectRepository } from "./repositories/project.js";
import { WorkspaceRepository } from "./repositories/workspace.js";
import { IssueRepository } from "./repositories/issue.js";
import { ThreadRepository } from "./repositories/thread.js";
import { ThreadEventRepository } from "./repositories/thread-event.js";
import { WorkflowTemplateRepository } from "./repositories/workflow-template.js";
import { ValidationPolicyRepository } from "./repositories/validation-policy.js";
import { ProjectService } from "./services/project.js";
import { WorkspaceService } from "./services/workspace.js";
import { IssueService } from "./services/issue.js";
import { ThreadService } from "./services/thread.js";
import { registerRoutes } from "./api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "./api/errors.js";

const PORT = Number(process.env.PORT ?? 4321);
const DB_PATH = process.env.DB_PATH ?? "personahub.db";

async function main() {
  const db = openDatabase(DB_PATH);

  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const threadEventRepo = new ThreadEventRepository(db);
  const workflowTemplateRepo = new WorkflowTemplateRepository(db);
  const validationPolicyRepo = new ValidationPolicyRepository(db);

  const projectService = new ProjectService(projectRepo, workspaceRepo);
  const workspaceService = new WorkspaceService(workspaceRepo, projectRepo, db);
  const issueService = new IssueService(
    issueRepo, threadRepo, threadEventRepo,
    projectRepo, workflowTemplateRepo, validationPolicyRepo, db,
  );
  const threadService = new ThreadService(threadRepo, threadEventRepo);

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const status = getErrorStatus(error.code);
      reply.code(status);
      return buildErrorResponse(error);
    }
    app.log.error(error);
    reply.code(500);
    return {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: "An internal error occurred.",
        details: {},
      },
    };
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  registerRoutes(app, { projectService, workspaceService, issueService, threadService });

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info(`PersonaHub server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
