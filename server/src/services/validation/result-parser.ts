import {
  ValidationOutcome,
  ValidationFindingSeverity,
  type ValidationResultEnvelope,
  type ValidationFinding,
} from "@personahub/shared/types";
import { normalizeWorkspacePath } from "../../runtime/trace/path-utils.js";

export interface ResultParserLimits {
  summaryMaxBytes: number;
  findingsMax: number;
  findingMessageMaxBytes: number;
  findingSuggestionMaxBytes: number;
  findingRefsMax: number;
  refsMax: number;
  missingEvidenceMax: number;
  decisionsMax: number;
  lessonsMax: number;
  itemMaxBytes: number;
}

export const DEFAULT_RESULT_PARSER_LIMITS: ResultParserLimits = {
  summaryMaxBytes: 8 * 1024,
  findingsMax: 100,
  findingMessageMaxBytes: 4 * 1024,
  findingSuggestionMaxBytes: 4 * 1024,
  findingRefsMax: 50,
  refsMax: 200,
  missingEvidenceMax: 200,
  decisionsMax: 50,
  lessonsMax: 50,
  itemMaxBytes: 4 * 1024,
};

export class ResultParseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResultParseError";
  }
}

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "outcome",
  "summary",
  "findings",
  "evidence_refs",
  "missing_evidence",
  "key_decisions",
  "lessons_candidate",
]);

const ALLOWED_FINDING_KEYS = new Set([
  "severity",
  "message",
  "suggestion",
  "evidence_refs",
  "file_path",
  "line",
]);

const VALID_OUTCOMES = new Set<string>([
  ValidationOutcome.Passed,
  ValidationOutcome.Failed,
  ValidationOutcome.Blocked,
]);

const VALID_SEVERITIES = new Set<string>([
  ValidationFindingSeverity.Info,
  ValidationFindingSeverity.Warning,
  ValidationFindingSeverity.Error,
  ValidationFindingSeverity.Blocking,
]);

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function extractJson(finalMessage: string): string {
  const trimmed = finalMessage.trim();

  if (!trimmed.startsWith("```")) {
    if (trimmed.includes("```")) {
      throw new ResultParseError("invalid_fence", "Fenced block must be at top level");
    }
    return trimmed;
  }

  const openFenceEnd = trimmed.indexOf("\n");
  if (openFenceEnd < 0) {
    throw new ResultParseError("invalid_fence", "Fence header missing newline");
  }

  const fenceHeader = trimmed.substring(3, openFenceEnd).trim();
  if (fenceHeader !== "json") {
    throw new ResultParseError("invalid_fence", `Unsupported fence language: ${fenceHeader}`);
  }

  const afterHeader = trimmed.substring(openFenceEnd + 1);
  const closeFenceIdx = afterHeader.indexOf("```");
  if (closeFenceIdx < 0) {
    throw new ResultParseError("invalid_fence", "Missing closing fence");
  }

  if (closeFenceIdx > 0 && afterHeader[closeFenceIdx - 1] !== "\n") {
    throw new ResultParseError("invalid_fence", "Closing fence not at line start");
  }

  const content = afterHeader.substring(0, closeFenceIdx);

  if (content.includes("```")) {
    throw new ResultParseError("invalid_fence", "Nested fence in content");
  }

  const afterClose = afterHeader.substring(closeFenceIdx + 3);
  if (afterClose.trim() !== "") {
    throw new ResultParseError("invalid_fence", "Content after closing fence");
  }

  return content.trim();
}

function assertString(val: unknown, field: string): string {
  if (typeof val !== "string") {
    throw new ResultParseError("invalid_type", `${field} must be a string`);
  }
  return val;
}

