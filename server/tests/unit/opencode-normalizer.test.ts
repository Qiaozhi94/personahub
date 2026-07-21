import { describe, it, expect, beforeEach } from "vitest";
import { OpenCodeTraceNormalizer } from "../../src/runtime/adapters/opencode-normalizer.js";
import { TraceSource, CommandOutcome } from "@personahub/shared/types";

// T042: real captured shapes (server/tests/helpers/opencode-protocol-fixtures.md, T006).

const STEP_START = { type: "step_start", part: { type: "step-start" } };

const TEXT_PART = { type: "text", part: { type: "text", text: "4" } };

const TOOL_USE_COMPLETED = {
  type: "tool_use",
  timestamp: 1784471601664,
  sessionID: "ses_1",
  part: {
    type: "tool",
    tool: "bash",
    callID: "call_00_abc",
    state: {
      status: "completed",
      input: { command: "echo hello-from-opencode" },
      output: "hello-from-opencode\n",
      metadata: { output: "hello-from-opencode\n", exit: 0, truncated: false },
      title: "echo hello-from-opencode",
      time: { start: 1784471601610, end: 1784471601628 },
    },
  },
};

const TOOL_USE_FAILED = {
  type: "tool_use",
  part: {
    type: "tool",
    tool: "bash",
    callID: "call_01_fail",
    state: {
      status: "completed",
      input: { command: "npm test" },
      metadata: { output: "FAIL src/app.test.ts\n", exit: 1 },
      time: { start: 1000, end: 1500 },
    },
  },
};

const STEP_FINISH_STOP = { type: "step_finish", part: { type: "step-finish", reason: "stop" } };
const STEP_FINISH_TOOL_CALLS = { type: "step_finish", part: { type: "step-finish", reason: "tool-calls" } };

const ERROR_LINE = {
  type: "error",
  timestamp: 1784471601999,
  sessionID: "ses_1",
  error: { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details.", ref: "err_8d002eda" } },
};

describe("OpenCodeTraceNormalizer (T042) - real protocol shapes", () => {
  let normalizer: OpenCodeTraceNormalizer;

  beforeEach(() => {
    normalizer = new OpenCodeTraceNormalizer("D:\\workspace");
  });

  it("ignores step_start (resets step text buffer)", () => {
    expect(normalizer.handleLine(STEP_START)).toEqual([{ kind: "ignore" }]);
  });

  it("normalizes a text part as output", () => {
    expect(normalizer.handleLine(TEXT_PART)).toEqual([{ kind: "output", text: "4" }]);
  });

  it("normalizes a single-shot completed tool_use as BOTH command_started and command_completed", () => {
    const events = normalizer.handleLine(TOOL_USE_COMPLETED);
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe("trace");
    expect(events[1]!.kind).toBe("trace");

    const started = (events[0] as any).signal;
    expect(started.type).toBe("command_started");
    expect(started.adapterItemId).toBe("call_00_abc");
    expect(started.command).toBe("echo hello-from-opencode");
    expect(started.cwd).toBe("D:\\workspace");
    expect(started.startedAt).toBe(new Date(1784471601610).toISOString());
    expect(started.source).toBe(TraceSource.AdapterStructured);

    const completed = (events[1] as any).signal;
    expect(completed.type).toBe("command_completed");
    expect(completed.adapterItemId).toBe("call_00_abc");
    expect(completed.outcome).toBe(CommandOutcome.Succeeded);
    expect(completed.exitCode).toBe(0);
    expect(completed.durationMs).toBe(18);
    expect(completed.outputSummary).toBe("hello-from-opencode\n");
    expect(completed.outputTruncated).toBe(false);
  });

  it("does not re-emit command_started for a callID already seen", () => {
    normalizer.handleLine(TOOL_USE_COMPLETED);
    const events = normalizer.handleLine(TOOL_USE_COMPLETED);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("trace");
    expect((events[0] as any).signal.type).toBe("command_completed");
  });

  it("classifies a nonzero exit code as Failed", () => {
    const events = normalizer.handleLine(TOOL_USE_FAILED);
    const completed = events.find((e) => e.kind === "trace" && (e as any).signal.type === "command_completed") as any;
    expect(completed.signal.outcome).toBe(CommandOutcome.Failed);
    expect(completed.signal.exitCode).toBe(1);
  });

  it("truncates tool output exceeding 2 KiB", () => {
    const longOutput = "x".repeat(3000);
    const events = normalizer.handleLine({
      type: "tool_use",
      part: { type: "tool", tool: "bash", callID: "call_long", state: { status: "completed", input: { command: "cat big.txt" }, metadata: { output: longOutput, exit: 0 }, time: { start: 0, end: 10 } } },
    });
    const completed = events[1] as any;
    expect(completed.signal.outputTruncated).toBe(true);
    expect(Buffer.byteLength(completed.signal.outputSummary ?? "", "utf8")).toBeLessThanOrEqual(2048);
  });

  it("ignores step_finish with reason=tool-calls (mid-turn boundary, not terminal)", () => {
    expect(normalizer.handleLine(STEP_FINISH_TOOL_CALLS)).toEqual([{ kind: "ignore" }]);
  });

  it("reconstructs the final message from the current step's accumulated text on step_finish/stop", () => {
    normalizer.handleLine(STEP_START);
    normalizer.handleLine(TEXT_PART);
    normalizer.handleLine({ type: "text", part: { type: "text", text: "!" } });
    const event = normalizer.handleLine(STEP_FINISH_STOP);
    expect(event).toEqual([{ kind: "result", isError: false, result: "4!" }]);
  });

  it("only reconstructs the final step's text, not earlier steps (T006: 'in the final step')", () => {
    normalizer.handleLine(STEP_START);
    normalizer.handleLine({ type: "text", part: { type: "text", text: "intermediate reasoning" } });
    normalizer.handleLine(STEP_FINISH_TOOL_CALLS);
    normalizer.handleLine(STEP_START);
    normalizer.handleLine({ type: "text", part: { type: "text", text: "final answer" } });
    const event = normalizer.handleLine(STEP_FINISH_STOP);
    expect(event).toEqual([{ kind: "result", isError: false, result: "final answer" }]);
  });

  it("normalizes a turn-level error line as a failed result", () => {
    const event = normalizer.handleLine(ERROR_LINE);
    expect(event).toEqual([{ kind: "result", isError: true, result: "Unexpected server error. Check server logs for details." }]);
  });

  it("returns ignore for malformed/unknown input", () => {
    expect(normalizer.handleLine(null)).toEqual([{ kind: "ignore" }]);
    expect(normalizer.handleLine("string")).toEqual([{ kind: "ignore" }]);
    expect(normalizer.handleLine({})).toEqual([{ kind: "ignore" }]);
    expect(normalizer.handleLine({ type: "unknown_event" })).toEqual([{ kind: "ignore" }]);
    expect(normalizer.handleLine({ type: "tool_use", part: { type: "tool" } })).toEqual([{ kind: "ignore" }]);
  });

  it("reset() clears step text buffer and started-callID tracking", () => {
    normalizer.handleLine(STEP_START);
    normalizer.handleLine(TEXT_PART);
    normalizer.handleLine(TOOL_USE_COMPLETED);
    normalizer.reset();
    const events = normalizer.handleLine(TOOL_USE_COMPLETED);
    expect(events).toHaveLength(2);
    const result = normalizer.handleLine(STEP_FINISH_STOP);
    expect(result).toEqual([{ kind: "result", isError: false, result: null }]);
  });
});
