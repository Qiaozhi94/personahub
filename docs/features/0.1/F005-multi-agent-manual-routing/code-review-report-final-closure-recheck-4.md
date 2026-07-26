# F005 Code Review Report — Final Closure Recheck 4

**Review date:** 2026-07-26  
**Scope:** F005 multi-agent manual routing implementation, with emphasis on the two findings from the previous closure recheck and their surrounding concurrency paths  
**Overall result:** The previous High- and Low-severity findings are closed. One new Medium-severity consistency issue remains in the Run failure re-probe path.

## Executive Summary

The latest changes correctly introduced a shared `AdapterAvailabilityProbeCoordinator` and use it across explicit validation and Run failure re-probes. A validation started later now supersedes an earlier in-flight probe regardless of completion order. Adapter deletion also removes the coordinator's global and scoped generation entries, closing the prior lifecycle-cleanup concern.

Targeted tests, Web tests, type checking, and production builds pass. The full Server test run had one timeout in `adapter-routes.test.ts`; the same file then passed all 35 tests when rerun in isolation, so this appears to be a load-sensitive test timeout rather than a deterministic regression.

One Medium-severity issue remains: the Run failure re-probe snapshots adapter configuration, override state, and probe generation, but not the workspace's `push_credentials_enabled` value. A result produced under an old credential environment can therefore still overwrite availability after that environment changes.

## Previous Findings Recheck

| Previous finding | Status | Verification |
|---|---|---|
| Run failure re-probes did not share ordering/generation state with explicit validation | ✅ Closed | Both paths now call the same `AdapterAvailabilityProbeCoordinator.claimProbe()` and validate the claimed generation before persisting. The two added cross-service integration tests cover both completion orders. |
| Probe/config generation maps were not cleaned up after adapter deletion | ✅ Closed | `AdapterConfigService.delete()` calls `forgetAdapter()` after the transaction succeeds, and `forgetAdapter()` removes the adapter's global and workspace-scoped entries. |

## Findings

### Medium — Run failure re-probe can persist a result from a stale workspace credential environment

**Location:** `server/src/services/run-dispatch.ts:230-257`

`reprobeAdapterOnFailure()` correctly guards against:

- adapter configuration changes;
- a newer explicit or automatic probe;
- availability override changes.

However, the validation result also depends on `workspace.push_credentials_enabled`. That value is read immediately before `adapter.validate()`, but it is neither snapshotted nor compared again after the asynchronous validation completes.

A problematic sequence is:

1. Workspace credential push is disabled.
2. A failed Run starts a slow isolated-environment re-probe.
3. Credential push is enabled while that probe is in flight.
4. The old isolated probe returns unavailable.
5. Configuration generation, probe generation, and override timestamp are unchanged, so the old result is persisted as `Unavailable` for the now credential-enabled workspace.

This can leave availability inconsistent with the current workspace environment until another validation occurs. `AdapterConfigService.validate()` already guards this dependency by snapshotting and rechecking `push_credentials_enabled`; the Run failure path should use the same rule.

**Recommended fix:**

```ts
const workspace = this.workspaceRepo.getById(run.workspace_id);
if (!workspace) {
  return;
}
const snapshotPushCredentialsEnabled = workspace.push_credentials_enabled;

const result = await adapter.validate(config, {
  pushCredentialsEnabled: snapshotPushCredentialsEnabled,
});

// Existing configuration/probe/override checks...

const currentWorkspace = this.workspaceRepo.getById(run.workspace_id);
if (
  !currentWorkspace ||
  currentWorkspace.push_credentials_enabled !== snapshotPushCredentialsEnabled
) {
  return;
}
```

Compare the exact environment field rather than `workspace.updated_at`; unrelated workspace writes should not invalidate an otherwise current probe.

**Recommended test:** Add an integration case in `server/tests/integration/adapter-availability-convergence.test.ts` that starts a deferred failure re-probe with credential push disabled, enables it before resolving the probe as unavailable, and verifies that no unavailable override is persisted.

## Positive Observations

- The shared coordinator is narrowly scoped and avoids coupling `AdapterConfigService` directly to `RunDispatchService`.
- Probe keys are workspace-aware, so one workspace's validation does not cancel another workspace's probe.
- Configuration invalidation occurs only after a successful update transaction.
- Deletion cleanup occurs only after a successful delete transaction.
- Cross-service tests explicitly cover both race completion orders, which is the important property for last-started-wins behavior.

## Verification

| Check | Result |
|---|---|
| Targeted Server tests: convergence, validation registry, adapter config, migration v6, and migration | ✅ 5 files, 117 tests passed |
| Full Server test suite, first run | ⚠️ 1,383 passed, 17 skipped, 1 timeout in `adapter-routes.test.ts:73` |
| Isolated rerun of `adapter-routes.test.ts` | ✅ 35/35 passed |
| Full Web test suite | ✅ 21 files, 164 tests passed |
| Type checking | ✅ Passed |
| Production build | ✅ Passed |

The Server timeout was not reproducible in isolation. Existing Vitest deprecation output and React Query warning output were observed but are not F005 functional findings.

## Severity Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |
| Informational | 0 |

## Final Assessment

The two findings from the previous review are resolved, and no High-severity blocker remains. Before treating F005 as fully closed, the Run failure re-probe should also guard against changes to `push_credentials_enabled`, matching the stale-environment protection already implemented in explicit validation.

---

## Resolution (2026-07-26)

Confirmed by code inspection and fixed: `reprobeAdapterOnFailure()` read `workspace?.push_credentials_enabled` inline immediately before probing, but — unlike `AdapterConfigService.validate()`'s scoped path, which already snapshots and rechecks this exact field — never re-verified it after the probe resolved. `push_credentials_enabled` is now snapshotted before the probe and compared against a fresh `workspaceRepo.getById()` read after it, alongside the existing config-generation/probe-generation/override-`updated_at` checks; a mid-flight flip discards the stale result instead of persisting it. Added the exact regression test recommended by this report (`adapter-availability-convergence.test.ts`: a deferred failure re-probe started with credential push disabled, flipped to enabled mid-flight, resolving `Unavailable` — asserts no override is persisted).

**Verification**: full Server suite (1385 passed, 17 env/platform-gated skips), full Web suite (164 passed), typecheck, and production build all pass; real logged-in Codex/Claude/OpenCode CLIs re-verified across the affected real-CLI test files.
