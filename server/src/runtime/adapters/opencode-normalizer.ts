import {
  TraceSource,
  CommandOutcome,
  type RunTraceSignal,
} from "@personahub/shared/types";
import { TRACE_LIMITS } from "../trace/constants.js";

/**
 * OpenCode `run --format json` NDJSON normalizer. Shapes below are taken
 * from real, literal captures (server/tests/helpers/opencode-protocol-
 * fixtures.md, T005-T008) — not documentation guesses. Structurally
 * different from both Codex and Claude: no single terminal "result" event
 * (final message must be reconstructed from the last step's `text` parts),
 * and `tool_use` carries a genuine exit code (a capability Claude lacks)
 * with both start/end timestamps on the same event (no cross-event
 * duration correlation needed, unlike Claude).
 */

interface ToolUseState {
  status?: string;
  input?: { command?: unknown };
  output?: unknown;
  metadata?: { output?: unknown; exit?: number | null; truncated?: boolean };
  time?: { start?: number; end?: number };
}

interface ToolUsePart {
  type: "tool";
  tool?: string;
  callID?: string;
  state?: ToolUseState;
}

interface TextPart {
  type: "text";
  text?: string;
}

interface StepFinishPart {
  type: "step-finish";
  reason?: string;
}

interface Line {
  type?: string;
  part?: ToolUsePart | TextPart | StepFinishPart | { type?: string };
  error?: { name?: string; data?: { message?: string } };
}

export type OpenCodeNormalizedEvent =
  | { kind: "ignore" }
  | { kind: "output"; text: string }
  | { kind: "trace"; signal: RunTraceSignal }
  | { kind: "result"; isError: boolean; result: string | null };

function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= maxBytes) return { text, truncated: false };
  const buf = Buffer.from(text, "utf8");
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function toOutputText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  return JSON.stringify(raw);
}

/**
 * Stateful for two reasons the protocol itself requires: (1) final-message
 * reconstruction needs the current step's accumulated text, reset at each
 * `step_start` (T006: "concatenation of text parts in the final step");
 * (2) avoiding a duplicate command_started if a given callID is ever seen
 * across more than one line (defensive — every real capture so far shows a
 * single already-`completed` tool_use line, but the protocol doesn't
 * guarantee that will always be true).
 */
export class OpenCodeTraceNormalizer {
  private stepTextBuffer = "";
  private startedCallIds = new Set<string>();

  constructor(private readonly sessionCwd: string) {}

  handleLine(raw: unknown): OpenCodeNormalizedEvent[] {
    if (!raw || typeof raw !== "object") return [{ kind: "ignore" }];
    const line = raw as Line;

    if (line.type === "step_start") {
      this.stepTextBuffer = "";
      return [{ kind: "ignore" }];
    }

    if (line.type === "text") {
      const text = (line.part as TextPart | undefined)?.text;
      if (typeof text !== "string" || text.length === 0) return [{ kind: "ignore" }];
      this.stepTextBuffer += text;
      return [{ kind: "output", text }];
    }

    if (line.type === "tool_use") {
      return this.handleToolUse(line.part as ToolUsePart | undefined);
    }

    if (line.type === "step_finish") {
      const reason = (line.part as StepFinishPart | undefined)?.reason;
      if (reason !== "stop") return [{ kind: "ignore" }];
      return [{ kind: "result", isError: false, result: this.stepTextBuffer.length > 0 ? this.stepTextBuffer : null }];
    }

    if (line.type === "error") {
      const message = line.error?.data?.message ?? line.error?.name ?? "OpenCode reported an error";
      return [{ kind: "result", isError: true, result: message }];
    }

    return [{ kind: "ignore" }];
  }

  private handleToolUse(part: ToolUsePart | undefined): OpenCodeNormalizedEvent[] {
    const callId = part?.callID;
    if (!callId) return [{ kind: "ignore" }];
    const state = part.state ?? {};
    const command = typeof state.input?.command === "string" ? state.input.command : "";

    const events: OpenCodeNormalizedEvent[] = [];

    const alreadyStarted = this.startedCallIds.has(callId);
    if (!alreadyStarted) {
      this.startedCallIds.add(callId);
      const startedAt = typeof state.time?.start === "number" ? new Date(state.time.start).toISOString() : null;
      events.push({
        kind: "trace",
        signal: {
          type: "command_started",
          adapterItemId: callId,
          command,
          cwd: this.sessionCwd,
          startedAt,
          source: TraceSource.AdapterStructured,
        },
      });
    }

    if (state.status !== "completed") {
      return events.length > 0 ? events : [{ kind: "ignore" }];
    }

    const exitCode = typeof state.metadata?.exit === "number" ? state.metadata.exit : null;
    const durationMs = typeof state.time?.start === "number" && typeof state.time?.end === "number"
      ? Math.max(0, state.time.end - state.time.start)
      : null;
    const rawOutput = toOutputText(state.metadata?.output ?? state.output);
    const output = rawOutput ? truncateOutput(rawOutput, TRACE_LIMITS.outputSummaryMaxBytes) : { text: "", truncated: false };
    const outcome = exitCode === 0
      ? CommandOutcome.Succeeded
      : exitCode !== null
        ? CommandOutcome.Failed
        : CommandOutcome.Unknown;

    events.push({
      kind: "trace",
      signal: {
        type: "command_completed",
        adapterItemId: callId,
        command,
        cwd: this.sessionCwd,
        outcome,
        exitCode,
        durationMs,
        outputSummary: output.text.length > 0 ? output.text : null,
        outputTruncated: output.truncated,
        source: TraceSource.AdapterStructured,
      },
    });

    return events;
  }

  reset(): void {
    this.stepTextBuffer = "";
    this.startedCallIds.clear();
  }
}
