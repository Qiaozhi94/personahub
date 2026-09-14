import type {
  Project,
  ProjectWithWorkspace,
  Workspace,
  Issue,
  IssueWithThread,
  Thread,
  ThreadEvent,
  IssuePriority,
  Run,
  AdapterConfig,
  CliProvider,
  AdapterAuthType,
  AgentCapability,
} from "../types/index.js";

export {
  type IssueValidationResponse,
  type EvidenceSummaryResponse,
  type UnblockInput,
  type UnblockResponse,
} from "../types/validation.js";

export enum ErrorCode {
  PROJECT_NAME_REQUIRED = "PROJECT_NAME_REQUIRED",
  PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND",
  WORKSPACE_PATH_REQUIRED = "WORKSPACE_PATH_REQUIRED",
  WORKSPACE_PATH_NOT_FOUND = "WORKSPACE_PATH_NOT_FOUND",
  WORKSPACE_PATH_NOT_READABLE = "WORKSPACE_PATH_NOT_READABLE",
  WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND",
  ISSUE_TITLE_REQUIRED = "ISSUE_TITLE_REQUIRED",
  ISSUE_GOAL_REQUIRED = "ISSUE_GOAL_REQUIRED",
  ISSUE_PRIORITY_INVALID = "ISSUE_PRIORITY_INVALID",
  ISSUE_NOT_FOUND = "ISSUE_NOT_FOUND",
  PROJECT_WORKSPACE_REQUIRED = "PROJECT_WORKSPACE_REQUIRED",
  THREAD_NOT_FOUND = "THREAD_NOT_FOUND",
  ADAPTER_PROVIDER_UNSUPPORTED = "ADAPTER_PROVIDER_UNSUPPORTED",
  ADAPTER_COMMAND_REQUIRED = "ADAPTER_COMMAND_REQUIRED",
  ADAPTER_COMMAND_UNAVAILABLE = "ADAPTER_COMMAND_UNAVAILABLE",
  ADAPTER_NOT_FOUND = "ADAPTER_NOT_FOUND",
  ADAPTER_IN_USE = "ADAPTER_IN_USE",
  ADAPTER_REQUIRED = "ADAPTER_REQUIRED",
  ADAPTER_UNAVAILABLE = "ADAPTER_UNAVAILABLE",
  ADAPTER_ROLE_INVALID = "ADAPTER_ROLE_INVALID",
  RUN_NOT_FOUND = "RUN_NOT_FOUND",
  RUN_INSTRUCTIONS_REQUIRED = "RUN_INSTRUCTIONS_REQUIRED",
  ISSUE_BLOCKED = "ISSUE_BLOCKED",
  WORKSPACE_LOCKED = "WORKSPACE_LOCKED",
  INVALID_QUERY = "INVALID_QUERY",
  EVIDENCE_REF_INVALID = "EVIDENCE_REF_INVALID",
  EVIDENCE_SCOPE_MISMATCH = "EVIDENCE_SCOPE_MISMATCH",
  INVALID_ISSUE_TRANSITION = "INVALID_ISSUE_TRANSITION",
  VALIDATOR_UNAVAILABLE = "VALIDATOR_UNAVAILABLE",
  VALIDATOR_RUN_CONFLICT = "VALIDATOR_RUN_CONFLICT",
  VALIDATION_RESULT_INVALID = "VALIDATION_RESULT_INVALID",
  EVIDENCE_REQUIREMENTS_NOT_MET = "EVIDENCE_REQUIREMENTS_NOT_MET",
  EVIDENCE_SUMMARY_NOT_FOUND = "EVIDENCE_SUMMARY_NOT_FOUND",
  OPERATOR_NOTE_REQUIRED = "OPERATOR_NOTE_REQUIRED",
  ADAPTER_AUTH_INVALID = "ADAPTER_AUTH_INVALID",
  ADAPTER_API_KEY_REQUIRED = "ADAPTER_API_KEY_REQUIRED",
  ADAPTER_MODEL_PROVIDER_UNSUPPORTED = "ADAPTER_MODEL_PROVIDER_UNSUPPORTED",
  DEFAULT_ADAPTER_UNAVAILABLE = "DEFAULT_ADAPTER_UNAVAILABLE",
  RUN_PURPOSE_INVALID = "RUN_PURPOSE_INVALID",
  RUN_NOT_ALLOWED_FOR_ISSUE_STATUS = "RUN_NOT_ALLOWED_FOR_ISSUE_STATUS",
  REQUEST_BODY_INVALID = "REQUEST_BODY_INVALID",
  // F006: graph execution errors
  GRAPH_RUN_NOT_FOUND = "GRAPH_RUN_NOT_FOUND",
  NODE_RUN_NOT_FOUND = "NODE_RUN_NOT_FOUND",
  NODE_RUN_ATTEMPT_IN_PROGRESS = "NODE_RUN_ATTEMPT_IN_PROGRESS",
  NODE_RUN_NOT_RETRYABLE = "NODE_RUN_NOT_RETRYABLE",
  GRAPH_RUN_CANCELLING = "GRAPH_RUN_CANCELLING",
  GRAPH_RUN_TERMINAL = "GRAPH_RUN_TERMINAL",
  NO_CAPABLE_ADAPTER = "NO_CAPABLE_ADAPTER",
  ADAPTER_CAPABILITY_MISSING = "ADAPTER_CAPABILITY_MISSING",
  GRAPH_DEFINITION_UNAVAILABLE = "GRAPH_DEFINITION_UNAVAILABLE",
  DEFINITION_VERSION_UNAVAILABLE = "DEFINITION_VERSION_UNAVAILABLE",
  GRAPH_PLAN_INCOMPLETE = "GRAPH_PLAN_INCOMPLETE",
  GRAPH_TARGET_SET_EMPTY = "GRAPH_TARGET_SET_EMPTY",
  RECOVERY_ACTION_NOT_APPLICABLE = "RECOVERY_ACTION_NOT_APPLICABLE",
  // F007: intake / routing recommendation errors
  NO_AVAILABLE_ADAPTER = "NO_AVAILABLE_ADAPTER",
  NO_AVAILABLE_CAPABLE_ADAPTER = "NO_AVAILABLE_CAPABLE_ADAPTER",
  CONFIRMATION_TOKEN_INVALID = "CONFIRMATION_TOKEN_INVALID",
  RECOMMENDATION_STALE = "RECOMMENDATION_STALE",
  TOPOLOGY_NOT_EXECUTABLE = "TOPOLOGY_NOT_EXECUTABLE",
  GRAPH_PLAN_UNKNOWN_NODE = "GRAPH_PLAN_UNKNOWN_NODE",
  // F008: workflow template admin & runtime health errors
  TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND",
  TEMPLATE_STEPS_INVALID = "TEMPLATE_STEPS_INVALID",
  VALIDATION_DISABLE_NOT_ACKNOWLEDGED = "VALIDATION_DISABLE_NOT_ACKNOWLEDGED",
  TEMPLATE_FIELD_NOT_EDITABLE = "TEMPLATE_FIELD_NOT_EDITABLE",
  TEMPLATE_VERSION_CONFLICT = "TEMPLATE_VERSION_CONFLICT",
  LAST_ACTIVE_TEMPLATE = "LAST_ACTIVE_TEMPLATE",
  // F010: artifact & provenance errors
  ARTIFACT_NOT_FOUND = "ARTIFACT_NOT_FOUND",
  ARTIFACT_REVISION_NOT_FOUND = "ARTIFACT_REVISION_NOT_FOUND",
  ARTIFACT_RETIRED = "ARTIFACT_RETIRED",
  ARTIFACT_REVISION_CONFLICT = "ARTIFACT_REVISION_CONFLICT",
  ARTIFACT_IDEMPOTENCY_CONFLICT = "ARTIFACT_IDEMPOTENCY_CONFLICT",
  ARTIFACT_REF_INVALID = "ARTIFACT_REF_INVALID",
  ARTIFACT_TOO_LARGE = "ARTIFACT_TOO_LARGE",
  ARTIFACT_SOURCE_OUTSIDE_ROOT = "ARTIFACT_SOURCE_OUTSIDE_ROOT",
  ARTIFACT_ARCHIVE_COLLISION = "ARTIFACT_ARCHIVE_COLLISION",
  ARTIFACT_ARCHIVE_WRITE_FAILED = "ARTIFACT_ARCHIVE_WRITE_FAILED",
  ARTIFACT_HASH_MISMATCH = "ARTIFACT_HASH_MISMATCH",
  // F013: Space / repository / skill errors
  SPACE_NAME_REQUIRED = "SPACE_NAME_REQUIRED",
  SPACE_NOT_FOUND = "SPACE_NOT_FOUND",
  SPACE_NOT_ACTIVE = "SPACE_NOT_ACTIVE",
  SPACE_ARCHIVE_BLOCKED = "SPACE_ARCHIVE_BLOCKED",
  ISSUE_SPACE_REQUIRED = "ISSUE_SPACE_REQUIRED",
  ISSUE_SPACE_MISMATCH = "ISSUE_SPACE_MISMATCH",
  PROJECT_ARCHIVED = "PROJECT_ARCHIVED",
  PROJECT_HAS_REFERENCES = "PROJECT_HAS_REFERENCES",
  REPOSITORY_SOURCE_REQUIRED = "REPOSITORY_SOURCE_REQUIRED",
  REPOSITORY_NOT_FOUND = "REPOSITORY_NOT_FOUND",
  REPOSITORY_ALREADY_AUTHORIZED = "REPOSITORY_ALREADY_AUTHORIZED",
  REPOSITORY_CONFLICT = "REPOSITORY_CONFLICT",
  REPOSITORY_NOT_AUTHORIZED = "REPOSITORY_NOT_AUTHORIZED",
  SCOPE_INVALID_PREFIX = "SCOPE_INVALID_PREFIX",
  SCOPE_WRITE_NOT_IN_READ = "SCOPE_WRITE_NOT_IN_READ",
  SKILL_NOT_FOUND = "SKILL_NOT_FOUND",
  SKILL_REVISION_NOT_FOUND = "SKILL_REVISION_NOT_FOUND",
  SKILL_SCHEMA_INVALID = "SKILL_SCHEMA_INVALID",
  SKILL_SCHEMA_UNKNOWN_FIELD = "SKILL_SCHEMA_UNKNOWN_FIELD",
  SKILL_EVIDENCE_STATUS_UNKNOWN = "SKILL_EVIDENCE_STATUS_UNKNOWN",
  SKILL_EVIDENCE_STATUS_UNMAPPED = "SKILL_EVIDENCE_STATUS_UNMAPPED",
  SKILL_EVIDENCE_KIND_UNAVAILABLE = "SKILL_EVIDENCE_KIND_UNAVAILABLE",
  SKILL_EVIDENCE_CONFLICT = "SKILL_EVIDENCE_CONFLICT",
  SKILL_FILES_TOO_LARGE = "SKILL_FILES_TOO_LARGE",
  SKILL_FILE_HASH_MISMATCH = "SKILL_FILE_HASH_MISMATCH",
  SKILL_SOURCE_CONFLICT = "SKILL_SOURCE_CONFLICT",
  SKILL_CONFLICT_UNRESOLVED = "SKILL_CONFLICT_UNRESOLVED",
  SKILL_SPACE_MISMATCH = "SKILL_SPACE_MISMATCH",
  SKILL_DELIVERY_FAILED = "SKILL_DELIVERY_FAILED",
  // F012: session / dispatch / intervention errors
  ADAPTER_BASE_URL_INVALID = "ADAPTER_BASE_URL_INVALID",
  ROOM_NOT_FOUND = "ROOM_NOT_FOUND",
  ROOM_ENDED = "ROOM_ENDED",
  ROOM_ALREADY_TASK_BOUND = "ROOM_ALREADY_TASK_BOUND",
  SPACE_CONTEXT_REQUIRED = "SPACE_CONTEXT_REQUIRED",
  DISPATCH_NOT_FOUND = "DISPATCH_NOT_FOUND",
  DISPATCH_NOT_CANCELLABLE = "DISPATCH_NOT_CANCELLABLE",
  DISPATCH_GATE_PAUSED = "DISPATCH_GATE_PAUSED",
  DISPATCH_ACCEPTANCE_LOCKED = "DISPATCH_ACCEPTANCE_LOCKED",
  DISPATCH_IDEMPOTENCY_CONFLICT = "DISPATCH_IDEMPOTENCY_CONFLICT",
  DISPATCH_GRACE_WINDOW_INVALID = "DISPATCH_GRACE_WINDOW_INVALID",
  ELIGIBILITY_STRUCTURAL_BLOCK = "ELIGIBILITY_STRUCTURAL_BLOCK",
  ELIGIBILITY_BLOCK_OVERRIDE_REJECTED = "ELIGIBILITY_BLOCK_OVERRIDE_REJECTED",
  ATTEMPT_NOT_FOUND = "ATTEMPT_NOT_FOUND",
  ATTEMPT_NOT_ACTIVE = "ATTEMPT_NOT_ACTIVE",
  GATE_SCOPE_UNKNOWN = "GATE_SCOPE_UNKNOWN",
  RUNTIME_CONTEXT_UNAVAILABLE = "RUNTIME_CONTEXT_UNAVAILABLE",
  START_LEASE_CONFLICT = "START_LEASE_CONFLICT",
  OUTBOX_TX_REQUIRED = "OUTBOX_TX_REQUIRED",
  OUTBOX_EVENT_NOT_FOUND = "OUTBOX_EVENT_NOT_FOUND",
  OUTBOX_NOT_CLAIMED = "OUTBOX_NOT_CLAIMED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiError;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  /** F013：缺省归入当前选中的 Space（前端负责带上以避免歧义）。 */
  space_id?: string;
}

