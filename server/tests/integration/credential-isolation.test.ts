import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { buildChildEnv } from "../../src/runtime/workspace-context.js";

describe("Windows Credential Isolation Verification (T062)", () => {
  it("subprocess does not inherit SSH_AUTH_SOCK when push_credentials_enabled=false", () => {
    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    const result = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
      env: { ...env, PATH: process.env.PATH ?? "" },
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const childEnv = JSON.parse(result.stdout.trim()) as Record<string, string>;
    expect(childEnv.SSH_AUTH_SOCK).toBeUndefined();
    expect(childEnv.SSH_AGENT_PID).toBeUndefined();
    expect(childEnv.GIT_ASKPASS).toBe("");
    expect(childEnv.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("subprocess HOME is not the user's real home when push_credentials_enabled=false", () => {
    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    const result = spawnSync(process.execPath, ["-e", "console.log(process.env.HOME)"], {
      env: { ...env, PATH: process.env.PATH ?? "" },
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const childHome = result.stdout.trim();
    expect(childHome).toBe("/fake/workspace");
    expect(childHome).not.toBe(process.env.HOME);
  });

  it("subprocess inherits real environment when push_credentials_enabled=true", () => {
    const env = buildChildEnv({ push_credentials_enabled: true, local_path: "/fake/workspace" });

    const result = spawnSync(process.execPath, ["-e", "console.log(process.env.HOME)"], {
      env,
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    const childHome = result.stdout.trim();
    expect(childHome).toBe(process.env.HOME);
  });

  it("subprocess does not have GH_TOKEN when process.env has it and push_credentials_enabled=false", () => {
    const originalToken = process.env.GH_TOKEN;
    process.env.GH_TOKEN = "secret-token";

    const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/workspace" });

    process.env.GH_TOKEN = originalToken;

    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.GITLAB_TOKEN).toBeUndefined();
  });
});
