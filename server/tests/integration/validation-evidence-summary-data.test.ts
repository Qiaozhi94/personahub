import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { IssueStatus, RunRole, RunDispatchSource, RunStatus, ThreadEventType, AdapterStatus, ActorType } from "@personahub/shared/types";

const PASS_FM = { schema_version: 1, outcome: "passed", summary: "All good", findings: [], evidence_refs: [], missing_evidence: [], key_decisions: ["D1"], lessons_candidate: ["L1"] };

function completeWith(services: TestServices, runId: string, fm: object) {
  const now = new Date().toISOString();
  services.runRepo.transitionStatus(runId, RunStatus.Queued, RunStatus.Running, { started_at: now });
  services.runRepo.transitionStatus(runId, RunStatus.Running, RunStatus.Completed, { completed_at: now, exit_code: 0, final_message: JSON.stringify(fm) });
}

function setup(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
  services.agentConfigRepo.create({ project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  services.agentConfigRepo.create({ project_id: project.id, name: "Val", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
  const implAdapterId = services.agentConfigRepo.listAvailableByProjectAndRole(project.id, RunRole.Implementation)[0].id;
  const implRun = services.runRepo.create({ issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id, adapter_config_id: implAdapterId, instructions: "do it", status: RunStatus.Completed, role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit, adapter_identity: { adapter_config_id: implAdapterId, name: "Impl", cli_provider: "codex", default_model: "gpt-5" } });
  const threadId = issue.primary_thread!.id;
  services.threadEventService.write(threadId, ThreadEventType.HandoffCreated, ActorType.System, null, { run_id: implRun.id, summary: "Implemented the feature X", completed_work: ["Wrote feature code"], known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false });
  services.threadEventService.write(threadId, ThreadEventType.CommandCompleted, ActorType.System, null, { run_id: implRun.id, command: "npm run build", outcome: "success", exit_code: 0, summary: "build ok" });
  services.threadEventService.write(threadId, ThreadEventType.TestCompleted, ActorType.System, null, { run_id: implRun.id, kind: "test", result: "passed", command: "npm test" });
  services.fileChangeRepo.replaceForRun(implRun.id, [{ path: "src/feature.ts", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "abc" }], new Date().toISOString());
  return { issue, implRun, threadId };
}

describe("T092 evidence summary real data", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => { services = createTestServices(); tempDir = createTempDir(); });
  afterEach(() => disposeTestServices(services));

  it("embeds real handoff, commands, verification and files (no placeholders)", () => {
    const { issue, implRun } = setup(services, tempDir);
    const validatorRun = services.validationWorkflowService.requestValidation(issue.id, implRun.id)!;
    completeWith(services, validatorRun.id, PASS_FM);

    services.validationWorkflowService.processValidatorResult(validatorRun.id);

    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Done);
    const summary = services.evidenceSummaryRepo.getByIssueId(issue.id)!;
    expect(summary).toBeDefined();
    const md = summary.summary_markdown;
    expect(md).toContain("Implemented the feature X"); // real handoff summary
    expect(md).toContain("npm run build"); // real command
    expect(md).toContain("src/feature.ts"); // real file change
    expect(md).not.toContain("No commands recorded");
    expect(md).not.toContain("No implementation handoff available");
  });
});
