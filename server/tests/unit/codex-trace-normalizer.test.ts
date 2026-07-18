import { describe, it, expect } from "vitest";
import { normalizeCodexTraceNotification, extractOutputItemId } from "../../src/runtime/adapters/codex-trace-normalizer.js";
import { TraceSource, CommandOutcome } from "@personahub/shared/types";

const CMD_ITEM_STARTED = {
  jsonrpc: "2.0",
  method: "item/started",
  params: {
    item: {
      type: "commandExecution", id: "cmd-1",
      command: "npm test", cwd: "/workspace",
      commandActions: [{ type: "unknown", command: "npm test" }],
      status: "inProgress", exitCode: null, durationMs: null, aggregatedOutput: null,
    },
    threadId: "thr-1", turnId: "trn-1",
    startedAtMs: 1784344003829,
  },
};

const CMD_ITEM_COMPLETED = (exitCode: number | null, output?: string) => ({
  jsonrpc: "2.0",
  method: "item/completed",
  params: {
    item: {
      type: "commandExecution", id: "cmd-1",
      command: "npm test", cwd: "/workspace",
      commandActions: [{ type: "unknown", command: "npm test" }],
      status: "completed", exitCode, durationMs: 842,
      aggregatedOutput: output ?? null,
    },
    threadId: "thr-1", turnId: "trn-1",
    completedAtMs: 1784344012053,
  },
});

describe("Codex Trace Normalizer (T032) - real protocol shapes", () => {
  it("normalizes item/started commandExecution notification", () => {
    const signal = normalizeCodexTraceNotification(CMD_ITEM_STARTED);

    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("command_started");
    expect(signal!.adapterItemId).toBe("cmd-1");
    expect(signal!.command).toBe("npm test");
    expect(signal!.cwd).toBe("/workspace");
    expect(signal!.startedAt).not.toBeNull();
    expect(signal!.source).toBe(TraceSource.AdapterStructured);
  });

  it("normalizes item/completed with exit 0 as succeeded", () => {
    const signal = normalizeCodexTraceNotification(CMD_ITEM_COMPLETED(0, "test passed\n"));

    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("command_completed");
    expect((signal as any).outcome).toBe(CommandOutcome.Succeeded);
    expect((signal as any).exitCode).toBe(0);
    expect((signal as any).durationMs).toBe(842);
    expect((signal as any).outputSummary).toBe("test passed\n");
    expect((signal as any).outputTruncated).toBe(false);
  });

  it("normalizes item/completed with non-zero exit as failed", () => {
    const signal = normalizeCodexTraceNotification(CMD_ITEM_COMPLETED(1, "FAIL\n"));

    expect(signal).not.toBeNull();
    expect((signal as any).outcome).toBe(CommandOutcome.Failed);
    expect((signal as any).exitCode).toBe(1);
  });

  it("normalizes item/completed with null exitCode as unknown", () => {
    const signal = normalizeCodexTraceNotification(CMD_ITEM_COMPLETED(null));

    expect(signal).not.toBeNull();
    expect((signal as any).outcome).toBe(CommandOutcome.Unknown);
    expect((signal as any).exitCode).toBeNull();
    expect((signal as any).outputSummary).toBeNull();
  });

  it("truncates aggregatedOutput exceeding 2 KiB", () => {
    const longOutput = "x".repeat(3000);
    const signal = normalizeCodexTraceNotification(CMD_ITEM_COMPLETED(0, longOutput));

    expect(signal).not.toBeNull();
    expect((signal as any).outputTruncated).toBe(true);
    expect(Buffer.byteLength((signal as any).outputSummary ?? "", "utf8")).toBeLessThanOrEqual(2048);
  });

  it("prefers commandActions[0].command over item.command", () => {
    const msg = {
      jsonrpc: "2.0",
      method: "item/started",
      params: {
        item: {
          type: "commandExecution", id: "cmd-x",
          command: '"pwsh.exe" -Command \'npm test\'',
          commandActions: [{ type: "unknown", command: "npm test" }],
          status: "inProgress",
        },
      },
    };
    const signal = normalizeCodexTraceNotification(msg);
    expect(signal!.command).toBe("npm test");
  });

  it("normalizes requestApproval as blocked command_completed", () => {
    const signal = normalizeCodexTraceNotification({
      jsonrpc: "2.0",
      id: 9001,
      method: "item/commandExecution/requestApproval",
      params: {
        command: '"pwsh.exe" -Command \'git push\'',
        itemId: "cmd-blocked",
        commandActions: [{ type: "unknown", command: "git push" }],
        threadId: "thr-1",
        startedAtMs: Date.now(),
      },
    });

    expect(signal).not.toBeNull();
    expect(signal!.type).toBe("command_completed");
    expect(signal!.adapterItemId).toBe("cmd-blocked");
    expect((signal as any).outcome).toBe(CommandOutcome.Blocked);
    expect(signal!.source).toBe(TraceSource.ApprovalHook);
    expect(signal!.command).toBe("git push");
  });

  it("returns null for non-commandExecution item/started", () => {
    const signal = normalizeCodexTraceNotification({
      jsonrpc: "2.0",
      method: "item/started",
      params: {
        item: { type: "agentMessage", id: "msg-1" },
      },
    });
    expect(signal).toBeNull();
  });

  it("returns null for unknown notification method", () => {
    const signal = normalizeCodexTraceNotification({
      jsonrpc: "2.0",
      method: "item/unknownNotification",
      params: { itemId: "x" },
    });
    expect(signal).toBeNull();
  });

  it("returns null for missing item id", () => {
    const signal = normalizeCodexTraceNotification({
      jsonrpc: "2.0",
      method: "item/started",
      params: {
        item: { type: "commandExecution" },
      },
    });
    expect(signal).toBeNull();
  });

  it("returns null for malformed message", () => {
    expect(normalizeCodexTraceNotification(null)).toBeNull();
    expect(normalizeCodexTraceNotification("string")).toBeNull();
    expect(normalizeCodexTraceNotification({})).toBeNull();
  });

  it("returns null for agentMessage delta notification", () => {
    const signal = normalizeCodexTraceNotification({
      jsonrpc: "2.0",
      method: "item/agentMessage/delta",
      params: { delta: "hello", itemId: "msg-1" },
    });
    expect(signal).toBeNull();
  });

  it("extractOutputItemId returns null (no outputDelta in real protocol)", () => {
    expect(extractOutputItemId({})).toBeNull();
  });
});
