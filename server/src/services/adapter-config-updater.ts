import type Database from "better-sqlite3";
import type { AdapterConfig, AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { AdapterAuthType, AdapterStatus as AS } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { deriveRole } from "../repositories/agent-config.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import { AppError } from "../api/errors.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";
import { type AdapterConfigUpdateServiceInput, validateAuthState, validateCommand } from "./adapter-config-contract.js";

interface AdapterConfigUpdaterDependencies {
  db: Database.Database;
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  probeCoordinator: AdapterAvailabilityProbeCoordinator;
}

export interface AdapterConfigUpdateResult {
  adapter: AdapterConfig;
  shouldAutoValidate: boolean;
}

export function updateAdapterConfig(
  dependencies: AdapterConfigUpdaterDependencies,
  id: string,
  input: AdapterConfigUpdateServiceInput,
): AdapterConfigUpdateResult {
  const { db, agentConfigRepo, projectRepo, adapterWorkspaceStatusRepo, probeCoordinator } = dependencies;
  const existing = agentConfigRepo.getById(id);
  if (!existing) {
    throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
  }

  const updates: {
    name?: string;
    role?: string;
    command?: string;
    args?: string[];
    capability_tags?: AgentCapability[];
    default_model?: string | null;
    status?: AdapterStatus;
    last_checked_at?: string | null;
    auth_status_message?: string | null;
    auth_type?: AdapterAuthType;
    model_provider?: string | null;
    api_key?: string | null;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Adapter name cannot be empty.", "name");
    updates.name = trimmed;
  }

  let effectiveCommand = existing.command;
  if (input.command !== undefined) {
    const trimmed = input.command.trim();
    if (!trimmed) throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command cannot be empty.", "command");
    updates.command = trimmed;
    effectiveCommand = trimmed;
  }
  if (input.args !== undefined) updates.args = input.args;
  if (input.default_model !== undefined) updates.default_model = input.default_model?.trim() || null;
  if (input.capability_tags !== undefined) {
    updates.capability_tags = input.capability_tags;
    updates.role = deriveRole(input.capability_tags);
  }

  let effectiveApiKey = existing.api_key;
  if (input.api_key !== undefined) {
    if (input.api_key === null) {
      effectiveApiKey = null;
    } else {
      const trimmed = input.api_key.trim();
      if (!trimmed) throw new AppError(ErrorCode.ADAPTER_API_KEY_REQUIRED, "api_key cannot be blank.", "api_key");
      effectiveApiKey = trimmed;
    }
    updates.api_key = effectiveApiKey;
  }

  const effectiveAuthType = input.auth_type ?? existing.auth_type;
  if (input.auth_type === AdapterAuthType.OAuth) {
    effectiveApiKey = null;
    updates.api_key = null;
  }
  const effectiveModelProvider =
    input.model_provider !== undefined ? input.model_provider?.trim() || null : existing.model_provider;
  if (input.model_provider !== undefined) updates.model_provider = effectiveModelProvider;
  const effectiveDefaultModel = updates.default_model !== undefined ? updates.default_model : existing.default_model;

  const authRelatedFieldsTouched =
    input.auth_type !== undefined ||
    input.model_provider !== undefined ||
    input.api_key !== undefined ||
    input.default_model !== undefined;
  const isExplicitKeyClearOnly = input.api_key === null && input.auth_type === undefined;
  if (authRelatedFieldsTouched && !isExplicitKeyClearOnly) {
    validateAuthState(
      existing.cli_provider,
      effectiveAuthType,
      effectiveModelProvider,
      effectiveDefaultModel,
      effectiveApiKey !== null,
    );
  }
  if (input.auth_type !== undefined) updates.auth_type = effectiveAuthType;

  const availabilityRelevantFieldsTouched =
    input.command !== undefined ||
    input.args !== undefined ||
    input.auth_type !== undefined ||
    input.api_key !== undefined ||
    input.model_provider !== undefined ||
    input.default_model !== undefined;

  if (isExplicitKeyClearOnly && effectiveAuthType === AdapterAuthType.ApiKey) {
    updates.status = AS.Unavailable;
    updates.last_checked_at = new Date().toISOString();
  } else if (availabilityRelevantFieldsTouched) {
    const resolution = validateCommand(effectiveCommand);
    updates.status = resolution.available ? AS.Unknown : AS.Unavailable;
    updates.last_checked_at = null;
    updates.auth_status_message = null;
  }

  db.transaction(() => {
    agentConfigRepo.update(id, updates);
    if (availabilityRelevantFieldsTouched) adapterWorkspaceStatusRepo.deleteForAdapter(id);
  })();
  if (availabilityRelevantFieldsTouched) probeCoordinator.invalidateAdapter(id);

  const record = agentConfigRepo.getById(id)!;
  const project = projectRepo.getById(record.project_id);
  return {
    adapter: toPublicAdapter(record, project?.default_adapter_config_id ?? null),
    shouldAutoValidate: updates.status === AS.Unknown,
  };
}
