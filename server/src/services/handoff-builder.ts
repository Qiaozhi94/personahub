import type {
  ThreadEvent,
  Run,
  TraceCompleteness,
} from "@personahub/shared/types";
import {
  ThreadEventType,
  RunStatus,
  CommandOutcome,
  VerificationResult,
  FileChangeType,
} from "@personahub/shared/types";
import { TRACE_LIMITS } from "../runtime/trace/constants.js";

export interface HandoffFileChange {
  path: string;
  change_type: FileChangeType;
}

export interface HandoffBuildInput {
  run: Run;
  issueGoal: string;
  events: ThreadEvent[];
  fileChanges: HandoffFileChange[];
  fileScanStatus: "complete" | "failed" | "truncated";
  completeness: TraceCompleteness;
  recoveredAfterRestart: boolean;
}

export interface HandoffPayload {
  issue_id: string;
  thread_id: string;
  run_id: string;
  workspace_id: string;
  issue_goal: string;
  run_status: string;
  summary: string;
  completed_work: string[];
  command_summary: {
    total: number;
    succeeded: number;
    failed: number;
    blocked: number;
    unknown: number;
  };
  verification_summary: {
    passed: number;
    failed: number;
    unknown: number;
  };
  file_summary: {
    total: number;
    scan_status: string;
    ref: string;
  } | null;
  known_risks: string[];
  missing_evidence: string[];
  next_expected_action: string;
  evidence_ref_count: number;
  evidence_refs_truncated: boolean;
}

export function buildHandoff(input: HandoffBuildInput): HandoffPayload {
  const { run, events, fileChanges, fileScanStatus, completeness, recoveredAfterRestart } = input;

  const commandCompleted = events.filter((e) => e.type === ThreadEventType.CommandCompleted);
  const testCompleted = events.filter((e) => e.type === ThreadEventType.TestCompleted);

  const commandSummary = summarizeCommands(commandCompleted);
  const verificationSummary = summarizeVerification(testCompleted);
  const completedWork = summarizeCompletedWork(commandCompleted, testCompleted, fileChanges);
  const knownRisks = identifyRisks(run, commandCompleted, fileScanStatus, completeness, recoveredAfterRestart);
  const missingEvidence = identifyMissingEvidence(completeness, fileScanStatus);
  const nextAction = determineNextAction(run);
  const fileSummary = buildFileSummary(run.id, fileChanges, fileScanStatus);

  const evidenceRefs = collectEvidenceRefs(commandCompleted, testCompleted, fileSummary);
  const truncated = evidenceRefs.length > TRACE_LIMITS.handoffEvidenceRefsMax;
  const trimmedRefs = truncated
    ? evidenceRefs.slice(0, TRACE_LIMITS.handoffEvidenceRefsMax)
    : evidenceRefs;

  return {
    issue_id: run.issue_id,
    thread_id: run.thread_id,
    run_id: run.id,
    workspace_id: run.workspace_id,
    issue_goal: input.issueGoal,
    run_status: run.status,
    summary: buildSummary(run, commandSummary, verificationSummary, fileChanges),
    completed_work: completedWork,
    command_summary: commandSummary,
    verification_summary: verificationSummary,
    file_summary: fileSummary,
    known_risks: knownRisks,
    missing_evidence: missingEvidence,
    next_expected_action: nextAction,
    evidence_ref_count: evidenceRefs.length,
    evidence_refs_truncated: truncated,
  };
}

function summarizeCommands(events: ThreadEvent[]) {
  const summary = { total: events.length, succeeded: 0, failed: 0, blocked: 0, unknown: 0 };
  for (const e of events) {
    const outcome = e.payload_json.outcome as CommandOutcome | undefined;
    if (outcome === CommandOutcome.Succeeded) summary.succeeded++;
    else if (outcome === CommandOutcome.Failed) summary.failed++;
    else if (outcome === CommandOutcome.Blocked) summary.blocked++;
    else summary.unknown++;
  }
  return summary;
}

function summarizeVerification(events: ThreadEvent[]) {
  const summary = { passed: 0, failed: 0, unknown: 0 };
  for (const e of events) {
    const result = e.payload_json.result as VerificationResult | undefined;
    if (result === VerificationResult.Passed) summary.passed++;
    else if (result === VerificationResult.Failed) summary.failed++;
    else summary.unknown++;
  }
  return summary;
}

