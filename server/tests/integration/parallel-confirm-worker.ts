import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadRepository } from "../../src/repositories/thread.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { WorkflowTemplateRepository } from "../../src/repositories/workflow-template.js";
import { ValidationPolicyRepository } from "../../src/repositories/validation-policy.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { RunRepository } from "../../src/repositories/run.js";
import { AdapterWorkspaceStatusRepository } from "../../src/repositories/adapter-workspace-status.js";
import { NodeRunRepository } from "../../src/repositories/node-run.js";
import { GraphRunRepository } from "../../src/repositories/graph-run.js";
import { AppSecretRepository } from "../../src/repositories/app-secret.js";
import { IntakeConfirmationRepository } from "../../src/repositories/intake-confirmation.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { IssueService } from "../../src/services/issue.js";
import { ConfirmationTokenService, loadOrCreateHmacSecret } from "../../src/services/confirmation-token.js";
import { RoutingRecommendationService } from "../../src/services/routing-recommendation-service.js";
import { IntakeService } from "../../src/services/intake-service.js";
import { GraphNodeInstructionBuilder } from "../../src/runtime/graph/instruction-builder.js";
import type { ConfirmationToken, ChosenPlan } from "@personahub/shared/types";

function waitFor(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const loop = setInterval(() => {
      if (existsSync(path)) {
        clearInterval(loop);
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(loop);
        return reject(new Error(`timeout waiting for ${path}`));
      }
    }, 10);
  });
}

async function main(): Promise<void> {
  const [dbPath, projectId, tokenFile, chosenFile, workerId, barrierDir] = process.argv.slice(2);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 10000");
  applyMigrations(db);

  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const threadEventRepo = new ThreadEventRepository(db);
  const workflowTemplateRepo = new WorkflowTemplateRepository(db);
  const validationPolicyRepo = new ValidationPolicyRepository(db);
  const agentConfigRepo = new AgentConfigRepository(db);
  const runRepo = new RunRepository(db);
  const adapterWorkspaceStatusRepo = new AdapterWorkspaceStatusRepository(db);
  const nodeRunRepo = new NodeRunRepository(db);
  const graphRunRepo = new GraphRunRepository(db);
  const intakeConfirmationRepo = new IntakeConfirmationRepository(db);

  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(threadEventRepo, eventBus);
  const issueService = new IssueService(
    issueRepo,
    threadRepo,
    threadEventRepo,
    projectRepo,
    workflowTemplateRepo,
    validationPolicyRepo,
    db,
  );
  const tokenService = new ConfirmationTokenService(loadOrCreateHmacSecret(new AppSecretRepository(db)));
  const recommendationService = new RoutingRecommendationService({
    deps: { projectRepo, agentConfigRepo, adapterWorkspaceStatusRepo, workflowTemplateRepo },
    tokenService,
  });
  const adapterDeps = { agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo };
  const intakeService = new IntakeService({
    db,
    tokenService,
    recommendationService,
    confirmationRepo: intakeConfirmationRepo,
    projectRepo,
    workspaceRepo,
    threadEventService,
    issueService,
    sequentialDeps: { runRepo, issueRepo, agentConfigRepo, threadEventService, adapterDeps },
    graphDeps: {
      graphRunRepo,
      nodeRunRepo,
      runRepo,
      issueRepo,
      threadEventService,
      adapterDeps,
      instructionBuilder: new GraphNodeInstructionBuilder(),
      drainWorkspace: async () => {},
    },
    drainWorkspace: async () => {},
    testHooks: {
      afterIdempotencyMiss: async () => {
        writeFileSync(join(barrierDir, `missed-${workerId}`), new Date().toISOString());
        await Promise.all([waitFor(join(barrierDir, "missed-0"), 30000), waitFor(join(barrierDir, "missed-1"), 30000)]);
      },
    },
  });

  const token = JSON.parse(readFileSync(tokenFile, "utf8")) as ConfirmationToken;
  const chosen = JSON.parse(readFileSync(chosenFile, "utf8")) as ChosenPlan;

  writeFileSync(join(barrierDir, `ready-${workerId}`), new Date().toISOString());
  await waitFor(join(barrierDir, "go"), 30000);

  try {
    const result = await intakeService.confirm(projectId, token, chosen);
    process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
  } catch (err) {
    const code = (err as { code?: string }).code ?? "UNKNOWN";
    process.stdout.write(JSON.stringify({ ok: false, code, message: String((err as Error).message) }) + "\n");
  } finally {
    db.close();
  }
}

void main();
