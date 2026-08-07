import type { AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { resolveAdapter } from "./adapter-resolver.js";
import { hasCapability } from "../repositories/agent-config.js";
import type { AdapterResolverDeps } from "./adapter-resolver.js";
import type { RunDispatchSource } from "@personahub/shared/types";

export interface EligibleAdapterInput {
  explicitAdapterId?: string | null;
  requiredCapabilities: AgentCapability[];
}

export type EligibleAdapterResult =
  | { ok: true; adapterConfigId: string; source: RunDispatchSource }
  | { ok: false; errorCode: ErrorCode };

export function resolveEligibleAdapter(
  deps: AdapterResolverDeps,
  projectId: string,
  workspaceId: string,
  input: EligibleAdapterInput,
): EligibleAdapterResult {
  const result = resolveAdapter(deps, projectId, workspaceId, input.explicitAdapterId);
  if (!result.ok) return result;

  const adapter = deps.agentConfigRepo.getById(result.adapterConfigId);
  if (!adapter) {
    return { ok: false, errorCode: ErrorCode.ADAPTER_NOT_FOUND };
  }

  for (const cap of input.requiredCapabilities) {
    if (!hasCapability(adapter, cap)) {
      return { ok: false, errorCode: ErrorCode.ADAPTER_CAPABILITY_MISSING };
    }
  }

  return { ok: true, adapterConfigId: result.adapterConfigId, source: result.source };
}
