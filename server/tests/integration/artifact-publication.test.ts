import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/db/index.js";
import { ProjectRepository } from "../../src/repositories/project.js";
import { WorkspaceRepository } from "../../src/repositories/workspace.js";
import { IssueRepository } from "../../src/repositories/issue.js";
import { ThreadRepository } from "../../src/repositories/thread.js";
import { ThreadEventRepository } from "../../src/repositories/thread-event.js";
import { WorkflowTemplateRepository } from "../../src/repositories/workflow-template.js";
import { ValidationPolicyRepository } from "../../src/repositories/validation-policy.js";
import { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { RunRepository } from "../../src/repositories/run.js";
import { ArtifactRepository } from "../../src/repositories/artifact.js";
import { EventBus } from "../../src/runtime/event-bus.js";
import { ThreadEventService } from "../../src/services/thread-event.js";
import { ArtifactService, type ArtifactPublicationTestHooks } from "../../src/services/artifact/service.js";
import { ArtifactResolver } from "../../src/services/artifact/resolver.js";
import { ArtifactArchive } from "../../src/services/artifact/archive.js";
import { ArtifactOrphanSweeper } from "../../src/services/artifact/sweeper.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import {
  AdapterStatus,
  IssuePriority,
  IssueStatus,
  IssueType,
  RunStatus,
  ThreadEventType,
  ThreadType,
  WorkspaceLockState,
  type CreateArtifactInput,
} from "@personahub/shared/types";

// F010 T010/T020 (AC-001/AC-002): the publication protocol. Every crash case
// goes through ArtifactService's named testHooks, then drops the instance and
// reopens the same dbPath — the restart pattern of restart-recovery.test.ts.
// Tests never re-enact publication steps themselves (design §8).

const MAX_BYTES = 1024 * 1024;

interface Fixture {
  tempDir: string;
  dbPath: string;
  workspaceDir: string;
  archive: ArtifactArchive;
  graph: { issueId: string; threadId: string; runId: string };
}

