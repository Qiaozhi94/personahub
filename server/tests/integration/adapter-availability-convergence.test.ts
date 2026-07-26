import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability, FailureReason, RunStatus, RunPurpose } from "@personahub/shared/types";
import { FakeAgentAdapter } from "../../src/runtime/adapters/fake-adapter.js";
import type { AgentAdapter, AdapterValidationResult, AgentRunInput, RunHandle } from "../../src/runtime/types.js";

/**
 * Review-report regression (finding: "adapter availability 不是鉴权可用性的可靠状态，
 * 也不会在运行期鉴权失败后收敛"): a workflow-bound Run failing with a generic
 * AdapterExitNonzero/SpawnFailed must trigger the adapter's own real provider
 * validate() probe, and downgrade to Unavailable when that probe says so —
 * never guessed from this Run's raw stdout/stderr text.
 */
class ScriptedFailAdapter implements AgentAdapter {
  readonly provider = "fake";
  readonly capabilities;
  private inner: FakeAgentAdapter;
  public receivedOptions: unknown[] = [];

  constructor(private validateResult: AdapterValidationResult) {
    this.inner = new FakeAgentAdapter({
      exitCode: 1,
      failureReason: FailureReason.AdapterExitNonzero,
      errorMessage: "adapter exited non-zero",
      delayMs: 30,
    });
    this.capabilities = this.inner.capabilities;
  }

  async validate(_config: unknown, _apiKey: unknown, options?: unknown): Promise<AdapterValidationResult> {
    this.receivedOptions.push(options);
    return this.validateResult;
  }

  start(input: AgentRunInput): Promise<RunHandle> {
    return this.inner.start(input);
  }
}

class DeferredValidateAdapter implements AgentAdapter {
  readonly provider = "fake";
  readonly capabilities;
  private inner: FakeAgentAdapter;
  public resolveValidate!: (result: AdapterValidationResult) => void;
  public validateCalled = false;
  private validatePromise: Promise<AdapterValidationResult>;

  constructor() {
    this.inner = new FakeAgentAdapter({
      exitCode: 1, failureReason: FailureReason.AdapterExitNonzero, errorMessage: "boom", delayMs: 30,
    });
    this.capabilities = this.inner.capabilities;
    this.validatePromise = new Promise((resolve) => { this.resolveValidate = resolve; });
  }

  async validate(): Promise<AdapterValidationResult> {
    this.validateCalled = true;
    return this.validatePromise;
  }

  start(input: AgentRunInput): Promise<RunHandle> {
    return this.inner.start(input);
  }
}

class ThrowingValidateAdapter implements AgentAdapter {
  readonly provider = "fake";
  readonly capabilities;
  private inner: FakeAgentAdapter;

  constructor() {
    this.inner = new FakeAgentAdapter({
      exitCode: 1, failureReason: FailureReason.AdapterExitNonzero, errorMessage: "boom", delayMs: 30,
    });
    this.capabilities = this.inner.capabilities;
  }

  async validate(): Promise<AdapterValidationResult> {
    throw new Error("registry/provider blew up");
  }

  start(input: AgentRunInput): Promise<RunHandle> {
    return this.inner.start(input);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupIssue(services: TestServices, tempDir: string) {
  const project = services.projectService.create("Test");
  services.workspaceService.bind(project.id, tempDir);
  const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
    command: "fake", args: [], capability_tags: [AgentCapability.Implementation],
    default_model: null, status: AdapterStatus.Available,
  });
  return { project, issue, adapter };
}

