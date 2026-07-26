import { AdapterStatus, RunDispatchSource } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ProjectRepository } from "../repositories/project.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";

/**
 * design §7.1: resolves which adapter config a Run should use — explicit ID
 * (must belong to the same Project and be available) or the Project's
 * persisted default (must be available). Never falls back to "first
 * available adapter in the list" — an unresolvable default is a hard error
 * (`DEFAULT_ADAPTER_UNAVAILABLE`), not a silently-guessed adapter.
 *
 * "Available" is resolved for the target `workspaceId` via
 * `effectiveAdapterStatus()` (global status + any workspace override, see
 * schema v7 / adapter-availability.ts) — not the raw global `status` column
 * — so a Project-global Unknown adapter that's confirmed Available in this
 * specific workspace is still routable, and a workspace-specific failure
 * doesn't silently disable the adapter for the Project's other workspaces.
 */
export type AdapterResolveResult =
  | { ok: true; adapterConfigId: string; source: RunDispatchSource }
  | { ok: false; errorCode: ErrorCode };

export interface AdapterResolverDeps {
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
  adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository;
}

export function resolveAdapter(
  deps: AdapterResolverDeps,
  projectId: string,
  workspaceId: string,
  explicitAdapterId?: string | null,
): AdapterResolveResult {
  if (explicitAdapterId) {
    const adapter = deps.agentConfigRepo.getById(explicitAdapterId);
    if (!adapter || adapter.project_id !== projectId) {
      return { ok: false, errorCode: ErrorCode.ADAPTER_NOT_FOUND };
    }
    const override = deps.adapterWorkspaceStatusRepo.get(adapter.id, workspaceId);
    if (effectiveAdapterStatus(adapter, override) !== AdapterStatus.Available) {
      return { ok: false, errorCode: ErrorCode.ADAPTER_UNAVAILABLE };
    }
    return { ok: true, adapterConfigId: adapter.id, source: RunDispatchSource.UserExplicit };
  }

  const project = deps.projectRepo.getById(projectId);
  const defaultAdapterConfigId = project?.default_adapter_config_id ?? null;
  if (!defaultAdapterConfigId) {
    return { ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE };
  }

  const adapter = deps.agentConfigRepo.getById(defaultAdapterConfigId);
  if (!adapter) {
    return { ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE };
  }
  const override = deps.adapterWorkspaceStatusRepo.get(adapter.id, workspaceId);
  if (effectiveAdapterStatus(adapter, override) !== AdapterStatus.Available) {
    return { ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE };
  }
  return { ok: true, adapterConfigId: adapter.id, source: RunDispatchSource.UserDefault };
}
