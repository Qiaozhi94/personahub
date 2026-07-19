import { describe, it, expect } from "vitest";
import {
  parseValidationResult,
  ResultParseError,
  DEFAULT_RESULT_PARSER_LIMITS,
} from "../../src/services/validation/result-parser.js";
import { ValidationOutcome, ValidationFindingSeverity } from "@personahub/shared/types";

function passedEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    outcome: "passed",
    summary: "All checks passed.",
    findings: [],
    evidence_refs: ["event:abc"],
    missing_evidence: [],
    key_decisions: ["Used pattern X"],
    lessons_candidate: ["Pattern X works well"],
    ...overrides,
  });
}

function failedEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    outcome: "failed",
    summary: "Tests failed.",
    findings: [{
      severity: "error",
      message: "Test assertion failed",
      suggestion: "Fix the assertion",
      evidence_refs: ["event:def"],
      file_path: "src/app.ts",
      line: 42,
    }],
    evidence_refs: ["event:def"],
    missing_evidence: [],
    key_decisions: [],
    lessons_candidate: [],
    ...overrides,
  });
}

function blockedEnvelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    outcome: "blocked",
    summary: "Missing test evidence.",
    findings: [],
    evidence_refs: [],
    missing_evidence: ["test evidence"],
    key_decisions: [],
    lessons_candidate: [],
    ...overrides,
  });
}

