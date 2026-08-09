import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const { state } = vi.hoisted(() => ({ state: { defAvailable: false } }));

vi.mock("../../src/runtime/graph/definitions.js", () => ({
  getDefinition: () =>
    state.defAvailable ? { id: "wgd_coding_dual_review", version: 1, nodes: [], edges: [], targetGlobs: [] } : null,
  WGD_CODING_DUAL_REVIEW_V1: { id: "wgd_coding_dual_review", version: 1 },
}));

import {
  createTestServices,
  createTempDir,
  cleanupTempDir,
  disposeTestServices,
  type TestServices,
} from "../helpers.js";
import { IntakeConfirmationRepository } from "../../src/repositories/intake-confirmation.js";
import { IntakeService } from "../../src/services/intake-service.js";
import { GraphNodeInstructionBuilder } from "../../src/runtime/graph/instruction-builder.js";
import { ErrorCode } from "@personahub/shared/errors";
import { AdapterStatus, AgentCapability, type ChosenPlan } from "@personahub/shared/types";
import type { AppError } from "../../src/api/errors.js";

function expectThrowCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect((e as AppError).code).toBe(code);
    return;
  }
  expect.fail("expected function to throw");
}

async function expectRejectChanged(promise: Promise<unknown>, code: ErrorCode, field: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const appErr = e as AppError;
    expect(appErr.code).toBe(code);
    expect((appErr.details?.changed as string[]) ?? []).toContain(field);
    return;
  }
  expect.fail("expected promise to reject");
}

describe("F007 recommend when the graph definition is unavailable", () => {
  let services: TestServices;
  let intake: IntakeService;
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    state.defAvailable = false;
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Intake");
    services.workspaceService.bind(project.id, tempDir);
    projectId = project.id;
    services.agentConfigRepo.create({
      project_id: projectId,
      name: "Impl",
      role: "implementation",
      cli_provider: "codex",
      command: "codex",
      args: [],
      capability_tags: [AgentCapability.Implementation],
      default_model: null,
      status: AdapterStatus.Available,
    });
    const adapterDeps = {
      agentConfigRepo: services.agentConfigRepo,
      projectRepo: services.projectRepo,
      adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo,
    };
    intake = new IntakeService({
      db: services.db,
      tokenService: services.tokenService,
      recommendationService: services.recommendationService,
      confirmationRepo: new IntakeConfirmationRepository(services.db),
      projectRepo: services.projectRepo,
      workspaceRepo: services.workspaceRepo,
      threadEventService: services.threadEventService,
      issueService: services.issueService,
      sequentialDeps: {
        runRepo: services.runRepo,
        issueRepo: services.issueRepo,
        agentConfigRepo: services.agentConfigRepo,
        threadEventService: services.threadEventService,
        adapterDeps,
      },
      graphDeps: {
        graphRunRepo: services.graphRunRepo,
        nodeRunRepo: services.nodeRunRepo,
        runRepo: services.runRepo,
        issueRepo: services.issueRepo,
        threadEventService: services.threadEventService,
        adapterDeps,
        instructionBuilder: new GraphNodeInstructionBuilder(),
        drainWorkspace: async () => {},
      },
      drainWorkspace: async () => {},
    });
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  it("review keyword with no graph definition blocks with TOPOLOGY_NOT_EXECUTABLE (not a 500)", () => {
    expectThrowCode(
      () => services.recommendationService.recommend(projectId, "do a thorough code review of concurrency"),
      ErrorCode.TOPOLOGY_NOT_EXECUTABLE,
    );
  });

  it("non-review goal with no graph definition returns a sequential-only response", () => {
    const res = services.recommendationService.recommend(projectId, "implement the payment retry");
    expect(res.collaboration_topology.value.value).toBe("sequential");
    expect(res.rosters_by_topology.sequential).toBeDefined();
    expect(res.rosters_by_topology.orchestrator_subagent).toBeUndefined();
    expect(Object.keys(res.agent_roster.value)).toEqual(["sequential"]);
  });

  it("graph definition disappearing after recommend returns RECOMMENDATION_STALE with changed graph_definition_id", async () => {
    state.defAvailable = true;
    const adapterId = services.agentConfigRepo.listByProject(projectId)[0].id;
    const res = services.recommendationService.recommend(projectId, "review concurrency");
    expect(res.collaboration_topology.value.value).toBe("orchestrator_subagent");
    const nodeKeys = Object.keys(res.agent_roster.by_node);
    const nodeAssignments: Record<string, string> = {};
    for (const key of nodeKeys) nodeAssignments[key] = adapterId;
    const chosen: ChosenPlan = {
      topology: "orchestrator_subagent",
      definition_id: "wgd_coding_dual_review",
      definition_version: 1,
      node_assignments: nodeAssignments,
    };
    state.defAvailable = false;
    await expectRejectChanged(
      intake.confirm(projectId, res.token, chosen),
      ErrorCode.RECOMMENDATION_STALE,
      "graph_definition_id",
    );
    const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
    expect(issues.c).toBe(0);
  });
});
