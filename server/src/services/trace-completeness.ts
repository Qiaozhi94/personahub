import type {
  ThreadEvent,
  Run,
  TraceCompleteness,
  TraceCompletenessStatus,
  RunTraceState,
} from "@personahub/shared/types";
import {
  ThreadEventType,
  CommandTraceCapability,
  BaselineStatus,
  TraceCompletenessStatus as TCS,
} from "@personahub/shared/types";

export function buildTraceCompleteness(
  run: Run,
  events: ThreadEvent[],
  traceState: RunTraceState | null,
  evidenceResolutionFailures: number,
): TraceCompleteness {
  const commands = assessCommands(events, traceState);
  const verification = assessVerification(events);
  const fileChanges = assessFileChanges(events, traceState);
  const refs = assessRefs(evidenceResolutionFailures);

  const reasons: string[] = [];
  if (commands.status !== TCS.Complete) {
    reasons.push(`commands:${commands.status}:${run.id}`);
  }
  if (verification.status !== TCS.Complete) {
    reasons.push(`verification:${verification.status}:${run.id}`);
  }
  if (fileChanges.status !== TCS.Complete) {
    reasons.push(`file_changes:${fileChanges.status}:${run.id}`);
  }
  if (refs.status !== TCS.Complete) {
    reasons.push(`refs:${refs.status}:${run.id}`);
  }

  return {
    commands: commands.status,
    verification: verification.status,
    file_changes: fileChanges.status,
    refs: refs.status,
    reasons,
  };
}

function assessCommands(
  events: ThreadEvent[],
  traceState: RunTraceState | null,
): { status: TraceCompletenessStatus } {
  const capability = traceState?.command_trace_capability ?? CommandTraceCapability.Unknown;
  if (capability === CommandTraceCapability.Unsupported) {
    return { status: TCS.Unavailable };
  }

  const started = events.filter((e) => e.type === ThreadEventType.CommandStarted);
  const completed = events.filter((e) => e.type === ThreadEventType.CommandCompleted);

  if (started.length === 0 && completed.length === 0) {
    return { status: TCS.Complete };
  }

  if (started.length > completed.length) {
    return { status: TCS.Partial };
  }

  return { status: TCS.Complete };
}

function assessVerification(_events: ThreadEvent[]): { status: TraceCompletenessStatus } {
  // Verification completeness is always Complete by design:
  // TestCompleted events are recorded completely, or no verification
  // was attempted. Actual pass/fail classification is in handoff builder.
  return { status: TCS.Complete };
}

function assessFileChanges(
  events: ThreadEvent[],
  traceState: RunTraceState | null,
): { status: TraceCompletenessStatus } {
  if (!traceState || traceState.baseline_status !== BaselineStatus.Captured) {
    return { status: TCS.Unavailable };
  }
  if (events.some((e) => e.type === ThreadEventType.FileChangeScanFailed)) {
    return { status: TCS.Unavailable };
  }
  const summary = events.find((e) => e.type === ThreadEventType.FileChangeSummary);
  if (summary?.payload_json.scan_truncated === true) {
    return { status: TCS.Partial };
  }
  return { status: summary ? TCS.Complete : TCS.Partial };
}

function assessRefs(failures: number): { status: TraceCompletenessStatus } {
  if (failures > 0) {
    return { status: TCS.Partial };
  }
  return { status: TCS.Complete };
}

export function aggregateIssueCompleteness(
  runCompletenesses: { run: Run; completeness: TraceCompleteness | null }[],
): TraceCompleteness {
  const applicable = runCompletenesses.filter(
    (rc) => rc.completeness !== null,
  );

  if (applicable.length === 0) {
    return {
      commands: TCS.Unavailable,
      verification: TCS.Unavailable,
      file_changes: TCS.Unavailable,
      refs: TCS.Unavailable,
      reasons: ["no_started_runs"],
    };
  }

  const worst = (a: TraceCompletenessStatus, b: TraceCompletenessStatus): TraceCompletenessStatus => {
    const order: TraceCompletenessStatus[] = [TCS.Complete, TCS.Partial, TCS.Unavailable];
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
  };

  const reasons: string[] = [];
  for (const rc of applicable) {
    if (rc.completeness!.reasons.length > 0) {
      reasons.push(...rc.completeness!.reasons);
    }
  }

  return {
    commands: applicable.reduce((acc, rc) => worst(acc, rc.completeness!.commands), TCS.Complete as TraceCompletenessStatus),
    verification: applicable.reduce((acc, rc) => worst(acc, rc.completeness!.verification), TCS.Complete as TraceCompletenessStatus),
    file_changes: applicable.reduce((acc, rc) => worst(acc, rc.completeness!.file_changes), TCS.Complete as TraceCompletenessStatus),
    refs: applicable.reduce((acc, rc) => worst(acc, rc.completeness!.refs), TCS.Complete as TraceCompletenessStatus),
    reasons,
  };
}
