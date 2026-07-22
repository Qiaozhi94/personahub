import { describe, it, expect } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability, CliProvider, AdapterAuthType, RunStatus, RunPurpose } from "@personahub/shared/types";
import { OpenCodeAdapter } from "../../src/runtime/adapters/opencode-adapter.js";

/**
 * Root-cause fix verification (2026-07-23): real-CLI testing found OpenCode
 * hangs indefinitely on Windows under credential isolation. Bisected via a
 * minimal child_process.spawn() reproduction (not a shell) against a real,
 * authenticated OpenCode install: the actual trigger is HOMEDRIVE/HOMEPATH
 * staying pointed at the real profile while USERPROFILE is redirected — an
 * inconsistent "home" across Windows' three home-identity variables. A
 * SEPARATE finding: pointing XDG_DATA_HOME/XDG_CONFIG_HOME at the real auth
 * store (the original design intent, mirroring CODEX_HOME/CLAUDE_CONFIG_DIR)
 * reliably hangs OpenCode even with HOMEDRIVE/HOMEPATH/USERPROFILE fully
 * consistent — so there is currently no known way to give OpenCode's OAuth
 * mode access to its real credentials under Windows credential isolation.
 *
 * The actual, verified fix (`workspace-context.ts`): redirect HOMEDRIVE/
 * HOMEPATH alongside USERPROFILE (eliminates the hang class generally), and
 * stop attempting the XDG override for OpenCode specifically. Net effect:
 * OpenCode's OAuth mode now fails FAST (~3-5s) instead of hanging for up to
 * the 30-minute execution timeout — a real, meaningful fix, even though it
 * doesn't make OAuth-mode OpenCode actually succeed under isolation. Users
 * who need OpenCode in an isolated workspace should configure it with
 * auth_type=api_key instead (key injected directly via env var, no file
 * lookup, unaffected by this whole class of issue — see auth-material.test.ts
 * / opencode-adapter.test.ts's existing api_key-mode coverage).
 */
const REAL = !!process.env.REAL_OPENCODE;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!REAL)("Real OpenCode dispatch under credential isolation (post-fix)", () => {
  it("OAuth mode fails fast (not a hang) when HOME/USERPROFILE are redirected for isolation", async () => {
    const services: TestServices = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new OpenCodeAdapter());

    try {
      const project = services.projectService.create("OpenCode-Dispatch-Check");
      services.workspaceService.bind(project.id, tempDir); // push_credentials_enabled=false -> HOME/USERPROFILE/HOMEDRIVE/HOMEPATH redirected
      const { issue } = services.issueService.create(project.id, { title: "OpenCode dispatch check", goal: "Confirm no hang under isolation" });
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "OpenCode", role: "implementation", cli_provider: CliProvider.OpenCode,
        command: "opencode", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: "gpt-5.4", model_provider: "heiyucode-openai",
        status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
      });

      const start = Date.now();
      const run = await services.runDispatchService.dispatch(
        issue.id, adapter.id, "Reply with a one-sentence answer: what is 2+2? Do not run any commands or write any files.",
        RunPurpose.AdHocConsult,
      );

      // If this were still hung, it would still be queued/running at the
      // 20s mark; the fix means it resolves (to some terminal status) well
      // under that, proving the hang is gone — regardless of whether OAuth
      // auth itself succeeds (it doesn't, and can't, under isolation; that's
      // the separately-documented, unfixable-for-now limitation).
      const deadline = Date.now() + 20_000;
      let final = services.runRepo.getById(run.id)!;
      while (Date.now() < deadline && (final.status === RunStatus.Queued || final.status === RunStatus.Running)) {
        await wait(1000);
        final = services.runRepo.getById(run.id)!;
      }
      const elapsedMs = Date.now() - start;

      // eslint-disable-next-line no-console
      console.log("[OpenCode dispatch check] final status:", final.status, "elapsed_ms:", elapsedMs, "error:", final.error_message);

      expect(final.status).not.toBe(RunStatus.Queued);
      expect(final.status).not.toBe(RunStatus.Running);
      expect(elapsedMs).toBeLessThan(20_000);
    } finally {
      disposeTestServices(services);
    }
  }, 30_000);
});
