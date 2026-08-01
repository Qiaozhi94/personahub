import { ValidationOutcome, type ValidationResultEnvelope } from "@personahub/shared/types";
import { DEFAULT_RESULT_PARSER_LIMITS, ResultParseError, type ResultParserLimits } from "./result-parser-contract.js";
import {
  assertString,
  assertStringArray,
  utf8Bytes,
  validateFinding,
  validateStringArrayWithLimits,
} from "./result-parser-fields.js";

export { DEFAULT_RESULT_PARSER_LIMITS, ResultParseError } from "./result-parser-contract.js";
export type { ResultParserLimits } from "./result-parser-contract.js";

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

const VALID_OUTCOMES = new Set<string>([ValidationOutcome.Passed, ValidationOutcome.Failed, ValidationOutcome.Blocked]);

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
    record.key_decisions ?? [],
    "key_decisions",
    limits.decisionsMax,
    limits.itemMaxBytes,
  );
  const lessonsCandidate = validateStringArrayWithLimits(
    record.lessons_candidate ?? [],
    "lessons_candidate",
    limits.lessonsMax,
    limits.itemMaxBytes,
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
      throw new ResultParseError(
        "blocked_invariant",
        "blocked result must explain reason in missing_evidence or findings",
      );
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
