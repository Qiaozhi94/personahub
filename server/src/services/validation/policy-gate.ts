import { createHash } from "node:crypto";
import {
  ValidationBlockReason,
  VerificationKind,
  VerificationResult,
  type ValidationPolicySnapshot,
  type ValidationEvidenceRequirements,
} from "@personahub/shared/types";

export class PolicySnapshotError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicySnapshotError";
  }
}

export function canonicalizePolicySnapshot(snapshot: ValidationPolicySnapshot): string {
  const canonical = {
    policy_id: snapshot.policy_id,
    version: snapshot.version,
    max_validation_rounds: snapshot.max_validation_rounds,
    evidence_requirements: {
      require_handoff: snapshot.evidence_requirements.require_handoff,
      require_file_trace: snapshot.evidence_requirements.require_file_trace,
      require_verification: snapshot.evidence_requirements.require_verification,
      accepted_verification_kinds: [...snapshot.evidence_requirements.accepted_verification_kinds].sort(),
    },
  };
  return JSON.stringify(canonical);
}

export function hashPolicySnapshot(snapshot: ValidationPolicySnapshot): string {
  const canonical = canonicalizePolicySnapshot(snapshot);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hash}`;
}

export function validatePolicySnapshot(snapshot: ValidationPolicySnapshot): void {
  if (typeof snapshot.policy_id !== "string" || snapshot.policy_id.length === 0) {
    throw new PolicySnapshotError("invalid_policy_id", "policy_id must be a non-empty string");
  }
  if (typeof snapshot.version !== "number" || !Number.isInteger(snapshot.version) || snapshot.version < 1) {
    throw new PolicySnapshotError("invalid_version", "version must be a positive integer");
  }
  if (
    typeof snapshot.max_validation_rounds !== "number" ||
    !Number.isInteger(snapshot.max_validation_rounds) ||
    snapshot.max_validation_rounds < 1
  ) {
    throw new PolicySnapshotError("invalid_max_rounds", "max_validation_rounds must be a positive integer");
  }

  const req = snapshot.evidence_requirements;
  if (typeof req.require_handoff !== "boolean") {
    throw new PolicySnapshotError("invalid_requirements", "require_handoff must be boolean");
  }
  if (typeof req.require_file_trace !== "boolean") {
    throw new PolicySnapshotError("invalid_requirements", "require_file_trace must be boolean");
  }
  if (typeof req.require_verification !== "boolean") {
    throw new PolicySnapshotError("invalid_requirements", "require_verification must be boolean");
  }
  if (!Array.isArray(req.accepted_verification_kinds)) {
    throw new PolicySnapshotError("invalid_requirements", "accepted_verification_kinds must be an array");
  }
}

export function buildPolicySnapshot(
  policyId: string,
  version: number,
  maxValidationRounds: number,
  evidenceRequirementsJson: string | null,
): ValidationPolicySnapshot {
  if (!evidenceRequirementsJson) {
    throw new PolicySnapshotError("missing_requirements", "evidence_requirements_json is null");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(evidenceRequirementsJson);
  } catch {
    throw new PolicySnapshotError("invalid_requirements_json", "Failed to parse evidence_requirements_json");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PolicySnapshotError("invalid_requirements_json", "evidence_requirements must be an object");
  }

  const obj = parsed as Record<string, unknown>;

  // Fail closed: reject non-boolean / non-array values instead of silently coercing
  if (typeof obj.require_handoff !== "boolean" ||
      typeof obj.require_file_trace !== "boolean" ||
      typeof obj.require_verification !== "boolean") {
    throw new PolicySnapshotError("invalid_requirements", "require_handoff, require_file_trace, and require_verification must be boolean");
  }
  if (!Array.isArray(obj.accepted_verification_kinds) ||
      !(obj.accepted_verification_kinds as string[]).every((k) => typeof k === "string")) {
    throw new PolicySnapshotError("invalid_requirements", "accepted_verification_kinds must be an array of strings");
  }

  const VALID_VERIFICATION_KINDS = new Set<string>(Object.values(VerificationKind));
  if (!(obj.accepted_verification_kinds as string[]).every((k) => VALID_VERIFICATION_KINDS.has(k))) {
    throw new PolicySnapshotError("invalid_requirements", "accepted_verification_kinds contains unknown kind");
  }

  if (obj.schema_version !== undefined && obj.schema_version !== 1) {
    throw new PolicySnapshotError("invalid_requirements", `Unsupported policy schema version: ${obj.schema_version}`);
  }

  const requirements: ValidationEvidenceRequirements = {
    require_handoff: obj.require_handoff,
    require_file_trace: obj.require_file_trace,
    require_verification: obj.require_verification,
    accepted_verification_kinds: obj.accepted_verification_kinds as ValidationEvidenceRequirements["accepted_verification_kinds"],
  };

  const snapshot: ValidationPolicySnapshot = {
    policy_id: policyId,
    version,
    max_validation_rounds: maxValidationRounds,
    evidence_requirements: requirements,
  };

  validatePolicySnapshot(snapshot);
  return snapshot;
}

export interface PolicyGateEvidenceInput {
  handoffResolved: boolean;
  fileChangeSetRefPresent: boolean;
  fileTraceStatus: "complete" | "partial" | "unavailable";
  confirmedVerifications: { kind: string; result: string }[];
}

export interface PolicyGateResult {
  passed: boolean;
  blockReason: ValidationBlockReason | null;
  missingEvidence: string[];
}

export function checkEvidenceRequirements(
  snapshot: ValidationPolicySnapshot,
  evidence: PolicyGateEvidenceInput,
): PolicyGateResult {
  validatePolicySnapshot(snapshot);
  const missing: string[] = [];
  const req = snapshot.evidence_requirements;

  if (req.require_handoff && !evidence.handoffResolved) {
    missing.push("handoff");
  }

  if (req.require_file_trace) {
    if (!evidence.fileChangeSetRefPresent) {
      missing.push("file-change-set-ref");
    }
    if (evidence.fileTraceStatus === "unavailable") {
      missing.push("file-trace-unavailable");
    }
  }

  if (req.require_verification) {
    const hasAccepted = evidence.confirmedVerifications.some(
      (v) =>
        v.result === VerificationResult.Passed &&
        req.accepted_verification_kinds.includes(v.kind as never),
    );
    if (!hasAccepted) {
      missing.push("verification-passed");
    }
  }

  if (missing.length > 0) {
    return {
      passed: false,
      blockReason: ValidationBlockReason.EvidenceMissing,
      missingEvidence: missing,
    };
  }

  return { passed: true, blockReason: null, missingEvidence: [] };
}

export interface RoundLimitResult {
  blocked: boolean;
  nextCount: number;
  blockReason: ValidationBlockReason | null;
}

export function checkRoundLimit(
  currentRoundCount: number,
  maxRounds: number,
): RoundLimitResult {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new PolicySnapshotError("invalid_max_rounds", "max_validation_rounds must be a positive integer");
  }
  if (!Number.isInteger(currentRoundCount) || currentRoundCount < 0) {
    throw new PolicySnapshotError("invalid_round_count", "currentRoundCount must be a non-negative integer");
  }

  const nextCount = currentRoundCount + 1;
  if (nextCount >= maxRounds) {
    return {
      blocked: true,
      nextCount,
      blockReason: ValidationBlockReason.RoundLimitReached,
    };
  }

  return { blocked: false, nextCount, blockReason: null };
}
