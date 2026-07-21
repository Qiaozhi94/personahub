import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { buildRunContext, RUN_CONTEXT_MAX_BYTES } from "../../src/services/run-context-builder.js";
import {
  IssueStatus, RunRole, RunPurpose, RunStatus, RunDispatchSource,
  ThreadEventType, ActorType, AdapterStatus, AgentCapability,
} from "@personahub/shared/types";

// T049: RunContextBuilder — design §6.5. Uses real repos (createTestServices())
// so the "trusted evidence resolver only ever reads typed HandoffCreated
// events" property is exercised against the real ThreadEventRepository
// query methods, not an assumption about them.

function setup(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Fix the bug", goal: "Make CI green" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: null, status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

// Two runs created synchronously in the same test can tie at millisecond
// created_at resolution; ULID's random suffix isn't guaranteed to reflect
// creation order on a tie, which makes RunRepository.getLatestCompletedByRole's
// created_at/id tie-break non-deterministic (same class of flakiness fixed
// in F005 Phase 4's "frozen validator" test). Force an unambiguous earlier
// timestamp on the prior Run instead of relying on real-time ordering.
function forceEarlierCreatedAt(services: TestServices, runId: string) {
  services.db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(
    new Date(Date.now() - 60_000).toISOString(),
    runId,
  );
}

function writeHandoff(services: TestServices, threadId: string, runId: string, overrides: Record<string, unknown> = {}) {
  services.threadEventService.write(threadId, ThreadEventType.HandoffCreated, ActorType.System, null, {
    run_id: runId, summary: "Implemented the fix.", completed_work: ["Added null check"],
    known_risks: [], missing_evidence: [], evidence_ref_count: 0, evidence_refs_truncated: false,
    ...overrides,
  });
}

describe("buildRunContext (T049/T050)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => disposeTestServices(services));

  it("returns a minimal context with contextSourceRunId=null for the first Run on an Issue", () => {
    const { issue, adapter } = setup(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Queued,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });

    const result = buildRunContext(services, run, issue);

    expect(result.contextSourceRunId).toBeNull();
    expect(result.context).toContain("first Run for this Issue");
    expect(result.context).toContain("Fix the bug");
    expect(result.context).toContain("Make CI green");
  });

  it("implementation/consult Runs use the latest completed implementation Run's handoff", () => {
    const { issue, adapter } = setup(services, tempDir);
    const implRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    forceEarlierCreatedAt(services, implRun.id);
    writeHandoff(services, issue.primary_thread!.id, implRun.id, { summary: "First pass done." });

    const consultRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "explain the change", status: RunStatus.Queued,
      role: RunRole.Consult, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.AdHocConsult,
    });

    const result = buildRunContext(services, consultRun, issue);

    expect(result.contextSourceRunId).toBe(implRun.id);
    expect(result.context).toContain("First pass done.");
    expect(result.context).toContain("does not change Issue status");
  });

  it("validator strictly uses its own context_source_run_id (implementation_run_id), never re-derived", () => {
    const { issue, adapter } = setup(services, tempDir);
    const olderImplRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    writeHandoff(services, issue.primary_thread!.id, olderImplRun.id, { summary: "The Run being validated." });

    // A consult Run created AFTER the implementation Run, during the
    // Validating grace window, produces a NEWER handoff — design §7.5/§6.5:
    // this must never become the validator's context source.
    const consultRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "poke around", status: RunStatus.Completed,
      role: RunRole.Consult, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.AdHocConsult,
    });
    writeHandoff(services, issue.primary_thread!.id, consultRun.id, { summary: "Unrelated consult exploration." });

    const validatorRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "validate it", status: RunStatus.Queued,
      role: RunRole.Validator, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound, context_source_run_id: olderImplRun.id,
    });

    const result = buildRunContext(services, validatorRun, issue);

    expect(result.contextSourceRunId).toBe(olderImplRun.id);
    expect(result.context).toContain("The Run being validated.");
    expect(result.context).not.toContain("Unrelated consult exploration.");
  });

  it("only reads the typed HandoffCreated event for the source Run — a run.output event for the same run never leaks in", () => {
    const { issue, adapter } = setup(services, tempDir);
    const implRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    forceEarlierCreatedAt(services, implRun.id);
    services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.RunOutput, ActorType.System, null, {
      run_id: implRun.id, stream: "stdout", chunk: "SECRET_RAW_STDOUT_MARKER should never appear in context", sequence: 1,
    });
    writeHandoff(services, issue.primary_thread!.id, implRun.id, { summary: "Clean handoff summary." });

    const nextRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "continue", status: RunStatus.Queued,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });

    const result = buildRunContext(services, nextRun, issue);

    expect(result.context).toContain("Clean handoff summary.");
    expect(result.context).not.toContain("SECRET_RAW_STDOUT_MARKER");
  });

  it("includes latest-round validation findings only for workflow-bound implementation Runs", () => {
    const { issue, adapter } = setup(services, tempDir);
    const implRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    forceEarlierCreatedAt(services, implRun.id);
    writeHandoff(services, issue.primary_thread!.id, implRun.id);
    services.threadEventService.write(issue.primary_thread!.id, ThreadEventType.ValidationFinding, ActorType.System, null, {
      validation_round: 1, severity: "error", message: "Missing test coverage", suggestion: null, file_path: null, line: null,
    });

    const retryRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "fix it", status: RunStatus.Queued,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    const consultRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "just look", status: RunStatus.Queued,
      role: RunRole.Consult, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.AdHocConsult,
    });

    const retryResult = buildRunContext(services, retryRun, issue);
    const consultResult = buildRunContext(services, consultRun, issue);

    expect(retryResult.context).toContain("Missing test coverage");
    expect(consultResult.context).not.toContain("Missing test coverage");
  });

  it("gracefully reports a missing handoff for an eligible source Run that has none", () => {
    const { issue, adapter } = setup(services, tempDir);
    const implRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    forceEarlierCreatedAt(services, implRun.id);
    // No HandoffCreated event written for implRun.

    const nextRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "continue", status: RunStatus.Queued,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });

    const result = buildRunContext(services, nextRun, issue);
    expect(result.contextSourceRunId).toBe(implRun.id);
    expect(result.context).toContain("no recorded handoff");
  });

  it("normalizes Windows-style backslash paths and rejects absolute/traversal paths in the file-changes section", () => {
    const { issue, adapter } = setup(services, tempDir);
    const implRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    forceEarlierCreatedAt(services, implRun.id);
    writeHandoff(services, issue.primary_thread!.id, implRun.id);
    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(implRun.id, [
      { path: "src\\module\\file.ts", previous_path: null, change_type: "modified", before_fingerprint: "a", after_fingerprint: "b" },
      { path: "C:\\Windows\\System32\\evil.dll", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "c" },
      { path: "../../../etc/passwd", previous_path: null, change_type: "added", before_fingerprint: null, after_fingerprint: "d" },
    ], now);

    const nextRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "continue", status: RunStatus.Queued,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });

    const result = buildRunContext(services, nextRun, issue);
    expect(result.context).toContain("src/module/file.ts");
    expect(result.context).not.toContain("System32");
    expect(result.context).not.toContain("etc/passwd");
  });

  it("truncates the file-changes section to a count when the assembled context exceeds the size limit", () => {
    const { issue, adapter } = setup(services, tempDir);
    const implRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Completed,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });
    forceEarlierCreatedAt(services, implRun.id);
    writeHandoff(services, issue.primary_thread!.id, implRun.id);
    const now = new Date().toISOString();
    // FileChangeRepository.listByRun() defaults to a 100-item cap (existing
    // F004 behavior, reused as-is here) — use long paths so even 100
    // entries exceed RUN_CONTEXT_MAX_BYTES, rather than relying on count.
    const manyChanges = Array.from({ length: 100 }, (_, i) => ({
      path: `src/generated/file-${i}-${"x".repeat(1500)}.ts`,
      previous_path: null, change_type: "added" as const, before_fingerprint: null, after_fingerprint: `h${i}`,
    }));
    services.fileChangeRepo.replaceForRun(implRun.id, manyChanges, now);

    const nextRun = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "continue", status: RunStatus.Queued,
      role: RunRole.Implementation, dispatch_source: RunDispatchSource.UserExplicit,
      purpose: RunPurpose.WorkflowBound,
    });

    const result = buildRunContext(services, nextRun, issue);
    expect(Buffer.byteLength(result.context, "utf8")).toBeLessThanOrEqual(RUN_CONTEXT_MAX_BYTES);
    expect(result.context).toContain("100 file(s) changed");
  });
});
