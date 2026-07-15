import type Database from "better-sqlite3";
import type { AdapterConfig, AdapterStatus } from "@personahub/shared/types";
import { generateAdapterConfigId } from "../id.js";

export interface AdapterConfigCreateInput {
  project_id: string;
  name: string;
  role: string;
  cli_provider: string;
  command: string;
  args: string[];
  capability_tags: string[];
  default_model: string | null;
  status: AdapterStatus;
}

export interface AdapterConfigUpdateInput {
  name?: string;
  command?: string;
  args?: string[];
  default_model?: string | null;
  status?: AdapterStatus;
  last_checked_at?: string | null;
  updated_at: string;
}

interface AdapterConfigRow {
  id: string;
  project_id: string;
  name: string;
  role: string;
  cli_provider: string;
  command: string;
  args: string;
  capability_tags: string;
  default_model: string | null;
  status: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: AdapterConfigRow): AdapterConfig {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    role: row.role,
    cli_provider: row.cli_provider,
    command: row.command,
    args: JSON.parse(row.args ?? "[]") as string[],
    capability_tags: JSON.parse(row.capability_tags ?? "[]") as string[],
    default_model: row.default_model,
    status: row.status as AdapterStatus,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AgentConfigRepository {
  constructor(private db: Database.Database) {}

  create(input: AdapterConfigCreateInput): AdapterConfig {
    const id = generateAdapterConfigId();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, default_model, status, last_checked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      id, input.project_id, input.name, input.role, input.cli_provider,
      input.command, JSON.stringify(input.args), JSON.stringify(input.capability_tags),
      input.default_model, input.status, now, now,
    );

    const row = this.db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as AdapterConfigRow;
    return mapRow(row);
  }

  getById(id: string): AdapterConfig | null {
    const row = this.db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as AdapterConfigRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByProject(projectId: string): AdapterConfig[] {
    const rows = this.db.prepare(
      "SELECT * FROM agent_configs WHERE project_id = ? ORDER BY created_at ASC"
    ).all(projectId) as AdapterConfigRow[];
    return rows.map(mapRow);
  }

  update(id: string, input: AdapterConfigUpdateInput): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { sets.push("name = ?"); values.push(input.name); }
    if (input.command !== undefined) { sets.push("command = ?"); values.push(input.command); }
    if (input.args !== undefined) { sets.push("args = ?"); values.push(JSON.stringify(input.args)); }
    if (input.default_model !== undefined) { sets.push("default_model = ?"); values.push(input.default_model); }
    if (input.status !== undefined) { sets.push("status = ?"); values.push(input.status); }
    if (input.last_checked_at !== undefined) { sets.push("last_checked_at = ?"); values.push(input.last_checked_at); }
    sets.push("updated_at = ?"); values.push(input.updated_at);
    values.push(id);

    this.db.prepare(`UPDATE agent_configs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM agent_configs WHERE id = ?").run(id);
  }

  hasRuns(id: string): boolean {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM runs WHERE adapter_config_id = ?"
    ).get(id) as { count: number };
    return row.count > 0;
  }
}
