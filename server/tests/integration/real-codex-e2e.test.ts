import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { IssueStatus, AdapterStatus } from "@personahub/shared/types";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";

// Real Codex end-to-end (F004 T081 seam): only runs with REAL_CODEX=1.
// Drives the FULL server workflow — a deterministic fake implementation (real
// server dispatch, real trace/handoff/verification evidence) auto-triggers a
// REAL Codex validator through requestValidation -> queue drain -> agent-runner
// -> onTerminal -> processValidatorResult, and the Issue must converge to a
// terminal state (Done/Blocked), never hang.
const REAL = !!process.env.REAL_CODEX;

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeScriptPath = join(__testDir, "..", "helpers", "fake-codex.mjs").replace(/\\/g, "/");

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!REAL)("Real Codex end-to-end validation (T081)", () => {
  it("drives implementation evidence through a real validator to a terminal Issue state", async () => {
    const services: TestServices = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new CodexCliAdapter());
    process.env.FAKE_CODEX_MODE = "command_success";

    try {
      // Real files so the validator has something consistent to inspect.
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "acc", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
      mkdirSync(join(tempDir, "src"));
      mkdirSync(join(tempDir, "test"));
      writeFileSync(join(tempDir, "src", "greet.mjs"), "export function greet(n) { return `Hello, ${n}`; }\n");
      writeFileSync(join(tempDir, "test", "greet.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.mjs";\ntest("greets", () => assert.equal(greet("A"), "Hello, A"));\n`);

      const project = services.projectService.create("E2E");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "Verify greeting helper", goal: "greet() returns the expected string and npm test passes" });

      // Relax file-trace requirement: the deterministic fake implementation
      // produces handoff + verification but no file changes.
      services.db.prepare("UPDATE validation_policies SET evidence_requirements_json = ? WHERE id = ?")
        .run(JSON.stringify({ schema_version: 1, require_handoff: true, require_file_trace: false, require_verification: true, accepted_verification_kinds: ["test", "lint", "typecheck", "build"] }), issue.validation_policy_id);

      services.agentConfigRepo.create({ project_id: project.id, name: "Impl (fake)", role: "implementation", cli_provider: "codex", command: "node", args: [fakeScriptPath], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      services.agentConfigRepo.create({ project_id: project.id, name: "Validator (real)", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      const implAdapterId = services.agentConfigRepo.listAvailableByProjectAndRole(project.id, "implementation" as never)[0].id;

      // Dispatch the implementation; the whole chain runs via async callbacks.
      await services.runDispatchService.dispatch(issue.id, implAdapterId, "Run npm test to verify the greeting helper.");

      // Poll until the Issue reaches a terminal validation state.
      const deadline = Date.now() + 260_000;
      let status = "";
      while (Date.now() < deadline) {
        status = services.issueRepo.getById(issue.id)!.status;
        if (status === IssueStatus.Done || status === IssueStatus.Blocked) break;
        await wait(3000);
      }

      // eslint-disable-next-line no-console
      console.log("\n[REAL CODEX e2e] terminal issue status:", status);
      const summary = services.evidenceSummaryRepo.getByIssueId(issue.id);
      if (summary) {
        // eslint-disable-next-line no-console
        console.log("[REAL CODEX e2e] evidence summary present, same_origin:", summary.same_origin_validation, "markdown bytes:", Buffer.byteLength(summary.summary_markdown, "utf8"));
      } else {
        const fresh = services.issueRepo.getById(issue.id)!;
        // eslint-disable-next-line no-console
        console.log("[REAL CODEX e2e] no summary; blocker:", fresh.blocked_reason_code, "-", fresh.blocked_reason_message);
      }

      // The core assertion: the server workflow converged to a terminal state
      // with a real validator — it did not hang in Validating.
      expect([IssueStatus.Done, IssueStatus.Blocked]).toContain(status);
      if (status === IssueStatus.Done) {
        expect(summary).toBeDefined();
        expect(summary!.validation_result).toBe("passed");
        expect(summary!.summary_markdown.length).toBeGreaterThan(0);
      }
    } finally {
      delete process.env.FAKE_CODEX_MODE;
      disposeTestServices(services);
    }
  }, 300_000);
});
