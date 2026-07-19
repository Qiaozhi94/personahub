import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import {
  ThreadEventType,
  ActorType,
  RunStatus,
  AdapterStatus,
  FileChangeType,
  CommandOutcome,
  VerificationResult,
  TraceCompletenessStatus,
  CommandTraceCapability,
  BaselineStatus,
} from "@personahub/shared/types";
import { buildHandoff } from "../../src/services/handoff-builder.js";
import { buildTraceCompleteness, aggregateIssueCompleteness } from "../../src/services/trace-completeness.js";
import type { Run, ThreadEvent, RunTraceState, TraceCompleteness } from "@personahub/shared/types";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_test1", issue_id: "iss_1", thread_id: "thr_1", workspace_id: "wsp_1",
    adapter_config_id: "adp_1", status: RunStatus.Completed, failure_reason: null,
    instructions: "do stuff", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z",
    exit_code: 0, error_message: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTraceState(overrides: Partial<RunTraceState> = {}): RunTraceState {
  return {
    run_id: "run_test1", command_trace_capability: CommandTraceCapability.Supported,
    baseline_status: BaselineStatus.Captured, scanner_type: "git", baseline_json: "{}",
    baseline_error_code: null, baseline_captured_at: "2026-01-01T00:00:00Z",
    finalized_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(type: ThreadEventType, payload: Record<string, unknown>): ThreadEvent {
  return {
    id: `evt_${type}_${Math.random().toString(36).slice(2, 8)}`,
    event_sequence: 1, thread_id: "thr_1", type, actor_type: ActorType.System,
    actor_id: null, payload_json: payload, evidence_refs: [], created_at: "2026-01-01T00:00:00Z",
  };
}

describe("Handoff Builder (T022)", () => {
  it("builds handoff for completed run with commands and tests", () => {
    const run = makeRun();
    const events = [
      makeEvent(ThreadEventType.CommandStarted, { run_id: run.id, command: "npm test" }),
      makeEvent(ThreadEventType.CommandCompleted, {
        run_id: run.id, outcome: CommandOutcome.Succeeded, exit_code: 0,
      }),
      makeEvent(ThreadEventType.TestCompleted, {
        run_id: run.id, result: VerificationResult.Passed, exit_code: 0,
      }),
    ];
    const completeness: TraceCompleteness = {
      commands: TraceCompletenessStatus.Complete,
      verification: TraceCompletenessStatus.Complete,
      file_changes: TraceCompletenessStatus.Complete,
      refs: TraceCompletenessStatus.Complete,
      reasons: [],
    };

    const handoff = buildHandoff({
      run, issueGoal: "Implement feature X", events, fileChanges: [],
      fileScanStatus: "complete", completeness, recoveredAfterRestart: false,
    });

    expect(handoff.run_status).toBe("completed");
    expect(handoff.command_summary.total).toBe(1);
    expect(handoff.command_summary.succeeded).toBe(1);
    expect(handoff.verification_summary.passed).toBe(1);
    expect(handoff.next_expected_action).toContain("Validate");
    expect(handoff.evidence_ref_count).toBeGreaterThanOrEqual(2);
    expect(handoff.evidence_refs_truncated).toBe(false);
  });

  it("builds handoff for failed run with risks", () => {
    const run = makeRun({ status: RunStatus.Failed, exit_code: 1 });
    const events = [
      makeEvent(ThreadEventType.CommandCompleted, {
        run_id: run.id, outcome: CommandOutcome.Failed, exit_code: 1,
      }),
    ];
    const completeness: TraceCompleteness = {
      commands: TraceCompletenessStatus.Complete,
      verification: TraceCompletenessStatus.Unavailable,
      file_changes: TraceCompletenessStatus.Complete,
      refs: TraceCompletenessStatus.Complete,
      reasons: ["verification:unavailable:run_test1"],
    };

    const handoff = buildHandoff({
      run, issueGoal: "Fix bug Y", events, fileChanges: [],
      fileScanStatus: "complete", completeness, recoveredAfterRestart: false,
    });

    expect(handoff.run_status).toBe("failed");
    expect(handoff.known_risks.length).toBeGreaterThan(0);
    expect(handoff.next_expected_action).toContain("failure");
  });

  it("builds handoff for cancelled run", () => {
    const run = makeRun({ status: RunStatus.Cancelled });
    const handoff = buildHandoff({
      run, issueGoal: "Goal", events: [], fileChanges: [],
      fileScanStatus: "complete",
      completeness: {
        commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete,
        file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [],
      },
      recoveredAfterRestart: false,
    });
    expect(handoff.run_status).toBe("cancelled");
    expect(handoff.next_expected_action).toContain("Resume");
  });

  it("builds handoff for interrupted run", () => {
    const run = makeRun({ status: RunStatus.Interrupted });
    const handoff = buildHandoff({
      run, issueGoal: "Goal", events: [], fileChanges: [],
      fileScanStatus: "failed",
      completeness: {
        commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete,
        file_changes: TraceCompletenessStatus.Unavailable, refs: TraceCompletenessStatus.Complete,
        reasons: [],
      },
      recoveredAfterRestart: true,
    });
    expect(handoff.run_status).toBe("interrupted");
    expect(handoff.file_summary).toBeNull();
    expect(handoff.known_risks).toContain("Run was finalized after server restart; evidence may be incomplete");
    expect(handoff.missing_evidence).toContain("file_change_evidence_unavailable");
  });

  it("records scan truncated in handoff", () => {
    const run = makeRun();
    const handoff = buildHandoff({
      run, issueGoal: "Goal", events: [], fileChanges: [],
      fileScanStatus: "truncated",
      completeness: {
        commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete,
        file_changes: TraceCompletenessStatus.Partial, refs: TraceCompletenessStatus.Complete, reasons: [],
      },
      recoveredAfterRestart: false,
    });
    expect(handoff.file_summary!.scan_status).toBe("truncated");
    expect(handoff.known_risks).toContain("File change scan truncated; not all changes recorded");
  });

  it("truncates evidence refs when exceeding limit", () => {
    const run = makeRun();
    const events: ThreadEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push(makeEvent(ThreadEventType.CommandCompleted, {
        run_id: run.id, outcome: CommandOutcome.Succeeded, exit_code: 0,
      }));
    }
    const handoff = buildHandoff({
      run, issueGoal: "Goal", events, fileChanges: [],
      fileScanStatus: "complete",
      completeness: {
        commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete,
        file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [],
      },
      recoveredAfterRestart: false,
    });
    expect(handoff.evidence_refs_truncated).toBe(true);
    expect(handoff.evidence_ref_count).toBe(101);
  });

  it("produces deterministic next action for same status", () => {
    const run = makeRun({ status: RunStatus.Completed });
    const h1 = buildHandoff({
      run, issueGoal: "G", events: [], fileChanges: [], fileScanStatus: "complete",
      completeness: { commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete, file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [] },
      recoveredAfterRestart: false,
    });
    const h2 = buildHandoff({
      run, issueGoal: "G", events: [], fileChanges: [], fileScanStatus: "complete",
      completeness: { commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete, file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [] },
      recoveredAfterRestart: false,
    });
    expect(h1.next_expected_action).toBe(h2.next_expected_action);
  });
});

describe("Trace Completeness Builder (T022)", () => {
  it("returns complete when all evidence present", () => {
    const run = makeRun();
    const events = [
      makeEvent(ThreadEventType.CommandStarted, { run_id: run.id }),
      makeEvent(ThreadEventType.CommandCompleted, { run_id: run.id, outcome: CommandOutcome.Succeeded }),
      makeEvent(ThreadEventType.FileChangeSummary, {
        run_id: run.id, scan_truncated: false,
        added_count: 0, modified_count: 0, deleted_count: 0, renamed_count: 0,
        total_count: 0, preview: [], preview_truncated: false,
      }),
    ];
    const state = makeTraceState();
    const completeness = buildTraceCompleteness(run, events, state, 0);
    expect(completeness.commands).toBe(TraceCompletenessStatus.Complete);
    expect(completeness.verification).toBe(TraceCompletenessStatus.Complete);
    expect(completeness.file_changes).toBe(TraceCompletenessStatus.Complete);
    expect(completeness.refs).toBe(TraceCompletenessStatus.Complete);
  });

  it("returns partial when started without completed", () => {
    const run = makeRun();
    const events = [makeEvent(ThreadEventType.CommandStarted, { run_id: run.id })];
    const state = makeTraceState();
    const completeness = buildTraceCompleteness(run, events, state, 0);
    expect(completeness.commands).toBe(TraceCompletenessStatus.Partial);
  });

  it("returns unavailable when adapter unsupported", () => {
    const run = makeRun();
    const state = makeTraceState({ command_trace_capability: CommandTraceCapability.Unsupported });
    const completeness = buildTraceCompleteness(run, [], state, 0);
    expect(completeness.commands).toBe(TraceCompletenessStatus.Unavailable);
  });

  it("returns unavailable when baseline failed", () => {
    const run = makeRun();
    const state = makeTraceState({ baseline_status: BaselineStatus.Failed });
    const completeness = buildTraceCompleteness(run, [], state, 0);
    expect(completeness.file_changes).toBe(TraceCompletenessStatus.Unavailable);
  });

  it("returns unavailable when no trace state", () => {
    const run = makeRun();
    const completeness = buildTraceCompleteness(run, [], null, 0);
    expect(completeness.file_changes).toBe(TraceCompletenessStatus.Unavailable);
  });

  it("returns unavailable when scan failed event present (T090)", () => {
    const run = makeRun();
    const events = [
      makeEvent(ThreadEventType.FileChangeScanFailed, { run_id: run.id, reason_code: "permission_denied" }),
    ];
    const state = makeTraceState({ baseline_status: BaselineStatus.Captured });
    const completeness = buildTraceCompleteness(run, events, state, 0);
    expect(completeness.file_changes).toBe(TraceCompletenessStatus.Unavailable);
  });

  it("returns partial when final scan was truncated (T090)", () => {
    const run = makeRun();
    const events = [
      makeEvent(ThreadEventType.FileChangeSummary, {
        run_id: run.id, scan_truncated: true,
        added_count: 2, total_count: 2, preview: [],
        preview_truncated: false,
      }),
    ];
    const state = makeTraceState({ baseline_status: BaselineStatus.Captured });
    const completeness = buildTraceCompleteness(run, events, state, 0);
    expect(completeness.file_changes).toBe(TraceCompletenessStatus.Partial);
  });

  it("verification is always Complete regardless of test events (T097)", () => {
    const run = makeRun();
    // With TestCompleted events
    const c1 = buildTraceCompleteness(run, [
      makeEvent(ThreadEventType.TestCompleted, { run_id: run.id }),
    ], makeTraceState(), 0);
    expect(c1.verification).toBe(TraceCompletenessStatus.Complete);
    // Without any test events
    const c2 = buildTraceCompleteness(run, [], makeTraceState(), 0);
    expect(c2.verification).toBe(TraceCompletenessStatus.Complete);
  });

  it("aggregateIssueCompleteness returns no_started_runs when no applicable runs", () => {
    const result = aggregateIssueCompleteness([
      { run: makeRun(), completeness: null },
    ]);
    expect(result.commands).toBe(TraceCompletenessStatus.Unavailable);
    expect(result.reasons).toContain("no_started_runs");
  });

  it("aggregateIssueCompleteness takes worst-of across runs", () => {
    const result = aggregateIssueCompleteness([
      { run: makeRun(), completeness: { commands: TraceCompletenessStatus.Complete, verification: TraceCompletenessStatus.Complete, file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: [] } },
      { run: makeRun({ id: "run_test2" }), completeness: { commands: TraceCompletenessStatus.Partial, verification: TraceCompletenessStatus.Unavailable, file_changes: TraceCompletenessStatus.Complete, refs: TraceCompletenessStatus.Complete, reasons: ["x"] } },
    ]);
    expect(result.commands).toBe(TraceCompletenessStatus.Partial);
    expect(result.verification).toBe(TraceCompletenessStatus.Unavailable);
    expect(result.file_changes).toBe(TraceCompletenessStatus.Complete);
  });
});
