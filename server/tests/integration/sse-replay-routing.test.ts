import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import {
  IssueStatus, RunRole, RunPurpose, RunDispatchSource, ThreadEventType,
  AdapterAuthType, AdapterStatus, AgentCapability, CliProvider,
} from "@personahub/shared/types";

/**
 * T082: extends T067's SSE-replay coverage (validation-routes.test.ts) to
 * routing metadata — same convention: replay is tested via
 * ThreadEventService.listByThread() (what both the plain /events endpoint
 * and the SSE stream's historical-replay section both call), not the raw
 * text/event-stream wire format.
 */
const CANARY = "sk-CANARY-ROUTING-9f8e7d6c";

describe("T082: SSE replay carries complete routing metadata, identifies consult, and never carries auth material", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });
  afterEach(() => disposeTestServices(services));

  it("run.queued replay for a workflow-bound implementation Run carries full routing metadata", () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
      command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: "gpt-5", status: AdapterStatus.Available,
    });

    const run = services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do it" });

    const events = services.threadEventRepo.listByThread(issue.primary_thread_id!);
    const queued = events.find((e) => e.type === ThreadEventType.RunQueued && e.payload_json.run_id === run.id)!;
    expect(queued).toBeDefined();
    expect(queued.payload_json.purpose).toBe(RunPurpose.WorkflowBound);
    expect(queued.payload_json.role).toBe(RunRole.Implementation);
    expect(queued.payload_json.dispatch_source).toBe(RunDispatchSource.UserExplicit);
    expect(queued.payload_json.adapter_config_id).toBe(adapter.id);
    expect(queued.payload_json.cli_provider).toBe("codex");
    expect(queued.payload_json.context_source_run_id).toBeNull();
    expect(queued.payload_json.drives_issue_state).toBe(true);
  });

  it("run.queued replay for an ad_hoc_consult Run is identifiable as consult and never drives Issue state", () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    services.issueRepo.updateStatus(issue.id, { status: IssueStatus.Running, updatedAt: new Date().toISOString() });
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "Impl", role: "implementation", cli_provider: "codex",
      command: "codex", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: "gpt-5", status: AdapterStatus.Available,
    });

    const run = services.manualRoutingService.dispatch({
      issueId: issue.id, adapterId: adapter.id, instructions: "just a question", purpose: RunPurpose.AdHocConsult,
    });

    const events = services.threadEventRepo.listByThread(issue.primary_thread_id!);
    const queued = events.find((e) => e.type === ThreadEventType.RunQueued && e.payload_json.run_id === run.id)!;
    expect(queued.payload_json.purpose).toBe(RunPurpose.AdHocConsult);
    expect(queued.payload_json.role).toBe(RunRole.Consult);
    expect(queued.payload_json.drives_issue_state).toBe(false);
    expect(services.issueRepo.getById(issue.id)!.status).toBe(IssueStatus.Running); // unchanged
  });

  it("replayed events never carry the adapter's api_key, even for an API-key-auth OpenCode adapter", () => {
    const project = services.projectService.create("Test");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    const adapter = services.agentConfigRepo.create({
      project_id: project.id, name: "OpenCode", role: "implementation", cli_provider: CliProvider.OpenCode,
      command: "opencode", args: [], capability_tags: [AgentCapability.Implementation],
      default_model: "gpt-5", status: AdapterStatus.Available,
      auth_type: AdapterAuthType.ApiKey, model_provider: "openai", api_key: CANARY,
    });

    services.manualRoutingService.dispatch({ issueId: issue.id, adapterId: adapter.id, instructions: "do it" });

    const events = services.threadEventRepo.listByThread(issue.primary_thread_id!);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });
});