describe("adapter availability convergence on Run failure", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => disposeTestServices(services));

  it("downgrades the adapter to Unavailable when a failed workflow-bound Run's re-probe reports unavailable", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new ScriptedFailAdapter({ available: false, errorMessage: "auth expired" }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(400);

    const failedRun = services.runRepo.getById(run.id);
    expect(failedRun!.status).toBe(RunStatus.Failed);
    expect(failedRun!.failure_reason).toBe(FailureReason.AdapterExitNonzero);

    // Workspace-override design (adapter-availability.ts): a Run failure is
    // always specific to its own workspace's real conditions, so the
    // reprobe writes an exception override for (adapter, workspace) rather
    // than clobbering the Project-global baseline.
    const override = services.adapterWorkspaceStatusRepo.get(adapter.id, issue.workspace_id);
    expect(override?.status).toBe(AdapterStatus.Unavailable);
    expect(override?.auth_status_message).toBe("auth expired");
    expect(services.agentConfigRepo.getById(adapter.id)!.status).toBe(AdapterStatus.Available);
  });

  it("passes the failed Run's own workspace push_credentials_enabled through to the re-probe", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.workspaceRepo.updatePushCredentialsEnabled(issue.workspace_id, true);
    const scripted = new ScriptedFailAdapter({ available: false, errorMessage: "auth expired" });
    services.adapterRegistry.register(scripted);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(400);

    expect(scripted.receivedOptions).toEqual([{ pushCredentialsEnabled: true }]);
  });

  it("leaves the adapter Available when the re-probe still reports available (does not misclassify an unrelated failure)", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new ScriptedFailAdapter({ available: true, errorMessage: null }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(400);

    const failedRun = services.runRepo.getById(run.id);
    expect(failedRun!.status).toBe(RunStatus.Failed);

    const refetched = services.agentConfigRepo.getById(adapter.id)!;
    expect(refetched.status).toBe(AdapterStatus.Available);
  });

  it("does not re-probe on success", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    let validateCalls = 0;
    class CountingOkAdapter extends FakeAgentAdapter {
      async validate(): Promise<AdapterValidationResult> {
        validateCalls++;
        return { available: true, errorMessage: null };
      }
    }
    services.adapterRegistry.register(new CountingOkAdapter());

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(400);

    expect(validateCalls).toBe(0);
  });

  // Workspace-override design (adapter-availability.ts): a Run failure is
  // always scoped to its own workspace's real conditions and must not
  // silently disable the same adapter for the Project's other workspaces.
  it("does not cascade to a sibling workspace of the same Project sharing the same adapter", async () => {
    const project = services.projectService.create("Test");
    // Each bind() call re-points the Project's default_workspace_id at
    // whichever workspace was bound *last* — bind workspaceB first so
    // tempDir (bound second, below) is what the Issue actually attaches to.
    const workspaceB = services.workspaceService.bind(project.id, createTempDir());
    services.workspaceService.bind(project.id, tempDir);
    const { issue: issueA } = services.issueService.create(project.id, { title: "A", goal: "G" });
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
      command: "fake", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available,
    });
    services.adapterRegistry.register(new ScriptedFailAdapter({ available: false, errorMessage: "auth expired" }));

    await services.runDispatchService.dispatch(issueA.id, adapter.id, "test instructions");
    await wait(400);

    const overrideA = services.adapterWorkspaceStatusRepo.get(adapter.id, issueA.workspace_id);
    expect(overrideA?.status).toBe(AdapterStatus.Unavailable);
    // Workspace B never had a failed Run — no override row for it at all,
    // so its effective status still falls back to the untouched global
    // Available baseline.
    expect(services.adapterWorkspaceStatusRepo.get(adapter.id, workspaceB.id)).toBeNull();
  });

  // Recheck-report regression: availability is a provider/config property,
  // not gated by whether the failing Run happened to drive workflow state —
  // a consult Run failing on expired auth must converge the adapter too.
  it("also converges on a failed ad-hoc consult Run, not just implementation/validator", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new ScriptedFailAdapter({ available: false, errorMessage: "auth expired" }));

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "quick question", RunPurpose.AdHocConsult);
    await wait(400);

    const failedRun = services.runRepo.getById(run.id);
    expect(failedRun!.purpose).toBe(RunPurpose.AdHocConsult);
    expect(failedRun!.status).toBe(RunStatus.Failed);

    const override = services.adapterWorkspaceStatusRepo.get(adapter.id, issue.workspace_id);
    expect(override?.status).toBe(AdapterStatus.Unavailable);
  });

  // Recheck-report regression: the errorMessage returned by a provider's
  // validate() is untrusted external CLI output and must be redacted before
  // it is persisted to auth_status_message / the public DTO.
  it("redacts secret-shaped text in the probe's errorMessage before persisting it", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    services.adapterRegistry.register(new ScriptedFailAdapter({
      available: false,
      errorMessage: "auth failed: Bearer sk-abcdefghijklmnopqrstuvwxyz012345 rejected",
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(400);

    const override = services.adapterWorkspaceStatusRepo.get(adapter.id, issue.workspace_id);
    expect(override?.auth_status_message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(override?.auth_status_message).toContain("[REDACTED]");
  });

  // Final-comprehensive-report regression: the exact api_key held for THIS
  // adapter must be redacted verbatim, even in a format the fixed
  // TOKEN_PATTERNS regex list doesn't recognize.
  it("redacts the adapter's own api_key verbatim in the re-probe errorMessage, even in an unrecognized format", async () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    const oddShapedKey = "AIzaSyD-not-a-recognized-format-1234567890";
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Fake", role: "implementation", cli_provider: "fake",
      command: "fake", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: null, status: AdapterStatus.Available, api_key: oddShapedKey,
    });
    services.adapterRegistry.register(new ScriptedFailAdapter({
      available: false,
      errorMessage: `auth failed: key "${oddShapedKey}" rejected`,
    }));

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(400);

    const override = services.adapterWorkspaceStatusRepo.get(adapter.id, issue.workspace_id);
    expect(override?.auth_status_message).not.toContain(oddShapedKey);
    expect(override?.auth_status_message).toContain("[REDACTED]");
  });

  // Recheck-report regression: the probe reads the adapter config before an
  // up-to-30s await; if the user updates the config (new key, explicit
  // Validate succeeds, etc.) while the stale probe is still in flight, its
  // late "unavailable" result must not clobber the newer state.
  it("discards a stale probe result if the adapter config changed while the probe was in flight", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);

    class SlowFailThenUpdateAdapter implements AgentAdapter {
      readonly provider = "fake";
      readonly capabilities;
      private inner: FakeAgentAdapter;
      constructor() {
        this.inner = new FakeAgentAdapter({
          exitCode: 1, failureReason: FailureReason.AdapterExitNonzero, errorMessage: "boom", delayMs: 30,
        });
        this.capabilities = this.inner.capabilities;
      }
      async validate(): Promise<AdapterValidationResult> {
        // Simulate a slow probe: by the time it resolves, a concurrent
        // explicit Validate (or a config edit) has already landed.
        await wait(150);
        return { available: false, errorMessage: "stale: auth expired" };
      }
      start(input: AgentRunInput): Promise<RunHandle> {
        return this.inner.start(input);
      }
    }
    services.adapterRegistry.register(new SlowFailThenUpdateAdapter());

    const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(60); // Run has failed and the re-probe has started, but not yet resolved (150ms delay).

    const now = new Date().toISOString();
    services.agentConfigRepo.update(adapter.id, {
      status: AdapterStatus.Available,
      auth_status_message: null,
      updated_at: now,
    });

    await wait(200); // let the stale probe resolve and attempt its update.

    const failedRun = services.runRepo.getById(run.id);
    expect(failedRun!.status).toBe(RunStatus.Failed);
    const refetched = services.agentConfigRepo.getById(adapter.id)!;
    expect(refetched.status).toBe(AdapterStatus.Available);
    expect(refetched.auth_status_message).toBeNull();
  });

  // Final-comprehensive-report regression: the re-probe used to be a fully
  // unmanaged `void promise.catch(() => {})` — untracked, unlogged, and
  // abandoned on process exit. These prove it's now a tracked background
  // task: shutdown() actually waits for it (bounded), a probe that throws
  // is logged rather than silently swallowed, and shutdown() still returns
  // promptly if a probe never resolves at all.
  describe("shutdown() lifecycle for the availability re-probe (final-comprehensive-report regression)", () => {
    it("shutdown() awaits an in-flight probe instead of abandoning it", async () => {
      const { issue, adapter } = setupIssue(services, tempDir);
      const deferred = new DeferredValidateAdapter();
      services.adapterRegistry.register(deferred);

      await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
      await wait(100);
      expect(deferred.validateCalled).toBe(true);

      const shutdownPromise = services.runDispatchService.shutdown(2000);
      setTimeout(() => deferred.resolveValidate({ available: false, errorMessage: "deferred failure" }), 50);
      await shutdownPromise;

      const override = services.adapterWorkspaceStatusRepo.get(adapter.id, issue.workspace_id);
      expect(override?.status).toBe(AdapterStatus.Unavailable);
    });

    it("shutdown() returns promptly (honors its timeout) if a probe never resolves", async () => {
      const { issue, adapter } = setupIssue(services, tempDir);
      const deferred = new DeferredValidateAdapter(); // resolved at the end, once this test no longer needs it pending
      services.adapterRegistry.register(deferred);

      await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
      await wait(100);

      const start = Date.now();
      await services.runDispatchService.shutdown(200);
      expect(Date.now() - start).toBeLessThan(1000);

      // Left pending, this probe would make disposeTestServices()'s own
      // shutdown() (default 5s timeout) wait out the full teardown — settle
      // it now that this test has what it needs.
      deferred.resolveValidate({ available: true, errorMessage: null });
    });

    it("logs (does not silently swallow) a probe that throws", async () => {
      const { issue, adapter } = setupIssue(services, tempDir);
      services.adapterRegistry.register(new ThrowingValidateAdapter());
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
      await wait(400);
      await services.runDispatchService.shutdown(200);

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    // final-recheck-report regression: reprobeAdapterOnFailure() used
    // RunService.get() (throws RUN_NOT_FOUND) instead of a nullable lookup,
    // so any finalizeAndDrain() call for a run id that was never
    // persisted — queue-drain-eligibility.test.ts's own "nonexistent"
    // fixture, used to test unrelated drain behavior — logged a spurious
    // "availability re-probe failed" warning on every such call.
    it("does not warn when finalizeAndDrain() is called for a run id that doesn't exist", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await services.runDispatchService.finalizeAndDrain("run_does_not_exist", "wsp_does_not_exist");
      await services.runDispatchService.shutdown(200);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // closure-recheck-4-report fix: push_credentials_enabled is a direct
  // input to what the re-probe finds, not just an incidental field — a
  // mid-flight flip must invalidate the result exactly like a config edit
  // would, even though nothing else (config generation, probe generation,
  // override row) changed.
  it("discards a stale re-probe result if the workspace's push_credentials_enabled flips mid-flight", async () => {
    const { issue, adapter } = setupIssue(services, tempDir);
    const deferred = new DeferredValidateAdapter();
    services.adapterRegistry.register(deferred);

    await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
    await wait(100);
    expect(deferred.validateCalled).toBe(true);

    // The workspace's real dispatch environment changes while the probe
    // (started under push_credentials_enabled=false) is still in flight.
    services.workspaceRepo.updatePushCredentialsEnabled(issue.workspace_id, true);
    deferred.resolveValidate({ available: false, errorMessage: "stale: isolated-env result" });
    await services.runDispatchService.shutdown(1000);

    const override = services.adapterWorkspaceStatusRepo.get(adapter.id, issue.workspace_id);
    expect(override).toBeNull();
  });

  /**
   * closure-recheck-3-report fix: `RunDispatchService.reprobeAdapterOnFailure()`
   * and `AdapterConfigService.validate()` write the exact same
   * `adapter_workspace_status` rows — a coordinator private to one of them
   * used to let the OTHER silently beat a strictly newer, more
   * authoritative call to the write (e.g. a Run's failure re-probe starting
   * before, but finishing after, a user's explicit Validate click for the
   * same workspace). Both services now share one
   * `AdapterAvailabilityProbeCoordinator` instance, injected identically —
   * these tests exercise the race directly across the service boundary,
   * not just within `AdapterConfigService` alone.
   */
  describe("cross-service probe ordering: RunDispatchService's failure re-probe vs. AdapterConfigService.validate()", () => {
    class QueuedDeferredValidateAdapter implements AgentAdapter {
      readonly provider = "cross-service-race";
      readonly capabilities;
      private inner: FakeAgentAdapter;
      public resolvers: ((result: AdapterValidationResult) => void)[] = [];

      constructor() {
        this.inner = new FakeAgentAdapter({
          exitCode: 1, failureReason: FailureReason.AdapterExitNonzero, errorMessage: "boom", delayMs: 30,
        });
        this.capabilities = this.inner.capabilities;
      }

      validate(): Promise<AdapterValidationResult> {
        return new Promise((resolve) => { this.resolvers.push(resolve); });
      }

      start(input: AgentRunInput): Promise<RunHandle> {
        return this.inner.start(input);
      }
    }

    function setupCrossServiceIssue(services: TestServices, tempDir: string) {
      const project = services.projectService.create("CrossService");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "CrossService", role: "implementation", cli_provider: "cross-service-race",
        command: "cross-service-race", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available,
      });
      return { project, issue, adapter };
    }

    // Both A and B report `available: false` with distinct messages — the
    // reprobe (A) structurally can only ever WRITE Unavailable (it returns
    // early on any `available: true` result, "never upgrades here"), so
    // using an Available/Unavailable split couldn't distinguish "B won"
    // from "neither wrote" for a baseline that's already Available. Which
    // one's `auth_status_message` survives is the unambiguous signal.
    it("B (explicit Validate, invoked second) wins when B finishes before A (the failure re-probe)", async () => {
      const { issue, adapter } = setupCrossServiceIssue(services, tempDir);
      const scripted = new QueuedDeferredValidateAdapter();
      services.adapterRegistry.register(scripted);

      const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
      // Let the Run fail and reprobeAdapterOnFailure() start (A claims its
      // generation and blocks on validate() — resolvers[0]).
      await wait(100);
      expect(scripted.resolvers).toHaveLength(1);

      // B: user's explicit Validate for the same workspace, invoked while A
      // is still in flight (claims a newer generation — resolvers[1]).
      const promiseB = services.adapterConfigService.validate(adapter.id, run.workspace_id);
      await wait(20);
      expect(scripted.resolvers).toHaveLength(2);

      scripted.resolvers[1]({ available: false, errorMessage: "B wins" }); // B finishes first.
      await promiseB;
      scripted.resolvers[0]({ available: false, errorMessage: "A stale" }); // A finishes after.
      await services.runDispatchService.shutdown(1000);

      const override = services.adapterWorkspaceStatusRepo.get(adapter.id, run.workspace_id);
      expect(override?.status).toBe(AdapterStatus.Unavailable);
      expect(override?.auth_status_message).toBe("B wins");
    });

    // The critical direction: under the pre-fix implementation (a
    // coordinator private to AdapterConfigService, or the override row's
    // own updated_at as the only guard), A finishing first would win
    // outright, discarding B — even though B represents strictly newer,
    // user-initiated intent.
    it("B (explicit Validate, invoked second) still wins even when A (the failure re-probe) finishes first", async () => {
      const { issue, adapter } = setupCrossServiceIssue(services, tempDir);
      const scripted = new QueuedDeferredValidateAdapter();
      services.adapterRegistry.register(scripted);

      const run = await services.runDispatchService.dispatch(issue.id, adapter.id, "test instructions");
      await wait(100);
      expect(scripted.resolvers).toHaveLength(1);

      const promiseB = services.adapterConfigService.validate(adapter.id, run.workspace_id);
      await wait(20);
      expect(scripted.resolvers).toHaveLength(2);

      // A (invoked first) finishes first this time — its write attempt must
      // be allowed to fully land before B resolves, to genuinely test
      // completion order rather than invocation order.
      scripted.resolvers[0]({ available: false, errorMessage: "A stale" });
      await services.runDispatchService.shutdown(1000);
      // B (invoked second) finishes after — it must still win.
      scripted.resolvers[1]({ available: false, errorMessage: "B wins" });
      await promiseB;

      const override = services.adapterWorkspaceStatusRepo.get(adapter.id, run.workspace_id);
      expect(override?.status).toBe(AdapterStatus.Unavailable);
      expect(override?.auth_status_message).toBe("B wins");
    });
  });
});
