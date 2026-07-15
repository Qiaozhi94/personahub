import { describe, it, expect } from "vitest";
import { RunStatus } from "@personahub/shared/types";
import { isValidTransition, isTerminalStatus } from "../../src/runtime/types.js";

describe("Run Status Transitions", () => {
  describe("isValidTransition", () => {
    it("allows queued -> running", () => {
      expect(isValidTransition(RunStatus.Queued, RunStatus.Running)).toBe(true);
    });

    it("allows queued -> cancelled", () => {
      expect(isValidTransition(RunStatus.Queued, RunStatus.Cancelled)).toBe(true);
    });

    it("allows running -> completed", () => {
      expect(isValidTransition(RunStatus.Running, RunStatus.Completed)).toBe(true);
    });

    it("allows running -> failed", () => {
      expect(isValidTransition(RunStatus.Running, RunStatus.Failed)).toBe(true);
    });

    it("allows running -> interrupted", () => {
      expect(isValidTransition(RunStatus.Running, RunStatus.Interrupted)).toBe(true);
    });

    it("allows running -> cancelled", () => {
      expect(isValidTransition(RunStatus.Running, RunStatus.Cancelled)).toBe(true);
    });

    it("rejects completed -> running", () => {
      expect(isValidTransition(RunStatus.Completed, RunStatus.Running)).toBe(false);
    });

    it("rejects failed -> completed", () => {
      expect(isValidTransition(RunStatus.Failed, RunStatus.Completed)).toBe(false);
    });

    it("rejects cancelled -> running", () => {
      expect(isValidTransition(RunStatus.Cancelled, RunStatus.Running)).toBe(false);
    });

    it("rejects queued -> completed (must go through running)", () => {
      expect(isValidTransition(RunStatus.Queued, RunStatus.Completed)).toBe(false);
    });

    it("rejects completed -> failed", () => {
      expect(isValidTransition(RunStatus.Completed, RunStatus.Failed)).toBe(false);
    });

    it("rejects interrupted -> running", () => {
      expect(isValidTransition(RunStatus.Interrupted, RunStatus.Running)).toBe(false);
    });
  });

  describe("isTerminalStatus", () => {
    it("returns true for completed", () => {
      expect(isTerminalStatus(RunStatus.Completed)).toBe(true);
    });

    it("returns true for failed", () => {
      expect(isTerminalStatus(RunStatus.Failed)).toBe(true);
    });

    it("returns true for interrupted", () => {
      expect(isTerminalStatus(RunStatus.Interrupted)).toBe(true);
    });

    it("returns true for cancelled", () => {
      expect(isTerminalStatus(RunStatus.Cancelled)).toBe(true);
    });

    it("returns false for queued", () => {
      expect(isTerminalStatus(RunStatus.Queued)).toBe(false);
    });

    it("returns false for running", () => {
      expect(isTerminalStatus(RunStatus.Running)).toBe(false);
    });
  });
});
