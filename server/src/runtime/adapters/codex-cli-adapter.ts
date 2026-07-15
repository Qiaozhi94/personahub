import { spawn, type ChildProcess } from "node:child_process";
import type { AdapterConfig, FailureReason } from "@personahub/shared/types";
import { FailureReason as FR } from "@personahub/shared/types";
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
import { spawnSync } from "node:child_process";

const GIT_PUSH_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
];

function isGitPushCommand(command: unknown): boolean {
  if (typeof command === "string") {
    return GIT_PUSH_PATTERNS.some((p) => p.test(command));
  }
  if (Array.isArray(command)) {
    const joined = command.join(" ");
    return GIT_PUSH_PATTERNS.some((p) => p.test(joined));
  }
  return false;
}

function isGitPushOutput(text: string): boolean {
  return GIT_PUSH_PATTERNS.some((p) => p.test(text));
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg && "id" in msg;
}

function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

function getResult(response: JsonRpcResponse): Record<string, unknown> {
  return (response.result ?? {}) as Record<string, unknown>;
}

export class CodexCliAdapter implements AgentAdapter {
  readonly provider = "codex";
  readonly capabilities: AgentAdapterCapabilities = {
    provider: "codex",
    supportsApprovalHook: true,
    executionTimeoutMs: DEFAULT_EXECUTION_TIMEOUT_MS,
  };

  async validate(config: AdapterConfig): Promise<AdapterValidationResult> {
    const command = config.command?.trim();
    if (!command) {
      return { available: false, errorMessage: "Command is empty." };
    }
    try {
      const result = spawnSync(command, ["--version"], {
        timeout: 10_000,
        encoding: "utf-8",
        shell: process.platform === "win32",
      });
      if (result.error) {
        return { available: false, errorMessage: `Command not found: ${command}` };
      }
      if (result.status !== 0) {
        return { available: false, errorMessage: `Command exited with code ${result.status}` };
      }
      return { available: true, errorMessage: null };
    } catch (err) {
      return { available: false, errorMessage: `Failed to validate command: ${String(err)}` };
    }
  }

