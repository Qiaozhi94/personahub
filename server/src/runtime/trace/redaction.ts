import { TRACE_LIMITS } from "./constants.js";

const FLAG_PATTERNS: RegExp[] = [
  /(--(?:token|api-key|apikey|password|passwd|secret|key|auth)["']?\s*[:=]\s*["']?)[^"'%\s]+/gi,
  /(--(?:token|api-key|apikey|password|passwd|secret|key|auth)\s+)[^\s-]+/gi,
];

const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9_\-\.]+/gi;

const CREDENTIAL_URL_PATTERN = /(https?:\/\/[^:\/\s]+:)[^@\/\s]+(@)/gi;

const TOKEN_PATTERNS: RegExp[] = [
  /(gh[pousr]_)[A-Za-z0-9]{36,}/g,
  /(sk-)[A-Za-z0-9]{20,}/g,
  /(xox[bpoa]-)[A-Za-z0-9\-]+/g,
  /(AKIA)[A-Z0-9]{16}/g,
];

const MAX_LENGTH = TRACE_LIMITS.commandMaxBytes;

export function redactTraceText(text: string): string {
  if (typeof text !== "string") {
    return "[REDACTION_FAILED]";
  }

  try {
    let result = text;

    for (const pattern of FLAG_PATTERNS) {
      result = result.replace(pattern, "$1[REDACTED]");
    }

    result = result.replace(BEARER_PATTERN, "$1[REDACTED]");
    result = result.replace(CREDENTIAL_URL_PATTERN, "$1[REDACTED]$2");

    for (const pattern of TOKEN_PATTERNS) {
      result = result.replace(pattern, "$1[REDACTED]");
    }

    return result;
  } catch {
    return "[REDACTION_FAILED]";
  }
}

export function redactAndTruncate(
  text: string,
  maxBytes: number = MAX_LENGTH,
): { text: string; truncated: boolean } {
  const redacted = redactTraceText(text);
  const byteLength = Buffer.byteLength(redacted, "utf8");
  if (byteLength <= maxBytes) {
    return { text: redacted, truncated: false };
  }
  const buf = Buffer.from(redacted, "utf8");
  const sliced = buf.subarray(0, maxBytes).toString("utf8");
  return { text: sliced, truncated: true };
}

export function redactCommand(command: string): { text: string; truncated: boolean } {
  return redactAndTruncate(command, TRACE_LIMITS.commandMaxBytes);
}

export function redactSummary(summary: string): { text: string; truncated: boolean } {
  return redactAndTruncate(summary, TRACE_LIMITS.summaryMaxBytes);
}

/**
 * design's "保存清洗后的原因": adapter/provider validate() error text is
 * external CLI output, not our own controlled string — it must go through
 * the same secret-pattern redaction as trace text before it's persisted to
 * `agent_configs.auth_status_message` and returned on the public DTO.
 *
 * `knownSecrets` are exact values the caller already holds (e.g. the
 * adapter's own `api_key`) — these are redacted by literal `replaceAll`
 * BEFORE the generic pattern regexes run. F005 supports OpenCode keys
 * across ~10 providers (Google `AIza...`, xAI `xai-...`, etc.) whose formats
 * the fixed TOKEN_PATTERNS list can't all enumerate; a regex is inherently
 * reactive to formats it was written to recognize, but an exact-value match
 * catches the one secret this call site actually knows is sensitive
 * regardless of what shape it takes.
 */
export function sanitizeAuthStatusMessage(message: string | null, knownSecrets: readonly (string | null | undefined)[] = []): string | null {
  if (!message) return null;
  const withKnownSecretsRedacted = knownSecrets
    .filter((s): s is string => Boolean(s))
    .reduce((text, secret) => text.split(secret).join("[REDACTED]"), message);
  return redactSummary(withKnownSecretsRedacted).text;
}
