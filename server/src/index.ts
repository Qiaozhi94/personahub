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
import { AgentConfigRepository } from "./repositories/agent-config.js";
import { RunRepository } from "./repositories/run.js";
import { ProjectService } from "./services/project.js";
import { WorkspaceService } from "./services/workspace.js";
import { IssueService } from "./services/issue.js";
import { ThreadService } from "./services/thread.js";
import { AdapterConfigService } from "./services/adapter-config.js";
import { ThreadEventService } from "./services/thread-event.js";
import { WorkspaceLockService } from "./services/workspace-lock.js";
import { RunService } from "./services/run.js";
import { StaleRecoveryService } from "./services/stale-recovery.js";
import { RunDispatchService } from "./services/run-dispatch.js";
import { EventBus } from "./runtime/event-bus.js";
import { AgentAdapterRegistry } from "./runtime/adapter-registry.js";
import { AgentRunner } from "./runtime/agent-runner.js";
import { FakeAgentAdapter } from "./runtime/adapters/fake-adapter.js";
import { CodexCliAdapter } from "./runtime/adapters/codex-cli-adapter.js";
import { registerRoutes } from "./api/index.js";
import { AppError, getErrorStatus, buildErrorResponse } from "./api/errors.js";

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "127.0.0.1";
const DB_PATH = process.env.DB_PATH ?? "personahub.db";
const CORS_ORIGINS = process.env.CORS_ORIGIN?.split(",") ?? [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

async function main() {
  const db = openDatabase(DB_PATH);

  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const threadEventRepo = new ThreadEventRepository(db);
  const workflowTemplateRepo = new WorkflowTemplateRepository(db);
  const validationPolicyRepo = new ValidationPolicyRepository(db);
  const agentConfigRepo = new AgentConfigRepository(db);
  const runRepo = new RunRepository(db);

  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(threadEventRepo, eventBus);

  const projectService = new ProjectService(projectRepo, workspaceRepo);
  const workspaceService = new WorkspaceService(workspaceRepo, projectRepo, db);
  const issueService = new IssueService(
    issueRepo, threadRepo, threadEventRepo,
    projectRepo, workflowTemplateRepo, validationPolicyRepo, db,
  );
  const threadService = new ThreadService(threadRepo, threadEventRepo);
  const adapterConfigService = new AdapterConfigService(agentConfigRepo, projectRepo);
  const workspaceLockService = new WorkspaceLockService(workspaceRepo);
  const runService = new RunService(
    runRepo, threadEventService, issueRepo, workspaceRepo,
    agentConfigRepo, workspaceLockService, db,
  );

  const adapterRegistry = new AgentAdapterRegistry();
  adapterRegistry.register(new FakeAgentAdapter());
  adapterRegistry.register(new CodexCliAdapter());

  const agentRunner = new AgentRunner({
    runService,
    threadEventService,
    workspaceLockService,
  });

  const runDispatchService = new RunDispatchService(
    runService, workspaceLockService, adapterRegistry,
    agentConfigRepo, issueRepo, threadRepo, workspaceRepo,
    threadEventService, agentRunner, db,
  );

  const staleRecoveryService = new StaleRecoveryService(
    runRepo, workspaceRepo, threadEventService, workspaceLockService,
  );

  staleRecoveryService.runAll();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: CORS_ORIGINS });

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

  registerRoutes(app, {
    projectService,
    workspaceService,
    issueService,
    threadService,
    adapterConfigService,
    runService,
    runDispatchService,
    threadEventService,
    eventBus,
  });

  app.addHook("onClose", async () => {
    await agentRunner.shutdown();
  });

  const gracefulShutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`PersonaHub server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
