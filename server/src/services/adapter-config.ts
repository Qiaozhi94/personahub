import { spawnSync } from "node:child_process";
import type { AdapterConfig, AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { AdapterStatus as AS, AdapterAuthType, CliProvider } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { deriveRole } from "../repositories/agent-config.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
import { AppError } from "../api/errors.js";
import {
  PROVIDER_SUPPORTED_AUTH_TYPES,
  isValidCliProvider,
  isKnownModelProvider,
} from "../runtime/provider-metadata.js";

export interface AdapterConfigCreateServiceInput {
  name: string;
  cli_provider: string;
  command: string;
  args?: string[];
  default_model?: string;
  auth_type?: AdapterAuthType;
  model_provider?: string;
  api_key?: string;
  capability_tags?: AgentCapability[];
  make_default?: boolean;
}

export interface AdapterConfigUpdateServiceInput {
  name?: string;
  command?: string;
  args?: string[];
  default_model?: string | null;
  auth_type?: AdapterAuthType;
  model_provider?: string | null;
  /** omitted preserves; null clears; non-empty string replaces; trimmed-empty is rejected. */
  api_key?: string | null;
  capability_tags?: AgentCapability[];
}

function validateCommand(command: string): { available: boolean; errorMessage: string | null } {
  if (!command || !command.trim()) {
    return { available: false, errorMessage: "Command is empty." };
  }
  try {
    const result = spawnSync(command, ["--version"], {
      timeout: 10_000,
      encoding: "utf-8",
      shell: process.platform === "win32",
    });
    if (result.error) {
      return { available: false, errorMessage: `Command not found: ${command}` };
    }
    if (result.status !== 0) {
      return { available: false, errorMessage: `Command exited with code ${result.status}` };
    }
    return { available: true, errorMessage: null };
  } catch (err) {
    return { available: false, errorMessage: `Failed to validate command: ${String(err)}` };
  }
}

/**
 * Validates the effective (post-merge) auth state for a given provider.
 * Shared by create (effective = input) and update (effective = existing
 * record merged with the requested changes) so the two paths can never
 * silently diverge on what "a valid auth configuration" means.
 */
function validateAuthState(
  cliProvider: string,
  authType: AdapterAuthType,
  modelProvider: string | null,
  defaultModel: string | null,
  hasApiKey: boolean,
): void {
  if (!isValidCliProvider(cliProvider)) {
    // Caller already checked provider support separately; this is defense-in-depth.
    throw new AppError(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED, `Unsupported provider: ${cliProvider}.`);
  }
  const supportedAuthTypes = PROVIDER_SUPPORTED_AUTH_TYPES[cliProvider];
  if (!supportedAuthTypes.includes(authType)) {
    throw new AppError(
      ErrorCode.ADAPTER_AUTH_INVALID,
      `Provider ${cliProvider} does not support auth_type=${authType}. Supported: ${supportedAuthTypes.join(", ")}.`,
      "auth_type",
    );
  }

  if (authType === AdapterAuthType.OAuth) {
    if (hasApiKey) {
      throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "OAuth adapters cannot also carry an api_key.", "api_key");
    }
    // design §6.4 (opencode-protocol-fixtures.md T005): omitting `-m
    // <provider>/<model>` lets OpenCode silently fall back to a free model
    // instead of failing — this is unrelated to auth_type, so OAuth-mode
    // OpenCode needs model_provider/default_model too, just without the
    // api-key allowlist restriction (any non-empty provider string; real
    // validity is confirmed by validate()'s actual probe call, not a
    // client-side enum).
    if (cliProvider === CliProvider.OpenCode) {
      if (!modelProvider) {
        throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "model_provider is required for opencode (needed to build -m provider/model).", "model_provider");
      }
      if (!defaultModel) {
        throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "default_model is required for opencode (needed to build -m provider/model).", "default_model");
      }
    }
    return;
  }

  // ApiKey mode (only reachable for providers that support it, e.g. opencode).
  if (!modelProvider) {
    throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "model_provider is required for API-key auth.", "model_provider");
  }
  if (!defaultModel) {
    throw new AppError(ErrorCode.ADAPTER_AUTH_INVALID, "default_model is required for API-key auth.", "default_model");
  }
  if (!hasApiKey) {
    throw new AppError(ErrorCode.ADAPTER_API_KEY_REQUIRED, "api_key is required for API-key auth.", "api_key");
  }
  if (!isKnownModelProvider(modelProvider)) {
    throw new AppError(
      ErrorCode.ADAPTER_MODEL_PROVIDER_UNSUPPORTED,
      `model_provider "${modelProvider}" is not a verified provider.`,
      "model_provider",
    );
  }
}