function seedGraph(db: ReturnType<typeof openDatabase>, workspaceDir: string): Fixture["graph"] {
  const projectRepo = new ProjectRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const issueRepo = new IssueRepository(db);
  const threadRepo = new ThreadRepository(db);
  const workflowRepo = new WorkflowTemplateRepository(db);
  const validationRepo = new ValidationPolicyRepository(db);
  const agentConfigRepo = new AgentConfigRepository(db);
  const runRepo = new RunRepository(db);
  const now = new Date().toISOString();

  const project = projectRepo.create("Artifact Publication", null);
  const workspace = workspaceRepo.create({
    project_id: project.id,
    local_path: workspaceDir,
    local_path_normalized: workspaceDir,
    git_branch: null,
    lock_state: WorkspaceLockState.Idle,
  });
  projectRepo.updateDefaultWorkspace(project.id, workspace.id, now);
  const issue = issueRepo.create({
    project_id: project.id,
    workspace_id: workspace.id,
    issue_type: IssueType.Coding,
    workflow_template_id: workflowRepo.getDefault()!.id,
    validation_policy_id: validationRepo.getDefault()!.id,
    title: "Publication",
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
  const run = runRepo.create({
    issue_id: issue.id,
    thread_id: thread.id,
    workspace_id: workspace.id,
    adapter_config_id: adapter.id,
    instructions: "produce",
    status: RunStatus.Completed,
  });
  return { issueId: issue.id, threadId: thread.id, runId: run.id };
}

function makeFixture(): Fixture {
  const tempDir = mkdtempSync(join(tmpdir(), "f010-publication-"));
  const workspaceDir = join(tempDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  const db = openDatabase(join(tempDir, "test.db"));
  const graph = seedGraph(db, workspaceDir);
  db.close();
  return {
    tempDir,
    dbPath: join(tempDir, "test.db"),
    workspaceDir,
    archive: new ArtifactArchive(join(tempDir, "archive"), join(tempDir, "archive-temp")),
    graph,
  };
}

interface Session {
  db: ReturnType<typeof openDatabase>;
  artifactRepo: ArtifactRepository;
  service: ArtifactService;
  resolver: ArtifactResolver;
  received: Array<{ type: ThreadEventType; payload: Record<string, unknown> }>;
}

function openSession(
  fixture: Fixture,
  hooks?: ArtifactPublicationTestHooks,
  maxBytes = MAX_BYTES,
  log?: (info: Record<string, unknown>) => void,
): Session {
  const db = openDatabase(fixture.dbPath);
  const artifactRepo = new ArtifactRepository(db);
  const eventBus = new EventBus();
  const threadEventService = new ThreadEventService(new ThreadEventRepository(db), eventBus);
  const received: Array<{ type: ThreadEventType; payload: Record<string, unknown> }> = [];
  eventBus.subscribe(fixture.graph.threadId, (event) =>
    received.push({ type: event.type, payload: event.payload_json }),
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
    maxBytes,
    testHooks: hooks,
    log,
  });
  return {
    db,
    artifactRepo,
    service,
    resolver: new ArtifactResolver({ artifactRepo, archive: fixture.archive, threadEventService, log }),
    received,
  };
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inlineCreateInput(fixture: Fixture, artifactId: string, content = "# report v1"): CreateArtifactInput {
  return {
    artifact_id: artifactId,
    issue_id: fixture.graph.issueId,
    thread_id: fixture.graph.threadId,
    type: "report",
    title: "Report",
    storage: { storage_kind: "inline_markdown", inline_content: content },
    source_run_id: fixture.graph.runId,
    created_by: "tester",
    idempotency_key: `key-${artifactId}`,
  };
}

function fileCreateInput(
  fixture: Fixture,
  artifactId: string,
  sourceRel = "docs/report.md",
  content = "file body v1",
): CreateArtifactInput {
  const abs = join(fixture.workspaceDir, sourceRel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return {
    artifact_id: artifactId,
    issue_id: fixture.graph.issueId,
    thread_id: fixture.graph.threadId,
    type: "report",
    title: "Report",
    storage: { storage_kind: "workspace_file", source_path: sourceRel },
    source_run_id: fixture.graph.runId,
    created_by: "tester",
    idempotency_key: `key-${artifactId}`,
  };
}

let fixture: Fixture;

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  rmSync(fixture.tempDir, { recursive: true, force: true });
});

describe("F010 inline publication", () => {
  it("creates revision 1, sets the pointer, and broadcasts only after commit", () => {
    const session = openSession(fixture);
    const result = session.service.createArtifact(inlineCreateInput(fixture, "art_inline1"));

    expect(result.replayed).toBe(false);
    expect(result.revision.revision).toBe(1);
    expect(result.revision.content_hash).toBe(sha256("# report v1"));
    const artifact = session.artifactRepo.getArtifact("art_inline1")!;
    expect(artifact.current_revision).toBe(1);
    expect(session.received).toEqual([
      {
        type: ThreadEventType.ArtifactCreated,
        payload: {
          artifact_id: "art_inline1",
          revision: 1,
          issue_id: fixture.graph.issueId,
          source_run_id: fixture.graph.runId,
        },
      },
    ]);
    session.db.close();
  });

  it("replays the same idempotency key without a second revision or event", () => {
    const session = openSession(fixture);
    const first = session.service.createArtifact(inlineCreateInput(fixture, "art_replay"));
    const replay = session.service.createArtifact(inlineCreateInput(fixture, "art_replay"));
    expect(replay.replayed).toBe(true);
    expect(replay.revision.revision).toBe(first.revision.revision);
    expect(session.received).toHaveLength(1);
    session.db.close();
  });

  it("rejects the same key with different content (no silent reuse)", () => {
    const session = openSession(fixture);
    session.service.createArtifact(inlineCreateInput(fixture, "art_conflict"));
    try {
      session.service.createArtifact(inlineCreateInput(fixture, "art_conflict", "# different"));
      expect.unreachable("fingerprint mismatch must conflict");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_IDEMPOTENCY_CONFLICT);
    }
    session.db.close();
  });

  it("revises via CAS and keeps history immutable; a stale expected revision conflicts", () => {
    const session = openSession(fixture);
    session.service.createArtifact(inlineCreateInput(fixture, "art_cas"));
    const revised = session.service.reviseArtifact("art_cas", {
      storage: { storage_kind: "inline_markdown", inline_content: "# report v2" },
      created_by: "tester",
      idempotency_key: "key-cas-2",
      expected_current_revision: 1,
    });
    expect(revised.revision.revision).toBe(2);
    expect(session.artifactRepo.getArtifact("art_cas")!.current_revision).toBe(2);
    // history does not drift
    expect(session.artifactRepo.getRevision("art_cas", 1)!.inline_content).toBe("# report v1");

    try {
      session.service.reviseArtifact("art_cas", {
        storage: { storage_kind: "inline_markdown", inline_content: "# report v3" },
        created_by: "tester",
        idempotency_key: "key-cas-3",
        expected_current_revision: 1,
      });
      expect.unreachable("stale expected revision must conflict");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_REVISION_CONFLICT);
    }
    expect(session.artifactRepo.getArtifact("art_cas")!.current_revision).toBe(2);
    expect(session.received.map((e) => e.type)).toEqual([
      ThreadEventType.ArtifactCreated,
      ThreadEventType.ArtifactRevised,
    ]);
    session.db.close();
  });

  it("rejects an oversized inline payload before any artifact or revision exists", () => {
    const session = openSession(fixture, undefined, 16);
    try {
      session.service.createArtifact(inlineCreateInput(fixture, "art_big_inline", "x".repeat(64)));
      expect.unreachable("oversize inline must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_TOO_LARGE);
    }
    expect(session.artifactRepo.getArtifact("art_big_inline")).toBeNull();
    session.db.close();
  });

  it("retires once and stays retired; retired artifacts refuse new revisions", () => {
    const session = openSession(fixture);
    session.service.createArtifact(inlineCreateInput(fixture, "art_retire"));
    expect(session.service.retireArtifact("art_retire").state).toBe("retired");
    // idempotent second retire
    expect(session.service.retireArtifact("art_retire").state).toBe("retired");
    try {
      session.service.reviseArtifact("art_retire", {
        storage: { storage_kind: "inline_markdown", inline_content: "# v2" },
        created_by: "tester",
        idempotency_key: "key-retire-2",
        expected_current_revision: 1,
      });
      expect.unreachable("retired artifacts must refuse revisions");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_RETIRED);
    }
    session.db.close();
  });
});

