import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openDatabase } from "../../src/db/index.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadRepository } from "../../src/repositories/thread.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { WorkflowTemplateRepository } from "../../src/repositories/workflow-template.js";
import { ValidationPolicyRepository } from "../../src/repositories/validation-policy.js";
import { ProjectService } from "../../src/services/project.js";
import { WorkspaceService } from "../../src/services/workspace.js";
import { IssueService } from "../../src/services/issue.js";
import { ThreadService } from "../../src/services/thread.js";
import { mkdirSync } from "node:fs";

describe("Persistence / Restart Recovery", () => {
  let dbPath: string;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    const testRoot = mkdtempSync(join(tmpdir(), "personahub-persist-"));
    dbPath = join(testRoot, "test.db");
    tempDir = testRoot;
    workspaceDir = join(testRoot, "workspace");
    mkdirSync(workspaceDir);
    mkdirSync(join(workspaceDir, ".git"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createServices(db: Database.Database) {
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
      issueService: new IssueService(issueRepo, threadRepo, threadEventRepo, projectRepo, workflowTemplateRepo, validationPolicyRepo, db),
      threadService: new ThreadService(threadRepo, threadEventRepo),
    };
  }

  it("data persists across database close and reopen", () => {
    let savedProjectId: string;
    let savedIssueId: string;
    let savedThreadId: string;

    {
      const db = openDatabase(dbPath);
      const services = createServices(db);

      const project = services.projectService.create("Persistent Project");
      savedProjectId = project.id;

      services.workspaceService.bind(project.id, workspaceDir);

      const issue = services.issueService.create(project.id, {
        title: "Persistent Issue",
        goal: "Survives restart",
      });
      savedIssueId = issue.issue.id;
      savedThreadId = issue.primary_thread.id;

      db.close();
    }

    {
      const db = openDatabase(dbPath);
      const services = createServices(db);

      const projects = services.projectService.list();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(savedProjectId);
      expect(projects[0].name).toBe("Persistent Project");

      const project = services.projectService.get(savedProjectId);
      expect(project.default_workspace).not.toBeNull();
      expect(project.default_workspace!.local_path).toBe(workspaceDir);

      const issues = services.issueService.list(savedProjectId);
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe(savedIssueId);

      const issue = services.issueService.get(savedIssueId);
      expect(issue.primary_thread_id).toBe(savedThreadId);
      expect(issue.primary_thread).not.toBeNull();
      expect(issue.primary_thread!.id).toBe(savedThreadId);

      const events = services.threadService.getEvents(savedThreadId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("issue.created");
      expect(events[0].payload_json.issue_id).toBe(savedIssueId);

      db.close();
    }
  });

  it("migration is idempotent on reopen", () => {
    {
      const db = openDatabase(dbPath);
      db.close();
    }

    {
      const db = openDatabase(dbPath);
      const version = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
      expect(version.v).toBe(7);
      db.close();
    }
  });

  it("seed data exists after reopen", () => {
    {
      const db = openDatabase(dbPath);
      db.close();
    }

    {
      const db = openDatabase(dbPath);
      const wf = db.prepare("SELECT * FROM workflow_templates WHERE id = 'wft_coding_default'").get();
      expect(wf).toBeDefined();

      const vp = db.prepare("SELECT * FROM validation_policies WHERE id = 'vpl_coding_default'").get();
      expect(vp).toBeDefined();

      db.close();
    }
  });

  it("multiple projects and issues persist across restart", () => {
    let savedIds: { projectId: string; issueId: string }[] = [];

    {
      const db = openDatabase(dbPath);
      const services = createServices(db);

      for (let i = 0; i < 3; i++) {
        const project = services.projectService.create(`Project ${i}`);
        services.workspaceService.bind(project.id, workspaceDir);
        const issue = services.issueService.create(project.id, {
          title: `Issue ${i}`,
          goal: `Goal ${i}`,
        });
        savedIds.push({ projectId: project.id, issueId: issue.issue.id });
      }

      db.close();
    }

    {
      const db = openDatabase(dbPath);
      const services = createServices(db);

      const projects = services.projectService.list();
      expect(projects).toHaveLength(3);

      for (const { projectId, issueId } of savedIds) {
        const issue = services.issueService.get(issueId);
        expect(issue.project_id).toBe(projectId);
        expect(issue.primary_thread).not.toBeNull();
      }

      db.close();
    }
  });
});
