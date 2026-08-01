import type { AdapterConfig, AdapterStatus, Workspace } from "@personahub/shared/types";
import { AdapterStatus as AS } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
import { sanitizeAuthStatusMessage } from "../runtime/trace/redaction.js";
import { AppError } from "../api/errors.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";

interface AdapterConfigValidatorDependencies {
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterRegistry: AgentAdapterRegistry;
  workspaceRepo: WorkspaceRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
  probeCoordinator: AdapterAvailabilityProbeCoordinator;
  getById: (id: string) => AdapterConfig;
}

export async function validateAdapterConfig(
  dependencies: AdapterConfigValidatorDependencies,
  id: string,
  workspaceId?: string,
): Promise<AdapterConfig> {
  const {
    agentConfigRepo,
    projectRepo,
    adapterRegistry,
    workspaceRepo,
    adapterWorkspaceStatusRepo,
    probeCoordinator,
    getById,
  } = dependencies;
  const existing = agentConfigRepo.getById(id);
  if (!existing) throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");

  let workspace: Workspace | null = null;
  if (workspaceId !== undefined) {
    workspace = workspaceRepo.getById(workspaceId);
    if (!workspace || workspace.project_id !== existing.project_id) {
      throw new AppError(ErrorCode.WORKSPACE_NOT_FOUND, "Workspace not found for this adapter's Project.");
    }
  }
  const scopedToWorkspace = workspace !== null;
  const probeScopeKey = scopedToWorkspace ? AdapterAvailabilityProbeCoordinator.scopedProbeKey(id, workspace!.id) : id;
  const snapshotConfigGeneration = probeCoordinator.getConfigGeneration(id);
  const myProbeGeneration = probeCoordinator.claimProbe(probeScopeKey);
  const overrideSnapshot = scopedToWorkspace ? adapterWorkspaceStatusRepo.get(id, workspace!.id) : null;
  const snapshotOverrideUpdatedAt = overrideSnapshot?.updated_at ?? null;
  const snapshotPushCredentialsEnabled = scopedToWorkspace ? workspace!.push_credentials_enabled : false;

  const project = projectRepo.getById(existing.project_id);
  const publicConfig = toPublicAdapter(existing, project?.default_adapter_config_id ?? null);
  const adapter = adapterRegistry.getForConfig(publicConfig);
  const result = await adapter.validate(publicConfig, existing.api_key, {
    pushCredentialsEnabled: snapshotPushCredentialsEnabled,
  });
  const status: AdapterStatus = result.available ? AS.Available : AS.Unavailable;
  const now = new Date().toISOString();
  const sanitizedMessage = sanitizeAuthStatusMessage(result.errorMessage, [existing.api_key]);

  const current = agentConfigRepo.getById(id);
  const configChanged = !current || probeCoordinator.getConfigGeneration(id) !== snapshotConfigGeneration;
  const supersededByNewerProbe = !probeCoordinator.isCurrentProbe(probeScopeKey, myProbeGeneration);
  if (configChanged || supersededByNewerProbe) {
    if (!current) return getById(id);
    const currentOverride = scopedToWorkspace ? adapterWorkspaceStatusRepo.get(id, workspace!.id) : null;
    return {
      ...toPublicAdapter(current, project?.default_adapter_config_id ?? null),
      status: scopedToWorkspace ? effectiveAdapterStatus(current, currentOverride) : current.status,
      last_checked_at: currentOverride?.last_checked_at ?? current.last_checked_at,
      auth_status_message: currentOverride?.auth_status_message ?? current.auth_status_message,
    };
  }

  if (scopedToWorkspace) {
    const currentWorkspace = workspaceRepo.getById(workspace!.id);
    const currentOverride = adapterWorkspaceStatusRepo.get(id, workspace!.id);
    const workspaceEnvChanged =
      !currentWorkspace || currentWorkspace.push_credentials_enabled !== snapshotPushCredentialsEnabled;
    const overrideChanged = (currentOverride?.updated_at ?? null) !== snapshotOverrideUpdatedAt;
    if (workspaceEnvChanged || overrideChanged) {
      return {
        ...toPublicAdapter(current, project?.default_adapter_config_id ?? null),
        status: effectiveAdapterStatus(current, currentOverride),
        last_checked_at: currentOverride?.last_checked_at ?? current.last_checked_at,
        auth_status_message: currentOverride?.auth_status_message ?? current.auth_status_message,
      };
    }

    if (status === current.status) {
      adapterWorkspaceStatusRepo.delete(id, workspace!.id);
    } else {
      adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: id,
        workspace_id: workspace!.id,
        status,
        last_checked_at: now,
        auth_status_message: sanitizedMessage,
      });
    }
    return {
      ...toPublicAdapter(current, project?.default_adapter_config_id ?? null),
      status,
      auth_status_message: sanitizedMessage,
      last_checked_at: now,
    };
  }

  agentConfigRepo.update(id, {
    status,
    last_checked_at: now,
    auth_status_message: sanitizedMessage,
    updated_at: now,
  });
  const record = agentConfigRepo.getById(id)!;
  return toPublicAdapter(record, project?.default_adapter_config_id ?? null);
}