export class AdapterConfigService {
  constructor(
    private agentConfigRepo: AgentConfigRepository,
    private projectRepo: ProjectRepository,
    private adapterRegistry: AgentAdapterRegistry,
  ) {}

  create(projectId: string, input: AdapterConfigCreateServiceInput): AdapterConfig {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    const trimmedName = input.name?.trim();
    if (!trimmedName) {
      throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Adapter name is required.", "name");
    }

    if (!isValidCliProvider(input.cli_provider)) {
      throw new AppError(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED, `Unsupported provider: ${input.cli_provider}.`);
    }

    const trimmedCommand = input.command?.trim();
    if (!trimmedCommand) {
      throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command is required.", "command");
    }

    const authType = input.auth_type ?? AdapterAuthType.OAuth;
    const modelProvider = input.model_provider?.trim() || null;
    const defaultModel = input.default_model?.trim() || null;
    const apiKey = input.api_key?.trim() || null;

    validateAuthState(input.cli_provider, authType, modelProvider, defaultModel, apiKey !== null);

    // capability_tags defaults to [implementation] — F002/F004's create path
    // never leave this hardcoded empty; an omitted value must still produce a
    // usable adapter, matching the historical single-role default.
    const capabilityTags: AgentCapability[] = input.capability_tags && input.capability_tags.length > 0
      ? input.capability_tags
      : (["implementation"] as AgentCapability[]);
    const role = deriveRole(capabilityTags);

    const validation = validateCommand(trimmedCommand);
    const status: AdapterStatus = validation.available ? AS.Available : AS.Unavailable;

    const record = this.agentConfigRepo.create({
      project_id: projectId,
      name: trimmedName,
      role,
      cli_provider: input.cli_provider,
      command: trimmedCommand,
      args: input.args ?? [],
      capability_tags: capabilityTags,
      default_model: defaultModel,
      status,
      auth_type: authType,
      model_provider: modelProvider,
      api_key: apiKey,
      auth_status_message: null,
    });

    // First available adapter for a Project with no default becomes the
    // default automatically (design §4.1); later adapters never override an
    // already-set default — only an explicit set-default call can do that.
    let defaultAdapterConfigId = project.default_adapter_config_id;
    if (status === AS.Available && defaultAdapterConfigId === null) {
      const result = this.projectRepo.setDefaultAdapter(projectId, record.id);
      if (result.success) {
        defaultAdapterConfigId = record.id;
      }
    }

    return toPublicAdapter(record, defaultAdapterConfigId);
  }

  list(projectId: string): AdapterConfig[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    return this.agentConfigRepo.listByProject(projectId).map((r) => toPublicAdapter(r, project.default_adapter_config_id));
  }