function summarizeCompletedWork(
  commands: ThreadEvent[],
  tests: ThreadEvent[],
  fileChanges: HandoffFileChange[],
): string[] {
  const work: string[] = [];
  const succeeded = commands.filter(
    (e) => e.payload_json.outcome === CommandOutcome.Succeeded,
  ).length;
  if (succeeded > 0) {
    work.push(`${succeeded} command${succeeded > 1 ? "s" : ""} completed`);
  }
  const passed = tests.filter(
    (e) => e.payload_json.result === VerificationResult.Passed,
  ).length;
  if (passed > 0) {
    work.push(`${passed} verification${passed > 1 ? "s" : ""} passed`);
  }
  if (fileChanges.length > 0) {
    work.push(`${fileChanges.length} file${fileChanges.length > 1 ? "s" : ""} changed`);
  }
  return work;
}

function identifyRisks(
  run: Run,
  commands: ThreadEvent[],
  fileScanStatus: string,
  completeness: TraceCompleteness,
  recovered: boolean,
): string[] {
  const risks: string[] = [];

  const failed = commands.filter(
    (e) => e.payload_json.outcome === CommandOutcome.Failed,
  ).length;
  if (failed > 0) {
    risks.push(`${failed} command(s) failed during execution`);
  }

  if (fileScanStatus === "failed") {
    risks.push("File change scan failed; file evidence unavailable");
  }
  if (fileScanStatus === "truncated") {
    risks.push("File change scan truncated; not all changes recorded");
  }

  if (completeness.commands === "partial") {
    risks.push("Command trace incomplete: some commands lack completion signal");
  }

  if (recovered) {
    risks.push("Run was finalized after server restart; evidence may be incomplete");
  }

  return risks;
}

function identifyMissingEvidence(
  completeness: TraceCompleteness,
  fileScanStatus: string,
): string[] {
  const missing: string[] = [];
  if (completeness.commands === "unavailable") {
    missing.push("command_trace_unavailable");
  }
  if (completeness.file_changes === "unavailable" || fileScanStatus === "failed") {
    missing.push("file_change_evidence_unavailable");
  }
  if (completeness.refs === "partial") {
    missing.push("some_evidence_refs_unresolved");
  }
  return missing;
}

function determineNextAction(run: Run): string {
  switch (run.status) {
    case RunStatus.Completed:
      return "Validate the implementation against the issue goal.";
    case RunStatus.Failed:
      return "Inspect failure details and resume work to resolve the error.";
    case RunStatus.Cancelled:
      return "Resume work from where the cancelled run left off.";
    case RunStatus.Interrupted:
      return "Resolve the interruption cause and resume work.";
    default:
      return "Review run results and determine next steps.";
  }
}

function buildFileSummary(
  runId: string,
  fileChanges: HandoffFileChange[],
  fileScanStatus: string,
): { total: number; scan_status: string; ref: string } | null {
  if (fileScanStatus === "failed") {
    return null;
  }
  return {
    total: fileChanges.length,
    scan_status: fileScanStatus,
    ref: `file-change-set:${runId}`,
  };
}

function collectEvidenceRefs(
  commands: ThreadEvent[],
  tests: ThreadEvent[],
  fileSummary: { ref: string } | null,
): string[] {
  const refs: string[] = [];
  for (const cmd of commands) {
    refs.push(`event:${cmd.id}`);
  }
  for (const test of tests) {
    refs.push(`event:${test.id}`);
  }
  if (fileSummary) {
    refs.push(fileSummary.ref);
  }
  return [...new Set(refs)];
}

function buildSummary(
  run: Run,
  commandSummary: { total: number; succeeded: number; failed: number },
  verificationSummary: { passed: number; failed: number },
  fileChanges: HandoffFileChange[],
): string {
  const parts: string[] = [];
  parts.push(`Run ${run.status}`);
  if (commandSummary.total > 0) {
    parts.push(`${commandSummary.succeeded}/${commandSummary.total} commands succeeded`);
  }
  if (verificationSummary.passed > 0 || verificationSummary.failed > 0) {
    parts.push(`${verificationSummary.passed} tests passed, ${verificationSummary.failed} failed`);
  }
  if (fileChanges.length > 0) {
    parts.push(`${fileChanges.length} files changed`);
  }
  return parts.join("; ") + ".";
}
