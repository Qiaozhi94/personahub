import type { FastifyInstance } from "fastify";
import { projectRoutes } from "./routes/projects.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { issueRoutes } from "./routes/issues.js";
import { threadRoutes } from "./routes/threads.js";
import { adapterRoutes } from "./routes/adapters.js";
import { runRoutes } from "./routes/runs.js";
import { traceRoutes } from "./routes/traces.js";
import { validationRoutes } from "./routes/validation.js";
import type { ProjectService } from "../services/project.js";
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
import type { IssueRepository } from "../repositories/issue.js";
import type { RunRepository } from "../repositories/run.js";

export interface Services {
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
}

export function registerRoutes(app: FastifyInstance, services: Services): void {
  app.register(projectRoutes, { projectService: services.projectService });
  app.register(workspaceRoutes, { workspaceService: services.workspaceService });
  app.register(issueRoutes, { issueService: services.issueService });
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
}