describe("F010 operation observability", () => {
  it("logs revision and duration on success and a stable reason code on failure, never body content", () => {
    const logs: Array<Record<string, unknown>> = [];
    const session = openSession(fixture, undefined, MAX_BYTES, (info) => logs.push(info));

    session.service.createArtifact(inlineCreateInput(fixture, "art_logged", "# logged body"));
    try {
      session.service.createArtifact({ ...inlineCreateInput(fixture, "art_logged_fail"), issue_id: "iss_missing" });
      expect.unreachable("missing issue must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ISSUE_NOT_FOUND);
    }

    const success = logs.find((entry) => entry.event === "artifact.create" && entry.reason_code === undefined);
    expect(success).toMatchObject({ artifact_id: "art_logged", revision: 1 });
    expect(typeof success?.duration_ms).toBe("number");

    const failure = logs.find(
      (entry) => entry.event === "artifact.create" && entry.reason_code === ErrorCode.ISSUE_NOT_FOUND,
    );
    expect(failure).toMatchObject({ artifact_id: "art_logged_fail", revision: null });

    session.resolver.resolveForReadRef("artifact:art_logged@1");
    const read = logs.find((entry) => entry.event === "artifact.resolve");
    expect(read).toMatchObject({ artifact_id: "art_logged", revision: 1 });
    expect(typeof read?.duration_ms).toBe("number");

    expect(JSON.stringify(logs)).not.toContain("logged body");
    session.db.close();
  });
});

// The hook-crash matrix: crash at each seam, reopen, and verify the consumer-
// visible world contains either nothing or a complete published revision.
describe("F010 file publication crash matrix", () => {
  const crashCases: Array<[keyof ArtifactPublicationTestHooks, "temp" | "archive-only" | "rollback"]> = [
    ["afterTempWrite", "temp"],
    ["afterFsync", "temp"],
    ["afterRename", "archive-only"],
    ["afterRevisionInsert", "rollback"],
    ["afterPointerCas", "rollback"],
  ];

  for (const [hook, expectation] of crashCases) {
    it(`crash at ${hook} leaves no consumable revision after restart`, () => {
      const session = openSession(fixture, {
        [hook]: () => {
          throw new Error("crash");
        },
      } as ArtifactPublicationTestHooks);
      expect(() => session.service.createArtifact(fileCreateInput(fixture, "art_crash"))).toThrowError("crash");
      session.db.close();

      // restart on the same dbPath with fresh instances, then assert through
      // the resolver — the only consumer-visible read path (design §8)
      const reopened = openSession(fixture);
      const entity = reopened.resolver.getEntity("art_crash");
      expect(entity.status).toBe("missing");
      expect((entity as { code: ErrorCode }).code).toBe(ErrorCode.ARTIFACT_NOT_FOUND);
      expect(reopened.artifactRepo.getArtifact("art_crash")).toBeNull();
      expect(reopened.artifactRepo.getRevision("art_crash", 1)).toBeNull();

      if (expectation === "archive-only") {
        // the rename already happened: an invisible archive orphan exists and
        // only the sweeper may remove it (after its grace period)
        expect(readdirSync(fixture.archive.rootDir)).toHaveLength(1);
      }
      if (expectation === "temp") {
        // pre-rename crash: no archive entry may exist
        expect(existsSync(fixture.archive.rootDir) ? readdirSync(fixture.archive.rootDir) : []).toHaveLength(0);
      }
      // the crash happened before commit: nothing was broadcast
      expect(reopened.received).toHaveLength(0);
      reopened.db.close();
    });
  }

  it("crash after commit keeps the complete published revision but drops the broadcast", () => {
    const session = openSession(fixture, {
      afterCommit: () => {
        throw new Error("crash-after-commit");
      },
    });
    expect(() => session.service.createArtifact(fileCreateInput(fixture, "art_aftercommit"))).toThrowError(
      "crash-after-commit",
    );
    session.db.close();

    const reopened = openSession(fixture);
    expect(reopened.artifactRepo.getArtifact("art_aftercommit")!.current_revision).toBe(1);
    // resolver-visible: the committed revision reads back complete
    const viaResolver = reopened.resolver.getRevisionRead("art_aftercommit", 1);
    expect(viaResolver.status).toBe("ready");
    const revision = reopened.artifactRepo.getRevision("art_aftercommit", 1)!;
    expect(revision.archive_relative_path).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    // committed revision must have a complete archive whose bytes hash to the manifest
    const bytes = fixture.archive.readArchive(revision.archive_relative_path!)!;
    expect(sha256(bytes)).toBe(revision.content_hash);
    // committed fact, but the crash cut the broadcast: nothing was emitted
    expect(reopened.received).toHaveLength(0);
    reopened.db.close();
  });

  it("publishes a file revision end-to-end and revises it to a second archive object", () => {
    const session = openSession(fixture);
    const created = session.service.createArtifact(fileCreateInput(fixture, "art_file"));
    expect(created.revision.storage_kind).toBe("workspace_file");
    expect(created.revision.source_relative_path).toBe("docs/report.md");
    expect(created.revision.archive_relative_path).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(created.revision.archive_relative_path).toBe(
      `${created.revision.content_hash.slice(0, 2)}/${created.revision.content_hash}`,
    );

    writeFileSync(join(fixture.workspaceDir, "docs/report.md"), "file body v2");
    const revised = session.service.reviseArtifact("art_file", {
      storage: { storage_kind: "workspace_file", source_path: "docs/report.md" },
      created_by: "tester",
      idempotency_key: "key-file-2",
      expected_current_revision: 1,
    });
    expect(revised.revision.revision).toBe(2);
    expect(revised.revision.archive_relative_path).not.toBe(created.revision.archive_relative_path);
    // v1 archive bytes are immutable
    expect(fixture.archive.readArchive(created.revision.archive_relative_path!)!.toString()).toBe("file body v1");
    session.db.close();
  });

  it("shares the archive entry when the target exists with identical bytes", () => {
    const session = openSession(fixture);
    const first = session.service.createArtifact(fileCreateInput(fixture, "art_share1"));
    const second = session.service.createArtifact(
      fileCreateInput(fixture, "art_share2", "docs/copy.md", "file body v1"),
    );
    // same bytes -> same content address, one archive object for both revisions
    expect(second.revision.archive_relative_path).toBe(first.revision.archive_relative_path);
    expect(sha256(fixture.archive.readArchive(first.revision.archive_relative_path!)!)).toBe(
      first.revision.content_hash,
    );
    session.db.close();
  });

  it("rejects a divergent target at the content address (Win32 target-exists protocol)", () => {
    // Squat different bytes at a content address, then publish that content:
    // the archive must refuse instead of clobbering or double-writing.
    const staged = fixture.archive.stageInline("squat me", "art-squat");
    const squatDir = join(fixture.archive.rootDir, staged.hash.slice(0, 2));
    mkdirSync(squatDir, { recursive: true });
    writeFileSync(join(squatDir, staged.hash), "different bytes entirely");
    try {
      fixture.archive.publishStaged(staged);
      expect.unreachable("divergent target must collide");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_ARCHIVE_COLLISION);
    }
    // the divergent target survived untouched
    expect(readFileSync(join(squatDir, staged.hash)).toString()).toBe("different bytes entirely");
    // and the published protocol succeeds once the target matches the bytes
    writeFileSync(join(squatDir, staged.hash), "squat me");
    expect(fixture.archive.publishStaged(staged)).toBe(`${staged.hash.slice(0, 2)}/${staged.hash}`);
  });

  it("keeps a stable error code when a rename fails for a non-race reason", () => {
    const staged = fixture.archive.stageInline("rename me", "art-rename-fail");
    fixture.archive.removeStaged(staged.tempPath); // staged source vanished -> rename ENOENT
    try {
      fixture.archive.publishStaged(staged);
      expect.unreachable("a missing staged source must not be misread as a race");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_ARCHIVE_WRITE_FAILED);
      expect((error as AppError).details?.cause).toBeDefined();
    }
  });
});