function assertStringArray(val: unknown, field: string): string[] {
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

function validateFinding(
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
      throw new ResultParseError("limit_exceeded", `Finding suggestion exceeds ${limits.findingSuggestionMaxBytes} bytes`);
    }
  } else if ("suggestion" in record) {
    if (record.suggestion !== null) {
      throw new ResultParseError("invalid_type", "suggestion must be string or null");
    }
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
  } else if ("file_path" in record) {
    if (record.file_path !== null) {
      throw new ResultParseError("invalid_type", "file_path must be string or null");
    }
  }

  let line: number | null = null;
  if (record.line !== null && record.line !== undefined) {
    if (typeof record.line !== "number" || !Number.isInteger(record.line) || record.line < 0) {
      throw new ResultParseError("invalid_line", "line must be a non-negative integer or null");
    }
    line = record.line;
  } else if ("line" in record) {
    if (record.line !== null) {
      throw new ResultParseError("invalid_type", "line must be number or null");
    }
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

function isAbsoluteLike(p: string): boolean {
  if (p.startsWith("/")) return true;
  if (p.length >= 3) {
    const c = p.charCodeAt(0);
    const isLetter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (isLetter && p[1] === ":" && (p[2] === "\\" || p[2] === "/")) return true;
  }
  return false;
}

function validateStringArrayWithLimits(
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

export function parseValidationResult(
  finalMessage: string,
  options?: {
    workspaceRoot?: string | null;
    limits?: Partial<ResultParserLimits>;
  },
): ValidationResultEnvelope {
  if (typeof finalMessage !== "string" || finalMessage.length === 0) {
    throw new ResultParseError("empty_message", "Final message is empty");
  }

  const limits = { ...DEFAULT_RESULT_PARSER_LIMITS, ...(options?.limits ?? {}) };
  const workspaceRoot = options?.workspaceRoot ?? null;

  const jsonStr = extractJson(finalMessage);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new ResultParseError("json_parse_error", "Failed to parse JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ResultParseError("invalid_shape", "Root must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new ResultParseError("unknown_field", `Unknown top-level field: ${key}`);
    }
  }

  if (record.schema_version !== 1) {
    throw new ResultParseError("invalid_schema_version", "schema_version must be 1");
  }

  const outcome = assertString(record.outcome, "outcome");
  if (!VALID_OUTCOMES.has(outcome)) {
    throw new ResultParseError("invalid_outcome", `Invalid outcome: ${outcome}`);
  }

  const summary = assertString(record.summary, "summary");
  if (utf8Bytes(summary) > limits.summaryMaxBytes) {
    throw new ResultParseError("limit_exceeded", `summary exceeds ${limits.summaryMaxBytes} bytes`);
  }

  if (!Array.isArray(record.findings)) {
    throw new ResultParseError("invalid_type", "findings must be an array");
  }
  if (record.findings.length > limits.findingsMax) {
    throw new ResultParseError("limit_exceeded", `findings exceeds ${limits.findingsMax} items`);
  }
  const findings = (record.findings as unknown[]).map((f) => validateFinding(f, workspaceRoot, limits));

  const evidenceRefs = assertStringArray(record.evidence_refs ?? [], "evidence_refs");
  if (evidenceRefs.length > limits.refsMax) {
    throw new ResultParseError("limit_exceeded", `evidence_refs exceeds ${limits.refsMax} items`);
  }

  const missingEvidence = assertStringArray(record.missing_evidence ?? [], "missing_evidence");
  if (missingEvidence.length > limits.missingEvidenceMax) {
    throw new ResultParseError("limit_exceeded", `missing_evidence exceeds ${limits.missingEvidenceMax} items`);
  }

  const keyDecisions = validateStringArrayWithLimits(
    record.key_decisions ?? [], "key_decisions", limits.decisionsMax, limits.itemMaxBytes,
  );
  const lessonsCandidate = validateStringArrayWithLimits(
    record.lessons_candidate ?? [], "lessons_candidate", limits.lessonsMax, limits.itemMaxBytes,
  );

  if (!Array.isArray(record.key_decisions)) {
    throw new ResultParseError("invalid_type", "key_decisions must be an array");
  }
  if (!Array.isArray(record.lessons_candidate)) {
    throw new ResultParseError("invalid_type", "lessons_candidate must be an array");
  }

  if (outcome === ValidationOutcome.Passed) {
    if (findings.length > 0) {
      throw new ResultParseError("passed_invariant", "passed result must have empty findings");
    }
    if (missingEvidence.length > 0) {
      throw new ResultParseError("passed_invariant", "passed result must have empty missing_evidence");
    }
  }

  if (outcome === ValidationOutcome.Failed) {
    if (findings.length === 0) {
      throw new ResultParseError("failed_invariant", "failed result must have at least one finding");
    }
  }

  if (outcome === ValidationOutcome.Blocked) {
    if (missingEvidence.length === 0 && findings.length === 0) {
      throw new ResultParseError("blocked_invariant", "blocked result must explain reason in missing_evidence or findings");
    }
  }

  return {
    schema_version: 1,
    outcome: outcome as ValidationOutcome,
    summary,
    findings,
    evidence_refs: evidenceRefs,
    missing_evidence: missingEvidence,
    key_decisions: keyDecisions,
    lessons_candidate: lessonsCandidate,
  };
}
