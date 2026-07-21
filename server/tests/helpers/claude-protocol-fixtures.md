# Claude Code CLI Protocol Probe Results

> Phase 1 (T001-T004): Real Claude Code CLI probe for F005.
> Probe script: `server/tests/helpers/claude-probe.mjs` (added alongside T002).

## Probe Environment

- **Claude Code CLI version**: 2.1.215
- **Install path**: `C:\Users\...\.local\bin\claude.exe` — a real native executable,
  not a Windows batch shim. Confirmed via `where claude`. This means Claude does **not**
  need the executable-resolver / shim-unwrapping logic that Codex and OpenCode require
  (see T009a); it can be spawned directly with `shell: false`.
- **Platform**: Windows 10.0.26200 (x86_64)
- **Probe date**: 2026-07-19

## T001: Version, path resolution, and auth status

### `claude --help` — relevant subcommands

```text
Commands:
  agents [options]                      Manage background agents
  auth                                  Manage authentication
  ...
  setup-token                           Set up a long-lived authentication token
                                        (requires Claude subscription)
```

Claude Code ships a real `auth` subcommand with `login` / `logout` / `status`. This is
notably better than Codex's situation (which per F002 has no equivalent stable non-interactive
auth-status command) — F005 design §5.2 should use `claude auth status` as the auth probe,
not a prompt-based fallback.

### `claude auth status --json` (default is already JSON)

Real command, non-interactive, machine-parseable, exits promptly:

```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "[REDACTED]",
  "orgId": "[REDACTED]",
  "orgName": "[REDACTED]",
  "subscriptionType": "pro"
}
```

Exit code: `0` when logged in.

**PII warning**: the real response contains the user's account email and org id/name.
These fields **must be redacted or dropped** before this JSON is used in any log,
`auth_status_message`, ThreadEvent payload, or test fixture — they are account PII, not
just secrets in the DR-001 sense. The adapter's `validate()` should only propagate
`loggedIn` / `authMethod` / `apiProvider` upstream, never `email`/`orgId`/`orgName`.

### Verified empirically: logged-out state, and that `--version` is auth-independent

Rather than running `claude auth logout` (which would touch the operator's real, shared
login state — a hard-to-reverse action on shared credentials, out of scope for a safe
local probe), the logged-out case was simulated safely by spawning the child process with
`HOME`/`USERPROFILE` redirected to an empty temp directory. This is not a shortcut — it is
**exactly** the mechanism F005 §5.4 (provider-specific auth directory injection) uses at
runtime, so the probe result directly transfers to the real adapter behavior:

```jsonc
// HOME/USERPROFILE -> empty temp dir
// $ claude auth status
{ "loggedIn": false, "authMethod": "none", "apiProvider": "firstParty" }
// exit code: 1
```

```text
// same empty HOME/USERPROFILE
// $ claude --version
2.1.215 (Claude Code)
// exit code: 0
```

**Confirmed finding**: `claude --version` succeeds identically (same output, exit 0)
regardless of login state. It is a pure CLI metadata command with no auth check.
This empirically confirms design's existing assumption ("`--version` 不足以代表已登录")
rather than merely asserting it architecturally — `auth status` is the only reliable
non-interactive login probe.

**Side-effect finding (new)**: `claude auth status` is **not purely read-only**. Running it
against an empty `HOME` created:

```text
<home>/.claude/backups/          (empty dir)
<home>/.claude.json              ({ firstStartTime, machineID, migration flags, ... })
```

None of this is secret (no tokens/keys), but design §5.2's phrase "非交互、只读的
version/auth probe" is not literally accurate for `auth status` — it does write minor
bookkeeping files into whatever `HOME`/`USERPROFILE` the child process sees. This has no
practical consequence for F005 because the runtime already redirects Claude's auth
directory to a provider-specific PersonaHub-managed location (§5.4), never the project
workspace — so these bookkeeping writes land in the isolated auth dir, not the user's
repository. Documented here so the "read-only" wording in design.md is understood
precisely (probe may create/update its own config bookkeeping in its auth dir; it never
touches workspace content).

### Windows startup

No shell wrapper needed — `claude.exe` is a native binary, spawned directly with
`shell: false`, matching the Claude adapter design (§6.3).

## T002: One-shot `--print` + `stream-json` protocol

### Required argv

```text
claude -p --output-format stream-json --verbose
```

