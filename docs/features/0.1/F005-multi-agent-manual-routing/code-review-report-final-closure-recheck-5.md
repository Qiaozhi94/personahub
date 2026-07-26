# Code Review Report

**Reviewed**: F005 Manual Multi-Agent Routing implementation, with final closure verification of adapter availability convergence, shared probe ordering, workspace environment drift protection, lifecycle cleanup, API/UI integration, and regression coverage  
**Language(s)**: TypeScript, TSX, SQL  
**Review Date**: 2026-07-26  
**Severity Legend**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | 🔵 Info

---

## Executive Summary

The Medium-severity finding from the previous review is correctly resolved: `RunDispatchService.reprobeAdapterOnFailure()` now snapshots the exact workspace environment input used by the provider probe and discards the result if `push_credentials_enabled` changes while the probe is in flight. The implementation is symmetrical with `AdapterConfigService.validate()`, and the added integration test exercises the precise deferred-probe race rather than only asserting the steady-state path.

The previously closed shared-generation ordering and adapter-deletion cleanup remain intact. No new correctness, security, performance, maintainability, or test-coverage findings were identified in this final pass. All automated quality gates completed successfully.

## Findings

No new findings.

### Previous Finding Closure

#### ✅ Workspace credential environment drift during Run failure re-probe — `server/src/services/run-dispatch.ts:250-265`

**Status**: Closed

The re-probe now:

1. reads and snapshots `workspace.push_credentials_enabled` before calling the asynchronous provider validation;
2. passes that snapshot into `adapter.validate()`;
3. reloads the workspace after the probe completes;
4. discards an unavailable result if the workspace no longer exists or the exact field changed.

This prevents a probe performed under the old credential-isolation environment from persisting `Unavailable` after the workspace environment has changed. The guard compares the precise probe input instead of `workspace.updated_at`, so unrelated lock or branch updates do not create false invalidations.

The regression case in `server/tests/integration/adapter-availability-convergence.test.ts:393-410` starts a deferred failure re-probe with credential push disabled, enables it before resolving the probe as unavailable, and verifies that no workspace override is persisted.

### Earlier Closure Items Reconfirmed

- Explicit validation and Run failure re-probes share the same injected `AdapterAvailabilityProbeCoordinator`.
- Probe generations are claimed at invocation time, preserving last-invoked-wins semantics across both completion orders.
- Availability-relevant adapter updates invalidate all in-flight probes through the shared configuration generation.
- Adapter deletion calls `forgetAdapter()` after successful transactional deletion, removing global and workspace-scoped generation entries.
- Run failure results remain workspace-scoped and cannot downgrade sibling workspaces.
- Provider error messages and the adapter's exact API key remain sanitized before persistence.
- Background probes are tracked and awaited with bounded shutdown behavior.

## Positive Observations

- The final race guard is narrowly targeted to a real provider-validation dependency and does not over-couple availability to unrelated workspace writes.
- The convergence suite tests invocation order independently from completion order across service boundaries.
- The new workspace-flip test controls probe completion explicitly, making the regression deterministic.
- The full Server run also passed `adapter-routes.test.ts` without reproducing the previous load-sensitive timeout.
- The implementation keeps workspace override storage exception-only and preserves the conservative Project-level baseline.

## Verification

| Check | Result |
|---|---|
| Targeted Server regression suite | ✅ 5 files, 118 tests passed |
| Workspace environment flip regression | ✅ Passed |
| Cross-service probe ordering, both completion orders | ✅ Passed |
| Full Server suite | ✅ 107 files passed, 1,385 tests passed |
| Environment/platform-gated Server tests | ℹ️ 9 files / 17 tests skipped as designed |
| Full Web suite | ✅ 21 files, 164 tests passed |
| Type checking | ✅ Server and Web passed |
| Production build | ✅ Shared, Server, and Web passed |

Non-failing output observed:

- Vitest emitted an existing deprecation warning about object-form timeout arguments.
- Web tests emitted existing React Query warnings where test mocks return `undefined`.

Neither warning represents a newly introduced F005 functional failure. Real browser manual interaction was not repeated in this review; UI verification is based on the automated Web suite and production build.

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 0 |
| 🟡 Medium | 0 |
| 🟢 Low | 0 |
| 🔵 Info | 0 |

**Bottom Line**: The final outstanding finding is closed, all automated quality gates pass, and F005 is ready to complete review from a code and automated-verification perspective.
