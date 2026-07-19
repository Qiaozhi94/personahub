import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, AdapterStatus } from "@personahub/shared/types";

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const workspace = services.workspaceService.get(project.id)!;
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "fake", command: "echo", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "fake", command: "echo", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available });
  return { project, issue, implAdapter, workspace };
}

function createQueuedImplRun(services: TestServices, issueId: string, threadId: string, workspaceId: string, adapterId: string) {
  return services.runRepo.create({
    issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
    adapter_config_id: adapterId, instructions: "test", status: RunStatus.Queued,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: { adapter_config_id: adapterId, name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
  });
}

function createQueuedValidatorRun(services: TestServices, issueId: string, threadId: string, workspaceId: string, adapterId: string, round: number) {
  return services.runRepo.create({
    issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
    adapter_config_id: adapterId, instructions: "", status: RunStatus.Queued,
    role: RunRole.Validator, dispatch_source: RunDispatchSource.System,
    validation_round: round,
    adapter_identity: { adapter_config_id: adapterId, name: "Val", cli_provider: "codex", default_model: "gpt-5" },
  });
}

describe("Queue drain eligibility (T062)", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  describe("implementation run eligibility", () => {
    it("starts implementation run when issue is Running", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
      expect(services.workspaceLockService.isLocked(workspace.id)).toBe(false);

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const runs = services.runRepo.listByIssue(issue.id);
      const implRuns = runs.filter((r) => r.role === RunRole.Implementation);
      const started = implRuns.find((r) => r.status === RunStatus.Running);
      expect(started).toBeDefined();
    });

    it("cancels implementation run when issue is Validating", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const run = createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });

    it("cancels implementation run when issue is Done", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const run = createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Done, updatedAt: new Date().toISOString() });

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });

    it("cancels implementation run when issue is Blocked", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const run = createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Blocked, updatedAt: new Date().toISOString() });

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });
  });

  describe("validator run eligibility", () => {
    it("starts validator run when issue is Validating and round matches", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });
      const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(valRun.id);
      expect(refetched!.status).toBe(RunStatus.Running);
    });

    it("cancels validator run when issue is not Validating (Running)", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
      const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(valRun.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });

    it("cancels validator run when round does not match (stale round)", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });
      services.db.prepare("UPDATE issues SET validation_round_count = 2 WHERE id = ?").run(issue.id);
      const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(valRun.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });

    it("cancels validator run when issue is Done", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
      const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Done, updatedAt: new Date().toISOString() });

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(valRun.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });

    it("cancels validator run when issue is Blocked", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
      const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Blocked, updatedAt: new Date().toISOString() });

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const refetched = services.runRepo.getById(valRun.id);
      expect(refetched!.status).toBe(RunStatus.Cancelled);
    });
  });

  describe("ordering", () => {
    it("continues scanning after cancelling an ineligible queued run", async () => {
      const { issue, implAdapter, workspace } = setupFixture(services, tempDir);
      const valAdapter = services.agentConfigRepo.listAvailableByProjectAndRole(issue.project_id, RunRole.Validator)[0];
      createQueuedImplRun(services, issue.id, issue.primary_thread!.id, workspace.id, implAdapter.id);
      services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Validating, updatedAt: new Date().toISOString() });
      const valRun = createQueuedValidatorRun(services, issue.id, issue.primary_thread!.id, workspace.id, valAdapter.id, 1);

      await services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id);

      const valRefetched = services.runRepo.getById(valRun.id);
      expect(valRefetched!.status).toBe(RunStatus.Running);
    });
  });
});