- **`--verbose` is mandatory**, not optional, when combining `--print` with
  `--output-format=stream-json`. Omitting it is an argv-level failure:
  `Error: When using --print, --output-format=stream-json requires --verbose` (plain text
  on stderr, exit 1, **no JSON emitted at all** — this is a distinct failure mode from the
  in-band graceful errors below, and the adapter must handle "no parseable JSON, nonzero
  exit" as a spawn-level failure class, not try to parse stderr as protocol data).
- **Prompt via stdin, not argv.** `echo "<prompt>" | claude -p --output-format stream-json
  --verbose` works cleanly. This is what the ClaudeCodeAdapter should use — it satisfies
  design §6.3's "instructions 不得在 argv" requirement directly, and also avoids a real
  stdin-handling quirk: if the prompt is instead passed as a positional argv value with the
  child's stdin left open/inherited (not explicitly closed), the CLI stalls ~3s waiting for
  stdin and prints `Warning: no stdin data received in 3s, proceeding without it` to stderr.
  If argv-based prompt passing is ever needed, stdin must be explicitly closed
  (`stdio: ["ignore", ...]`), never left inherited.
- Windows: real exe, `shell: false`, no shim resolution needed (see T001).

### Event stream shape (NDJSON, one JSON object per line)

Observed `type` values, in the order they appear for a typical turn:

| `type` | Notes |
| --- | --- |
| `system` / `subtype: hook_started"` \| `"hook_response"` | Only appears if the operator's own `~/.claude/settings.json` has hooks configured (e.g. `SessionStart`). **Must be ignored as noise by the normalizer** — this is user-profile-specific, not part of the Claude Code protocol contract, and its mere presence in this probe is itself a finding (see "Environment contamination" below). |
| `system` / `subtype: "init"` | First substantive line. Carries `session_id`, `cwd`, `model`, `permissionMode`, `tools`, `apiKeySource`, `claude_code_version`. |
| `system` / `subtype: "thinking_tokens"` | Periodic token-estimate updates. Ignorable noise. |
| `assistant` | `message.content[]` array; items are `{type:"thinking"}`, `{type:"text", text}`, or `{type:"tool_use", id, name, input, caller}`. Multiple `assistant` lines can share the same `message.id` (thinking + tool_use split across lines). |
| `user` | Tool **results**, not real user input — `message.content[].type === "tool_result"` with `tool_use_id`, `content` (string), `is_error`. Top-level `tool_use_result` carries `{stdout, stderr, interrupted, isImage}` for shell-style tools. |
| `rate_limit_event` | Noise, ignorable. |
| `result` | **Terminal event, exactly one per run.** See below. |

### Final message = `result.result`

The terminal line has `"type":"result"` and a plain-string `.result` field — this is the
F004 `RunExitResult.finalMessage` equivalent. Also carries `is_error`, `api_error_status`,
`stop_reason`, `terminal_reason`, `duration_ms`, `usage`, and **`permission_denials[]`**
(see T003).

### Tool name on Windows is `PowerShell`, not `Bash`

The built-in shell-execution tool is named `PowerShell` in the `tools` list and in
`tool_use.name` on this Windows install — **not** `Bash`. Any git-push detection logic
(T003/T039) must match against `PowerShell` tool_use with a `command` field parsed for
`git push`, not assume a `Bash` tool name. (This will differ on non-Windows hosts; the
normalizer should not hardcode a single tool name.)

### Graceful in-band errors (exit 1, but well-formed JSON)

Two confirmed cases, same shape family — `assistant.message.error` set, `result.is_error:
true`, human-readable `result.result` text, process exit code `1`:

1. **Auth failure** (simulated via isolated `HOME`/`USERPROFILE`, see T001):
   `error: "authentication_failed"`, `result: "Not logged in · Please run /login"`,
   `assistant.message.model: "<synthetic>"` (no real model call happened).
2. **Invalid model** (`--model this-model-does-not-exist-xyz`):
   `error: "model_not_found"`, `api_error_status: 404`,
   `result: "There's an issue with the selected model ..."`.

Both are **not** spawn failures — the process runs normally and produces a complete,
parseable event stream ending in a `result` event. The adapter's failure classification
must inspect `result.is_error` / `result.terminal_reason`, not just exit code, to
distinguish "ran but reported an error" from "never produced a result at all" (below).

### Hard spawn-level failures (no JSON at all)

- Unknown flag (`--not-a-real-flag`): plain text `error: unknown option ...` on stderr,
  exit 1, zero JSON lines.
- Missing required `--verbose` (see above): same shape.

The normalizer must treat "process exited nonzero with no parseable `result` line" as a
distinct failure class from the graceful in-band errors above.

### Cancel (SIGINT mid-run)

Sending `SIGINT` to the child mid-turn (verified with a multi-step PowerShell task,
`stdio: ["ignore","pipe","pipe"]` to avoid the stdin stall) terminates the process
immediately: `code: null, signal: "SIGINT"`. **No terminal `result` event is ever
emitted** — the adapter's cancel/onExit-once path must treat `(code === null && signal ===
"SIGINT")` itself as the terminal "cancelled" state, not wait for a `result` line that will
never arrive.

### Environment contamination (probe caveat — do not carry into the real adapter)

This probe ran the child process with the operator's **real** `HOME`, and consequently the
CLI loaded the operator's full profile: `~/.claude/settings.json` permission allow/deny
rules, hooks (`SessionStart`/`Stop`), skills, and memory paths — all visible in the `init`
event's `tools`/`skills`/`slash_commands`/`memory_paths` fields, and in the `hook_started`/
`hook_response` lines. **None of this is representative of how the real ClaudeCodeAdapter
must spawn Claude for a PersonaHub Run.** It confirms, empirically, why F002's
`buildChildEnv()` approach (build an explicit minimal env object, never `{...process.env}`)
is the right one — and extends the same principle from *credentials* to the *entire
profile*: the real adapter must ensure the workspace-scoped Claude config directory (design
§5.4) has no operator hooks/skills/memory bleeding into a Run. This is a design
confirmation, not a change — flagged here because it was empirically observed, not merely
assumed.

## T003: Pre-execution approval — real mechanism found, differs from design's assumption

### Finding: there is no `control_request`/`control_response` message in the stream at all

T002 already showed that a *denied* tool call surfaces only as a post-hoc `tool_result`
(`is_error:true`) plus an entry in the terminal `result.permission_denials[]` array — never
as a live request/response pair the calling process can intercept mid-flight. This holds
for **both** plain `-p --output-format stream-json` and (checked via `--help`, no
`--permission-prompt-tool` or equivalent flag exists in 2.1.215) the documented flag
surface. Design §6.3 and §14 Q1 cite multica's `claude.go` `handleControlRequest` as
evidence this channel exists — that code almost certainly targets the
`@anthropic-ai/claude-agent-sdk` used as an **embedded JS library** (where a `canUseTool`
JS callback is genuinely available), not the standalone `claude` binary invoked as a
subprocess, which is the only integration shape available to a non-JS adapter spawning a
CLI. **The design's assumed mechanism does not exist for a subprocess-based adapter.**

### Finding: the real mechanism is a `PreToolUse` hook, registered via `--settings`

Empirically confirmed end-to-end, with a genuinely safe setup (git remote pointed at a
local bare repo under the scratch temp dir — no network reached, verified by inspecting the
bare repo's refs after the test: zero branches, proving the push never executed):

1. Pass `--settings <path-or-inline-json>` at spawn time with:
   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "PowerShell",
           "hooks": [ { "type": "command", "command": "node \"<hook-script-path>\"" } ]
         }
       ]
     }
   }
   ```
   `--settings` accepts either a file path or an inline JSON string (per `--help`), so the
   adapter does not need to manage a settings file's lifecycle — it can pass the JSON
   inline as an argv value.
