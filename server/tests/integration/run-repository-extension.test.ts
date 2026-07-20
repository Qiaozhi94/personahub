import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { RunStatus, RunRole, RunDispatchSource, AdapterStatus, AgentCapability, type AdapterIdentitySnapshot, type Run } from "@personahub/shared/types";

function makeIdentity(id: string, name: string, model: string | null = "gpt-5"): AdapterIdentitySnapshot {
  return { adapter_config_id: id, name, cli_provider: "codex", default_model: model };
}

function isLater(a: Run, b: Run): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}

describe("RunRepository F004 extension", () => {
  let services: TestServices;
  let tempDir: string;
  let issueId: string;
  let threadId: string;
  let workspaceId: string;
  let implAdapterId: string;
  let valAdapterId: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    issueId = issue.id;
    threadId = issue.primary_thread!.id;
    workspaceId = issue.workspace_id;

    const implAdapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Impl", role: "implementation",
      cli_provider: "codex", command: "codex", args: [], capability_tags: [],
      default_model: "gpt-5", status: AdapterStatus.Available,
    });
    const valAdapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Val", role: "validator",
      cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator],
      default_model: "gpt-5", status: AdapterStatus.Available,
    });
    implAdapterId = implAdapter.id;
    valAdapterId = valAdapter.id;
  });

  afterEach(() => disposeTestServices(services));

  describe("create with role/step/round/source", () => {
    it("creates a validator run with role=validator and derived workflow_step=validation", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "validate",
        status: RunStatus.Queued,
        role: RunRole.Validator,
        dispatch_source: RunDispatchSource.System,
        validation_round: 1,
      });

      expect(run.role).toBe(RunRole.Validator);
      expect(run.workflow_step).toBe("validation");
      expect(run.validation_round).toBe(1);
      expect(run.dispatch_source).toBe(RunDispatchSource.System);
    });

    it("creates an implementation run with role=implementation and derived workflow_step=implementation", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Queued,
        role: RunRole.Implementation,
        dispatch_source: RunDispatchSource.UserExplicit,
      });

      expect(run.role).toBe(RunRole.Implementation);
      expect(run.workflow_step).toBe("implementation");
      expect(run.validation_round).toBeNull();
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
    });

    it("defaults role to implementation and dispatch_source to user_explicit when omitted", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Queued,
      });

      expect(run.role).toBe(RunRole.Implementation);
      expect(run.workflow_step).toBe("implementation");
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.validation_round).toBeNull();
    });

    it("derives workflow_step=validation for role=validator even if not explicitly set", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v",
        status: RunStatus.Queued,
        role: RunRole.Validator,
      });

      expect(run.workflow_step).toBe("validation");
    });
  });

  describe("adapter_identity snapshot at creation", () => {
    it("persists adapter_identity snapshot provided at creation", () => {
      const identity = makeIdentity(implAdapterId, "Impl", "gpt-5");
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Queued,
        role: RunRole.Implementation,
        adapter_identity: identity,
      });

      expect(run.adapter_identity).toEqual(identity);
    });

    it("defaults adapter_identity to null when not provided", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Queued,
      });

      expect(run.adapter_identity).toBeNull();
    });

    it("preserves identity snapshot independent of later adapter config changes", () => {
      const identity = makeIdentity(implAdapterId, "Impl", "gpt-5");
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Queued,
        role: RunRole.Implementation,
        adapter_identity: identity,
      });

      services.agentConfigRepo.update(implAdapterId, {
        name: "Renamed", default_model: "gpt-6",
        updated_at: new Date().toISOString(),
      });

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.adapter_identity).toEqual(identity);
      expect(refetched!.adapter_identity!.name).toBe("Impl");
      expect(refetched!.adapter_identity!.default_model).toBe("gpt-5");
    });
  });

  describe("has_final_message mapping", () => {
    it("returns has_final_message=false for new run", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Queued,
      });

      expect(run.has_final_message).toBe(false);
    });

    it("returns has_final_message=true when final_message is set (via raw SQL)", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Completed,
      });

      services.db.prepare("UPDATE runs SET final_message = ? WHERE id = ?")
        .run("final answer JSON", run.id);

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.has_final_message).toBe(true);
    });

    it("does not expose final_message content in Run type", () => {
      const run = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "do",
        status: RunStatus.Completed,
      });

      services.db.prepare("UPDATE runs SET final_message = ? WHERE id = ?")
        .run("secret content", run.id);

      const refetched = services.runRepo.getById(run.id);
      expect(refetched!.has_final_message).toBe(true);
      expect((refetched as Record<string, unknown>).final_message).toBeUndefined();
    });
  });

  describe("getLatestCompletedByRole", () => {
    it("returns the latest completed implementation run", () => {
      const r1 = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "v1",
        status: RunStatus.Completed,
        role: RunRole.Implementation,
      });
      const r2 = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "v2",
        status: RunStatus.Completed,
        role: RunRole.Implementation,
      });

      const latest = services.runRepo.getLatestCompletedByRole(issueId, RunRole.Implementation);
      const expected = isLater(r1, r2) ? r1 : r2;
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(expected.id);
    });

    it("respects beforeRunId filter", () => {
      const r1 = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "v1",
        status: RunStatus.Completed,
        role: RunRole.Implementation,
      });
      const r2 = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "v2",
        status: RunStatus.Completed,
        role: RunRole.Implementation,
      });

      const [earlier, later] = isLater(r1, r2) ? [r2, r1] : [r1, r2];
      const latest = services.runRepo.getLatestCompletedByRole(issueId, RunRole.Implementation, later.id);
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(earlier.id);
    });

    it("returns null when no completed runs exist for role", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "v1",
        status: RunStatus.Running,
        role: RunRole.Implementation,
      });

      const latest = services.runRepo.getLatestCompletedByRole(issueId, RunRole.Implementation);
      expect(latest).toBeNull();
    });

    it("filters by role - does not return validator runs when asking for implementation", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "validate",
        status: RunStatus.Completed,
        role: RunRole.Validator,
      });

      const latest = services.runRepo.getLatestCompletedByRole(issueId, RunRole.Implementation);
      expect(latest).toBeNull();
    });

    it("returns latest completed validator run", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "impl",
        status: RunStatus.Completed,
        role: RunRole.Implementation,
      });
      const v1 = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v1",
        status: RunStatus.Completed,
        role: RunRole.Validator,
        validation_round: 1,
      });

      const latest = services.runRepo.getLatestCompletedByRole(issueId, RunRole.Validator);
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(v1.id);
    });

    it("excludes non-completed runs", () => {
      const queued = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "queued",
        status: RunStatus.Queued,
        role: RunRole.Implementation,
      });

      const latest = services.runRepo.getLatestCompletedByRole(issueId, RunRole.Implementation);
      expect(latest).toBeNull();
    });
  });

  describe("getActiveValidator", () => {
    it("returns null when no validator runs exist", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "impl",
        status: RunStatus.Running,
        role: RunRole.Implementation,
      });

      expect(services.runRepo.getActiveValidator(issueId)).toBeNull();
    });

    it("returns the queued validator run", () => {
      const v = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v",
        status: RunStatus.Queued,
        role: RunRole.Validator,
        validation_round: 1,
      });

      const active = services.runRepo.getActiveValidator(issueId);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(v.id);
    });

    it("returns the running validator run", () => {
      const v = services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v",
        status: RunStatus.Running,
        role: RunRole.Validator,
        validation_round: 1,
      });

      const active = services.runRepo.getActiveValidator(issueId);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(v.id);
    });

    it("returns null when validator run is terminal (completed)", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v",
        status: RunStatus.Completed,
        role: RunRole.Validator,
        validation_round: 1,
      });

      expect(services.runRepo.getActiveValidator(issueId)).toBeNull();
    });

    it("does not return implementation runs", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "impl",
        status: RunStatus.Running,
        role: RunRole.Implementation,
      });

      expect(services.runRepo.getActiveValidator(issueId)).toBeNull();
    });
  });

  describe("partial unique index on active validator", () => {
    it("prevents second active validator for same issue (queued + running)", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v1",
        status: RunStatus.Queued,
        role: RunRole.Validator,
      });

      expect(() =>
        services.runRepo.create({
          issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
          adapter_config_id: valAdapterId, instructions: "v2",
          status: RunStatus.Running,
          role: RunRole.Validator,
        }),
      ).toThrow();
    });

    it("allows second validator when first is terminal (completed)", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: valAdapterId, instructions: "v1",
        status: RunStatus.Completed,
        role: RunRole.Validator,
        validation_round: 1,
      });

      expect(() =>
        services.runRepo.create({
          issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
          adapter_config_id: valAdapterId, instructions: "v2",
          status: RunStatus.Queued,
          role: RunRole.Validator,
          validation_round: 2,
        }),
      ).not.toThrow();
    });

    it("allows multiple active implementation runs (no unique constraint on implementation)", () => {
      services.runRepo.create({
        issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
        adapter_config_id: implAdapterId, instructions: "i1",
        status: RunStatus.Queued,
        role: RunRole.Implementation,
      });

      expect(() =>
        services.runRepo.create({
          issue_id: issueId, thread_id: threadId, workspace_id: workspaceId,
          adapter_config_id: implAdapterId, instructions: "i2",
          status: RunStatus.Running,
          role: RunRole.Implementation,
        }),
      ).not.toThrow();
    });
  });
});
