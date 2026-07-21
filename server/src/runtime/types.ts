import type { AdapterConfig, RunStatus, FailureReason, AdapterAuthType } from "@personahub/shared/types";
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
  /**
   * model_provider/default_model/auth_type/api_key are only meaningful for
   * OpenCode (design §6.4: `-m provider/model` is mandatory on every
   * dispatch, not just validate(); api_key mode needs the raw secret to
   * build AuthMaterial). Codex/Claude adapters ignore them (OAuth-only).
   */
  adapterConfig: {
    command: string;
    args: string[];
    model_provider: string | null;
    default_model: string | null;
    auth_type: AdapterAuthType;
    api_key: string | null;
  };
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
  finalMessage: string | null;
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
  supportsFinalMessage: boolean;
  executionTimeoutMs: number;
}

export interface AdapterValidationResult {
  available: boolean;
  errorMessage: string | null;
}

export interface AgentAdapter {
  provider: string;
  capabilities: AgentAdapterCapabilities;
  /**
   * `config` is the secret-safe public DTO (never carries api_key). `apiKey`
   * is passed separately, straight from the repository record, only for
   * providers whose validate() genuinely needs the raw secret to probe
   * (OpenCode api_key mode) — OAuth-only adapters (Codex, Claude) ignore it.
   */
  validate(config: AdapterConfig, apiKey?: string | null): Promise<AdapterValidationResult>;
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
