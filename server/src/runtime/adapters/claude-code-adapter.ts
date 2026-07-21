import { spawn, type ChildProcess } from "node:child_process";
import { CliProvider, AdapterAuthType, type AdapterConfig, type FailureReason, type RunTraceSignal } from "@personahub/shared/types";
import { FailureReason as FR, CommandOutcome } from "@personahub/shared/types";
import type {
  AgentAdapter,
  AgentAdapterCapabilities,
  AgentRunInput,
  AdapterValidationResult,
  RunHandle,
  RunOutputChunk,
  RunExitResult,
} from "../types.js";
import { DEFAULT_EXECUTION_TIMEOUT_MS, CANCEL_TIMEOUT_MS } from "../types.js";
import { buildChildEnv } from "../workspace-context.js";
import { resolveExecutable } from "../executable-resolver.js";
import { validateClaudeCommand } from "./claude-protocol.js";
import { isGitPushCommand, isGitPushOutput, CREDENTIAL_FAILURE_PATTERN } from "./shell-command-patterns.js";
import { ClaudeTraceNormalizer } from "./claude-code-normalizer.js";
import { writeClaudePreToolUseHook, PUSH_CREDENTIALS_ENV_VAR } from "./claude-pretooluse-hook.js";

const CLAUDE_FINAL_MESSAGE_MAX_BYTES = 64 * 1024;

function truncateFinalMessage(text: string | null, maxBytes: number = CLAUDE_FINAL_MESSAGE_MAX_BYTES): string | null {
  if (text === null) return null;
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly provider = CliProvider.ClaudeCode;
  readonly capabilities: AgentAdapterCapabilities = {
    provider: CliProvider.ClaudeCode,
    supportsApprovalHook: true,
    supportsStructuredTrace: true,
    supportsFinalMessage: true,
    executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,
  };

  async validate(config: AdapterConfig): Promise<AdapterValidationResult> {
    return validateClaudeCommand(config);
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
    const normalizer = new ClaudeTraceNormalizer(input.workspace.localPath);

    const callExit = (result: RunExitResult) => {
      if (exited) return;
      exited = true;
      pendingExit = result;
      for (const cb of exitCallbacks) {
        cb(result);
      }
    };

    const failSpawn = (errorMessage: string): RunHandle => {
      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage, finalMessage: null });
      return createHandle();
    };

    const finish = (result: RunExitResult): void => {
      if (childProcess && childProcess.exitCode === null && !childProcess.killed) {
        try { childProcess.kill("SIGKILL"); } catch { void 0; }
      }
      callExit(result);
    };

    const emitOutput = (stream: "stdout" | "stderr", chunk: string) => {
      sequence++;
      for (const cb of outputCallbacks) {
        cb({ stream, chunk, sequence });
      }
    };

    // T009a: resolve .cmd/.bat shims to a real executable before spawning
    // with shell:false. Claude is a real native exe on the probed install
    // (server/tests/helpers/claude-protocol-fixtures.md T001), but other
    // installs may differ — never assume, always resolve.
    const { resolved, errorMessage: resolveError } = resolveExecutable(input.adapterConfig.command);
    if (!resolved) {
      return failSpawn(resolveError ?? `Failed to resolve executable: ${input.adapterConfig.command}`);
    }

    // design §6.3/T040: register a PreToolUse hook via --settings so a git
    // push is intercepted before it runs, not just blocked at the credential
    // layer after the fact. Hook write failure degrades capability rather
    // than failing the Run — child-env credential isolation (buildChildEnv)
    // still blocks the push even with no hook registered.
    let hookCleanup: (() => void) | null = null;
    const extraArgs: string[] = [];
    try {
      const hook = writeClaudePreToolUseHook(input.runId);
      hookCleanup = hook.cleanup;
      extraArgs.push("--settings", hook.settingsArg);
    } catch {
      hookCleanup = null;
    }

    const childEnv = buildChildEnv(
      { push_credentials_enabled: input.workspace.pushCredentialsEnabled, local_path: input.workspace.localPath },
      { cli_provider: CliProvider.ClaudeCode, auth_type: AdapterAuthType.OAuth },
    );
    childEnv[PUSH_CREDENTIALS_ENV_VAR] = input.workspace.pushCredentialsEnabled ? "1" : "0";

    try {
      childProcess = spawn(
        resolved.executable,
        [...resolved.prefixArgs, ...input.adapterConfig.args, "-p", "--output-format", "stream-json", "--verbose", ...extraArgs],
        {
          cwd: input.workspace.localPath,
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        },
      );
    } catch (err) {
      hookCleanup?.();
      return failSpawn(`Failed to spawn process: ${String(err)}`);
    }

    if (!childProcess || !childProcess.pid) {
      hookCleanup?.();
      return failSpawn("Failed to spawn process: no PID");
    }

    childProcess.stdout?.setEncoding("utf-8");
    childProcess.stderr?.setEncoding("utf-8");

    const handleGitPushBlocked = (command: string | undefined, denialText: string | null) => {
      if (escalationTriggered) return;
      if (!isGitPushCommand(command ?? "")) return;
      escalationTriggered = true;
      finish({ exitCode: null, failureReason: FR.PreExecutionApprovalRejected, errorMessage: denialText ?? "git push blocked by PreToolUse hook", finalMessage: null });
    };

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

        const event = normalizer.handleLine(parsed);

        if (event.kind === "output") {
          emitOutput("stdout", event.text);
          if (!escalationTriggered && isGitPushOutput(event.text) && !input.workspace.pushCredentialsEnabled) {
            escalationTriggered = true;
            finish({ exitCode: null, failureReason: FR.PostHocEscalation, errorMessage: event.text.trim().slice(0, 200), finalMessage: null });
          }
          continue;
        }

        if (event.kind === "trace") {
          for (const cb of traceCallbacks) {
            cb(event.signal);
          }
          if (event.signal.type === "command_started" && isGitPushCommand(event.signal.command)) {
            gitPushAttempted = true;
          }
          if (event.signal.type === "command_completed") {
            if (event.signal.outcome === CommandOutcome.Blocked) {
              handleGitPushBlocked(event.signal.command, event.signal.outputSummary);
            } else if (event.signal.outcome === CommandOutcome.Failed) {
              handleCredentialFailure(event.signal.command, event.signal.outputSummary);
            }
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
    });

    childProcess.stderr?.on("data", (data: string) => {
      if (gitPushAttempted && CREDENTIAL_FAILURE_PATTERN.test(data)) {
        credentialFailureDetected = true;
      }
      emitOutput("stderr", data);
    });

    childProcess.on("error", (err) => {
      hookCleanup?.();
      callExit({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage: `Process error: ${err.message}`, finalMessage: null });
    });

    childProcess.on("exit", (code, signal) => {
      hookCleanup?.();
      if (exited) return;
      // T002: SIGINT (our own cancel(), or an external kill) never produces a
      // terminal `result` line — this combination itself is the terminal
      // "cancelled" state, not a failure to wait out.
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

    const text = input.instructions + "\n\n" + input.context;
    try {
      childProcess.stdin?.write(text);
      childProcess.stdin?.end();
    } catch (err) {
      finish({ exitCode: null, failureReason: FR.SpawnFailed, errorMessage: `Failed to write stdin: ${String(err)}`, finalMessage: null });
    }

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
