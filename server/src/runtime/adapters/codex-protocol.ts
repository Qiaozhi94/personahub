import { spawnSync } from "node:child_process";
import type { AdapterConfig } from "@personahub/shared/types";
import type { AdapterValidationResult } from "../types.js";

/**
 * Pure Codex app-server protocol helpers: JSON-RPC framing types/guards,
 * git-push escalation detection, credential-failure matching, and command
 * validation. Kept out of the adapter so the adapter file stays focused on
 * process/stream orchestration.
 */

const GIT_PUSH_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
];

export const CREDENTIAL_FAILURE_PATTERN =
  /permission denied|authentication failed|could not read|no credentials|403|401/i;

export function isGitPushCommand(command: unknown): boolean {
  if (typeof command === "string") {
    return GIT_PUSH_PATTERNS.some((p) => p.test(command));
  }
  if (Array.isArray(command)) {
    const joined = command.join(" ");
    return GIT_PUSH_PATTERNS.some((p) => p.test(joined));
  }
  return false;
}

export function isGitPushOutput(text: string): boolean {
  return GIT_PUSH_PATTERNS.some((p) => p.test(text));
}

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
