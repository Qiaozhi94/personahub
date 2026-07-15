import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentRunInput,
  AdapterValidationResult,
  RunHandle,
  RunOutputChunk,
  RunExitResult,
} from "../types.js";
import { DEFAULT_EXECUTION_TIMEOUT_MS } from "../types.js";

export interface FakeAdapterOptions {
  outputDelayMs?: number;
  outputChunks?: string[];
  exitCode?: number;
  delayMs?: number;
  failureReason?: import("@personahub/shared/types").FailureReason | null;
  errorMessage?: string | null;
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly provider = "fake";
  readonly capabilities: AgentAdapterCapabilities = {
    provider: "fake",
    supportsApprovalHook: false,
    executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,
  };

  private defaultOptions: Required<FakeAdapterOptions>;

  constructor(options: FakeAdapterOptions = {}) {
    this.defaultOptions = {
      outputDelayMs: options.outputDelayMs ?? 50,
      outputChunks: options.outputChunks ?? ["Fake agent output line 1\n", "Fake agent output line 2\n"],
      exitCode: options.exitCode ?? 0,
      delayMs: options.delayMs ?? 100,
      failureReason: options.failureReason ?? null,
      errorMessage: options.errorMessage ?? null,
    };
  }

  async validate(): Promise<AdapterValidationResult> {
    return { available: true, errorMessage: null };
  }

  async start(input: AgentRunInput): Promise<RunHandle> {
    const opts = this.defaultOptions;
    let cancelled = false;
    let outputTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    let sequence = 0;

    const outputCallbacks: Array<(event: RunOutputChunk) => void> = [];
    const exitCallbacks: Array<(result: RunExitResult) => void> = [];

    const startTimers = () => {
      let chunkIndex = 0;
      const emitNextChunk = () => {
        if (cancelled || chunkIndex >= opts.outputChunks.length) {
          outputTimer = null;
          return;
        }
        const chunk = opts.outputChunks[chunkIndex];
        sequence++;
        for (const cb of outputCallbacks) {
          cb({ stream: "stdout", chunk, sequence });
        }
        chunkIndex++;
        outputTimer = setTimeout(emitNextChunk, opts.outputDelayMs);
      };

      outputTimer = setTimeout(emitNextChunk, opts.outputDelayMs);

      exitTimer = setTimeout(() => {
        if (cancelled) return;
        const result: RunExitResult = {
          exitCode: opts.exitCode,
          failureReason: opts.failureReason,
          errorMessage: opts.errorMessage,
        };
        for (const cb of exitCallbacks) {
          cb(result);
        }
      }, opts.delayMs);
    };

    startTimers();

    const handle: RunHandle = {
      runId: input.runId,
      onOutput(cb: (event: RunOutputChunk) => void): void {
        outputCallbacks.push(cb);
      },
      onExit(cb: (result: RunExitResult) => void): void {
        exitCallbacks.push(cb);
      },
      async cancel(): Promise<void> {
        cancelled = true;
        if (outputTimer) clearTimeout(outputTimer);
        if (exitTimer) clearTimeout(exitTimer);
      },
    };

    return handle;
  }
}
