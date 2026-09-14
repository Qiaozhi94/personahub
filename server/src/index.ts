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
import { AdapterWorkspaceStatusRepository } from "./repositories/adapter-workspace-status.js";
import { NodeRunRepository } from "./repositories/node-run.js";
import { GraphRunRepository } from "./repositories/graph-run.js";
import { AdapterAvailabilityProbeCoordinator } from "./services/adapter-probe-coordinator.js";
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
import { ManualRoutingService } from "./services/manual-routing-service.js";
import { ValidationDispatchScheduler } from "./services/validation-dispatch-scheduler.js";
import { EventBus } from "./runtime/event-bus.js";
import { AgentRunner } from "./runtime/agent-runner.js";
import { buildProductionAdapterRegistry } from "./runtime/register-adapters.js";
import { registerRoutes } from "./api/index.js";
import { DomainOutbox } from "./services/domain-outbox.js";
import { DispatchGateService } from "./services/dispatch-gate-service.js";
import { SessionService } from "./services/session-service.js";
import { EligibilityEvaluator } from "./services/eligibility-evaluator.js";
import { RuntimeProjectionService } from "./services/runtime-projection.js";
import { ArtifactConsumptionLedger } from "./services/artifact/consumption.js";
import { ScopedContextAssembler } from "./services/context-assembler.js";
import { DispatchService } from "./services/dispatch-service.js";
import { DispatchRecoveryService } from "./services/dispatch-recovery.js";
import { AppError, getErrorStatus, buildErrorResponse } from "./api/errors.js";
import { GraphConstraintError } from "./db/sqlite-errors.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GraphRuntimeService } from "./services/graph-runtime.js";
import { GraphRecoveryService } from "./services/graph-recovery.js";
import { GraphNodeInstructionBuilder } from "./runtime/graph/instruction-builder.js";
import { AppSecretRepository } from "./repositories/app-secret.js";
import { IntakeConfirmationRepository } from "./repositories/intake-confirmation.js";
import { ConfirmationTokenService, loadOrCreateHmacSecret } from "./services/confirmation-token.js";
import { RoutingRecommendationService } from "./services/routing-recommendation-service.js";
import { IntakeService } from "./services/intake-service.js";
import { WorkflowTemplateAdminService } from "./services/workflow-template-admin.js";
import { AdminAuditEventRepository } from "./repositories/admin-audit-event.js";
import { SpaceRepository } from "./repositories/space.js";
import { RepositoryRegistry } from "./services/repository-registry.js";
import { SpaceService } from "./services/space.js";
import { SkillRegistry } from "./services/skill-registry.js";
import { EffectiveRequirementsResolver } from "./services/effective-requirements.js";
import { SkillDeliveryService } from "./services/skill-delivery.js";
import { AuditService } from "./services/audit.js";
import { RuntimeHealthService } from "./services/runtime-health.js";
import { ArtifactRepository } from "./repositories/artifact.js";
import { ArtifactArchive } from "./services/artifact/archive.js";
import { ArtifactService } from "./services/artifact/service.js";
import { ArtifactResolver } from "./services/artifact/resolver.js";
import {
  ArtifactOrphanSweeper,
  resolveArtifactMaxBytes,
  resolveOrphanGraceMs,
  resolveSweepLeaseMs,
} from "./services/artifact/sweeper.js";

const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "127.0.0.1";
// Dev DB defaults to the repo-local, gitignored `.local/db/`; DB_PATH overrides (tests/CI use temp paths).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.resolve(__dirname, "..", "..", ".local", "db", "personahub.db");
const DB_PATH = process.env.DB_PATH ?? defaultDbPath;
// F010: content-addressed archive root; `.staging` inside it holds in-flight
// temp blobs (the sweeper knows both locations).
const defaultArchiveRoot = path.resolve(__dirname, "..", "..", ".local", "artifact-archive");
const ARTIFACT_ARCHIVE_ROOT = process.env.PERSONAHUB_ARTIFACT_ARCHIVE_DIR ?? defaultArchiveRoot;
const defaultLogFile = path.resolve(__dirname, "..", "..", ".local", "logs", "server.log");
const LOG_FILE = process.env.LOG_FILE ?? defaultLogFile;
const CORS_ORIGINS = process.env.CORS_ORIGIN?.split(",") ?? ["http://127.0.0.1:5173", "http://localhost:5173"];

