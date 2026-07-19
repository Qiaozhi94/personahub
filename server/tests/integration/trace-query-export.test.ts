import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  RunStatus,
  AdapterStatus,
  ThreadEventType,
  ActorType,
  CommandTraceCapability,
  FileChangeType,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function setupIssueAndRun(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test", "desc");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "Test Issue", goal: "Test goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
    command: "fake", args: [], capability_tags: [], default_model: null, status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

describe("TraceQueryService (T061)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("returns issue trace with runs and events", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, new Date().toISOString());

    const trace = services.traceQueryService.getIssueTrace(issue.id);

    expect(trace.issue.id).toBe(issue.id);
    expect(trace.runs).toHaveLength(1);
    expect(trace.runs[0].trace_applicable).toBe(true);
    expect(trace.runs[0].completeness).not.toBeNull();
  });

  it("queued never-started Run has trace_applicable=false and null completeness", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });

    const trace = services.traceQueryService.getIssueTrace(issue.id);

    expect(trace.runs).toHaveLength(1);
    expect(trace.runs[0].trace_applicable).toBe(false);
    expect(trace.runs[0].completeness).toBeNull();
  });

  it("issue_completeness has no_started_runs when no started runs", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });

    const trace = services.traceQueryService.getIssueTrace(issue.id);

    expect(trace.issue_completeness.reasons).toContain("no_started_runs");
  });

  it("returns run evidence with file changes pagination", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, new Date().toISOString());

    const now = new Date().toISOString();
    services.fileChangeRepo.replaceForRun(run.id, [
      { path: "a.ts", previous_path: null, change_type: FileChangeType.Added, before_fingerprint: null, after_fingerprint: "x" },
      { path: "b.ts", previous_path: null, change_type: FileChangeType.Modified, before_fingerprint: "y", after_fingerprint: "z" },
    ], now);

    const evidence = services.traceQueryService.getRunEvidence(run.id, undefined, undefined, 100, 1);

    expect(evidence.file_changes).toHaveLength(1);
    expect(evidence.next_after_file_change_id).not.toBeNull();
    expect(evidence.completeness).toBeDefined();
  });

  it("throws INVALID_QUERY for file cursor from different run", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });

    expect(() =>
      services.traceQueryService.getRunEvidence(run.id, undefined, "fcg_other_run_cursor", 100, 100),
    ).toThrow();
  });
});

describe("TraceExportService (T063)", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("exports issue trace as UTF-8 Markdown", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, new Date().toISOString());

    const result = services.traceExportService.exportIssueTraceMarkdown(issue.id);

    expect(result.content).toContain("# Test Issue - Development Trace");
    expect(result.content).toContain("## Issue");
    expect(result.content).toContain("## Trace Completeness");
    expect(result.content).toContain("## Run");
    expect(result.content).toContain("## Validation Trace");
    expect(result.content).toContain("## Missing / Truncated Evidence");
    expect(result.filename).toContain("Test-Issue");
    expect(result.filename).toContain("-development-trace.md");
  });

  it("escapes HTML special characters in Markdown", () => {
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test <Issue>", goal: "<script>alert('xss')</script>" });

    const result = services.traceExportService.exportIssueTraceMarkdown(issue.id);

    expect(result.content).not.toContain("<script>");
    expect(result.content).toContain("&lt;script&gt;");
  });

  it("shows Not recorded when no commands", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, new Date().toISOString());

    const result = services.traceExportService.exportIssueTraceMarkdown(issue.id);

    expect(result.content).toContain("Not recorded.");
  });

  it("sanitizes filename", () => {
    const project = services.projectService.create("Test", "desc");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: 'Test<>:"/\\|?*', goal: "Goal" });

    const result = services.traceExportService.exportIssueTraceMarkdown(issue.id);

    expect(result.filename).not.toMatch(/[<>:"/\\|?*]/);
  });

  it("renders all file changes without preview truncation when below global cap (T094)", () => {
    const { issue, adapter } = setupIssueAndRun(services, tempDir);
    const run = services.runRepo.create({
      issue_id: issue.id, thread_id: issue.primary_thread_id!, workspace_id: issue.workspace_id,
      adapter_config_id: adapter.id, instructions: "test", status: RunStatus.Queued,
    });
    services.runRepo.transitionStatus(run.id, RunStatus.Queued, RunStatus.Running, { started_at: new Date().toISOString() });
    services.runTraceRepo.createPending(run.id, CommandTraceCapability.Supported, new Date().toISOString());

    // Create 150 file changes (between eventPreview=100 and exportChanges=5000)
    const now = new Date().toISOString();
    const changes = Array.from({ length: 150 }, (_, i) => ({
      path: `src/file${i}.ts`, previous_path: null,
      change_type: FileChangeType.Added,
      before_fingerprint: null, after_fingerprint: `h${i}`,
    }));
    services.fileChangeRepo.replaceForRun(run.id, changes, now);

    const result = services.traceExportService.exportIssueTraceMarkdown(issue.id);

    // All 150 changes should be rendered (no per-Run slice)
    for (let i = 0; i < 150; i++) {
      expect(result.content).toContain(`src/file${i}.ts`);
    }
    // No per-Run truncation message (handled globally only when export cap hit)
    expect(result.content).not.toContain("more (see Run evidence API for full list)");
  });

  it("throws structured ISSUE_NOT_FOUND for a missing issue (IR-004)", () => {
    let caught: unknown;
    try {
      services.traceExportService.exportIssueTraceMarkdown("issue_does_not_exist");
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe(ErrorCode.ISSUE_NOT_FOUND);
  });
});
