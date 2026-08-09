import type Database from "better-sqlite3";

export interface IntakeConfirmationRecord {
  nonce: string;
  project_id: string;
  workspace_id: string;
  recommendation_id: string;
  chosen_json: string;
  issue_id: string;
  target_kind: "graph" | "run";
  target_id: string;
  issued_at: string;
  confirmed_at: string;
}

export class IntakeConfirmationRepository {
  constructor(private db: Database.Database) {}

  getByNonce(nonce: string): IntakeConfirmationRecord | null {
    const row = this.db.prepare("SELECT * FROM intake_confirmations WHERE nonce = ?").get(nonce) as
      IntakeConfirmationRecord | undefined;
    return row ?? null;
  }

  create(input: IntakeConfirmationRecord): void {
    this.db
      .prepare(
        `INSERT INTO intake_confirmations
         (nonce, project_id, workspace_id, recommendation_id, chosen_json, issue_id, target_kind, target_id, issued_at, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.nonce,
        input.project_id,
        input.workspace_id,
        input.recommendation_id,
        input.chosen_json,
        input.issue_id,
        input.target_kind,
        input.target_id,
        input.issued_at,
        input.confirmed_at,
      );
  }
}
