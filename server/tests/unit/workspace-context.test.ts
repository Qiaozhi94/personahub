import { describe, it, expect } from "vitest";
import { buildChildEnv, buildWorkspaceContext } from "../../src/runtime/workspace-context.js";
import type { Workspace } from "@personahub/shared/types";
import { WorkspaceLockState } from "@personahub/shared/types";

function mockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "wsp_test",
    project_id: "prj_test",
    local_path: "/fake/path",
    git_branch: null,
    lock_state: WorkspaceLockState.Idle,
    locked_by_run_id: null,
    locked_at: null,
    push_credentials_enabled: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkspaceContext - Credential Isolation", () => {
  describe("buildChildEnv with push_credentials_enabled=false", () => {
    it("removes SSH_AUTH_SOCK", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.SSH_AUTH_SOCK).toBeUndefined();
    });

    it("removes SSH_AGENT_PID", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.SSH_AGENT_PID).toBeUndefined();
    });

    it("removes GIT_PASSWORD", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.GIT_PASSWORD).toBeUndefined();
    });

    it("removes GH_TOKEN and GITHUB_TOKEN", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
    });

    it("does not point HOME to real home directory", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.HOME).toBe("/fake/path");
    });

    it("sets GIT_TERMINAL_PROMPT to 0", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    });

    it("sets GIT_ASKPASS to empty", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.GIT_ASKPASS).toBe("");
    });
  });

  describe("buildChildEnv with push_credentials_enabled=true", () => {
    it("preserves SSH_AUTH_SOCK if present in process.env", () => {
      const original = process.env.SSH_AUTH_SOCK;
      process.env.SSH_AUTH_SOCK = "/tmp/ssh.sock";
      const env = buildChildEnv({ push_credentials_enabled: true, local_path: "/fake/path" });
      expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
      process.env.SSH_AUTH_SOCK = original;
    });

    it("preserves HOME pointing to real home", () => {
      const env = buildChildEnv({ push_credentials_enabled: true, local_path: "/fake/path" });
      expect(env.HOME).toBe(process.env.HOME);
    });
  });

  describe("buildWorkspaceContext", () => {
    it("returns correct context from workspace", () => {
      const ws = mockWorkspace({ push_credentials_enabled: false });
      const ctx = buildWorkspaceContext(ws);
      expect(ctx.workspaceId).toBe("wsp_test");
      expect(ctx.localPath).toBe("/fake/path");
      expect(ctx.pushCredentialsEnabled).toBe(false);
    });

    it("reflects push_credentials_enabled=true", () => {
      const ws = mockWorkspace({ push_credentials_enabled: true });
      const ctx = buildWorkspaceContext(ws);
      expect(ctx.pushCredentialsEnabled).toBe(true);
    });
  });
});
