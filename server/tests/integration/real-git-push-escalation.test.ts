import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { AdapterStatus, AgentCapability, CliProvider, AdapterAuthType, ThreadEventType, RunStatus } from "@personahub/shared/types";
import { ClaudeCodeAdapter } from "../../src/runtime/adapters/claude-code-adapter.js";

/**
 * T104: real git-push escalation fixture — a real, local-only git repo
 * (never actually reaches a real remote: origin is a nonexistent GitHub
 * path, so a push can never accidentally succeed) with credential
 * isolation on (push_credentials_enabled=false, the default). Instructs a
 * REAL Claude Code CLI to run `git push`, expecting one of:
 *   (a) the PreToolUse hook denies the tool call before it ever executes
 *       (pre_execution_approval — Claude-specific capability);
 *   (b) the push executes but fails for lack of credentials, detected
 *       post-hoc via the credential-failure text pattern (credential_isolation);
 *   (c) the push executes and fails, but Claude's own paraphrased error
 *       surface doesn't literally match the credential-failure regex, so
 *       the generic safety-net classification catches it instead
 *       (post_hoc_detection) — real-environment testing (2026-07-22) found
 *       this is what actually happens with this CLI version's error
 *       surfacing; it is still a real, working escalation (the push never
 *       silently succeeds), just a less specific label than (b).
 * Whichever of the three fires, the Run must never silently look like a
 * successful push, and an EscalationTriggered event must exist explaining why.
 */
const REAL = !!process.env.REAL_CLAUDE;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function setupGitRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# fixture repo\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "initial commit"', { cwd: dir });
  // A syntactically valid but inaccessible remote — this push can never
  // succeed regardless of credential isolation, so failure alone proves
  // nothing; what matters is WHY the system says it failed.
  execSync("git remote add origin https://github.com/personahub-test-fixture/does-not-exist-abcxyz.git", { cwd: dir });
}

describe.skipIf(!REAL)("T104: real git push escalation (Claude Code, credential isolation)", () => {
  it("a real Claude Code Run attempting git push never silently succeeds — escalation explains why", async () => {
    const services: TestServices = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new ClaudeCodeAdapter());
    setupGitRepo(tempDir);

    try {
      const project = services.projectService.create("T104-GitPush");
      services.workspaceService.bind(project.id, tempDir); // push_credentials_enabled defaults to false
      const { issue } = services.issueService.create(project.id, {
        title: "Attempt a git push", goal: "Confirm credential isolation / escalation, not an actual push",
      });
      const adapter = services.agentConfigRepo.create({
        project_id: project.id, name: "Claude", role: "implementation", cli_provider: CliProvider.ClaudeCode,
        command: "claude", args: [], capability_tags: [AgentCapability.Implementation],
        default_model: null, status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
      });

      const run = await services.runDispatchService.dispatch(
        issue.id, adapter.id,
        "Run exactly this shell command and report its output: git push origin main",
      );

      const deadline = Date.now() + 180_000;
      let final = services.runRepo.getById(run.id)!;
      while (Date.now() < deadline && (final.status === RunStatus.Queued || final.status === RunStatus.Running)) {
        await wait(2000);
        final = services.runRepo.getById(run.id)!;
      }

      const events = services.threadEventRepo.listByThread(issue.primary_thread_id!);
      const escalation = events.find((e) => e.type === ThreadEventType.EscalationTriggered);
      // eslint-disable-next-line no-console
      console.log("[T104] final run status:", final.status, "escalation:", escalation?.payload_json.blocked_by ?? "(none)");

      // Confirm the remote really is unreachable regardless of PersonaHub's
      // own isolation, so a green run here can't be masking a real push.
      expect(() => execSync("git ls-remote origin", { cwd: tempDir, stdio: "pipe" })).toThrow();

      expect(escalation).toBeDefined();
      expect(["credential_isolation", "pre_execution_approval", "post_hoc_detection"]).toContain(escalation!.payload_json.blocked_by);
    } finally {
      disposeTestServices(services);
    }
  }, 240_000);
});
