import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import { ArtifactRepository } from "../src/repositories/artifact.js";
import { EventBus } from "../src/runtime/event-bus.js";
import { ThreadEventService } from "../src/services/thread-event.js";
import { ArtifactArchive } from "../src/services/artifact/archive.js";
import { ArtifactService } from "../src/services/artifact/service.js";
import { ArtifactResolver } from "../src/services/artifact/resolver.js";
import {
  AdapterStatus,
  IssuePriority,
  IssueStatus,
  IssueType,
  RunStatus,
  ThreadType,
  WorkspaceLockState,
} from "@personahub/shared/types";

/**
 * Shared harness for the F010 resolver / provenance suites: a file-backed DB
 * with a full project -> workspace -> issue -> thread -> run graph, plus the
 * artifact service/resolver stack and a thread-scoped event recorder.
 */

export interface ArtifactGraphFixture {
  tempDir: string;
  dbPath: string;
  workspaceDir: string;
  archive: ArtifactArchive;
  graph: { issueId: string; threadId: string; runIds: string[] };
  /** Every DB handle opened against this fixture; disposal closes them before
   *  removing the temp tree — Windows refuses to delete an open file (R4-021). */
  openDbs: Array<ReturnType<typeof openDatabase>>;
}

export interface ArtifactSession {
  db: ReturnType<typeof openDatabase>;
  artifactRepo: ArtifactRepository;
  service: ArtifactService;
  resolver: ArtifactResolver;
  events: Array<{ type: string; thread_id: string; payload: Record<string, unknown> }>;
}

export function makeArtifactGraphFixture(runs = 2): ArtifactGraphFixture {
  const tempDir = mkdtempSync(join(tmpdir(), "f010-artifact-"));
  const workspaceDir = join(tempDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  const db = openDatabase(join(tempDir, "test.db"));
  const now = new Date().toISOString();
  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const workflowRepo = new WorkflowTemplateRepository(db);
  const validationRepo = new ValidationPolicyRepository(db);
  const agentConfigRepo = new AgentConfigRepository(db);
  const runRepo = new RunRepository(db);

  const defaultSpace = db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string };
  const project = projectRepo.create("Artifact Provenance", null, defaultSpace.id);
  const workspace = workspaceRepo.create({
    project_id: project.id,
    local_path: workspaceDir,
    local_path_normalized: workspaceDir,
    git_branch: null,
    lock_state: WorkspaceLockState.Idle,
  });
  projectRepo.updateDefaultWorkspace(project.id, workspace.id, now);
  const issue = issueRepo.create({
    space_id: project.space_id,
    project_id: project.id,
    workspace_id: workspace.id,
    issue_type: IssueType.Coding,
    workflow_template_id: workflowRepo.getDefault()!.id,
    validation_policy_id: validationRepo.getDefault()!.id,
    title: "Provenance",
    goal: "Goal",
    status: IssueStatus.Running,
    priority: IssuePriority.Normal,
    labels: [],
  });
  const thread = threadRepo.create({ issue_id: issue.id, thread_type: ThreadType.Primary, title: "Primary" });
  issueRepo.updatePrimaryThread(issue.id, thread.id, now);
  const adapter = agentConfigRepo.create({
    project_id: project.id,
    name: "Adapter",
    role: "implementation",
    cli_provider: "fake",
    command: "fake",
    args: [],
    capability_tags: [],
    default_model: null,
    status: AdapterStatus.Available,
  });
  const runIds: string[] = [];
  for (let i = 0; i < runs; i++) {
    const run = runRepo.create({
      issue_id: issue.id,
      thread_id: thread.id,
      workspace_id: workspace.id,
      adapter_config_id: adapter.id,
      instructions: `run ${i}`,
      status: RunStatus.Completed,
    });
    runIds.push(run.id);
  }
  db.close();
  return {
    tempDir,
    dbPath: join(tempDir, "test.db"),
    workspaceDir,
    archive: new ArtifactArchive(join(tempDir, "archive"), join(tempDir, "archive-temp")),
    graph: { issueId: issue.id, threadId: thread.id, runIds },
    openDbs: [],
  };
}

export function disposeArtifactFixture(fixture: ArtifactGraphFixture): void {
  for (const db of fixture.openDbs) {
    try {
      db.close();
    } catch {
      // already closed by the test itself
    }
  }
  fixture.openDbs.length = 0;
  rmSync(fixture.tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export function openArtifactSession(fixture: ArtifactGraphFixture): ArtifactSession {
  const db = openDatabase(fixture.dbPath);
  fixture.openDbs.push(db);
  const artifactRepo = new ArtifactRepository(db);
  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(new ThreadEventRepository(db), eventBus);
  const events: Array<{ type: string; thread_id: string; payload: Record<string, unknown> }> = [];
  eventBus.subscribe(fixture.graph.threadId, (event) =>
    events.push({ type: event.type, thread_id: event.thread_id, payload: event.payload_json }),
  );
  const service = new ArtifactService({
    db,
    artifactRepo,
    issueRepo: new IssueRepository(db),
    threadRepo: new ThreadRepository(db),
    runRepo: new RunRepository(db),
    workspaceRepo: new WorkspaceRepository(db),
    threadEventService,
    archive: fixture.archive,
    maxBytes: 1024 * 1024,
  });
  const resolver = new ArtifactResolver({ artifactRepo, archive: fixture.archive, threadEventService });
  return { db, artifactRepo, service, resolver, events };
}

export function writeWorkspaceFile(fixture: ArtifactGraphFixture, rel: string, content: string): void {
  const abs = join(fixture.workspaceDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}