  async start(input: AgentRunInput): Promise<RunHandle> {
    const outputCallbacks: Array<(event: RunOutputChunk) => void> = [];
    const exitCallbacks: Array<(result: RunExitResult) => void> = [];
    let exited = false;
    let pendingExit: RunExitResult | null = null;
    let sequence = 0;
    let nextRequestId = 1;
    const pendingRequests = new Map<number, (response: JsonRpcResponse) => void>();
    let childProcess: ChildProcess | null = null;
    let lineBuffer = "";
    let turnCompleted = false;
    let escalationTriggered = false;
    let gitPushAttempted = false;
    let credentialFailureDetected = false;
    let threadId: string | null = null;
    let turnId: string | null = null;

    const callExit = (result: RunExitResult) => {
      if (exited) return;
      exited = true;
      pendingExit = result;
      for (const cb of exitCallbacks) {
        cb(result);
      }
    };

    const finish = (result: RunExitResult): void => {
      try { childProcess?.stdin?.end(); } catch { void 0; }
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

    const sendMessage = (msg: Record<string, unknown> | JsonRpcRequest) => {
      if (!childProcess || !childProcess.stdin || childProcess.stdin.destroyed) return;
      childProcess.stdin.write(JSON.stringify(msg) + "\n");
    };

    const sendRequest = (method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> => {
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        pendingRequests.set(id, (response: JsonRpcResponse) => {
          if (response.error) {
            reject(new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`));
          } else {
            resolve(response);
          }
        });
        const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
        sendMessage(msg);
      });
    };

    const sendResponse = (id: number, result: Record<string, unknown>) => {
      sendMessage({ jsonrpc: "2.0", id, result });
    };

    const handleMessage = (msg: JsonRpcMessage) => {
      if (isResponse(msg)) {
        const handler = pendingRequests.get(msg.id);
        if (handler) {
          pendingRequests.delete(msg.id);
          handler(msg);
        }
        return;
      }

      if (isRequest(msg)) {
        if (msg.method === "item/commandExecution/requestApproval" || msg.method === "item/fileChange/requestApproval") {
          const command = msg.params?.command ?? msg.params?.commandText ?? msg.params?.command_line;
          if (isGitPushCommand(command)) {
            gitPushAttempted = true;
            sendResponse(msg.id, { decision: "cancel" });
            escalationTriggered = true;
            finish({
              exitCode: null,
              failureReason: FR.PreExecutionApprovalRejected,
              errorMessage: typeof command === "string" ? command : JSON.stringify(command),
            });
          } else {
            sendResponse(msg.id, { decision: "accept" });
          }
        }
        return;
      }

      if (isNotification(msg)) {
        if (msg.method === "turn/completed") {
          turnCompleted = true;
          const turn = msg.params?.turn as { status?: string; error?: { message?: string } } | undefined;
          if (turn?.status === "completed" || !turn?.status) {
            finish({ exitCode: 0, failureReason: null, errorMessage: null });
          } else {
            finish({
              exitCode: null,
              failureReason: FR.OutputParseFailed,
              errorMessage: turn.error?.message ?? `Codex turn ${turn.status}`,
            });
          }
          return;
        }

        // v2 protocol notification names
        if (msg.method === "item/agentMessage/delta" || msg.method === "item/commandExecution/outputDelta") {
          const delta = msg.params?.delta ?? msg.params?.text ?? "";
          if (typeof delta === "string" && delta.length > 0) {
            emitOutput("stdout", delta);
            if (msg.method === "item/commandExecution/outputDelta") {
              if (!escalationTriggered && isGitPushOutput(delta) && !input.workspace.pushCredentialsEnabled) {
                escalationTriggered = true;
                finish({
                  exitCode: null,
                  failureReason: FR.PostHocEscalation,
                  errorMessage: delta.trim().slice(0, 200),
                });
              }
            }
          }
          return;
        }
      }
    };

    try {
      childProcess = spawn(
        input.adapterConfig.command,
        [...input.adapterConfig.args, "app-server", "--listen", "stdio://"],
        {
          cwd: input.workspace.localPath,
          env: buildChildEnv({
            push_credentials_enabled: input.workspace.pushCredentialsEnabled,
            local_path: input.workspace.localPath,
          }),
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        },
      );
    } catch (err) {
      callExit({
        exitCode: null,
        failureReason: FR.SpawnFailed,
        errorMessage: `Failed to spawn process: ${String(err)}`,
      });
      return createHandle();
    }

    if (!childProcess || !childProcess.pid) {
      callExit({
        exitCode: null,
        failureReason: FR.SpawnFailed,
        errorMessage: "Failed to spawn process: no PID",
      });
      return createHandle();
    }

    childProcess.stdout?.setEncoding("utf-8");
    childProcess.stderr?.setEncoding("utf-8");

    childProcess.stdout?.on("data", (data: string) => {
      lineBuffer += data;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          handleMessage(msg);
        } catch {
          void 0;
        }
      }
    });

    childProcess.stderr?.on("data", (data: string) => {
      const credPattern = /permission denied|authentication failed|could not read|no credentials|403|401/i;
      if (gitPushAttempted && credPattern.test(data)) {
        credentialFailureDetected = true;
      }
      emitOutput("stderr", data);
    });

    childProcess.on("error", (err) => {
      callExit({
        exitCode: null,
        failureReason: FR.SpawnFailed,
        errorMessage: `Process error: ${err.message}`,
      });
    });

    childProcess.on("exit", (code, signal) => {
      if (!exited && !turnCompleted) {
        if (escalationTriggered) return;
        if (code !== null && code !== 0) {
          const credentialPatterns = /permission denied|authentication failed|could not read|no credentials|403|401/i;
          const stderrSeen = lineBuffer;
          const isCredentialIssue = gitPushAttempted
            && !input.workspace.pushCredentialsEnabled
            && credentialFailureDetected;
          const failureReason: FailureReason = isCredentialIssue
            ? FR.CredentialIsolationBlocked
            : FR.AdapterExitNonzero;
          callExit({
            exitCode: code,
            failureReason,
            errorMessage: `Process exited with code ${code}`,
          });
        } else if (signal) {
          callExit({
            exitCode: null,
            failureReason: FR.SpawnFailed,
            errorMessage: `Process killed by signal ${signal}`,
          });
        } else {
          callExit({ exitCode: code ?? 0, failureReason: null, errorMessage: null });
        }
      }
    });

    sendRequest("initialize", {
      clientInfo: { name: "personahub", version: "0.1.0" },
    }).then(() => {
      return sendRequest("thread/start", {
        cwd: input.workspace.localPath,
        sandbox: "workspace-write",
        approvalPolicy: "untrusted",
      });
    }).then((threadResponse) => {
      const threadResult = getResult(threadResponse);
      const thread = threadResult.thread as { id?: string } | undefined;
      if (thread?.id) {
        threadId = thread.id;
      }
      const text = input.instructions + "\n\n" + input.context;
      return sendRequest("turn/start", {
        threadId: threadId,
        input: [{ type: "text", text }],
      });
    }).then((turnResponse) => {
      const turnResult = getResult(turnResponse);
      const turn = turnResult.turn as { id?: string } | undefined;
      if (turn?.id) {
        turnId = turn.id;
      }
    }).catch((err) => {
      finish({
        exitCode: null,
        failureReason: FR.OutputParseFailed,
        errorMessage: `Codex protocol startup failed: ${String(err)}`,
      });
    });

    function createHandle(): RunHandle {
      return {
        runId: input.runId,
        onOutput(cb: (event: RunOutputChunk) => void): void {
          outputCallbacks.push(cb);
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
            const interruptParams: Record<string, unknown> = {};
            if (threadId) interruptParams.threadId = threadId;
            if (turnId) interruptParams.turnId = turnId;
            const interruptPromise = sendRequest("turn/interrupt", interruptParams);
            const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, CANCEL_TIMEOUT_MS));
            await Promise.race([interruptPromise, timeoutPromise]);
          } catch {
            void 0;
          }
          if (!exited) {
            finish({ exitCode: null, failureReason: null, errorMessage: null });
          }
        },
      };
    }

    return createHandle();
  }
}
