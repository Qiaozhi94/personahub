import type {
  Project,
  ProjectWithWorkspace,
  Workspace,
  Issue,
  IssueWithThread,
  Thread,
  ThreadEvent,
  IssueType,
  IssuePriority,
  Run,
  AdapterConfig,
  RunStatus,
  IssueWithRun,
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
  cli_provider: string;
  name: string;
  role?: string;
  command: string;
  args?: string[];
  default_model?: string;
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
  default_model?: string;
}

export interface AdapterConfigUpdateResponse {
  adapter: AdapterConfig;
}

export interface AdapterConfigValidateResponse {
  adapter: AdapterConfig;
}

export interface RunCreateInput {
  instructions: string;
  adapter_id: string;
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
