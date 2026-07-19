import type Database from "better-sqlite3";
import type { WorkflowTemplate, IssueType } from "@personahub/shared/types";

interface WorkflowTemplateRow {
  id: string;
  name: string;
  issue_type: string;
  collaboration_topology: string | null;
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

function mapRow(row: WorkflowTemplateRow): WorkflowTemplate {
  return {
    id: row.id,
    name: row.name,
    issue_type: row.issue_type as IssueType,
    collaboration_topology: row.collaboration_topology ?? "",
    agent_team_template_id: row.agent_team_template_id,
    validation_policy_id: row.validation_policy_id,
    steps_json: row.steps_json,
    handoff_policy_json: row.handoff_policy_json,
    evidence_requirements_json: row.evidence_requirements_json,
    status: row.status,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class WorkflowTemplateRepository {
  constructor(private db: Database.Database) {}

  getDefault(): WorkflowTemplate | null {
    const row = this.db.prepare(
      "SELECT * FROM workflow_templates WHERE issue_type = 'coding' AND status = 'active' ORDER BY version DESC LIMIT 1"
    ).get() as WorkflowTemplateRow | undefined;
    return row ? mapRow(row) : null;
  }

  getById(id: string): WorkflowTemplate | null {
    const row = this.db.prepare(
      "SELECT * FROM workflow_templates WHERE id = ?"
    ).get(id) as WorkflowTemplateRow | undefined;
    return row ? mapRow(row) : null;
  }
}
