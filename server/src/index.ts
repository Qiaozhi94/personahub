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
import { RunTraceRepository } from "./repositories/run-trace.js";
import { FileChangeRepository } from "./repositories/file-change.js";
import { EvidenceSummaryRepository } from "./repositories/evidence-summary.js";
import { EvidenceService } from "./services/evidence.js";
import { DevelopmentTraceService } from "./services/development-trace.js";
import { ValidationTraceService } from "./services/validation-trace.js";
import { TraceQueryService } from "./services/trace-query.js";
import { TraceExportService } from "./services/trace-export.js";
import { ProjectService } from "./services/project.js";
import { WorkspaceService } from "./services/workspace.js";
import { IssueService } from "./services/issue.js";
import { ThreadService } from "./services/thread.js";
import { AdapterConfigService } from "./services/adapter-config.js";
import { ThreadEventService } from "./services/thread-event.js";
import { WorkspaceLockService } from "./services/workspace-lock.js";
import { RunService } from "./services/run.js";
import { StaleRecoveryService } from "./services/stale-recovery.js";
import { ValidationQueryService } from "./services/validation/query.js";
import { ValidationRecoveryActionService } from "./services/validation/recovery-action.js";
import { ValidationRecoveryService } from "./services/validation/recovery-service.js";
import { ValidationWorkflowService } from "./services/validation/workflow-service.js";
import { RunDispatchService } from "./services/run-dispatch.js";
import { EventBus } from "./runtime/event-bus.js";
import { AgentAdapterRegistry } from "./runtime/adapter-registry.js";
import { AgentRunner } from "./runtime/agent-runner.js";
import { FakeAgentAdapter } from "./runtime/adapters/fake-adapter.js";
import { CodexCliAdapter } from "./runtime/adapters/codex-cli-adapter.js";
import { ClaudeCodeAdapter } from "./runtime/adapters/claude-code-adapter.js";
import { OpenCodeAdapter } from "./runtime/adapters/opencode-adapter.js";
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
  const runTraceRepo = new RunTraceRepository(db);
  const fileChangeRepo = new FileChangeRepository(db);

  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(threadEventRepo, eventBus);

  const projectService = new ProjectService(projectRepo, workspaceRepo);
  const workspaceService = new WorkspaceService(workspaceRepo, projectRepo, db);
  const issueService = new IssueService(
    issueRepo, threadRepo, threadEventRepo,
    projectRepo, workflowTemplateRepo, validationPolicyRepo, db,
  );
  const threadService = new ThreadService(threadRepo, threadEventRepo);
  const workspaceLockService = new WorkspaceLockService(workspaceRepo);
  const runService = new RunService(
    runRepo, threadEventService, issueRepo, workspaceRepo,
    agentConfigRepo, workspaceLockService, threadEventRepo, db,
  );

  const adapterRegistry = new AgentAdapterRegistry();
  adapterRegistry.register(new FakeAgentAdapter());
  adapterRegistry.register(new CodexCliAdapter());
  adapterRegistry.register(new ClaudeCodeAdapter());
  adapterRegistry.register(new OpenCodeAdapter());

  const adapterConfigService = new AdapterConfigService(agentConfigRepo, projectRepo, adapterRegistry);

  const agentRunner = new AgentRunner({
    runService,
    threadEventService,
    workspaceLockService,
  });

  const evidenceService = new EvidenceService(threadEventRepo, fileChangeRepo, runRepo, runTraceRepo);
  const developmentTraceService = new DevelopmentTraceService(
    runRepo, runTraceRepo, fileChangeRepo, threadEventRepo,
    issueRepo, workspaceRepo, threadEventService, evidenceService, db,
  );
  const validationTraceService = new ValidationTraceService(
    threadEventService, evidenceService, issueRepo, runRepo,
  );

  const traceQueryService = new TraceQueryService(
    runRepo, threadEventRepo, fileChangeRepo, issueRepo, threadRepo, runTraceRepo, evidenceService,
  );
  const traceExportService = new TraceExportService(
    issueRepo, runRepo, threadEventRepo, fileChangeRepo, runTraceRepo, evidenceService,
  );

  const evidenceSummaryRepo = new EvidenceSummaryRepository(db);
  const validationWorkflowService = new ValidationWorkflowService(
    db, issueRepo, runRepo, threadEventService, threadEventRepo,
    validationTraceService, agentConfigRepo, workflowTemplateRepo,
    validationPolicyRepo, evidenceSummaryRepo, fileChangeRepo,
  );

  const runDispatchService = new RunDispatchService(
    runService, workspaceLockService, adapterRegistry,
    agentConfigRepo, issueRepo, threadRepo, workspaceRepo,
    threadEventService, agentRunner, developmentTraceService, runTraceRepo,
    validationWorkflowService, db,
    runRepo, threadEventRepo, fileChangeRepo,
  );

  const staleRecoveryService = new StaleRecoveryService(
    runRepo, workspaceRepo, threadEventService, workspaceLockService,
    developmentTraceService, runTraceRepo,
  );

  await staleRecoveryService.runAll();

  const validationRecoveryService = new ValidationRecoveryService(
    issueRepo, runRepo, validationWorkflowService,
    threadEventRepo, agentConfigRepo, db, threadEventService,
  );
  await validationRecoveryService.reconcile();

  const allWorkspaces = workspaceRepo.listAll();
  for (const ws of allWorkspaces) {
    await runDispatchService.drainWorkspace(ws.id);
  }

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
    traceQueryService,
    traceExportService,
    validationQueryService: new ValidationQueryService(
      issueRepo, runRepo, evidenceSummaryRepo, validationPolicyRepo, threadEventRepo,
    ),
    validationRecoveryActionService: new ValidationRecoveryActionService(
      issueRepo, validationTraceService, db,
    ),
    validationWorkflowService,
    evidenceSummaryRepo,
    issueRepo,
    runRepo,
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
