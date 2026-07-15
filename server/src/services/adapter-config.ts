import { spawnSync } from "node:child_process";
import type { AdapterConfig, AdapterStatus } from "@personahub/shared/types";
import { AdapterStatus as AS } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ProjectRepository } from "../repositories/project.js";
import { AppError } from "../api/errors.js";

const VALID_PROVIDERS = new Set(["codex"]);

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

    if (!VALID_PROVIDERS.has(input.cli_provider)) {
      throw new AppError(ErrorCode.ADAPTER_PROVIDER_UNSUPPORTED, `Unsupported provider: ${input.cli_provider}. Supported: codex.`);
    }

    const trimmedCommand = input.command?.trim();
    if (!trimmedCommand) {
      throw new AppError(ErrorCode.ADAPTER_COMMAND_REQUIRED, "Command is required.", "command");
    }

    const validation = validateCommand(trimmedCommand);
    const status: AdapterStatus = validation.available ? AS.Available : AS.Unavailable;

    return this.agentConfigRepo.create({
      project_id: projectId,
      name: trimmedName,
      role: input.role ?? "implementation",
      cli_provider: input.cli_provider,
      command: trimmedCommand,
      args: input.args ?? [],
      capability_tags: [],
      default_model: input.default_model ?? null,
      status,
    });
  }

  list(projectId: string): AdapterConfig[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    return this.agentConfigRepo.listByProject(projectId);
  }

  getById(id: string): AdapterConfig {
    const adapter = this.agentConfigRepo.getById(id);
    if (!adapter) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }
    return adapter;
  }

  update(id: string, input: AdapterConfigUpdateServiceInput): AdapterConfig {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    const updates: {
      name?: string;
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
    return this.agentConfigRepo.getById(id)!;
  }

  delete(id: string): void {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    if (this.agentConfigRepo.hasRuns(id)) {
      throw new AppError(ErrorCode.ADAPTER_IN_USE, "Cannot delete adapter config that has runs.");
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

    return this.agentConfigRepo.getById(id)!;
  }
}