2. Claude Code invokes `<hook-script>` as a **separate short-lived child process** per
   matched tool call, feeding it a JSON payload via stdin that includes `tool_input`
   (containing the `command` field for the PowerShell/Bash tool), and waits for the hook's
   response before deciding whether to run the real tool.
3. The hook signals a block by writing JSON to stdout:
   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "permissionDecision": "deny",
       "permissionDecisionReason": "PersonaHub PreToolUse hook: git push blocked (no push credentials)"
     }
   }
   ```
   exit code 0. **Confirmed working**: the model's `git push origin main` tool_use never
   executed; the `tool_result` fed back to the model was exactly the hook's
   `permissionDecisionReason` string, and the target bare repo received zero refs.
4. An exit-code-based convention (`process.exit(2)` + stderr reason) was also tried as a
   simpler alternative, but the test run was preempted by a **separate, built-in** Claude
   Code guard (see next finding) before it could be conclusively isolated — the JSON
   `hookSpecificOutput` convention above is the one to rely on since it was cleanly
   confirmed.

### Secondary finding: Claude Code has its own built-in "risky command" guard, independent of any hook

Some `git` invocations (a bare `git push origin main`, and any command chained with
`&&`/pipes) were blocked with a **CLI-internal** message —
`"This PowerShell command contains multiple operations. The following part requires
approval: ..."` — that has nothing to do with any custom hook (it fired even in a run where
no matching custom hook denial occurred first). In a headless `-p` run with no interactive
approval channel, this can **never** be satisfied: the model retries a few times and then
gives up, burning turns/cost. This is not blocking for F005 (PersonaHub's own `PreToolUse`
hook denial for `git push` arrives functionally "on top of" or sometimes ahead of this
built-in guard — either way the net effect is the same: push does not happen), but it's
worth the adapter's normalizer treating this specific message shape as an equivalent
"blocked" signal too (not a generic tool error), and being aware that some safe, unrelated
compound commands may also trip this guard and need the adapter to tolerate a couple of
wasted turns rather than treating it as a hard failure.

