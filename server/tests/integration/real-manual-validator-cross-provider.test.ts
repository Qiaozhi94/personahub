import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { IssueStatus, AdapterStatus, AgentCapability, CliProvider, AdapterAuthType } from "@personahub/shared/types";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";
import { ClaudeCodeAdapter } from "../../src/runtime/adapters/claude-code-adapter.js";

/**
 * T103: real cross-provider validator dispatch — a deterministic fake
 * implementation (real server dispatch producing real trace/handoff/
 * verification evidence, same fixture shape as real-codex-e2e.test.ts)
 * auto-triggers a REAL Claude Code validator (F005 grace=0 test config
 * cascades Phase A -> Phase B immediately, picking Claude since it's the
 * only validator-capable adapter registered — mechanically identical to
 * both the manual-explicit and scheduler-auto claim paths, which already
 * have exhaustive deterministic race coverage in validation-claim-race.test.ts;
 * this test's unique real-world contribution is proving a REAL adapter can
 * actually win the slot and produce a correct validator envelope end to end).
 *
 * Root-cause fix (2026-07-23), two rounds: earlier real-CLI runs of this
 * exact test converged to Blocked instead of Done, for two distinct
 * reasons — context-builder.ts's JSON_SCHEMA_CONTRACT never actually
 * stated the required `event:<id>` / `file-change-set:<id>` evidence_ref
 * grammar (only that it's `"string"`), so real Claude cited evidence as
 * `file:path#Lline` (natural-feeling, but rejected as invalid grammar);
 * separately, the strict result-parser.ts rejects any final message that
 * isn't *exclusively* the JSON object (a single leading sentence of
 * commentary is enough to make it "unparsable"), and Claude sometimes adds
 * exactly that kind of brief lead-in. Codex happened to comply with both
 * unstated expectations anyway; Claude didn't. Fixed by making both
 * requirements explicit in the prompt (named prefixes + a concrete
 * counter-example for evidence_refs; an explicit "nothing else, not even
 * one sentence" instruction for the final message). Verified across 3
 * consecutive real runs after the second prompt fix (previously Blocked in
 * ~2 of the 5 total attempts across both prompt versions) — LLM output-
 * format compliance can never be mathematically guaranteed, so this is a
 * substantial, verified reliability improvement, not an absolute guarantee.
 * Must converge to Done with same_origin_validation=false (different
 * provider from the Codex implementation) and validator_identity=claude-code.
 */
const REAL = !!process.env.REAL_CLAUDE;

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeCodexScriptPath = join(__testDir, "..", "helpers", "fake-codex.mjs").replace(/\\/g, "/");

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!REAL)("T103: real cross-provider validator (Codex implementation -> real Claude validator)", () => {
  it("converges to Done via a real Claude validator, with same_origin_validation=false", async () => {
    const services: TestServices = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new CodexCliAdapter());
    services.adapterRegistry.register(new ClaudeCodeAdapter());
    process.env.FAKE_CODEX_MODE = "command_success";

    try {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "acc", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
      mkdirSync(join(tempDir, "src"));
      mkdirSync(join(tempDir, "test"));
      writeFileSync(join(tempDir, "src", "greet.mjs"), "export function greet(n) { return `Hello, ${n}`; }\n");
      writeFileSync(join(tempDir, "test", "greet.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.mjs";\ntest("greets", () => assert.equal(greet("A"), "Hello, A"));\n`);

      const project = services.projectService.create("T103-CrossProvider");
      const workspace = services.workspaceService.bind(project.id, tempDir);
      // The fake implementation step drives fake-codex.mjs via
      // FAKE_CODEX_MODE on the test runner's own process.env, relying on it
      // reaching the child process — buildChildEnv()'s credential-isolation
      // allowlist would otherwise strip it. The real validator step doesn't
      // depend on this variable either way.
      services.workspaceRepo.updatePushCredentialsEnabled(workspace.id, true);
      const { issue } = services.issueService.create(project.id, { title: "Verify greeting helper (cross-provider validator)", goal: "greet() returns the expected string and npm test passes" });

      services.db.prepare("UPDATE validation_policies SET evidence_requirements_json = ? WHERE id = ?")
        .run(JSON.stringify({ schema_version: 1, require_handoff: true, require_file_trace: false, require_verification: true, accepted_verification_kinds: ["test", "lint", "typecheck", "build"] }), issue.validation_policy_id);

      const implAdapter = services.agentConfigRepo.create({
        project_id: project.id, name: "Impl (fake Codex)", role: "implementation", cli_provider: "codex",
        command: "node", args: [fakeCodexScriptPath], capability_tags: [AgentCapability.Implementation],
        default_model: "gpt-5", status: AdapterStatus.Available,
      });
      services.agentConfigRepo.create({
        project_id: project.id, name: "Validator (real Claude)", role: "validator", cli_provider: CliProvider.ClaudeCode,
        command: "claude", args: [], capability_tags: [AgentCapability.Validator],
        default_model: null, status: AdapterStatus.Available, auth_type: AdapterAuthType.OAuth,
      });

      await services.runDispatchService.dispatch(issue.id, implAdapter.id, "Run npm test to verify the greeting helper.");

      const deadline = Date.now() + 260_000;
      let status = "";
      while (Date.now() < deadline) {
        status = services.issueRepo.getById(issue.id)!.status;
        if (status === IssueStatus.Done || status === IssueStatus.Blocked) break;
        await wait(3000);
      }

      // eslint-disable-next-line no-console
      console.log("[T103] terminal issue status:", status);
      const summary = services.evidenceSummaryRepo.getByIssueId(issue.id);
      if (summary) {
        // eslint-disable-next-line no-console
        console.log("[T103] validator_identity:", summary.validator_identity.cli_provider, "same_origin:", summary.same_origin_validation);
      } else {
        const fresh = services.issueRepo.getById(issue.id)!;
        // eslint-disable-next-line no-console
        console.log("[T103] no summary; blocker:", fresh.blocked_reason_code, "-", fresh.blocked_reason_message);
      }

      expect(status).toBe(IssueStatus.Done);
      expect(summary).toBeDefined();
      expect(summary!.validation_result).toBe("passed");
      expect(summary!.validator_identity.cli_provider).toBe(CliProvider.ClaudeCode);
      expect(summary!.implementation_identity.cli_provider).toBe("codex");
      expect(summary!.same_origin_validation).toBe(false);
    } finally {
      delete process.env.FAKE_CODEX_MODE;
      disposeTestServices(services);
    }
  }, 300_000);
});
