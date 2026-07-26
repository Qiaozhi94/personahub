import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openDatabase } from "../src/db/index.js";
import { ProjectRepository } from "../src/repositories/project.js";
import { WorkspaceRepository } from "../src/repositories/workspace.js";
import { IssueRepository } from "../src/repositories/issue.js";
import { ThreadRepository } from "../src/repositories/thread.js";
import { ThreadEventRepository } from "../src/repositories/thread-event.js";
import { WorkflowTemplateRepository } from "../src/repositories/workflow-template.js";
import { ValidationPolicyRepository } from "../src/repositories/validation-policy.js";
import { AgentConfigRepository } from "../src/repositories/agent-config.js";
import { RunRepository } from "../src/repositories/run.js";
import { RunTraceRepository } from "../src/repositories/run-trace.js";
import { FileChangeRepository } from "../src/repositories/file-change.js";
import { AdapterWorkspaceStatusRepository } from "../src/repositories/adapter-workspace-status.js";
import { AdapterAvailabilityProbeCoordinator } from "../src/services/adapter-probe-coordinator.js";
import { ProjectService } from "../src/services/project.js";
import { WorkspaceService } from "../src/services/workspace.js";
import { IssueService } from "../src/services/issue.js";
import { ThreadService } from "../src/services/thread.js";
import { AdapterConfigService } from "../src/services/adapter-config.js";
import { ThreadEventService } from "../src/services/thread-event.js";
import { WorkspaceLockService } from "../src/services/workspace-lock.js";
import { RunService } from "../src/services/run.js";
import { StaleRecoveryService } from "../src/services/stale-recovery.js";
import { AgentAdapterRegistry } from "../src/runtime/adapter-registry.js";
import { AgentRunner } from "../src/runtime/agent-runner.js";
import { FakeAgentAdapter } from "../src/runtime/adapters/fake-adapter.js";
import { RunDispatchService } from "../src/services/run-dispatch.js";
import { ManualRoutingService } from "../src/services/manual-routing-service.js";
import { EventBus } from "../src/runtime/event-bus.js";
import type { EventBus as EventBusType } from "../src/runtime/event-bus.js";
import { EvidenceService } from "../src/services/evidence.js";
import { DevelopmentTraceService } from "../src/services/development-trace.js";
import { ValidationTraceService } from "../src/services/validation-trace.js";
import { ValidationQueryService } from "../src/services/validation/query.js";
import { ValidationRecoveryActionService } from "../src/services/validation/recovery-action.js";
import { ValidationWorkflowService } from "../src/services/validation/workflow-service.js";
import { ValidationDispatchScheduler } from "../src/services/validation-dispatch-scheduler.js";
import { TraceQueryService } from "../src/services/trace-query.js";
import { TraceExportService } from "../src/services/trace-export.js";
import { EvidenceSummaryRepository } from "../src/repositories/evidence-summary.js";

export function createTestDb(): Database.Database {
  return openDatabase(":memory:");
}

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "personahub-test-"));
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface TestServices {
  db: Database.Database;
  projectRepo: ProjectRepository;
  workspaceRepo: WorkspaceRepository;
  issueRepo: IssueRepository;
  threadRepo: ThreadRepository;
  threadEventRepo: ThreadEventRepository;
  workflowTemplateRepo: WorkflowTemplateRepository;
  validationPolicyRepo: ValidationPolicyRepository;
  agentConfigRepo: AgentConfigRepository;
  runRepo: RunRepository;
  runTraceRepo: RunTraceRepository;
  fileChangeRepo: FileChangeRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  adapterProbeCoordinator: AdapterAvailabilityProbeCoordinator;
  projectService: ProjectService;
  workspaceService: WorkspaceService;
  issueService: IssueService;
  threadService: ThreadService;
  adapterConfigService: AdapterConfigService;
  threadEventService: ThreadEventService;
  workspaceLockService: WorkspaceLockService;
  runService: RunService;
  staleRecoveryService: StaleRecoveryService;
  adapterRegistry: AgentAdapterRegistry;
  agentRunner: AgentRunner;
  runDispatchService: RunDispatchService;
  manualRoutingService: ManualRoutingService;
  evidenceService: EvidenceService;
  developmentTraceService: DevelopmentTraceService;
  validationTraceService: ValidationTraceService;
  traceQueryService: TraceQueryService;
  traceExportService: TraceExportService;
  evidenceSummaryRepo: EvidenceSummaryRepository;
  validationQueryService: ValidationQueryService;
  validationRecoveryActionService: ValidationRecoveryActionService;
  validationWorkflowService: ValidationWorkflowService;
  validationDispatchScheduler: ValidationDispatchScheduler;
  eventBus: EventBusType;
}

