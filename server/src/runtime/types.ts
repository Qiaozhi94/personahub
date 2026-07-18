import type { AdapterConfig, RunStatus, FailureReason } from "@personahub/shared/types";
import type { RunTraceSignal } from "@personahub/shared/types";

export interface WorkspaceContext {
  workspaceId: string;
  localPath: string;
  gitBranch: string | null;
  pushCredentialsEnabled: boolean;
}

export interface AgentRunInput {
  runId: string;
  issueId: string;
  threadId: string;
  workspace: WorkspaceContext;
  instructions: string;
  context: string;
  adapterConfig: { command: string; args: string[] };
}

export interface RunOutputChunk {
  stream: "stdout" | "stderr";
  chunk: string;
  sequence: number;
  sourceItemId?: string;
}

export interface RunExitResult {
  exitCode: number | null;
  failureReason: FailureReason | null;
  errorMessage: string | null;
}

export interface RunHandle {
  runId: string;
  onOutput(cb: (event: RunOutputChunk) => void): void;
  onTrace(cb: (event: RunTraceSignal) => void): void;
  onExit(cb: (result: RunExitResult) => void): void;
  cancel(): Promise<void>;
}

export interface AgentAdapterCapabilities {
  provider: string;
  supportsApprovalHook: boolean;
  supportsStructuredTrace: boolean;
  executionTimeoutMs: number;
}

export interface AdapterValidationResult {
  available: boolean;
  errorMessage: string | null;
}

export interface AgentAdapter {
  provider: string;
  capabilities: AgentAdapterCapabilities;
  validate(config: AdapterConfig): Promise<AdapterValidationResult>;
  start(input: AgentRunInput): Promise<RunHandle>;
}

export const RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
] as const;

const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "interrupted", "cancelled"],
  completed: [],
  failed: [],
  interrupted: [],
  cancelled: [],
};

export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";
}

export const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;
export const CANCEL_TIMEOUT_MS = 5_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MAX_CHUNK_BYTES = 8 * 1024;
