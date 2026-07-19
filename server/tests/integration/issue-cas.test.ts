import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus } from "@personahub/shared/types";
import { ValidationBlockReason } from "@personahub/shared/types";
import { AdapterStatus, RunStatus } from "@personahub/shared/types";

describe("IssueRepository CAS and validation recovery queries", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  function createIssue(status: IssueStatus = IssueStatus.Inbox) {
    const project = services.projectService.create("Test Project");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    if (status !== IssueStatus.Inbox) {
      services.issueRepo.updateStatus(issue.id, { status, updatedAt: new Date().toISOString() });
    }
    return { project, issue };
  }

  function createAdapter(projectId: string, role: string = "implementation") {
    return services.agentConfigRepo.create({
      project_id: projectId,
      name: `Adapter-${role}`,
      role,
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [],
      default_model: "gpt-5",
      status: AdapterStatus.Available,
    });
  }

  function insertValidatorRun(issueId: string, threadId: string, workspaceId: string, adapterId: string, status: RunStatus) {
    const now = new Date().toISOString();
    const id = `run_vtest_${Math.random().toString(36).slice(2)}`;
    services.db.prepare(
      `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'validator', 'system', ?, ?)`,
    ).run(id, issueId, threadId, workspaceId, adapterId, status, "validate", now, now);
    return id;
  }

  describe("compareAndSetStatus", () => {
    it("transitions when expected status matches", () => {
      const { issue } = createIssue(IssueStatus.Running);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Running,
        IssueStatus.Validating,
      );

      expect(result.success).toBe(true);
      expect(result.issue).not.toBeNull();
      expect(result.issue!.status).toBe(IssueStatus.Validating);
    });

    it("fails when expected status does not match (lost update)", () => {
      const { issue } = createIssue(IssueStatus.Running);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Ready,
        IssueStatus.Validating,
      );

      expect(result.success).toBe(false);
      expect(result.issue).toBeNull();

      const unchanged = services.issueRepo.getById(issue.id);
      expect(unchanged!.status).toBe(IssueStatus.Running);
    });

    it("increments validation_round_count via patch", () => {
      const { issue } = createIssue(IssueStatus.Validating);
      expect(issue.validation_round_count).toBe(0);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Validating,
        IssueStatus.Running,
        { validation_round_count: 1 },
      );

      expect(result.success).toBe(true);
      expect(result.issue!.validation_round_count).toBe(1);
    });

    it("sets blocker columns via patch", () => {
      const { issue } = createIssue(IssueStatus.Validating);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Validating,
        IssueStatus.Blocked,
        {
          blocked_reason_code: ValidationBlockReason.RoundLimitReached,
          blocked_reason_message: "Max validation rounds reached.",
        },
      );

      expect(result.success).toBe(true);
      expect(result.issue!.status).toBe(IssueStatus.Blocked);
      expect(result.issue!.blocked_reason_code).toBe(ValidationBlockReason.RoundLimitReached);
      expect(result.issue!.blocked_reason_message).toBe("Max validation rounds reached.");
    });

    it("clears blocker columns via patch with null", () => {
      const { issue } = createIssue(IssueStatus.Blocked);
      services.issueRepo.compareAndSetStatus(issue.id, IssueStatus.Blocked, IssueStatus.Blocked, {
        blocked_reason_code: ValidationBlockReason.EvidenceMissing,
        blocked_reason_message: "missing test",
      });

      const result = services.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Blocked,
        IssueStatus.Ready,
        { blocked_reason_code: null, blocked_reason_message: null },
      );

      expect(result.success).toBe(true);
      expect(result.issue!.status).toBe(IssueStatus.Ready);
      expect(result.issue!.blocked_reason_code).toBeNull();
      expect(result.issue!.blocked_reason_message).toBeNull();
    });

    it("combines round increment and blocker clear in single CAS", () => {
      const { issue } = createIssue(IssueStatus.Validating);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id,
        IssueStatus.Validating,
        IssueStatus.Running,
        {
          validation_round_count: 2,
          blocked_reason_code: null,
          blocked_reason_message: null,
        },
      );

      expect(result.success).toBe(true);
      expect(result.issue!.validation_round_count).toBe(2);
      expect(result.issue!.blocked_reason_code).toBeNull();
    });

    it("is atomic - concurrent CAS only one succeeds", () => {
      const { issue } = createIssue(IssueStatus.Running);

      const first = services.issueRepo.compareAndSetStatus(
        issue.id, IssueStatus.Running, IssueStatus.Validating,
      );
      const second = services.issueRepo.compareAndSetStatus(
        issue.id, IssueStatus.Running, IssueStatus.Done,
      );

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);

      const current = services.issueRepo.getById(issue.id);
      expect(current!.status).toBe(IssueStatus.Validating);
    });

    it("returns issue with all mapped fields including blocker", () => {
      const { issue } = createIssue(IssueStatus.Validating);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id, IssueStatus.Validating, IssueStatus.Blocked,
        {
          blocked_reason_code: ValidationBlockReason.ValidatorUnavailable,
          blocked_reason_message: "No validator configured.",
        },
      );

      expect(result.issue).not.toBeNull();
      expect(result.issue!.id).toBe(issue.id);
      expect(result.issue!.title).toBe("Test");
      expect(result.issue!.labels).toEqual([]);
      expect(result.issue!.updated_at).toBeTruthy();
    });

    it("updates updated_at on successful transition", () => {
      const { issue } = createIssue(IssueStatus.Running);

      const result = services.issueRepo.compareAndSetStatus(
        issue.id, IssueStatus.Running, IssueStatus.Validating,
      );

      expect(result.success).toBe(true);
      expect(result.issue!.status).toBe(IssueStatus.Validating);
      expect(result.issue!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("listValidatingWithoutActiveValidator", () => {
    it("returns empty list when no issues are Validating", () => {
      createIssue(IssueStatus.Running);
      createIssue(IssueStatus.Inbox);

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      expect(issues).toHaveLength(0);
    });

    it("returns Validating issue with no active validator run", () => {
      const { issue } = createIssue(IssueStatus.Validating);

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe(issue.id);
      expect(issues[0].status).toBe(IssueStatus.Validating);
    });

    it("excludes Validating issue that has an active (queued) validator run", () => {
      const { project, issue } = createIssue(IssueStatus.Validating);
      const adapter = createAdapter(project.id, "validator");

      insertValidatorRun(issue.id, issue.primary_thread!.id, issue.workspace_id, adapter.id, RunStatus.Queued);

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      expect(issues).toHaveLength(0);
    });

    it("excludes Validating issue that has an active (running) validator run", () => {
      const { project, issue } = createIssue(IssueStatus.Validating);
      const adapter = createAdapter(project.id, "validator");

      insertValidatorRun(issue.id, issue.primary_thread!.id, issue.workspace_id, adapter.id, RunStatus.Running);

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      expect(issues).toHaveLength(0);
    });

    it("includes Validating issue whose validator run is terminal (completed)", () => {
      const { project, issue } = createIssue(IssueStatus.Validating);
      const adapter = createAdapter(project.id, "validator");

      insertValidatorRun(issue.id, issue.primary_thread!.id, issue.workspace_id, adapter.id, RunStatus.Completed);

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe(issue.id);
    });

    it("includes Validating issue whose only runs are implementation role", () => {
      const { project, issue } = createIssue(IssueStatus.Validating);
      const adapter = createAdapter(project.id, "implementation");

      services.runRepo.create({
        issue_id: issue.id,
        thread_id: issue.primary_thread!.id,
        workspace_id: issue.workspace_id,
        adapter_config_id: adapter.id,
        instructions: "do work",
        status: RunStatus.Running,
      });

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      expect(issues).toHaveLength(1);
    });

    it("handles multiple Validating issues, only returns those without active validator", () => {
      const { project: p1, issue: i1 } = createIssue(IssueStatus.Validating);
      const { project: p2, issue: i2 } = createIssue(IssueStatus.Validating);
      const { issue: i3 } = createIssue(IssueStatus.Validating);

      const valAdapter1 = createAdapter(p1.id, "validator");
      insertValidatorRun(i1.id, i1.primary_thread!.id, i1.workspace_id, valAdapter1.id, RunStatus.Queued);

      const valAdapter2 = createAdapter(p2.id, "validator");
      insertValidatorRun(i2.id, i2.primary_thread!.id, i2.workspace_id, valAdapter2.id, RunStatus.Completed);

      const issues = services.issueRepo.listValidatingWithoutActiveValidator();
      const issueIds = issues.map((i) => i.id);
      expect(issueIds).toContain(i2.id);
      expect(issueIds).toContain(i3.id);
      expect(issueIds).not.toContain(i1.id);
    });
  });
});
