/**
 * Shared, provider-agnostic shell-command pattern matching for the
 * git-push/force-push escalation guard and credential-failure detection.
 * Extracted out of codex-protocol.ts once a second adapter (Claude) needed
 * the identical patterns — a single source of truth for this
 * security-relevant matching, not duplicated per provider.
 */

const GIT_PUSH_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
];

export const CREDENTIAL_FAILURE_PATTERN =
  /permission denied|authentication failed|could not read|no credentials|403|401/i;

export function isGitPushCommand(command: unknown): boolean {
  if (typeof command === "string") {
    return GIT_PUSH_PATTERNS.some((p) => p.test(command));
  }
  if (Array.isArray(command)) {
    const joined = command.join(" ");
    return GIT_PUSH_PATTERNS.some((p) => p.test(joined));
  }
  return false;
}

export function isGitPushOutput(text: string): boolean {
  return GIT_PUSH_PATTERNS.some((p) => p.test(text));
}