export function createTestServices(): TestServices {  const db = createTestDb();
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
  const adapterProbeCoordinator = new AdapterAvailabilityProbeCoordinator();

  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(threadEventRepo, eventBus);
  const workspaceLockService = new WorkspaceLockService(workspaceRepo);
  const runService = new RunService(
    runRepo, threadEventService, issueRepo, workspaceRepo,
    agentConfigRepo, workspaceLockService, threadEventRepo, db,
  );

  const evidenceService = new EvidenceService(threadEventRepo, fileChangeRepo, runRepo, runTraceRepo);
  const developmentTraceService = new DevelopmentTraceService(
    runRepo, runTraceRepo, fileChangeRepo, threadEventRepo,
    issueRepo, workspaceRepo, threadEventService, evidenceService, db,
  );
  const validationTraceService = new ValidationTraceService(
    threadEventService, evidenceService, issueRepo, runRepo,
  );

  const evidenceSummaryRepo = new EvidenceSummaryRepository(db);
  const validationWorkflowService = new ValidationWorkflowService(
    db, issueRepo, runRepo, threadEventService, threadEventRepo,
    validationTraceService, agentConfigRepo, workflowTemplateRepo,
    validationPolicyRepo, evidenceSummaryRepo, fileChangeRepo,
    adapterWorkspaceStatusRepo,
    // grace=0: preserve F004's original "immediate creation" semantics —
    // Phase B fires synchronously right after Phase A in every existing
    // automatic-validation test, with zero added latency/flakiness.
    0,
  );
  const validationDispatchScheduler = new ValidationDispatchScheduler(
    issueRepo, validationWorkflowService,
  );

  const adapterRegistry = new AgentAdapterRegistry();
  adapterRegistry.register(new FakeAgentAdapter());

  const agentRunner = new AgentRunner({
    runService,
    threadEventService,
    workspaceLockService,
  });

  const manualRoutingService = new ManualRoutingService(
    runRepo, issueRepo, workspaceRepo, agentConfigRepo, projectRepo,
    threadEventRepo, threadEventService, db, validationWorkflowService,
    adapterWorkspaceStatusRepo,
  );

  const runDispatchService = new RunDispatchService(
    runService, workspaceLockService, adapterRegistry,
    agentConfigRepo, issueRepo, threadRepo, workspaceRepo,
    threadEventService, agentRunner, developmentTraceService, runTraceRepo,
    validationWorkflowService, db,
    runRepo, threadEventRepo, fileChangeRepo,
    manualRoutingService, adapterWorkspaceStatusRepo, adapterProbeCoordinator,
  );

  const staleRecoveryService = new StaleRecoveryService(
    runRepo, workspaceRepo, threadEventService, workspaceLockService,
    developmentTraceService, runTraceRepo,
  );

  const traceQueryService = new TraceQueryService(
    runRepo, threadEventRepo, fileChangeRepo, issueRepo, threadRepo, runTraceRepo, evidenceService,
  );
  const traceExportService = new TraceExportService(
    issueRepo, runRepo, threadEventRepo, fileChangeRepo, runTraceRepo, evidenceService,
  );

  const validationQueryService = new ValidationQueryService(
    issueRepo, runRepo, evidenceSummaryRepo, validationPolicyRepo, threadEventRepo,
  );
  const validationRecoveryActionService = new ValidationRecoveryActionService(
    issueRepo, validationTraceService, db,
  );

  return {
    db,
    projectRepo,
    workspaceRepo,
    issueRepo,
    threadRepo,
    threadEventRepo,
    workflowTemplateRepo,
    validationPolicyRepo,
    agentConfigRepo,
    runRepo,
    runTraceRepo,
    fileChangeRepo,
    adapterWorkspaceStatusRepo,
    adapterProbeCoordinator,
    projectService: new ProjectService(projectRepo, workspaceRepo),
    workspaceService: new WorkspaceService(workspaceRepo, projectRepo, db),
    issueService: new IssueService(
      issueRepo, threadRepo, threadEventRepo,
      projectRepo, workflowTemplateRepo, validationPolicyRepo, db,
    ),
    threadService: new ThreadService(threadRepo, threadEventRepo),
    adapterConfigService: new AdapterConfigService(agentConfigRepo, projectRepo, adapterRegistry, workspaceRepo, adapterWorkspaceStatusRepo, db, adapterProbeCoordinator),
    threadEventService,
    workspaceLockService,
    runService,
    staleRecoveryService,
    adapterRegistry,
    agentRunner,
    runDispatchService,
    manualRoutingService,
    evidenceService,
    developmentTraceService,
    validationTraceService,
    traceQueryService,
    traceExportService,
    evidenceSummaryRepo,
    validationQueryService,
    validationRecoveryActionService,
    validationWorkflowService,
    validationDispatchScheduler,
    eventBus,
  };
}

/**
 * final-recheck-report regression: this used to fire-and-forget
 * `agentRunner.shutdown()` and close the DB immediately, without waiting for
 * either shutdown to finish — an in-flight availability re-probe
 * (RunDispatchService.shutdown(), added alongside the background-task
 * lifecycle fix) could still be running against an already-closed
 * better-sqlite3 handle, producing cross-test noise/flakiness. Every
 * caller already writes `afterEach(() => disposeTestServices(services))` —
 * an arrow function with an expression body, which forwards whatever this
 * returns — so making this async and returning the awaited promise chain
 * makes every one of those call sites correctly await it without editing
 * any of them.
 */
export async function disposeTestServices(services: TestServices): Promise<void> {
  await services.agentRunner.shutdown();
  await services.runDispatchService.shutdown();
  await services.adapterConfigService.shutdown();
  services.db.close();
}
