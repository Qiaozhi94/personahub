import { describe, it, expect } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability, CliProvider, AdapterAuthType, IssueStatus, RunRole, RunPurpose, RunDispatchSource, ThreadEventType, RunStatus } from "@personahub/shared/types";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";
import { ClaudeCodeAdapter } from "../../src/runtime/adapters/claude-code-adapter.js";

/**
 * T102: real, sequential same-Issue dispatch across providers. Deliberately
 * uses explicit ad_hoc_consult for every round — a workflow-bound
 * implementation completion would immediately cascade into F005's Phase A/B
 * validator dispatch (grace=0 in createTestServices()), which would either
 * block the Issue (no validator adapter registered) or drag in F004's full
 * validator-envelope machinery — already proven separately by
 * real-codex-e2e.test.ts. This test's job is narrower and still fully real:
 * prove the routing/consult/audit mechanics hold across different live CLI
 * backends on one Issue, never drives Issue state, and each round's Thread
 * record correctly reflects which real adapter ran it.
 *
 * OpenCode is deliberately excluded from this real dispatch chain: real-
 * environment testing (2026-07-22) found OpenCode CLI 1.18.3 hangs
 * indefinitely on Windows when HOME/USERPROFILE is redirected for
 * credential isolation, even with XDG_DATA_HOME/XDG_CONFIG_HOME correctly
 * pointed at the real auth store (root cause not yet isolated — see
 * tasks.md T101 note). OpenCode's real auth availability is independently
 * proven by real-claude-opencode-probe.test.ts, whose validate() path
 * inherits the full environment and is unaffected by this gap.
 */
const REAL = !!(process.env.REAL_CODEX && process.env.REAL_CLAUDE);

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!REAL)("T102: real sequential Codex -> Claude consult on one Issue", () => {
  it("each real provider completes a consult Run without ever changing Issue status, with a complete, correctly-attributed Thread audit trail", async () => {
    const services: TestServices = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new CodexCliAdapter());
    services.adapterRegistry.register(new ClaudeCodeAdapter());

    try {
      const project = services.projectService.create("T102-MultiProvider");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, {
        title: "Multi-provider consult smoke test", goal: "Prove routing works across real CLIs",
      });
      expect(issue.status).toBe(IssueStatus.Inbox);

      const codex = services.agentConfigRepo.create({
        project_id: project.id, name: "Codex", role: "implementation", cli_provider: CliProvider.Codex,
        command: "codex", args: [], capability_tags: [AgentCapability.Implementation], default_model: null,
        status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
      });
      const claude = services.agentConfigRepo.create({
        project_id: project.id, name: "Claude", role: "implementation", cli_provider: CliProvider.ClaudeCode,
        command: "claude", args: [], capability_tags: [AgentCapability.Implementation], default_model: null,
        status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
      });

      const rounds = [
        { adapter: codex, provider: CliProvider.Codex },
        { adapter: claude, provider: CliProvider.ClaudeCode },
      ];

      for (const { adapter, provider } of rounds) {
        const run = await services.runDispatchService.dispatch(
          issue.id, adapter.id, "Reply with a one-sentence answer: what is 2+2? Do not run any commands or write any files.",
          RunPurpose.AdHocConsult,
        );
        const deadline = Date.now() + 180_000;
        let final = services.runRepo.getById(run.id)!;
        while (Date.now() < deadline && (final.status === RunStatus.Queued || final.status === RunStatus.Running)) {
          await wait(2000);
          final = services.runRepo.getById(run.id)!;
        }
        // eslint-disable-next-line no-console
        console.log(`[T102] ${provider} consult run -> ${final.status}`);
        expect(final.status).toBe(RunStatus.Completed);
        expect(final.role).toBe(RunRole.Consult);
        expect(final.purpose).toBe(RunPurpose.AdHocConsult);
        expect(final.dispatch_source).toBe(RunDispatchSource.UserExplicit);
        expect(final.adapter_identity?.cli_provider).toBe(provider);

        // consult never drives Issue state, regardless of which real provider ran it
        const freshIssue = services.issueRepo.getById(issue.id)!;
        expect(freshIssue.status).toBe(IssueStatus.Inbox);
      }

      const events = services.threadEventRepo.listByThread(issue.primary_thread_id!);
      const queuedEvents = events.filter((e) => e.type === ThreadEventType.RunQueued);
      expect(queuedEvents).toHaveLength(2);
      const providersSeen = queuedEvents.map((e) => e.payload_json.cli_provider);
      expect(providersSeen).toEqual([CliProvider.Codex, CliProvider.ClaudeCode]);
      const completedEvents = events.filter((e) => e.type === ThreadEventType.RunCompleted);
      expect(completedEvents).toHaveLength(2);
    } finally {
      disposeTestServices(services);
    }
  }, 600_000);
});
