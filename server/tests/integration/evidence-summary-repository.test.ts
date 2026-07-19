import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { ValidationOutcome, type AdapterIdentitySnapshot, type ValidationPolicySnapshot } from "@personahub/shared/types";
import { EvidenceSummaryRepository } from "../../src/repositories/evidence-summary.js";
import { AdapterStatus } from "@personahub/shared/types";

function makeIdentity(id: string, name: string, model: string | null): AdapterIdentitySnapshot {
  return { adapter_config_id: id, name, cli_provider: "codex", default_model: model };
}

function makePolicySnapshot(): ValidationPolicySnapshot {
  return {
    policy_id: "vpl_coding_default",
    version: 1,
    max_validation_rounds: 3,
    evidence_requirements: {
      require_handoff: true,
      require_file_trace: true,
      require_verification: true,
      accepted_verification_kinds: ["test", "lint", "typecheck", "build"],
    },
  };
}

describe("EvidenceSummaryRepository", () => {
  let services: TestServices;
  let tempDir: string;
  let repo: EvidenceSummaryRepository;
  let issueId: string;
  let threadId: string;
  let implementationRunId: string;
  let validatorRunId: string;
  let implIdentity: AdapterIdentitySnapshot;
  let valIdentity: AdapterIdentitySnapshot;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Test Project");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "Test", goal: "Goal" });
    issueId = issue.id;
    threadId = issue.primary_thread!.id;

    const implAdapter = services.agentConfigRepo.create({
      project_id: project.id,
      name: "Impl",
      role: "implementation",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [],
      default_model: "gpt-5",
      status: AdapterStatus.Available,
    });
    const valAdapter = services.agentConfigRepo.create({
      project_id: project.id,
      name: "Validator",
      role: "validator",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [],
      default_model: "gpt-5",
      status: AdapterStatus.Available,
    });

    const implRun = services.runRepo.create({
      issue_id: issueId,
      thread_id: threadId,
      workspace_id: issue.workspace_id,
      adapter_config_id: implAdapter.id,
      instructions: "do it",
      status: "completed" as never,
    });
    const valRun = services.runRepo.create({
      issue_id: issueId,
      thread_id: threadId,
      workspace_id: issue.workspace_id,
      adapter_config_id: valAdapter.id,
      instructions: "validate",
      status: "completed" as never,
    });
    implementationRunId = implRun.id;
    validatorRunId = valRun.id;

    implIdentity = makeIdentity(implAdapter.id, "Impl", "gpt-5");
    valIdentity = makeIdentity(valAdapter.id, "Validator", "gpt-5");
    repo = new EvidenceSummaryRepository(services.db);
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  function makeCreateInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      issue_id: issueId,
      thread_id: threadId,
      validator_run_id: validatorRunId,
      implementation_run_id: implementationRunId,
      validation_result: ValidationOutcome.Passed,
      evidence_refs: ["event:validation.passed", "handoff:abc"],
      summary_markdown: "# Summary\n\nGoal done.",
      same_origin_validation: true,
      implementation_identity: implIdentity,
      validator_identity: valIdentity,
      policy_id: "vpl_coding_default",
      policy_version: 1,
      policy_snapshot: makePolicySnapshot(),
      policy_snapshot_hash: "sha256:abc",
      ...overrides,
    };
  }

  describe("createIfAbsent", () => {
    it("creates a new evidence summary and returns it", () => {
      const summary = repo.createIfAbsent(makeCreateInput());

      expect(summary.id).toMatch(/^evs_/);
      expect(summary.issue_id).toBe(issueId);
      expect(summary.thread_id).toBe(threadId);
      expect(summary.validator_run_id).toBe(validatorRunId);
      expect(summary.implementation_run_id).toBe(implementationRunId);
      expect(summary.validation_result).toBe(ValidationOutcome.Passed);
      expect(summary.evidence_refs).toEqual(["event:validation.passed", "handoff:abc"]);
      expect(summary.summary_markdown).toBe("# Summary\n\nGoal done.");
      expect(summary.same_origin_validation).toBe(true);
      expect(summary.policy_id).toBe("vpl_coding_default");
      expect(summary.policy_version).toBe(1);
      expect(summary.policy_snapshot_hash).toBe("sha256:abc");
      expect(summary.created_at).toBeTruthy();
    });

    it("maps implementation identity snapshot from JSON", () => {
      const summary = repo.createIfAbsent(makeCreateInput());

      expect(summary.implementation_identity).toEqual(implIdentity);
      expect(summary.implementation_identity.adapter_config_id).toBe(implIdentity.adapter_config_id);
      expect(summary.implementation_identity.default_model).toBe("gpt-5");
    });

    it("maps validator identity snapshot from JSON", () => {
      const summary = repo.createIfAbsent(makeCreateInput({
        validator_identity: makeIdentity("adp_val2", "Val2", "claude-4"),
      }));

      expect(summary.validator_identity).toEqual(makeIdentity("adp_val2", "Val2", "claude-4"));
    });

    it("maps policy snapshot from JSON", () => {
      const summary = repo.createIfAbsent(makeCreateInput());

      expect(summary.policy_snapshot).toEqual(makePolicySnapshot());
      expect(summary.policy_snapshot.evidence_requirements.accepted_verification_kinds).toEqual(["test", "lint", "typecheck", "build"]);
    });

    it("maps same_origin_validation=false as boolean", () => {
      const summary = repo.createIfAbsent(makeCreateInput({
        same_origin_validation: false,
        validator_identity: makeIdentity("adp_other", "Other", "claude-4"),
      }));

      expect(summary.same_origin_validation).toBe(false);
    });

    it("maps validation_result=failed", () => {
      const summary = repo.createIfAbsent(makeCreateInput({
        validation_result: ValidationOutcome.Failed,
      }));

      expect(summary.validation_result).toBe(ValidationOutcome.Failed);
    });

    it("does not overwrite history when issue already has a summary (createIfAbsent semantics)", () => {
      const first = repo.createIfAbsent(makeCreateInput({
        summary_markdown: "# Original",
        policy_snapshot_hash: "sha256:original",
      }));

      const second = repo.createIfAbsent(makeCreateInput({
        summary_markdown: "# Overwrite Attempt",
        policy_snapshot_hash: "sha256:overwrite",
      }));

      expect(second.id).toBe(first.id);
      expect(second.summary_markdown).toBe("# Original");
      expect(second.policy_snapshot_hash).toBe("sha256:original");
    });

    it("enforces issue_id uniqueness at DB level (no duplicate rows)", () => {
      repo.createIfAbsent(makeCreateInput());

      const rows = services.db.prepare("SELECT COUNT(*) as c FROM evidence_summaries WHERE issue_id = ?").get(issueId) as { c: number };
      expect(rows.c).toBe(1);
    });
  });

  describe("getByIssueId", () => {
    it("returns the summary for the issue", () => {
      const created = repo.createIfAbsent(makeCreateInput());

      const found = repo.getByIssueId(issueId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.implementation_identity).toEqual(implIdentity);
      expect(found!.validator_identity).toEqual(valIdentity);
      expect(found!.policy_snapshot).toEqual(makePolicySnapshot());
    });

    it("returns null when issue has no summary", () => {
      const found = repo.getByIssueId("iss_nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("getById", () => {
    it("returns the summary by id", () => {
      const created = repo.createIfAbsent(makeCreateInput());

      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.issue_id).toBe(issueId);
    });

    it("returns null for unknown id", () => {
      const found = repo.getById("evs_nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("identity snapshot independence", () => {
    it("preserves identity snapshots independent of current adapter config", () => {
      const summary = repo.createIfAbsent(makeCreateInput());

      services.agentConfigRepo.update(implIdentity.adapter_config_id, {
        name: "Renamed",
        default_model: "gpt-6",
        updated_at: new Date().toISOString(),
      });

      const refetched = repo.getById(summary.id);
      expect(refetched!.implementation_identity.name).toBe("Impl");
      expect(refetched!.implementation_identity.default_model).toBe("gpt-5");
    });
  });

  describe("evidence_refs mapping", () => {
    it("stores and returns evidence_refs as string array", () => {
      const refs = ["event:validation.passed", "handoff:run_1", "file-change-set:run_1", "test:run_1:cmd_1"];
      const summary = repo.createIfAbsent(makeCreateInput({ evidence_refs: refs }));

      expect(summary.evidence_refs).toEqual(refs);
    });

    it("handles empty evidence_refs array", () => {
      const summary = repo.createIfAbsent(makeCreateInput({ evidence_refs: [] }));
      expect(summary.evidence_refs).toEqual([]);
    });
  });
});
