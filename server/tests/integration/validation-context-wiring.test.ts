import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from "@personahub/shared/types";

function setup(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Fix widget crash", goal: "Make the widget stop crashing" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  const valAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  return { project, issue, implAdapter, valAdapter, implRun };
}

function writeHandoff(services: TestServices, threadId: string, runId: string, summary: string, completedWork: string[] = []) {
  services.threadEventService.write(threadId, ThreadEventType.HandoffCreated, ActorType.System, null, {
    run_id: runId, summary, completed_work: completedWork, known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false,
  });
}

describe("T090 validator context wiring", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("wires assembled validator context into the validator Run instructions", () => {
    const { issue, implRun } = setup(services, tempDir);
    const threadId = issue.primary_thread!.id;
    writeHandoff(services, threadId, implRun.id, "Implemented widget guard", ["Added null check"]);
    services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/widget.ts", previous_path: null, change_type: "modified", before_fingerprint: "a", after_fingerprint: "b" }], new Date().toISOString());
    services.threadEventService.write(threadId, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });

    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
    expect(validatorRun).not.toBeNull();
    const stored = services.runRepo.getById(validatorRun!.id)!;

    expect(stored.instructions.length).toBeGreaterThan(0);
    expect(stored.instructions).toContain("Make the widget stop crashing"); // goal
    expect(stored.instructions).toContain("Implemented widget guard"); // handoff summary
    expect(stored.instructions).toContain("src/widget.ts"); // file change
    expect(stored.instructions).toContain("npm test"); // verification command
    expect(stored.instructions).toContain("sha256:"); // frozen policy hash
    expect(stored.instructions).toContain("Validator Run"); // dual-run identity
    expect(stored.instructions).toContain("schema_version"); // strict JSON contract
    expect(stored.instructions).toContain(`file-change-set:${implRun.id}`); // scoped ref
  });

  it("does not leak evidence from other runs into the validator context", () => {
    const { issue, implRun, implAdapter } = setup(services, tempDir);
    const threadId = issue.primary_thread!.id;
    writeHandoff(services, threadId, implRun.id, "Target run handoff");
    const otherRun = services.runRepo.create({ issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id, adapter_config_id: implAdapter.id, instructions: "other", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapter.id, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
    writeHandoff(services, threadId, otherRun.id, "SHOULD_NOT_APPEAR");
    services.fileChangeRepo.replaceForRun(otherRun.id, [{ path: "src/other-should-not-appear.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "z" }], new Date().toISOString());

    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
    const stored = services.runRepo.getById(validatorRun!.id)!;

    expect(stored.instructions).toContain("Target run handoff");
    expect(stored.instructions).not.toContain("SHOULD_NOT_APPEAR");
    expect(stored.instructions).not.toContain("other-should-not-appear");
  });

  it("includes prior validation findings in the validator context", () => {
    const { issue, implRun } = setup(services, tempDir);
    const threadId = issue.primary_thread!.id;
    writeHandoff(services, threadId, implRun.id, "Second attempt handoff");
    services.threadEventService.write(threadId, ThreadEventType.ValidationFinding, ActorType.System, null, {
      issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
      validation_round: 1, severity: "error", message: "PRIOR_FINDING_MISSING_GUARD",
      finding_index: 0, suggestion: "Add the guard", file_path: "src/widget.ts", line: 5,
      validator_run_id: "v_prior", implementation_run_id: implRun.id,
    });

    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id);
    const stored = services.runRepo.getById(validatorRun!.id)!;

    expect(stored.instructions).toContain("PRIOR_FINDING_MISSING_GUARD");
  });
});

describe("T090 repair context wiring", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  function runningIssueWithAdapter() {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    const implAdapter = services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
    services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
    return { issue, implAdapter };
  }

  it("injects latest-round findings into a repair implementation run", () => {
    const { issue, implAdapter } = runningIssueWithAdapter();
    services.db.prepare("UPDATE issues SET validation_round_count = 1 WHERE id = ?").run(issue.id);
    services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationFinding, ActorType.System, null, {
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      validation_round: 1, severity: "error", message: "FIX_THE_NULL_CHECK",
      finding_index: 0, suggestion: "Add a guard", file_path: "src/widget.ts", line: 7,
      validator_run_id: "v1", implementation_run_id: "impl_old",
    });

    const run = services.runService.create(issue.id, implAdapter.id, "Please address the review");
    const stored = services.runRepo.getById(run.id)!;

    expect(stored.instructions).toContain("Please address the review");
    expect(stored.instructions).toContain("FIX_THE_NULL_CHECK");
    expect(stored.instructions).toContain("Prior Validation Findings");
  });

  it("does not inject repair context on the first implementation run", () => {
    const { issue, implAdapter } = runningIssueWithAdapter();
    const run = services.runService.create(issue.id, implAdapter.id, "Do the task");
    const stored = services.runRepo.getById(run.id)!;

    expect(stored.instructions).toBe("Do the task");
    expect(stored.instructions).not.toContain("Prior Validation Findings");
  });
});
