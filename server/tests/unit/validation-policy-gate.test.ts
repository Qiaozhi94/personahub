import { describe, it, expect } from "vitest";
import {
  canonicalizePolicySnapshot,
  hashPolicySnapshot,
  validatePolicySnapshot,
  buildPolicySnapshot,
  checkEvidenceRequirements,
  checkRoundLimit,
  PolicySnapshotError,
} from "../../src/services/validation/policy-gate.js";
import {
  ValidationBlockReason,
  VerificationKind,
  VerificationResult,
  type ValidationPolicySnapshot,
} from "@personahub/shared/types";

function defaultSnapshot(overrides: Partial<ValidationPolicySnapshot> = {}): ValidationPolicySnapshot {
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

function defaultEvidence(overrides: Partial<Parameters<typeof checkEvidenceRequirements>[1]> = {}) {
  return {
    handoffResolved: true,
    fileChangeSetRefPresent: true,
    fileTraceStatus: "complete" as const,
    confirmedVerifications: [{ kind: VerificationKind.Test, result: VerificationResult.Passed }],
    ...overrides,
  };
}

describe("F004 T022: Policy Gate", () => {
  describe("canonical JSON and hash", () => {
    it("produces stable canonical JSON for same snapshot", () => {
      const snapshot = defaultSnapshot();
      const c1 = canonicalizePolicySnapshot(snapshot);
      const c2 = canonicalizePolicySnapshot(snapshot);
      expect(c1).toBe(c2);
    });

    it("produces stable hash regardless of key order in accepted_verification_kinds", () => {
      const s1 = defaultSnapshot({
        evidence_requirements: {
          require_handoff: true,
          require_file_trace: true,
          require_verification: true,
          accepted_verification_kinds: [VerificationKind.Test, VerificationKind.Lint],
        },
      });
      const s2 = defaultSnapshot({
        evidence_requirements: {
          require_handoff: true,
          require_file_trace: true,
          require_verification: true,
          accepted_verification_kinds: [VerificationKind.Lint, VerificationKind.Test],
        },
      });
      expect(hashPolicySnapshot(s1)).toBe(hashPolicySnapshot(s2));
    });

    it("produces different hash for different max_validation_rounds", () => {
      const s1 = defaultSnapshot({ max_validation_rounds: 3 });
      const s2 = defaultSnapshot({ max_validation_rounds: 5 });
      expect(hashPolicySnapshot(s1)).not.toBe(hashPolicySnapshot(s2));
    });

    it("produces different hash for different require_handoff", () => {
      const s1 = defaultSnapshot();
      const s2 = defaultSnapshot({
        evidence_requirements: { ...defaultSnapshot().evidence_requirements, require_handoff: false },
      });
      expect(hashPolicySnapshot(s1)).not.toBe(hashPolicySnapshot(s2));
    });

    it("hash is prefixed with sha256:", () => {
      const hash = hashPolicySnapshot(defaultSnapshot());
      expect(hash.startsWith("sha256:")).toBe(true);
      expect(hash.length).toBeGreaterThan("sha256:".length);
    });

    it("canonical JSON has stable key order", () => {
      const canonical = canonicalizePolicySnapshot(defaultSnapshot());
      const parsed = JSON.parse(canonical);
      const keys = Object.keys(parsed);
      expect(keys).toEqual(["policy_id", "version", "max_validation_rounds", "evidence_requirements"]);
      const reqKeys = Object.keys(parsed.evidence_requirements);
      expect(reqKeys).toEqual([
        "require_handoff", "require_file_trace", "require_verification", "accepted_verification_kinds",
      ]);
    });
  });

  describe("validatePolicySnapshot", () => {
    it("accepts valid snapshot", () => {
      expect(() => validatePolicySnapshot(defaultSnapshot())).not.toThrow();
    });

    it("rejects max_validation_rounds = 0", () => {
      expect(() => validatePolicySnapshot(defaultSnapshot({ max_validation_rounds: 0 }))).toThrow(PolicySnapshotError);
    });

    it("rejects negative max_validation_rounds", () => {
      expect(() => validatePolicySnapshot(defaultSnapshot({ max_validation_rounds: -1 }))).toThrow(PolicySnapshotError);
    });

    it("rejects non-integer max_validation_rounds", () => {
      expect(() => validatePolicySnapshot(defaultSnapshot({ max_validation_rounds: 3.5 }))).toThrow(PolicySnapshotError);
    });

    it("rejects empty policy_id", () => {
      expect(() => validatePolicySnapshot(defaultSnapshot({ policy_id: "" }))).toThrow(PolicySnapshotError);
    });

    it("rejects version < 1", () => {
      expect(() => validatePolicySnapshot(defaultSnapshot({ version: 0 }))).toThrow(PolicySnapshotError);
    });
  });

  describe("buildPolicySnapshot", () => {
    it("builds snapshot from valid JSON", () => {
      const json = JSON.stringify({
        schema_version: 1,
        require_handoff: true,
        require_file_trace: true,
        require_verification: true,
        accepted_verification_kinds: ["test", "lint", "typecheck", "build"],
      });
      const snapshot = buildPolicySnapshot("vpl_1", 1, 3, json);
      expect(snapshot.policy_id).toBe("vpl_1");
      expect(snapshot.max_validation_rounds).toBe(3);
      expect(snapshot.evidence_requirements.accepted_verification_kinds).toHaveLength(4);
    });

    it("rejects null JSON", () => {
      expect(() => buildPolicySnapshot("vpl_1", 1, 3, null)).toThrow(PolicySnapshotError);
    });

    it("rejects invalid JSON", () => {
      expect(() => buildPolicySnapshot("vpl_1", 1, 3, "not json")).toThrow(PolicySnapshotError);
    });
  });

  describe("checkEvidenceRequirements - handoff", () => {
    it("passes when handoff resolved and required", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({ handoffResolved: true }));
      expect(result.passed).toBe(true);
    });

    it("fails when handoff missing and required", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({ handoffResolved: false }));
      expect(result.passed).toBe(false);
      expect(result.blockReason).toBe(ValidationBlockReason.EvidenceMissing);
      expect(result.missingEvidence).toContain("handoff");
    });

    it("passes when handoff missing but not required", () => {
      const snapshot = defaultSnapshot({
        evidence_requirements: { ...defaultSnapshot().evidence_requirements, require_handoff: false },
      });
      const result = checkEvidenceRequirements(snapshot, defaultEvidence({ handoffResolved: false }));
      expect(result.passed).toBe(true);
    });
  });

  describe("checkEvidenceRequirements - file trace", () => {
    it("fails when file-change-set ref missing", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({ fileChangeSetRefPresent: false }));
      expect(result.passed).toBe(false);
      expect(result.missingEvidence).toContain("file-change-set-ref");
    });

    it("fails when file trace unavailable", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({ fileTraceStatus: "unavailable" }));
      expect(result.passed).toBe(false);
      expect(result.missingEvidence).toContain("file-trace-unavailable");
    });

    it("passes with partial file trace", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({ fileTraceStatus: "partial" }));
      expect(result.passed).toBe(true);
    });

    it("passes when file trace not required", () => {
      const snapshot = defaultSnapshot({
        evidence_requirements: { ...defaultSnapshot().evidence_requirements, require_file_trace: false },
      });
      const result = checkEvidenceRequirements(snapshot, defaultEvidence({ fileChangeSetRefPresent: false, fileTraceStatus: "unavailable" }));
      expect(result.passed).toBe(true);
    });
  });

  describe("checkEvidenceRequirements - verification", () => {
    it("passes with accepted kind and passed result", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({
        confirmedVerifications: [{ kind: VerificationKind.Test, result: VerificationResult.Passed }],
      }));
      expect(result.passed).toBe(true);
    });

    it("fails when no passed verification", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({
        confirmedVerifications: [{ kind: VerificationKind.Test, result: VerificationResult.Failed }],
      }));
      expect(result.passed).toBe(false);
      expect(result.missingEvidence).toContain("verification-passed");
    });

    it("fails when kind not in accepted list", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), defaultEvidence({
        confirmedVerifications: [{ kind: "custom", result: VerificationResult.Passed }],
      }));
      expect(result.passed).toBe(false);
    });

    it("passes when verification not required", () => {
      const snapshot = defaultSnapshot({
        evidence_requirements: { ...defaultSnapshot().evidence_requirements, require_verification: false },
      });
      const result = checkEvidenceRequirements(snapshot, defaultEvidence({ confirmedVerifications: [] }));
      expect(result.passed).toBe(true);
    });
  });

  describe("checkEvidenceRequirements - scope mismatch", () => {
    it("fails when all evidence missing", () => {
      const result = checkEvidenceRequirements(defaultSnapshot(), {
        handoffResolved: false,
        fileChangeSetRefPresent: false,
        fileTraceStatus: "unavailable",
        confirmedVerifications: [],
      });
      expect(result.passed).toBe(false);
      expect(result.missingEvidence).toHaveLength(4);
    });
  });

  describe("checkRoundLimit", () => {
    it("max=3, count=0 -> not blocked, nextCount=1", () => {
      const result = checkRoundLimit(0, 3);
      expect(result.blocked).toBe(false);
      expect(result.nextCount).toBe(1);
      expect(result.blockReason).toBeNull();
    });

    it("max=3, count=1 -> not blocked, nextCount=2", () => {
      const result = checkRoundLimit(1, 3);
      expect(result.blocked).toBe(false);
      expect(result.nextCount).toBe(2);
    });

    it("max=3, count=2 -> blocked, nextCount=3 (boundary: nextCount >= max)", () => {
      const result = checkRoundLimit(2, 3);
      expect(result.blocked).toBe(true);
      expect(result.nextCount).toBe(3);
      expect(result.blockReason).toBe(ValidationBlockReason.RoundLimitReached);
    });

    it("max=1, count=0 -> blocked (first fail blocks)", () => {
      const result = checkRoundLimit(0, 1);
      expect(result.blocked).toBe(true);
      expect(result.nextCount).toBe(1);
    });

    it("max=5, count=4 -> blocked", () => {
      const result = checkRoundLimit(4, 5);
      expect(result.blocked).toBe(true);
      expect(result.nextCount).toBe(5);
    });

    it("throws for invalid max=0", () => {
      expect(() => checkRoundLimit(0, 0)).toThrow(PolicySnapshotError);
    });

    it("throws for negative max", () => {
      expect(() => checkRoundLimit(0, -1)).toThrow(PolicySnapshotError);
    });

    it("throws for non-integer max", () => {
      expect(() => checkRoundLimit(0, 3.5)).toThrow(PolicySnapshotError);
    });

    it("throws for negative currentRoundCount", () => {
      expect(() => checkRoundLimit(-1, 3)).toThrow(PolicySnapshotError);
    });
  });

  describe("policy snapshot immutability", () => {
    it("policy row modified after request does not change current round judgment", () => {
      const snapshotAtRequest = defaultSnapshot({ max_validation_rounds: 3 });
      const hashAtRequest = hashPolicySnapshot(snapshotAtRequest);

      const modifiedSnapshot = defaultSnapshot({ max_validation_rounds: 5 });
      const hashAfterModify = hashPolicySnapshot(modifiedSnapshot);

      expect(hashAtRequest).not.toBe(hashAfterModify);

      const resultWithOriginal = checkRoundLimit(2, snapshotAtRequest.max_validation_rounds);
      expect(resultWithOriginal.blocked).toBe(true);

      const resultWithModified = checkRoundLimit(2, modifiedSnapshot.max_validation_rounds);
      expect(resultWithModified.blocked).toBe(false);
    });

    it("evidence gate uses snapshot, not current policy row", () => {
      const snapshotAtRequest = defaultSnapshot({
        evidence_requirements: {
          require_handoff: true,
          require_file_trace: true,
          require_verification: true,
          accepted_verification_kinds: [VerificationKind.Test],
        },
      });

      const result = checkEvidenceRequirements(snapshotAtRequest, defaultEvidence({
        confirmedVerifications: [{ kind: VerificationKind.Lint, result: VerificationResult.Passed }],
      }));
      expect(result.passed).toBe(false);
      expect(result.missingEvidence).toContain("verification-passed");
    });
  });
});
