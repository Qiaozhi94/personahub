import type { AdapterStatus, IssueType } from "./index.js";

export interface WorkflowTemplateVersionSummary {
  id: string;
  name: string;
  issue_type: IssueType;
  status: string;
  version: number;
  validation_enabled: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTemplateStep {
  id: string;
  role: string;
}

export interface WorkflowTemplateDetail {
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
  steps: WorkflowTemplateStep[];
  validation_enabled: boolean | null;
  parse_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTemplateListResponse {
  templates: WorkflowTemplateVersionSummary[];
}

export interface WorkflowTemplateDetailResponse {
  template: WorkflowTemplateDetail;
}

export interface CreateWorkflowTemplateVersionInput {
  name?: string;
  steps_json?: string | null;
  activate?: boolean;
  acknowledge_validation_disabled?: boolean;
}

export interface CreateWorkflowTemplateVersionResponse {
  template: WorkflowTemplateDetail;
}

export interface ActivateWorkflowTemplateInput {
  acknowledge_validation_disabled?: boolean;
}

export interface ActivateWorkflowTemplateResponse {
  template: WorkflowTemplateDetail;
}

export interface DeactivateWorkflowTemplateResponse {
  template: WorkflowTemplateDetail;
}

export type HealthDiagnosticCode =
  | "stale_lock_confirmed"
  | "stale_lock_suspected"
  | "lock_timestamp_invalid"
  | "queue_starved"
  | "waiting_for_recovery"
  | "invalid_queued_run"
  | "waiting_for_validation_due"
  | "validation_dispatch_overdue"
  | "no_available_adapter"
  | "schema_version_mismatch";

export interface HealthDiagnostic {
  code: HealthDiagnosticCode;
  workspace_id: string | null;
  detail: string;
  suggested_action: string;
}

export interface RuntimeHealthSnapshot {
  schema: {
    actual_version: number;
    expected_version: number;
    status: "current" | "behind" | "ahead";
  };
  background: {
    pending_probe_count: number;
    pending_reprobe_count: number;
  };
  workspaces: Array<{
    workspace_id: string;
    adapters: Array<{
      id: string;
      name: string;
      effective_status: AdapterStatus;
      last_checked_at: string | null;
    }>;
    lock: {
      locked_by_run_id: string | null;
      locked_at: string | null;
      held_ms: number | null;
    };
    queue: {
      queued_count: number;
      running_run_id: string | null;
    };
  }>;
  diagnostics: HealthDiagnostic[];
}

export interface RuntimeHealthResponse {
  health: RuntimeHealthSnapshot;
}
