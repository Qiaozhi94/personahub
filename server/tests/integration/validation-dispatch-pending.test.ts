import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ValidationWorkflowService } from "../../src/services/validation/workflow-service.js";
import {
  IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType,
  AdapterStatus, ActorType, AgentCapability,
} from "@personahub/shared/types";

/**
 * T061a: `validation.dispatch_pending` is Phase A's event — written the
 * instant implementation completes and the Issue moves Running -> Validating,
 * before any validator is selected or created. It must carry everything
 * Phase B will need (frozen round/implementation_run_id/policy snapshot+hash/
 * due_at) but explicitly zero validator identity, since none exists yet.
 * `validation.requested` (F004's original, validator-bound event) must not
 * be written until Phase B actually creates a validator Run.
 */
function createGraceWorkflowService(services: TestServices, graceMs: number): ValidationWorkflowService {
  return new ValidationWorkflowService(
    services.db, services.issueRepo, services.runRepo, services.threadEventService, services.threadEventRepo,
    services.validationTraceService, services.agentConfigRepo, services.workflowTemplateRepo,
    services.validationPolicyRepo, services.evidenceSummaryRepo, services.fileChangeRepo,
    services.adapterWorkspaceStatusRepo, graceMs,
  );
}

function setupFixture(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  services.agentConfigRepo.create({
    project_id: project.id, name: "Val", role: "validator", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Validator],
    default_model: "gpt-5", status: AdapterStatus.Available,
  });
  const implRun = services.runRepo.create({
    issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
    adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed,
    role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
    adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" },
  });
  return { project, issue, implAdapter, implRun };
}

describe("T061a: validation.dispatch_pending event contract (Phase A)", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("writes validation.dispatch_pending and moves Issue to Validating, without writing validation.requested", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const graceWf = createGraceWorkflowService(services, 60_000);
    const result = graceWf.requestValidation(issue.id, implRun.id);
    expect(result).toBeNull(); // grace>0: Phase A only, no synchronous Phase B claim

    const refetched = services.issueRepo.getById(issue.id)!;
    expect(refetched.status).toBe(IssueStatus.Validating);
    expect(refetched.validation_dispatch_due_at).not.toBeNull();

    const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
    const pending = events.find((e) => e.type === ThreadEventType.ValidationDispatchPending);
    expect(pending).toBeDefined();
    const requested = events.find((e) => e.type === ThreadEventType.ValidationRequested);
    expect(requested).toBeUndefined();
  });

  it("dispatch_pending payload carries frozen round/implementation_run_id/policy snapshot+hash/due_at and no validator identity", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const graceWf = createGraceWorkflowService(services, 60_000);
    graceWf.requestValidation(issue.id, implRun.id);

    const pending = services.threadEventRepo.listByThread(issue.primary_thread!.id)
      .find((e) => e.type === ThreadEventType.ValidationDispatchPending)!;
    expect(pending.payload_json.issue_id).toBe(issue.id);
    expect(pending.payload_json.thread_id).toBe(issue.primary_thread!.id);
    expect(pending.payload_json.workspace_id).toBe(issue.workspace_id);
    expect(pending.payload_json.validation_round).toBe(1);
    expect(pending.payload_json.implementation_run_id).toBe(implRun.id);
    expect(pending.payload_json.policy_id).toBeDefined();
    expect(pending.payload_json.policy_version).toBeDefined();
    expect(pending.payload_json.policy_snapshot).toBeDefined();
    expect(pending.payload_json.policy_snapshot_hash).toBeDefined();
    expect(pending.payload_json.dispatch_due_at).toBeDefined();

    // must carry no validator identity of any kind — none exists yet
    expect(pending.payload_json.validator_run_id).toBeUndefined();
    expect(pending.payload_json.validator_adapter_config_id).toBeUndefined();
  });

  it("dispatch_pending's frozen fields match what Phase B later writes into validation.requested", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const graceWf = createGraceWorkflowService(services, 60_000);
    graceWf.requestValidation(issue.id, implRun.id);
    const pending = services.threadEventRepo.listByThread(issue.primary_thread!.id)
      .find((e) => e.type === ThreadEventType.ValidationDispatchPending)!;

    const claimed = graceWf.claimValidatorSlot(issue.id, { mode: "auto" });
    expect(claimed.ok).toBe(true);

    const requested = services.threadEventRepo.listByThread(issue.primary_thread!.id)
      .find((e) => e.type === ThreadEventType.ValidationRequested)!;
    expect(requested.payload_json.validation_round).toBe(pending.payload_json.validation_round);
    expect(requested.payload_json.implementation_run_id).toBe(pending.payload_json.implementation_run_id);
    expect(requested.payload_json.policy_snapshot_hash).toBe(pending.payload_json.policy_snapshot_hash);
    expect(requested.payload_json.policy_id).toBe(pending.payload_json.policy_id);
    expect(requested.payload_json.policy_version).toBe(pending.payload_json.policy_version);
    // only now does a validator identity exist
    expect(requested.payload_json.validator_adapter_config_id).toBeDefined();
    expect(requested.payload_json.validator_run_id).toBeDefined();

    expect(services.issueRepo.getById(issue.id)!.validation_dispatch_due_at).toBeNull();
  });

  it("grace=0 collapses Phase A + Phase B into the same event sequence F004 originally produced synchronously", () => {
    const { issue, implRun } = setupFixture(services, tempDir);
    const result = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
    expect(result).not.toBeNull();
    expect(result!.role).toBe(RunRole.Validator);

    const events = services.threadEventRepo.listByThread(issue.primary_thread!.id);
    const pending = events.find((e) => e.type === ThreadEventType.ValidationDispatchPending);
    const requested = events.find((e) => e.type === ThreadEventType.ValidationRequested);
    const queued = events.find((e) => e.type === ThreadEventType.RunQueued);
    expect(pending).toBeDefined();
    expect(requested).toBeDefined();
    expect(queued).toBeDefined();
    expect(pending!.event_sequence).toBeLessThan(requested!.event_sequence);
    expect(requested!.event_sequence).toBeLessThan(queued!.event_sequence);
    expect(services.issueRepo.getById(issue.id)!.validation_dispatch_due_at).toBeNull();
  });
});