### Design/spec/task correction required — DONE, applied same day

This was a load-bearing correction, not a detail. Already applied to
`docs/features/0.1/F005-multi-agent-manual-routing/{design,spec,tasks}.md`:

- **design.md §6.3 / §14 / §5.4 references to `control_request`/`control_response` and
  multica's `handleControlRequest`** replaced with: spawn-time `--settings` JSON
  registering a `PreToolUse` hook, whose `command` points to a PersonaHub-bundled hook
  script that inspects `tool_input.command` for dangerous git operations (git push /
  force-push) and denies via `hookSpecificOutput.permissionDecision: "deny"` when
  `push_credentials_enabled` is false.
- **spec.md NFR-003 / risk table / §14 Q1** ("Claude 有真实的 control_request 前置审批通道")
  corrected to describe the actual mechanism (PreToolUse hook), not the stream-protocol one.
- **tasks.md T003/T039/T040** wording ("验证 control_request/control_response 真实字段",
  "接入 approval response") rewritten to describe implementing the hook script and wiring
  `--settings` at spawn time, not parsing control messages from the stdout stream.
- The **security conclusion is unchanged and, if anything, stronger**: Claude Code *does*
  have a genuine pre-execution interception capability usable by a subprocess-spawning
  adapter — it just works through the hook system, not an in-stream RPC. NFR-003's
  distinction between Claude (real pre-execution capability) and OpenCode (no equivalent)
  still holds.

## T035 re-verification: real raw NDJSON captured, plus a finding that upgrades T004's approach

Phase 5 (T035) re-ran two safe, minimal-cost live probes against the actual installed
Claude Code CLI (2.1.216, same install as Phase 1) to get **literal raw NDJSON**, not just
prose paraphrase — the T001-T004 notes above described shapes but this repo never captured
literal JSON for `assistant`/`user`/`result` lines. Probe 1: `claude -p "Run the shell
command 'echo hello-from-tool' and tell me the output." --output-format stream-json
--verbose` (no hook). Probe 2: same prompt with `--settings` registering a real `PreToolUse`
deny hook (a throwaway script outside the repo, denying with reason
`"PERSONAHUB_DENY_MARKER: blocked by test hook"`). Both confirm and extend T001-T004:

