import { ValidationFindingSeverity, type ValidationFinding } from "@personahub/shared/types";
import { normalizeWorkspacePath } from "../../runtime/trace/path-utils.js";
import { ResultParseError, type ResultParserLimits } from "./result-parser-contract.js";

const ALLOWED_FINDING_KEYS = new Set(["severity", "message", "suggestion", "evidence_refs", "file_path", "line"]);

const VALID_SEVERITIES = new Set<string>([
  ValidationFindingSeverity.Info,
  ValidationFindingSeverity.Warning,
  ValidationFindingSeverity.Error,
  ValidationFindingSeverity.Blocking,
]);

export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export function assertString(val: unknown, field: string): string {
  if (typeof val !== "string") {
    throw new ResultParseError("invalid_type", `${field} must be a string`);
  }
  return val;
}

export function assertStringArray(val: unknown, field: string): string[] {
  if (!Array.isArray(val)) {
    throw new ResultParseError("invalid_type", `${field} must be an array`);
  }
  for (const item of val) {
    if (typeof item !== "string") {
      throw new ResultParseError("invalid_type", `${field} must contain only strings`);
    }
  }
  return val;
}

export function validateFinding(
  obj: unknown,
  workspaceRoot: string | null,
  limits: ResultParserLimits,
): ValidationFinding {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new ResultParseError("invalid_finding", "Finding must be an object");
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FINDING_KEYS.has(key)) {
      throw new ResultParseError("unknown_field", `Unknown finding field: ${key}`);
    }
  }

  const severity = assertString(record.severity, "severity");
  if (!VALID_SEVERITIES.has(severity)) {
    throw new ResultParseError("invalid_severity", `Invalid severity: ${severity}`);
  }

  const message = assertString(record.message, "message");
  if (utf8Bytes(message) > limits.findingMessageMaxBytes) {
    throw new ResultParseError("limit_exceeded", `Finding message exceeds ${limits.findingMessageMaxBytes} bytes`);
  }

  let suggestion: string | null = null;
  if (record.suggestion !== null && record.suggestion !== undefined) {
    suggestion = assertString(record.suggestion, "suggestion");
    if (utf8Bytes(suggestion) > limits.findingSuggestionMaxBytes) {
      throw new ResultParseError(
        "limit_exceeded",
        `Finding suggestion exceeds ${limits.findingSuggestionMaxBytes} bytes`,
      );
    }
  } else if ("suggestion" in record && record.suggestion !== null) {
    throw new ResultParseError("invalid_type", "suggestion must be string or null");
  }

  const evidenceRefs = assertStringArray(record.evidence_refs ?? [], "evidence_refs");
  if (evidenceRefs.length > limits.findingRefsMax) {
    throw new ResultParseError("limit_exceeded", `Finding evidence_refs exceeds ${limits.findingRefsMax}`);
  }

  let filePath: string | null = null;
  if (record.file_path !== null && record.file_path !== undefined) {
    const rawPath = assertString(record.file_path, "file_path");
    if (workspaceRoot) {
      const normalized = normalizeWorkspacePath(workspaceRoot, rawPath);
      if (normalized === null) {
        throw new ResultParseError("invalid_file_path", `file_path escapes workspace: ${rawPath}`);
      }
      filePath = normalized;
    } else {
      if (rawPath.includes("..") || isAbsoluteLike(rawPath)) {
        throw new ResultParseError("invalid_file_path", `file_path must be workspace-relative: ${rawPath}`);
      }
      filePath = rawPath.split("\\").join("/");
    }
  } else if ("file_path" in record && record.file_path !== null) {
    throw new ResultParseError("invalid_type", "file_path must be string or null");
  }

  let line: number | null = null;
  if (record.line !== null && record.line !== undefined) {
    if (typeof record.line !== "number" || !Number.isInteger(record.line) || record.line < 0) {
      throw new ResultParseError("invalid_line", "line must be a non-negative integer or null");
    }
    line = record.line;
  } else if ("line" in record && record.line !== null) {
    throw new ResultParseError("invalid_type", "line must be number or null");
  }

  return {
    severity: severity as ValidationFindingSeverity,
    message,
    suggestion,
    evidence_refs: evidenceRefs,
    file_path: filePath,
    line,
  };
}

export function validateStringArrayWithLimits(
  val: unknown,
  field: string,
  maxItems: number,
  maxItemBytes: number,
): string[] {
  const arr = assertStringArray(val, field);
  if (arr.length > maxItems) {
    throw new ResultParseError("limit_exceeded", `${field} exceeds ${maxItems} items`);
  }
  for (const item of arr) {
    if (utf8Bytes(item) > maxItemBytes) {
      throw new ResultParseError("limit_exceeded", `${field} item exceeds ${maxItemBytes} bytes`);
    }
  }
  return arr;
}

function isAbsoluteLike(p: string): boolean {
  if (p.startsWith("/")) return true;
  if (p.length >= 3) {
    const c = p.charCodeAt(0);
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (isLetter && p[1] === ":" && (p[2] === "\\" || p[2] === "/")) return true;
  }
  return false;
}
