import type { AdapterConfig } from "@personahub/shared/types";
import type { AgentConfigRecord } from "./agent-config.js";

/**
 * T020: explicit secret-safe DTO builder. Every field is listed by name —
 * deliberately NOT `{...record, api_key: undefined}` (design §4.2 forbids that
 * pattern): a spread silently re-leaks any new secret-bearing field added to
 * AgentConfigRecord later, whereas this explicit form fails to compile until
 * someone consciously decides what the new field's public projection should be.
 *
 * `defaultAdapterConfigId` is the caller's Project.default_adapter_config_id —
 * `is_default` is never a column on agent_configs (design §4.1), so it cannot
 * be derived from the record alone.
 */
export function toPublicAdapter(record: AgentConfigRecord, defaultAdapterConfigId: string | null): AdapterConfig {
  return {
    id: record.id,
    project_id: record.project_id,
    name: record.name,
    role: record.role,
    cli_provider: record.cli_provider,
    command: record.command,
    args: record.args,
    capability_tags: record.capability_tags,
    default_model: record.default_model,
    status: record.status,
    last_checked_at: record.last_checked_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
    auth_type: record.auth_type,
    model_provider: record.model_provider,
    has_api_key: record.api_key !== null,
    auth_status_message: record.auth_status_message,
    is_default: record.id === defaultAdapterConfigId,
  };
}
