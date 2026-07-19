import { describe, it, expect } from "vitest";
import {
  buildValidatorContext,
  buildRepairContext,
  CONTEXT_MAX_BYTES,
  ContextBuilderError,
  type ValidatorContextInput,
  type ContextPriorFinding,
} from "../../src/services/validation/context-builder.js";
import type { HandoffPayload } from "../../src/services/handoff-builder.js";
import {
  VerificationKind,
  type ValidationPolicySnapshot,
  type AdapterIdentitySnapshot,
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

function defaultPolicySnapshot(overrides: Partial<ValidationPolicySnapshot> = {}): ValidationPolicySnapshot {
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
    completed_work: ["Added src/feature.ts", "Added tests"],
    command_summary: { total: 5, succeeded: 5, failed: 0, blocked: 0, unknown: 0 },
    verification_summary: { passed: 3, failed: 0, unknown: 0 },
    file_summary: { total: 2, scan_status: "complete", ref: "file-change-set:run_impl_1" },
    known_risks: [],
    missing_evidence: [],
    next_expected_action: "Validate the implementation.",
    evidence_ref_count: 10,
    evidence_refs_truncated: false,
    ...overrides,
  };
}

function defaultCompleteness(overrides: Partial<TraceCompleteness> = {}): TraceCompleteness {
  return {
    commands: "complete",
    verification: "complete",
    file_changes: "complete",
    refs: "complete",
    reasons: [],
    ...overrides,
  };
}

function defaultInput(overrides: Partial<ValidatorContextInput> = {}): ValidatorContextInput {
  return {
    issue: { title: "Implement Feature X", goal: "Add feature X with tests" },
    policySnapshot: defaultPolicySnapshot(),
    policySnapshotHash: "sha256:abc123",
    implementationRun: { id: "run_impl_1", identity: defaultIdentity({ adapter_config_id: "agc_impl" }) },
    validatorRun: { id: "run_val_1", identity: defaultIdentity({ adapter_config_id: "agc_val", name: "Codex Reviewer" }) },
    handoff: defaultHandoff(),
    verifications: [
      { id: "evt_1", kind: "test", result: "passed", command: "npm test", evidence_ref: "event:evt_1" },
    ],
    fileChanges: [
      { path: "src/feature.ts", change_type: "added" },
      { path: "tests/feature.test.ts", change_type: "added" },
    ],
    fileChangeSetRef: "file-change-set:run_impl_1",
    priorFindings: [],
    traceCompleteness: defaultCompleteness(),
    validationRound: 1,
    ...overrides,
  };
}

