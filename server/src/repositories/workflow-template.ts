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

export interface InsertVersionInput {
  name: string;
  steps_json: string | null;
}

export class WorkflowTemplateRepository {
  constructor(private db: Database.Database) {}

  getDefault(): WorkflowTemplate | null {
    const row = this.db
      .prepare(
        "SELECT * FROM workflow_templates WHERE issue_type = 'coding' AND status = 'active' ORDER BY version DESC LIMIT 1",
      )
      .get() as WorkflowTemplateRow | undefined;
    return row ? mapRow(row) : null;
  }

  getById(id: string): WorkflowTemplate | null {
    const row = this.db.prepare("SELECT * FROM workflow_templates WHERE id = ?").get(id) as
      WorkflowTemplateRow | undefined;
    return row ? mapRow(row) : null;
  }

  // F008 T010
  listByIssueType(issueType: string): WorkflowTemplate[] {
    const rows = this.db
      .prepare("SELECT * FROM workflow_templates WHERE issue_type = ? ORDER BY version ASC")
      .all(issueType) as WorkflowTemplateRow[];
    return rows.map(mapRow);
  }

  listVersions(issueType: string): WorkflowTemplate[] {
    return this.listByIssueType(issueType);
  }

  getMaxVersion(issueType: string): number {
    const row = this.db
      .prepare("SELECT MAX(version) as v FROM workflow_templates WHERE issue_type = ?")
      .get(issueType) as { v: number | null } | undefined;
    return row?.v ?? 0;
  }

  getActiveByIssueType(issueType: string): WorkflowTemplate | null {
    const row = this.db
      .prepare("SELECT * FROM workflow_templates WHERE issue_type = ? AND status = 'active' LIMIT 1")
      .get(issueType) as WorkflowTemplateRow | undefined;
    return row ? mapRow(row) : null;
  }

  countActiveByIssueType(issueType: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as c FROM workflow_templates WHERE issue_type = ? AND status = 'active'")
      .get(issueType) as { c: number };
    return row.c;
  }

  // F008 T020/T031: plain statements only - the service wraps version-compute +
  // insert + audit in one transaction. issue_type and the four non-editable
  // fields + agent_team_template_id are copied from source.
  insertVersion(
    source: WorkflowTemplate,
    input: InsertVersionInput,
    activate: boolean,
    newId: string,
    version: number,
  ): WorkflowTemplate {
    const now = new Date().toISOString();
    const status = activate ? "active" : "inactive";
    if (activate) {
      this.db
        .prepare(
          "UPDATE workflow_templates SET status = 'inactive', updated_at = ? WHERE issue_type = ? AND status = 'active'",
        )
        .run(now, source.issue_type);
    }
    this.db
      .prepare(
        `INSERT INTO workflow_templates
        (id, name, issue_type, collaboration_topology, agent_team_template_id, validation_policy_id, steps_json, handoff_policy_json, evidence_requirements_json, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId,
        input.name,
        source.issue_type,
        source.collaboration_topology || null,
        source.agent_team_template_id,
        source.validation_policy_id,
        input.steps_json,
        source.handoff_policy_json,
        source.evidence_requirements_json,
        status,
        version,
        now,
        now,
      );
    const row = this.db.prepare("SELECT * FROM workflow_templates WHERE id = ?").get(newId) as WorkflowTemplateRow;
    return mapRow(row);
  }

  // F008 T023/T031: two semantic commands replace a generic setStatus().
  // Plain statements only - the service wraps this + audit in one transaction.
  activate(id: string, issueType: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE workflow_templates SET status = 'inactive', updated_at = ? WHERE issue_type = ? AND status = 'active'",
      )
      .run(now, issueType);
    this.db.prepare("UPDATE workflow_templates SET status = 'active', updated_at = ? WHERE id = ?").run(now, id);
  }

  deactivate(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE workflow_templates SET status = 'inactive', updated_at = ? WHERE id = ?").run(now, id);
  }
}