  getById(id: string): AdapterConfig {
    const record = this.agentConfigRepo.getById(id);
    if (!record) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }
    const project = this.projectRepo.getById(record.project_id);
    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }

  update(id: string, input: AdapterConfigUpdateServiceInput): AdapterConfig {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const updates: {
      name?: string;
      role?: string;
      command?: string;
      args?: string[];
      default_model?: string | null;
      status?: AdapterStatus;
      last_checked_at?: string | null;
      auth_type?: AdapterAuthType;
      model_provider?: string | null;
      api_key?: string | null;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Adapter name cannot be empty.", "name");
      }
      updates.name = trimmed;
    }

    if (input.command !== undefined) {
      const trimmed = input.command.trim();
      if (!trimmed) {
        throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command cannot be empty.", "command");
      }
      updates.command = trimmed;
      const validation = validateCommand(trimmed);
      updates.status = validation.available ? AS.Available : AS.Unavailable;
      updates.last_checked_at = new Date().toISOString();
    }

    if (input.args !== undefined) {
      updates.args = input.args;
    }

    if (input.default_model !== undefined) {
      updates.default_model = input.default_model?.trim() || null;
    }

    if (input.capability_tags !== undefined) {
      updates.role = deriveRole(input.capability_tags);
    }

    // Resolve the effective api_key tri-state before touching auth_type, so
    // "switch auth_type oauth->api_key without a key" and "clear key while
    // staying in api_key mode" both surface as ADAPTER_API_KEY_REQUIRED via
    // the same validateAuthState() call below, not two different code paths.
    let effectiveApiKey = existing.api_key;
    if (input.api_key !== undefined) {
      if (input.api_key === null) {
        effectiveApiKey = null;
      } else {
        const trimmed = input.api_key.trim();
        if (!trimmed) {
          throw new AppError(ErrorCode.ADAPTER_API_KEY_REQUIRED, "api_key cannot be blank.", "api_key");
        }
        effectiveApiKey = trimmed;
      }
      updates.api_key = effectiveApiKey;
    }

    const effectiveAuthType = input.auth_type ?? existing.auth_type;
    // design §5.1: switching to oauth always clears a stale key, even if the
    // caller didn't separately pass api_key:null — no dangling secret survives
    // an auth-mode switch.
    if (input.auth_type !== undefined && input.auth_type === AdapterAuthType.OAuth) {
      effectiveApiKey = null;
      updates.api_key = null;
    }

    const effectiveModelProvider = input.model_provider !== undefined
      ? (input.model_provider?.trim() || null)
      : existing.model_provider;
    if (input.model_provider !== undefined) {
      updates.model_provider = effectiveModelProvider;
    }

    const effectiveDefaultModel = updates.default_model !== undefined ? updates.default_model : existing.default_model;

    const authRelatedFieldsTouched =
      input.auth_type !== undefined ||
      input.model_provider !== undefined ||
      input.api_key !== undefined ||
      input.default_model !== undefined;

    // design §4.2: explicitly clearing api_key (input.api_key === null) is a
    // deliberate degrade, not an error — "清空并令 API-key adapter
    // unavailable" — as long as the caller isn't ALSO actively choosing to
    // (re)enter api_key mode in the same call. Switching auth_type itself
    // still goes through the strict check below, same as create.
    const isExplicitKeyClearOnly = input.api_key === null && input.auth_type === undefined;

    if (authRelatedFieldsTouched && !isExplicitKeyClearOnly) {
      validateAuthState(existing.cli_provider, effectiveAuthType, effectiveModelProvider, effectiveDefaultModel, effectiveApiKey !== null);
    } else if (isExplicitKeyClearOnly && effectiveAuthType === AdapterAuthType.ApiKey) {
      // Key is gone but the adapter stays in api_key mode: it's now unusable
      // until a new key is set, but that is a status change, not a rejection.
      updates.status = AS.Unavailable;
      updates.last_checked_at = new Date().toISOString();
    }
    if (input.auth_type !== undefined) {
      updates.auth_type = effectiveAuthType;
    }

    this.agentConfigRepo.update(id, updates);
    const record = this.agentConfigRepo.getById(id)!;
    const project = this.projectRepo.getById(record.project_id);
    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }

  delete(id: string): void {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    if (this.agentConfigRepo.hasRuns(id)) {
      throw new AppError(ErrorCode.ADAPTER_IN_USE, "Cannot delete adapter config that has runs.");
    }

    const project = this.projectRepo.getById(existing.project_id);
    const isCurrentDefault = project?.default_adapter_config_id === id;
    if (isCurrentDefault) {
      const siblingCount = this.agentConfigRepo.listByProject(existing.project_id).length;
      if (siblingCount > 1) {
        throw new AppError(
          ErrorCode.ADAPTER_IN_USE,
          "Cannot delete the Project's default adapter while other adapters exist. Set a different default first.",
        );
      }
      // Only adapter left: allow delete, but clear the now-dangling default first.
      this.projectRepo.clearDefaultAdapter(existing.project_id);
    }

    this.agentConfigRepo.delete(id);
  }

  /**
   * T034: delegates to the registered adapter's own `validate()` — never a
   * hardcoded `--version` check. This is what lets each provider's real auth
   * probe (e.g. Claude's `auth status`, confirmed non-equivalent to
   * `--version` in Phase 1) actually determine availability.
   */
  async validate(id: string): Promise<AdapterConfig> {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const project = this.projectRepo.getById(existing.project_id);
    const publicConfig = toPublicAdapter(existing, project?.default_adapter_config_id ?? null);
    const adapter = this.adapterRegistry.getForConfig(publicConfig);
    const result = await adapter.validate(publicConfig, existing.api_key);

    const status: AdapterStatus = result.available ? AS.Available : AS.Unavailable;
    const now = new Date().toISOString();

    this.agentConfigRepo.update(id, {
      status,
      last_checked_at: now,
      auth_status_message: result.errorMessage,
      updated_at: now,
    });

    const record = this.agentConfigRepo.getById(id)!;
    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }
}
