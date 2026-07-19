/**
 * Codex final-message protocol fixtures (F004 T002/T003).
 *
 * Probe confirmed on Codex CLI 0.144.5 (Windows):
 * - final message = `item/completed` where `item.type === "agentMessage"`
 *   and `item.phase === "final_answer"`,取其 `text` 字段
 * - delta field name is `delta`; must NOT accumulate deltas
 * - preamble agentMessage phase="commentary", final answer phase="final_answer"
 * - command output (aggregatedOutput) stays isolated from final message
 * - Unicode preserved as-is
 *
 * These fixtures are consumed by Phase 5 T032 (Codex final-message normalizer unit tests).
 * Boundary cases (64 KiB / missing / non-zero / cancel / timeout) have Blocked fallbacks.
 */

export interface CodexNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface CodexFinalMessageFixture {
  name: string;
  description: string;
  notifications: CodexNotification[];
  expectedFinalMessage: string | null;
  expectedCanValidate: boolean;
}

export const CODEX_FINAL_MESSAGE_MAX_BYTES = 64 * 1024;

const THREAD_ID = "thread-test";
const TURN_ID = "turn-test";

function agentMessageDelta(delta: string, itemId = "msg-delta-1"): CodexNotification {
  return {
    method: "item/agentMessage/delta",
    params: { delta, itemId, threadId: THREAD_ID, turnId: TURN_ID },
  };
}

function agentMessageCompleted(
  text: string,
  phase = "final_answer",
  itemId = "msg-final-1",
): CodexNotification {
  return {
    method: "item/completed",
    params: {
      item: { type: "agentMessage", id: itemId, phase, text },
      threadId: THREAD_ID,
      turnId: TURN_ID,
      completedAtMs: 1784344012053,
    },
  };
}

function commandExecutionCompleted(output: string, exitCode = 0): CodexNotification {
  return {
    method: "item/completed",
    params: {
      item: {
        type: "commandExecution",
        id: "cmd-1",
        command: "npm test",
        cwd: ".",
        commandActions: [{ type: "unknown", command: "npm test" }],
        status: "completed",
        exitCode,
        durationMs: 842,
        aggregatedOutput: output,
      },
      threadId: THREAD_ID,
      turnId: TURN_ID,
      completedAtMs: 1784344012053,
    },
  };
}

function turnCompleted(): CodexNotification {
  return {
    method: "turn/completed",
    params: { turn: { id: TURN_ID, status: "completed" } },
  };
}

const passedJson = JSON.stringify({
  schema_version: 1,
  outcome: "passed",
  summary: "All checks passed.",
  findings: [],
  evidence_refs: ["event:abc"],
  missing_evidence: [],
  key_decisions: ["Used pattern X"],
  lessons_candidate: ["Pattern X works well"],
});

const failedJson = JSON.stringify({
  schema_version: 1,
  outcome: "failed",
  summary: "Tests failed.",
  findings: [{
    severity: "error",
    message: "Test assertion failed",
    suggestion: "Fix the assertion",
    evidence_refs: ["event:def"],
    file_path: "src/app.ts",
    line: 42,
  }],
  evidence_refs: ["event:def"],
  missing_evidence: [],
  key_decisions: [],
  lessons_candidate: [],
});

const blockedJson = JSON.stringify({
  schema_version: 1,
  outcome: "blocked",
  summary: "Missing test evidence.",
  findings: [],
  evidence_refs: [],
  missing_evidence: ["test evidence"],
  key_decisions: [],
  lessons_candidate: [],
});

export const codexFinalMessageFixtures: CodexFinalMessageFixture[] = [
  {
    name: "pureJsonPassed",
    description: "Pure JSON final message with passed outcome",
    notifications: [
      agentMessageDelta("Working...\n"),
      agentMessageCompleted(passedJson),
      turnCompleted(),
    ],
    expectedFinalMessage: passedJson,
    expectedCanValidate: true,
  },
  {
    name: "fencedJsonFailed",
    description: "JSON fenced block final message with failed outcome",
    notifications: [
      agentMessageDelta("Checking...\n"),
      agentMessageCompleted("```json\n" + failedJson + "\n```"),
      turnCompleted(),
    ],
    expectedFinalMessage: "```json\n" + failedJson + "\n```",
    expectedCanValidate: true,
  },
  {
    name: "blockedResult",
    description: "Blocked outcome final message",
    notifications: [
      agentMessageCompleted(blockedJson),
      turnCompleted(),
    ],
    expectedFinalMessage: blockedJson,
    expectedCanValidate: true,
  },
  {
    name: "invalidJson",
    description: "Invalid JSON in final message (should be unparsable -> Blocked)",
    notifications: [
      agentMessageCompleted("{ this is not valid json }"),
      turnCompleted(),
    ],
    expectedFinalMessage: "{ this is not valid json }",
    expectedCanValidate: true,
  },
  {
    name: "oversizedMessage",
    description: "Final message exceeding 64 KiB boundary",
    notifications: [
      agentMessageCompleted("x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1)),
      turnCompleted(),
    ],
    expectedFinalMessage: "x".repeat(CODEX_FINAL_MESSAGE_MAX_BYTES + 1),
    expectedCanValidate: true,
  },
  {
    name: "missingFinalMessage",
    description: "No agentMessage with phase=final_answer (commentary only)",
    notifications: [
      agentMessageDelta("Working...\n"),
      agentMessageCompleted("I'm reviewing the code.", "commentary", "msg-commentary"),
      turnCompleted(),
    ],
    expectedFinalMessage: null,
    expectedCanValidate: false,
  },
  {
    name: "multipleFinalAnswers",
    description: "Multiple final_answer items, should take the last one",
    notifications: [
      agentMessageCompleted(passedJson, "final_answer", "msg-1"),
      agentMessageCompleted(failedJson, "final_answer", "msg-2"),
      turnCompleted(),
    ],
    expectedFinalMessage: failedJson,
    expectedCanValidate: true,
  },
  {
    name: "commentaryPreamble",
    description: "Commentary preamble followed by final_answer (must not accumulate deltas)",
    notifications: [
      agentMessageDelta("Let me check...\n"),
      agentMessageCompleted("I'm reviewing the code.", "commentary", "msg-commentary"),
      agentMessageCompleted(passedJson, "final_answer", "msg-final"),
      turnCompleted(),
    ],
    expectedFinalMessage: passedJson,
    expectedCanValidate: true,
  },
  {
    name: "unicodeContent",
    description: "Unicode content in final message (✓ 中文 café preserved)",
    notifications: [
      agentMessageCompleted(passedJson.replace("All checks passed.", "✓ 中文 café - All checks passed.")),
      turnCompleted(),
    ],
    expectedFinalMessage: passedJson.replace("All checks passed.", "✓ 中文 café - All checks passed."),
    expectedCanValidate: true,
  },
  {
    name: "commandIsolation",
    description: "Command output stays isolated from final message",
    notifications: [
      commandExecutionCompleted("PROBE_CMD_OUTPUT_MARKER_9F3A\n", 0),
      agentMessageCompleted(passedJson),
      turnCompleted(),
    ],
    expectedFinalMessage: passedJson,
    expectedCanValidate: true,
  },
];
