import { AdapterStatus as AS, FailureReason as FR, RunStatus as RS } from "@personahub/shared/types";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import type { AdapterWorkspaceStatusRepository } from "../repositories/adapter-workspace-status.js";
import type { RunRepository } from "../repositories/run.js";
import type { WorkspaceRepository } from "../repositories/workspace.js";
import type { AgentAdapterRegistry } from "../runtime/adapter-registry.js";
import { toPublicAdapter } from "../repositories/agent-config-dto.js";
import { sanitizeAuthStatusMessage } from "../runtime/trace/redaction.js";
import { effectiveAdapterStatus } from "./adapter-availability.js";
import { AdapterAvailabilityProbeCoordinator } from "./adapter-probe-coordinator.js";

export class AdapterFailureReprobe {
  private pending = new Set<Promise<void>>();

  constructor(
    private runRepo: RunRepository,
    private agentConfigRepo: AgentConfigRepository,
    private workspaceRepo: WorkspaceRepository,
    private adapterWorkspaceStatusRepo: AdapterWorkspaceStatusRepository,
    private adapterRegistry: AgentAdapterRegistry,
    private probeCoordinator: AdapterAvailabilityProbeCoordinator,
  ) {}

  trigger(runId: string): void {
    const probe = this.reprobe(runId);
    this.pending.add(probe);
    void probe
      .catch((error) => {
        console.warn(`[RunDispatchService] adapter availability re-probe failed for run ${runId}:`, error);
      })
      .finally(() => this.pending.delete(probe));
  }

  async shutdown(timeoutMs = 5_000): Promise<void> {
    if (this.pending.size === 0) return;
    const settled = Promise.allSettled([...this.pending]);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([settled, timeout]);
  }

  healthSnapshot(): { pendingReprobeCount: number } {
    return { pendingReprobeCount: this.pending.size };
  }

  private async reprobe(runId: string): Promise<void> {
    const run = this.runRepo.getById(runId);
    if (!run || run.status !== RS.Failed) return;
    if (run.failure_reason !== FR.AdapterExitNonzero && run.failure_reason !== FR.SpawnFailed) return;

    const record = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!record) return;
    const override = this.adapterWorkspaceStatusRepo.get(run.adapter_config_id, run.workspace_id);
    if (effectiveAdapterStatus(record, override) !== AS.Available) return;

    const snapshotConfigGeneration = this.probeCoordinator.getConfigGeneration(run.adapter_config_id);
    const probeScopeKey = AdapterAvailabilityProbeCoordinator.scopedProbeKey(run.adapter_config_id, run.workspace_id);
    const myProbeGeneration = this.probeCoordinator.claimProbe(probeScopeKey);
    const snapshotOverrideUpdatedAt = override?.updated_at ?? null;
    const workspace = this.workspaceRepo.getById(run.workspace_id);
    const snapshotPushCredentialsEnabled = workspace?.push_credentials_enabled ?? false;

    const publicConfig = toPublicAdapter(record, null);
    const adapter = this.adapterRegistry.getForConfig(publicConfig);
    const result = await adapter.validate(publicConfig, record.api_key, {
      pushCredentialsEnabled: snapshotPushCredentialsEnabled,
    });
    if (result.available) return;

    const current = this.agentConfigRepo.getById(run.adapter_config_id);
    if (!current || this.probeCoordinator.getConfigGeneration(run.adapter_config_id) !== snapshotConfigGeneration)
      return;
    if (!this.probeCoordinator.isCurrentProbe(probeScopeKey, myProbeGeneration)) return;
    const currentWorkspace = this.workspaceRepo.getById(run.workspace_id);
    if (!currentWorkspace || currentWorkspace.push_credentials_enabled !== snapshotPushCredentialsEnabled) return;
    const currentOverride = this.adapterWorkspaceStatusRepo.get(run.adapter_config_id, run.workspace_id);
    if ((currentOverride?.updated_at ?? null) !== snapshotOverrideUpdatedAt) return;

    const now = new Date().toISOString();
    this.adapterWorkspaceStatusRepo.upsert({
      adapter_config_id: run.adapter_config_id,
      workspace_id: run.workspace_id,
      status: AS.Unavailable,
      last_checked_at: now,
      auth_status_message: sanitizeAuthStatusMessage(result.errorMessage, [record.api_key]),
    });
  }
}
