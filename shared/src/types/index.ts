import type { RunRole, RunDispatchSource, AdapterIdentitySnapshot, ValidationBlockReason } from "./validation.js";
import type { AdapterAuthType, AgentCapability, RunPurpose } from "./adapter.js";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  default_workspace_id: string | null;
  default_coordinator_agent_id: string | null;
  /** F005: Project-level default adapter, resolved when a Run omits adapter_id. */
  default_adapter_config_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  project_id: string;
  local_path: string;
  git_branch: string | null;
  lock_state: WorkspaceLockState;
  locked_by_run_id: string | null;
  locked_at: string | null;
  push_credentials_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  project_id: string;
  workspace_id: string;
  primary_thread_id: string | null;
  issue_type: IssueType;
  workflow_template_id: string;
  validation_policy_id: string;
  title: string;
  goal: string | null;
  status: IssueStatus;
  owner_agent_id: string | null;
  coordinator_agent_id: string | null;
  priority: IssuePriority;
  labels: string[];
  validation_round_count: number;
  blocked_reason_code: ValidationBlockReason | string | null;
  blocked_reason_message: string | null;
  /** F005 §8.1: set in Phase A (implementation completed), cleared by the Phase B winner. Non-null means the grace window is still open. */
  validation_dispatch_due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Thread {
  id: string;
  issue_id: string;
  room_id: string | null;
  thread_type: ThreadType;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ThreadEvent {
  id: string;
  event_sequence: number;
  thread_id: string;
  type: ThreadEventType;
  actor_type: ActorType;
  actor_id: string | null;
  payload_json: Record<string, unknown>;
  evidence_refs: string[];
  created_at: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  issue_type: IssueType;
  collaboration_topology: string;
  agent_team_template_id: string | null;
  validation_policy_id: string | null;
  steps_json: string | null;
  handoff_policy_json: string | null;
  evidence_requirements_json: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ValidationPolicy {
  id: string;
  name: string;
  issue_type: IssueType;
  pass_conditions_json: string | null;
  fail_conditions_json: string | null;
  evidence_requirements_json: string | null;
  max_validation_rounds: number;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export enum IssueStatus {
  Inbox = "Inbox",
  Ready = "Ready",
  Running = "Running",
  Validating = "Validating",
  Done = "Done",
  Blocked = "Blocked",
}

export enum IssueType {
  Coding = "coding",
}

export enum IssuePriority {
  Low = "low",
  Normal = "normal",
  High = "high",
}

export enum ThreadType {
  Primary = "primary",
  Room = "room",
  Incident = "incident",
  Council = "council",
}

export enum ThreadEventType {
  IssueCreated = "issue.created",
  RunQueued = "run.queued",
  RunStarted = "run.started",
  RunOutput = "run.output",
  RunOutputTruncated = "run.output_truncated",
  RunCompleted = "run.completed",
  RunFailed = "run.failed",
  RunCancelled = "run.cancelled",
  RunInterrupted = "run.interrupted",
  EscalationTriggered = "escalation.triggered",
  IssueBlocked = "issue.blocked",
  CommandStarted = "command.started",
  CommandCompleted = "command.completed",
  TestCompleted = "test.completed",
  FileChangeSummary = "file.change_summary",
  FileChangeScanFailed = "file.change_scan_failed",
  HandoffCreated = "handoff.created",
  /** F005 §8.1: Phase A — implementation completed, no validator Run exists yet (payload carries no validator identity). Not to be confused with ValidationRequested, which stays validator-bound. */
  ValidationDispatchPending = "validation.dispatch_pending",
  ValidationRequested = "validation.requested",
  ValidationFinding = "validation.finding",
  ValidationPassed = "validation.passed",
  ValidationFailed = "validation.failed",
  ValidationBlocked = "validation.blocked",
  IssueDone = "issue.done",
  IssueUnblocked = "issue.unblocked",
  ValidationRoundReset = "validation.round_reset",
}

export enum ActorType {
  User = "user",
  Agent = "agent",
  System = "system",
}

export enum WorkspaceLockState {
  Idle = "idle",
  Locked = "locked",
}

export interface ProjectWithWorkspace extends Project {
  default_workspace: WorkspaceSummary | null;
}

export interface WorkspaceSummary {
  id: string;
  local_path: string;
  git_branch: string | null;
  lock_state: WorkspaceLockState;
}

export interface IssueWithThread extends Issue {
  primary_thread: ThreadSummary | null;
}

export interface ThreadSummary {
  id: string;
  issue_id: string;
  thread_type: ThreadType;
  title: string;
}

export enum RunStatus {
  Queued = "queued",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Interrupted = "interrupted",
  Cancelled = "cancelled",
}

export enum FailureReason {
  AdapterExitNonzero = "adapter_exit_nonzero",
  SpawnFailed = "spawn_failed",
  ExecutionTimeout = "execution_timeout",
  CredentialIsolationBlocked = "credential_isolation_blocked",
  PreExecutionApprovalRejected = "pre_execution_approval_rejected",
  PostHocEscalation = "post_hoc_escalation",
  ServerRestarted = "server_restarted",
  OutputParseFailed = "output_parse_failed",
}

export enum AdapterStatus {
  Unknown = "unknown",
  Available = "available",
  Unavailable = "unavailable",
}

export interface Run {
  id: string;
  issue_id: string;
  thread_id: string;
  workspace_id: string;
  adapter_config_id: string;
  status: RunStatus;
  failure_reason: FailureReason | null;
  instructions: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  error_message: string | null;
  role: RunRole;
  workflow_step: "implementation" | "validation" | null;
  validation_round: number | null;
  dispatch_source: RunDispatchSource;
  adapter_identity: AdapterIdentitySnapshot | null;
  has_final_message: boolean;
  /** F005: workflow_bound (drives Issue state machine) vs ad_hoc_consult. */
  purpose: RunPurpose;
  /** F005: Run whose Handoff Packet/evidence this Run's context was assembled from; null for the first Run. */
  context_source_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdapterConfig {
  id: string;
  project_id: string;
  name: string;
  cli_provider: string;
  command: string;
  args: string[];
  capability_tags: AgentCapability[];
  default_model: string | null;
  /** Project-global baseline status (schema v7 `agent_configs.status`) — unaffected by any workspace override, even when this response is workspace-scoped (see `effective_status` below). */
  status: AdapterStatus;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  auth_type: AdapterAuthType;
  model_provider: string | null;
  /** Write-only secret projection: whether an API key is configured. Never carries the raw value. */
  has_api_key: boolean;
  auth_status_message: string | null;
  /** Service-computed projection against Project.default_adapter_config_id; not a DB column on agent_configs. */
  is_default: boolean;
  /**
   * F005 workspace-aware availability closure: present only when the
   * request that produced this DTO was scoped to a specific workspace
   * (`GET .../adapters?workspace_id=`). `effective_status` is `status`
   * merged with that workspace's `adapter_workspace_status` override, if
   * any (see `effectiveAdapterStatus()`) — this is what actually determines
   * routability/validator-selection for that workspace, and can differ from
   * the Project-global `status` above. `has_workspace_override` says
   * whether an exception row exists for this exact (adapter, workspace)
   * pair, so the UI can visually distinguish "baseline" from "overridden".
   */
  effective_status?: AdapterStatus;
  effective_last_checked_at?: string | null;
  effective_auth_status_message?: string | null;
  has_workspace_override?: boolean;
}

export interface ProjectDefaultAdapterInput {
  /** null only allowed when the Project has no adapters left to default to. */
  adapter_id: string | null;
}

export interface ProjectDefaultAdapterResponse {
  adapter: AdapterConfig | null;
}

export interface IssueWithRun extends Issue {
  primary_thread: ThreadSummary | null;
  latest_run: RunSummary | null;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
}

export * from "./trace.js";
export * from "./validation.js";
export * from "./adapter.js";