export interface ProjectCreateResponse {
  project: Project;
}

export interface ProjectListResponse {
  projects: Project[];
}

export interface ProjectGetResponse {
  project: ProjectWithWorkspace;
}

export interface WorkspaceBindInput {
  local_path: string;
}

export interface WorkspaceBindResponse {
  workspace: Workspace;
}

export interface WorkspaceGetResponse {
  workspace: Workspace | null;
}

export interface WorkspaceByIdResponse {
  workspace: Workspace;
}

export interface IssueCreateInput {
  title: string;
  goal: string;
  priority?: IssuePriority;
  labels?: string[];
}

export interface IssueCreateResponse {
  issue: IssueWithThread;
  primary_thread: Thread;
}

export interface IssueListResponse {
  issues: Issue[];
}

export interface IssueGetResponse {
  issue: IssueWithThread;
}

export interface ThreadGetResponse {
  thread: Thread;
}

export interface ThreadEventListResponse {
  events: ThreadEvent[];
}

export interface AdapterConfigCreateInput {
  cli_provider: CliProvider;
  auth_type: AdapterAuthType;
  name: string;
  role?: string;
  command: string;
  args?: string[];
  default_model?: string;
  /** Required for opencode api_key auth; unused/rejected otherwise. */
  model_provider?: string;
  /** Write-only: never echoed back in any response. */
  api_key?: string;
  capability_tags: AgentCapability[];
  make_default?: boolean;
  /** F012/ADR 0012: optional custom endpoint; https:// or http:// loopback only. */
  base_url?: string;
}

