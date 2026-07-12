export interface Project {
  id: string;
  name: string;
  description: string | null;
  default_workspace_id: string | null;
  default_coordinator_agent_id: string | null;
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
