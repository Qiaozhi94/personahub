import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import type { AgentAdapter, AgentAdapterCapabilities, AdapterValidationResult, AdapterValidateOptions } from "../../src/runtime/types.js";

// T033/T034: AdapterConfigService.validate() must go through the registry's
// adapter.validate() — not a hardcoded local `--version` check — so each
// provider's own real auth probe (e.g. Claude's `auth status`, confirmed in
// Phase 1) is what actually determines availability, once Phase 5/6 wire
// real adapters in. This file proves the SERVICE mechanism generically via a
// scripted fake adapter; the real Codex path is covered by the existing
// adapter-config.test.ts "re-validates adapter" test (still passing, proving
// no regression for the one real provider available today).

function scriptedAdapter(provider: string, result: AdapterValidationResult): AgentAdapter {
  const capabilities: AgentAdapterCapabilities = {
    provider,
    supportsApprovalHook: false,
    supportsStructuredTrace: false,
    supportsFinalMessage: false,
    executionTimeoutMs: 60_000,
  };
  return {
    provider,
    capabilities,
    validate: async () => result,
    start: () => { throw new Error("not used in this test"); },
  };
}

function recordingAdapter(provider: string, calls: (AdapterValidateOptions | undefined)[]): AgentAdapter {
  const capabilities: AgentAdapterCapabilities = {
    provider,
    supportsApprovalHook: false,
    supportsStructuredTrace: false,
    supportsFinalMessage: false,
    executionTimeoutMs: 60_000,
  };
  return {
    provider,
    capabilities,
    validate: async (_config, _apiKey, options) => {
      calls.push(options);
      return { available: true, errorMessage: null };
    },
    start: () => { throw new Error("not used in this test"); },
  };
}

