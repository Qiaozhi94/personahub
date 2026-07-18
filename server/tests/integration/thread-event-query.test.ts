import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { ThreadEventType, ActorType } from "@personahub/shared/types";

describe("ThreadEventRepository Query Extension (T014)", () => {
  let services: TestServices;
  let tempDir: string;
  let threadId: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    threadId = issue.primary_thread_id!;

    services.threadEventRepo.create({
      thread_id: threadId, type: ThreadEventType.RunQueued, actor_type: ActorType.System,
      actor_id: null, payload: {}, evidence_refs: [],
    });
    services.threadEventRepo.create({
      thread_id: threadId, type: ThreadEventType.RunStarted, actor_type: ActorType.System,
      actor_id: null, payload: {}, evidence_refs: [],
    });
    services.threadEventRepo.create({
      thread_id: threadId, type: ThreadEventType.CommandStarted, actor_type: ActorType.System,
      actor_id: null, payload: {}, evidence_refs: [],
    });
    services.threadEventRepo.create({
      thread_id: threadId, type: ThreadEventType.CommandCompleted, actor_type: ActorType.System,
      actor_id: null, payload: {}, evidence_refs: [],
    });
    services.threadEventRepo.create({
      thread_id: threadId, type: ThreadEventType.RunCompleted, actor_type: ActorType.System,
      actor_id: null, payload: {}, evidence_refs: [],
    });
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("getById returns event by id", () => {
    const events = services.threadEventRepo.listByThread(threadId);
    const target = events.find(e => e.type === ThreadEventType.CommandStarted)!;
    const found = services.threadEventRepo.getById(target.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(target.id);
    expect(found!.type).toBe(ThreadEventType.CommandStarted);
  });

  it("getById returns null for nonexistent id", () => {
    expect(services.threadEventRepo.getById("nonexistent")).toBeNull();
  });

  it("listByThreadAndTypes filters by type", () => {
    const events = services.threadEventRepo.listByThreadAndTypes(threadId, [
      ThreadEventType.CommandStarted,
      ThreadEventType.CommandCompleted,
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe(ThreadEventType.CommandStarted);
    expect(events[1].type).toBe(ThreadEventType.CommandCompleted);
  });

  it("listByThreadAndTypes with cursor paginates", () => {
    const firstPage = services.threadEventRepo.listByThreadAndTypes(
      threadId,
      [ThreadEventType.CommandStarted, ThreadEventType.CommandCompleted],
      undefined,
      1,
    );
    expect(firstPage).toHaveLength(1);

    const secondPage = services.threadEventRepo.listByThreadAndTypes(
      threadId,
      [ThreadEventType.CommandStarted, ThreadEventType.CommandCompleted],
      firstPage[0].id,
      10,
    );
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0].type).toBe(ThreadEventType.CommandCompleted);
  });

  it("listByThreadAndTypes with empty types returns empty", () => {
    const events = services.threadEventRepo.listByThreadAndTypes(threadId, []);
    expect(events).toHaveLength(0);
  });

  it("listByThreadAndTypes with invalid cursor returns empty", () => {
    const events = services.threadEventRepo.listByThreadAndTypes(
      threadId,
      [ThreadEventType.CommandStarted],
      "nonexistent",
    );
    expect(events).toHaveLength(0);
  });
});
