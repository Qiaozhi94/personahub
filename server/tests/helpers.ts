import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
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
import { NodeRunRepository } from "../src/repositories/node-run.js";
import { GraphRunRepository } from "../src/repositories/graph-run.js";
import { GraphNodeInstructionBuilder } from "../src/runtime/graph/instruction-builder.js";
import { GraphRuntimeService } from "../src/services/graph-runtime.js";
import { SessionService } from "../src/services/session-service.js";
import { EligibilityEvaluator } from "../src/services/eligibility-evaluator.js";
import { DispatchService } from "../src/services/dispatch-service.js";
import { DispatchGateService } from "../src/services/dispatch-gate-service.js";
import { DomainOutbox } from "../src/services/domain-outbox.js";
import type { ContextAssembler, AssembleInput, AssembledContext } from "../src/services/context-assembler.js";
import { AdapterAvailabilityProbeCoordinator } from "../src/services/adapter-probe-coordinator.js";
import { ProjectService } from "../src/services/project.js";
import { SpaceService } from "../src/services/space.js";
import { RepositoryRegistry } from "../src/services/repository-registry.js";
import { SkillRegistry } from "../src/services/skill-registry.js";
import { EffectiveRequirementsResolver } from "../src/services/effective-requirements.js";
import { SkillDeliveryService } from "../src/services/skill-delivery.js";
import { SpaceRepository } from "../src/repositories/space.js";
import { AuditService } from "../src/services/audit.js";
import { AdminAuditEventRepository } from "../src/repositories/admin-audit-event.js";
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
  // Windows 在 close 之后异步释放文件锁，rmSync 可能撞上瞬态 EPERM/EBUSY：
  // 带重试清除，而不是让清理竞态打红整个测试文件。
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/**
 * Initialise a throwaway git repo in `dir`, isolating it from the developer's
 * global git config. In particular it clears `core.hooksPath`: the global
 * config on some machines points at a hooks dir with a slow pre-commit hook
 * (e.g. a code-review graph updater) that would otherwise run on every commit
 * in these scanner tests and blow the execSync timeout.
 */
export function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, encoding: "utf-8", timeout: 5000 });
  execSync('git config user.email "test@test.com"', { cwd: dir, encoding: "utf-8" });
  execSync('git config user.name "Test"', { cwd: dir, encoding: "utf-8" });
  execSync("git config core.hooksPath /dev/null", { cwd: dir, encoding: "utf-8" });
}

export interface TestServices {
  db: Database.Database;
  skillRegistry: SkillRegistry;
  resolver: EffectiveRequirementsResolver;
  skillDelivery: SkillDeliveryService;
  auditService: AuditService;
  spaceRepo: SpaceRepository;
  spaceService: SpaceService;
  repositoryRegistry: RepositoryRegistry;
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
  nodeRunRepo: NodeRunRepository;
  graphRunRepo: GraphRunRepository;
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
  graphRuntimeService: GraphRuntimeService;
  sessionService: SessionService;
  eligibilityEvaluator: EligibilityEvaluator;
  dispatchService: DispatchService;
  dispatchGates: DispatchGateService;
}

