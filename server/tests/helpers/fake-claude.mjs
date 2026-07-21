#!/usr/bin/env node
// Fake Claude Code CLI: stands in for `claude -p --output-format stream-json
// --verbose`. Emits NDJSON shapes taken from real captures
// (server/tests/helpers/claude-protocol-fixtures.md), selected by
// FAKE_CLAUDE_MODE. Unlike fake-codex.mjs, Claude's real protocol is a
// one-shot prompt-in/NDJSON-out stream with no JSON-RPC handshake — this
// script just reads the whole prompt from stdin (to prove the adapter wrote
// it there, not argv) and then emits its scripted sequence.

const mode = process.env.FAKE_CLAUDE_MODE ?? "success";

let stdinText = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { stdinText += chunk; });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function assistantText(text) {
  send({ type: "assistant", message: { content: [{ type: "text", text }] }, timestamp: new Date().toISOString() });
}

function assistantToolUse(id, command) {
  send({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "PowerShell", input: { command, description: "" }, caller: { type: "direct" } }] },
    timestamp: new Date().toISOString(),
  });
}

function userToolResult(id, content, isError, meta) {
  const line = {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
    timestamp: new Date().toISOString(),
  };
  if (meta) line.tool_result_meta = [{ id, non_execution_kind: meta }];
  send(line);
}

function result(isError, resultText, permissionDenials) {
  send({
    type: "result",
    subtype: isError ? "error" : "success",
    is_error: isError,
    result: resultText,
    terminal_reason: "completed",
    permission_denials: permissionDenials ?? [],
  });
}

process.stdin.on("end", () => {
  // stdinText now holds the full instructions+context the adapter wrote —
  // available for assertions via FAKE_CLAUDE_ECHO_STDIN if ever needed.
  void stdinText;

  if (mode === "success") {
    setTimeout(() => {
      assistantText("Done!");
      setTimeout(() => result(false, "Done!"), 10);
    }, 10);
  } else if (mode === "failure") {
    setTimeout(() => {
      result(true, "Not logged in · Please run /login");
    }, 10);
  } else if (mode === "hard_failure") {
    setTimeout(() => {
      process.stderr.write("Error: unknown option --not-a-real-flag\n");
      process.exit(1);
    }, 10);
  } else if (mode === "command_success") {
    setTimeout(() => {
      assistantToolUse("toolu-1", "npm test");
      setTimeout(() => {
        userToolResult("toolu-1", "test passed", false);
        setTimeout(() => {
          assistantText("Tests passed.");
          setTimeout(() => result(false, "Tests passed."), 10);
        }, 10);
      }, 10);
    }, 10);
  } else if (mode === "command_failure") {
    setTimeout(() => {
      assistantToolUse("toolu-1", "npm test");
      setTimeout(() => {
        userToolResult("toolu-1", "FAIL src/app.test.ts", true);
        setTimeout(() => result(false, "Tests failed."), 10);
      }, 10);
    }, 10);
  } else if (mode === "escalation") {
    setTimeout(() => {
      assistantToolUse("toolu-push", "git push origin main");
      setTimeout(() => {
        userToolResult(
          "toolu-push",
          "PersonaHub PreToolUse hook: git push blocked (no push credentials)",
          true,
          "permission-rule",
        );
      }, 10);
    }, 10);
  } else if (mode === "credential_failure") {
    // Simulates hook injection having failed/been unavailable: the push
    // actually ran and failed at the credential layer (no tool_result_meta).
    setTimeout(() => {
      assistantToolUse("toolu-push", "git push origin main");
      setTimeout(() => {
        userToolResult("toolu-push", "remote: Permission denied (publickey).", true);
      }, 10);
    }, 10);
  } else if (mode === "json_final_message") {
    // T041: proves F004's parseValidationResult (adapter-agnostic, only ever
    // reads Run.final_message) receives Claude's `result.result` unchanged —
    // same technique F004 already uses to make Codex emit a JSON validation
    // envelope in its final message works unchanged for Claude.
    setTimeout(() => {
      result(false, JSON.stringify({
        schema_version: 1,
        outcome: "passed",
        summary: "All checks passed.",
        findings: [],
        evidence_refs: [],
        missing_evidence: [],
        key_decisions: [],
        lessons_candidate: [],
      }));
    }, 10);
  } else if (mode === "malformed") {
    setTimeout(() => {
      process.stdout.write("{ this is not valid json\n");
      setTimeout(() => {
        send({ type: "unknown_event", foo: "bar" });
        setTimeout(() => result(false, "Done despite noise."), 10);
      }, 10);
    }, 10);
  } else if (mode === "cancel") {
    // Never completes on its own; stays alive until SIGINT/SIGKILL, matching
    // T002's confirmed "no result event on SIGINT" behavior (default Node
    // signal handling: exits with code:null, signal:'SIGINT'). Needs an
    // active handle or the process exits on its own once this handler
    // returns (nothing else is keeping the event loop alive).
    assistantToolUse("toolu-long", "sleep 300");
    setInterval(() => {}, 60_000);
  }
});
