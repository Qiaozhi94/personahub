import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunPurpose, RunDispatchSource, AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../../src/api/errors.js";

// F005 rewrite: this file tested RunService.create()'s guards directly.
// RunService.create() no longer exists (ManualRoutingService replaces it —
// see manual-routing-service.ts / run-routing-classifier.ts). Rewritten to
// test the new create-transaction's guards, in particular the behavior
// change design §7.2 requires: Validating is no longer a blanket rejection
// — it now classifies per the adapter's capability_tags (workflow-bound
// validator, or a degraded consult), matching the Phase 7 classifier's own
// unit-tested rules.

function setupIssueWithAdapter(services: TestServices, tempDir: string, status: IssueStatus = IssueStatus.Inbox, capabilityTags: AgentCapability[] = [AgentCapability.Implementation]) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  if (status !== IssueStatus.Inbox) {
    services.issueRepo.updateStatus(issue.id, { status, updatedAt: new Date().toISOString() });
  }
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation",
    cli_provider: "codex", command: "codex", args: [], capability_tags: capabilityTags,
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

describe("ManualRoutingService.dispatch() create guards (F005 rewrite of F004 public create guards)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });
  afterEach(() => disposeTestServices(services));

  describe("workflow-bound implementation (adapter has Implementation capability)", () => {
    it("creates run with role=implementation, purpose=workflow_bound, workflow_step=implementation, dispatch_source=user_explicit", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do work" });

      expect(run.role).toBe(RunRole.Implementation);
      expect(run.purpose).toBe(RunPurpose.WorkflowBound);
      expect(run.workflow_step).toBe("implementation");
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.validation_round).toBeNull();
    });

    it("auto-snapshots adapter identity from config at creation", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do work" });

      expect(run.adapter_identity).not.toBeNull();
      expect(run.adapter_identity!.adapter_config_id).toBe(adapter.id);
      expect(run.adapter_identity!.name).toBe("Impl");
      expect(run.adapter_identity!.cli_provider).toBe("codex");
      expect(run.adapter_identity!.default_model).toBe("gpt-5");
    });

    it("identity snapshot is independent of later adapter config changes", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do work" });
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

      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do work" });

      expect(run.has_final_message).toBe(false);
    });
  });

  describe("Issue status handling (design §7.2/§7.3)", () => {
    it("succeeds as workflow-bound implementation on Inbox", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Inbox);
      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      expect(run.role).toBe(RunRole.Implementation);
      expect(run.purpose).toBe(RunPurpose.WorkflowBound);
    });

    it("succeeds as workflow-bound implementation on Ready", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Ready);
      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      expect(run.role).toBe(RunRole.Implementation);
      expect(run.purpose).toBe(RunPurpose.WorkflowBound);
    });

    it("succeeds as workflow-bound implementation on Running", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Running);
      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      expect(run.role).toBe(RunRole.Implementation);
      expect(run.purpose).toBe(RunPurpose.WorkflowBound);
    });

    it("degrades to consult on Validating when the adapter only has Implementation capability (never mis-advances validation)", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Validating);
      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      expect(run.role).toBe(RunRole.Consult);
      expect(run.purpose).toBe(RunPurpose.AdHocConsult);

      const refetchedIssue = services.issueRepo.getById(issue.id);
      expect(refetchedIssue!.status).toBe(IssueStatus.Validating);
    });

    it("rejects Done issue with RUN_NOT_ALLOWED_FOR_ISSUE_STATUS", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Done);
      try {
        services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS);
      }
    });

    it("rejects Blocked issue with RUN_NOT_ALLOWED_FOR_ISSUE_STATUS", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Blocked);
      try {
        services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.RUN_NOT_ALLOWED_FOR_ISSUE_STATUS);
      }
    });

    it("does not create a run when issue is Done", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Done);
      try {
        services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      } catch {
        void 0;
      }
      const runs = services.runRepo.listByIssue(issue.id);
      expect(runs).toHaveLength(0);
    });

    it("does not change issue status when rejected", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Blocked);
      try {
        services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      } catch {
        void 0;
      }
      const refetched = services.issueRepo.getById(issue.id);
      expect(refetched!.status).toBe(IssueStatus.Blocked);
    });
  });

  describe("does not accept client-forced system fields", () => {
    it("dispatch() input only accepts issueId/adapterId/instructions/purpose — role/dispatch_source are always server-derived", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);

      const run = services.manualRoutingService.dispatch({
        issueId: issue.id, adapterId: adapter.id, instructions: "do work",
        // @ts-expect-error — role/dispatch_source are not part of the input type.
        role: RunRole.Validator, dispatch_source: RunDispatchSource.System,
      });

      expect(run.role).toBe(RunRole.Implementation);
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.workflow_step).toBe("implementation");
    });

    it("an explicit purpose=workflow_bound request is ignored — treated the same as omitted (client cannot force it)", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir);
      const run = services.manualRoutingService.dispatch({
        issueId: issue.id, adapterId: adapter.id, instructions: "do work", purpose: RunPurpose.WorkflowBound,
      });
      expect(run.purpose).toBe(RunPurpose.WorkflowBound);
      expect(run.role).toBe(RunRole.Implementation);
    });
  });

  describe("transition to Running still preserves role", () => {
    it("queued implementation run transitions to running keeping role", () => {
      const { issue, adapter } = setupIssueWithAdapter(services, tempDir, IssueStatus.Running);

      const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do" });
      services.workspaceLockService.acquire(issue.workspace_id, run.id);
      const running = services.runService.transitionToRunning(run.id);

      expect(running).not.toBeNull();
      expect(running!.role).toBe(RunRole.Implementation);
      expect(running!.workflow_step).toBe("implementation");
    });
  });
});