async function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
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
  const adapterWorkspaceStatusRepo = new AdapterWorkspaceStatusRepository(db);
  const nodeRunRepo = new NodeRunRepository(db);
  const graphRunRepo = new GraphRunRepository(db);
  const adapterProbeCoordinator = new AdapterAvailabilityProbeCoordinator();

  const hmacSecret = loadOrCreateHmacSecret(new AppSecretRepository(db));
  const tokenService = new ConfirmationTokenService(hmacSecret);

  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(threadEventRepo, eventBus);

  const spaceRepo = new SpaceRepository(db);
  const auditService = new AuditService(new AdminAuditEventRepository(db));
  const spaceService = new SpaceService(spaceRepo, auditService, db);
  const skillRegistry = new SkillRegistry(db, auditService);
  const resolver = new EffectiveRequirementsResolver(db);
  const skillDelivery = new SkillDeliveryService(db, auditService);
  const projectService = new ProjectService(projectRepo, workspaceRepo, spaceRepo, auditService, db);
  const workspaceService = new WorkspaceService(workspaceRepo, projectRepo, db);
  const issueService = new IssueService(
    issueRepo,
    threadRepo,
    threadEventRepo,
    projectRepo,
    workflowTemplateRepo,
    validationPolicyRepo,
    spaceRepo,
    db,
  );
  const threadService = new ThreadService(threadRepo, threadEventRepo);
  const workspaceLockService = new WorkspaceLockService(workspaceRepo);
  const runService = new RunService(
    runRepo,
    threadEventService,
    issueRepo,
    workspaceRepo,
    agentConfigRepo,
    workspaceLockService,
    threadEventRepo,
    db,
  );

  // review R3-016: resolves the fixture-only fake adapter's opt-in from the
  // real environment and registers every adapter in one call. Passing
  // process.env through unmodified is load-bearing — a source-scan test in
  // register-adapters.test.ts locks this exact call site so it can't
  // silently diverge from what that file already proves about the function.
  const adapterRegistry = buildProductionAdapterRegistry(process.env);

  const adapterConfigService = new AdapterConfigService(
    agentConfigRepo,
    projectRepo,
    adapterRegistry,
    workspaceRepo,
    adapterWorkspaceStatusRepo,
    db,
    adapterProbeCoordinator,
    nodeRunRepo,
  );

  const agentRunner = new AgentRunner({
    runService,
    threadEventService,
    workspaceLockService,
  });

  const evidenceService = new EvidenceService(threadEventRepo, fileChangeRepo, runRepo, runTraceRepo);
  const developmentTraceService = new DevelopmentTraceService(
    runRepo,
    runTraceRepo,
    fileChangeRepo,
    threadEventRepo,
    issueRepo,
    workspaceRepo,
    threadEventService,
    evidenceService,
    db,
  );
  const validationTraceService = new ValidationTraceService(threadEventService, evidenceService, issueRepo, runRepo);

  const traceQueryService = new TraceQueryService(
    runRepo,
    threadEventRepo,
    fileChangeRepo,
    issueRepo,
    threadRepo,
    runTraceRepo,
    evidenceService,
  );
  const traceExportService = new TraceExportService(
    issueRepo,
    runRepo,
    threadEventRepo,
    fileChangeRepo,
    runTraceRepo,
    evidenceService,
  );

  const evidenceSummaryRepo = new EvidenceSummaryRepository(db);
  const validationWorkflowService = new ValidationWorkflowService(
    db,
    issueRepo,
    runRepo,
    threadEventService,
    threadEventRepo,
    validationTraceService,
    agentConfigRepo,
    workflowTemplateRepo,
    validationPolicyRepo,
    evidenceSummaryRepo,
    fileChangeRepo,
    adapterWorkspaceStatusRepo,
  );

  const manualRoutingService = new ManualRoutingService(
    runRepo,
    issueRepo,
    workspaceRepo,
    agentConfigRepo,
    projectRepo,
    threadEventRepo,
    threadEventService,
    db,
    validationWorkflowService,
    adapterWorkspaceStatusRepo,
  );

  const runDispatchService = new RunDispatchService(
    runService,
    workspaceLockService,
    adapterRegistry,
    agentConfigRepo,
    issueRepo,
    threadRepo,
    workspaceRepo,
    threadEventService,
    agentRunner,
    developmentTraceService,
    runTraceRepo,
    validationWorkflowService,
    db,
    runRepo,
    threadEventRepo,
    fileChangeRepo,
    manualRoutingService,
    adapterWorkspaceStatusRepo,
    nodeRunRepo,
    graphRunRepo,
    projectRepo,
    adapterProbeCoordinator,
  );

  const graphRuntimeService = new GraphRuntimeService(
    {
      graphRunRepo,
      nodeRunRepo,
      runRepo,
      issueRepo,
      threadEventService,
      adapterDeps: { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      instructionBuilder: new GraphNodeInstructionBuilder(),
      drainWorkspace: (wsId: string) => runDispatchService.drainWorkspace(wsId),
    },
    db,
  );

  const recommendationService = new RoutingRecommendationService({
    deps: {
      projectRepo,
      agentConfigRepo,
      adapterWorkspaceStatusRepo,
      workflowTemplateRepo,
    },
    tokenService,
  });

  const intakeService = new IntakeService({
    db,
    tokenService,
    recommendationService,
    confirmationRepo: new IntakeConfirmationRepository(db),
    projectRepo,
    workspaceRepo,
    threadEventService,
    issueService,
    sequentialDeps: {
      runRepo,
      issueRepo,
      agentConfigRepo,
      threadEventService,
      adapterDeps: { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
    },
    graphDeps: {
      graphRunRepo,
      nodeRunRepo,
      runRepo,
      issueRepo,
      threadEventService,
      adapterDeps: { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo },
      instructionBuilder: new GraphNodeInstructionBuilder(),
      drainWorkspace: (wsId: string) => runDispatchService.drainWorkspace(wsId),
    },
    drainWorkspace: (wsId: string) => runDispatchService.drainWorkspace(wsId),
  });

  const workflowTemplateAdminService = new WorkflowTemplateAdminService(
    workflowTemplateRepo,
    new AdminAuditEventRepository(db),
    db,
  );

  const runtimeHealthService = new RuntimeHealthService(
    db,
    workspaceRepo,
    agentConfigRepo,
    adapterWorkspaceStatusRepo,
    runRepo,
    issueRepo,
    adapterConfigService,
    runDispatchService,
  );

  const staleRecoveryService = new StaleRecoveryService(
    runRepo,
    workspaceRepo,
    threadEventService,
    workspaceLockService,
    developmentTraceService,
    runTraceRepo,
  );

  await staleRecoveryService.runAll();

  // F010 artifact stack: archive-first publication, resolver-only reads, and
  // a startup orphan sweep under the maintenance lease (design §5/§7).
  const artifactArchiveRoot = path.resolve(ARTIFACT_ARCHIVE_ROOT);
  fs.mkdirSync(artifactArchiveRoot, { recursive: true });
  const artifactArchive = new ArtifactArchive(artifactArchiveRoot, path.join(artifactArchiveRoot, ".staging"));
  const artifactRepo = new ArtifactRepository(db);
  const artifactService = new ArtifactService({
    db,
    artifactRepo,
    issueRepo,
    threadRepo,
    runRepo,
    workspaceRepo,
    threadEventService,
    archive: artifactArchive,
    maxBytes: resolveArtifactMaxBytes(process.env),
    log: (info) => app.log.info(info),
  });
  const artifactResolver = new ArtifactResolver({
    artifactRepo,
    archive: artifactArchive,
    threadEventService,
    log: (info) => app.log.info(info),
  });
  const artifactSweeper = new ArtifactOrphanSweeper({
    artifactRepo,
    archive: artifactArchive,
    graceMs: resolveOrphanGraceMs(process.env),
    leaseMs: resolveSweepLeaseMs(process.env),
    log: (info) => app.log.info(info),
  });

  // F012 session / dispatch / intervention stack: outbox, gates, eligibility,
  // projection, the single dispatch write path, and the §5.6 recovery scan.
  const domainOutbox = new DomainOutbox(db);
  const dispatchGateService = new DispatchGateService(db);
  const sessionService = new SessionService(db, threadEventService);
  const eligibilityEvaluator = new EligibilityEvaluator(db, agentConfigRepo, resolver, {});
  const runtimeProjectionService = new RuntimeProjectionService(db, {
    agentConfigRepo,
    pendingAvailabilityProbes: () => adapterConfigService.healthSnapshot().pendingProbeCount,
    pendingReprobes: () => runDispatchService.healthSnapshot().pendingReprobeCount,
  });
  const artifactConsumptionLedger = new ArtifactConsumptionLedger({
    db,
    artifactRepo,
    runRepo,
    threadEventService,
    log: (info) => app.log.info(info),
  });
  const contextAssembler = new ScopedContextAssembler(
    db,
    new RepositoryRegistry(db, auditService),
    artifactConsumptionLedger,
    async () => ({ items: [], consumptionRefs: [] }),
    () => null,
  );
  const dispatchService = new DispatchService(
    db,
    domainOutbox,
    dispatchGateService,
    contextAssembler,
    agentConfigRepo,
    runRepo,
    {
      graceWindowMs: () => Number(process.env.DISPATCH_GRACE_WINDOW_MS ?? 10_000),
      spawnRun: async (runId) => {
        const run = runRepo.getById(runId);
        if (!run) return;
        await runDispatchService.drainWorkspace(run.workspace_id);
      },
      cancelRunningRun: async (runId) => {
        await runDispatchService.cancel(runId);
      },
    },
  );
  const dispatchRecoveryService = new DispatchRecoveryService(db, domainOutbox, staleRecoveryService, dispatchService, {
    spawnRun: async (runId) => {
      const run = runRepo.getById(runId);
      if (!run) return;
      await runDispatchService.drainWorkspace(run.workspace_id);
    },
  });
  await dispatchRecoveryService.recoverAll("startup");
  const outboxWorkerTimer = setInterval(() => {
    void domainOutbox.tick("outbox-worker", 30_000);
  }, 1_000);

  const graphRecoveryService = new GraphRecoveryService({
    graphRunRepo,
    nodeRunRepo,
    runRepo,
    issueRepo,
    threadEventService,
    threadEventRepo,
    agentConfigRepo,
    projectRepo,
    adapterWorkspaceStatusRepo,
    db,
  });
  const recoveryResult = await graphRecoveryService.reconcile();
  for (const event of recoveryResult.pendingEvents) {
    threadEventService.broadcast(event);
  }

  const validationRecoveryService = new ValidationRecoveryService(
    issueRepo,
    runRepo,
    validationWorkflowService,
    threadEventRepo,
    agentConfigRepo,
    db,
    threadEventService,
  );
  await validationRecoveryService.reconcile();

  const validationDispatchScheduler = new ValidationDispatchScheduler(
    issueRepo,
    validationWorkflowService,
    1_000,
    (workspaceId) => runDispatchService.drainWorkspace(workspaceId),
  );

  const allWorkspaces = workspaceRepo.listAll();
  for (const ws of allWorkspaces) {
    await runDispatchService.drainWorkspace(ws.id);
  }

  const app = Fastify({
    logger: {
      level: "info",
      transport: {
        target: "pino/file",
        options: { destination: LOG_FILE, mkdir: true },
      },
    },
  });

  await app.register(cors, { origin: CORS_ORIGINS });

  // Startup orphan cleanup — after the logger exists, before accepting traffic.
  artifactSweeper.sweep();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const status = getErrorStatus(error.code);
      reply.code(status);
      return buildErrorResponse(error);
    }
    if (error instanceof GraphConstraintError) {
      app.log.error(error);
      if (error.kind === "active_attempt") {
        reply.code(409);
        return {
          error: {
            code: ErrorCode.NODE_RUN_ATTEMPT_IN_PROGRESS,
            message: error.message,
            details: { kind: error.kind },
          },
        };
      }
      reply.code(500);
      return {
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: error.message,
          details: { kind: error.kind },
        },
      };
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
    spaceService,
    skillRegistry,
    resolver,
    skillDelivery,
    repositoryRegistry: new RepositoryRegistry(db, auditService),
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
      issueRepo,
      runRepo,
      evidenceSummaryRepo,
      validationPolicyRepo,
      threadEventRepo,
    ),
    validationRecoveryActionService: new ValidationRecoveryActionService(issueRepo, validationTraceService, db),
    validationWorkflowService,
    evidenceSummaryRepo,
    issueRepo,
    runRepo,
    graphRunRepo,
    nodeRunRepo,
    workspaceRepo,
    threadRepo,
    threadEventRepo,
    graphRuntimeService,
    agentConfigRepo,
    projectRepo,
    adapterWorkspaceStatusRepo,
    recommendationService,
    intakeService,
    intakeConfirmationRepo: new IntakeConfirmationRepository(db),
    workflowTemplateAdminService,
    runtimeHealthService,
    artifactService,
    artifactResolver,
    sessionService,
    dispatchService,
    dispatchGateService,
    eligibilityEvaluator,
    runtimeProjectionService,
    db,
  });

  app.addHook("onClose", async () => {
    clearInterval(outboxWorkerTimer);
    validationDispatchScheduler.stop();
    await agentRunner.shutdown();
    await Promise.all([runDispatchService.shutdown(), adapterConfigService.shutdown()]);
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
    validationDispatchScheduler.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Guarded so importing this module (e.g. from a test asserting on its
// production wiring) never boots a real server as a side effect — in normal
// operation (`tsx src/index.ts`, or the compiled `node dist/index.js`) this
// module always *is* the entrypoint, so the guard is a no-op there.
const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntrypoint) {
  main();
}
