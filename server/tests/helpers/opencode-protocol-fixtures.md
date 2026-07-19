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

## T007: API-key provider allowlist — env var convention confirmed, provider IDs are not a fixed enum

### Caveat: `opencode models` on a normal install is contaminated by personal config

Running `opencode models` under the real `HOME` lists whatever custom provider aliases the
operator has configured in their own `~/.config/opencode/opencode.jsonc` (e.g.
`heiyucode-openai`, `micu-claude` — personal proxy/aliases, not OpenCode built-ins). **These
are not a baseline provider catalog** — re-running under an isolated, freshly-generated
`HOME` (no user config) showed **only** the bundled `opencode/*-free` models. OpenCode does
not ship a fixed enum of "well-known provider" identifiers the way the design's `DR-001`
phrasing ("集中allowlist把model_provider映射到CLI实际支持的环境变量") implied — a "provider"
is an arbitrary alias defined by whatever config or env var makes it resolvable.

### Confirmed: standard `<PROVIDER>_API_KEY` env vars are auto-detected, at zero cost to verify

Each test below only ran `opencode models` (a local listing command, no outbound API call,
no real key required — a **fake** key value was used throughout, verified safe/free) with
an isolated, empty `HOME` plus one env var set, checking whether the corresponding provider
id appeared in the listing:

| Env var | Provider id that appears |
| --- | --- |
| `OPENAI_API_KEY` | `openai` |
| `ANTHROPIC_API_KEY` | `anthropic` |
| `DEEPSEEK_API_KEY` | `deepseek` |
| `GEMINI_API_KEY` **or** `GOOGLE_API_KEY` | `google` |
| `OPENROUTER_API_KEY` | `openrouter` |
| `GROQ_API_KEY` | `groq` |
| `MISTRAL_API_KEY` | `mistral` |
| `XAI_API_KEY` | `xai` |
| `TOGETHER_API_KEY` | `togetherai` |
| `PERPLEXITY_API_KEY` | `perplexity` (and `perplexity-agent`) |

This is a real, usable allowlist for F005's `AuthMaterial` mapping (design §5.3): the
`AdapterAuthMaterial.env` shape (`Record<string,string>`) is confirmed correct — inject
exactly one `<PROVIDER>_API_KEY` env var per configured provider, nothing else, key never
touches argv or any workspace file. Adapter should restrict `model_provider` input to this
confirmed allowlist (returning `ADAPTER_MODEL_PROVIDER_UNSUPPORTED` for anything else per
design §5.3), since providers outside this list are unverified and design explicitly says
not to let users specify arbitrary env var names.

## T008: Credential isolation / escalation boundary (no pre-execution hook exists)

Confirmed empirically with a real OpenCode process, spawned with an **explicitly
constructed minimal env** (not inherited `process.env`): only `PATH`, `SystemRoot`,
`TEMP`/`TMP`, and `HOME`/`USERPROFILE` redirected to an isolated scratch dir with no git
credential store — no `SSH_AUTH_SOCK`, no `GH_TOKEN`, no git credential helper. Target
remote: a real, syntactically valid GitHub HTTPS URL for a nonexistent/inaccessible repo
(`https://github.com/personahub-nonexistent-test-org/does-not-exist-test-repo-xyz123.git`)
— a real (harmless) network round-trip to github.com, no data exfiltration risk, same class
of check git itself performs on every push attempt.

```json
{"status":"completed","input":{"command":"git push origin main"},
 "output":"remote: Repository not found.\nfatal: repository '...' not found\n",
 "metadata":{"exit":1,...}}
```

**Confirmed**: push fails, `metadata.exit:1` — a genuinely structured, reliable failure
signal (see T006 — OpenCode's `tool_use` always carries `metadata.exit`, an advantage over
Claude here). **Capability note, honestly recorded**: the failure text is `"Repository not
found"`, not an explicit `"Authentication failed"` — this is GitHub's own privacy-preserving
behavior (private/inaccessible repos 404 rather than 403, regardless of whether credentials
were present but insufficient, or entirely absent). The
`CredentialIsolationBlocked` classifier (design §6.4) must therefore pattern-match multiple
message shapes as equivalent "push blocked" signals — `"not found"`, `"could not read
Username"`, `"Authentication failed"`, `"terminal prompts disabled"` — not assume a single
canonical string.

**No pre-execution interception exists for OpenCode** (confirmed by absence: no
`--permission-prompt`-style flag in `--help`, no hook-registration mechanism analogous to
Claude's `--settings`/`PreToolUse` found in the CLI surface) — credential isolation is
confirmed as the **sole** effective defense, exactly as design's `NFR-003` already commits
to. `GIT_TERMINAL_PROMPT=0` (already set by F002's existing `buildChildEnv()` in
`workspace-context.ts`) correctly prevented any interactive-prompt hang in this test — no
new env var is needed for OpenCode beyond what F002 already sets.

## T009: Minimal auth directory isolation — `XDG_DATA_HOME` + `XDG_CONFIG_HOME`

Confirmed: with `HOME`/`USERPROFILE` fully redirected to an isolated scratch directory,
setting **both** `XDG_DATA_HOME` (→ real `~/.local/share`) and `XDG_CONFIG_HOME` (→ real
`~/.config`) to their real paths made `opencode auth list` correctly show the real
credential (`1 credentials`, the operator's real provider entry) — no warnings, cleaner
than Claude's equivalent mechanism. **Both variables are required**: `XDG_DATA_HOME` alone
locates `auth.json` (the credential store); `XDG_CONFIG_HOME` alone locates
`opencode.jsonc` (provider/model config) — OpenCode's OAuth-mode login material and its
provider configuration live under these two separately-named XDG roots, not a single
combined directory the way Claude's `.claude` folder bundles config+auth together.

SSH agent, git credential helper, and GH token exposure remain governed by
`HOME`/`USERPROFILE` alone (which stays isolated) — this mechanism does not widen git
credential isolation.

## Next: T009a (executable resolver implementation).
