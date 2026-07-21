import { spawnSync } from "node:child_process";
import type { AdapterConfig } from "@personahub/shared/types";
import type { AdapterValidationResult } from "../types.js";
import { resolveExecutable } from "../executable-resolver.js";
export { isGitPushCommand, isGitPushOutput, CREDENTIAL_FAILURE_PATTERN } from "./shell-command-patterns.js";

/**
 * Pure Codex app-server protocol helpers: JSON-RPC framing types/guards and
 * command validation. Git-push escalation detection and credential-failure
 * matching now live in shell-command-patterns.ts (shared with Claude) and
 * are re-exported above for existing call sites. Kept out of the adapter so
 * the adapter file stays focused on process/stream orchestration.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg && "id" in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

export function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

export function getResult(response: JsonRpcResponse): Record<string, unknown> {
  return (response.result ?? {}) as Record<string, unknown>;
}

export function validateCodexCommand(config: AdapterConfig): AdapterValidationResult {
  const command = config.command?.trim();
  if (!command) {
    return { available: false, errorMessage: "Command is empty." };
  }
  const { resolved, errorMessage: resolveError } = resolveExecutable(command);
  if (!resolved) {
    return { available: false, errorMessage: resolveError ?? `Command not found: ${command}` };
  }
  try {
    const result = spawnSync(resolved.executable, [...resolved.prefixArgs, "--version"], {
      timeout: 10_000,
      encoding: "utf-8",
      shell: false,
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
