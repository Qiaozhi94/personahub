import { describe, it, expect } from "vitest";
import {
  isSameOriginValidation,
  sameOriginLabel,
  describeIdentityDifference,
} from "../../src/services/validation/same-origin.js";
import {
  buildEvidenceSummary,
  aggregateEvidenceRefs,
  SUMMARY_MAX_BYTES,
  SUMMARY_REFS_MAX,
  type EvidenceSummaryBuildInput,
} from "../../src/services/validation/evidence-summary-builder.js";
import type { HandoffPayload } from "../../src/services/handoff-builder.js";
import {
  ValidationOutcome,
  VerificationKind,
  type ValidationPolicySnapshot,
  type AdapterIdentitySnapshot,
  type ValidationResultEnvelope,
  type TraceCompleteness,
} from "@personahub/shared/types";

function defaultIdentity(overrides: Partial<AdapterIdentitySnapshot> = {}): AdapterIdentitySnapshot {
  return {
    adapter_config_id: "agc_1",
    name: "Codex",
    cli_provider: "codex",
    default_model: "gpt-5",
    ...overrides,
  };
}

function defaultPolicySnapshot(): ValidationPolicySnapshot {
  return {
    policy_id: "vpl_coding_default",
    version: 1,
    max_validation_rounds: 3,
    evidence_requirements: {
      require_handoff: true,
      require_file_trace: true,
      require_verification: true,
      accepted_verification_kinds: [VerificationKind.Test, VerificationKind.Lint, VerificationKind.Typecheck, VerificationKind.Build],
    },
  };
}

function defaultResult(overrides: Partial<ValidationResultEnvelope> = {}): ValidationResultEnvelope {
  return {
    schema_version: 1,
    outcome: ValidationOutcome.Passed,
    summary: "All checks passed.",
    findings: [],
    evidence_refs: ["event:evt_pass"],
    missing_evidence: [],
    key_decisions: ["Used pattern X"],
    lessons_candidate: ["Pattern X works"],
    ...overrides,
  };
}

function defaultHandoff(overrides: Partial<HandoffPayload> = {}): HandoffPayload {
  return {
    issue_id: "iss_1",
    thread_id: "thr_1",
    run_id: "run_impl_1",
    workspace_id: "wsp_1",
    issue_goal: "Implement feature X",
    run_status: "completed",
    summary: "Implemented feature X with tests.",
    completed_work: ["Added src/feature.ts"],
    command_summary: { total: 5, succeeded: 5, failed: 0, blocked: 0, unknown: 0 },
    verification_summary: { passed: 3, failed: 0, unknown: 0 },
    file_summary: { total: 2, scan_status: "complete", ref: "file-change-set:run_impl_1" },
    known_risks: [],
    missing_evidence: [],
    next_expected_action: "Validate.",
    evidence_ref_count: 5,
    evidence_refs_truncated: false,
    ...overrides,
  };
}

function defaultCompleteness(): TraceCompleteness {
  return { commands: "complete", verification: "complete", file_changes: "complete", refs: "complete", reasons: [] };
}

function defaultSummaryInput(overrides: Partial<EvidenceSummaryBuildInput> = {}): EvidenceSummaryBuildInput {
  return {
    issue: { id: "iss_1", title: "Implement Feature X", goal: "Add feature X", thread_id: "thr_1" },
    implementationRun: { id: "run_impl_1", identity: defaultIdentity({ adapter_config_id: "agc_impl" }) },
    validatorRun: { id: "run_val_1", identity: defaultIdentity({ adapter_config_id: "agc_val", name: "Codex Reviewer" }) },
    policySnapshot: defaultPolicySnapshot(),
    policySnapshotHash: "sha256:abc123",
    result: defaultResult(),
    handoff: defaultHandoff(),
    verifications: [{ id: "evt_test_1", kind: "test", result: "passed", command: "npm test" }],
    fileChanges: [{ path: "src/feature.ts", change_type: "added" }],
    commands: [{ id: "evt_cmd_1", command: "npm test", outcome: "succeeded", output_summary: "All tests passed" }],
    passEventId: "evt_pass_1",
    traceCompleteness: defaultCompleteness(),
    ...overrides,
  };
}

