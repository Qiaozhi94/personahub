import {
  TraceSource,
  CommandOutcome,
  type RunTraceSignal,
} from "@personahub/shared/types";

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcNotification | JsonRpcRequest | { jsonrpc: "2.0"; id: number; result?: unknown };

function isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg && "id" in msg;
}

interface CommandItem {
  type: string;
  id: string;
  command?: string;
  cwd?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  aggregatedOutput?: string | null;
  status?: string;
  commandActions?: Array<{ type: string; command: string }>;
}

function getCommandItem(params: Record<string, unknown> | undefined): CommandItem | null {
  if (!params) return null;
  const item = params.item as CommandItem | undefined;
  if (!item || typeof item !== "object") return null;
  return item;
}

function getCommandFromItem(item: CommandItem): string {
  if (typeof item.commandActions?.[0]?.command === "string" && item.commandActions[0].command.length > 0) {
    return item.commandActions[0].command;
  }
  if (typeof item.command === "string") return item.command;
  return "";
}

function getCommandFromApprovalParams(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  const commandActions = params.commandActions as Array<{ command: string }> | undefined;
  if (commandActions?.[0]?.command) return commandActions[0].command;
  const command = params.command ?? params.commandText ?? params.command_line;
  if (typeof command === "string") return command;
  return "";
}

function getItemIdFromItem(item: CommandItem | null, params: Record<string, unknown> | undefined): string | null {
  if (item?.id) return item.id;
  if (!params) return null;
  const itemId = params.itemId;
  return typeof itemId === "string" ? itemId : null;
}

function getCwdFromItem(item: CommandItem | null, params: Record<string, unknown> | undefined): string | null {
  if (item?.cwd && typeof item.cwd === "string") return item.cwd;
  if (!params) return null;
  const cwd = params.cwd ?? params.workingDirectory;
  return typeof cwd === "string" ? cwd : null;
}

function deriveOutcome(exitCode: number | null | undefined, status: string | undefined): CommandOutcome {
  if (status === "blocked" || status === "cancelled") return status as CommandOutcome;
  if (exitCode === 0) return CommandOutcome.Succeeded;
  if (typeof exitCode === "number" && exitCode !== 0) return CommandOutcome.Failed;
  return CommandOutcome.Unknown;
}

function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return { text, truncated: false };
  const buf = Buffer.from(text, "utf8");
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

const OUTPUT_SUMMARY_MAX = 2 * 1024;

export function normalizeCodexTraceNotification(message: unknown): RunTraceSignal | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as JsonRpcMessage;

  if (isNotification(msg)) {
    if (msg.method === "item/started") {
      const item = getCommandItem(msg.params);
      if (!item || item.type !== "commandExecution") return null;
      const itemId = getItemIdFromItem(item, msg.params);
      if (!itemId) return null;
      const command = getCommandFromItem(item);
      const cwd = getCwdFromItem(item, msg.params);
      const startedAt = typeof msg.params?.startedAtMs === "number"
        ? new Date(msg.params.startedAtMs as number).toISOString()
        : null;
      return {
        type: "command_started",
        adapterItemId: itemId,
        command,
        cwd,
        startedAt,
        source: TraceSource.AdapterStructured,
      };
    }

    if (msg.method === "item/completed") {
      const item = getCommandItem(msg.params);
      if (!item || item.type !== "commandExecution") return null;
      const itemId = getItemIdFromItem(item, msg.params);
      if (!itemId) return null;
      const command = getCommandFromItem(item);
      const cwd = getCwdFromItem(item, msg.params);
      const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
      const durationMs = typeof item.durationMs === "number" ? item.durationMs : null;
      const rawOutput = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : null;
      const output = rawOutput ? truncateOutput(rawOutput, OUTPUT_SUMMARY_MAX) : { text: null, truncated: false };
      return {
        type: "command_completed",
        adapterItemId: itemId,
        command,
        cwd,
        outcome: deriveOutcome(item.exitCode, item.status),
        exitCode,
        durationMs,
        outputSummary: output.text,
        outputTruncated: output.truncated,
        source: TraceSource.AdapterStructured,
      };
    }
  }

  if (isRequest(msg)) {
    if (msg.method === "item/commandExecution/requestApproval") {
      const params = msg.params ?? {};
      const itemId = getItemIdFromItem(null, params);
      if (!itemId) return null;
      const command = getCommandFromApprovalParams(params);
      return {
        type: "command_completed",
        adapterItemId: itemId,
        command,
        outcome: CommandOutcome.Blocked,
        exitCode: null,
        durationMs: null,
        outputSummary: null,
        outputTruncated: false,
        source: TraceSource.ApprovalHook,
      };
    }
  }

  return null;
}

export function extractOutputItemId(_message: unknown): string | null {
  return null;
}