describe("F004 T024: Validation Context Builder", () => {
  describe("basic structure", () => {
    it("builds context with all required sections", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("## System Contract");
      expect(result.markdown).toContain("## Issue");
      expect(result.markdown).toContain("## Validation Policy");
      expect(result.markdown).toContain("## Implementation Run");
      expect(result.markdown).toContain("## Validator Run");
      expect(result.markdown).toContain("## Implementation Handoff");
      expect(result.markdown).toContain("## Verification Evidence");
      expect(result.markdown).toContain("## Changed Files");
      expect(result.markdown).toContain("## Prior Validation Findings");
      expect(result.markdown).toContain("## Trace Completeness");
      expect(result.markdown).toContain("## Validation Round");
    });

    it("includes issue title and goal", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("**Title:** Implement Feature X");
      expect(result.markdown).toContain("**Goal:** Add feature X with tests");
    });

    it("handles null goal", () => {
      const result = buildValidatorContext(defaultInput({ issue: { title: "Test", goal: null } }));
      expect(result.markdown).toContain("**Title:** Test");
      expect(result.markdown).not.toContain("**Goal:**");
    });
  });

  describe("validator source uses validator_run_id", () => {
    it("includes validator run ID in the Validator Run section", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("**Run ID:** run_val_1");
      expect(result.markdown).toContain("Codex Reviewer");
    });

    it("includes implementation run ID in the Implementation Run section", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("**Run ID:** run_impl_1");
    });

    it("clearly separates validator and implementation run identities", () => {
      const result = buildValidatorContext(defaultInput());
      const valIdx = result.markdown.indexOf("## Validator Run");
      const implIdx = result.markdown.indexOf("## Implementation Run");
      expect(valIdx).toBeGreaterThan(-1);
      expect(implIdx).toBeGreaterThan(-1);
      expect(valIdx).not.toBe(implIdx);
    });
  });

  describe("evidence scoped to implementation_run_id", () => {
    it("handoff run_id matches implementation_run_id", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("run_impl_1");
    });

    it("file change set ref references implementation_run_id", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("file-change-set:run_impl_1");
    });

    it("verifications reference implementation run evidence", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("event:evt_1");
    });
  });

  describe("subsequent consult handoff does not leak", () => {
    it("only uses the handoff explicitly passed (does not fetch others)", () => {
      const handoff = defaultHandoff({ run_id: "run_impl_1", summary: "Implementation handoff for run_impl_1" });
      const result = buildValidatorContext(defaultInput({ handoff }));
      expect(result.markdown).toContain("Implementation handoff for run_impl_1");
    });

    it("shows no-handoff message when handoff is null", () => {
      const result = buildValidatorContext(defaultInput({ handoff: null }));
      expect(result.markdown).toContain("No handoff available");
    });
  });

  describe("trusted allowlist rejects run.output", () => {
    it("does not include any run output in the context", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).not.toContain("run.output");
      expect(result.markdown).not.toContain("raw output");
    });

    it("does not include absolute paths", () => {
      const result = buildValidatorContext(defaultInput({
        fileChanges: [
          { path: "src/app.ts", change_type: "modified" },
          { path: "/etc/passwd", change_type: "modified" },
        ],
      }));
      expect(result.markdown).not.toContain("/etc/passwd");
    });
  });

  describe("fixed policy snapshot/hash", () => {
    it("includes policy snapshot hash from requested event", () => {
      const result = buildValidatorContext(defaultInput({ policySnapshotHash: "sha256:fixed_hash_abc" }));
      expect(result.markdown).toContain("sha256:fixed_hash_abc");
    });

    it("includes policy id/version/max rounds", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.markdown).toContain("vpl_coding_default");
      expect(result.markdown).toContain("**Version:** 1");
      expect(result.markdown).toContain("**Max Validation Rounds:** 3");
    });
  });

  describe("prior findings injection", () => {
    it("includes prior findings when present", () => {
      const findings: ContextPriorFinding[] = [
        { validation_round: 1, severity: "error", message: "Missing test", suggestion: "Add test", file_path: "src/app.ts", line: 10 },
      ];
      const result = buildValidatorContext(defaultInput({ priorFindings: findings }));
      expect(result.markdown).toContain("Missing test");
      expect(result.markdown).toContain("Add test");
      expect(result.markdown).toContain("src/app.ts:10");
    });

    it("shows no prior findings message when empty", () => {
      const result = buildValidatorContext(defaultInput({ priorFindings: [] }));
      expect(result.markdown).toContain("No prior findings");
    });

    it("shows round number for each finding", () => {
      const findings: ContextPriorFinding[] = [
        { validation_round: 1, severity: "error", message: "Issue 1", suggestion: null, file_path: null, line: null },
        { validation_round: 2, severity: "warning", message: "Issue 2", suggestion: null, file_path: null, line: null },
      ];
      const result = buildValidatorContext(defaultInput({ priorFindings: findings, validationRound: 3 }));
      expect(result.markdown).toContain("[Round 1]");
      expect(result.markdown).toContain("[Round 2]");
    });
  });

  describe("first round", () => {
    it("works correctly with no prior findings on round 1", () => {
      const result = buildValidatorContext(defaultInput({ priorFindings: [], validationRound: 1 }));
      expect(result.truncated).toBe(false);
      expect(result.markdown).toContain("**Current Round:** 1");
    });
  });

  describe("Windows path compatibility", () => {
    it("converts backslash paths to forward slash", () => {
      const result = buildValidatorContext(defaultInput({
        fileChanges: [{ path: "src\\subdir\\app.ts", change_type: "modified" }],
        priorFindings: [
          { validation_round: 1, severity: "error", message: "x", suggestion: null, file_path: "src\\app.ts", line: 5 },
        ],
      }));
      expect(result.markdown).toContain("src/subdir/app.ts");
      expect(result.markdown).toContain("src/app.ts:5");
      expect(result.markdown).not.toContain("src\\");
    });
  });

  describe("128 KiB truncation priority", () => {
    it("does not truncate small contexts", () => {
      const result = buildValidatorContext(defaultInput());
      expect(result.truncated).toBe(false);
      expect(result.truncatedSections).toEqual([]);
    });

    it("truncates file list first when over limit", () => {
      const manyFiles = Array.from({ length: 5000 }, (_, i) => ({
        path: `src/module_${i}/file_${i}.ts`,
        change_type: "modified",
      }));
      const result = buildValidatorContext(defaultInput({ fileChanges: manyFiles }));
      expect(Buffer.byteLength(result.markdown, "utf8")).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
      expect(result.truncated).toBe(true);
      expect(result.truncatedSections).toContain("file_list");
    });

    it("truncates verification summaries second", () => {
      const manyVerifs = Array.from({ length: 2000 }, (_, i) => ({
        id: `evt_${i}`,
        kind: "test",
        result: "passed",
        command: `npm test --file ${i}.ts`,
        evidence_ref: `event:evt_${i}`,
      }));
      const result = buildValidatorContext(defaultInput({ verifications: manyVerifs }));
      expect(Buffer.byteLength(result.markdown, "utf8")).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
      expect(result.truncated).toBe(true);
    });

    it("truncates older findings third (keeps latest round)", () => {
      const findings: ContextPriorFinding[] = [];
      for (let round = 1; round <= 2; round++) {
        for (let i = 0; i < 500; i++) {
          findings.push({
            validation_round: round,
            severity: "error",
            message: `Finding ${round}-${i} ` + "x".repeat(100),
            suggestion: null,
            file_path: null,
            line: null,
          });
        }
      }
      const result = buildValidatorContext(defaultInput({ priorFindings: findings, validationRound: 3 }));
      expect(Buffer.byteLength(result.markdown, "utf8")).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
      expect(result.truncated).toBe(true);
    });

    it("throws when must-not-truncate sections exceed limit", () => {
      const hugeGoal = "x".repeat(CONTEXT_MAX_BYTES + 1);
      expect(() => buildValidatorContext(defaultInput({ issue: { title: "Test", goal: hugeGoal } }))).toThrow(ContextBuilderError);
    });

    it("preserves policy and goal even when truncated", () => {
      const manyFiles = Array.from({ length: 5000 }, (_, i) => ({
        path: `src/file_${i}.ts`,
        change_type: "modified",
      }));
      const result = buildValidatorContext(defaultInput({
        fileChanges: manyFiles,
        issue: { title: "Important Issue", goal: "Critical goal" },
      }));
      expect(result.markdown).toContain("Important Issue");
      expect(result.markdown).toContain("Critical goal");
      expect(result.markdown).toContain("vpl_coding_default");
      expect(result.markdown).toContain("sha256:abc123");
    });
  });

  describe("buildRepairContext", () => {
    it("appends findings to base instructions", () => {
      const findings: ContextPriorFinding[] = [
        { validation_round: 1, severity: "error", message: "Test failed", suggestion: "Fix test", file_path: "src/app.ts", line: 10 },
      ];
      const result = buildRepairContext({ baseInstructions: "Do the work.", latestFailedFindings: findings, validationRound: 1 });
      expect(result).toContain("Do the work.");
      expect(result).toContain("Test failed");
      expect(result).toContain("Fix test");
      expect(result).toContain("src/app.ts:10");
      expect(result).toContain("Round 1");
    });

    it("returns base instructions when no findings", () => {
      const result = buildRepairContext({ baseInstructions: "Do the work.", latestFailedFindings: [], validationRound: 1 });
      expect(result).toBe("Do the work.");
    });

    it("converts Windows paths in findings", () => {
      const findings: ContextPriorFinding[] = [
        { validation_round: 1, severity: "error", message: "x", suggestion: null, file_path: "src\\app.ts", line: 5 },
      ];
      const result = buildRepairContext({ baseInstructions: "Do work.", latestFailedFindings: findings, validationRound: 1 });
      expect(result).toContain("src/app.ts:5");
      expect(result).not.toContain("src\\");
    });
  });
});