describe("F010 path boundary", () => {
  it("rejects a source that escapes the workspace via symlink after realpath", () => {
    const outside = join(fixture.tempDir, "outside-secret.md");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(fixture.workspaceDir, "innocent-link.md"));
    const session = openSession(fixture);
    try {
      session.service.createArtifact({
        artifact_id: "art_escape",
        issue_id: fixture.graph.issueId,
        thread_id: fixture.graph.threadId,
        type: "report",
        title: "Escape",
        storage: { storage_kind: "workspace_file", source_path: "innocent-link.md" },
        created_by: "tester",
        idempotency_key: "key-escape",
      });
      expect.unreachable("symlink escape must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_SOURCE_OUTSIDE_ROOT);
    }
    expect(session.artifactRepo.getArtifact("art_escape")).toBeNull();
    session.db.close();
  });

  it("rejects a missing source file without creating an artifact", () => {
    const session = openSession(fixture);
    try {
      session.service.createArtifact({
        artifact_id: "art_missing",
        issue_id: fixture.graph.issueId,
        thread_id: fixture.graph.threadId,
        type: "report",
        title: "Missing",
        storage: { storage_kind: "workspace_file", source_path: "nope.md" },
        created_by: "tester",
        idempotency_key: "key-missing",
      });
      expect.unreachable("missing source must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.WORKSPACE_PATH_NOT_FOUND);
    }
    session.db.close();
  });

  it("honors the size cap on the file path with no temp file left behind", () => {
    writeFileSync(join(fixture.workspaceDir, "big.md"), "x".repeat(4096));
    const session = openSession(fixture, undefined, 1024);
    try {
      session.service.createArtifact({
        artifact_id: "art_big",
        issue_id: fixture.graph.issueId,
        thread_id: fixture.graph.threadId,
        type: "report",
        title: "Big",
        storage: { storage_kind: "workspace_file", source_path: "big.md" },
        created_by: "tester",
        idempotency_key: "key-big",
      });
      expect.unreachable("oversize must be rejected");
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.ARTIFACT_TOO_LARGE);
    }
    expect(existsSync(fixture.archive.tempDir) ? readdirSync(fixture.archive.tempDir) : []).toHaveLength(0);
    session.db.close();
  });
});

