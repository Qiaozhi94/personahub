/**
 * closure-recheck-3-report fix: in-process, single-server-instance
 * ordering coordination for adapter availability probes — shared by every
 * service that can write a real provider probe's result, not just
 * `AdapterConfigService`. There are exactly two such writers today
 * (`AdapterConfigService.validate()` and `RunDispatchService.
 * reprobeAdapterOnFailure()`); a generation map private to one of them only
 * orders races *within* that one service — a slower, earlier-invoked probe
 * in the OTHER service could still beat a newer one to the write, exactly
 * the "whichever WRITES first wins" bug the generation design was meant to
 * eliminate everywhere.
 *
 * Process-lifetime only, by design — matches every other in-memory
 * coordination structure this subsystem already uses
 * (`pendingAvailabilityProbes`, `WorkspaceLockService`'s in-memory locks):
 * nothing is meaningfully "in flight" across a restart anyway, so nothing
 * here is (or should be) persisted.
 *
 * Two independent generation spaces:
 * - `configGenerations` (key = adapterId): bumped by `invalidateAdapter()`
 *   whenever an availability-relevant config edit happens — ANY in-flight
 *   probe for this adapter (global OR any workspace-scoped) is stale once
 *   this moves, since the config it was probing no longer exists.
 * - `probeGenerations` (key = adapterId for global probes, or
 *   `${adapterId}:${workspaceId}` for workspace-scoped probes): claimed via
 *   `claimProbe()` at the START of every probe attempt (not at write time);
 *   a probe's result may only be written if `isCurrentProbe()` still says
 *   its claimed generation is the latest one claimed for that exact scope.
 */
export class AdapterAvailabilityProbeCoordinator {
  private configGenerations = new Map<string, number>();
  private probeGenerations = new Map<string, number>();

  static scopedProbeKey(adapterId: string, workspaceId: string): string {
    return `${adapterId}:${workspaceId}`;
  }

  invalidateAdapter(adapterId: string): void {
    this.configGenerations.set(adapterId, (this.configGenerations.get(adapterId) ?? 0) + 1);
  }

  getConfigGeneration(adapterId: string): number {
    return this.configGenerations.get(adapterId) ?? 0;
  }

  claimProbe(scopeKey: string): number {
    const next = (this.probeGenerations.get(scopeKey) ?? 0) + 1;
    this.probeGenerations.set(scopeKey, next);
    return next;
  }

  isCurrentProbe(scopeKey: string, generation: number): boolean {
    return this.probeGenerations.get(scopeKey) === generation;
  }

  /** Drops every generation entry for a deleted adapter (its global key and every workspace-scoped key), so a long-lived server process doesn't accumulate unbounded entries for adapters that no longer exist. Call only after the delete's DB transaction has actually committed. */
  forgetAdapter(adapterId: string): void {
    this.configGenerations.delete(adapterId);
    this.probeGenerations.delete(adapterId);
    const scopedPrefix = `${adapterId}:`;
    for (const key of this.probeGenerations.keys()) {
      if (key.startsWith(scopedPrefix)) {
        this.probeGenerations.delete(key);
      }
    }
  }
}
