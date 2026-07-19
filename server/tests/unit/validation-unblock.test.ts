import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  IssueStatus,
  ValidationBlockReason,
  ThreadEventType,
  type ThreadEvent,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";
import { ValidationRecoveryActionService } from "../../src/services/validation/recovery-action.js";
import type { Issue } from "@personahub/shared/types";

function makeBlockedIssue(
  services: TestServices,
  tempDir: string,
  reason?: ValidationBlockReason,
): Issue {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });

  services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Inbox, IssueStatus.Blocked, {
    blocked_reason_code: reason ?? ValidationBlockReason.ValidatorUnavailable,
    blocked_reason_message: "No validator available",
  });

  return services.issueRepo.getById(issue.id)!;
}

describe("F004 T038: ValidationRecoveryActionService.unblock", () => {
  let services: TestServices;
  let tempDir: string;
  let service: ValidationRecoveryActionService;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
    service = new ValidationRecoveryActionService(
      services.issueRepo,
      services.validationTraceService,
      services.db,
    );
  });

  afterEach(() => disposeTestServices(services));

  describe("operator_note validation", () => {
    it("accepts non-empty note (1-4000 chars after trim)", () => {
      const issue = makeBlockedIssue(services, tempDir);
      const result = service.unblock(issue.id, "  Fixed the validator  ");
      expect(result.status).toBe(IssueStatus.Ready);
    });

    it("rejects empty note", () => {
      const issue = makeBlockedIssue(services, tempDir);
      try {
        service.unblock(issue.id, "");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.OPERATOR_NOTE_REQUIRED);
      }
    });

    it("rejects whitespace-only note", () => {
      const issue = makeBlockedIssue(services, tempDir);
      try {
        service.unblock(issue.id, "   ");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.OPERATOR_NOTE_REQUIRED);
      }
    });

    it("rejects note exceeding 4000 characters", () => {
      const issue = makeBlockedIssue(services, tempDir);
      try {
        service.unblock(issue.id, "x".repeat(4001));
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.OPERATOR_NOTE_REQUIRED);
      }
    });

    it("accepts note exactly 4000 characters", () => {
      const issue = makeBlockedIssue(services, tempDir);
      const result = service.unblock(issue.id, "x".repeat(4000));
      expect(result.status).toBe(IssueStatus.Ready);
    });
  });

  describe("issue state validation", () => {
    it("rejects unblock on non-Blocked issue", () => {
      const project = services.projectService.create("Test");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      try {
        service.unblock(issue.id, "fix");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.INVALID_ISSUE_TRANSITION);
      }
    });
  });

  describe("successful unblock", () => {
    it("CAS Blocked -> Ready and clears blocker columns", () => {
      const issue = makeBlockedIssue(services, tempDir);
      const result = service.unblock(issue.id, "Configured validator");

      expect(result.status).toBe(IssueStatus.Ready);
      expect(result.blocked_reason_code).toBeNull();
      expect(result.blocked_reason_message).toBeNull();

      const fresh = services.issueRepo.getById(issue.id);
      expect(fresh!.status).toBe(IssueStatus.Ready);
      expect(fresh!.blocked_reason_code).toBeNull();
      expect(fresh!.blocked_reason_message).toBeNull();
    });

    it("preserves validation_round_count", () => {
      const issue = makeBlockedIssue(services, tempDir);
      services.issueRepo.compareAndSetStatus(
        issue.id, IssueStatus.Blocked, IssueStatus.Blocked,
        { validation_round_count: 2 },
      );
      const result = service.unblock(issue.id, "fix");
      expect(result.validation_round_count).toBe(2);
    });

    it("writes issue.unblocked event with correct payload", () => {
      const issue = makeBlockedIssue(services, tempDir, ValidationBlockReason.RoundLimitReached);
      service.unblock(issue.id, "Reviewed and resolved.");

      const events = services.threadEventService.listByThread(issue.primary_thread_id!);
      const unblockEvent = events.find(
        (e) => e.type === ThreadEventType.IssueUnblocked,
      )!;

      expect(unblockEvent).toBeDefined();
      expect(unblockEvent.payload_json.operator_note).toBe("Reviewed and resolved.");
      expect(unblockEvent.payload_json.previous_status).toBe(IssueStatus.Blocked);
      expect(unblockEvent.payload_json.previous_block_reason).toBe(ValidationBlockReason.RoundLimitReached);
      expect(unblockEvent.payload_json.status).toBe(IssueStatus.Ready);
    });

    it("does not create any Run", () => {
      const issue = makeBlockedIssue(services, tempDir);
      const runsBefore = services.runRepo.listByIssue(issue.id).length;
      service.unblock(issue.id, "fix");
      const runsAfter = services.runRepo.listByIssue(issue.id).length;
      expect(runsAfter).toBe(runsBefore);
    });

    it("broadcasts after commit", () => {
      const issue = makeBlockedIssue(services, tempDir);
      const published: ThreadEvent[] = [];
      const unsub = services.eventBus.subscribe(issue.primary_thread_id!, (e) => published.push(e));

      service.unblock(issue.id, "fix");

      expect(published).toHaveLength(1);
      expect(published[0].payload_json.operator_note).toBe("fix");
      unsub();
    });
  });
});
