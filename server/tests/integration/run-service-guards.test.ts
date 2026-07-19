import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, AdapterStatus } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";

function setupIssueWithAdapter(services: TestServices, tempDir: string, status: IssueStatus = IssueStatus.Inbox) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  if (status !== IssueStatus.Inbox) {
    services.issueRepo.updateStatus(issue.id, { status, updatedAt: new Date().toISOString() });
  }
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation",
    cli_provider: "codex", command: "codex", args: [], capability_tags: [],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

describe("RunService F004 public create guards", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });
  afterEach(() => disposeTestServices(services));

  describe("public create forces implementation role", () => {
    it("creates run with role=implementation, workflow_step=implementation, dispatch_source=user_explicit", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.runService.create(issue.id, adapter.id, "do work");

      expect(run.role).toBe(RunRole.Implementation);
      expect(run.workflow_step).toBe("implementation");
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.validation_round).toBeNull();
    });

    it("auto-snapshots adapter identity from config at creation", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.runService.create(issue.id, adapter.id, "do work");

      expect(run.adapter_identity).not.toBeNull();
      expect(run.adapter_identity!.adapter_config_id).toBe(adapter.id);
      expect(run.adapter_identity!.name).toBe("Impl");
      expect(run.adapter_identity!.cli_provider).toBe("codex");
      expect(run.adapter_identity!.default_model).toBe("gpt-5");
    });

    it("identity snapshot is independent of later adapter config changes", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.runService.create(issue.id, adapter.id, "do work");
      const originalIdentity = run.adapter_identity;

      services.agentConfigRepo.update(adapter.id, {
        name: "Renamed", default_model: "gpt-6",
        updated_at: new Date().toISOString(),
      });

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.adapter_identity).toEqual(originalIdentity);
      expect(refetched!.adapter_identity!.name).toBe("Impl");
      expect(refetched!.adapter_identity!.default_model).toBe("gpt-5");
    });

    it("new run has has_final_message=false", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.runService.create(issue.id, adapter.id, "do work");

      expect(run.has_final_message).toBe(false);
    });
  });

  describe("public create rejects invalid issue states", () => {
    it("succeeds on Inbox issue", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Inbox);
      expect(() => services.runService.create(issue.id, adapter.id, "do")).not.toThrow();
    });

    it("succeeds on Ready issue", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Ready);
      expect(() => services.runService.create(issue.id, adapter.id, "do")).not.toThrow();
    });

    it("succeeds on Running issue", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Running);
      expect(() => services.runService.create(issue.id, adapter.id, "do")).not.toThrow();
    });

    it("rejects Validating issue with INVALID_ISSUE_TRANSITION", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Validating);
      try {
        services.runService.create(issue.id, adapter.id, "do");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.INVALID_ISSUE_TRANSITION);
      }
    });

    it("rejects Done issue with INVALID_ISSUE_TRANSITION", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Done);
      try {
        services.runService.create(issue.id, adapter.id, "do");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.INVALID_ISSUE_TRANSITION);
      }
    });

    it("rejects Blocked issue with INVALID_ISSUE_TRANSITION", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Blocked);
      try {
        services.runService.create(issue.id, adapter.id, "do");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.INVALID_ISSUE_TRANSITION);
      }
    });

    it("does not create a run when issue is Validating", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Validating);
      try {
        services.runService.create(issue.id, adapter.id, "do");
      } catch {
        void 0;
      }
      const runs = services.runRepo.listByIssue(issue.id);
      expect(runs).toHaveLength(0);
    });

    it("does not change issue status when rejected", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Validating);
      try {
        services.runService.create(issue.id, adapter.id, "do");
      } catch {
        void 0;
      }
      const refetched = services.issueRepo.getById(issue.id);
      expect(refetched!.status).toBe(IssueStatus.Validating);
    });
  });

  describe("public create does not accept system fields", () => {
    it("create method signature only accepts (issueId, adapterId, instructions)", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.runService.create(issue.id, adapter.id, "do work");

      expect(run.role).toBe(RunRole.Implementation);
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.workflow_step).toBe("implementation");
    });
  });

  describe("transition to Running still preserves role", () => {
    it("queued implementation run transitions to running keeping role", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Running);

      const run = services.runService.create(issue.id, adapter.id, "do");
      services.workspaceLockService.acquire(issue.workspace_id, run.id);
      const running = services.runService.transitionToRunning(run.id);

      expect(running).not.toBeNull();
      expect(running!.role).toBe(RunRole.Implementation);
      expect(running!.workflow_step).toBe("implementation");
    });
  });
});
