import type Database from "better-sqlite3";
import type {
  EvidenceSummary,
  ValidationOutcome,
  AdapterIdentitySnapshot,
  ValidationPolicySnapshot,
} from "@personahub/shared/types";
import { generateEvidenceSummaryId } from "../id.js";

export interface EvidenceSummaryCreateInput {
  issue_id: string;
  thread_id: string;
  validator_run_id: string;
  implementation_run_id: string;
  validation_result: ValidationOutcome;
  evidence_refs: string[];
  summary_markdown: string;
  same_origin_validation: boolean;
  implementation_identity: AdapterIdentitySnapshot;
  validator_identity: AdapterIdentitySnapshot;
  policy_id: string;
  policy_version: number;
  policy_snapshot: ValidationPolicySnapshot;
  policy_snapshot_hash: string;
}

interface EvidenceSummaryRow {
  id: string;
  issue_id: string;
  thread_id: string;
  validator_run_id: string;
  implementation_run_id: string;
  validation_result: string;
  evidence_refs: string;
  summary_markdown: string;
  same_origin_validation: number;
  implementation_identity_json: string;
  validator_identity_json: string;
  policy_id: string;
  policy_version: number;
  policy_snapshot_json: string;
  policy_snapshot_hash: string;
  created_at: string;
}

function mapRow(row: EvidenceSummaryRow): EvidenceSummary {
  return {
    id: row.id,
    issue_id: row.issue_id,
    thread_id: row.thread_id,
    validator_run_id: row.validator_run_id,
    implementation_run_id: row.implementation_run_id,
    validation_result: row.validation_result as ValidationOutcome,
    evidence_refs: JSON.parse(row.evidence_refs ?? "[]") as string[],
    summary_markdown: row.summary_markdown,
    same_origin_validation: row.same_origin_validation === 1,
    implementation_identity: JSON.parse(row.implementation_identity_json) as AdapterIdentitySnapshot,
    validator_identity: JSON.parse(row.validator_identity_json) as AdapterIdentitySnapshot,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    policy_snapshot: JSON.parse(row.policy_snapshot_json) as ValidationPolicySnapshot,
    policy_snapshot_hash: row.policy_snapshot_hash,
    created_at: row.created_at,
  };
}

export class EvidenceSummaryRepository {
  constructor(private db: Database.Database) {}

  createIfAbsent(input: EvidenceSummaryCreateInput): EvidenceSummary {
    const id = generateEvidenceSummaryId();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO evidence_summaries (
        id, issue_id, thread_id, validator_run_id, implementation_run_id,
        validation_result, evidence_refs, summary_markdown, same_origin_validation,
        implementation_identity_json, validator_identity_json,
        policy_id, policy_version, policy_snapshot_json, policy_snapshot_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO NOTHING`,
    ).run(
      id, input.issue_id, input.thread_id, input.validator_run_id, input.implementation_run_id,
      input.validation_result, JSON.stringify(input.evidence_refs), input.summary_markdown,
      input.same_origin_validation ? 1 : 0,
      JSON.stringify(input.implementation_identity), JSON.stringify(input.validator_identity),
      input.policy_id, input.policy_version, JSON.stringify(input.policy_snapshot),
      input.policy_snapshot_hash, now,
    );

    const row = this.db.prepare(
      "SELECT * FROM evidence_summaries WHERE issue_id = ?",
    ).get(input.issue_id) as EvidenceSummaryRow;
    return mapRow(row);
  }

  getByIssueId(issueId: string): EvidenceSummary | null {
    const row = this.db.prepare(
      "SELECT * FROM evidence_summaries WHERE issue_id = ?",
    ).get(issueId) as EvidenceSummaryRow | undefined;
    return row ? mapRow(row) : null;
  }

  getById(id: string): EvidenceSummary | null {
    const row = this.db.prepare(
      "SELECT * FROM evidence_summaries WHERE id = ?",
    ).get(id) as EvidenceSummaryRow | undefined;
    return row ? mapRow(row) : null;
  }
}
