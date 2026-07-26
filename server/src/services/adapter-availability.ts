import { AdapterStatus, type AgentCapability } from "@personahub/shared/types";
import type { AgentConfigRecord } from "../repositories/agent-config.js";
import { hasCapability } from "../repositories/agent-config.js";
import type { AdapterWorkspaceStatusRecord } from "../repositories/adapter-workspace-status.js";

/**
 * Single place that merges the Project-global baseline with a workspace
 * override (schema v7) — every availability check (resolver, validator
 * selector, explicit manual pick) must go through this, not compare
 * `record.status` directly, or a workspace-specific exception silently
 * stops applying in whichever call site forgot to check it.
 */
export function effectiveAdapterStatus(
  record: { status: AdapterStatus },
  override: AdapterWorkspaceStatusRecord | null,
): AdapterStatus {
  return override?.status ?? record.status;
}

/**
 * Workspace-aware equivalent of `AgentConfigRepository.
 * listAvailableByProjectAndCapability()` — same capability filter and
 * deterministic (created_at, id) sort, but availability is resolved via
 * `effectiveAdapterStatus()` against the target workspace's overrides
 * instead of the raw global `status` column. `candidates` should be every
 * adapter in the Project (unfiltered by status) so an adapter that's
 * globally Unknown/Unavailable but has a workspace-specific Available
 * override isn't excluded before this function ever sees it.
 */
export function listAvailableByCapabilityForWorkspace(
  candidates: AgentConfigRecord[],
  overrides: AdapterWorkspaceStatusRecord[],
  capability: AgentCapability,
): AgentConfigRecord[] {
  const overrideByAdapterId = new Map(overrides.map((o) => [o.adapter_config_id, o]));
  return candidates
    .filter((c) => hasCapability(c, capability))
    .filter((c) => effectiveAdapterStatus(c, overrideByAdapterId.get(c.id) ?? null) === AdapterStatus.Available)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
}
