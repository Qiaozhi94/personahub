import type { Workspace } from "@personahub/shared/types";
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

export function buildChildEnv(workspace: CredentialIsolationInput): Record<string, string> {
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
    env[key] = value;
  }

  env["HOME"] = workspace.local_path;
  if (process.platform === "win32") {
    env["USERPROFILE"] = workspace.local_path;
  }

  if (!env["CODEX_HOME"] && originalHome) {
    env["CODEX_HOME"] = originalHome + (process.platform === "win32" ? "\\.codex" : "/.codex");
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
