export enum TraceSource {
  AdapterStructured = "adapter_structured",
  ApprovalHook = "approval_hook",
}

export enum EvidenceConfidence {
  Confirmed = "confirmed",
  Partial = "partial",
  Unavailable = "unavailable",
}

export enum CommandOutcome {
  Succeeded = "succeeded",
  Failed = "failed",
  Blocked = "blocked",
  Cancelled = "cancelled",
  Unknown = "unknown",
}

export enum VerificationKind {
  Test = "test",
  Lint = "lint",
  Typecheck = "typecheck",
  Build = "build",
}

export enum VerificationResult {
  Passed = "passed",
  Failed = "failed",
  Unknown = "unknown",
}

export enum FileChangeType {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
}

export enum TraceCompletenessStatus {
  Complete = "complete",
  Partial = "partial",
  Unavailable = "unavailable",
}

export enum ValidationFindingSeverity {
  Info = "info",
  Warning = "warning",
  Error = "error",
  Blocking = "blocking",
}

export enum CommandTraceCapability {
  Supported = "supported",
  Unsupported = "unsupported",
  Unknown = "unknown",
}

export enum BaselineStatus {
  Pending = "pending",
  Captured = "captured",
  Failed = "failed",
}

export const F003_THREAD_EVENT_TYPES = [
  "command.started",
  "command.completed",
  "test.completed",
  "file.change_summary",
  "file.change_scan_failed",
  "handoff.created",
  "validation.requested",
  "validation.finding",
  "validation.passed",
  "validation.failed",
  "validation.blocked",
] as const;

export type RunTraceSignal =
  | {
      type: "command_started";
      adapterItemId: string;
      command: string;
      cwd: string | null;
      startedAt: string | null;
      source: TraceSource;
    }
  | {
      type: "command_completed";
      adapterItemId: string;
      command?: string;
      cwd?: string | null;
      outcome: CommandOutcome;
      exitCode: number | null;
      durationMs: number | null;
      outputSummary: string | null;
      outputTruncated: boolean;
      source: TraceSource;
    };

export interface RunFileChange {
  id: string;
  run_id: string;
  path: string;
  previous_path: string | null;
  change_type: FileChangeType;
  created_at: string;
}

export interface EvidenceResolution {
  ref: string;
  kind: "event" | "file_change_set";
  status: "resolved" | "missing" | "truncated";
  target?: {
    id: string;
    type: string;
    thread_id: string;
    run_id?: string;
  };
  run_id?: string;
  reason?: string;
}

export interface TraceCompleteness {
  commands: TraceCompletenessStatus;
  verification: TraceCompletenessStatus;
  file_changes: TraceCompletenessStatus;
  refs: TraceCompletenessStatus;
  reasons: string[];
}

export interface RunTraceSummary {
  run: import("./index.js").Run;
  trace_applicable: boolean;
  completeness: TraceCompleteness | null;
}

export interface IssueTraceResponse {
  issue: import("./index.js").IssueWithThread;
  runs: RunTraceSummary[];
  events: import("./index.js").ThreadEvent[];
  evidence: EvidenceResolution[];
  issue_completeness: TraceCompleteness;
  next_after_event_id: string | null;
}

export interface RunEvidenceResponse {
  run: import("./index.js").Run;
  events: import("./index.js").ThreadEvent[];
  file_changes: RunFileChange[];
  evidence: EvidenceResolution[];
  completeness: TraceCompleteness;
  next_after_event_id: string | null;
  next_after_file_change_id: string | null;
}

export interface RunTraceState {
  run_id: string;
  command_trace_capability: CommandTraceCapability;
  baseline_status: BaselineStatus;
  scanner_type: string | null;
  baseline_json: string | null;
  baseline_error_code: string | null;
  baseline_captured_at: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}
