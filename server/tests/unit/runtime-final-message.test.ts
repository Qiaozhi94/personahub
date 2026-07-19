import { describe, it, expect } from "vitest";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import type { RunExitResult, AgentAdapterCapabilities } from "../../src/runtime/types.js";
import type { Run } from "@personahub/shared/types";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SAMPLE_FINAL_MESSAGE = JSON.stringify({
  schema_version: 1,
  outcome: "passed",
  summary: "All good.",
  findings: [],
  evidence_refs: [],
  missing_evidence: [],
  key_decisions: [],
  lessons_candidate: [],
});

describe("Runtime final-message contract (T030)", () => {
  describe("RunExitResult.finalMessage field", () => {
    it("accepts a string value", () => {
      const result: RunExitResult = {
        exitCode: 0,
        failureReason: null,
        errorMessage: null,
        finalMessage: SAMPLE_FINAL_MESSAGE,
      };
      expect(result.finalMessage).toBe(SAMPLE_FINAL_MESSAGE);
    });

    it("accepts null for missing final message", () => {
      const result: RunExitResult = {
        exitCode: 0,
        failureReason: null,
        errorMessage: null,
        finalMessage: null,
      };
      expect(result.finalMessage).toBeNull();
    });

    it("defaults to null conceptually when omitted by spread", () => {
      const base = { exitCode: 0, failureReason: null, errorMessage: null };
      const result: RunExitResult = { ...base, finalMessage: null };
      expect(result.finalMessage).toBeNull();
    });
  });

  describe("FakeAgentAdapter finalMessage emission", () => {
    it("emits finalMessage in exit result when configured", async () => {
      const adapter = new FakeAgentAdapter({
        finalMessage: SAMPLE_FINAL_MESSAGE,
        delayMs: 30,
        outputChunks: [],
      });

      const handle = await adapter.start({
        runId: "run-1",
        issueId: "issue-1",
        threadId: "thread-1",
        workspace: {
          workspaceId: "ws-1",
          localPath: "/tmp/test",
          gitBranch: null,
          pushCredentialsEnabled: false,
        },
        instructions: "test",
        context: "",
        adapterConfig: { command: "fake", args: [] },
      });

      const exitResult = await new Promise<RunExitResult>((resolve) => {
        handle.onExit(resolve);
      });

      expect(exitResult.finalMessage).toBe(SAMPLE_FINAL_MESSAGE);
      expect(exitResult.exitCode).toBe(0);
    });

    it("emits null finalMessage when not configured", async () => {
      const adapter = new FakeAgentAdapter({
        delayMs: 30,
        outputChunks: [],
      });

      const handle = await adapter.start({
        runId: "run-2",
        issueId: "issue-2",
        threadId: "thread-2",
        workspace: {
          workspaceId: "ws-2",
          localPath: "/tmp/test",
          gitBranch: null,
          pushCredentialsEnabled: false,
        },
        instructions: "test",
        context: "",
        adapterConfig: { command: "fake", args: [] },
      });

      const exitResult = await new Promise<RunExitResult>((resolve) => {
        handle.onExit(resolve);
      });

      expect(exitResult.finalMessage).toBeNull();
    });

    it("preserves unicode in finalMessage", async () => {
      const unicodeMessage = "✓ 中文 café — " + SAMPLE_FINAL_MESSAGE;
      const adapter = new FakeAgentAdapter({
        finalMessage: unicodeMessage,
        delayMs: 30,
        outputChunks: [],
      });

      const handle = await adapter.start({
        runId: "run-3",
        issueId: "issue-3",
        threadId: "thread-3",
        workspace: {
          workspaceId: "ws-3",
          localPath: "/tmp/test",
          gitBranch: null,
          pushCredentialsEnabled: false,
        },
        instructions: "test",
        context: "",
        adapterConfig: { command: "fake", args: [] },
      });

      const exitResult = await new Promise<RunExitResult>((resolve) => {
        handle.onExit(resolve);
      });

      expect(exitResult.finalMessage).toBe(unicodeMessage);
    });
  });

  describe("supportsFinalMessage capability", () => {
    it("FakeAgentAdapter reports supportsFinalMessage=true by default", () => {
      const adapter = new FakeAgentAdapter();
      const caps: AgentAdapterCapabilities = adapter.capabilities;
      expect(caps.supportsFinalMessage).toBe(true);
    });

    it("FakeAgentAdapter can disable supportsFinalMessage", () => {
      const adapter = new FakeAgentAdapter({ supportsFinalMessage: false });
      expect(adapter.capabilities.supportsFinalMessage).toBe(false);
    });

    it("adapter without final message support still completes but cannot be a validator", () => {
      const adapter = new FakeAgentAdapter({ supportsFinalMessage: false });
      expect(adapter.capabilities.supportsFinalMessage).toBe(false);
      expect(adapter.capabilities.supportsStructuredTrace).toBe(true);
    });

    it("capability is a boolean field on AgentAdapterCapabilities", () => {
      const caps: AgentAdapterCapabilities = {
        provider: "test",
        supportsApprovalHook: false,
        supportsStructuredTrace: false,
        supportsFinalMessage: false,
        executionTimeoutMs: 1000,
      };
      expect(typeof caps.supportsFinalMessage).toBe("boolean");
    });
  });

  describe("public Run API does not expose finalMessage content", () => {
    it("Run type has has_final_message boolean, not final_message string", () => {
      const run: Run = {
        id: "run-x",
        issue_id: "issue-x",
        thread_id: "thread-x",
        workspace_id: "ws-x",
        adapter_config_id: "adapter-x",
        status: "completed",
        failure_reason: null,
        instructions: "",
        started_at: null,
        completed_at: null,
        exit_code: 0,
        error_message: null,
        role: "implementation",
        workflow_step: "implementation",
        validation_round: null,
        dispatch_source: "user_explicit",
        adapter_identity: null,
        has_final_message: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      expect(run.has_final_message).toBe(true);
      expect("final_message" in run).toBe(false);
      expect("finalMessage" in run).toBe(false);
    });

    it("Run with has_final_message=false does not leak content", () => {
      const run: Run = {
        id: "run-y",
        issue_id: "issue-y",
        thread_id: "thread-y",
        workspace_id: "ws-y",
        adapter_config_id: "adapter-y",
        status: "completed",
        failure_reason: null,
        instructions: "",
        started_at: null,
        completed_at: null,
        exit_code: 0,
        error_message: null,
        role: "implementation",
        workflow_step: "implementation",
        validation_round: null,
        dispatch_source: "user_explicit",
        adapter_identity: null,
        has_final_message: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };

      expect(run.has_final_message).toBe(false);
      expect("final_message" in run).toBe(false);
    });
  });
});
