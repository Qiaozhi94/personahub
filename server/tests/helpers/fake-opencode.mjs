#!/usr/bin/env node
// Fake OpenCode CLI: stands in for `opencode run --format json -m
// <provider>/<model> "<message>"`. Emits NDJSON shapes taken from real
// captures (server/tests/helpers/opencode-protocol-fixtures.md), selected
// by FAKE_OPENCODE_MODE. Unlike Claude, OpenCode's message is a positional
// argv argument (confirmed T044 — no stdin-prompt mode), so this script
// reads its scenario from an env var, not stdin.

// Mode selection prefers argv[2] (survives credential-isolation env
// filtering — real command-line args, unlike env vars, are never touched
// by buildChildEnv()) over FAKE_OPENCODE_MODE (only reaches this process
// when the calling test's workspace has push_credentials_enabled=true).
// Matched against a known-modes allowlist, not just "doesn't start with
// -": unlike Claude's argv (adapter args, then flags starting with "-"),
// OpenCode's argv is [adapter args, "run", "--format", "json", ...] — the
// literal positional token "run" always lands at argv[2] when no mode
// override is configured, so a bare non-flag check would misread it as a
// (bogus) mode name.
const KNOWN_MODES = new Set([
  "success", "failure", "hard_failure", "command_success", "command_failure",
  "credential_failure", "malformed", "json_final_message", "cancel",
]);
const argMode = KNOWN_MODES.has(process.argv[2]) ? process.argv[2] : undefined;
const mode = argMode ?? process.env.FAKE_OPENCODE_MODE ?? "success";

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function stepStart() {
  send({ type: "step_start", part: { type: "step-start" } });
}

function text(t) {
  send({ type: "text", part: { type: "text", text: t } });
}

function toolUse(callID, command, exit, output, startMs, endMs) {
  send({
    type: "tool_use",
    timestamp: endMs,
    part: {
      type: "tool",
      tool: "bash",
      callID,
      state: {
        status: "completed",
        input: { command },
        output,
        metadata: { output, exit, truncated: false },
        time: { start: startMs, end: endMs },
      },
    },
  });
}

function stepFinish(reason) {
  send({ type: "step_finish", part: { type: "step-finish", reason } });
}

function errorLine(message) {
  send({ type: "error", error: { name: "UnknownError", data: { message } } });
}

setTimeout(() => {
  if (mode === "success") {
    stepStart();
    text("4");
    stepFinish("stop");
  } else if (mode === "failure") {
    stepStart();
    errorLine("Unexpected server error. Check server logs for details.");
  } else if (mode === "hard_failure") {
    process.stderr.write("Error: unknown option --not-a-real-flag\n");
    process.exit(1);
  } else if (mode === "command_success") {
    stepStart();
    toolUse("call_1", "npm test", 0, "test passed\n", 1000, 1200);
    stepFinish("tool-calls");
    stepStart();
    text("Tests passed.");
    stepFinish("stop");
  } else if (mode === "command_failure") {
    stepStart();
    toolUse("call_1", "npm test", 1, "FAIL src/app.test.ts\n", 1000, 1300);
    stepFinish("stop");
  } else if (mode === "credential_failure") {
    // T008: real OpenCode push-credential-isolation probe result shape.
    stepStart();
    toolUse(
      "call_push",
      "git push origin main",
      1,
      "remote: Repository not found.\nfatal: repository 'https://github.com/...' not found\n",
      1000,
      1400,
    );
    stepFinish("stop");
  } else if (mode === "malformed") {
    stepStart();
    process.stdout.write("{ this is not valid json\n");
    send({ type: "unknown_event", foo: "bar" });
    text("Done despite noise.");
    stepFinish("stop");
  } else if (mode === "json_final_message") {
    stepStart();
    text(JSON.stringify({
      schema_version: 1,
      outcome: "passed",
      summary: "All checks passed.",
      findings: [],
      evidence_refs: [],
      missing_evidence: [],
      key_decisions: [],
      lessons_candidate: [],
    }));
    stepFinish("stop");
  } else if (mode === "cancel") {
    stepStart();
    text("Working on a long task...");
    setInterval(() => {}, 60_000);
  }
}, 10);
