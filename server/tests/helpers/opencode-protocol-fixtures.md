# OpenCode CLI Protocol Probe Results

> Phase 1 (T005-T008): Real OpenCode CLI probe for F005.

## Probe Environment

- **OpenCode CLI version**: 1.18.3
- **Install path**: `D:\DevSoft\nodejs\opencode.cmd` — a Windows batch shim forwarding to
  `node_modules/opencode-ai/bin/opencode.exe` (single-layer shim, confirmed in T009a's
  design work). Needs the executable resolver (T009a), unlike Claude.
- **Platform**: Windows 10.0.26200 (x86_64)
- **Probe date**: 2026-07-19

## T005: Version, auth status, one-shot command shape

### Relevant subcommands

```text
opencode run [message..]     run opencode with a message   <- non-interactive one-shot
opencode providers            manage AI providers and credentials   [aliases: auth]
opencode models [provider]    list all available models
```

`opencode run --format json` is the stream-json equivalent. `--auto` ("auto-approve
permissions that are not explicitly denied (dangerous!)") exists — **must never be used**,
matching design's "不使用 dangerous auto-approve flag" for OpenCode.

### `opencode auth list` (alias of `opencode providers list`) is NOT a reliable machine probe

```text
$ opencode auth list
┌  Credentials ~\.local\share\opencode\auth.json
│
●  heiyucode-openai  api
│
└  1 credentials
```

This is human-formatted (ANSI box-drawing), **not JSON**, and — critically — **exit code
does not vary with credential count**: an isolated `HOME`/`USERPROFILE` pointing at an
empty directory produced `0 credentials` with the **same exit code 0** as the real,
credentialed run. Unlike Claude's `auth status --json` (clean JSON + nonzero exit when
logged out), there is no scriptable success/failure signal from this command alone.

**Design's own contingency already covers this** (§5.2: "若CLI没有稳定的非交互auth status
命令，使用最小无workspace写入的prompt probe") — confirmed necessary and sufficient, see next
finding.

### Critical finding: omitting `-m/--model` lets OpenCode silently use a different, free provider — this is NOT a validation shortcut

With an isolated, credential-empty `HOME`, running `opencode run --format json "What is
2+2?"` **without** an explicit `-m` **succeeded** (`"4"`, cost `0`, exit 0) — it did **not**
report an auth failure. Root cause, confirmed via `opencode models`: OpenCode bundles
provider-less, free models directly (`opencode/deepseek-v4-flash-free`,
`opencode/hy3-free`, etc.) and silently falls back to one of these when the intended
provider/model isn't configured, rather than failing.

**This means adapter `validate()` must always pass an explicit `-m <provider>/<model>`
matching the configured adapter's provider** — never omit it — because a successful
*unqualified* run proves nothing about the configured provider's credentials. Confirmed the
fix: re-running the same isolated-HOME probe **with** an explicit
`-m anthropic/claude-sonnet-4-5` (a provider with no credentials in that isolated home)
correctly failed:

```json
{"type":"error","timestamp":...,"sessionID":"...","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_8d002eda"}}}
```
exit code 1.

**Capability gap, honestly recorded**: the error shape is a generic `"UnknownError"` with a
non-specific message ("Unexpected server error. Check server logs for details.") — **not**
a structured `auth_failed`-style code the way Claude provides. The adapter's `validate()`
can reliably detect *that* the explicitly-requested provider failed (any `type:"error"`
event / nonzero exit for that exact `-m` value), but cannot cleanly distinguish "invalid
API key" from "provider misconfigured" from other server-side errors without deeper log
inspection. `auth_status_message` for OpenCode will necessarily be less specific than for
Claude — document this as a real, provider-specific limitation, not something to paper
over with a guessed reason string.

### Windows startup

Batch shim (`opencode.cmd` → `node.exe` + `opencode.exe`, single-layer per T009a) —
requires the executable resolver, unlike Claude.

## T006: One-shot `--format json` protocol

### Event stream shape (NDJSON)

| `type` | Notes |
| --- | --- |
| `step_start` | Turn/step boundary. `part.type: "step-start"`. |
| `text` | `part.text` is a chunk of assistant text; `part.time:{start,end}` (ms epoch). |
| `tool_use` | See below — richer than Claude's shape. |
| `step_finish` | `part.reason` (`"stop"` \| `"tool-calls"`), `part.tokens`, `part.cost`. Multiple steps occur per turn when tool calls happen (step_finish reason:"tool-calls" → new step_start → ... → step_finish reason:"stop"). |
| `error` | Turn-level hard failure (see T005). |

**No single terminal "result" event carrying the full final text** the way Claude has — the
final message must be reconstructed by the normalizer as the **last `text` part's
`.text`** (or the concatenation of `text` parts in the final step whose `step_finish.reason
== "stop"`). This is a real structural difference from both Codex and Claude that the
normalizer must handle explicitly, not assume a single `result`-shaped terminal event
exists.

### `tool_use` shape — richer than Claude's, includes a real exit code

```json
{
  "type": "tool_use",
  "timestamp": 1784471601664,
  "sessionID": "...",
  "part": {
    "type": "tool",
    "tool": "bash",
    "callID": "call_00_...",
    "state": {
      "status": "completed",
      "input": { "command": "echo hello-from-opencode" },
      "output": "hello-from-opencode\n",
      "metadata": { "output": "hello-from-opencode\n", "exit": 0, "truncated": false },
      "title": "echo hello-from-opencode",
      "time": { "start": 1784471601610, "end": 1784471601628 }
    }
  }
}
```

Tool name is **`bash`** (lowercase), even on this Windows install — different from Claude's
`PowerShell`. Confirms the normalizer must not hardcode any single tool name across
adapters.

### `RunTraceSignal` mapping — OpenCode is better than Claude for `exitCode`, worse for terminal-message shape

| Field | OpenCode source | Status |
| --- | --- | --- |
| `adapterItemId` | `part.callID` | Supported. |
| `command` | `part.state.input.command` | Supported. |
| `cwd` | *(not observed in this shape)* | Same gap as Claude — normalizer falls back to session-level spawn cwd. |
| `startedAt` | `part.state.time.start` | Supported, and more precise than Claude's message-level timestamp — this is the actual tool execution start. |
| `exitCode` | `part.state.metadata.exit` | **Supported — a genuine capability advantage over Claude**, which has no structured exit code at all. |
| `durationMs` | `part.state.time.end - time.start` | Supported via computation, both fields present on the same event (no cross-event correlation needed, unlike Claude). |
| `outputSummary` | `part.state.output` / `metadata.output` | Supported. |
| `outcome` | `part.state.status` + `metadata.exit` | Supported for Succeeded/Failed. `Blocked` sub-classification not yet tested against OpenCode (T008 in progress) — no confirmed equivalent to Claude's `permission_denials`. |

### Final message reconstruction — a real structural difference, not a gap

Since there's no single terminal event, the adapter's `RunExitResult.finalMessage` must be
assembled by the normalizer from the last `text` part(s) prior to a `step_finish.reason ==
"stop"`. This still produces a plain string compatible with F004's `parseValidationResult()`
(same as Claude/Codex — the parser has no CLI-specific assumptions), but the *construction*
logic differs per adapter and must be implemented distinctly, not shared.

## Next: T007 (API-key provider allowlist), T008 (escalation/credential isolation), T009
(auth directory isolation across all three CLIs), T009a (executable resolver
implementation).