describe("F010 orphan sweep", () => {
  it("deletes only unreferenced, well-formed, grace-expired files under the lease", () => {
    const session = openSession(fixture);
    const created = session.service.createArtifact(fileCreateInput(fixture, "art_keep"));
    session.db.close();

    // orphan: correct shape, unreferenced, older than the grace period
    const orphanRel = "ff/" + "a".repeat(64);
    mkdirSync(join(fixture.archive.rootDir, "ff"), { recursive: true });
    const orphanPath = join(fixture.archive.rootDir, "ff", "a".repeat(64));
    writeFileSync(orphanPath, "orphan");
    utimesSync(orphanPath, new Date(Date.now() - 7_200_000), new Date(Date.now() - 7_200_000));
    // young orphan: unreferenced but inside the grace window
    mkdirSync(join(fixture.archive.rootDir, "fe"), { recursive: true });
    writeFileSync(join(fixture.archive.rootDir, "fe", "b".repeat(64)), "young");
    // malformed name: never swept
    writeFileSync(join(fixture.archive.rootDir, "garbage.txt"), "junk");
    // stale temp blob
    mkdirSync(fixture.archive.tempDir, { recursive: true });
    const oldTemp = join(fixture.archive.tempDir, "art-stage-old");
    writeFileSync(oldTemp, "stale temp");
    utimesSync(oldTemp, new Date(Date.now() - 7_200_000), new Date(Date.now() - 7_200_000));

    const db = openDatabase(fixture.dbPath);
    const sweeper = new ArtifactOrphanSweeper({ artifactRepo: new ArtifactRepository(db), archive: fixture.archive });
    const result = sweeper.sweep();
    expect(result.ran).toBe(true);
    expect(result.deletedArchives).toEqual([orphanRel]);
    expect(result.deletedTemps).toEqual([oldTemp]);
    // the referenced archive survived
    const kept = new ArtifactRepository(db).getRevision("art_keep", 1)!;
    expect(fixture.archive.readArchive(kept.archive_relative_path!)!.toString()).toBe("file body v1");
    expect(kept.archive_relative_path).toBe(created.revision.archive_relative_path);
    expect(existsSync(join(fixture.archive.rootDir, "garbage.txt"))).toBe(true);
    db.close();
  });

  it("skips when another owner holds a live lease", () => {
    const db = openDatabase(fixture.dbPath);
    const repo = new ArtifactRepository(db);
    expect(repo.tryAcquireLease("archive-maintenance", "someone-else", Date.now(), 60_000)).toBe(true);
    const sweeper = new ArtifactOrphanSweeper({ artifactRepo: repo, archive: fixture.archive });
    expect(sweeper.sweep().ran).toBe(false);
    db.close();
  });
});
