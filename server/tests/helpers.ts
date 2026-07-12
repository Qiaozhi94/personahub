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
import { ProjectService } from "../src/services/project.js";
import { WorkspaceService } from "../src/services/workspace.js";
import { IssueService } from "../src/services/issue.js";
import { ThreadService } from "../src/services/thread.js";

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
  projectService: ProjectService;
  workspaceService: WorkspaceService;
  issueService: IssueService;
  threadService: ThreadService;
}

export function createTestServices(): TestServices {
  const db = createTestDb();
  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const threadEventRepo = new ThreadEventRepository(db);
  const workflowTemplateRepo = new WorkflowTemplateRepository(db);
  const validationPolicyRepo = new ValidationPolicyRepository(db);

  return {
    db,
    projectRepo,
    workspaceRepo,
    issueRepo,
    threadRepo,
    threadEventRepo,
    workflowTemplateRepo,
    validationPolicyRepo,
    projectService: new ProjectService(projectRepo, workspaceRepo),
    workspaceService: new WorkspaceService(workspaceRepo, projectRepo, db),
    issueService: new IssueService(
      issueRepo, threadRepo, threadEventRepo,
      projectRepo, workflowTemplateRepo, validationPolicyRepo, db,
    ),
    threadService: new ThreadService(threadRepo, threadEventRepo),
  };
}

export function disposeTestServices(services: TestServices): void {
  services.db.close();
}
