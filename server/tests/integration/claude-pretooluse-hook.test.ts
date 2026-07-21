import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  writeClaudePreToolUseHook,
  PUSH_CREDENTIALS_ENV_VAR,
  CLAUDE_PRETOOLUSE_HOOK_SCRIPT,
  type ClaudePreToolUseHook,
} from "../../src/runtime/adapters/claude-pretooluse-hook.js";
import { HOOK_DENY_REASON } from "../../src/runtime/adapters/claude-protocol.js";

// T039: exercises the REAL hook script as a real subprocess (this is what
// Claude Code itself spawns per matched tool call, per design §6.3/T003) —
// not a mock. Feeds it the exact stdin payload shape Claude Code sends
// (`{tool_name, tool_input: {command, description}}`) and asserts the exact
// stdout contract Claude Code parses (`hookSpecificOutput.permissionDecision`).

function runHook(hookPath: string, payload: unknown, env: Record<string, string | undefined> = {}): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [hookPath], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (d) => { stdout += d; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ stdout, exitCode: code }));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("Claude PreToolUse hook script (T039/T040)", () => {
  let hook: ClaudePreToolUseHook | null = null;

  afterEach(() => {
    hook?.cleanup();
    hook = null;
  });

  it("writeClaudePreToolUseHook() writes the exact static script content to a run-scoped temp file", () => {
    hook = writeClaudePreToolUseHook("run-test-1");
    const settings = JSON.parse(hook.settingsArg);
    const command: string = settings.hooks.PreToolUse[0].hooks[0].command;
    const pathMatch = command.match(/^node "(.+)"$/);
    expect(pathMatch).not.toBeNull();
    const scriptPath = pathMatch![1];
    expect(existsSync(scriptPath)).toBe(true);
    expect(readFileSync(scriptPath, "utf-8")).toBe(CLAUDE_PRETOOLUSE_HOOK_SCRIPT);
  });

  it("--settings JSON matcher covers both known shell tool names (PowerShell/Bash)", () => {
    hook = writeClaudePreToolUseHook("run-test-2");
    const settings = JSON.parse(hook.settingsArg);
    expect(settings.hooks.PreToolUse[0].matcher).toBe("PowerShell|Bash");
  });

  it("cleanup() removes the temp script file", () => {
    hook = writeClaudePreToolUseHook("run-test-3");
    const settings = JSON.parse(hook.settingsArg);
    const scriptPath = settings.hooks.PreToolUse[0].hooks[0].command.match(/^node "(.+)"$/)![1];
    hook.cleanup();
    expect(existsSync(scriptPath)).toBe(false);
    hook = null;
  });

  it("denies a git push tool_input when push credentials are disabled", async () => {
    hook = writeClaudePreToolUseHook("run-test-4");
    const scriptPath = JSON.parse(hook.settingsArg).hooks.PreToolUse[0].hooks[0].command.match(/^node "(.+)"$/)![1];

    const { stdout, exitCode } = await runHook(
      scriptPath,
      { tool_name: "PowerShell", tool_input: { command: "git push origin main", description: "push" } },
      { [PUSH_CREDENTIALS_ENV_VAR]: "0" },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(HOOK_DENY_REASON);
  });

  it("allows a git push tool_input when push credentials are enabled", async () => {
    hook = writeClaudePreToolUseHook("run-test-5");
    const scriptPath = JSON.parse(hook.settingsArg).hooks.PreToolUse[0].hooks[0].command.match(/^node "(.+)"$/)![1];

    const { stdout, exitCode } = await runHook(
      scriptPath,
      { tool_name: "PowerShell", tool_input: { command: "git push origin main" } },
      { [PUSH_CREDENTIALS_ENV_VAR]: "1" },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("allows a non-git-push command regardless of push credential state", async () => {
    hook = writeClaudePreToolUseHook("run-test-6");
    const scriptPath = JSON.parse(hook.settingsArg).hooks.PreToolUse[0].hooks[0].command.match(/^node "(.+)"$/)![1];

    const { stdout, exitCode } = await runHook(
      scriptPath,
      { tool_name: "PowerShell", tool_input: { command: "npm test" } },
      { [PUSH_CREDENTIALS_ENV_VAR]: "0" },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it("never uses a bypass/dangerous auto-approve decision value", () => {
    expect(CLAUDE_PRETOOLUSE_HOOK_SCRIPT).not.toMatch(/bypassPermissions/);
  });

  it("does not crash on malformed stdin JSON, defaults to allow", async () => {
    hook = writeClaudePreToolUseHook("run-test-7");
    const scriptPath = JSON.parse(hook.settingsArg).hooks.PreToolUse[0].hooks[0].command.match(/^node "(.+)"$/)![1];

    const child = spawn("node", [scriptPath], { stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (d) => { stdout += d; });
    const exitCode: number | null = await new Promise((resolve) => {
      child.on("exit", (code) => resolve(code));
      child.stdin.write("{ not valid json");
      child.stdin.end();
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });
});
