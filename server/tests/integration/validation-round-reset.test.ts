import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, ValidationBlockReason, ThreadEventType } from "@personahub/shared/types";

function blockedIssue(services: TestServices, tempDir: string, reason: ValidationBlockReason, roundCount: number) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.db.prepare("UPDATE issues SET status = ?, blocked_reason_code = ?, blocked_reason_message = ?, validation_round_count = ? WHERE id = ?")
    .run(IssueStatus.Blocked, reason, "blocked message", roundCount, issue.id);
  return services.issueRepo.getById(issue.id)!;
}

describe("T094 explicit round reset", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("resets round count to 0 while keeping the Issue Blocked", () => {
    const issue = blockedIssue(services, tempDir, ValidationBlockReason.RoundLimitReached, 3);

    const result = services.validationRecoveryActionService.resetRounds(issue.id, "Granting more rounds");

    expect(result.status).toBe(IssueStatus.Blocked);
    expect(result.validation_round_count).toBe(0);
    const fresh = services.issueRepo.getById(issue.id)!;
    expect(fresh.status).toBe(IssueStatus.Blocked);
    expect(fresh.validation_round_count).toBe(0);
    expect(fresh.blocked_reason_code).toBe(ValidationBlockReason.RoundLimitReached);
    const events = services.threadEventRepo.listByThreadAndTypes(issue.primary_thread_id!, [ThreadEventType.ValidationRoundReset], undefined, 10);
    expect(events.length).toBe(1);
    expect(events[0].payload_json.previous_round_count).toBe(3);
    expect(events[0].payload_json.operator_note).toBe("Granting more rounds");
  });

  it("rejects an empty operator note", () => {
    const issue = blockedIssue(services, tempDir, ValidationBlockReason.RoundLimitReached, 3);
    expect(() => services.validationRecoveryActionService.resetRounds(issue.id, "   ")).toThrow();
    expect(services.issueRepo.getById(issue.id)!.validation_round_count).toBe(3);
  });

  it("rejects non round_limit_reached blockers", () => {
    const issue = blockedIssue(services, tempDir, ValidationBlockReason.EvidenceMissing, 1);
    expect(() => services.validationRecoveryActionService.resetRounds(issue.id, "note")).toThrow();
    expect(services.issueRepo.getById(issue.id)!.validation_round_count).toBe(1);
  });

  it("rejects when the Issue is not Blocked", () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
    expect(() => services.validationRecoveryActionService.resetRounds(issue.id, "note")).toThrow();
  });

  it("ordinary unblock keeps the round count (contrast with reset)", () => {
    const issue = blockedIssue(services, tempDir, ValidationBlockReason.RoundLimitReached, 3);
    const result = services.validationRecoveryActionService.unblock(issue.id, "Manual override");
    expect(result.status).toBe(IssueStatus.Ready);
    expect(result.validation_round_count).toBe(3);
  });
});
