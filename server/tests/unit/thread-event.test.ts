import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ThreadEventType, ActorType } from "@personahub/shared/types";

describe("ThreadEvent and ThreadService", () => {
  let services: TestServices;
  let tempDir: string;
  let threadId: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const result = services.issueService.create(project.id, {
      title: "Test Issue",
      goal: "Test goal",
    });
    threadId = result.primary_thread.id;
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  describe("issue.created event", () => {
    it("writes issue.created event to primary thread", () => {
      const events = services.threadService.getEvents(threadId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(ThreadEventType.IssueCreated);
    });

    it("event payload contains required fields", () => {
      const events = services.threadService.getEvents(threadId);
      const payload = events[0].payload_json;

      expect(payload).toHaveProperty("issue_id");
      expect(payload).toHaveProperty("project_id");
      expect(payload).toHaveProperty("workspace_id");
      expect(payload).toHaveProperty("issue_type", "coding");
      expect(payload).toHaveProperty("status", "Inbox");
      expect(payload).toHaveProperty("workflow_template_id", "wft_coding_default");
      expect(payload).toHaveProperty("validation_policy_id", "vpl_coding_default");
      expect(payload).toHaveProperty("primary_thread_id");
    });

    it("event has user actor_type and null actor_id", () => {
      const events = services.threadService.getEvents(threadId);
      expect(events[0].actor_type).toBe(ActorType.User);
      expect(events[0].actor_id).toBeNull();
    });

    it("event has empty evidence_refs", () => {
      const events = services.threadService.getEvents(threadId);
      expect(events[0].evidence_refs).toEqual([]);
    });
  });

  describe("event_sequence ordering", () => {
    it("first event has sequence 1", () => {
      const events = services.threadService.getEvents(threadId);
      expect(events[0].event_sequence).toBe(1);
    });

    it("events are ordered by event_sequence ascending", () => {
      const project = services.projectService.create("Test2");
      services.workspaceService.bind(project.id, tempDir);

      const result1 = services.issueService.create(project.id, { title: "A", goal: "G" });
      const result2 = services.issueService.create(project.id, { title: "B", goal: "G" });

      const events1 = services.threadService.getEvents(result1.primary_thread.id);
      const events2 = services.threadService.getEvents(result2.primary_thread.id);

      expect(events1[0].event_sequence).toBeLessThan(events2[0].event_sequence);
    });

    it("getNextSequence increases after inserting events", () => {
      const seq1 = services.threadEventRepo.getNextSequence();
      services.threadEventRepo.create({
        thread_id: threadId,
        type: ThreadEventType.IssueCreated,
        actor_type: ActorType.User,
        actor_id: null,
        payload: { test: true },
        evidence_refs: [],
      });
      const seq2 = services.threadEventRepo.getNextSequence();
      expect(seq2).toBeGreaterThan(seq1);
    });
  });

  describe("after_event_id cursor", () => {
    it("returns events after given event id", () => {
      const project = services.projectService.create("Test2");
      services.workspaceService.bind(project.id, tempDir);
      const result = services.issueService.create(project.id, { title: "A", goal: "G" });

      const allEvents = services.threadService.getEvents(result.primary_thread.id);
      const afterEvents = services.threadService.getEvents(
        result.primary_thread.id,
        allEvents[0].id,
      );

      expect(afterEvents).toHaveLength(0);
    });

    it("returns empty for unknown after_event_id", () => {
      const afterEvents = services.threadService.getEvents(threadId, "evt_unknown");
      expect(afterEvents).toHaveLength(0);
    });
  });

  describe("ThreadService.get", () => {
    it("returns thread by id", () => {
      const thread = services.threadService.get(threadId);
      expect(thread.id).toBe(threadId);
      expect(thread.thread_type).toBe("primary");
    });

    it("throws THREAD_NOT_FOUND for unknown id", () => {
      expect(() => services.threadService.get("thr_unknown")).toThrowError(
        expect.objectContaining({ code: "THREAD_NOT_FOUND" }),
      );
    });
  });
});
