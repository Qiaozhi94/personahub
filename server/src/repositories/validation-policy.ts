import type Database from "better-sqlite3";
import type { ValidationPolicy, IssueType } from "@personahub/shared/types";

interface ValidationPolicyRow {
  id: string;
  name: string;
  issue_type: string;
  pass_conditions_json: string | null;
  fail_conditions_json: string | null;
  evidence_requirements_json: string | null;
  max_validation_rounds: number;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ValidationPolicyRow): ValidationPolicy {
  return {
    id: row.id,
    name: row.name,
    issue_type: row.issue_type as IssueType,
    pass_conditions_json: row.pass_conditions_json,
    fail_conditions_json: row.fail_conditions_json,
    evidence_requirements_json: row.evidence_requirements_json,
    max_validation_rounds: row.max_validation_rounds,
    status: row.status,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ValidationPolicyRepository {
  constructor(private db: Database.Database) {}

  getDefault(): ValidationPolicy | null {
    const row = this.db.prepare(
      "SELECT * FROM validation_policies WHERE issue_type = 'coding' AND status = 'active' ORDER BY version DESC LIMIT 1"
    ).get() as ValidationPolicyRow | undefined;
    return row ? mapRow(row) : null;
  }
}
