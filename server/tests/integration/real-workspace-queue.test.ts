import { describe, it, expect } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability, CliProvider, AdapterAuthType, RunStatus, RunPurpose } from "@personahub/shared/types";
import { ClaudeCodeAdapter } from "../../src/runtime/adapters/claude-code-adapter.js";

/**
 * T106 (partial, real-CLI slice): two real Claude Code Runs dispatched
 * back-to-back to the same workspace must serialize through the real
 * workspace lock (FIFO), never run concurrently, with a real CLI process
 * actually holding the lock — not just the deterministic fake-adapter
 * coverage in workspace-queue.test.ts. The "restart during grace / Run
 * terminal" half of T106 is intentionally NOT re-verified with real CLIs
 * here: restart recovery is pure DB-state reconciliation (restart-recovery.
 * test.ts, validation-recovery.test.ts) that has no dependency on which
 * CLI was mid-flight when the process died, so real-CLI coverage adds no
 * incremental confidence there proportional to the cost of orchestrating
 * an actual server-process kill/restart against a live CLI call.
 */
const REAL = !!process.env.REAL_CLAUDE;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!REAL)("T106: real workspace FIFO queueing (Claude Code)", () => {
  it("a second Run dispatched while the first is still running queues behind it and never overlaps", async () => {
    const services: TestServices = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new ClaudeCodeAdapter());

    try {
      const project = services.projectService.create("T106-Queue");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "Queue test", goal: "Confirm FIFO with a real CLI" });
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "Claude", role: "implementation", cli_provider: CliProvider.ClaudeCode,
        command: "claude", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
      });

      const run1 = await services.runDispatchService.dispatch(
        issue.id, adapter.id, "Wait a moment, then reply with just the word: first.", RunPurpose.AdHocConsult,
      );
      // dispatch immediately, before run1 can possibly have completed
      const run2 = await services.runDispatchService.dispatch(
        issue.id, adapter.id, "Reply with just the word: second.", RunPurpose.AdHocConsult,
      );

      const run2Immediately = services.runRepo.getById(run2.id)!;
      // eslint-disable-next-line no-console
      console.log("[T106] run2 status immediately after dispatch:", run2Immediately.status);
      expect(run2Immediately.status).toBe(RunStatus.Queued);

      const deadline = Date.now() + 180_000;
      let final1 = services.runRepo.getById(run1.id)!;
      let final2 = services.runRepo.getById(run2.id)!;
      while (Date.now() < deadline && (final2.status === RunStatus.Queued || final2.status === RunStatus.Running || final1.status === RunStatus.Queued || final1.status === RunStatus.Running)) {
        await wait(2000);
        final1 = services.runRepo.getById(run1.id)!;
        final2 = services.runRepo.getById(run2.id)!;
      }

      expect(final1.status).toBe(RunStatus.Completed);
      expect(final2.status).toBe(RunStatus.Completed);
      // FIFO: run2 cannot have started before run1 finished
      expect(new Date(final2.started_at!).getTime()).toBeGreaterThanOrEqual(new Date(final1.completed_at!).getTime());
    } finally {
      disposeTestServices(services);
    }
  }, 240_000);
});
