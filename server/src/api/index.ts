import type { FastifyInstance } from "fastify";
import { projectRoutes } from "./routes/projects.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { issueRoutes } from "./routes/issues.js";
import { threadRoutes } from "./routes/threads.js";
import { adapterRoutes } from "./routes/adapters.js";
import { runRoutes } from "./routes/runs.js";
import { traceRoutes } from "./routes/traces.js";
import { validationRoutes } from "./routes/validation.js";
import graphRoutes from "./routes/graph.js";
import intakeRoutes from "./routes/intake.js";
import { artifactRoutes } from "./routes/artifacts.js";
import { f012Routes } from "./routes/f012.js";
import { workflowTemplateRoutes } from "./routes/workflow-templates.js";
import { spaceRoutes } from "./routes/spaces.js";
import { skillRoutes } from "./routes/skills.js";
import { repositoryRoutes } from "./routes/repositories.js";
import { runtimeHealthRoutes } from "./routes/runtime-health.js";
import type { WorkflowTemplateAdminService } from "../services/workflow-template-admin.js";
import type { RuntimeHealthService } from "../services/runtime-health.js";
import type { ArtifactService } from "../services/artifact/service.js";
import type { ArtifactResolver } from "../services/artifact/resolver.js";
import type { GraphRuntimeService } from "../services/graph-runtime.js";
import type { GraphRunRepository } from "../repositories/graph-run.js";
import type { NodeRunRepository } from "../repositories/node-run.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { ThreadRepository } from "../repositories/thread.js";
import type { ProjectService } from "../services/project.js";
import type { SpaceService } from "../services/space.js";
import type { SkillRegistry } from "../services/skill-registry.js";
import type { EffectiveRequirementsResolver } from "../services/effective-requirements.js";
import type { SkillDeliveryService } from "../services/skill-delivery.js";
import type { RepositoryRegistry } from "../services/repository-registry.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { IssueService } from "../services/issue.js";
import type { ThreadService } from "../services/thread.js";
import type { AdapterConfigService } from "../services/adapter-config.js";
import type { RunService } from "../services/run.js";
import type { RunDispatchService } from "../services/run-dispatch.js";
import type { ThreadEventService } from "../services/thread-event.js";
import type { TraceQueryService } from "../services/trace-query.js";
import type { TraceExportService } from "../services/trace-export.js";
import type { EventBus } from "../runtime/event-bus.js";
import type { ValidationQueryService } from "../services/validation/query.js";
import type { ValidationRecoveryActionService } from "../services/validation/recovery-action.js";
import type { ValidationWorkflowService } from "../services/validation/workflow-service.js";
import type { EvidenceSummaryRepository } from "../repositories/evidence-summary.js";
import type { IntakeConfirmationRepository } from "../repositories/intake-confirmation.js";
import type { IssueRepository } from "../repositories/issue.js";
import type { RunRepository } from "../repositories/run.js";
import type { ThreadEventRepository } from "../repositories/thread-event.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { RoutingRecommendationService } from "../services/routing-recommendation-service.js";
import type { IntakeService } from "../services/intake-service.js";
import type { SessionService } from "../services/session-service.js";
import type { DispatchService } from "../services/dispatch-service.js";
import type { DispatchGateService } from "../services/dispatch-gate-service.js";
import type { EligibilityEvaluator } from "../services/eligibility-evaluator.js";
import type { RuntimeProjectionService } from "../services/runtime-projection.js";
import type Database from "better-sqlite3";

