import { spawn, type ChildProcess } from "node:child_process";
import { CliProvider, AdapterAuthType, type AdapterConfig, type FailureReason, type RunTraceSignal } from "@personahub/shared/types";
import { FailureReason as FR, CommandOutcome } from "@personahub/shared/types";
import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentRunInput,
  AdapterValidationResult,
  AdapterValidateOptions,
  RunHandle,
  RunOutputChunk,
  RunExitResult,
} from "../types.js";
import { DEFAULT_EXECUTION_TIMEOUT_MS, CANCEL_TIMEOUT_MS } from "../types.js";
import { buildChildEnv } from "../workspace-context.js";
import { resolveExecutable } from "../executable-resolver.js";
import { validateOpenCodeCommand, buildModelFlag } from "./opencode-protocol.js";
import { isGitPushCommand, CREDENTIAL_FAILURE_PATTERN } from "./shell-command-patterns.js";
import { OpenCodeTraceNormalizer } from "./opencode-normalizer.js";
import { buildOpenCodeApiKeyAuthMaterial } from "../auth-material.js";

const OPENCODE_FINAL_MESSAGE_MAX_BYTES = 64 * 1024;

function truncateFinalMessage(text: string | null, maxBytes: number = OPENCODE_FINAL_MESSAGE_MAX_BYTES): string | null {
  if (text === null) return null;
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly provider = CliProvider.OpenCode;
  readonly capabilities: AgentAdapterCapabilities = {
    provider: CliProvider.OpenCode,
    // design §6.4/NFR-003: no message-level approval channel exists for
    // OpenCode (opencode-protocol-fixtures.md T008: no --permission-prompt-
    // style flag, no hook-registration mechanism) — credential isolation is
    // the sole defense. Never claim a capability the CLI doesn't have.
    supportsApprovalHook: false,
    // Confirmed by real probe (T006): tool_use carries metadata.exit and
    // time.start/end — a structured trace this adapter can actually supply.
    supportsStructuredTrace: true,
    supportsFinalMessage: true,
    executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,
  };

  async validate(config: AdapterConfig, apiKey?: string | null, options?: AdapterValidateOptions): Promise<AdapterValidationResult> {
    return validateOpenCodeCommand(config, apiKey, options);
  }

  async start(input: AgentRunInput): Promise<RunHandle> {
    const outputCallbacks: Array<(event: RunOutputChunk) => void> = [];
    const traceCallbacks: Array<(event: RunTraceSignal) => void> = [];
    const exitCallbacks: Array<(result: RunExitResult) => void> = [];
    let exited = false;
    let pendingExit: RunExitResult | null = null;
    let sequence = 0;
    let childProcess: ChildProcess | null = null;
    let lineBuffer = "";
    let resultSeen = false;
    let escalationTriggered = false;
    let gitPushAttempted = false;
    let credentialFailureDetected = false;
    const normalizer = new OpenCodeTraceNormalizer(input.workspace.localPath);

    const callExit = (result: RunExitResult) => {
      if (exited) return;
      exited = true;
      pendingExit = result;
      for (const cb of exitCallbacks) {
        cb(result);
      }
    };

    let authCleanup: (() => Promise<void>) | null = null;
    const runCleanup = () => {
      if (authCleanup) {
        void authCleanup();
        authCleanup = null;
      }
    };

    const failSpawn = (errorMessage: string): RunHandle => {
      runCleanup();
      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage, finalMessage: null });
      return createHandle();
    };

    const finish = (result: RunExitResult): void => {
      if (childProcess && childProcess.exitCode === null && !childProcess.killed) {
        try { childProcess.kill("SIGKILL"); } catch { void 0; }
      }
      runCleanup();
      callExit(result);
    };

    const emitOutput = (stream: "stdout" | "stderr", chunk: string) => {
      sequence++;
      for (const cb of outputCallbacks) {
        cb({ stream, chunk, sequence });
      }
    };

    if (!input.adapterConfig.model_provider || !input.adapterConfig.default_model) {
      return failSpawn("model_provider and default_model are required for opencode (used to build -m provider/model).");
    }

    // T009a: opencode is a .cmd shim on Windows, unlike Claude — always
    // resolve before spawning with shell:false.
    const { resolved, errorMessage: resolveError } = resolveExecutable(input.adapterConfig.command);
    if (!resolved) {
      return failSpawn(resolveError ?? `Failed to resolve executable: ${input.adapterConfig.command}`);
    }

    let authEnv: Record<string, string> = {};
    if (input.adapterConfig.auth_type === AdapterAuthType.ApiKey) {
      if (!input.adapterConfig.api_key) {
        return failSpawn("api_key is required for opencode API-key auth.");
      }
      try {
        const material = buildOpenCodeApiKeyAuthMaterial(input.adapterConfig.model_provider, input.adapterConfig.api_key);
        authEnv = material.env;
        authCleanup = material.cleanup;
      } catch (err) {
        return failSpawn(`Failed to build auth material: ${String(err)}`);
      }
    }

    const childEnv = {
      ...buildChildEnv(
        { push_credentials_enabled: input.workspace.pushCredentialsEnabled, local_path: input.workspace.localPath },
        { cli_provider: CliProvider.OpenCode, auth_type: input.adapterConfig.auth_type },
      ),
      ...authEnv,
    };

    // T044: OpenCode's `run` has no stdin-prompt mode (confirmed: `opencode
    // run --format json ""` errors "You must provide a message or a
    // command", and piping via stdin with no positional message is never
    // read) — the message is unavoidably a positional argv argument. The
    // api_key never goes here regardless (env-only, via authEnv above).
    const message = input.instructions + "\n\n" + input.context;

    try {
      childProcess = spawn(
        resolved.executable,
        [...resolved.prefixArgs, ...input.adapterConfig.args, "run", "--format", "json", ...buildModelFlag(input.adapterConfig), message],
        {
          cwd: input.workspace.localPath,
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        },
      );
    } catch (err) {
      return failSpawn(`Failed to spawn process: ${String(err)}`);
    }

    if (!childProcess || !childProcess.pid) {
      return failSpawn("Failed to spawn process: no PID");
    }

    childProcess.stdout?.setEncoding("utf-8");
    childProcess.stderr?.setEncoding("utf-8");
    try { childProcess.stdin?.end(); } catch { void 0; }

    const handleCredentialFailure = (command: string | undefined, outputSummary: string | null) => {
      if (escalationTriggered) return;
      if (input.workspace.pushCredentialsEnabled) return;
      if (!gitPushAttempted || !isGitPushCommand(command ?? "")) return;
      if (!outputSummary || !CREDENTIAL_FAILURE_PATTERN.test(outputSummary)) return;
      escalationTriggered = true;
      finish({ exitCode: null, failureReason: FR.CredentialIsolationBlocked, errorMessage: outputSummary.slice(0, 200), finalMessage: null });
    };

    childProcess.stdout?.on("data", (data: string) => {
      lineBuffer += data;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const events = normalizer.handleLine(parsed);
        for (const event of events) {
          if (event.kind === "output") {
            emitOutput("stdout", event.text);
            continue;
          }

          if (event.kind === "trace") {
            for (const cb of traceCallbacks) {
              cb(event.signal);
            }
            if (event.signal.type === "command_started" && isGitPushCommand(event.signal.command)) {
              gitPushAttempted = true;
            }
            if (event.signal.type === "command_completed" && event.signal.outcome === CommandOutcome.Failed) {
              handleCredentialFailure(event.signal.command, event.signal.outputSummary);
            }
            continue;
          }

          if (event.kind === "result") {
            resultSeen = true;
            if (escalationTriggered) continue;
            if (!event.isError) {
              finish({ exitCode: 0, failureReason: null, errorMessage: null, finalMessage: truncateFinalMessage(event.result) });
            } else {
              finish({ exitCode: 1, failureReason: FR.AdapterExitNonzero, errorMessage: event.result, finalMessage: null });
            }
          }
        }
      }
    });

    childProcess.stderr?.on("data", (data: string) => {
      if (gitPushAttempted && CREDENTIAL_FAILURE_PATTERN.test(data)) {
        credentialFailureDetected = true;
      }
      emitOutput("stderr", data);
    });

    childProcess.on("error", (err) => {
      runCleanup();
      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage: `Process error: ${err.message}`, finalMessage: null });
    });

    childProcess.on("exit", (code, signal) => {
      runCleanup();
      if (exited) return;
      if (code === null && signal === "SIGINT") {
        callExit({ exitCode: null, failureReason: null, errorMessage: null, finalMessage: null });
        return;
      }
      if (!resultSeen) {
        const isCredentialIssue = gitPushAttempted && !input.workspace.pushCredentialsEnabled && credentialFailureDetected;
        const failureReason: FailureReason = isCredentialIssue ? FR.CredentialIsolationBlocked : FR.SpawnFailed;
        callExit({ exitCode: code, failureReason, errorMessage: `Process exited with code ${code} before producing a result`, finalMessage: null });
      }
    });

    function createHandle(): RunHandle {
      return {
        runId: input.runId,
        onOutput(cb: (event: RunOutputChunk) => void): void {
          outputCallbacks.push(cb);
        },
        onTrace(cb: (event: RunTraceSignal) => void): void {
          traceCallbacks.push(cb);
        },
        onExit(cb: (result: RunExitResult) => void): void {
          if (pendingExit) {
            cb(pendingExit);
          } else {
            exitCallbacks.push(cb);
          }
        },
        async cancel(): Promise<void> {
          if (exited) return;
          try {
            childProcess?.kill("SIGINT");
          } catch {
            void 0;
          }
          const exitPromise = new Promise<void>((resolve) => {
            exitCallbacks.push(() => resolve());
          });
          const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, CANCEL_TIMEOUT_MS));
          await Promise.race([exitPromise, timeoutPromise]);
          if (!exited) {
            finish({ exitCode: null, failureReason: null, errorMessage: null, finalMessage: null });
          }
        },
      };
    }

    return createHandle();
  }
}
