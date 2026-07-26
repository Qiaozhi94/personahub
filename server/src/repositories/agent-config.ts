import type Database from "better-sqlite3";
import type { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { AdapterStatus as AS, AdapterAuthType, AgentCapability as AC } from "@personahub/shared/types";
import { generateAdapterConfigId } from "../id.js";

/**
 * Pure capability check, shared by manual routing (Phase 7) and the automatic
 * ValidatorSelector (T028) — one true-source function, not two independently
 * maintained checks. Only ever reads the already-parsed `capability_tags`
 * array; never falls back to the deprecated `role` column.
 */
export function hasCapability(record: { capability_tags: AgentCapability[] }, capability: AgentCapability): boolean {
  return record.capability_tags.includes(capability);
}

/**
 * design §4.1: `agent_configs.role` is a deprecated internal field kept only
 * to satisfy the column's NOT NULL constraint (and for legacy display). It is
 * derived deterministically from `capability_tags` and never the other way
 * around — this function must be the only place that writes it.
 */
export function deriveRole(capabilityTags: AgentCapability[]): string {
  return capabilityTags.includes(AC.Validator) ? "validator" : "implementation";
}

/**
 * Internal record — carries the raw api_key. This is the ONLY layer allowed
 * to see it; the public AdapterConfig DTO (see toPublicAdapter, T019/T020)
 * strips it before anything crosses the service boundary. Never return this
 * type from a route.
 */
export interface AgentConfigRecord {
  id: string;
  project_id: string;
  name: string;
  role: string;
  cli_provider: string;
  command: string;
  args: string[];
  capability_tags: AgentCapability[];
  default_model: string | null;
  status: AdapterStatus;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  auth_type: AdapterAuthType;
  model_provider: string | null;
  api_key: string | null;
  auth_status_message: string | null;
}

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
  auth_type?: AdapterAuthType;
  model_provider?: string | null;
  api_key?: string | null;
  auth_status_message?: string | null;
}

export interface AdapterConfigUpdateInput {
  name?: string;
  role?: string;
  command?: string;
  args?: string[];
  capability_tags?: AgentCapability[];
  default_model?: string | null;
  status?: AdapterStatus;
  last_checked_at?: string | null;
  auth_type?: AdapterAuthType;
  model_provider?: string | null;
  /** omitted preserves; null clears; non-empty string replaces. */
  api_key?: string | null;
  auth_status_message?: string | null;
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
  auth_type: string;
  model_provider: string | null;
  api_key: string | null;
  auth_status_message: string | null;
}

/**
 * Parses capability_tags defensively: invalid JSON or a non-array value is
 * treated as "no known capability", never guessed. Callers must force the
 * adapter unavailable in this case (design §4.1 "Repository解析非法JSON时将
 * adapter标 unavailable，不猜能力") — reflected here via `parseFailed`.
 */
function parseCapabilityTags(raw: string): { tags: AgentCapability[]; parseFailed: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tags: [], parseFailed: true };
  }
  if (!Array.isArray(parsed)) {
    return { tags: [], parseFailed: true };
  }
  return { tags: parsed as AgentCapability[], parseFailed: false };
}

function mapRow(row: AdapterConfigRow): AgentConfigRecord {
  const { tags, parseFailed } = parseCapabilityTags(row.capability_tags ?? "[]");
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    role: row.role,
    cli_provider: row.cli_provider,
    command: row.command,
    args: JSON.parse(row.args ?? "[]") as string[],
    capability_tags: tags,
    default_model: row.default_model,
    status: parseFailed ? AS.Unavailable : (row.status as AdapterStatus),
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    auth_type: row.auth_type as AdapterAuthType,
    model_provider: row.model_provider,
    api_key: row.api_key,
    auth_status_message: row.auth_status_message,
  };
}

export class AgentConfigRepository {
  constructor(private db: Database.Database) {}

  create(input: AdapterConfigCreateInput): AgentConfigRecord {
    const id = generateAdapterConfigId();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, default_model, status, last_checked_at, created_at, updated_at, auth_type, model_provider, api_key, auth_status_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.project_id, input.name, input.role, input.cli_provider,
      input.command, JSON.stringify(input.args), JSON.stringify(input.capability_tags),
      input.default_model, input.status, now, now,
      input.auth_type ?? AdapterAuthType.OAuth, input.model_provider ?? null,
      input.api_key ?? null, input.auth_status_message ?? null,
    );

    const row = this.db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as AdapterConfigRow;
    return mapRow(row);
  }

  getById(id: string): AgentConfigRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as AdapterConfigRow | undefined;
    return row ? mapRow(row) : null;
  }

  listByProject(projectId: string): AgentConfigRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM agent_configs WHERE project_id = ? ORDER BY created_at ASC"
    ).all(projectId) as AdapterConfigRow[];
    return rows.map(mapRow);
  }

  /**
   * F005: replaces the deleted `listAvailableByProjectAndRole()`.
   * `capability_tags` is the single source of truth for routing/selection
   * (design §6.1) — filtering happens in JS against already-parsed records,
   * not via a SQL JSON1 containment query, because a malformed
   * `capability_tags` value must degrade to "no capability" (T017) rather
   * than throw a SQL error out of `json_each()`.
   */
  listAvailableByProjectAndCapability(projectId: string, capability: AgentCapability): AgentConfigRecord[] {
    return this.listByProject(projectId)
      .filter((record) => record.status === AS.Available && hasCapability(record, capability))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }

  update(id: string, input: AdapterConfigUpdateInput): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { sets.push("name = ?"); values.push(input.name); }
    if (input.role !== undefined) { sets.push("role = ?"); values.push(input.role); }
    if (input.command !== undefined) { sets.push("command = ?"); values.push(input.command); }
    if (input.args !== undefined) { sets.push("args = ?"); values.push(JSON.stringify(input.args)); }
    if (input.capability_tags !== undefined) { sets.push("capability_tags = ?"); values.push(JSON.stringify(input.capability_tags)); }
    if (input.default_model !== undefined) { sets.push("default_model = ?"); values.push(input.default_model); }
    if (input.status !== undefined) { sets.push("status = ?"); values.push(input.status); }
    if (input.last_checked_at !== undefined) { sets.push("last_checked_at = ?"); values.push(input.last_checked_at); }
    if (input.auth_type !== undefined) { sets.push("auth_type = ?"); values.push(input.auth_type); }
    if (input.model_provider !== undefined) { sets.push("model_provider = ?"); values.push(input.model_provider); }
    if (input.api_key !== undefined) { sets.push("api_key = ?"); values.push(input.api_key); }
    if (input.auth_status_message !== undefined) { sets.push("auth_status_message = ?"); values.push(input.auth_status_message); }
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
