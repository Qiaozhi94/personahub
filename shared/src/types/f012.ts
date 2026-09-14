// F012 T001: Session / Dispatch / Attempt / execution identity / context
// snapshot / eligibility / outbox contracts (design.md §3/§4). DB-backed state
// sets are enums to match the existing schema-mirror style; open reason codes
// are string unions so new codes cannot silently break consumers.

export enum RoomState {
  Active = "active",
  Ended = "ended",
}

/** One Room per session (ADR 0012 §1: Issue → Room ×N → Thread 1:1). */
export interface Room {
  id: string;
  space_id: string;
  /** NULL = 独立会话 (FR-007): can dispatch and execute, but no Artifact /
   *  Evidence / Memory writes until converted to a task. */
  issue_id: string | null;
  title: string;
  state: RoomState;
  created_at: string;
  ended_at: string | null;
}

export enum DispatchState {
  Draft = "draft",
  Cancelled = "cancelled",
  Starting = "starting",
  Dispatched = "dispatched",
  StartFailed = "start_failed",
}

export enum DispatchPurpose {
  Execute = "execute",
  Validate = "validate",
  DesignCases = "design_cases",
}

export enum ContextScope {
  All = "all",
  ResultOnly = "result_only",
  GoalOnly = "goal_only",
}

export enum DepthNormalized {
  High = "high",
  Medium = "medium",
  Low = "low",
}

/** 四维执行组合 + 执行位置（ADR 0012 §2 / ADR 0015 §1–2）。 */
export interface ExecutionIdentity {
  runtime_id: string;
  adapter_config_id: string;
  /** Only set for adapters with multiple access methods. */
  access_ref: string | null;
  model: string;
  /** Adapter-native level text as recorded from capability evidence. */
  depth_raw: string;
  depth_normalized: DepthNormalized;
}

export enum AttemptState {
  Queued = "queued",
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Cancelled = "cancelled",
  Interrupted = "interrupted",
}

export enum StartMode {
  Cold = "cold",
  Resumed = "resumed",
}

/** ADR 0009 §4 — the five mandatory cold-start reasons. */
export type ColdStartReason =
  | "user_restart"
  | "session_unusable"
  | "poisoned_predecessor"
  | "independence_required"
  | "memory_isolation_unavailable";

/** Attempt is a first-class object between Dispatch and Run: one Dispatch has
 *  N Attempts (infrastructure retries), each Attempt owns exactly one Run. */
export interface Attempt {
  id: string;
  dispatch_id: string;
  /** 1-based within the dispatch; (dispatch_id, seq) is unique. */
  seq: number;
  run_id: string;
  state: AttemptState;
  start_mode: StartMode;
  resumed_from_attempt_id: string | null;
  /** Sensitive runtime metadata — masked in UI and exports (NFR-004). */
  provider_session_id: string | null;
  cold_start_reason: ColdStartReason | null;
  created_at: string;
  ended_at: string | null;
}

