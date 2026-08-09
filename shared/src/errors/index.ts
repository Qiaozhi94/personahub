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
