import type { ValidationFindingSeverity, VerificationKind } from "./trace.js";
import type { IssueStatus, RunSummary, Issue, Run } from "./index.js";

// Extended by F005: adds a persisted, non-null Consult value for ad-hoc
// Runs that don't drive the Issue state machine. Never write null/implementation
// as a stand-in for consult — see design.md §4.1.
export enum RunRole {
  Implementation = "implementation",
  Validator = "validator",
  Consult = "consult",
  /** F006: Graph node Run — drives the graph state machine, not the Issue
   *  state machine. Must NOT fall through to implementation/validator branches. */
  GraphNode = "graph_node",
}

// Extended by F005: adds UserDefault for Runs dispatched via the Project's
// persisted default adapter (as opposed to an explicit user selection).
export enum RunDispatchSource {
  UserExplicit = "user_explicit",
  UserDefault = "user_default",
  System = "system",
}

export enum AdapterRole {
  Implementation = "implementation",
  Validator = "validator",
}

export enum ValidationOutcome {
  Passed = "passed",
  Failed = "failed",
  Blocked = "blocked",
}

export enum ValidationBlockReason {
  ValidatorUnavailable = "validator_unavailable",
  ValidatorRunFailed = "validator_run_failed",
  ResultUnparsable = "result_unparsable",
  EvidenceMissing = "evidence_missing",
  EvidenceScopeMismatch = "evidence_scope_mismatch",
  RoundLimitReached = "round_limit_reached",
  WorkflowConfigurationInvalid = "workflow_configuration_invalid",
  RecoveryInconsistent = "recovery_inconsistent",
}

export interface ValidationFinding {
  severity: ValidationFindingSeverity;
  message: string;
  suggestion: string | null;
  evidence_refs: string[];
  file_path: string | null;
  line: number | null;
}

export interface ValidationResultEnvelope {
  schema_version: 1;
  outcome: ValidationOutcome;
  summary: string;
  findings: ValidationFinding[];
  evidence_refs: string[];
  missing_evidence: string[];
  key_decisions: string[];
  lessons_candidate: string[];
}

export interface AdapterIdentitySnapshot {
  adapter_config_id: string;
  name: string;
  cli_provider: string;
  default_model: string | null;
}

export interface ValidationEvidenceRequirements {
  require_handoff: boolean;
  require_file_trace: boolean;
  require_verification: boolean;
  accepted_verification_kinds: VerificationKind[];
}

export interface ValidationPolicySnapshot {
  policy_id: string;
  version: number;
  max_validation_rounds: number;
  evidence_requirements: ValidationEvidenceRequirements;
}

export interface EvidenceSummary {
  id: string;
  issue_id: string;
  thread_id: string;
  validator_run_id: string;
  implementation_run_id: string;
  validation_result: ValidationOutcome;
  evidence_refs: string[];
  summary_markdown: string;
  same_origin_validation: boolean;
  implementation_identity: AdapterIdentitySnapshot;
  validator_identity: AdapterIdentitySnapshot;
  policy_id: string;
  policy_version: number;
  policy_snapshot: ValidationPolicySnapshot;
  policy_snapshot_hash: string;
  created_at: string;
}

export interface ValidationResultSummary {
  outcome: ValidationOutcome;
  summary: string;
  validation_round: number;
  finding_count: number;
  validator_run_id: string;
  created_at: string;
}

export interface ValidationFindingRecord {
  validation_round: number;
  finding_index: number;
  severity: ValidationFindingSeverity;
  message: string;
  suggestion: string | null;
  evidence_refs: string[];
  file_path: string | null;
  line: number | null;
  event_id: string;
  created_at: string;
}

export interface IssueValidationResponse {
  issue_id: string;
  status: IssueStatus;
  current_round: number | null;
  completed_failed_rounds: number;
  max_rounds: number;
  active_validator_run: RunSummary | null;
  latest_result: ValidationResultSummary | null;
  latest_findings: ValidationFindingRecord[];
  blocker: { reason_code: string; message: string; event_id: string } | null;
  evidence_summary: EvidenceSummary | null;
}

export interface EvidenceSummaryResponse {
  evidence_summary: EvidenceSummary;
}

export interface UnblockInput {
  operator_note: string;
}

export interface UnblockResponse {
  issue: Issue;
}

export interface TriggerValidationResponse {
  run: Run;
}

export interface ResetValidationRoundsResponse {
  issue: Issue;
  event_id: string;
}