describe("AdapterConfigService.validate() goes through the registry (T033/T034)", () => {
  let services: TestServices;
  let projectId: string;

  beforeEach(() => {
    services = createTestServices();
    projectId = services.projectService.create("T033").id;
  });
  afterEach(() => disposeTestServices(services));

  it("uses the registered adapter's own validate() result, not a hardcoded check", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted", { available: false, errorMessage: "scripted: auth expired" }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "Scripted", role: "implementation", cli_provider: "scripted",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.status).toBe(AdapterStatus.Unavailable);
    expect(validated.auth_status_message).toBe("scripted: auth expired");
  });

  it("updates status to Available when the registered adapter reports available", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted-ok", { available: true, errorMessage: null }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "ScriptedOk", role: "implementation", cli_provider: "scripted-ok",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Unavailable,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.status).toBe(AdapterStatus.Available);
    expect(validated.auth_status_message).toBeNull();
  });

  it("updates last_checked_at on every validate() call", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted-time", { available: true, errorMessage: null }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "ScriptedTime", role: "implementation", cli_provider: "scripted-time",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Unknown,
    });
    expect(adapter.last_checked_at).toBeNull();

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.last_checked_at).not.toBeNull();
  });

  it("redacts secret-shaped text in the probe's errorMessage before persisting/returning it (recheck-report regression)", async () => {
    services.adapterRegistry.register(scriptedAdapter("scripted-secret", {
      available: false,
      errorMessage: "auth failed: Bearer sk-abcdefghijklmnopqrstuvwxyz012345 rejected",
    }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "Secret", role: "implementation", cli_provider: "scripted-secret",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.auth_status_message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(validated.auth_status_message).toContain("[REDACTED]");
  });

  // Final-comprehensive-report regression: the fixed TOKEN_PATTERNS regex
  // list can't enumerate every supported provider's key format (Google
  // `AIza...`, xAI `xai-...`, etc.) — the exact api_key this probe call
  // already holds must be redacted by literal match regardless of its shape.
  it("redacts the adapter's own api_key verbatim even when it doesn't match any known key-format pattern", async () => {
    const oddShapedKey = "AIzaSyD-not-a-recognized-format-1234567890";
    services.adapterRegistry.register(scriptedAdapter("scripted-oddkey", {
      available: false,
      errorMessage: `auth failed: key "${oddShapedKey}" rejected`,
    }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "OddKey", role: "implementation", cli_provider: "scripted-oddkey",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available, api_key: oddShapedKey,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.auth_status_message).not.toContain(oddShapedKey);
    expect(validated.auth_status_message).toContain("[REDACTED]");
  });

  describe("workspace-aware pushCredentialsEnabled (recheck-report finding: OpenCode OAuth on Windows)", () => {
    it("passes pushCredentialsEnabled=false when no workspace_id is given (conservative default)", async () => {
      const calls: (AdapterValidateOptions | undefined)[] = [];
      services.adapterRegistry.register(recordingAdapter("recording-none", calls));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Recording", role: "implementation", cli_provider: "recording-none",
        command: "recording-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available,
      });

      await services.adapterConfigService.validate(adapter.id);

      expect(calls).toEqual([{ pushCredentialsEnabled: false }]);
    });

    it("passes the target workspace's real push_credentials_enabled when workspace_id is given", async () => {
      const calls: (AdapterValidateOptions | undefined)[] = [];
      services.adapterRegistry.register(recordingAdapter("recording-ws", calls));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Recording", role: "implementation", cli_provider: "recording-ws",
        command: "recording-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);
      services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);

      await services.adapterConfigService.validate(adapter.id, workspace.id);

      expect(calls).toEqual([{ pushCredentialsEnabled: true }]);
    });

    // closure-check-report fix: "omitted" and "invalid" workspace_id are
    // different caller intents and must not share a code path — a
    // cross-Project (or nonexistent) workspace_id used to silently fall
    // through to the conservative global-baseline probe/write, which could
    // let a typo'd or foreign workspace_id unexpectedly change the
    // Project-wide status instead of erroring.
    it("throws WORKSPACE_NOT_FOUND (never silently falls back to the global baseline) when workspace_id belongs to a different Project", async () => {
      const calls: (AdapterValidateOptions | undefined)[] = [];
      services.adapterRegistry.register(recordingAdapter("recording-cross", calls));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Recording", role: "implementation", cli_provider: "recording-cross",
        command: "recording-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available,
      });
      const otherProject = services.projectService.create("Other");
      const tempDir = createTempDir();
      const otherWorkspace = services.workspaceService.bind(otherProject.id, tempDir);
      services.workspaceRepo.updatePushCredentialsEnabled(otherWorkspace.id, true);

      await expect(services.adapterConfigService.validate(adapter.id, otherWorkspace.id))
        .rejects.toMatchObject({ code: ErrorCode.WORKSPACE_NOT_FOUND });
      expect(calls).toEqual([]);
      // The global baseline is untouched by the rejected call.
      expect(services.agentConfigRepo.getById(adapter.id)?.status).toBe(AdapterStatus.Available);
    });

    it("throws WORKSPACE_NOT_FOUND when workspace_id does not exist at all", async () => {
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Recording", role: "implementation", cli_provider: "recording-none",
        command: "recording-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available,
      });

      await expect(services.adapterConfigService.validate(adapter.id, "wsp_does_not_exist"))
        .rejects.toMatchObject({ code: ErrorCode.WORKSPACE_NOT_FOUND });
    });

    // Workspace-override design (adapter-availability.ts, superseding the
    // Final-comprehensive-report's original "persist Unknown" workaround): a
    // probe that only succeeds because of one workspace's
    // push_credentials_enabled=true is no longer persisted as a
    // Project-global "Available" *or* smuggled into the global column as a
    // permissive "Unknown" — it is written as an EXCEPTION override scoped
    // to exactly `(adapter, workspace)`, so the Project's other (isolated)
    // workspaces never see it. The Project-global baseline itself is left
    // untouched by a workspace-scoped validate() call.
    it("persists a workspace-scoped Available override, leaving the Project-global status untouched, when the probe only succeeded because pushCredentialsEnabled=true", async () => {
      services.adapterRegistry.register(scriptedAdapter("scripted-permissive", { available: true, errorMessage: null }));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Permissive", role: "implementation", cli_provider: "scripted-permissive",
        command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);
      services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);

      const validated = await services.adapterConfigService.validate(adapter.id, workspace.id);

      expect(validated.status).toBe(AdapterStatus.Available);
      const override = services.adapterWorkspaceStatusRepo.get(adapter.id, workspace.id);
      expect(override?.status).toBe(AdapterStatus.Available);
      expect(services.agentConfigRepo.getById(adapter.id)?.status).toBe(AdapterStatus.Unavailable);
    });

    it("still persists Available when the probe succeeds under the conservative (isolated) assumption", async () => {
      services.adapterRegistry.register(scriptedAdapter("scripted-conservative-ok", { available: true, errorMessage: null }));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "ConservativeOk", role: "implementation", cli_provider: "scripted-conservative-ok",
        command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });

      const validated = await services.adapterConfigService.validate(adapter.id);

      expect(validated.status).toBe(AdapterStatus.Available);
    });

    it("still persists Unavailable when the probe fails even with pushCredentialsEnabled=true", async () => {
      services.adapterRegistry.register(scriptedAdapter("scripted-permissive-fail", { available: false, errorMessage: "still broken" }));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "PermissiveFail", role: "implementation", cli_provider: "scripted-permissive-fail",
        command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);
      services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);

      const validated = await services.adapterConfigService.validate(adapter.id, workspace.id);

      expect(validated.status).toBe(AdapterStatus.Unavailable);
    });

    // closure-check-report fix: the table is documented as exception-only
    // (schema-v7.ts) but used to upsert unconditionally, even when the
    // scoped result equalled the (possibly since-changed) global baseline.
    it("deletes a stale workspace override instead of upserting when a fresh scoped probe matches the current global baseline", async () => {
      services.adapterRegistry.register(scriptedAdapter("scripted-equalizes", { available: false, errorMessage: "still broken" }));
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Equalizes", role: "implementation", cli_provider: "scripted-equalizes",
        command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);
      // Seed a stale Available override, as if an earlier (differently
      // configured) probe had recorded an exception here.
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: adapter.id, workspace_id: workspace.id,
        status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
      });

      await services.adapterConfigService.validate(adapter.id, workspace.id);

      expect(services.adapterWorkspaceStatusRepo.get(adapter.id, workspace.id)).toBeNull();
    });
  });

  describe("stale-result race guard (closure-check-report fix, mirrors RunDispatchService.reprobeAdapterOnFailure)", () => {
    function deferredAdapter(provider: string): { adapter: AgentAdapter; resolve: (r: AdapterValidationResult) => void } {
      let resolveFn!: (r: AdapterValidationResult) => void;
      const promise = new Promise<AdapterValidationResult>((resolve) => { resolveFn = resolve; });
      const capabilities: AgentAdapterCapabilities = {
        provider, supportsApprovalHook: false, supportsStructuredTrace: false, supportsFinalMessage: false, executionTimeoutMs: 60_000,
      };
      return {
        adapter: {
          provider,
          capabilities,
          validate: async () => promise,
          start: () => { throw new Error("not used in this test"); },
        },
        resolve: resolveFn,
      };
    }

    it("discards a stale global validate() result if an availability-relevant field (command) changed while the probe was in flight", async () => {
      const { adapter: deferred, resolve } = deferredAdapter("deferred-global");
      services.adapterRegistry.register(deferred);
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "Deferred", role: "implementation", cli_provider: "deferred-global",
        command: "deferred-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unknown,
      });

      const validatePromise = services.adapterConfigService.validate(adapter.id);
      // The concurrent edit goes through the real service (not a direct
      // repository poke) — that's what actually bumps the in-process
      // config generation the guard checks; command/args/auth fields are
      // the only production write path AdapterConfigService.update() ever
      // uses, and it's the only caller of agentConfigRepo.update() at all.
      const updated = services.adapterConfigService.update(adapter.id, { command: "definitely-not-a-real-binary-xyz" });
      expect(updated.status).toBe(AdapterStatus.Unavailable);

      resolve({ available: true, errorMessage: null });
      const result = await validatePromise;

      // The stale probe's Available result must not clobber the edit.
      expect(result.status).toBe(AdapterStatus.Unavailable);
      expect(services.agentConfigRepo.getById(adapter.id)?.status).toBe(AdapterStatus.Unavailable);
    });

    it("does NOT discard a global validate() result merely because an availability-irrelevant field (e.g. a concurrent status/message write to the same row) landed mid-flight, as long as command/auth fields are unchanged", async () => {
      const { adapter: deferred, resolve } = deferredAdapter("deferred-irrelevant");
      services.adapterRegistry.register(deferred);
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "DeferredIrrelevant", role: "implementation", cli_provider: "deferred-irrelevant",
        command: "deferred-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unknown,
      });

      const validatePromise = services.adapterConfigService.validate(adapter.id);
      // Only `updated_at` (and an availability-irrelevant field) changes —
      // command/args/auth_type/model_provider/default_model/api_key are
      // untouched, so this is NOT a stale-config race and the probe's
      // result must still land.
      services.agentConfigRepo.update(adapter.id, { updated_at: new Date().toISOString() });
      resolve({ available: true, errorMessage: null });
      const result = await validatePromise;

      expect(result.status).toBe(AdapterStatus.Available);
      expect(services.agentConfigRepo.getById(adapter.id)?.status).toBe(AdapterStatus.Available);
    });

    it("discards a stale workspace-scoped validate() result if that override changed while the probe was in flight", async () => {
      const { adapter: deferred, resolve } = deferredAdapter("deferred-scoped");
      services.adapterRegistry.register(deferred);
      const adapter = services.agentConfigRepo.create({
        project_id: projectId, name: "DeferredScoped", role: "implementation", cli_provider: "deferred-scoped",
        command: "deferred-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);

      const validatePromise = services.adapterConfigService.validate(adapter.id, workspace.id);
      // A newer scoped write (e.g. another concurrent explicit Validate)
      // lands for this exact pair before the first probe resolves.
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: adapter.id, workspace_id: workspace.id,
        status: AdapterStatus.Unavailable, last_checked_at: null, auth_status_message: "newer result",
      });
      resolve({ available: true, errorMessage: null });
      const result = await validatePromise;

      expect(result.status).toBe(AdapterStatus.Unavailable);
      const override = services.adapterWorkspaceStatusRepo.get(adapter.id, workspace.id);
      expect(override?.auth_status_message).toBe("newer result");
    });

    /**
     * closure-recheck-report fix: the earlier field-snapshot guard only
     * caught a probe racing an actual CONFIG EDIT — it did nothing for two
     * validate() calls overlapping on the SAME unchanged config, where
     * whichever wrote to the DB last (in wall-clock completion order, not
     * call order) simply won, silently burying a result that should have
     * lost. `queuedDeferredAdapter()` hands out one independent resolver
     * per call (in call order) against the same registry entry, so the
     * test can control completion order explicitly regardless of which
     * `validate()` call was invoked first.
     */
    function queuedDeferredAdapter(provider: string): { adapter: AgentAdapter; resolvers: ((r: AdapterValidationResult) => void)[] } {
      const resolvers: ((r: AdapterValidationResult) => void)[] = [];
      const capabilities: AgentAdapterCapabilities = {
        provider, supportsApprovalHook: false, supportsStructuredTrace: false, supportsFinalMessage: false, executionTimeoutMs: 60_000,
      };
      return {
        adapter: {
          provider,
          capabilities,
          validate: () => new Promise<AdapterValidationResult>((resolve) => { resolvers.push(resolve); }),
          start: () => { throw new Error("not used in this test"); },
        },
        resolvers,
      };
    }

    /**
     * closure-recheck-2-report fix: "result last WRITTEN wins" and "call
     * last INVOKED wins" are different guarantees — only the second one
     * correctly represents a user's newer, explicit Validate click beating
     * an older, still-in-flight auto-probe regardless of which one's async
     * work happens to resolve first. Both completion orderings are
     * exercised below for both global and scoped paths; in every case B
     * (invoked second) must win.
     */
    it("global: keeps B's result when B (invoked second) finishes first", async () => {
      const { adapter, resolvers } = queuedDeferredAdapter("overlap-global-b-first");
      services.adapterRegistry.register(adapter);
      const created = services.agentConfigRepo.create({
        project_id: projectId, name: "OverlapGlobalBFirst", role: "implementation", cli_provider: "overlap-global-b-first",
        command: "overlap-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unknown,
      });

      const promiseA = services.adapterConfigService.validate(created.id);
      const promiseB = services.adapterConfigService.validate(created.id);
      expect(resolvers).toHaveLength(2);

      resolvers[1]({ available: false, errorMessage: "B failed" });
      await promiseB;
      resolvers[0]({ available: true, errorMessage: null });
      await promiseA;

      const final = services.agentConfigRepo.getById(created.id)!;
      expect(final.status).toBe(AdapterStatus.Unavailable);
      expect(final.auth_status_message).toBe("B failed");
    });

    // The critical case: under the earlier "whichever WRITES first wins"
    // implementation, A (invoked first, but finishing first here too)
    // would win outright — silently discarding B, the call that actually
    // represents the user's most recent action.
    it("global: keeps B's result even when A (invoked first) finishes first and B (invoked second) finishes later", async () => {
      const { adapter, resolvers } = queuedDeferredAdapter("overlap-global-a-first");
      services.adapterRegistry.register(adapter);
      const created = services.agentConfigRepo.create({
        project_id: projectId, name: "OverlapGlobalAFirst", role: "implementation", cli_provider: "overlap-global-a-first",
        command: "overlap-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unknown,
      });

      const promiseA = services.adapterConfigService.validate(created.id);
      const promiseB = services.adapterConfigService.validate(created.id);
      expect(resolvers).toHaveLength(2);

      // A (invoked first) finishes first this time.
      resolvers[0]({ available: true, errorMessage: null });
      await promiseA;
      // B (invoked second) finishes after — it must still win.
      resolvers[1]({ available: false, errorMessage: "B failed" });
      await promiseB;

      const final = services.agentConfigRepo.getById(created.id)!;
      expect(final.status).toBe(AdapterStatus.Unavailable);
      expect(final.auth_status_message).toBe("B failed");
    });

    it("scoped: keeps B's result when B (invoked second) finishes first", async () => {
      const { adapter, resolvers } = queuedDeferredAdapter("overlap-scoped-b-first");
      services.adapterRegistry.register(adapter);
      const created = services.agentConfigRepo.create({
        project_id: projectId, name: "OverlapScopedBFirst", role: "implementation", cli_provider: "overlap-scoped-b-first",
        command: "overlap-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);

      const promiseA = services.adapterConfigService.validate(created.id, workspace.id);
      const promiseB = services.adapterConfigService.validate(created.id, workspace.id);
      expect(resolvers).toHaveLength(2);

      resolvers[1]({ available: true, errorMessage: null });
      await promiseB;
      resolvers[0]({ available: false, errorMessage: "A failed, but is stale" });
      await promiseA;

      const override = services.adapterWorkspaceStatusRepo.get(created.id, workspace.id);
      expect(override?.status).toBe(AdapterStatus.Available);
    });

    // Mirrors the global "A finishes first" case, AND covers the reviewer's
    // specific concern that a scoped B result equal to the global baseline
    // (which takes the delete() branch, not upsert()) must still preserve
    // B's invocation-order win — not just when B's result differs from
    // baseline and writes a new override row.
    it("scoped: keeps B's result even when A (invoked first) finishes first, including when B's result equals the global baseline (delete(), not upsert())", async () => {
      const { adapter, resolvers } = queuedDeferredAdapter("overlap-scoped-a-first");
      services.adapterRegistry.register(adapter);
      const created = services.agentConfigRepo.create({
        project_id: projectId, name: "OverlapScopedAFirst", role: "implementation", cli_provider: "overlap-scoped-a-first",
        command: "overlap-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);
      // Seed an existing Available override — A will try to reaffirm it,
      // B (the true winner) reports Unavailable, matching the global
      // baseline, which takes the delete() branch rather than upsert().
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: created.id, workspace_id: workspace.id,
        status: AdapterStatus.Available, last_checked_at: null, auth_status_message: null,
      });

      const promiseA = services.adapterConfigService.validate(created.id, workspace.id);
      const promiseB = services.adapterConfigService.validate(created.id, workspace.id);
      expect(resolvers).toHaveLength(2);

      // A (invoked first) finishes first, reporting Available.
      resolvers[0]({ available: true, errorMessage: null });
      await promiseA;
      // B (invoked second) finishes after, reporting Unavailable — equal to
      // the global baseline, so it deletes the override rather than
      // upserting. It must still be the one that wins.
      resolvers[1]({ available: false, errorMessage: "B failed, matches baseline" });
      await promiseB;

      const override = services.adapterWorkspaceStatusRepo.get(created.id, workspace.id);
      expect(override).toBeNull();
    });

    // closure-recheck-2-report Medium fix: the guard must snapshot only
    // push_credentials_enabled (the probe's actual input), not the whole
    // workspace `updated_at` — which also moves on lock acquire/release,
    // git branch detection, etc. A real 1-30s provider probe overlapping
    // with any of those unrelated writes must NOT have its legitimate
    // result discarded.
    it("does not discard a scoped result merely because the workspace was locked/released mid-flight (push_credentials_enabled unchanged)", async () => {
      const { adapter, resolve } = deferredAdapter("workspace-lock-noise");
      services.adapterRegistry.register(adapter);
      const created = services.agentConfigRepo.create({
        project_id: projectId, name: "WorkspaceLockNoise", role: "implementation", cli_provider: "workspace-lock-noise",
        command: "noise-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);

      const validatePromise = services.adapterConfigService.validate(created.id, workspace.id);
      // Unrelated workspace activity — acquiring and releasing a lock —
      // bumps `workspaces.updated_at` but never touches
      // push_credentials_enabled.
      services.workspaceRepo.acquireLock(workspace.id, "run_noise");
      services.workspaceRepo.releaseLock(workspace.id);
      resolve({ available: true, errorMessage: null });
      await validatePromise;

      const override = services.adapterWorkspaceStatusRepo.get(created.id, workspace.id);
      expect(override?.status).toBe(AdapterStatus.Available);
    });

    it("discards a scoped result when push_credentials_enabled itself flips mid-flight", async () => {
      const { adapter, resolve } = deferredAdapter("workspace-env-flip");
      services.adapterRegistry.register(adapter);
      const created = services.agentConfigRepo.create({
        project_id: projectId, name: "WorkspaceEnvFlip", role: "implementation", cli_provider: "workspace-env-flip",
        command: "flip-cli", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Unavailable,
      });
      const tempDir = createTempDir();
      const workspace = services.workspaceService.bind(projectId, tempDir);

      const validatePromise = services.adapterConfigService.validate(created.id, workspace.id);
      // The probe's actual input changes mid-flight — its result no longer
      // reflects the workspace's real current environment.
      services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);
      resolve({ available: true, errorMessage: null });
      await validatePromise;

      const override = services.adapterWorkspaceStatusRepo.get(created.id, workspace.id);
      expect(override).toBeNull();
    });
  });

  it("a version-string success does not by itself imply availability — the adapter's own probe result is authoritative", async () => {
    // Simulates the real finding from T001/T033: `--version` succeeding is
    // not proof of login. A scripted adapter whose validate() distinguishes
    // "binary found" from "authenticated" must have its own (false) verdict
    // honored, not overridden by any generic success heuristic.
    services.adapterRegistry.register(scriptedAdapter("scripted-authcheck", {
      available: false,
      errorMessage: "binary found, but not logged in",
    }));
    const adapter = services.agentConfigRepo.create({
      project_id: projectId, name: "AuthCheck", role: "implementation", cli_provider: "scripted-authcheck",
      command: "scripted-cli", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });

    const validated = await services.adapterConfigService.validate(adapter.id);

    expect(validated.status).toBe(AdapterStatus.Unavailable);
    expect(validated.auth_status_message).toBe("binary found, but not logged in");
  });
});