export function createTestServices(dbInput?: Database.Database): TestServices {
  const db = dbInput ?? createTestDb();
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

  const spaceRepo = new SpaceRepository(db);
  const auditService = new AuditService(new AdminAuditEventRepository(db));
  const spaceService = new SpaceService(spaceRepo, auditService, db);
  const repositoryRegistry = new RepositoryRegistry(db, auditService);
  const skillRegistry = new SkillRegistry(db, auditService);
  const resolver = new EffectiveRequirementsResolver(db);
  const skillDelivery = new SkillDeliveryService(
    db,
    auditService,
    join(tmpdir(), "f013-delivery-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
  );

  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(threadEventRepo, eventBus);
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
    // grace=0: preserve F004's original "immediate creation" semantics —
    // Phase B fires synchronously right after Phase A in every existing
    // automatic-validation test, with zero added latency/flakiness.
    0,
  );
  const validationDispatchScheduler = new ValidationDispatchScheduler(issueRepo, validationWorkflowService);

  const adapterRegistry = new AgentAdapterRegistry();
  adapterRegistry.register(new FakeAgentAdapter());

  const agentRunner = new AgentRunner({
    runService,
    threadEventService,
    workspaceLockService,
  });

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

  const staleRecoveryService = new StaleRecoveryService(
    runRepo,
    workspaceRepo,
    threadEventService,
    workspaceLockService,
    developmentTraceService,
    runTraceRepo,
  );

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

  const validationQueryService = new ValidationQueryService(
    issueRepo,
    runRepo,
    evidenceSummaryRepo,
    validationPolicyRepo,
    threadEventRepo,
  );
  const validationRecoveryActionService = new ValidationRecoveryActionService(issueRepo, validationTraceService, db);

  const dispatchGates = new DispatchGateService(db);
  const dispatchOutbox = new DomainOutbox(db);
  const sessionService = new SessionService(db, threadEventService);
  const eligibilityEvaluator = new EligibilityEvaluator(db, agentConfigRepo, resolver, {
    currentCliVersion: (provider) => TEST_CLI_VERSIONS[provider] ?? "0.0.0",
  });
  const stubAssembler: ContextAssembler = {
    async assemble(input: AssembleInput): Promise<AssembledContext> {
      return {
        scope: input.dispatch.context_scope,
        items: [],
        contentHash: "sha256:stub",
        consumptionRefs: [],
        startMode: "cold",
        coldStartReason: null,
        resumedFromAttemptId: null,
      };
    },
    recordConsumptions() {},
  };
  const dispatchService = new DispatchService(
    db,
    dispatchOutbox,
    dispatchGates,
    stubAssembler,
    agentConfigRepo,
    runRepo,
    nodeRunRepo,
    graphRunRepo,
    {
      graceWindowMs: () => 0,
      spawnRun: async (runId) => {
        const run = runRepo.getById(runId);
        if (run) await runDispatchService.drainWorkspace(run.workspace_id);
      },
      cancelRunningRun: async (runId) => {
        await runDispatchService.cancel(runId);
      },
    },
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
      sessionService,
      eligibilityEvaluator,
      dispatchService,
    },
    db,
  );

  return {
    db,
    skillRegistry,
    resolver,
    skillDelivery,
    auditService,
    spaceRepo,
    spaceService,
    repositoryRegistry,
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
    nodeRunRepo,
    graphRunRepo,
    projectService: new ProjectService(projectRepo, workspaceRepo, spaceRepo, auditService, db),
    workspaceService: new WorkspaceService(workspaceRepo, projectRepo, db),
    issueService: new IssueService(
      issueRepo,
      threadRepo,
      threadEventRepo,
      projectRepo,
      workflowTemplateRepo,
      validationPolicyRepo,
      spaceRepo,
      db,
    ),
    threadService: new ThreadService(threadRepo, threadEventRepo),
    adapterConfigService: new AdapterConfigService(
      agentConfigRepo,
      projectRepo,
      adapterRegistry,
      workspaceRepo,
      adapterWorkspaceStatusRepo,
      db,
      adapterProbeCoordinator,
      nodeRunRepo,
    ),
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
    graphRuntimeService,
    sessionService,
    eligibilityEvaluator,
    dispatchService,
    dispatchGates,
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

/** CLI versions the test-side EligibilityEvaluator treats as "running" — paired
 *  with ``seedCapabilityEvidence`` so evidence rows are version-matched. */
export const TEST_CLI_VERSIONS: Record<string, string> = {
  codex: "1.0.0",
  "claude-code": "1.0.0",
  opencode: "1.0.0",
  fake: "1.0.0",
};

export function seedCapabilityEvidence(
  db: Database.Database,
  input: {
    provider: string;
    capabilityKey: string;
    verdict: "supported" | "unsupported" | "unverified";
    probeResult: string;
    cliVersion?: string;
    probedAt?: string;
    missingReason?: string | null;
  },
): void {
  db.prepare(
    "INSERT OR REPLACE INTO adapter_capability_evidence (id, cli_provider, cli_version, capability_key, verdict, probe_command, probe_result, probed_at, missing_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    `ace_${input.provider}_${input.capabilityKey}`,
    input.provider,
    input.cliVersion ?? TEST_CLI_VERSIONS[input.provider] ?? "1.0.0",
    input.capabilityKey,
    input.verdict,
    "probe",
    input.probeResult,
    input.probedAt ?? new Date().toISOString(),
    input.missingReason ?? null,
  );
}

/** Seeds the capability set a dispatchable adapter needs: enumerated models,
 *  mappable depth tiers, session resume and native-memory isolation. */
export function seedDispatchableAdapter(
  db: Database.Database,
  provider: string,
  options: {
    cliVersion?: string;
    models?: string[];
    nativeMemoryVerdict?: "supported" | "unsupported" | "unverified";
  } = {},
): void {
  const cliVersion = options.cliVersion ?? TEST_CLI_VERSIONS[provider] ?? "1.0.0";
  const models = options.models ?? ["gpt-5"];
  seedCapabilityEvidence(db, {
    provider,
    capabilityKey: "model_enumeration",
    verdict: "supported",
    probeResult: JSON.stringify({ ok: true, models: models.map((id) => ({ id })) }),
    cliVersion,
  });
  seedCapabilityEvidence(db, {
    provider,
    capabilityKey: "depth",
    verdict: "supported",
    probeResult: JSON.stringify({ ok: true, native_levels: ["low", "medium", "high"] }),
    cliVersion,
  });
  seedCapabilityEvidence(db, {
    provider,
    capabilityKey: "session_resume",
    verdict: "supported",
    probeResult: JSON.stringify({ ok: true }),
    cliVersion,
  });
  const nativeMemoryVerdict = options.nativeMemoryVerdict ?? "supported";
  seedCapabilityEvidence(db, {
    provider,
    capabilityKey: "native_memory_isolation",
    verdict: nativeMemoryVerdict,
    probeResult: JSON.stringify(nativeMemoryVerdict === "supported" ? { ok: true } : { ok: false }),
    cliVersion,
  });
}
