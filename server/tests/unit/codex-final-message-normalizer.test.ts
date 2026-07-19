import { describe, it, expect } from "vitest";
import { CodexFinalMessageCapture } from "../../src/runtime/adapters/codex-final-message-capture.js";
import {
  codexFinalMessageFixtures,
  CODEX_FINAL_MESSAGE_MAX_BYTES,
  type CodexNotification,
} from "../helpers/codex-final-message-fixtures.js";

function runFixture(notifications: CodexNotification[]): string | null {
  const capture = new CodexFinalMessageCapture();
  for (const n of notifications) {
    capture.handleNotification(n.method, n.params);
  }
  return capture.getFinalMessage();
}

describe("Codex final-message normalizer (T032)", () => {
  describe("fixture-driven scenarios", () => {
    for (const fixture of codexFinalMessageFixtures) {
      it(`${fixture.name}: ${fixture.description}`, () => {
        const result = runFixture(fixture.notifications);
        expect(result).toBe(fixture.expectedFinalMessage);
      });
    }
  });

  describe("delta accumulation is NOT used", () => {
    it("ignores item/agentMessage/delta notifications entirely", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/agentMessage/delta", {
        delta: "partial text 1\n",
        itemId: "msg-1",
      });
      capture.handleNotification("item/agentMessage/delta", {
        delta: "partial text 2\n",
        itemId: "msg-1",
      });
      capture.handleNotification("turn/completed", {
        turn: { id: "t1", status: "completed" },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("only captures text from item/completed with phase=final_answer", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/agentMessage/delta", {
        delta: "this should not appear\n",
        itemId: "msg-1",
      });
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: '{"outcome":"passed"}',
        },
      });
      const result = capture.getFinalMessage();
      expect(result).toBe('{"outcome":"passed"}');
      expect(result).not.toContain("this should not appear");
    });
  });

  describe("commentary phase is ignored", () => {
    it("agentMessage with phase=commentary does not set final message", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-c",
          phase: "commentary",
          text: "I am reviewing the code.",
        },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("unknown phase values are ignored", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-x",
          phase: "thinking",
          text: "thinking...",
        },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });
  });

  describe("multiple final_answer takes last", () => {
    it("overwrites earlier final_answer with later one", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: '{"outcome":"passed"}',
        },
      });
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-2",
          phase: "final_answer",
          text: '{"outcome":"failed"}',
        },
      });
      expect(capture.getFinalMessage()).toBe('{"outcome":"failed"}');
    });
  });

  describe("command output stays isolated", () => {
    it("commandExecution aggregatedOutput does not leak into final message", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "npm test",
          aggregatedOutput: "PROBE_CMD_OUTPUT_MARKER_9F3A\n",
          exitCode: 0,
        },
      });
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: '{"outcome":"passed"}',
        },
      });
      const result = capture.getFinalMessage();
      expect(result).toBe('{"outcome":"passed"}');
      expect(result).not.toContain("PROBE_CMD_OUTPUT_MARKER");
    });
  });

  describe("missing final message", () => {
    it("returns null when no agentMessage item/completed is seen", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("turn/completed", {
        turn: { id: "t1", status: "completed" },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("returns null when agentMessage has no text field", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
        },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("returns null for empty notifications", () => {
      const capture = new CodexFinalMessageCapture();
      expect(capture.getFinalMessage()).toBeNull();
    });
  });

  describe("unicode preserved", () => {
    it("preserves unicode characters in final message", () => {
      const unicodeText = '{"summary":"✓ 中文 café - 全部通过"}';
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: unicodeText,
        },
      });
      expect(capture.getFinalMessage()).toBe(unicodeText);
    });
  });

  describe("64 KiB boundary", () => {
    it("captures message exactly at 64 KiB boundary", () => {
      const exactMax = "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES);
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: exactMax,
        },
      });
      expect(capture.getFinalMessage()).toBe(exactMax);
      expect(Buffer.byteLength(capture.getFinalMessage()!, "utf8")).toBe(CODEX_FINAL_MESSAGE_MAX_BYTES);
    });

    it("captures oversized message without crashing (truncation at adapter layer)", () => {
      const oversized = "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 100);
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: oversized,
        },
      });
      expect(capture.getFinalMessage()).toBe(oversized);
    });
  });

  describe("turn/completed independence", () => {
    it("does not depend on turn/completed for message content", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: '{"outcome":"passed"}',
        },
      });
      expect(capture.getFinalMessage()).toBe('{"outcome":"passed"}');
    });

    it("turn/completed with items array does not override captured message", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: '{"outcome":"passed"}',
        },
      });
      capture.handleNotification("turn/completed", {
        turn: {
          id: "t1",
          status: "completed",
          items: [{ type: "agentMessage", text: "should not override" }],
        },
      });
      expect(capture.getFinalMessage()).toBe('{"outcome":"passed"}');
    });
  });

  describe("malformed notifications", () => {
    it("ignores item/completed with missing item", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {});
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("ignores item/completed with non-object item", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", { item: "not-an-object" });
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("ignores non-agentMessage item types", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: { type: "fileChange", id: "fc-1", phase: "final_answer", text: "ignored" },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });

    it("ignores unknown notification methods", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/unknown", {
        item: { type: "agentMessage", phase: "final_answer", text: "ignored" },
      });
      expect(capture.getFinalMessage()).toBeNull();
    });
  });

  describe("reset", () => {
    it("clears captured final message", () => {
      const capture = new CodexFinalMessageCapture();
      capture.handleNotification("item/completed", {
        item: {
          type: "agentMessage",
          id: "msg-1",
          phase: "final_answer",
          text: '{"outcome":"passed"}',
        },
      });
      expect(capture.getFinalMessage()).not.toBeNull();
      capture.reset();
      expect(capture.getFinalMessage()).toBeNull();
    });
  });
});
