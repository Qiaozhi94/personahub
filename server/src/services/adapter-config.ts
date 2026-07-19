import { spawnSync } from "node:child_process";
import type { AdapterConfig, AdapterStatus } from "@personahub/shared/types";
import { AdapterStatus as AS } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import type { ProjectRepository } from "../repositories/project.js";
import { AppError } from "../api/errors.js";

const VALID_PROVIDERS = new Set(["codex"]);
const VALID_ROLES = new Set(["implementation", "validator"]);

export interface AdapterConfigCreateServiceInput {
  name: string;
  role?: string;
  cli_provider: string;
  command: string;
  args?: string[];
  default_model?: string;
}

export interface AdapterConfigUpdateServiceInput {
  name?: string;
  role?: string;
  command?: string;
  args?: string[];
  default_model?: string | null;
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

export class AdapterConfigService {
  constructor(
    private agentConfigRepo: AgentConfigRepository,
    private projectRepo: ProjectRepository,
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

    const role = input.role ?? "implementation";
    if (!VALID_ROLES.has(role)) {
      throw new AppError(ErrorCode.ADAPTER_ROLE_INVALID, `Invalid adapter role: ${role}. Allowed: implementation, validator.`, "role");
    }

    if (!VALID_PROVIDERS.has(input.cli_provider)) {
      throw new AppError(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED, `Unsupported provider: ${input.cli_provider}. Supported: codex.`);
    }

    const trimmedCommand = input.command?.trim();
    if (!trimmedCommand) {
      throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command is required.", "command");
    }

    const validation = validateCommand(trimmedCommand);
    const status: AdapterStatus = validation.available ? AS.Available : AS.Unavailable;

    const record = this.agentConfigRepo.create({
      project_id: projectId,
      name: trimmedName,
      role,
      cli_provider: input.cli_provider,
      command: trimmedCommand,
      args: input.args ?? [],
      capability_tags: [],
      default_model: input.default_model ?? null,
      status,
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
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Adapter name cannot be empty.", "name");
      }
      updates.name = trimmed;
    }

    if (input.role !== undefined) {
      if (!VALID_ROLES.has(input.role)) {
        throw new AppError(ErrorCode.ADAPTER_ROLE_INVALID, `Invalid adapter role: ${input.role}. Allowed: implementation, validator.`, "role");
      }
      updates.role = input.role;
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
      updates.default_model = input.default_model;
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

  validate(id: string): AdapterConfig {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const validation = validateCommand(existing.command);
    const status: AdapterStatus = validation.available ? AS.Available : AS.Unavailable;
    const now = new Date().toISOString();

    this.agentConfigRepo.update(id, {
      status,
      last_checked_at: now,
      updated_at: now,
    });

    const record = this.agentConfigRepo.getById(id)!;
    const project = this.projectRepo.getById(record.project_id);
    return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
  }
}
