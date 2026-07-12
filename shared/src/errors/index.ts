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
} from "../types/index.js";

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
