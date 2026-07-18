import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { openDatabase } from "../../src/db/index.js";
import { RunRepository } from "../../src/repositories/run.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadRepository } from "../../src/repositories/thread.js";
import { WorkflowTemplateRepository } from "../../src/repositories/workflow-template.js";
import { ValidationPolicyRepository } from "../../src/repositories/validation-policy.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { WorkspaceLockService } from "../../src/services/workspace-lock.js";
import { StaleRecoveryService } from "../../src/services/stale-recovery.js";
import { RunStatus, FailureReason, AdapterStatus, IssueStatus, IssueType, IssuePriority, ThreadType, WorkspaceLockState } from "@personahub/shared/types";

describe("Backend Restart Recovery (T055)", () => {
  let services: TestServices;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    dbPath = `${tempDir}/test-restart.db`;
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("simulates backend restart: stale Run recovered, lock released", async () => {
    const dbPath = `${tempDir}/test-restart.db`;
    const db = openDatabase(dbPath);

    const projectRepo = new ProjectRepository(db);
    const workspaceRepo = new WorkspaceRepository(db);
    const issueRepo = new IssueRepository(db);
    const threadRepo = new ThreadRepository(db);
    const threadEventRepo = new ThreadEventRepository(db);
    const workflowRepo = new WorkflowTemplateRepository(db);
    const validationRepo = new ValidationPolicyRepository(db);
    const agentConfigRepo = new AgentConfigRepository(db);
    const runRepo = new RunRepository(db);

    const project = projectRepo.create("Test", "desc");
    const workspace = workspaceRepo.create({
      project_id: project.id,
      local_path: tempDir,
      local_path_normalized: tempDir,
      git_branch: null,
      lock_state: WorkspaceLockState.Idle,
    });
    projectRepo.updateDefaultWorkspace(project.id, workspace.id, new Date().toISOString());

    const issue = issueRepo.create({
      project_id: project.id,
      workspace_id: workspace.id,
      issue_type: IssueType.Coding,
      workflow_template_id: workflowRepo.getDefault()!.id,
      validation_policy_id: validationRepo.getDefault()!.id,
      title: "Test",
      goal: "Goal",
      status: IssueStatus.Running,
      priority: IssuePriority.Normal,
      labels: [],
    });
    const thread = threadRepo.create({ issue_id: issue.id, thread_type: ThreadType.Primary, title: "Test" });
    issueRepo.updatePrimaryThread(issue.id, thread.id, new Date().toISOString());

    const adapter = agentConfigRepo.create({
      project_id: project.id,
      name: "Test",
      role: "implementation",
      cli_provider: "fake",
      command: "fake",
      args: [],
      capability_tags: [],
      default_model: null,
      status: AdapterStatus.Available,
    });

    const run = runRepo.create({
      issue_id: issue.id,
      thread_id: thread.id,
      workspace_id: workspace.id,
      adapter_config_id: adapter.id,
      instructions: "test",
      status: RunStatus.Running,
    });
    workspaceRepo.acquireLock(workspace.id, run.id);

    expect(workspaceRepo.getById(workspace.id)!.lock_state).toBe("locked");

    db.close();

    const reopenedDb = openDatabase(dbPath);
    const reopenedRunRepo = new RunRepository(reopenedDb);
    const reopenedWorkspaceRepo = new WorkspaceRepository(reopenedDb);
    const reopenedThreadEventRepo = new ThreadEventRepository(reopenedDb);

    const eventBus = new EventBus();
    const threadEventService = new ThreadEventService(reopenedThreadEventRepo, eventBus);
    const lockService = new WorkspaceLockService(reopenedWorkspaceRepo);
    const staleRecovery = new StaleRecoveryService(
      reopenedRunRepo, reopenedWorkspaceRepo, threadEventService, lockService,
    );

    await staleRecovery.runAll();

    const recoveredRun = reopenedRunRepo.getById(run.id);
    expect(recoveredRun!.status).toBe(RunStatus.Interrupted);
    expect(recoveredRun!.failure_reason).toBe(FailureReason.ServerRestarted);

    const recoveredWorkspace = reopenedWorkspaceRepo.getById(workspace.id);
    expect(recoveredWorkspace!.lock_state).toBe("idle");
    expect(recoveredWorkspace!.locked_by_run_id).toBeNull();

    reopenedDb.close();
  });

  it("simulates restart with no stale runs: no changes", async () => {
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });

    const beforeStatus = services.issueRepo.getById(issue.id)!.status;
    await services.staleRecoveryService.runAll();
    const afterStatus = services.issueRepo.getById(issue.id)!.status;

    expect(afterStatus).toBe(beforeStatus);
  });
});
