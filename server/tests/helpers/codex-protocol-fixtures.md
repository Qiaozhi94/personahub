# Codex CLI App-Server Protocol Probe Results

> T001-T003: Protocol probe completed with real Codex CLI 0.144.5 on Windows.
> Probe script: `server/tests/helpers/codex-probe.mjs`

## Probe Environment

- **Codex CLI version**: 0.144.5
- **Platform**: Windows 10.0.26200 (x86_64)
- **Protocol**: JSON-RPC 2.0 over stdio (`codex app-server --listen stdio://`)
- **Probe date**: 2026-07-18

## Confirmed Notification Shapes

### item/started (commandExecution)

Command metadata is inside `params.item.*`, NOT at `params.*` top level.

```json
{
  "jsonrpc": "2.0",
  "method": "item/started",
  "params": {
    "item": {
      "type": "commandExecution",
      "id": "exec-f92a4272-...",
      "command": "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'npm test'",
      "cwd": "C:\\Users\\...\\workspace",
      "commandActions": [{"type": "unknown", "command": "npm test"}],
      "status": "inProgress",
      "exitCode": null,
      "durationMs": null,
      "aggregatedOutput": null
    },
    "threadId": "...",
    "turnId": "...",
    "startedAtMs": 1784344003829
  }
}
```

**Key finding**: `commandActions[0].command` contains the parsed command (`npm test`),
while `item.command` contains the full shell wrapper (`pwsh.exe -Command 'npm test'`).
The normalizer prefers `commandActions[0].command` for cleaner trace events.

### item/completed (commandExecution)

```json
{
  "jsonrpc": "2.0",
  "method": "item/completed",
  "params": {
    "item": {
      "type": "commandExecution",
      "id": "exec-f92a4272-...",
      "command": "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'npm test'",
      "cwd": "...",
      "commandActions": [{"type": "unknown", "command": "npm test"}],
      "status": "completed",
      "exitCode": 0,
      "durationMs": 6736,
      "aggregatedOutput": "\n> probe-test@1.0.0 test\n> echo test passed\n\ntest passed\r\n"
    },
    "threadId": "...",
    "turnId": "...",
    "completedAtMs": 1784344012053
  }
}
```

**Key finding**: Command output is in `item.aggregatedOutput` (full output at completion),
NOT streamed via `item/commandExecution/outputDelta`. There is NO `outputDelta` notification
in the real protocol. The adapter emits `aggregatedOutput` as a run.output chunk when
`item/completed` arrives.

### item/commandExecution/requestApproval

This is a JSON-RPC **request** (has `id`), not a notification.

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "item/commandExecution/requestApproval",
  "params": {
    "threadId": "...",
    "turnId": "...",
    "itemId": "exec-f92a4272-...",
    "startedAtMs": 1784344005313,
    "environmentId": "local",
    "command": "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'npm test'",
    "cwd": "...",
    "commandActions": [{"type": "unknown", "command": "npm test"}],
    "proposedExecpolicyAmendment": ["npm", "test"],
    "availableDecisions": ["accept", {"acceptWithExecpolicyAmendment": {...}}, "cancel"]
  }
}
```

The adapter responds with `{"decision": "accept"}` or `{"decision": "cancel"}`.

### item/fileChange/requestApproval

Separate approval for file writes. Same shape but `method` is `item/fileChange/requestApproval`.

### turn/diff/updated

Emitted at the end with a git diff of all changes. F003 does NOT use this - it uses its own
workspace scanner for file change evidence (per design.md §7.6).

## T002: PowerShell/cmd Command Fields

On Windows, Codex executes commands via PowerShell:
- Full command: `"C:\Program Files\PowerShell\7\pwsh.exe" -Command 'npm test'`
- Parsed command (in `commandActions`): `npm test`

The normalizer uses `commandActions[0].command` to get the clean command without the shell wrapper.
The verification classifier handles PowerShell/cmd wrappers via `stripWrapper()`.

## T003: RunTraceSignal Normalizer Input Mapping (verified)

| Codex notification field | RunTraceSignal field |
| --- | --- |
| `params.item.id` | `adapterItemId` |
| `params.item.commandActions[0].command` (preferred) or `params.item.command` | `command` |
| `params.item.cwd` | `cwd` |
| `params.item.exitCode` | `exitCode` |
| `params.item.durationMs` | `durationMs` |
| `params.item.aggregatedOutput` (truncated to 2 KiB) | `outputSummary` |
| `params.startedAtMs` | `startedAt` (ISO string) |
| `params.itemId` (approval only) | `adapterItemId` |
| Derived from `exitCode` + `status` | `outcome` |

## Normalizer Changes Made

The original normalizer (based on design assumptions) read from `params.*` top level.
After real probe, updated to read from `params.item.*` for `item/started` and `item/completed`.
The domain `RunTraceSignal` contract was NOT changed - only the normalizer's field paths.
This is exactly the T003 contingency: "若真实字段不同，只更新 normalizer，不改变领域 contract"。

## Other Observed Notifications (not used by F003)

- `remoteControl/status/changed` - remote control status
- `thread/started` - thread metadata
- `mcpServer/startupStatus/updated` - MCP server status
- `skills/changed` - skills list
- `thread/status/changed` - thread status (idle/active/waitingOnApproval)
- `turn/started` - turn metadata
- `hook/started` / `hook/completed` - hook execution
- `item/agentMessage/delta` - agent message streaming (emitted as run.output)
- `item/started` / `item/completed` for `userMessage`, `agentMessage`, `reasoning`, `fileChange` types
- `thread/tokenUsage/updated` - token usage
- `account/rateLimits/updated` - rate limits
- `serverRequest/resolved` - approval resolved
- `turn/diff/updated` - git diff at turn end