export interface Dispatch {
  id: string;
  room_id: string;
  /** Redundant query column; must equal rooms.issue_id (migration trigger). */
  issue_id: string | null;
  /** Idempotency key is (room_id, client_request_id) — task-independent. */
  client_request_id: string;
  state: DispatchState;
  purpose: DispatchPurpose;
  identity: ExecutionIdentity;
  /** AdapterIdentitySnapshot + runtime_id, frozen at confirm time. */
  identity_snapshot_json: string;
  context_scope: ContextScope;
  /** Sorted skill@version list frozen at confirm time (AC-001). */
  skill_revision_refs_json: string;
  /** F013 EffectiveRequirementsResolver verbatim output + hash. */
  effective_requirements_json: string;
  effective_requirements_hash: string;
  handoff_refs_json: string;
  /** Task-level path narrowing; same shape as F013 scope_json. */
  task_scope_json: string | null;
  /** Soft-requirement deviation record; structural gaps cannot be overridden. */
  requirement_override_json: string | null;
  grace_deadline_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  graph_node_run_id: string | null;
  failed_reason_code: string | null;
  failed_diagnostics_json: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

/** Included/filtered per-item record; refs only, never body content (NFR-002). */
export interface ContextSnapshotItem {
  source_ref: string;
  kind: string;
  decision: "included" | "filtered";
  reason: string | null;
}

export interface ContextSnapshot {
  dispatch_id: string;
  scope: ContextScope;
  items: ContextSnapshotItem[];
  content_hash: string;
  assembled_at: string;
}

export type CapabilityKey =
  | "model_enumeration"
  | "depth"
  | "session_resume"
  | "native_memory_isolation"
  | "tools"
  | "quota";

export type CapabilityVerdictValue = "supported" | "unsupported" | "unverified";

/** Per-dispatch frozen verdict with its evidence pointer (§3.4). */
export interface DispatchCapabilitySnapshot {
  dispatch_id: string;
  capability_key: CapabilityKey;
  verdict: CapabilityVerdictValue;
  evidence_id: string;
  /** Consequence of this verdict for THIS dispatch, in words. */
  consequence: string;
}

/** §3.5 evidence row as produced by the T000 probe script. */
export interface AdapterCapabilityEvidence {
  id: string;
  cli_provider: string;
  cli_version: string;
  capability_key: CapabilityKey;
  verdict: CapabilityVerdictValue;
  probe_command: string;
  probe_result: string;
  probed_at: string;
  /** Required when unverified: what is missing and how to re-run. */
  missing_reason: string | null;
}

export enum GateScopeType {
  Runtime = "runtime",
  Issue = "issue",
  Graph = "graph",
}

export enum GateState {
  Open = "open",
  Paused = "paused",
}

export interface DispatchGate {
  scope_type: GateScopeType;
  scope_id: string;
  state: GateState;
  /** Monotonic; participates in claim linearization and event payloads. */
  revision: number;
  reason: string | null;
  actor: string;
  updated_at: string;
}

export enum OutboxStatus {
  Pending = "pending",
  InFlight = "in_flight",
  Delivered = "delivered",
  Poison = "poison",
}

export interface OutboxEvent {
  id: string;
  topic: string;
  payload_json: string;
  dedupe_key: string;
  status: OutboxStatus;
  attempts: number;
  available_at: string;
  claimed_by: string | null;
  claim_expires_at: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
  created_at: string;
  delivered_at: string | null;
}

// ---------------------------------------------------------------------------
// Eligibility (§4.2) — read-only three-tier candidates with per-item reasons.
// ---------------------------------------------------------------------------

export type EligibilityTier = "recommended" | "selectable" | "blocked";

export type EligibilityReasonStrength = "structural" | "soft";

/** Open set: stable codes owned here, adapters may add codes as string. */
export type EligibilityReasonCode =
  | "NATIVE_MEMORY_UNVERIFIED"
  | "NATIVE_MEMORY_UNSUPPORTED"
  | "SAME_SOURCE_DOWNGRADED"
  | "SKILL_REQUIREMENT_UNMET"
  | "SKILL_SOURCE_UNRESOLVED"
  | "SKILL_DISABLED"
  | "SKILL_SHADOWED"
  | "ADAPTER_OFFLINE"
  | "ADAPTER_LOGIN_UNKNOWN"
  | "QUOTA_INSUFFICIENT"
  | "MODEL_NOT_AVAILABLE"
  | "DEPTH_UNMAPPABLE"
  | "REPO_PATH_UNAUTHORIZED"
  | "ENUMERATION_UNVERIFIED"
  | "GATE_PAUSED"
  | (string & {});

export interface EligibilityReason {
  code: EligibilityReasonCode;
  /** Where the requirement came from: capability_evidence | skill@N/step | runtime | authorization. */
  source: string;
  strength: EligibilityReasonStrength;
  consequence: string;
  evidence_id?: string;
  cli_version?: string;
  probed_at?: string;
}

export interface EligibilityCandidate {
  identity: ExecutionIdentity;
  tier: EligibilityTier;
  reasons: EligibilityReason[];
}

export interface EligibilityResult {
  candidates: EligibilityCandidate[];
  requirements: {
    ref: string;
    hash: string;
    items: unknown[];
  };
}

// ---------------------------------------------------------------------------
// F011 read-only contracts (§4.6) — frozen shapes; F011 consumes, never writes.
// ---------------------------------------------------------------------------

export interface ExecutionStateQuery {
  open_dispatches: Array<{ id: string; state: "draft" | "starting" }>;
  active_attempts: Array<{ id: string; dispatch_id: string; state: "queued" | "running" }>;
  pending_permissions: Array<{ id: string; kind: string }>;
}

export interface IndependenceSnapshot {
  purpose: DispatchPurpose;
  context_scope: ContextScope;
  start_mode: StartMode;
  includes_implementer_narrative: boolean;
  native_memory_isolation: CapabilityVerdictValue;
  execution_identity: {
    runtime_id: string;
    adapter_config_id: string;
    model: string;
    depth_normalized: string;
  };
  /** null for legacy_no_dispatch producers (§7.4). */
  producer_identity: {
    runtime_id: string;
    adapter_config_id: string;
    model: string;
  } | null;
  /** Same (adapter_config_id, model) as the producer. */
  same_source: boolean;
}

// ---------------------------------------------------------------------------
// Runtime projection (§6.3) — read-only facts for one machine (v0.3: 'local').
// ---------------------------------------------------------------------------

export interface RuntimeAdapterSummary {
  id: string;
  name: string;
  cli_provider: string;
  runtime_id: string;
  status: string;
  last_checked_at: string | null;
  auth_status_message: string | null;
  default_model: string | null;
}

export interface RuntimeMachineProjection {
  machine: { id: string; label: string; kind: string };
  adapters: RuntimeAdapterSummary[];
  workspace_locks: Array<{
    workspace_id: string;
    project_id: string;
    locked_by_run_id: string | null;
    locked_at: string | null;
  }>;
  queue: { queued_count: number; running_run_ids: string[] };
  background: {
    pending_probe_count: number;
    pending_reprobe_count: number;
    outbox: { pending: number; poison: number };
  };
  runtime_gate: { state: GateState; revision: number; reason: string | null; updated_at: string };
  /** ADR 0017 §4: adapter self-reported quota facts. v0.3 collects none —
   *  absent facts are NULL/empty and render as "—", never 0. */
  quota: Array<{
    adapter_config_id: string;
    source: "authoritative" | "estimated";
    detail: string | null;
  }>;
}

export interface RuntimeAdapterFacts {
  adapter: RuntimeAdapterSummary;
  capability_evidence: Array<{
    capability_key: CapabilityKey;
    verdict: CapabilityVerdictValue;
    cli_version: string;
    probed_at: string;
    missing_reason: string | null;
  }>;
  /** Only visible models per capability evidence; empty when not enumerable. */
  models: string[];
  quota: RuntimeMachineProjection["quota"];
}