- `assistant`/`user` lines carry `timestamp` as a **top-level sibling of `message`**, not
  nested inside it (confirms T004's "assistant message's top-level timestamp" reading).
- `assistant` tool_use content item: `{"type":"tool_use","id":"toolu_...","name":"PowerShell","input":{"command":"...","description":"..."},"caller":{"type":"direct"}}`.
- Normal (non-denied) `user`/tool_result: `{"type":"tool_result","tool_use_id":"toolu_...","content":"<stdout string>","is_error":false}`, with a top-level `tool_use_result: {stdout, stderr, interrupted, isImage}` object sibling — matches T004 exactly.
- **New finding, not in T001-T004**: a hook-denied tool_result has **two** extra structural
  markers beyond what T003 documented:
  1. Top-level `tool_use_result` is a **plain string** (`"Error: <reason>"`), not the
     `{stdout,stderr,...}` object shape used for real executions — polymorphic by denial
     status, the normalizer must not assume `.stdout` always exists.
  2. A top-level `tool_result_meta: [{ id: "<tool_use_id>", non_execution_kind: "permission-rule" }]`
     array appears **only** when a tool call was denied pre-execution — this is a
     **structured, non-fragile** signal for real-time `Blocked` classification, strictly
     better than the string-matching T004 recommended as a fallback (option "a"). The
     normalizer should check `tool_result_meta` for the matching `tool_use_id` first, and
     only fall back to denial-message pattern matching (T004's option "a") if absent — e.g.
     for Claude's own built-in "risky command" guard (T003), which was not re-verified here
     to still confirm its own `non_execution_kind` value (out of scope for this minimal
     re-probe; treating any non-null `non_execution_kind` as "blocked, not a normal command
     failure" is a safe generalization either way).
  3. This changes T004's conclusion: real-time `Blocked` classification (option "a") is
     **not actually fragile** for the PersonaHub-hook-denial case specifically — it's exact
     and structural, not pattern-matched prose. T004's "defer to end-of-run
     `permission_denials[]`" (option "b") is downgraded from "recommended" to "unnecessary
     for the common case, kept only as a defense-in-depth cross-check" since
     `CommandCorrelator.handleCompleted()` (server/src/runtime/trace/command-correlator.ts)
     already drops any second `command_completed` signal for an itemId once completed —
     there is no live second-write path to reclassify through even if we wanted one.
- Terminal `result.permission_denials[]` real shape: `[{tool_name, tool_use_id, tool_input}]`
  — no denial-reason text repeated here, just identifies which tool call(s) were denied.

## T004: RunTraceSignal / F004 parser compatibility

Derived from the T002/T003 probe data above — no additional live CLI calls needed, this is
a field-mapping exercise against the domain contracts (`shared/src/types/trace.ts`
`RunTraceSignal`, `server/src/services/validation/result-parser.ts`
`parseValidationResult`).

### Final message: fully compatible, no gap

`result.result` (T002) is a plain string. `parseValidationResult()` only requires a plain
string containing either raw JSON or a single top-level ` ```...``` ` fenced block
(`extractJson()`) — it has no CLI-specific assumptions. **Confirmed compatible as-is**: the
same instructions/prompting technique F004 uses to make Codex emit a JSON validation
envelope in its final message will work unchanged for Claude, since the parser only ever
sees `result.result`.

### `command_started` / `command_completed` mapping — partial capability, documented honestly

| `RunTraceSignal` field | Claude source | Status |
| --- | --- | --- |
| `adapterItemId` | `tool_use.id` (assistant message) | **Supported** — direct 1:1 mapping. |
| `command` | `tool_use.input.command` | **Supported**, but tool name is `PowerShell` on this Windows install, not `Bash` — the normalizer must not hardcode a tool name (see T002). |
| `cwd` | *(not present per-call)* | **Capability gap.** Unlike Codex's `item.cwd`, Claude's `tool_use.input` for the PowerShell tool carries only `{command, description}` — no per-call cwd. Since PersonaHub always spawns the session pinned to the workspace directory, the normalizer should report the **session-level spawn cwd** (known to the adapter from its own spawn args), not attempt to parse one from the payload. This is accurate (Claude never changes cwd mid-session in the one-shot model) but is a normalizer-supplied value, not adapter-native data — recorded here so it isn't mistaken for a probed CLI field later. |
| `startedAt` | assistant message's top-level `timestamp` | **Supported** (approximation) — this is "when the model decided to invoke the tool", not a server-side execution-start timestamp Codex-style. Adequate for trace ordering/display; not a hard requirement violation. |
| `source` | — | Always `TraceSource.AdapterStructured` for these (not `ApprovalHook`). |
| `exitCode` | *(not present)* | **Confirmed capability gap.** Claude's `tool_use_result` for PowerShell is `{stdout, stderr, interrupted, isImage}` — **no structured exit code field**, even though PowerShell's own text output sometimes embeds "Exit code N" as plain text inside `stdout`/`content` (seen in the T002 blocked-delete probe). Parsing that text is locale/shell-dependent and not a stable contract. The normalizer must report `exitCode: null` (unknown) rather than attempt free-text parsing, and derive `outcome` from `tool_result.is_error` (boolean) instead — a coarser signal than Codex provides. **This capability is recorded as unsupported, not silently approximated.** |
| `durationMs` | *(not provided, but derivable)* | **Supported via computation**, not a native field: the normalizer can compute wall-clock duration itself from the `tool_use` message's `timestamp` to the matching `tool_result` message's `timestamp` (both present), correlated by `tool_use_id`. Same pattern as F003's existing command-correlator, just sourced from two timestamps instead of one `durationMs` field. |
| `outputSummary` | `tool_result.content` (string, or `tool_use_result.stdout`) | **Supported**, truncate to the same 2 KiB limit as Codex. |
| `outputTruncated` | — | Normalizer-computed, same as Codex. |
| `outcome` (Succeeded/Failed/**Blocked**/Cancelled/Unknown) | `tool_result.is_error` + end-of-run `result.permission_denials[]` | **Two-phase classification required.** `is_error:false` → `Succeeded`; `is_error:true` → `Failed` as a first pass, in real time. Distinguishing the `Blocked` sub-case (denied by the `PreToolUse` hook or Claude's built-in "multiple operations" guard, T003) from an ordinary command failure requires the `permission_denials[]` array, which Claude only emits in the **final** `result` event — not inline per command. The normalizer therefore cannot classify `Blocked` in real time from the command-completed signal alone; it must either (a) do a pattern match against known denial message shapes (`"was blocked. For security..."`, `"requires approval"`, or the adapter's own `permissionDecisionReason` text — fragile but immediate), or (b) defer the final `Blocked` reclassification to end-of-run using `permission_denials[]` by `tool_use_id` (robust, but not real-time). Recommend (b) for the authoritative Evidence Summary / escalation decision, and (a) only as a best-effort real-time trace hint. `Cancelled` maps to the `SIGINT` case (T002): no `command_completed` signal will exist for an in-flight command when the process is killed — the adapter's cancel path must synthesize a `Cancelled` outcome for any command left without a matching `tool_result` when `(code===null, signal==="SIGINT")` is observed. |

### Conclusion

Claude Code CLI can satisfy F003's `RunTraceSignal` contract and F004's parser without any
domain-contract changes, but with **two honestly-recorded, real capability gaps** relative
to Codex: no native `exitCode`, and no real-time `Blocked` classification (only derivable
post-hoc from the final `result` event). Neither blocks F005 — both degrade to a
still-correct, slightly-delayed-or-coarser signal, consistent with design's "unknown
message降低trace completeness，不导致整个Run失败" principle (§6.2). `durationMs` is not a
gap (computable from two existing timestamps), just not a native field the way Codex
provides it directly.

## T009: Minimal auth directory isolation (no full HOME needed)

`CLAUDE_CONFIG_DIR` is a real, honored env var (not documented in `--help`, discovered by
testing the common convention). Confirmed: with `HOME`/`USERPROFILE` fully redirected to an
isolated scratch directory, setting `CLAUDE_CONFIG_DIR` to the **real** `~/.claude` folder
still produces `loggedIn: true` — the real login state is used, without exposing the rest
of a real `HOME` (SSH agent config, git credential helper, GH CLI token, or any other app's
data that would live under a generic HOME override).

**Known benign side effect**: this combination prints a startup warning to stderr about a
missing top-level `.claude.json` (with a suggested backup-restore command) —
`CLAUDE_CONFIG_DIR` must point directly at the `.claude` folder itself (pointing it at the
parent/profile-root instead was tested and does **not** authenticate — `loggedIn: false`),
and Claude Code 2.1.215 apparently expects one piece of top-level bookkeeping state
(`.claude.json`) to sit one level up from the folder `CLAUDE_CONFIG_DIR` points to,
independent of where the real login/credential material actually lives (which — auth
succeeded — is found correctly). This is a minor internal path-resolution inconsistency in
this CLI version, not a security problem: the adapter must tolerate/suppress this specific
stderr warning rather than treat it as a probe/auth failure.

Confirmed: SSH agent, git credential helper, and GH token exposure are governed entirely by
`HOME`/`USERPROFILE` (which stays isolated), independent of `CLAUDE_CONFIG_DIR` — so this
mechanism does not re-widen git credential isolation.

## Next: Phase 1 T005-T010 (OpenCode)
