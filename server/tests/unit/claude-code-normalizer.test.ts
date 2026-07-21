import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeTraceNormalizer } from "../../src/runtime/adapters/claude-code-normalizer.js";
import { TraceSource, CommandOutcome } from "@personahub/shared/types";

// T035: real captured shapes (server/tests/helpers/claude-protocol-fixtures.md,
// T035 re-verification section) — not documentation guesses.

const ASSISTANT_TOOL_USE = {
  type: "assistant",
  message: {
    model: "claude-sonnet-5",
    id: "msg_011CdFJHxsh64DxFKnKyKqCY",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_01TPHteeYEH6zFKebjkNudRi", name: "PowerShell", input: { command: "echo hello-from-tool", description: "运行 echo 命令" }, caller: { type: "direct" } }],
  },
  parent_tool_use_id: null,
  session_id: "57bf0994-5f62-454d-8656-4a51b879dc8d",
  uuid: "26952c2d-bcea-428d-a634-88f816995884",
  timestamp: "2026-07-21T13:41:37.740Z",
  request_id: "req_011CdFJHwXavSBBo64MJbmwz",
};

const ASSISTANT_THINKING = {
  type: "assistant",
  message: { content: [{ type: "thinking", thinking: "", signature: "abc" }] },
  timestamp: "2026-07-21T13:41:36.920Z",
};

const ASSISTANT_TEXT = {
  type: "assistant",
  message: { content: [{ type: "text", text: "命令输出为:`hello-from-tool`" }] },
  timestamp: "2026-07-21T13:41:41.807Z",
};

const USER_TOOL_RESULT_SUCCESS = {
  type: "user",
  message: { role: "user", content: [{ tool_use_id: "toolu_01TPHteeYEH6zFKebjkNudRi", type: "tool_result", content: "hello-from-tool", is_error: false }] },
  parent_tool_use_id: null,
  session_id: "57bf0994-5f62-454d-8656-4a51b879dc8d",
  uuid: "f68aa691-611c-4b11-85a0-69df2b68acac",
  timestamp: "2026-07-21T13:41:39.757Z",
  tool_use_result: { stdout: "hello-from-tool", stderr: "", interrupted: false, isImage: false },
};

const USER_TOOL_RESULT_BLOCKED = {
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", content: "PERSONAHUB_DENY_MARKER: blocked by test hook", is_error: true, tool_use_id: "toolu_01S8LHGcKPZn2Cs8cjgyhv8E" }] },
  parent_tool_use_id: null,
  session_id: "fd798d1a-12af-4d53-9b91-9b9ccf52badb",
  uuid: "61f2001e-799f-496b-adaf-44a49258b81a",
  timestamp: "2026-07-21T13:50:53.326Z",
  tool_use_result: "Error: PERSONAHUB_DENY_MARKER: blocked by test hook",
  tool_result_meta: [{ id: "toolu_01S8LHGcKPZn2Cs8cjgyhv8E", non_execution_kind: "permission-rule" }],
};

const RESULT_SUCCESS = {
  type: "result",
  subtype: "success",
  is_error: false,
  api_error_status: null,
  result: "命令输出为:`hello-from-tool`",
  stop_reason: "end_turn",
  permission_denials: [],
  terminal_reason: "completed",
};

const RESULT_BLOCKED = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "命令被测试钩子（hook）拦截了...",
  terminal_reason: "completed",
  permission_denials: [{ tool_name: "PowerShell", tool_use_id: "toolu_01S8LHGcKPZn2Cs8cjgyhv8E", tool_input: { command: "echo hello-from-tool" } }],
};

