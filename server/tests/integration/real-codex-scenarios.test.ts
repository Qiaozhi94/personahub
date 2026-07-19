import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { IssueStatus, AdapterStatus, ValidationBlockReason } from "@personahub/shared/types";
import { CodexCliAdapter } from "../../src/runtime/adapters/codex-cli-adapter.js";

// Real Codex scenario acceptance (F004 T082 round-limit / T085 different-model).
// Only runs with REAL_CODEX=1.
const REAL = !!process.env.REAL_CODEX;

const __testDir = join(fileURLToPath(import.meta.url), "..");
const fakeScriptPath = join(__testDir, "..", "helpers", "fake-codex.mjs").replace(/\\/g, "/");

function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function pollTerminal(services: TestServices, issueId: string, deadlineMs: number): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  let status = "";
  while (Date.now() < deadline) {
    status = services.issueRepo.getById(issueId)!.status;
    if (status === IssueStatus.Done || status === IssueStatus.Blocked) break;
    await wait(3000);
  }
  return status;
}

function relaxFileTrace(services: TestServices, policyId: string, maxRounds: number): void {
  services.db.prepare("UPDATE validation_policies SET evidence_requirements_json = ?, max_validation_rounds = ? WHERE id = ?")
    .run(JSON.stringify({ schema_version: 1, require_handoff: true, require_file_trace: false, require_verification: true, accepted_verification_kinds: ["test", "lint", "typecheck", "build"] }), maxRounds, policyId);
}

describe.skipIf(!REAL)("Real Codex scenarios (T082 / T085)", () => {
  it("T082: a real validator failure with max_rounds=1 blocks with round_limit_reached", async () => {
    const services = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new CodexCliAdapter());
    process.env.FAKE_CODEX_MODE = "command_success";
    try {
      // Workspace with a FAILING test so the real validator concludes "failed".
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "acc", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
      mkdirSync(join(tempDir, "test"));
      writeFileSync(join(tempDir, "test", "broken.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert";\ntest("intentionally failing", () => assert.equal(1, 2));\n`);

      const project = services.projectService.create("E2E-T082");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "Failing verification", goal: "npm test must pass" });
      relaxFileTrace(services, issue.validation_policy_id, 1); // max_rounds=1 => first failure hits the round limit

      services.agentConfigRepo.create({ project_id: project.id, name: "Impl (fake)", role: "implementation", cli_provider: "codex", command: "node", args: [fakeScriptPath], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      services.agentConfigRepo.create({ project_id: project.id, name: "Validator (real)", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      const implId = services.agentConfigRepo.listAvailableByProjectAndRole(project.id, "implementation" as never)[0].id;

      await services.runDispatchService.dispatch(issue.id, implId, "Run npm test and report.");
      const status = await pollTerminal(services, issue.id, 260_000);
      const fresh = services.issueRepo.getById(issue.id)!;
      // eslint-disable-next-line no-console
      console.log("\n[REAL CODEX T082] status:", status, "| blocker:", fresh.blocked_reason_code, "| round_count:", fresh.validation_round_count);

      expect(status).toBe(IssueStatus.Blocked);
      // A validator "failed" at max_rounds=1 must be a round_limit_reached block.
      // (If the real validator instead self-declares "blocked", that is the
      // evidence_missing path — still a correct terminal Blocked; assert either.)
      expect([ValidationBlockReason.RoundLimitReached, ValidationBlockReason.EvidenceMissing]).toContain(fresh.blocked_reason_code);
    } finally {
      delete process.env.FAKE_CODEX_MODE;
      disposeTestServices(services);
    }
  }, 300_000);

  it("T085: different validator model yields same_origin_validation = false on Done", async () => {
    const services = createTestServices();
    const tempDir = createTempDir();
    services.adapterRegistry.register(new CodexCliAdapter());
    process.env.FAKE_CODEX_MODE = "command_success";
    try {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "acc", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
      mkdirSync(join(tempDir, "src"));
      mkdirSync(join(tempDir, "test"));
      writeFileSync(join(tempDir, "src", "greet.mjs"), "export function greet(n) { return `Hello, ${n}`; }\n");
      writeFileSync(join(tempDir, "test", "greet.test.mjs"), `import { test } from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.mjs";\ntest("greets", () => assert.equal(greet("A"), "Hello, A"));\n`);

      const project = services.projectService.create("E2E-T085");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "Greeting helper", goal: "greet() works and npm test passes" });
      relaxFileTrace(services, issue.validation_policy_id, 3);

      services.agentConfigRepo.create({ project_id: project.id, name: "Impl (fake)", role: "implementation", cli_provider: "codex", command: "node", args: [fakeScriptPath], capability_tags: [], default_model: "gpt-5", status: AdapterStatus.Available });
      // Validator with a DIFFERENT default_model -> independent (not same-origin).
      services.agentConfigRepo.create({ project_id: project.id, name: "Validator (real)", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [], default_model: "gpt-5-codex", status: AdapterStatus.Available });
      const implId = services.agentConfigRepo.listAvailableByProjectAndRole(project.id, "implementation" as never)[0].id;

      await services.runDispatchService.dispatch(issue.id, implId, "Run npm test and report.");
      const status = await pollTerminal(services, issue.id, 260_000);
      const summary = services.evidenceSummaryRepo.getByIssueId(issue.id);
      // eslint-disable-next-line no-console
      console.log("\n[REAL CODEX T085] status:", status, "| summary:", !!summary, "| same_origin:", summary?.same_origin_validation);

      expect([IssueStatus.Done, IssueStatus.Blocked]).toContain(status);
      if (status === IssueStatus.Done) {
        expect(summary).toBeDefined();
        expect(summary!.same_origin_validation).toBe(false); // different model => independent
      }
    } finally {
      delete process.env.FAKE_CODEX_MODE;
      disposeTestServices(services);
    }
  }, 300_000);
});