export interface Services {
  spaceService: SpaceService;
  skillRegistry: SkillRegistry;
  resolver: EffectiveRequirementsResolver;
  skillDelivery: SkillDeliveryService;
  repositoryRegistry: RepositoryRegistry;
  projectService: ProjectService;
  workspaceService: WorkspaceService;
  issueService: IssueService;
  threadService: ThreadService;
  adapterConfigService: AdapterConfigService;
  runService: RunService;
  runDispatchService: RunDispatchService;
  threadEventService: ThreadEventService;
  eventBus: EventBus;
  traceQueryService: TraceQueryService;
  traceExportService: TraceExportService;
  validationQueryService: ValidationQueryService;
  validationRecoveryActionService: ValidationRecoveryActionService;
  validationWorkflowService: ValidationWorkflowService;
  evidenceSummaryRepo: EvidenceSummaryRepository;
  issueRepo: IssueRepository;
  runRepo: RunRepository;
  graphRunRepo: GraphRunRepository;
  nodeRunRepo: NodeRunRepository;
  workspaceRepo: WorkspaceRepository;
  threadRepo: ThreadRepository;
  threadEventRepo: ThreadEventRepository;
  graphRuntimeService: GraphRuntimeService;
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  recommendationService: RoutingRecommendationService;
  intakeService: IntakeService;
  intakeConfirmationRepo: IntakeConfirmationRepository;
  workflowTemplateAdminService: WorkflowTemplateAdminService;
  runtimeHealthService: RuntimeHealthService;
  artifactService: ArtifactService;
  artifactResolver: ArtifactResolver;
  sessionService: SessionService;
  dispatchService: DispatchService;
  dispatchGateService: DispatchGateService;
  eligibilityEvaluator: EligibilityEvaluator;
  runtimeProjectionService: RuntimeProjectionService;
  db: Database.Database;
}

export function registerRoutes(app: FastifyInstance, services: Services): void {
  app.register(spaceRoutes, { spaceService: services.spaceService });
  app.register(repositoryRoutes, { repositoryRegistry: services.repositoryRegistry });
  app.register(skillRoutes, {
    skillRegistry: services.skillRegistry,
    resolver: services.resolver,
    delivery: services.skillDelivery,
    spaceService: services.spaceService,
    projectService: services.projectService,
  });
  app.register(projectRoutes, {
    projectService: services.projectService,
    repositoryRegistry: services.repositoryRegistry,
  });
  app.register(workspaceRoutes, { workspaceService: services.workspaceService });
  app.register(issueRoutes, { issueService: services.issueService, spaceService: services.spaceService });
  app.register(threadRoutes, {
    threadService: services.threadService,
    threadEventService: services.threadEventService,
    eventBus: services.eventBus,
  });
  app.register(adapterRoutes, { adapterConfigService: services.adapterConfigService });
  app.register(runRoutes, {
    runDispatchService: services.runDispatchService,
    runService: services.runService,
  });
  app.register(traceRoutes, {
    traceQueryService: services.traceQueryService,
    traceExportService: services.traceExportService,
  });
  app.register(validationRoutes, {
    validationQueryService: services.validationQueryService,
    validationRecoveryActionService: services.validationRecoveryActionService,
    validationWorkflowService: services.validationWorkflowService,
    evidenceSummaryRepo: services.evidenceSummaryRepo,
    issueRepo: services.issueRepo,
    runRepo: services.runRepo,
    runDispatchService: services.runDispatchService,
  });
  app.register(graphRoutes, {
    graphRunRepo: services.graphRunRepo,
    nodeRunRepo: services.nodeRunRepo,
    runRepo: services.runRepo,
    issueRepo: services.issueRepo,
    workspaceRepo: services.workspaceRepo,
    threadRepo: services.threadRepo,
    threadEventRepo: services.threadEventRepo,
    threadEventService: services.threadEventService,
    runDispatchService: services.runDispatchService,
    graphRuntimeService: services.graphRuntimeService,
    agentConfigRepo: services.agentConfigRepo,
    projectRepo: services.projectRepo,
    adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo,
    db: services.db,
  });
  app.register(intakeRoutes, {
    recommendationService: services.recommendationService,
    intakeService: services.intakeService,
  });
  app.register(workflowTemplateRoutes, {
    workflowTemplateAdminService: services.workflowTemplateAdminService,
  });
  app.register(runtimeHealthRoutes, {
    runtimeHealthService: services.runtimeHealthService,
    projectRepo: services.projectRepo,
  });
  app.register(artifactRoutes, {
    artifactService: services.artifactService,
    artifactResolver: services.artifactResolver,
  });
  app.register(f012Routes, {
    sessionService: services.sessionService,
    dispatchService: services.dispatchService,
    gateService: services.dispatchGateService,
    eligibilityEvaluator: services.eligibilityEvaluator,
    runtimeProjection: services.runtimeProjectionService,
  });
}