describe("ClaudeTraceNormalizer (T035) - real protocol shapes", () => {
  let normalizer: ClaudeTraceNormalizer;

  beforeEach(() => {
    normalizer = new ClaudeTraceNormalizer("D:\\workspace");
  });

  it("normalizes assistant tool_use as command_started", () => {
    const event = normalizer.handleLine(ASSISTANT_TOOL_USE);
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect(event.signal.type).toBe("command_started");
    expect(event.signal.adapterItemId).toBe("toolu_01TPHteeYEH6zFKebjkNudRi");
    expect(event.signal.command).toBe("echo hello-from-tool");
    expect((event.signal as any).cwd).toBe("D:\\workspace");
    expect((event.signal as any).startedAt).toBe("2026-07-21T13:41:37.740Z");
    expect(event.signal.source).toBe(TraceSource.AdapterStructured);
  });

  it("ignores thinking content", () => {
    expect(normalizer.handleLine(ASSISTANT_THINKING)).toEqual({ kind: "ignore" });
  });

  it("normalizes assistant text as output", () => {
    const event = normalizer.handleLine(ASSISTANT_TEXT);
    expect(event).toEqual({ kind: "output", text: "命令输出为:`hello-from-tool`" });
  });

  it("normalizes a successful tool_result as command_completed/Succeeded with exitCode null", () => {
    normalizer.handleLine(ASSISTANT_TOOL_USE);
    const event = normalizer.handleLine(USER_TOOL_RESULT_SUCCESS);
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect(event.signal.type).toBe("command_completed");
    expect((event.signal as any).outcome).toBe(CommandOutcome.Succeeded);
    expect((event.signal as any).exitCode).toBeNull();
    expect((event.signal as any).outputSummary).toBe("hello-from-tool");
    expect((event.signal as any).outputTruncated).toBe(false);
    expect((event.signal as any).durationMs).toBe(2017);
  });

  it("normalizes a hook-denied tool_result as command_completed/Blocked using tool_result_meta (not string matching)", () => {
    const event = normalizer.handleLine(USER_TOOL_RESULT_BLOCKED);
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect((event.signal as any).outcome).toBe(CommandOutcome.Blocked);
    expect((event.signal as any).outputSummary).toBe("PERSONAHUB_DENY_MARKER: blocked by test hook");
  });

  it("classifies is_error without tool_result_meta as Failed, not Blocked", () => {
    const failed = {
      ...USER_TOOL_RESULT_SUCCESS,
      message: { content: [{ tool_use_id: "toolu_01TPHteeYEH6zFKebjkNudRi", type: "tool_result", content: "boom", is_error: true }] },
    };
    const event = normalizer.handleLine(failed);
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect((event.signal as any).outcome).toBe(CommandOutcome.Failed);
  });

  it("handles a tool_result with no prior tool_use (command undefined, no crash)", () => {
    const event = normalizer.handleLine(USER_TOOL_RESULT_SUCCESS);
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect(event.signal.command).toBeUndefined();
    expect((event.signal as any).durationMs).toBeNull();
  });

  it("truncates tool_result content exceeding 2 KiB", () => {
    normalizer.handleLine(ASSISTANT_TOOL_USE);
    const longOutput = "x".repeat(3000);
    const event = normalizer.handleLine({
      ...USER_TOOL_RESULT_SUCCESS,
      message: { content: [{ tool_use_id: "toolu_01TPHteeYEH6zFKebjkNudRi", type: "tool_result", content: longOutput, is_error: false }] },
    });
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect((event.signal as any).outputTruncated).toBe(true);
    expect(Buffer.byteLength((event.signal as any).outputSummary ?? "", "utf8")).toBeLessThanOrEqual(2048);
  });

  it("normalizes a successful terminal result line", () => {
    const event = normalizer.handleLine(RESULT_SUCCESS);
    expect(event).toEqual({
      kind: "result",
      isError: false,
      result: "命令输出为:`hello-from-tool`",
      terminalReason: "completed",
      permissionDenials: [],
    });
  });

  it("normalizes a terminal result line carrying permission_denials", () => {
    const event = normalizer.handleLine(RESULT_BLOCKED);
    expect(event.kind).toBe("result");
    if (event.kind !== "result") throw new Error("unreachable");
    expect(event.permissionDenials).toEqual(["toolu_01S8LHGcKPZn2Cs8cjgyhv8E"]);
  });

  it("returns ignore for a graceful in-band error result (is_error true, well-formed JSON)", () => {
    const event = normalizer.handleLine({ type: "result", is_error: true, result: "Not logged in · Please run /login", terminal_reason: "completed" });
    expect(event.kind).toBe("result");
    if (event.kind !== "result") throw new Error("unreachable");
    expect(event.isError).toBe(true);
    expect(event.result).toBe("Not logged in · Please run /login");
  });

  it("returns ignore for unknown message types (system/init, rate_limit_event)", () => {
    expect(normalizer.handleLine({ type: "system", subtype: "init" })).toEqual({ kind: "ignore" });
    expect(normalizer.handleLine({ type: "rate_limit_event" })).toEqual({ kind: "ignore" });
  });

  it("returns ignore for malformed input", () => {
    expect(normalizer.handleLine(null)).toEqual({ kind: "ignore" });
    expect(normalizer.handleLine("string")).toEqual({ kind: "ignore" });
    expect(normalizer.handleLine({})).toEqual({ kind: "ignore" });
    expect(normalizer.handleLine({ type: "assistant", message: {} })).toEqual({ kind: "ignore" });
  });

  it("reset() clears pending tool_use correlation state", () => {
    normalizer.handleLine(ASSISTANT_TOOL_USE);
    normalizer.reset();
    const event = normalizer.handleLine(USER_TOOL_RESULT_SUCCESS);
    expect(event.kind).toBe("trace");
    if (event.kind !== "trace") throw new Error("unreachable");
    expect((event.signal as any).durationMs).toBeNull();
  });
});