describe("F004 T026: Same-Origin and Evidence Summary Builder", () => {
  describe("isSameOriginValidation", () => {
    it("returns true when provider and model match", () => {
      expect(isSameOriginValidation(
        defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }),
        defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }),
      )).toBe(true);
    });

    it("returns false when provider differs", () => {
      expect(isSameOriginValidation(
        defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }),
        defaultIdentity({ cli_provider: "claude", default_model: "gpt-5" }),
      )).toBe(false);
    });

    it("returns false when model differs", () => {
      expect(isSameOriginValidation(
        defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }),
        defaultIdentity({ cli_provider: "codex", default_model: "gpt-4" }),
      )).toBe(false);
    });

    it("returns true when both have null model", () => {
      expect(isSameOriginValidation(
        defaultIdentity({ cli_provider: "codex", default_model: null }),
        defaultIdentity({ cli_provider: "codex", default_model: null }),
      )).toBe(true);
    });

    it("returns false when one has null model", () => {
      expect(isSameOriginValidation(
        defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }),
        defaultIdentity({ cli_provider: "codex", default_model: null }),
      )).toBe(false);
    });

    it("ignores adapter_config_id and name", () => {
      expect(isSameOriginValidation(
        defaultIdentity({ adapter_config_id: "agc_1", name: "Impl", cli_provider: "codex", default_model: "gpt-5" }),
        defaultIdentity({ adapter_config_id: "agc_2", name: "Val", cli_provider: "codex", default_model: "gpt-5" }),
      )).toBe(true);
    });
  });

  describe("sameOriginLabel", () => {
    it("returns same-origin label", () => {
      expect(sameOriginLabel(true)).toBe("Same-origin validation");
    });

    it("returns independent label", () => {
      expect(sameOriginLabel(false)).toBe("Independent validation");
    });
  });

  describe("describeIdentityDifference", () => {
    it("describes provider difference", () => {
      const desc = describeIdentityDifference(
        defaultIdentity({ cli_provider: "codex" }),
        defaultIdentity({ cli_provider: "claude" }),
      );
      expect(desc).toContain("cli_provider");
    });

    it("describes model difference", () => {
      const desc = describeIdentityDifference(
        defaultIdentity({ default_model: "gpt-5" }),
        defaultIdentity({ default_model: "gpt-4" }),
      );
      expect(desc).toContain("default_model");
    });

    it("returns empty when same", () => {
      const desc = describeIdentityDifference(defaultIdentity(), defaultIdentity());
      expect(desc).toBe("");
    });
  });

  describe("buildEvidenceSummary - Run identity snapshots", () => {
    it("captures both Run identity snapshots at creation time", () => {
      const result = buildEvidenceSummary(defaultSummaryInput());
      expect(result.markdown).toContain("run_impl_1");
      expect(result.markdown).toContain("run_val_1");
      expect(result.markdown).toContain("agc_impl");
      expect(result.markdown).toContain("agc_val");
    });

    it("config change after Run does not affect same-origin (uses snapshots only)", () => {
      const input = defaultSummaryInput({
        implementationRun: { id: "run_impl_1", identity: defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }) },
        validatorRun: { id: "run_val_1", identity: defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }) },
      });
      const result = buildEvidenceSummary(input);
      expect(result.sameOriginValidation).toBe(true);

      const input2 = defaultSummaryInput({
        implementationRun: { id: "run_impl_1", identity: defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }) },
        validatorRun: { id: "run_val_1", identity: defaultIdentity({ cli_provider: "claude", default_model: "opus" }) },
      });
      const result2 = buildEvidenceSummary(input2);
      expect(result2.sameOriginValidation).toBe(false);
    });
  });

  describe("buildEvidenceSummary - policy snapshot/hash", () => {
    it("includes policy snapshot and hash", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({ policySnapshotHash: "sha256:fixed_hash" }));
      expect(result.markdown).toContain("sha256:fixed_hash");
      expect(result.markdown).toContain("vpl_coding_default");
      expect(result.markdown).toContain("**Max Validation Rounds:** 3");
    });
  });

  describe("buildEvidenceSummary - stable Markdown", () => {
    it("produces same output for same input", () => {
      const input = defaultSummaryInput();
      const r1 = buildEvidenceSummary(input);
      const r2 = buildEvidenceSummary(input);
      expect(r1.markdown).toBe(r2.markdown);
    });

    it("includes all required sections in order", () => {
      const result = buildEvidenceSummary(defaultSummaryInput());
      const sections = [
        "## Goal", "## Final Result", "## Implementation Summary", "## Key Decisions",
        "## Validation", "## Run Identities", "## Validation Policy", "## Key Commands",
        "## Verification Evidence", "## Changed Files", "## Implementation Handoff",
        "## Findings", "## Lessons Candidate", "## Trace Completeness",
      ];
      let lastIdx = -1;
      for (const sec of sections) {
        const idx = result.markdown.indexOf(sec);
        expect(idx).toBeGreaterThan(-1);
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    });
  });

  describe("buildEvidenceSummary - escaping", () => {
    it("escapes backticks in content", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        issue: { id: "iss_1", title: "Test `code` issue", goal: "Goal with `backticks`", thread_id: "thr_1" },
      }));
      expect(result.markdown).toContain("\\`code\\`");
      expect(result.markdown).toContain("\\`backticks\\`");
    });

    it("escapes backticks in key decisions", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        result: defaultResult({ key_decisions: ["Used `pattern` X"] }),
      }));
      expect(result.markdown).toContain("\\`pattern\\`");
    });
  });

  describe("buildEvidenceSummary - evidence refs", () => {
    it("aggregates refs from pass event, handoff, verifications, commands", () => {
      const refs = aggregateEvidenceRefs(defaultSummaryInput());
      expect(refs).toContain("event:evt_pass_1");
      expect(refs).toContain("file-change-set:run_impl_1");
      expect(refs).toContain("event:evt_test_1");
      expect(refs).toContain("event:evt_cmd_1");
    });

    it("dedupes refs preserving order", () => {
      const input = defaultSummaryInput({
        verifications: [{ id: "evt_test_1", kind: "test", result: "passed", command: null }],
        commands: [{ id: "evt_test_1", command: "npm test", outcome: "succeeded", output_summary: null }],
      });
      const refs = aggregateEvidenceRefs(input);
      const uniqueRefs = [...new Set(refs)];
      expect(refs).toEqual(uniqueRefs);
    });

    it("limits refs to 500", () => {
      const verifications = Array.from({ length: 600 }, (_, i) => ({
        id: `evt_v_${i}`, kind: "test", result: "passed", command: null,
      }));
      const refs = aggregateEvidenceRefs(defaultSummaryInput({ verifications }));
      expect(refs.length).toBeLessThanOrEqual(SUMMARY_REFS_MAX);
    });
  });

  describe("buildEvidenceSummary - 256 KiB truncation", () => {
    it("does not truncate small summaries", () => {
      const result = buildEvidenceSummary(defaultSummaryInput());
      expect(result.truncated).toBe(false);
    });

    it("truncates file list when over 256 KiB", () => {
      const manyFiles = Array.from({ length: 10000 }, (_, i) => ({
        path: `src/module_${i}/file_${i}.ts`, change_type: "modified",
      }));
      const result = buildEvidenceSummary(defaultSummaryInput({ fileChanges: manyFiles }));
      expect(Buffer.byteLength(result.markdown, "utf8")).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    });

    it("preserves essential sections even when truncated", () => {
      const manyFiles = Array.from({ length: 10000 }, (_, i) => ({
        path: `src/module_${i}/file_${i}.ts`, change_type: "modified",
      }));
      const result = buildEvidenceSummary(defaultSummaryInput({
        fileChanges: manyFiles,
        issue: { id: "iss_1", title: "Important", goal: "Critical goal", thread_id: "thr_1" },
      }));
      expect(result.markdown).toContain("Critical goal");
      expect(result.markdown).toContain("## Final Result");
      expect(result.markdown).toContain("## Run Identities");
      expect(result.markdown).toContain("## Validation Policy");
      expect(result.markdown).toContain("sha256:abc123");
    });
  });

  describe("buildEvidenceSummary - trace completeness", () => {
    it("includes trace completeness status", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        traceCompleteness: { commands: "partial", verification: "complete", file_changes: "complete", refs: "complete", reasons: ["commands:partial:run_impl_1"] },
      }));
      expect(result.markdown).toContain("**Commands:** partial");
      expect(result.markdown).toContain("commands:partial:run_impl_1");
    });

    it("includes all completeness dimensions", () => {
      const result = buildEvidenceSummary(defaultSummaryInput());
      expect(result.markdown).toContain("**Commands:**");
      expect(result.markdown).toContain("**Verification:**");
      expect(result.markdown).toContain("**File Changes:**");
      expect(result.markdown).toContain("**Refs:**");
    });
  });

  describe("buildEvidenceSummary - failed result with findings", () => {
    it("includes findings in summary", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        result: defaultResult({
          outcome: ValidationOutcome.Failed,
          summary: "Tests failed.",
          findings: [{
            severity: "error", message: "Test failed", suggestion: "Fix it",
            evidence_refs: [], file_path: "src/app.ts", line: 10,
          }],
          key_decisions: [],
          lessons_candidate: ["Need better tests"],
        }),
      }));
      expect(result.markdown).toContain("Test failed");
      expect(result.markdown).toContain("Fix it");
      expect(result.markdown).toContain("src/app.ts:10");
      expect(result.markdown).toContain("Need better tests");
    });
  });

  describe("buildEvidenceSummary - same-origin in output", () => {
    it("marks same-origin as true when provider and model match", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        implementationRun: { id: "run_impl", identity: defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }) },
        validatorRun: { id: "run_val", identity: defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }) },
      }));
      expect(result.sameOriginValidation).toBe(true);
      expect(result.markdown).toContain("**Same-Origin:** true");
    });

    it("marks same-origin as false when different", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        implementationRun: { id: "run_impl", identity: defaultIdentity({ cli_provider: "codex", default_model: "gpt-5" }) },
        validatorRun: { id: "run_val", identity: defaultIdentity({ cli_provider: "claude", default_model: "opus" }) },
      }));
      expect(result.sameOriginValidation).toBe(false);
      expect(result.markdown).toContain("**Same-Origin:** false");
    });
  });

  describe("buildEvidenceSummary - Windows path compatibility", () => {
    it("converts backslash paths to forward slash", () => {
      const result = buildEvidenceSummary(defaultSummaryInput({
        fileChanges: [{ path: "src\\subdir\\app.ts", change_type: "modified" }],
        result: defaultResult({
          outcome: ValidationOutcome.Failed,
          findings: [{
            severity: "error", message: "x", suggestion: null,
            evidence_refs: [], file_path: "src\\app.ts", line: 5,
          }],
        }),
      }));
      expect(result.markdown).toContain("src/subdir/app.ts");
      expect(result.markdown).toContain("src/app.ts:5");
    });
  });
});
