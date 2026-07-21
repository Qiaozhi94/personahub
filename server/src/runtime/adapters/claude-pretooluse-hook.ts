import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK_DENY_REASON } from "./claude-protocol.js";

/**
 * design §6.3 / T003 (real finding, corrects the original design assumption
 * of a `control_request`/`control_response` channel): Claude Code's only
 * genuine pre-execution interception point for a subprocess-spawned adapter
 * is a `PreToolUse` hook, registered via `--settings` at spawn time. Claude
 * Code invokes the hook as a **separate short-lived child process** per
 * matched tool call — it cannot import our compiled TS modules, so this
 * script's source must be a fully self-contained string (git-push regex
 * duplicated from shell-command-patterns.ts by necessity, not oversight;
 * the pattern is simple and stable enough that this is an acceptable
 * cross-process-boundary duplication).
 *
 * The hook only ever intervenes for git push — matching Codex's adapter,
 * which auto-accepts every other command approval request (F002 P0 policy).
 * It reads whether push is currently allowed from an env var the adapter
 * sets at spawn time (the hook subprocess inherits the `claude` process's
 * env, which is the same env we already built via buildChildEnv()).
 */
export const PUSH_CREDENTIALS_ENV_VAR = "PERSONAHUB_PUSH_CREDENTIALS_ENABLED";

export const CLAUDE_PRETOOLUSE_HOOK_SCRIPT = `
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(data); } catch { payload = {}; }
  const command = payload && payload.tool_input && payload.tool_input.command;
  const pushEnabled = process.env.${PUSH_CREDENTIALS_ENV_VAR} === "1";
  const isGitPush = typeof command === "string" && /\\bgit\\s+push\\b/i.test(command);
  if (isGitPush && !pushEnabled) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ${JSON.stringify(HOOK_DENY_REASON)},
      },
    }));
  } else {
    process.stdout.write("{}");
  }
  process.exit(0);
});
`;

export interface ClaudePreToolUseHook {
  settingsArg: string;
  cleanup(): void;
}

/**
 * Writes the static hook script to a run-scoped temp file and builds the
 * `--settings` inline JSON value pointing at it. Per design §6.3: hook
 * injection failure must degrade capability, not fail the Run — callers
 * should catch and proceed without `--settings` on error (child-env
 * credential isolation still blocks the push at the OS/git level).
 */
export function writeClaudePreToolUseHook(runId: string): ClaudePreToolUseHook {
  const path = join(tmpdir(), `personahub-claude-hook-${runId}.mjs`);
  writeFileSync(path, CLAUDE_PRETOOLUSE_HOOK_SCRIPT, "utf-8");
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "PowerShell|Bash",
          hooks: [{ type: "command", command: `node "${path}"` }],
        },
      ],
    },
  };
  return {
    settingsArg: JSON.stringify(settings),
    cleanup: () => {
      try { unlinkSync(path); } catch { void 0; }
    },
  };
}
