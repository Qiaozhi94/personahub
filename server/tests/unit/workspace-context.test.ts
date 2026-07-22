import { describe, it, expect } from "vitest";
import { buildChildEnv, buildWorkspaceContext } from "../../src/runtime/workspace-context.js";
import type { Workspace } from "@personahub/shared/types";
import { WorkspaceLockState, CliProvider, AdapterAuthType } from "@personahub/shared/types";

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

    describe.skipIf(process.platform !== "win32")("Windows HOMEDRIVE/HOMEPATH consistency (real-environment finding, 2026-07-23)", () => {
      it("redirects HOMEDRIVE/HOMEPATH to match the isolated USERPROFILE, not left pointing at the real profile", () => {
        const env = buildChildEnv({ push_credentials_enabled: false, local_path: "C:\\Users\\Test\\workspace" });
        expect(env.USERPROFILE).toBe("C:\\Users\\Test\\workspace");
        expect(env.HOMEDRIVE).toBe("C:");
        expect(env.HOMEPATH).toBe("\\Users\\Test\\workspace");
      });
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

  describe("provider-specific auth directory injection (T031/T032, design §5.4)", () => {
    it("defaults to Codex's CODEX_HOME when no auth descriptor is given (backward compatible)", () => {
      const env = buildChildEnv({ push_credentials_enabled: false, local_path: "/fake/path" });
      expect(env.CODEX_HOME).toBeTruthy();
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(env.XDG_DATA_HOME).toBeUndefined();
      expect(env.XDG_CONFIG_HOME).toBeUndefined();
    });

    it("exposes only CODEX_HOME for codex/oauth, not Claude/OpenCode variables", () => {
      const env = buildChildEnv(
        { push_credentials_enabled: false, local_path: "/fake/path" },
        { cli_provider: CliProvider.Codex, auth_type: AdapterAuthType.OAuth },
      );
      expect(env.CODEX_HOME).toBeTruthy();
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
      expect(env.XDG_DATA_HOME).toBeUndefined();
      expect(env.XDG_CONFIG_HOME).toBeUndefined();
    });

    it("exposes only CLAUDE_CONFIG_DIR for claude-code/oauth, not Codex/OpenCode variables", () => {
      const env = buildChildEnv(
        { push_credentials_enabled: false, local_path: "/fake/path" },
        { cli_provider: CliProvider.ClaudeCode, auth_type: AdapterAuthType.OAuth },
      );
      expect(env.CLAUDE_CONFIG_DIR).toBeTruthy();
      expect(env.CODEX_HOME).toBeUndefined();
      expect(env.XDG_DATA_HOME).toBeUndefined();
      expect(env.XDG_CONFIG_HOME).toBeUndefined();
    });

    it("CLAUDE_CONFIG_DIR points at the real .claude folder, not the workspace path", () => {
      const env = buildChildEnv(
        { push_credentials_enabled: false, local_path: "/fake/path" },
        { cli_provider: CliProvider.ClaudeCode, auth_type: AdapterAuthType.OAuth },
      );
      expect(env.CLAUDE_CONFIG_DIR).not.toContain("/fake/path");
      expect(env.CLAUDE_CONFIG_DIR).toMatch(/\.claude$/);
    });

    it("exposes no XDG_DATA_HOME/XDG_CONFIG_HOME for opencode/oauth under credential isolation (real-environment finding, 2026-07-23)", () => {
      // Unlike CODEX_HOME/CLAUDE_CONFIG_DIR, pointing XDG_DATA_HOME/
      // XDG_CONFIG_HOME at the real auth store reliably hung real OpenCode
      // on Windows even with HOMEDRIVE/HOMEPATH/USERPROFILE fully
      // consistent — there is currently no known safe way to give
      // OpenCode's OAuth mode access to its real credentials under
      // isolation, so this override was removed rather than left half-working.
      const env = buildChildEnv(
        { push_credentials_enabled: false, local_path: "/fake/path" },
        { cli_provider: CliProvider.OpenCode, auth_type: AdapterAuthType.OAuth },
      );
      expect(env.XDG_DATA_HOME).toBeUndefined();
      expect(env.XDG_CONFIG_HOME).toBeUndefined();
      expect(env.CODEX_HOME).toBeUndefined();
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    it("OpenCode API-key mode exposes no home auth directory at all — the key itself is injected separately by AuthMaterial", () => {
      const env = buildChildEnv(
        { push_credentials_enabled: false, local_path: "/fake/path" },
        { cli_provider: CliProvider.OpenCode, auth_type: AdapterAuthType.ApiKey },
      );
      expect(env.XDG_DATA_HOME).toBeUndefined();
      expect(env.XDG_CONFIG_HOME).toBeUndefined();
      expect(env.CODEX_HOME).toBeUndefined();
      expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    });

    it("SSH agent, git credential helper, and GH tokens stay stripped regardless of provider", () => {
      for (const provider of [CliProvider.Codex, CliProvider.ClaudeCode, CliProvider.OpenCode]) {
        const env = buildChildEnv(
          { push_credentials_enabled: false, local_path: "/fake/path" },
          { cli_provider: provider, auth_type: AdapterAuthType.OAuth },
        );
        expect(env.SSH_AUTH_SOCK).toBeUndefined();
        expect(env.GH_TOKEN).toBeUndefined();
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.HOME).toBe("/fake/path");
      }
    });

    it("push_credentials_enabled=true bypasses provider-specific isolation entirely (unchanged F002 semantics)", () => {
      const env = buildChildEnv(
        { push_credentials_enabled: true, local_path: "/fake/path" },
        { cli_provider: CliProvider.OpenCode, auth_type: AdapterAuthType.OAuth },
      );
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