describe("F004 T020: Validation Result Parser", () => {
  describe("pure JSON parsing", () => {
    it("parses pure JSON passed result", () => {
      const result = parseValidationResult(passedEnvelope());
      expect(result.outcome).toBe(ValidationOutcome.Passed);
      expect(result.findings).toEqual([]);
      expect(result.summary).toBe("All checks passed.");
      expect(result.key_decisions).toEqual(["Used pattern X"]);
    });

    it("parses pure JSON failed result", () => {
      const result = parseValidationResult(failedEnvelope());
      expect(result.outcome).toBe(ValidationOutcome.Failed);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe(ValidationFindingSeverity.Error);
    });

    it("parses pure JSON blocked result", () => {
      const result = parseValidationResult(blockedEnvelope());
      expect(result.outcome).toBe(ValidationOutcome.Blocked);
      expect(result.missing_evidence).toEqual(["test evidence"]);
    });
  });

  describe("fenced JSON parsing", () => {
    it("parses single ```json fenced block", () => {
      const fenced = "```json\n" + passedEnvelope() + "\n```";
      const result = parseValidationResult(fenced);
      expect(result.outcome).toBe(ValidationOutcome.Passed);
    });

    it("parses fenced block with surrounding whitespace", () => {
      const fenced = "  \n```json\n" + failedEnvelope() + "\n```\n  ";
      const result = parseValidationResult(fenced);
      expect(result.outcome).toBe(ValidationOutcome.Failed);
    });

    it("rejects text outside fenced block", () => {
      const fenced = "text before\n```json\n" + passedEnvelope() + "\n```";
      expect(() => parseValidationResult(fenced)).toThrow(ResultParseError);
    });

    it("rejects content after closing fence", () => {
      const fenced = "```json\n" + passedEnvelope() + "\n```\ntext after";
      expect(() => parseValidationResult(fenced)).toThrow(ResultParseError);
    });

    it("rejects nested fence in content", () => {
      const fenced = "```json\n```json\n" + passedEnvelope() + "\n```\n```";
      expect(() => parseValidationResult(fenced)).toThrow(ResultParseError);
    });

    it("rejects unsupported fence language", () => {
      const fenced = "```python\n" + passedEnvelope() + "\n```";
      expect(() => parseValidationResult(fenced)).toThrow(ResultParseError);
    });

    it("rejects missing closing fence", () => {
      const fenced = "```json\n" + passedEnvelope();
      expect(() => parseValidationResult(fenced)).toThrow(ResultParseError);
    });
  });

  describe("unknown top-level fields", () => {
    it("rejects unknown top-level field", () => {
      const json = passedEnvelope({ extra_field: "bad" });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects multiple unknown top-level fields", () => {
      const json = passedEnvelope({ foo: 1, bar: 2 });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });
  });

  describe("passed invariants", () => {
    it("rejects passed with non-empty findings", () => {
      const json = passedEnvelope({
        findings: [{ severity: "error", message: "x", suggestion: null, evidence_refs: [], file_path: null, line: null }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects passed with non-empty missing_evidence", () => {
      const json = passedEnvelope({ missing_evidence: ["something"] });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });
  });

  describe("failed invariants", () => {
    it("rejects failed with no findings", () => {
      const json = failedEnvelope({ findings: [] });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });
  });

  describe("blocked invariants", () => {
    it("rejects blocked with no reason (empty findings and missing_evidence)", () => {
      const json = blockedEnvelope({ missing_evidence: [], findings: [] });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("accepts blocked with reason in findings", () => {
      const json = blockedEnvelope({
        missing_evidence: [],
        findings: [{ severity: "blocking", message: "Cannot proceed", suggestion: null, evidence_refs: [], file_path: null, line: null }],
      });
      const result = parseValidationResult(json);
      expect(result.outcome).toBe(ValidationOutcome.Blocked);
    });
  });

  describe("key_decisions and lessons_candidate", () => {
    it("rejects missing key_decisions", () => {
      const obj = JSON.parse(passedEnvelope());
      delete obj.key_decisions;
      expect(() => parseValidationResult(JSON.stringify(obj))).toThrow(ResultParseError);
    });

    it("rejects missing lessons_candidate", () => {
      const obj = JSON.parse(passedEnvelope());
      delete obj.lessons_candidate;
      expect(() => parseValidationResult(JSON.stringify(obj))).toThrow(ResultParseError);
    });

    it("accepts empty key_decisions and lessons_candidate", () => {
      const json = passedEnvelope({ key_decisions: [], lessons_candidate: [] });
      const result = parseValidationResult(json);
      expect(result.key_decisions).toEqual([]);
      expect(result.lessons_candidate).toEqual([]);
    });

    it("rejects non-array key_decisions", () => {
      const json = passedEnvelope({ key_decisions: "not array" });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });
  });

  describe("limits", () => {
    it("rejects summary exceeding 8 KiB", () => {
      const json = passedEnvelope({ summary: "x".repeat(DEFAULT_RESULT_PARSER_LIMITS.summaryMaxBytes + 1) });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects more than 100 findings", () => {
      const findings = Array.from({ length: 101 }, () => ({
        severity: "error", message: "x", suggestion: null, evidence_refs: [], file_path: null, line: null,
      }));
      const json = failedEnvelope({ findings });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects finding message exceeding 4 KiB", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x".repeat(DEFAULT_RESULT_PARSER_LIMITS.findingMessageMaxBytes + 1),
          suggestion: null, evidence_refs: [], file_path: null, line: null,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects finding suggestion exceeding 4 KiB", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x",
          suggestion: "y".repeat(DEFAULT_RESULT_PARSER_LIMITS.findingSuggestionMaxBytes + 1),
          evidence_refs: [], file_path: null, line: null,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects more than 200 evidence_refs", () => {
      const refs = Array.from({ length: 201 }, (_, i) => `event:evt${i}`);
      const json = passedEnvelope({ evidence_refs: refs });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects more than 50 key_decisions", () => {
      const decisions = Array.from({ length: 51 }, () => "decision");
      const json = passedEnvelope({ key_decisions: decisions });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects more than 50 lessons_candidate", () => {
      const lessons = Array.from({ length: 51 }, () => "lesson");
      const json = passedEnvelope({ lessons_candidate: lessons });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects key_decision item exceeding 4 KiB", () => {
      const json = passedEnvelope({ key_decisions: ["x".repeat(DEFAULT_RESULT_PARSER_LIMITS.itemMaxBytes + 1)] });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });
  });

  describe("Unicode", () => {
    it("preserves Unicode in summary", () => {
      const json = passedEnvelope({ summary: "✓ 中文 café - Unicode test" });
      const result = parseValidationResult(json);
      expect(result.summary).toBe("✓ 中文 café - Unicode test");
    });

    it("preserves Unicode in finding message", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "测试失败 ✗ café",
          suggestion: "修复测试", evidence_refs: [], file_path: null, line: null,
        }],
      });
      const result = parseValidationResult(json);
      expect(result.findings[0].message).toBe("测试失败 ✗ café");
    });
  });

  describe("illegal file refs", () => {
    it("rejects absolute Unix path", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [],
          file_path: "/etc/passwd", line: null,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects absolute Windows path", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [],
          file_path: "C:\\Windows\\system32", line: null,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects path traversal", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [],
          file_path: "../../../etc/passwd", line: null,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("normalizes Windows backslash paths to forward slash", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [],
          file_path: "src\\app.ts", line: 1,
        }],
      });
      const result = parseValidationResult(json);
      expect(result.findings[0].file_path).toBe("src/app.ts");
    });

    it("normalizes file_path with workspaceRoot", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [],
          file_path: "src/app.ts", line: 1,
        }],
      });
      const result = parseValidationResult(json, { workspaceRoot: "D:\\projects\\test" });
      expect(result.findings[0].file_path).toBe("src/app.ts");
    });
  });

  describe("invalid input", () => {
    it("rejects empty message", () => {
      expect(() => parseValidationResult("")).toThrow(ResultParseError);
    });

    it("rejects non-JSON text", () => {
      expect(() => parseValidationResult("this is not json")).toThrow(ResultParseError);
    });

    it("rejects array root", () => {
      expect(() => parseValidationResult("[1,2,3]")).toThrow(ResultParseError);
    });

    it("rejects invalid schema_version", () => {
      const json = passedEnvelope({ schema_version: 2 });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects invalid outcome", () => {
      const json = passedEnvelope({ outcome: "unknown" });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects invalid severity", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "critical", message: "x", suggestion: null, evidence_refs: [], file_path: null, line: null,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects unknown finding field", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [], file_path: null, line: null,
          extra: "bad",
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects non-integer line", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [], file_path: null, line: 1.5,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });

    it("rejects negative line", () => {
      const json = failedEnvelope({
        findings: [{
          severity: "error", message: "x", suggestion: null, evidence_refs: [], file_path: null, line: -1,
        }],
      });
      expect(() => parseValidationResult(json)).toThrow(ResultParseError);
    });
  });
});