export interface AdapterConfigCreateResponse {
  adapter: AdapterConfig;
}

export interface AdapterConfigListResponse {
  adapters: AdapterConfig[];
}

export interface AdapterConfigUpdateInput {
  name?: string;
  role?: string;
  command?: string;
  args?: string[];
  /** omitted preserves; null clears; non-empty string replaces. */
  default_model?: string | null;
  auth_type?: AdapterAuthType;
  /** omitted preserves; null clears; non-empty string replaces. */
  model_provider?: string | null;
  /** omitted preserves; null clears; non-empty string replaces. */
  api_key?: string | null;
  capability_tags?: AgentCapability[];
  /** omitted preserves; null clears; non-empty string replaces. */
  base_url?: string | null;
}

export interface AdapterConfigUpdateResponse {
  adapter: AdapterConfig;
}

export interface AdapterConfigValidateResponse {
  adapter: AdapterConfig;
}

export interface RunCreateInput {
  instructions: string;
  /** Omitted => resolve Project default adapter. */
  adapter_id?: string;
  /** Default "auto"; client cannot request "workflow_bound" — the server derives it. */
  purpose?: "auto" | "ad_hoc_consult";
}

export interface RunCreateResponse {
  run: Run;
}

export interface RunGetResponse {
  run: Run;
}

export interface RunListResponse {
  runs: Run[];
}

export interface RunCancelResponse {
  run: Run;
}
