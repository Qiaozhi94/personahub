import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { IssueStatus, IssueType, IssuePriority } from "@personahub/shared/types";

describe("IssueService", () => {
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

  describe("create - validation", () => {
    it("rejects empty title", () => {
      expect(() =>
        services.issueService.create(projectId, { title: "", goal: "goal" }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.ISSUE_TITLE_REQUIRED }));
    });

    it("rejects whitespace-only title", () => {
      expect(() =>
        services.issueService.create(projectId, { title: "   ", goal: "goal" }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.ISSUE_TITLE_REQUIRED }));
    });

    it("rejects empty goal", () => {
      expect(() =>
        services.issueService.create(projectId, { title: "Title", goal: "" }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.ISSUE_GOAL_REQUIRED }));
    });

    it("rejects invalid priority", () => {
      expect(() =>
        services.issueService.create(projectId, { title: "T", goal: "G", priority: "urgent" }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.ISSUE_PRIORITY_INVALID }));
    });

    it("rejects unknown project", () => {
      expect(() =>
        services.issueService.create("prj_unknown", { title: "T", goal: "G" }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.PROJECT_NOT_FOUND }));
    });
  });

  describe("create - without workspace", () => {
    it("rejects issue creation when project has no workspace", () => {
      const project = services.projectService.create("No Workspace Project");
      expect(() =>
        services.issueService.create(project.id, { title: "T", goal: "G" }),
      ).toThrowError(expect.objectContaining({ code: ErrorCode.PROJECT_WORKSPACE_REQUIRED }));
    });
  });

  describe("create - success", () => {
    it("creates issue with Inbox status", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      expect(result.issue.status).toBe(IssueStatus.Inbox);
      expect(result.issue.status).not.toBe("Ready");
      expect(result.issue.status).not.toBe("Running");
    });

    it("creates issue with coding type", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      expect(result.issue.issue_type).toBe(IssueType.Coding);
    });

    it("defaults priority to normal", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      expect(result.issue.priority).toBe(IssuePriority.Normal);
    });

    it("accepts low priority", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
        priority: IssuePriority.Low,
      });

      expect(result.issue.priority).toBe(IssuePriority.Low);
    });

    it("accepts high priority", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
        priority: IssuePriority.High,
      });

      expect(result.issue.priority).toBe(IssuePriority.High);
    });

    it("attaches default workflow template and validation policy", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      expect(result.issue.workflow_template_id).toBe("wft_coding_default");
      expect(result.issue.validation_policy_id).toBe("vpl_coding_default");
    });

    it("creates primary thread and backfills primary_thread_id", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      expect(result.primary_thread.id).toMatch(/^thr_/);
      expect(result.primary_thread.thread_type).toBe("primary");
      expect(result.issue.primary_thread_id).toBe(result.primary_thread.id);
      expect(result.issue.primary_thread!.id).toBe(result.primary_thread.id);
    });

    it("sets validation_round_count to 0", () => {
      const result = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      expect(result.issue.validation_round_count).toBe(0);
    });
  });

  describe("create - labels processing", () => {
    it("trims label whitespace", () => {
      const result = services.issueService.create(projectId, {
        title: "T",
        goal: "G",
        labels: ["  spaced  "],
      });

      expect(result.issue.labels).toEqual(["spaced"]);
    });

    it("removes empty labels", () => {
      const result = services.issueService.create(projectId, {
        title: "T",
        goal: "G",
        labels: ["valid", "", "   ", "also-valid"],
      });

      expect(result.issue.labels).toEqual(["valid", "also-valid"]);
    });

    it("deduplicates labels preserving first occurrence", () => {
      const result = services.issueService.create(projectId, {
        title: "T",
        goal: "G",
        labels: ["first", "second", "first", "third", "second"],
      });

      expect(result.issue.labels).toEqual(["first", "second", "third"]);
    });

    it("handles undefined labels", () => {
      const result = services.issueService.create(projectId, {
        title: "T",
        goal: "G",
      });

      expect(result.issue.labels).toEqual([]);
    });
  });

  describe("list", () => {
    it("returns empty list for project with no issues", () => {
      const issues = services.issueService.list(projectId);
      expect(issues).toHaveLength(0);
    });

    it("returns created issues", () => {
      services.issueService.create(projectId, { title: "A", goal: "G" });
      services.issueService.create(projectId, { title: "B", goal: "G" });
      const issues = services.issueService.list(projectId);
      expect(issues).toHaveLength(2);
    });
  });

  describe("get", () => {
    it("returns issue with primary thread", () => {
      const created = services.issueService.create(projectId, {
        title: "Test Issue",
        goal: "Test goal",
      });

      const issue = services.issueService.get(created.issue.id);
      expect(issue.id).toBe(created.issue.id);
      expect(issue.primary_thread).not.toBeNull();
      expect(issue.primary_thread!.id).toBe(created.primary_thread.id);
    });

    it("throws ISSUE_NOT_FOUND for unknown id", () => {
      expect(() => services.issueService.get("iss_unknown")).toThrowError(
        expect.objectContaining({ code: ErrorCode.ISSUE_NOT_FOUND }),
      );
    });
  });
});
