import type { Workspace } from "@personahub/shared/types";
import { CliProvider, AdapterAuthType } from "@personahub/shared/types";
import type { WorkspaceContext } from "./types.js";

export function buildWorkspaceContext(workspace: Workspace): WorkspaceContext {
  return {
    workspaceId: workspace.id,
    localPath: workspace.local_path,
    gitBranch: workspace.git_branch,
    pushCredentialsEnabled: workspace.push_credentials_enabled,
  };
}

interface CredentialIsolationInput {
  push_credentials_enabled: boolean;
  local_path: string;
}

/**
 * design §5.4: which provider-owned auth directory (if any) to expose,
 * independent of the workspace-scoped HOME redirection above it. Defaults to
 * Codex/OAuth for backward compatibility with callers that predate F005.
 */
export interface ProviderAuthDescriptor {
  cli_provider: CliProvider;
  auth_type: AdapterAuthType;
}

const DEFAULT_AUTH_DESCRIPTOR: ProviderAuthDescriptor = {
  cli_provider: CliProvider.Codex,
  auth_type: AdapterAuthType.OAuth,
};

const SEP = process.platform === "win32" ? "\\" : "/";

export function buildChildEnv(
  workspace: CredentialIsolationInput,
  authDescriptor: ProviderAuthDescriptor = DEFAULT_AUTH_DESCRIPTOR,
): Record<string, string> {
  if (workspace.push_credentials_enabled) {
    return { ...process.env } as Record<string, string>;
  }

  const originalHome = process.env.HOME || process.env.USERPROFILE || "";

  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "SSH_AUTH_SOCK") continue;
    if (key === "SSH_AGENT_PID") continue;
    if (key === "GIT_PASSWORD") continue;
    if (key === "GH_TOKEN") continue;
    if (key === "GITHUB_TOKEN") continue;
    if (key === "GITLAB_TOKEN") continue;
    if (key === "HOME" || key === "USERPROFILE") continue;
    // Provider auth directory variables are re-derived below, never carried
    // over verbatim from the operator's own environment (T031: a leftover
    // CLAUDE_CONFIG_DIR/XDG_* from the parent process must not leak into a
    // Run for a *different* provider).
    if (key === "CODEX_HOME" || key === "CLAUDE_CONFIG_DIR" || key === "XDG_DATA_HOME" || key === "XDG_CONFIG_HOME") continue;
    env[key] = value;
  }

  env["HOME"] = workspace.local_path;
  if (process.platform === "win32") {
    env["USERPROFILE"] = workspace.local_path;
    // real-environment finding (2026-07-23): on Windows, OpenCode CLI hangs
    // indefinitely (no output at all, not even a parse error) whenever
    // HOMEDRIVE/HOMEPATH are left pointing at the real profile while
    // USERPROFILE is redirected — i.e. an inconsistent "home" across the
    // three Windows home-identity variables. Bisected against a real,
    // authenticated OpenCode install (server/tests/helpers/opencode-
    // protocol-fixtures.md) by varying each variable independently: any
    // mismatch between HOMEDRIVE+HOMEPATH and USERPROFILE reproduces the
    // hang every time; keeping all three consistent never hangs (fails
    // fast instead, in ~3s, when the provider then can't find its auth).
    // Node's os.homedir()/other tools reconstruct home from HOMEDRIVE+
    // HOMEPATH as a fallback to USERPROFILE, so both must be redirected
    // together, not just USERPROFILE.
    env["HOMEDRIVE"] = workspace.local_path.slice(0, 2);
    env["HOMEPATH"] = workspace.local_path.slice(2);
  }

  // design §5.4: only the auth directory owned by THIS provider is exposed —
  // never a full HOME, never another provider's directory. API-key mode
  // (OpenCode only) needs no home auth directory at all; the key itself is
  // injected separately by runtime/auth-material.ts.
  if (originalHome && authDescriptor.auth_type === AdapterAuthType.OAuth) {
    switch (authDescriptor.cli_provider) {
      case CliProvider.Codex:
        env["CODEX_HOME"] = originalHome + SEP + ".codex";
        break;
      case CliProvider.ClaudeCode:
        env["CLAUDE_CONFIG_DIR"] = originalHome + SEP + ".claude";
        break;
      case CliProvider.OpenCode:
        // real-environment finding (2026-07-23): pointing XDG_DATA_HOME/
        // XDG_CONFIG_HOME at the real auth store — the original design
        // intent, mirroring CODEX_HOME/CLAUDE_CONFIG_DIR above — reliably
        // hangs OpenCode on Windows even with HOMEDRIVE/HOMEPATH/
        // USERPROFILE fully consistent (verified: dropping this override
        // is what turns the hang into a fast, clean "not authenticated"
        // failure). OpenCode's own env-var handling doesn't tolerate a
        // home directory that differs from where XDG says its data lives,
        // unlike Codex/Claude's directory-scoped overrides. There is
        // currently no known way to give OpenCode's OAuth mode access to
        // its real credentials under credential isolation on Windows —
        // api_key mode (which injects the key directly, no file lookup)
        // is unaffected and is the reliable choice for isolated workspaces.
        break;
    }
  }

  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_ASKPASS"] = "";
  env["SSH_ASKPASS"] = "";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  env["GIT_CONFIG_COUNT"] = "1";
  env["GIT_CONFIG_KEY_0"] = "credential.helper";
  env["GIT_CONFIG_VALUE_0"] = "";

  return env;
}
