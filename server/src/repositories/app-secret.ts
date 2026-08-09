import type Database from "better-sqlite3";

export interface AppSecretRecord {
  name: string;
  value: string;
  created_at: string;
}

export class AppSecretRepository {
  constructor(private db: Database.Database) {}

  get(name: string): AppSecretRecord | null {
    const row = this.db.prepare("SELECT * FROM app_secrets WHERE name = ?").get(name) as AppSecretRecord | undefined;
    return row ?? null;
  }

  create(name: string, value: string, createdAt: string): void {
    this.db.prepare("INSERT INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)").run(name, value, createdAt);
  }
}
