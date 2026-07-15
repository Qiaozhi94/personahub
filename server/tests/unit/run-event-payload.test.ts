import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ThreadEventType, ActorType } from "@personahub/shared/types";

describe("ThreadEventService - Run Event Payloads", () => {
  let services: TestServices;
  let threadId: string;

  beforeEach(() => {
    services = createTestServices();
    const project = services.projectService.create("Test", "desc");
    const tempDir = createTempDir();
    services.workspaceService.bind(project.id, tempDir);
    const issue = services.issueService.create(project.id, {
      title: "Test Issue",
      goal: "Test goal",
    });
    threadId = issue.primary_thread!.id;
  });
  afterEach(() => disposeTestServices(services));

  it("writes run.queued event with correct fields", () => {
    const event = services.threadEventService.writeAndBroadcast(
      threadId,
      ThreadEventType.RunQueued,
      ActorType.System,
      null,
      {
        run_id: "run_001",
        issue_id: "iss_001",
        thread_id: threadId,
        workspace_id: "wsp_001",
        status: "queued",
      },
    );
    expect(event.type).toBe(ThreadEventType.RunQueued);
    expect(event.payload_json.run_id).toBe("run_001");
    expect(event.payload_json.status).toBe("queued");
  });

  it("writes run.output_truncated event with max_bytes", () => {
    const event = services.threadEventService.writeAndBroadcast(
      threadId,
      ThreadEventType.RunOutputTruncated,
      ActorType.System,
      null,
      {
        run_id: "run_001",
        max_bytes: 1048576,
      },
    );
    expect(event.type).toBe(ThreadEventType.RunOutputTruncated);
    expect(event.payload_json.max_bytes).toBe(1048576);
  });

  it("writes run.cancelled event with reason", () => {
    const event = services.threadEventService.writeAndBroadcast(
      threadId,
      ThreadEventType.RunCancelled,
      ActorType.System,
      null,
      {
        run_id: "run_001",
        reason: "user_cancelled",
      },
    );
    expect(event.type).toBe(ThreadEventType.RunCancelled);
    expect(event.payload_json.reason).toBe("user_cancelled");
  });

  it("writes issue.blocked event with previous_status and reason", () => {
    const event = services.threadEventService.writeAndBroadcast(
      threadId,
      ThreadEventType.IssueBlocked,
      ActorType.System,
      null,
      {
        issue_id: "iss_001",
        run_id: "run_001",
        previous_status: "Running",
        status: "Blocked",
        reason: "dangerous_git_operation",
      },
    );
    expect(event.type).toBe(ThreadEventType.IssueBlocked);
    expect(event.payload_json.previous_status).toBe("Running");
    expect(event.payload_json.reason).toBe("dangerous_git_operation");
  });

  it("writes escalation.triggered event with blocked_by and pre_execution_blocked", () => {
    const event = services.threadEventService.writeAndBroadcast(
      threadId,
      ThreadEventType.EscalationTriggered,
      ActorType.System,
      null,
      {
        run_id: "run_001",
        reason: "dangerous_git_operation",
        detected_operation: "git push",
        blocked_by: "credential_isolation",
        pre_execution_blocked: true,
        capability_note: "Push failed: no push credentials provisioned.",
      },
    );
    expect(event.type).toBe(ThreadEventType.EscalationTriggered);
    expect(event.payload_json.blocked_by).toBe("credential_isolation");
    expect(event.payload_json.pre_execution_blocked).toBe(true);
    expect(event.payload_json.capability_note).toContain("no push credentials");
  });

  it("persists events to SQLite in order", () => {
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunQueued, ActorType.System, null, { run_id: "run_001" },
    );
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunStarted, ActorType.System, null, { run_id: "run_001" },
    );
    services.threadEventService.writeAndBroadcast(
      threadId, ThreadEventType.RunCompleted, ActorType.System, null, { run_id: "run_001" },
    );

    const events = services.threadEventService.listByThread(threadId);
    expect(events.length).toBeGreaterThanOrEqual(4);
    const runEvents = events.filter(e => e.type !== ThreadEventType.IssueCreated);
    expect(runEvents[0]!.type).toBe(ThreadEventType.RunQueued);
    expect(runEvents[1]!.type).toBe(ThreadEventType.RunStarted);
    expect(runEvents[2]!.type).toBe(ThreadEventType.RunCompleted);
  });
});
