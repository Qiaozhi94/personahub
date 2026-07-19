import type Database from "better-sqlite3";
import type { Issue, IssueType, IssueStatus, IssuePriority } from "@personahub/shared/types";
import { generateIssueId } from "../id.js";

export interface IssueUpdateStatusInput {
  status: IssueStatus;
  updatedAt: string;
}

export interface IssueCreateInput {
  project_id: string;
  workspace_id: string;
  issue_type: IssueType;
  workflow_template_id: string;
  validation_policy_id: string;
  title: string;
  goal: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  labels: string[];
}

export interface IssueCompareAndSetPatch {
  validation_round_count?: number;
  blocked_reason_code?: string | null;
  blocked_reason_message?: string | null;
}

export interface IssueCompareAndSetResult {
  success: boolean;
  issue: Issue | null;
}

interface IssueRow {
  id: string;
  project_id: string;
  workspace_id: string;
  primary_thread_id: string | null;
  issue_type: string;
  workflow_template_id: string;
  validation_policy_id: string;
  title: string;
  goal: string | null;
  status: string;
  owner_agent_id: string | null;
  coordinator_agent_id: string | null;
  priority: string;
  labels: string;
  validation_round_count: number;
  blocked_reason_code: string | null;
  blocked_reason_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: IssueRow): Issue {
  return {
    id: row.id,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    primary_thread_id: row.primary_thread_id,
    issue_type: row.issue_type as IssueType,
    workflow_template_id: row.workflow_template_id,
    validation_policy_id: row.validation_policy_id,
    title: row.title,
    goal: row.goal,
    status: row.status as IssueStatus,
    owner_agent_id: row.owner_agent_id,
    coordinator_agent_id: row.coordinator_agent_id,
    priority: row.priority as IssuePriority,
    labels: JSON.parse(row.labels ?? "[]") as string[],
    validation_round_count: row.validation_round_count,
    blocked_reason_code: row.blocked_reason_code,
    blocked_reason_message: row.blocked_reason_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class IssueRepository {
  constructor(private db: Database.Database) {}

  create(input: IssueCreateInput): Issue {
    const id = generateIssueId();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO issues (id, project_id, workspace_id, primary_thread_id, issue_type, workflow_template_id, validation_policy_id, title, goal, status, owner_agent_id, coordinator_agent_id, priority, labels, validation_round_count, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 0, ?, ?)`
    ).run(
      id, input.project_id, input.workspace_id, input.issue_type,
      input.workflow_template_id, input.validation_policy_id,
      input.title, input.goal, input.status, input.priority,
      JSON.stringify(input.labels), now, now
    );

    const row = this.db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as IssueRow;
    return mapRow(row);
  }

  list(projectId: string): Issue[] {
    const rows = this.db.prepare(
      "SELECT * FROM issues WHERE project_id = ? ORDER BY created_at DESC"
    ).all(projectId) as IssueRow[];
    return rows.map(mapRow);
  }

  get(id: string): Issue | null {
    const row = this.db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as IssueRow | undefined;
    return row ? mapRow(row) : null;
  }

  getById(id: string): Issue | null {
    return this.get(id);
  }

  updatePrimaryThread(issueId: string, threadId: string, updatedAt: string): void {
    this.db.prepare(
      "UPDATE issues SET primary_thread_id = ?, updated_at = ? WHERE id = ?"
    ).run(threadId, updatedAt, issueId);
  }

  updateStatus(issueId: string, input: IssueUpdateStatusInput): void {
    this.db.prepare(
      "UPDATE issues SET status = ?, updated_at = ? WHERE id = ?"
    ).run(input.status, input.updatedAt, issueId);
  }

  compareAndSetStatus(
    id: string,
    expected: IssueStatus,
    next: IssueStatus,
    patch?: IssueCompareAndSetPatch,
  ): IssueCompareAndSetResult {
    const sets: string[] = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [next, new Date().toISOString()];

    if (patch?.validation_round_count !== undefined) {
      sets.push("validation_round_count = ?");
      values.push(patch.validation_round_count);
    }
    if (patch?.blocked_reason_code !== undefined) {
      sets.push("blocked_reason_code = ?");
      values.push(patch.blocked_reason_code);
    }
    if (patch?.blocked_reason_message !== undefined) {
      sets.push("blocked_reason_message = ?");
      values.push(patch.blocked_reason_message);
    }

    values.push(id, expected);

    const result = this.db.prepare(
      `UPDATE issues SET ${sets.join(", ")} WHERE id = ? AND status = ?`,
    ).run(...values);

    if (result.changes === 0) {
      return { success: false, issue: null };
    }

    const row = this.db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as IssueRow;
    return { success: true, issue: mapRow(row) };
  }

  listByStatus(status: IssueStatus): Issue[] {
    const rows = this.db.prepare(
      "SELECT * FROM issues WHERE status = ? ORDER BY created_at ASC, id ASC"
    ).all(status) as IssueRow[];
    return rows.map(mapRow);
  }

  listValidatingWithoutActiveValidator(): Issue[] {
    const rows = this.db.prepare(
      `SELECT i.* FROM issues i
       WHERE i.status = 'Validating'
         AND NOT EXISTS (
           SELECT 1 FROM runs r
           WHERE r.issue_id = i.id
             AND r.role = 'validator'
             AND r.status IN ('queued', 'running')
         )
       ORDER BY i.created_at ASC, i.id ASC`,
    ).all() as IssueRow[];
    return rows.map(mapRow);
  }
}
