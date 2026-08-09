import type Database from "better-sqlite3";
import type { AdapterConfig, AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { AdapterStatus as AS, AdapterAuthType } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { deriveRole } from "../repositories/agent-config.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { NodeRunRepository } from "../repositories/node-run.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";
import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
import { AppError } from "../api/errors.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { isValidCliProvider } from "../runtime/provider-metadata.js";
import {
  type AdapterConfigCreateServiceInput,
  type AdapterConfigUpdateServiceInput,
  validateAuthState,
  validateCommand,
} from "./adapter-config-contract.js";
import { updateAdapterConfig } from "./adapter-config-updater.js";
import { validateAdapterConfig } from "./adapter-config-validator.js";

export type { AdapterConfigCreateServiceInput, AdapterConfigUpdateServiceInput } from "./adapter-config-contract.js";

export class AdapterConfigService {
  /** Tracked so shutdown can await background availability probes. */
  private pendingAvailabilityProbes = new Set<Promise<void>>();

  constructor(
    private agentConfigRepo: AgentConfigRepository,
    private projectRepo: ProjectRepository,
    private adapterRegistry: AgentAdapterRegistry,
    private workspaceRepo: WorkspaceRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private db: Database.Database,
    /** Shared with RunDispatchService so cross-service probe ordering is coherent. */
    private probeCoordinator: AdapterAvailabilityProbeCoordinator,
    private nodeRunRepo: NodeRunRepository,
  ) {}

  private trackAvailabilityProbe(probe: Promise<void>): void {
    this.pendingAvailabilityProbes.add(probe);
    void probe
      .catch((error) => {
        console.warn("[AdapterConfigService] auto-validate after create/update failed:", error);
      })
      .finally(() => {
        this.pendingAvailabilityProbes.delete(probe);
      });
  }

  /** Mirrors RunDispatchService.shutdown() — called from the same onClose hook. */
  async shutdown(timeoutMs = 5_000): Promise<void> {
    if (this.pendingAvailabilityProbes.size === 0) return;
    const pending = Promise.allSettled([...this.pendingAvailabilityProbes]);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([pending, timeout]);
  }

  healthSnapshot(): { pendingProbeCount: number } {
    return { pendingProbeCount: this.pendingAvailabilityProbes.size };
  }

  /** Probe first; assign the deferred default only if the original snapshot is still current. */
  private async autoValidateAfterCreate(
    adapterId: string,
    projectId: string,
    tryMakeDefault: boolean,
    defaultAtCreate: string | null,
  ): Promise<void> {
    let validated: AdapterConfig;
    try {
      validated = await this.validate(adapterId);
    } catch {
      return; // e.g. deleted mid-flight, or registry lookup failed — nothing to converge.
    }
    if (validated.status !== AS.Available) return;

    const project = this.projectRepo.getById(projectId);
    if (!project) return;
    if ((tryMakeDefault || defaultAtCreate === null) && project.default_adapter_config_id === defaultAtCreate) {
      this.projectRepo.setDefaultAdapter(projectId, adapterId);
    }
  }

  /** update()'s equivalent — no default-adapter logic (that's the separate, explicit setDefault()/PUT default-adapter endpoint). */
  private async autoValidateAfterUpdate(adapterId: string): Promise<void> {
    try {
      await this.validate(adapterId);
    } catch {
      // e.g. deleted mid-flight, or registry lookup failed — nothing to converge.
    }
  }

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
    // usable adapter, matching the historical single-role default. Only an
    // *omitted* field gets this compatibility default — an explicitly empty
    // array is a valid, meaningful state (design §7.2 rule 6: no capability
    // means consult-only, in any Issue status) and must be preserved as-is,
    // not silently upgraded to implementation.
    const capabilityTags: AgentCapability[] =
      input.capability_tags === undefined ? (["implementation"] as AgentCapability[]) : input.capability_tags;
    const role = deriveRole(capabilityTags);

    // AC-001 fix: a resolvable command is `Unknown`, never `Available` —
    // resolving to a real file proves the binary exists, not that its
    // account is logged in / its API key works. Only validate()'s real
    // provider probe (kicked off async below) may promote this to
    // Available.
    const validation = validateCommand(trimmedCommand);
    const status: AdapterStatus = validation.available ? AS.Unknown : AS.Unavailable;

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

    // Unknown never auto-becomes the Project default at creation time — see
    // autoValidateAfterCreate(), which applies design §4.1's "first
    // available adapter becomes default" / explicit make_default rule only
    // once a real probe actually confirms Available.
    if (status === AS.Unknown) {
      this.trackAvailabilityProbe(
        this.autoValidateAfterCreate(
          record.id,
          projectId,
          input.make_default === true,
          project.default_adapter_config_id,
        ),
      );
    }

    return toPublicAdapter(record, project.default_adapter_config_id);
  }

  /**
   * closure-check-report fix: `workspaceId` lets a caller ask "what does
   * this Project's adapters actually look like FROM this workspace" — the
   * missing half of the workspace-aware availability model, which until now
   * only affected `validate()`/routing/validator-selection server-side with
   * no way for the UI to observe it. Omitted: identical to the old
   * behavior (global-only DTOs, no `effective_*`/`has_workspace_override`
   * fields at all, so existing callers are unaffected). Provided but
   * invalid/cross-Project: `WORKSPACE_NOT_FOUND`, matching `validate()`'s
   * same distinction between "omitted" and "invalid" (never silently
   * degrades to the unscoped view).
   */
  list(projectId: string, workspaceId?: string): AdapterConfig[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }
    const records = this.agentConfigRepo.listByProject(projectId);

    if (workspaceId === undefined) {
      return records.map((r) => toPublicAdapter(r, project.default_adapter_config_id));
    }

    const workspace = this.workspaceRepo.getById(workspaceId);
    if (!workspace || workspace.project_id !== projectId) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for this Project.");
    }
    const overrideByAdapterId = new Map(
      this.adapterWorkspaceStatusRepo.listForWorkspace(workspaceId).map((o) => [o.adapter_config_id, o]),
    );
    return records.map((r) => {
      const override = overrideByAdapterId.get(r.id) ?? null;
      return {
        ...toPublicAdapter(r, project.default_adapter_config_id),
        effective_status: effectiveAdapterStatus(r, override),
        effective_last_checked_at: override?.last_checked_at ?? r.last_checked_at,
        effective_auth_status_message: override?.auth_status_message ?? r.auth_status_message,
        has_workspace_override: override !== null,
      };
    });
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
    const result = updateAdapterConfig(
      {
        db: this.db,
        agentConfigRepo: this.agentConfigRepo,
        projectRepo: this.projectRepo,
        adapterWorkspaceStatusRepo: this.adapterWorkspaceStatusRepo,
        probeCoordinator: this.probeCoordinator,
      },
      id,
      input,
    );
    if (result.shouldAutoValidate) {
      this.trackAvailabilityProbe(this.autoValidateAfterUpdate(id));
    }
    return result.adapter;
  }

  /**
   * design §9.2: adapter must belong to the same Project and be Available;
   * `adapterId: null` only succeeds when the Project has no adapters left —
   * a Project with adapters is never allowed to sit in an implicit,
   * unset-default state (that's a UX trap, not a valid configuration).
   */
  setDefault(projectId: string, adapterId: string | null): AdapterConfig | null {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new AppError(ErrorCode.PROJECT_NOT_FOUND, "Project not found.");
    }

    if (adapterId === null) {
      const existingAdapters = this.agentConfigRepo.listByProject(projectId);
      if (existingAdapters.length > 0) {
        throw new AppError(
          ErrorCode.ADAPTER_REQUIRED,
          "Cannot clear the default adapter while the Project still has adapters. Set a different default first.",
        );
      }
      this.projectRepo.clearDefaultAdapter(projectId);
      return null;
    }

    const result = this.projectRepo.setDefaultAdapter(projectId, adapterId);
    if (!result.success) {
      if (result.reason === "unavailable") {
        throw new AppError(ErrorCode.ADAPTER_UNAVAILABLE, "Adapter is not available.");
      }
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found for this project.");
    }

    const record = this.agentConfigRepo.getById(adapterId)!;
    return toPublicAdapter(record, adapterId);
  }

  delete(id: string): void {
    const existing = this.agentConfigRepo.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");
    }

    if (this.agentConfigRepo.hasRuns(id) || this.nodeRunRepo.hasAnyReference(id)) {
      throw new AppError(ErrorCode.ADAPTER_IN_USE, "Cannot delete adapter config referenced by runs or graph nodes.");
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
    }

    this.db.transaction(() => {
      if (isCurrentDefault) {
        // Only adapter left: allow delete, but clear the now-dangling default first.
        this.projectRepo.clearDefaultAdapter(existing.project_id);
      }
      // No ON DELETE CASCADE on adapter_workspace_status's FK — an adapter
      // with workspace overrides would otherwise fail this delete outright.
      this.adapterWorkspaceStatusRepo.deleteForAdapter(id);
      this.agentConfigRepo.delete(id);
    })();
    // closure-recheck-3-report fix: drop this adapter's generation entries
    // only after the delete transaction actually committed — a long-lived
    // server process would otherwise accumulate unbounded Map entries for
    // adapters that no longer exist (Low finding; not a correctness bug,
    // but an unbounded structure not worth leaving in place once noticed).
    this.probeCoordinator.forgetAdapter(id);
  }

  async validate(id: string, workspaceId?: string): Promise<AdapterConfig> {
    return validateAdapterConfig(
      {
        agentConfigRepo: this.agentConfigRepo,
        projectRepo: this.projectRepo,
        adapterRegistry: this.adapterRegistry,
        workspaceRepo: this.workspaceRepo,
        adapterWorkspaceStatusRepo: this.adapterWorkspaceStatusRepo,
        probeCoordinator: this.probeCoordinator,
        getById: (adapterId) => this.getById(adapterId),
      },
      id,
      workspaceId,
    );
  }
}
