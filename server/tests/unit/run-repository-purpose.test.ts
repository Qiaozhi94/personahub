import { describe, it, expect } from "vitest";
import { createTestServices, disposeTestServices, createTempDir, type TestServices } from "../helpers.js";
import { RunRole, RunDispatchSource, RunPurpose, RunStatus, AdapterStatus, AgentCapability } from "@personahub/shared/types";

// T023: RunRepository must persist F005's purpose/context_source_run_id for
// real (schema v6 columns), correctly derive workflow_step for consult (null,
// not "implementation"), support filtering workflow-bound vs consult Runs per
// Issue, and never let role be persisted as null/empty (F002/F004's existing
// NOT NULL guarantee, defense-in-depth checked here at the repo boundary).

function setupIssueFixture(services: TestServices) {
  const project = services.projectService.create("T023", "desc");
  services.workspaceService.bind(project.id, createTempDir());
  const { issue } = services.issueService.create(project.id, { title: "T023", goal: "Goal" });
  const adapter = services.agentConfigRepo.create({
    project_id: project.id, name: "Adapter", role: "implementation", cli_provider: "codex",
    command: "codex", args: [], capability_tags: [AgentCapability.Implementation], default_model: null,
    status: AdapterStatus.Available,
  });
  return { project, issue, adapter, threadId: issue.primary_thread_id! };
}

describe("RunRepository purpose / context_source_run_id (T023)", () => {
  it("defaults purpose to workflow_bound and workflow_step to implementation when omitted", () => {
    const services = createTestServices();
    try {
      const { issue, adapter, threadId } = setupIssueFixture(services);

      const run = services.runRepo.create({
        issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
        adapter_config_id: adapter.id, instructions: "do it", status: RunStatus.Queued,
      });

      expect(run.purpose).toBe(RunPurpose.WorkflowBound);
      expect(run.workflow_step).toBe("implementation");
      expect(run.context_source_run_id).toBeNull();
    } finally {
      disposeTestServices(services);
    }
  });

  it("persists an explicit ad_hoc_consult purpose with role=consult and workflow_step=null", () => {
    const services = createTestServices();
    try {
      const { issue, adapter, threadId } = setupIssueFixture(services);

      const run = services.runRepo.create({
        issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
        adapter_config_id: adapter.id, instructions: "look into X", status: RunStatus.Queued,
        role: RunRole.Consult, purpose: RunPurpose.AdHocConsult,
      });

      expect(run.role).toBe(RunRole.Consult);
      expect(run.purpose).toBe(RunPurpose.AdHocConsult);
      expect(run.workflow_step).toBeNull();
    } finally {
      disposeTestServices(services);
    }
  });

  it("workflow_step is 'validation' for role=validator regardless of purpose", () => {
    const services = createTestServices();
    try {
      const { issue, adapter, threadId } = setupIssueFixture(services);

      const run = services.runRepo.create({
        issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
        adapter_config_id: adapter.id, instructions: "validate", status: RunStatus.Queued,
        role: RunRole.Validator, dispatch_source: RunDispatchSource.System,
      });

      expect(run.workflow_step).toBe("validation");
    } finally {
      disposeTestServices(services);
    }
  });

  it("persists and round-trips context_source_run_id", () => {
    const services = createTestServices();
    try {
      const { issue, adapter, threadId } = setupIssueFixture(services);
      const implRun = services.runRepo.create({
        issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
        adapter_config_id: adapter.id, instructions: "impl", status: RunStatus.Completed,
      });

      const consultRun = services.runRepo.create({
        issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
        adapter_config_id: adapter.id, instructions: "consult", status: RunStatus.Queued,
        role: RunRole.Consult, purpose: RunPurpose.AdHocConsult, context_source_run_id: implRun.id,
      });

      expect(consultRun.context_source_run_id).toBe(implRun.id);
      const fetched = services.runRepo.getById(consultRun.id);
      expect(fetched?.context_source_run_id).toBe(implRun.id);
    } finally {
      disposeTestServices(services);
    }
  });

  describe("listByIssueAndPurpose — workflow-bound vs consult filtering", () => {
    it("returns only workflow_bound Runs when filtered by workflow_bound", () => {
      const services = createTestServices();
      try {
        const { issue, adapter, threadId } = setupIssueFixture(services);
        const impl = services.runRepo.create({
          issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
          adapter_config_id: adapter.id, instructions: "impl", status: RunStatus.Completed,
        });
        services.runRepo.create({
          issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
          adapter_config_id: adapter.id, instructions: "consult", status: RunStatus.Queued,
          role: RunRole.Consult, purpose: RunPurpose.AdHocConsult,
        });

        const workflowRuns = services.runRepo.listByIssueAndPurpose(issue.id, RunPurpose.WorkflowBound);

        expect(workflowRuns).toHaveLength(1);
        expect(workflowRuns[0]?.id).toBe(impl.id);
      } finally {
        disposeTestServices(services);
      }
    });

    it("returns only ad_hoc_consult Runs when filtered by ad_hoc_consult", () => {
      const services = createTestServices();
      try {
        const { issue, adapter, threadId } = setupIssueFixture(services);
        services.runRepo.create({
          issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
          adapter_config_id: adapter.id, instructions: "impl", status: RunStatus.Completed,
        });
        const consult = services.runRepo.create({
          issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
          adapter_config_id: adapter.id, instructions: "consult", status: RunStatus.Queued,
          role: RunRole.Consult, purpose: RunPurpose.AdHocConsult,
        });

        const consultRuns = services.runRepo.listByIssueAndPurpose(issue.id, RunPurpose.AdHocConsult);

        expect(consultRuns).toHaveLength(1);
        expect(consultRuns[0]?.id).toBe(consult.id);
      } finally {
        disposeTestServices(services);
      }
    });
  });

  describe("role is never null — DB-level guarantee, checked defensively", () => {
    it("the runs.role column rejects a NULL insert at the raw SQL level", () => {
      const services = createTestServices();
      try {
        const { issue, adapter, threadId } = setupIssueFixture(services);
        const now = new Date().toISOString();

        expect(() =>
          services.db.prepare(
            `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          ).run("run_null_role", issue.id, threadId, issue.workspace_id, adapter.id, "queued", "x", now, now),
        ).toThrow();
      } finally {
        disposeTestServices(services);
      }
    });

    it("repository create() never persists role as an empty string for a consult Run", () => {
      const services = createTestServices();
      try {
        const { issue, adapter, threadId } = setupIssueFixture(services);

        const run = services.runRepo.create({
          issue_id: issue.id, thread_id: threadId, workspace_id: issue.workspace_id,
          adapter_config_id: adapter.id, instructions: "consult", status: RunStatus.Queued,
          role: RunRole.Consult, purpose: RunPurpose.AdHocConsult,
        });

        expect(run.role).toBe("consult");
        expect(run.role).not.toBe("");
        expect(run.role).not.toBeNull();
      } finally {
        disposeTestServices(services);
      }
    });
  });
});
