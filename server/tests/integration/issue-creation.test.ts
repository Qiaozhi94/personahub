import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, ThreadType } from "@personahub/shared/types";

describe("Issue Creation Transaction", () => {
  let services: TestServices;
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Test Project");
    services.workspaceService.bind(project.id, tempDir);
    projectId = project.id;
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  it("creates Issue, primary Thread, and issue.created event atomically", () => {
    const result = services.issueService.create(projectId, {
      title: "Transaction Test",
      goal: "Verify atomic creation",
    });

    const issue = services.db.prepare("SELECT * FROM issues WHERE id = ?").get(result.issue.id) as Record<string, unknown>;
    expect(issue).toBeDefined();
    expect(issue.primary_thread_id).toBe(result.primary_thread.id);

    const thread = services.db.prepare("SELECT * FROM threads WHERE id = ?").get(result.primary_thread.id) as Record<string, unknown>;
    expect(thread).toBeDefined();
    expect(thread.thread_type).toBe(ThreadType.Primary);

    const events = services.db.prepare("SELECT * FROM thread_events WHERE thread_id = ?").all(result.primary_thread.id) as Record<string, unknown>[];
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("issue.created");
  });

  it("issue has correct default values", () => {
    const result = services.issueService.create(projectId, {
      title: "Defaults Test",
      goal: "Check defaults",
    });

    const issue = result.issue;
    expect(issue.status).toBe(IssueStatus.Inbox);
    expect(issue.issue_type).toBe("coding");
    expect(issue.priority).toBe("normal");
    expect(issue.validation_round_count).toBe(0);
    expect(issue.owner_agent_id).toBeNull();
    expect(issue.coordinator_agent_id).toBeNull();
    expect(issue.workflow_template_id).toBe("wft_coding_default");
    expect(issue.validation_policy_id).toBe("vpl_coding_default");
  });

  it("primary thread is unique per issue (DB constraint)", () => {
    const result = services.issueService.create(projectId, {
      title: "Uniqueness Test",
      goal: "G",
    });

    const now = new Date().toISOString();
    expect(() =>
      services.db.prepare("INSERT INTO threads (id, issue_id, thread_type, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("thr_duplicate", result.issue.id, "primary", "Duplicate", now, now),
    ).toThrow();
  });

  it("event_sequence is globally incrementing", () => {
    const r1 = services.issueService.create(projectId, { title: "A", goal: "G" });
    const r2 = services.issueService.create(projectId, { title: "B", goal: "G" });
    const r3 = services.issueService.create(projectId, { title: "C", goal: "G" });

    const e1 = services.threadService.getEvents(r1.primary_thread.id);
    const e2 = services.threadService.getEvents(r2.primary_thread.id);
    const e3 = services.threadService.getEvents(r3.primary_thread.id);

    expect(e1[0].event_sequence).toBeLessThan(e2[0].event_sequence);
    expect(e2[0].event_sequence).toBeLessThan(e3[0].event_sequence);
  });

  it("issue.created payload contains all required fields", () => {
    const result = services.issueService.create(projectId, {
      title: "Payload Test",
      goal: "G",
    });

    const events = services.threadService.getEvents(result.primary_thread.id);
    const payload = events[0].payload_json;

    expect(payload.issue_id).toBe(result.issue.id);
    expect(payload.project_id).toBe(projectId);
    expect(payload.workspace_id).toBe(result.issue.workspace_id);
    expect(payload.issue_type).toBe("coding");
    expect(payload.status).toBe("Inbox");
    expect(payload.workflow_template_id).toBe("wft_coding_default");
    expect(payload.validation_policy_id).toBe("vpl_coding_default");
    expect(payload.primary_thread_id).toBe(result.primary_thread.id);
  });

  it("multiple issues each get their own primary thread", () => {
    const r1 = services.issueService.create(projectId, { title: "A", goal: "G" });
    const r2 = services.issueService.create(projectId, { title: "B", goal: "G" });

    expect(r1.primary_thread.id).not.toBe(r2.primary_thread.id);
    expect(r1.issue.primary_thread_id).toBe(r1.primary_thread.id);
    expect(r2.issue.primary_thread_id).toBe(r2.primary_thread.id);
  });
});
