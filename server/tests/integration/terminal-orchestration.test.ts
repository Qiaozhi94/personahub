import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from "@personahub/shared/types";

function setupImplFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const workspace = services.workspaceService.get(project.id)!;
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Queued, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(implRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(implRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0 });
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Work done", completed_work: ["Task 1"], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
  services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/file.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" }], now);
  services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });
  return { project, issue, implAdapter, implRun, workspace };
}

const PASS_FM = { schema_version: 1, outcome: "passed", summary: "All good", findings: [], evidence_refs: [], missing_evidence: [], key_decisions: ["D1"], lessons_candidate: ["L1"] };

describe("Terminal orchestration via finalizeAndDrain (T056-T059)", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  describe("T056: implementation terminal triggers validation", () => {
    it("implementation completed -> F003 finalize -> unlock -> workflow hook -> validator queued", async () => {
      const { issue, implRun, workspace } = setupImplFixture(services, tempDir);

      await services.runDispatchService.finalizeAndDrain(implRun.id, workspace.id);

      // Issue transitions to Validating
      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Validating);

      // Validator Run created
      const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
      expect(validators).toHaveLength(1);
      expect(validators[0].status).toBe(RunStatus.Queued);

      // validation.requested event written
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      const requested = events.find((e) => e.type === ThreadEventType.ValidationRequested);
      expect(requested).toBeDefined();
      expect(requested!.payload_json.implementation_run_id).toBe(implRun.id);

      // run.queued event for validator written
      const queued = events.find((e) => e.type === ThreadEventType.RunQueued && e.payload_json.role === RunRole.Validator);
      expect(queued).toBeDefined();
      expect(queued!.event_sequence).toBeGreaterThan(requested!.event_sequence);

      // Workspace lock was released
      expect(services.workspaceLockService.isLocked(workspace.id)).toBe(false);
    });

    it("non-completed implementation run does not trigger validation", async () => {
      const { issue, workspace, implAdapter } = setupImplFixture(services, tempDir);
      const failedRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Failed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });

      await services.runDispatchService.finalizeAndDrain(failedRun.id, workspace.id);

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Running);
      const validators = services.runRepo.listByIssue(issue.id).filter((r) => r.role === RunRole.Validator);
      expect(validators).toHaveLength(0);
    });
  });

  describe("T058: validator terminal triggers processValidatorResult", () => {
    it("validator completed -> pass/Done", async () => {
      const { issue, implRun, workspace } = setupImplFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(PASS_FM) });

      await services.runDispatchService.finalizeAndDrain(valRun.id, workspace.id);

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
      const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
      expect(events.find((e) => e.type === ThreadEventType.ValidationPassed)).toBeDefined();
      expect(events.find((e) => e.type === ThreadEventType.IssueDone)).toBeDefined();
    });

    it("validator failed/cancelled/interrupted -> Blocked with validator_run_failed", async () => {
      const { issue, implRun, workspace } = setupImplFixture(services, tempDir);
      const valRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
      const now = new Date().toISOString();
      services.runRepo.transitionStatus(valRun.id, RunStatus.Queued, RunStatus.Running, { started_at: now });
      services.runRepo.transitionStatus(valRun.id, RunStatus.Running, RunStatus.Failed, { completed_at: now, exit_code: 1 });

      await services.runDispatchService.finalizeAndDrain(valRun.id, workspace.id);

      expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Blocked);
      expect(services.issueRepo.getById(issue.id)!.blocked_reason_code).toBe("validator_run_failed");
      const blocked = services.threadEventRepo.listByThread(issue.primary_thread!.id).find((e) => e.type === ThreadEventType.ValidationBlocked);
      expect(blocked).toBeDefined();
      expect(blocked!.payload_json.reason_code).toBe("validator_run_failed");
    });

    it("hook errors do not prevent queue drain", async () => {
      const { workspace } = setupImplFixture(services, tempDir);
      // A non-existent run should not throw — hook catches and drain continues
      await expect(services.runDispatchService.finalizeAndDrain("nonexistent", workspace.id)).resolves.toBeUndefined();
    });
  });
});
