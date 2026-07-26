import type { Workspace } from "@personahub/shared/types";
import { CliProvider, AdapterAuthType } from "@personahub/shared/types";
import type { WorkspaceContext } from "./types.js";

/**
 * final-recheck-report fix: a denylist can never enumerate every possible
 * secret env var name (SENTRY_AUTH_TOKEN, DATABASE_URL, a company's custom
 * `*_TOKEN`, ...) — a shell-capable agent Run can read and exfiltrate
 * anything left in its env, so "copy everything except known-bad names"
 * can only ever lower risk, not bound it. This is the opposite: only these
 * non-secret, CLI-infra-required names survive into the isolated child env;
 * everything else (including any provider/cloud credential this list
 * doesn't yet know the name of) is excluded by construction.
 *
 * Confirmed sufficient by a real spawned-process probe (T008,
 * opencode-protocol-fixtures.md): a genuinely minimal explicit env of just
 * PATH/SystemRoot/TEMP/TMP/HOME/USERPROFILE already ran a real OpenCode
 * process through a real git-push network round-trip. This list is a
 * generous superset of that confirmed-working baseline (adds locale/
 * terminal/proxy/Node-runtime config so a CLI behind a corporate proxy, or
 * one that cares about locale/color output, doesn't silently misbehave) —
 * uppercased for a case-insensitive match, since Windows env var lookups
 * are case-insensitive even though Object.entries() preserves whatever
 * casing the parent process happened to set.
 */
const SAFE_PARENT_ENV_NAMES = new Set([
  // Executable discovery — required to find the CLI's own dependencies
  // (git, node, shell built-ins).
  "PATH", "PATHEXT",
  // Windows system essentials — Node's own child_process/fs/net internals
  // and most CLI tools fail to even start on Windows without these
  // (winsock init, temp file creation, shell fallback for spawn).
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
  // Temp directories.
  "TEMP", "TMP", "TMPDIR",
  // Locale — string/encoding handling, not secret.
  "LANG", "LC_ALL", "LC_CTYPE",
  // Terminal/output formatting only.
  "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR", "CI",
  // Corporate/network proxy config — a hostname/port, not a credential.
  // Omitting these can silently break the CLI's HTTPS calls to the
  // provider API on a proxied network, which would look like an unrelated
  // dispatch failure rather than an env-stripping side effect.
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  // Node.js runtime config — flags/paths, not secrets.
  "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS",
]);

/**
 * final-recheck-3-report fix: being on the name allowlist isn't enough for
 * the proxy variables specifically — a standard proxy URL can embed
 * credentials as userinfo (`http://user:password@host:8080`), which a
 * shell-capable agent Run could then read straight out of its own env. The
 * hostname/port portion is genuine non-secret CLI-infra config (worth
 * keeping so a proxied network doesn't silently break dispatch); only the
 * userinfo needs to fail closed.
 */
const PROXY_VAR_NAMES = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]);

function isSafeProxyValue(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch {
    // Not a parseable URL at all — NO_PROXY (a comma-separated hostname
    // list, not on PROXY_VAR_NAMES) never reaches this function; anything
    // else this malformed is safer to drop than to guess about.
    return false;
  }
}

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

  // Allowlist, not denylist: HOME/USERPROFILE/HOMEDRIVE/HOMEPATH/HOMESHARE
  // and the provider auth-directory variables (CODEX_HOME/CLAUDE_CONFIG_DIR/
  // ...) are deliberately absent from SAFE_PARENT_ENV_NAMES — they're
  // re-derived explicitly below, never carried over verbatim from the
  // operator's own environment (T031: a leftover CLAUDE_CONFIG_DIR/XDG_*
  // from the parent process must not leak into a Run for a *different*
  // provider). Everything else not on the allowlist — git/SSH credentials,
  // every model-provider/cloud API key, and any secret this list doesn't
  // even know the name of — is excluded by construction.
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    if (!SAFE_PARENT_ENV_NAMES.has(upperKey)) continue;
    if (PROXY_VAR_NAMES.has(upperKey) && !isSafeProxyValue(value)) continue;
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
    if (workspace.local_path.startsWith("\\\\")) {
      // UNC path (\\server\share\...): there's no drive letter, so
      // slice(0,2) would yield "\\\\" — not a real HOMEDRIVE value, and
      // liable to reintroduce the HOMEDRIVE/HOMEPATH-vs-USERPROFILE
      // mismatch that's already known to hang OpenCode on Windows (see
      // above). Windows' own convention for a network-share home is
      // HOMESHARE (the \\server\share root) + HOMEPATH, not HOMEDRIVE.
      const uncMatch = workspace.local_path.match(/^(\\\\[^\\]+\\[^\\]+)(\\.*)?$/);
      delete env["HOMEDRIVE"];
      if (uncMatch) {
        env["HOMESHARE"] = uncMatch[1];
        env["HOMEPATH"] = uncMatch[2] ?? "\\";
      } else {
        // Malformed/incomplete UNC path (e.g. bare "\\\\server", no share)
        // — fail closed rather than silently constructing a nonsense home
        // identity that "looks" set but points nowhere real.
        env["HOMESHARE"] = "";
        env["HOMEPATH"] = "";
      }
    } else {
      delete env["HOMESHARE"];
      env["HOMEDRIVE"] = workspace.local_path.slice(0, 2);
      env["HOMEPATH"] = workspace.local_path.slice(2);
    }
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
