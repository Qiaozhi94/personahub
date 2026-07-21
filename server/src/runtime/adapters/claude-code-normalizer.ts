import {
  TraceSource,
  CommandOutcome,
  type RunTraceSignal,
} from "@personahub/shared/types";
import { TRACE_LIMITS } from "../trace/constants.js";

/**
 * Claude Code `-p --output-format stream-json --verbose` NDJSON normalizer.
 * Shapes below are taken from real, literal captures (server/tests/helpers/
 * claude-protocol-fixtures.md, T002-T004 + T035 re-verification), not
 * documentation guesses. Two real capability gaps vs Codex, both
 * intentional and recorded in the fixture doc: no native `exitCode` (always
 * null) and `cwd` is the session-level spawn cwd supplied by the caller, not
 * a per-call protocol field.
 */

interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input?: { command?: unknown; description?: unknown };
}

interface TextContent {
  type: "text";
  text: string;
}

interface ThinkingContent {
  type: "thinking";
  thinking?: string;
}

interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

type AssistantContentItem = ToolUseContent | TextContent | ThinkingContent | { type: string };
type UserContentItem = ToolResultContent | { type: string };

interface ToolResultMetaEntry {
  id?: string;
  non_execution_kind?: string;
}

interface AssistantLine {
  type: "assistant";
  message?: { content?: AssistantContentItem[] };
  timestamp?: string;
}

interface UserLine {
  type: "user";
  message?: { content?: UserContentItem[] };
  timestamp?: string;
  tool_result_meta?: ToolResultMetaEntry[];
}

interface ResultLine {
  type: "result";
  is_error?: boolean;
  result?: string | null;
  terminal_reason?: string | null;
  permission_denials?: Array<{ tool_use_id?: string }>;
}

export type ClaudeNormalizedEvent =
  | { kind: "ignore" }
  | { kind: "output"; text: string }
  | { kind: "trace"; signal: RunTraceSignal }
  | {
      kind: "result";
      isError: boolean;
      result: string | null;
      terminalReason: string | null;
      permissionDenials: string[];
    };

function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return { text, truncated: false };
  const buf = Buffer.from(text, "utf8");
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function toResultContentText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

interface PendingToolUse {
  command: string;
  startedAtIso: string | null;
}

/**
 * Stateful only because Claude's protocol (unlike Codex's) never supplies a
 * ready-made `durationMs`/per-call `cwd` — the adapter must correlate a
 * tool_use's start timestamp with its later tool_result to compute duration
 * itself (design §6.3/T004), and supply the session-level spawn cwd. Kept
 * out of the adapter class so process/stream orchestration stays separate
 * from protocol-shape parsing, mirroring codex-trace-normalizer.ts's role.
 */
export class ClaudeTraceNormalizer {
  private pending = new Map<string, PendingToolUse>();

  constructor(private readonly sessionCwd: string) {}

  handleLine(raw: unknown): ClaudeNormalizedEvent {
    if (!raw || typeof raw !== "object") return { kind: "ignore" };
    const msg = raw as { type?: unknown };

    if (msg.type === "assistant") return this.handleAssistant(raw as AssistantLine);
    if (msg.type === "user") return this.handleUser(raw as UserLine);
    if (msg.type === "result") return this.handleResult(raw as ResultLine);
    return { kind: "ignore" };
  }

  private handleAssistant(line: AssistantLine): ClaudeNormalizedEvent {
    const items = line.message?.content;
    if (!Array.isArray(items) || items.length === 0) return { kind: "ignore" };

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const typed = item as { type?: string };

      if (typed.type === "tool_use") {
        const toolUse = item as ToolUseContent;
        if (!toolUse.id) continue;
        const command = typeof toolUse.input?.command === "string" ? toolUse.input.command : "";
        const startedAt = typeof line.timestamp === "string" ? line.timestamp : null;
        this.pending.set(toolUse.id, { command, startedAtIso: startedAt });
        return {
          kind: "trace",
          signal: {
            type: "command_started",
            adapterItemId: toolUse.id,
            command,
            cwd: this.sessionCwd,
            startedAt,
            source: TraceSource.AdapterStructured,
          },
        };
      }

      if (typed.type === "text") {
        const text = (item as TextContent).text;
        if (typeof text === "string" && text.length > 0) {
          return { kind: "output", text };
        }
      }

      // "thinking" content is internal deliberation, not Run output — ignored.
    }

    return { kind: "ignore" };
  }

  private handleUser(line: UserLine): ClaudeNormalizedEvent {
    const items = line.message?.content;
    if (!Array.isArray(items)) return { kind: "ignore" };

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if ((item as { type?: string }).type !== "tool_result") continue;

      const toolResult = item as ToolResultContent;
      const toolUseId = toolResult.tool_use_id;
      if (!toolUseId) continue;

      const pendingEntry = this.pending.get(toolUseId);
      this.pending.delete(toolUseId);

      const isError = toolResult.is_error === true;
      const blocked = (line.tool_result_meta ?? []).some(
        (entry) => entry.id === toolUseId && Boolean(entry.non_execution_kind),
      );

      const durationMs = this.computeDurationMs(pendingEntry?.startedAtIso ?? null, line.timestamp ?? null);
      const rawText = toResultContentText(toolResult.content);
      const output = rawText ? truncateOutput(rawText, TRACE_LIMITS.outputSummaryMaxBytes) : { text: "", truncated: false };

      const outcome = blocked
        ? CommandOutcome.Blocked
        : isError
          ? CommandOutcome.Failed
          : CommandOutcome.Succeeded;

      return {
        kind: "trace",
        signal: {
          type: "command_completed",
          adapterItemId: toolUseId,
          command: pendingEntry?.command,
          cwd: this.sessionCwd,
          outcome,
          exitCode: null,
          durationMs,
          outputSummary: output.text.length > 0 ? output.text : null,
          outputTruncated: output.truncated,
          source: TraceSource.AdapterStructured,
        },
      };
    }

    return { kind: "ignore" };
  }

  private handleResult(line: ResultLine): ClaudeNormalizedEvent {
    return {
      kind: "result",
      isError: line.is_error === true,
      result: typeof line.result === "string" ? line.result : null,
      terminalReason: typeof line.terminal_reason === "string" ? line.terminal_reason : null,
      permissionDenials: (line.permission_denials ?? [])
        .map((d) => d.tool_use_id)
        .filter((id): id is string => typeof id === "string"),
    };
  }

  private computeDurationMs(startedIso: string | null, completedIso: string | null): number | null {
    if (!startedIso || !completedIso) return null;
    const started = Date.parse(startedIso);
    const completed = Date.parse(completedIso);
    if (Number.isNaN(started) || Number.isNaN(completed)) return null;
    return Math.max(0, completed - started);
  }

  reset(): void {
    this.pending.clear();
  }
}
