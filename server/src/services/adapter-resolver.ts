import { AdapterStatus, RunDispatchSource } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { ProjectRepository } from "../repositories/project.js";

/**
 * design §7.1: resolves which adapter config a Run should use — explicit ID
 * (must belong to the same Project and be available) or the Project's
 * persisted default (must be available). Never falls back to "first
 * available adapter in the list" — an unresolvable default is a hard error
 * (`DEFAULT_ADAPTER_UNAVAILABLE`), not a silently-guessed adapter.
 */
export type AdapterResolveResult =
  | { ok: true; adapterConfigId: string; source: RunDispatchSource }
  | { ok: false; errorCode: ErrorCode };

export interface AdapterResolverDeps {
  agentConfigRepo: AgentConfigRepository;
  projectRepo: ProjectRepository;
}

export function resolveAdapter(
  deps: AdapterResolverDeps,
  projectId: string,
  explicitAdapterId?: string | null,
): AdapterResolveResult {
  if (explicitAdapterId) {
    const adapter = deps.agentConfigRepo.getById(explicitAdapterId);
    if (!adapter || adapter.project_id !== projectId) {
      return { ok: false, errorCode: ErrorCode.ADAPTER_NOT_FOUND };
    }
    if (adapter.status !== AdapterStatus.Available) {
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
  if (!adapter || adapter.status !== AdapterStatus.Available) {
    return { ok: false, errorCode: ErrorCode.DEFAULT_ADAPTER_UNAVAILABLE };
  }
  return { ok: true, adapterConfigId: adapter.id, source: RunDispatchSource.UserDefault };
}
