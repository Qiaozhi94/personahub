import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/migrations.js";
import {
  createTestServices,
  createTempDir,
  cleanupTempDir,
  disposeTestServices,
  type TestServices,
} from "../helpers.js";
import { IntakeService, type IntakeServiceOptions } from "../../src/services/intake-service.js";
import {
  IntakeConfirmationRepository,
  type IntakeConfirmationRecord,
} from "../../src/repositories/intake-confirmation.js";
import { GraphNodeInstructionBuilder } from "../../src/runtime/graph/instruction-builder.js";
import { ErrorCode } from "@personahub/shared/errors";
import type { AppError } from "../../src/api/errors.js";
import {
  AdapterStatus,
  AgentCapability,
  IssueStatus,
  RunStatus,
  RunRole,
  RunDispatchSource,
  ThreadEventType,
  type ChosenPlan,
  type ConfirmationToken,
} from "@personahub/shared/types";

const NOW_ISO = new Date().toISOString();

function expectThrowCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect((e as AppError).code).toBe(code);
    return;
  }
  expect.fail("expected function to throw");
}

async function expectRejectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  try {
    await promise;
  } catch (e) {
    expect((e as AppError).code).toBe(code);
    return;
  }
  expect.fail("expected promise to reject");
}

function addAdapter(
  services: TestServices,
  projectId: string,
  opts: { name: string; capabilities: AgentCapability[]; status?: AdapterStatus },
): string {
  const record = services.agentConfigRepo.create({
    project_id: projectId,
    name: opts.name,
    role: opts.capabilities.includes(AgentCapability.Validator) ? "validator" : "implementation",
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: opts.capabilities,
    default_model: null,
    status: opts.status ?? AdapterStatus.Available,
  });
  return record.id;
}

function buildNoopDrainIntake(
  services: TestServices,
  drain: (wsId: string) => Promise<void> = async () => {},
  testHooks?: IntakeServiceOptions["testHooks"],
  confirmationRepo: IntakeConfirmationRepository = new IntakeConfirmationRepository(services.db),
): IntakeService {
  const adapterDeps = {
    agentConfigRepo: services.agentConfigRepo,
    projectRepo: services.projectRepo,
    adapterWorkspaceStatusRepo: services.adapterWorkspaceStatusRepo,
  };
  return new IntakeService({
    db: services.db,
    tokenService: services.tokenService,
    recommendationService: services.recommendationService,
    confirmationRepo,
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
      drainWorkspace: drain,
    },
    drainWorkspace: drain,
    testHooks,
  });
}

describe("F007 intake: recommend + confirm", () => {
  let services: TestServices;
  let intake: IntakeService;
  let tempDir: string;
  let projectId: string;
  let workspaceId: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
    const project = services.projectService.create("Intake Project");
    services.workspaceService.bind(project.id, tempDir);
    projectId = project.id;
    workspaceId = services.projectRepo.getById(project.id)!.default_workspace_id!;
    intake = buildNoopDrainIntake(services);
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  function recommend(goal: string) {
    return services.recommendationService.recommend(projectId, goal);
  }

  describe("recommend — structure, determinism, no side effects (T012/T014/T015)", () => {
    it("returns the full five-dimension response with a signed token", () => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      const res = recommend("fix the login bug");
      expect(res.issue_type.value).toBe("coding");
      expect(res.issue_draft.title.value).toBe("fix the login bug");
      expect(res.issue_draft.goal.value).toBe("fix the login bug");
      expect(res.workflow_template.value.id).toBe("wft_coding_default");
      expect(res.editable).toEqual(["collaboration_topology", "agent_roster"]);
      expect(res.token.signature).toBeTruthy();
      expect(res.token.payload.nonce).toBeTruthy();
      expect(res.recommendation_id).toBeTruthy();
      expect(res.token.payload.recommended.issue_type.value).toBe("coding");
      expect(res.token.payload.recommended.issue_draft.title.value).toBe("fix the login bug");
    });

    it("T015: recommend writes nothing (no issues/threads/runs/events)", () => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      const count = (t: string) => services.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number };
      recommend("do a thing");
      expect(count("issues").c).toBe(0);
      expect(count("threads").c).toBe(0);
      expect(count("runs").c).toBe(0);
      expect(count("thread_events").c).toBe(0);
      expect(count("intake_confirmations").c).toBe(0);
    });

    it("T014: deterministic — same state produces identical recommended + premise", () => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      const a = recommend("fix the login bug");
      const b = recommend("fix the login bug");
      expect(a.recommended).toEqual(b.recommended);
      expect(a.token.payload.premise).toEqual(b.token.payload.premise);
      expect(a.token.payload.nonce).not.toBe(b.token.payload.nonce);
      expect(a.recommendation_id).not.toBe(b.recommendation_id);
    });

    it("T013b: a single available adapter can still recommend orchestrator_subagent", () => {
      addAdapter(services, projectId, { name: "only", capabilities: [AgentCapability.Implementation] });
      const res = recommend("please do a thorough code review of the concurrency path");
      expect(res.collaboration_topology.value.value).toBe("orchestrator_subagent");
      expect(res.collaboration_topology.value.definition_id).toBe("wgd_coding_dual_review");
      const nodeKeys = Object.keys(res.agent_roster.by_node);
      expect(nodeKeys).toContain("synthesize_findings");
      for (const key of nodeKeys) {
        expect(res.agent_roster.value[key]).toBeTruthy();
      }
    });

    it("non-review goal recommends sequential", () => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      const res = recommend("implement the payment retry");
      expect(res.collaboration_topology.value.value).toBe("sequential");
      expect(Object.keys(res.agent_roster.value)).toEqual(["sequential"]);
    });

    it("T013c: no implementation-capable adapter blocks with NO_AVAILABLE_CAPABLE_ADAPTER", () => {
      addAdapter(services, projectId, { name: "validator-only", capabilities: [AgentCapability.Validator] });
      expectThrowCode(() => recommend("do a thing"), ErrorCode.NO_AVAILABLE_CAPABLE_ADAPTER);
    });

    it("no available adapter blocks with NO_AVAILABLE_ADAPTER", () => {
      addAdapter(services, projectId, {
        name: "unknown",
        capabilities: [AgentCapability.Implementation],
        status: AdapterStatus.Unknown,
      });
      expectThrowCode(() => recommend("do a thing"), ErrorCode.NO_AVAILABLE_ADAPTER);
    });

    it("M7: no active workflow template blocks with TOPOLOGY_NOT_EXECUTABLE", () => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      services.db.prepare("UPDATE workflow_templates SET status = 'inactive' WHERE id = 'wft_coding_default'").run();
      expectThrowCode(() => recommend("do a thing"), ErrorCode.TOPOLOGY_NOT_EXECUTABLE);
    });

    it("project without default workspace blocks with PROJECT_WORKSPACE_REQUIRED", () => {
      const orphan = services.projectService.create("No Workspace");
      expectThrowCode(
        () => services.recommendationService.recommend(orphan.id, "do a thing"),
        ErrorCode.PROJECT_WORKSPACE_REQUIRED,
      );
    });

    it("T013: workspace-level unavailable adapter lands in excluded with workspace reason", () => {
      addAdapter(services, projectId, { name: "a", capabilities: [AgentCapability.Implementation] });
      const overridden = addAdapter(services, projectId, {
        name: "b",
        capabilities: [AgentCapability.Implementation],
      });
      services.adapterWorkspaceStatusRepo.upsert({
        adapter_config_id: overridden,
        workspace_id: workspaceId,
        status: AdapterStatus.Unavailable,
        last_checked_at: NOW_ISO,
        auth_status_message: null,
      });
      const res = recommend("fix the login bug");
      const roster = res.agent_roster.by_node.sequential;
      expect(roster.candidates).not.toContain(overridden);
      const ex = roster.excluded.find((e) => e.id === overridden);
      expect(ex).toBeDefined();
      expect(ex!.reason.toLowerCase()).toContain("workspace");
    });
  });

  describe("IssueDraft rules (T011b/T011c)", () => {
    beforeEach(() => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
    });

    it("title derives from first non-empty line and collapses whitespace", () => {
      const res = recommend("\n  Implement   retry  \nsecond line\n");
      expect(res.issue_draft.title.value).toBe("Implement retry");
      expect(res.issue_draft.goal.value).toBe("Implement   retry  \nsecond line");
    });

    it("title truncates at 120 chars with ellipsis", () => {
      const long = "x".repeat(200);
      const res = recommend(long);
      expect(res.issue_draft.title.value).toHaveLength(120);
      expect(res.issue_draft.title.value.endsWith("…")).toBe(true);
      expect(res.issue_draft.title.value.slice(0, -1)).toHaveLength(119);
    });

    it("title truncation does not split an emoji surrogate pair", () => {
      const emoji = "😀".repeat(150);
      const res = recommend(emoji);
      const value = res.issue_draft.title.value;
      expect(Array.from(value)).toHaveLength(120);
      expect(value.endsWith("…")).toBe(true);
    });

    it("priority defaults to normal", () => {
      const res = recommend("anything");
      expect(res.issue_draft.priority.value).toBe("normal");
    });
  });

  describe("confirm — sequential branch (T021/T020f/T020g/T024)", () => {
    function setupSequential() {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = recommend("implement the payment retry");
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      return { res, chosen, adapterId };
    }

    it("creates Issue, Run, coordinator event, and confirmation row; returns ids", async () => {
      const { res, chosen } = setupSequential();
      const confirmRes = await intake.confirm(projectId, res.token, chosen);
      expect(confirmRes.response.target_kind).toBe("run");
      expect(confirmRes.response.issue_id).toBeTruthy();
      expect(confirmRes.response.target_id).toBeTruthy();

      const issue = services.issueRepo.getById(confirmRes.response.issue_id)!;
      expect(issue.status).toBe(IssueStatus.Running);
      expect(issue.workspace_id).toBe(workspaceId);

      const run = services.runRepo.getById(confirmRes.response.target_id)!;
      expect(run.issue_id).toBe(issue.id);
      expect(run.role).toBe(RunRole.Implementation);
      expect(run.status).toBe(RunStatus.Queued);

      const row = services.intakeConfirmationRepo.getByNonce(res.token.payload.nonce)!;
      expect(row.issue_id).toBe(issue.id);
      expect(row.target_kind).toBe("run");
      expect(row.target_id).toBe(run.id);

      const events = services.threadEventRepo.listByThread(issue.primary_thread_id!) as unknown as {
        type: string;
        payload_json: Record<string, unknown>;
      }[];
      const coordEvent = events.find((e) => e.type === ThreadEventType.CoordinatorRecommendationApplied);
      expect(coordEvent).toBeDefined();
      const payload = coordEvent!.payload_json as {
        rules: string[];
        chosen: ChosenPlan;
        diff: unknown[];
        recommended: { issue_type: { value: string } };
      };
      expect(Array.isArray(payload.rules)).toBe(true);
      expect(payload.chosen).toEqual(chosen);
      expect(payload.diff).toEqual([]);
      // T020e: the event's issue type matches the signed recommendation.
      expect(payload.recommended.issue_type.value).toBe("coding");
      expect(payload.recommended.issue_type.value).toBe(res.issue_type.value);
    });

    it("T020f: token goal === issue goal === run instructions", async () => {
      const { res, chosen } = setupSequential();
      const confirmRes = await intake.confirm(projectId, res.token, chosen);
      const tokenGoal = res.token.payload.recommended.issue_draft.goal.value;
      const issue = services.issueRepo.getById(confirmRes.response.issue_id)!;
      const run = services.runRepo.getById(confirmRes.response.target_id)!;
      expect(issue.goal).toBe(tokenGoal);
      expect(run.instructions).toBe(tokenGoal);
    });

    it("T020g: sequential Run carries explicit provenance fields", async () => {
      const { res, chosen } = setupSequential();
      const confirmRes = await intake.confirm(projectId, res.token, chosen);
      const run = services.runRepo.getById(confirmRes.response.target_id)!;
      expect(run.dispatch_source).toBe(RunDispatchSource.UserExplicit);
      expect(run.context_source_run_id).toBeNull();
      expect(run.adapter_identity).toBeTruthy();
      expect(run.adapter_identity!.adapter_config_id).toBe(run.adapter_config_id);
    });

    it("T021c: same token confirmed twice produces one Issue", async () => {
      const { res, chosen } = setupSequential();
      const first = await intake.confirm(projectId, res.token, chosen);
      const second = await intake.confirm(projectId, res.token, chosen);
      expect(second.response.issue_id).toBe(first.response.issue_id);
      expect(second.response.target_id).toBe(first.response.target_id);
      const count = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(count.c).toBe(1);
    });

    it("T020a2: tampering issue_type is rejected", async () => {
      const { res, chosen } = setupSequential();
      const recommended = structuredClone(res.token.payload.recommended);
      recommended.issue_type.value = "wrong_type";
      const tampered: ConfirmationToken = {
        payload: { ...res.token.payload, recommended },
        signature: res.token.signature,
      };
      await expectRejectCode(intake.confirm(projectId, tampered, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T020a2: tampering the signed payload project_id is rejected", async () => {
      const { res, chosen } = setupSequential();
      const tampered: ConfirmationToken = {
        payload: { ...res.token.payload, project_id: "prj_tampered" },
        signature: res.token.signature,
      };
      await expectRejectCode(intake.confirm(projectId, tampered, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T020b: capability change without availability change invalidates the premise", async () => {
      const { res, chosen, adapterId } = setupSequential();
      services.agentConfigRepo.update(adapterId, {
        capability_tags: [AgentCapability.Validator],
        updated_at: NOW_ISO,
      });
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.RECOMMENDATION_STALE);
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
    });

    it("T020c: two different goals get distinct nonces and confirm independently", async () => {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const r1 = services.recommendationService.recommend(projectId, "implement the payment retry");
      const r2 = services.recommendationService.recommend(projectId, "fix the login bug");
      expect(r1.token.payload.nonce).not.toBe(r2.token.payload.nonce);
      const c1: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      const c2: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      const a = await intake.confirm(projectId, r1.token, c1);
      const b = await intake.confirm(projectId, r2.token, c2);
      expect(a.response.issue_id).not.toBe(b.response.issue_id);
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(2);
    });

    it("T020g: adapter_identity snapshot survives adapter rename and provider change", async () => {
      const { res, chosen, adapterId } = setupSequential();
      const confirmRes = await intake.confirm(projectId, res.token, chosen);
      const run = services.runRepo.getById(confirmRes.response.target_id)!;
      const before = run.adapter_identity;
      services.agentConfigRepo.update(adapterId, { name: "Renamed Adapter", updated_at: NOW_ISO });
      services.db
        .prepare("UPDATE agent_configs SET cli_provider = 'claude-code', updated_at = ? WHERE id = ?")
        .run(NOW_ISO, adapterId);
      const after = services.runRepo.getById(run.id)!.adapter_identity;
      expect(after).toEqual(before);
      expect(after!.name).toBe(before!.name);
      expect(after!.cli_provider).toBe(before!.cli_provider);
      expect(after!.adapter_config_id).toBe(adapterId);
    });

    it("T025: unrelated adapter becoming unavailable does not invalidate the recommendation", async () => {
      const { res, chosen } = setupSequential();
      const unrelated = addAdapter(services, projectId, {
        name: "unrelated",
        capabilities: [AgentCapability.Implementation],
      });
      services.agentConfigRepo.update(unrelated, { status: AdapterStatus.Unavailable, updated_at: NOW_ISO });
      const confirmRes = await intake.confirm(projectId, res.token, chosen);
      expect(confirmRes.response.issue_id).toBeTruthy();
    });

    it("T020a: missing signature is rejected with CONFIRMATION_TOKEN_INVALID", async () => {
      const { res, chosen } = setupSequential();
      const forged: ConfirmationToken = { payload: res.token.payload, signature: "" };
      await expectRejectCode(intake.confirm(projectId, forged, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T020a2: tampering issued_at is rejected", async () => {
      const { res, chosen } = setupSequential();
      const tampered: ConfirmationToken = {
        payload: { ...res.token.payload, issued_at: "2000-01-01T00:00:00Z" },
        signature: res.token.signature,
      };
      await expectRejectCode(intake.confirm(projectId, tampered, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T020a2: tampering issue_draft is rejected", async () => {
      const { res, chosen } = setupSequential();
      const recommended = structuredClone(res.token.payload.recommended);
      recommended.issue_draft.goal.value = "attacker rewrite";
      const tampered: ConfirmationToken = {
        payload: { ...res.token.payload, recommended },
        signature: res.token.signature,
      };
      await expectRejectCode(intake.confirm(projectId, tampered, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T020a2: tampering premise is rejected", async () => {
      const { res, chosen } = setupSequential();
      const premise = structuredClone(res.token.payload.premise);
      premise.workflow_template_id = "evil";
      const tampered: ConfirmationToken = {
        payload: { ...res.token.payload, premise },
        signature: res.token.signature,
      };
      await expectRejectCode(intake.confirm(projectId, tampered, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T020a: route projectId mismatch is rejected", async () => {
      const { res, chosen } = setupSequential();
      const other = services.projectService.create("Other");
      await expectRejectCode(intake.confirm(other.id, res.token, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
    });

    it("T021e: expired token returns RECOMMENDATION_STALE", async () => {
      const { res, chosen } = setupSequential();
      const signed = services.tokenService.sign({ ...res.token.payload, issued_at: "2000-01-01T00:00:00Z" });
      await expectRejectCode(intake.confirm(projectId, signed, chosen), ErrorCode.RECOMMENDATION_STALE);
    });

    it("T020a3: confirmed token replayed after expiry returns 200 via nonce hit", async () => {
      const { res, chosen } = setupSequential();
      await intake.confirm(projectId, res.token, chosen);
      const laterToken = services.tokenService.sign({
        ...res.token.payload,
        issued_at: "2000-01-01T00:00:00Z",
      });
      const result = await intake.confirm(projectId, laterToken, chosen);
      expect(result.response.issue_id).toBeTruthy();
      const count = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(count.c).toBe(1);
    });

    it("M3: future-dated token returns RECOMMENDATION_STALE", async () => {
      const { res, chosen } = setupSequential();
      const future = services.tokenService.sign({
        ...res.token.payload,
        issued_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      await expectRejectCode(intake.confirm(projectId, future, chosen), ErrorCode.RECOMMENDATION_STALE);
    });

    it("H1: forged signature on a confirmed nonce is rejected (verify precedes replay)", async () => {
      const { res, chosen } = setupSequential();
      await intake.confirm(projectId, res.token, chosen);
      const forged: ConfirmationToken = { payload: res.token.payload, signature: "forged" };
      await expectRejectCode(intake.confirm(projectId, forged, chosen), ErrorCode.CONFIRMATION_TOKEN_INVALID);
      const count = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(count.c).toBe(1);
    });

    it("M4: replay returns the committed result even after the default workspace changes", async () => {
      const { res, chosen } = setupSequential();
      const first = await intake.confirm(projectId, res.token, chosen);
      const dir2 = createTempDir();
      try {
        services.workspaceService.bind(projectId, dir2);
        const second = await intake.confirm(projectId, res.token, chosen);
        expect(second.replayed).toBe(true);
        expect(second.response.issue_id).toBe(first.response.issue_id);
        expect(second.response.target_id).toBe(first.response.target_id);
      } finally {
        cleanupTempDir(dir2);
      }
    });

    it("T022: premise changed after recommend returns RECOMMENDATION_STALE", async () => {
      const { res, chosen, adapterId } = setupSequential();
      services.agentConfigRepo.update(adapterId, { status: AdapterStatus.Unavailable, updated_at: NOW_ISO });
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.RECOMMENDATION_STALE);
    });

    it("T022b: a user-selected unavailable replacement adapter is RECOMMENDATION_STALE", async () => {
      const a = addAdapter(services, projectId, { name: "a", capabilities: [AgentCapability.Implementation] });
      const b = addAdapter(services, projectId, { name: "b", capabilities: [AgentCapability.Implementation] });
      const res = recommend("implement the payment retry");
      services.agentConfigRepo.update(b, { status: AdapterStatus.Unavailable, updated_at: NOW_ISO });
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: b };
      expect(a).toBeTruthy();
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.RECOMMENDATION_STALE);
    });

    it("T021d: transaction failure leaves no orphan Issue/Thread/Run and allows retry", async () => {
      const { res, chosen } = setupSequential();
      services.db.exec(
        "CREATE TRIGGER fail_intake_confirm BEFORE INSERT ON intake_confirmations BEGIN SELECT RAISE(ABORT, 'injected fault'); END;",
      );
      await expect(intake.confirm(projectId, res.token, chosen)).rejects.toThrow();
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
      const runs = services.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number };
      expect(runs.c).toBe(0);
      const threads = services.db.prepare("SELECT COUNT(*) c FROM threads").get() as { c: number };
      expect(threads.c).toBe(0);
      services.db.exec("DROP TRIGGER fail_intake_confirm");
      const retry = await intake.confirm(projectId, res.token, chosen);
      expect(retry.response.issue_id).toBeTruthy();
    });

    it("T021h: on commit failure no broadcast or drain occurs (commit-before-side-effect)", async () => {
      const { res, chosen } = setupSequential();
      const broadcastSpy = vi.spyOn(services.threadEventService, "broadcast");
      const drainSpy = vi.fn(async () => {});
      const intakeSpy = buildNoopDrainIntake(services, drainSpy);
      services.db.exec(
        "CREATE TRIGGER fail_intake_confirm BEFORE INSERT ON intake_confirmations BEGIN SELECT RAISE(ABORT, 'injected'); END;",
      );
      await expect(intakeSpy.confirm(projectId, res.token, chosen)).rejects.toThrow();
      services.db.exec("DROP TRIGGER fail_intake_confirm");
      expect(broadcastSpy).not.toHaveBeenCalled();
      expect(drainSpy).not.toHaveBeenCalled();
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
      expect(services.runRepo.listRunning()).toHaveLength(0);
      broadcastSpy.mockRestore();
    });
  });

  describe("confirm — orchestrator_subagent branch (T021b/T023b)", () => {
    it("creates a graph run with all node assignments", async () => {
      writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = recommend("conduct a multi-perspective review of concurrency and contracts");
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
      const confirmRes = await intake.confirm(projectId, res.token, chosen);
      expect(confirmRes.response.target_kind).toBe("graph");
      const graph = services.graphRunRepo.getById(confirmRes.response.target_id)!;
      expect(graph.definition_id).toBe("wgd_coding_dual_review");
      const nodeRuns = services.nodeRunRepo.listByGraphRun(graph.id);
      expect(nodeRuns).toHaveLength(nodeKeys.length);
    });

    it("missing node in node_assignments returns GRAPH_PLAN_INCOMPLETE", async () => {
      writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const token = services.recommendationService.recommend(projectId, "review concurrency").token;
      const chosen: ChosenPlan = {
        topology: "orchestrator_subagent",
        definition_id: "wgd_coding_dual_review",
        definition_version: 1,
        node_assignments: { review_concurrency: adapterId },
      };
      await expectRejectCode(intake.confirm(projectId, token, chosen), ErrorCode.GRAPH_PLAN_INCOMPLETE);
    });

    it("unknown node in node_assignments returns GRAPH_PLAN_UNKNOWN_NODE", async () => {
      writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const token = services.recommendationService.recommend(projectId, "review concurrency").token;
      const nodeKeys = Object.keys(token.payload.recommended.agent_roster.by_node);
      const nodeAssignments: Record<string, string> = {};
      for (const key of nodeKeys) nodeAssignments[key] = adapterId;
      nodeAssignments.bogus = adapterId;
      const chosen: ChosenPlan = {
        topology: "orchestrator_subagent",
        definition_id: "wgd_coding_dual_review",
        definition_version: 1,
        node_assignments: nodeAssignments,
      };
      await expectRejectCode(intake.confirm(projectId, token, chosen), ErrorCode.GRAPH_PLAN_UNKNOWN_NODE);
    });

    it("M5: graph definition not offered by the recommendation returns TOPOLOGY_NOT_EXECUTABLE", async () => {
      writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const token = services.recommendationService.recommend(projectId, "review concurrency").token;
      const chosen: ChosenPlan = {
        topology: "orchestrator_subagent",
        definition_id: "wgd_unoffered",
        definition_version: 1,
        node_assignments: { review_concurrency: adapterId, review_contract: adapterId, synthesize_findings: adapterId },
      };
      await expectRejectCode(intake.confirm(projectId, token, chosen), ErrorCode.TOPOLOGY_NOT_EXECUTABLE);
    });

    it("T023: graph-branch chosen adapter lacking the node capability is rejected via the shared resolver", async () => {
      writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      const bad = addAdapter(services, projectId, {
        name: "validator-only",
        capabilities: [AgentCapability.Validator],
      });
      const res = services.recommendationService.recommend(projectId, "review concurrency");
      const nodeKeys = Object.keys(res.agent_roster.by_node);
      const nodeAssignments: Record<string, string> = {};
      for (const key of nodeKeys) nodeAssignments[key] = bad;
      const chosen: ChosenPlan = {
        topology: "orchestrator_subagent",
        definition_id: "wgd_coding_dual_review",
        definition_version: 1,
        node_assignments: nodeAssignments,
      };
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.ADAPTER_CAPABILITY_MISSING);
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
    });
  });

  describe("failure atomicity, stale invalidation, concurrency (T021c/T021d/T021h/T022)", () => {
    function setupSequential() {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = services.recommendationService.recommend(projectId, "implement the payment retry");
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      return { res, chosen };
    }

    function setupGraph() {
      writeFileSync(join(tempDir, "app.ts"), "export const x = 1;\n");
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = services.recommendationService.recommend(
        projectId,
        "conduct a multi-perspective review of concurrency",
      );
      const nodeKeys = Object.keys(res.agent_roster.by_node);
      const nodeAssignments: Record<string, string> = {};
      for (const key of nodeKeys) nodeAssignments[key] = adapterId;
      const chosen: ChosenPlan = {
        topology: "orchestrator_subagent",
        definition_id: "wgd_coding_dual_review",
        definition_version: 1,
        node_assignments: nodeAssignments,
      };
      return { res, chosen };
    }

    it("T021d: event-write failure rolls back with no orphan and allows retry", async () => {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = services.recommendationService.recommend(projectId, "implement the payment retry");
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      services.db.exec(
        "CREATE TRIGGER fail_event BEFORE INSERT ON thread_events BEGIN SELECT RAISE(ABORT, 'injected'); END;",
      );
      await expect(intake.confirm(projectId, res.token, chosen)).rejects.toThrow();
      services.db.exec("DROP TRIGGER fail_event");
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
      const runs = services.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number };
      expect(runs.c).toBe(0);
      const ok = await intake.confirm(projectId, res.token, chosen);
      expect(ok.response.issue_id).toBeTruthy();
    });

    it("T021d: adapter-recheck failure rolls back with no orphan", async () => {
      addAdapter(services, projectId, { name: "impl", capabilities: [AgentCapability.Implementation] });
      const badAdapter = addAdapter(services, projectId, {
        name: "validator-only",
        capabilities: [AgentCapability.Validator],
      });
      const res = services.recommendationService.recommend(projectId, "implement the payment retry");
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: badAdapter };
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.ADAPTER_CAPABILITY_MISSING);
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
      const runs = services.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number };
      expect(runs.c).toBe(0);
    });

    it("T021d: graph-creation failure rolls back with no orphan", async () => {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = services.recommendationService.recommend(
        projectId,
        "conduct a multi-perspective review of concurrency",
      );
      const nodeKeys = Object.keys(res.agent_roster.by_node);
      const nodeAssignments: Record<string, string> = {};
      for (const key of nodeKeys) nodeAssignments[key] = adapterId;
      const chosen: ChosenPlan = {
        topology: "orchestrator_subagent",
        definition_id: "wgd_coding_dual_review",
        definition_version: 1,
        node_assignments: nodeAssignments,
      };
      // Empty workspace → prepareGraph returns empty target set → createGraph
      // throws GRAPH_TARGET_SET_EMPTY inside the transaction.
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.GRAPH_TARGET_SET_EMPTY);
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
      const graphs = services.db.prepare("SELECT COUNT(*) c FROM graph_runs").get() as { c: number };
      expect(graphs.c).toBe(0);
    });

    it("T021h: graph-branch commit failure does not broadcast or drain", async () => {
      const { res, chosen } = setupGraph();
      const broadcastSpy = vi.spyOn(services.threadEventService, "broadcast");
      const drainSpy = vi.fn(async () => {});
      const intakeSpy = buildNoopDrainIntake(services, drainSpy);
      services.db.exec(
        "CREATE TRIGGER fail_intake_confirm BEFORE INSERT ON intake_confirmations BEGIN SELECT RAISE(ABORT, 'injected'); END;",
      );
      await expect(intakeSpy.confirm(projectId, res.token, chosen)).rejects.toThrow();
      services.db.exec("DROP TRIGGER fail_intake_confirm");
      expect(broadcastSpy).not.toHaveBeenCalled();
      expect(drainSpy).not.toHaveBeenCalled();
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
      expect(services.runRepo.listRunning()).toHaveLength(0);
      broadcastSpy.mockRestore();
    });

    it("T022: workspace unbind invalidates the premise (RECOMMENDATION_STALE)", async () => {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = services.recommendationService.recommend(projectId, "implement the payment retry");
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      // Binding a new dir changes the project's default workspace, so the
      // signed workspace premise no longer holds → stale, guiding re-recommend.
      const dir2 = createTempDir();
      try {
        services.workspaceService.bind(projectId, dir2);
        await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.RECOMMENDATION_STALE);
      } finally {
        cleanupTempDir(dir2);
      }
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
    });

    it("T022: workflow template deactivation invalidates the premise (RECOMMENDATION_STALE)", async () => {
      const adapterId = addAdapter(services, projectId, {
        name: "impl",
        capabilities: [AgentCapability.Implementation],
      });
      const res = services.recommendationService.recommend(projectId, "implement the payment retry");
      const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
      services.db.prepare("UPDATE workflow_templates SET status = 'inactive' WHERE id = 'wft_coding_default'").run();
      await expectRejectCode(intake.confirm(projectId, res.token, chosen), ErrorCode.RECOMMENDATION_STALE);
      const issues = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(issues.c).toBe(0);
    });

    it("T021c: two independent DB connections double-confirming converge to one Issue", async () => {
      const dir = createTempDir();
      const path = join(dir, "concurrent.db");
      try {
        const dbA = new Database(path);
        dbA.pragma("journal_mode = WAL");
        dbA.pragma("foreign_keys = ON");
        dbA.pragma("busy_timeout = 5000");
        applyMigrations(dbA);
        const dbB = new Database(path);
        dbB.pragma("journal_mode = WAL");
        dbB.pragma("foreign_keys = ON");
        dbB.pragma("busy_timeout = 5000");
        applyMigrations(dbB);

        const servicesA = createTestServices(dbA);
        const servicesB = createTestServices(dbB);
        const project = servicesA.projectService.create("Concurrent");
        servicesA.workspaceService.bind(project.id, dir);
        const adapterId = servicesA.agentConfigRepo.create({
          project_id: project.id,
          name: "Impl",
          role: "implementation",
          cli_provider: "codex",
          command: "codex",
          args: [],
          capability_tags: [AgentCapability.Implementation],
          default_model: null,
          status: AdapterStatus.Available,
        }).id;
        const intakeA = buildNoopDrainIntake(servicesA);
        const intakeB = buildNoopDrainIntake(servicesB);
        const res = servicesA.recommendationService.recommend(project.id, "implement the payment retry");
        const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };

        const [ra, rb] = await Promise.all([
          intakeA.confirm(project.id, res.token, chosen),
          intakeB.confirm(project.id, res.token, chosen),
        ]);
        expect(ra.response.issue_id).toBe(rb.response.issue_id);
        const count = dbA.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
        expect(count.c).toBe(1);
        const confirmations = dbA.prepare("SELECT COUNT(*) c FROM intake_confirmations").get() as { c: number };
        expect(confirmations.c).toBe(1);

        await disposeTestServices(servicesA);
        await disposeTestServices(servicesB);
      } finally {
        cleanupTempDir(dir);
      }
    });

    it("T021c: two OS processes double-confirming the same token converge to one Issue under real contention", async () => {
      const dir = createTempDir();
      const dbPath = join(dir, "parallel.db");
      const tokenFile = join(dir, "token.json");
      const chosenFile = join(dir, "chosen.json");
      const barrierDir = join(dir, "barrier");
      mkdirSync(barrierDir, { recursive: true });
      const workerPath = fileURLToPath(new URL("./parallel-confirm-worker.ts", import.meta.url));
      try {
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        db.pragma("busy_timeout = 10000");
        applyMigrations(db);
        const services = createTestServices(db);
        const project = services.projectService.create("Parallel");
        services.workspaceService.bind(project.id, dir);
        const adapterId = services.agentConfigRepo.create({
          project_id: project.id,
          name: "Impl",
          role: "implementation",
          cli_provider: "codex",
          command: "codex",
          args: [],
          capability_tags: [AgentCapability.Implementation],
          default_model: null,
          status: AdapterStatus.Available,
        }).id;
        const res = services.recommendationService.recommend(project.id, "implement the payment retry");
        const chosen: ChosenPlan = { topology: "sequential", adapter_config_id: adapterId };
        writeFileSync(tokenFile, JSON.stringify(res.token));
        writeFileSync(chosenFile, JSON.stringify(chosen));
        const projectId = project.id;
        await disposeTestServices(services);

        function spawnWorker(index: number) {
          const done = new Promise<{
            ok: boolean;
            code?: string;
            message?: string;
            result?: { response: { issue_id: string }; replayed: boolean };
          }>((resolve) => {
            execFile(
              process.execPath,
              ["--import", "tsx", workerPath, dbPath, projectId, tokenFile, chosenFile, String(index), barrierDir],
              { cwd: process.cwd() },
              (error, stdout, stderr) => {
                if (error) {
                  resolve({ ok: false, code: "spawn_failed", message: stderr || String(error) });
                  return;
                }
                const last = stdout.trim().split("\n").pop() ?? "";
                try {
                  resolve(JSON.parse(last));
                } catch {
                  resolve({ ok: false, code: "parse_failed", message: stdout });
                }
              },
            );
          });
          return done;
        }

        const workers = [spawnWorker(0), spawnWorker(1)];
        const start = Date.now();
        const waitForFile = (p: string) =>
          new Promise<void>((resolve, reject) => {
            const loop = setInterval(() => {
              if (existsSync(p)) {
                clearInterval(loop);
                return resolve();
              }
              if (Date.now() - start > 30000) {
                clearInterval(loop);
                return reject(new Error(`timed out waiting for ${p}`));
              }
            }, 10);
          });
        await Promise.all([waitForFile(join(barrierDir, "ready-0")), waitForFile(join(barrierDir, "ready-1"))]);
        writeFileSync(join(barrierDir, "go"), "go");

        const results = await Promise.all(workers);
        expect(results.every((r) => r.ok)).toBe(true);
        const issueIds = results.map((r) => r.result!.response.issue_id);
        expect(new Set(issueIds).size).toBe(1);
        const replays = results.map((r) => r.result!.replayed);
        expect(replays.filter((r) => r === false)).toHaveLength(1);
        expect(replays.filter((r) => r === true)).toHaveLength(1);

        const checkDb = new Database(dbPath);
        const count = checkDb.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
        expect(count.c).toBe(1);
        const confirmations = checkDb.prepare("SELECT COUNT(*) c FROM intake_confirmations").get() as { c: number };
        expect(confirmations.c).toBe(1);
        checkDb.close();
      } finally {
        cleanupTempDir(dir);
      }
    }, 90000);

    it("replay re-runs the idempotent drain after a committed confirm whose drain failed", async () => {
      const { res, chosen } = setupSequential();
      const drainCalls: string[] = [];
      const drainSpy = vi.fn(async (wsId: string) => {
        drainCalls.push(wsId);
        if (drainCalls.length === 1) throw new Error("drain boom");
      });
      const intakeSpy = buildNoopDrainIntake(services, drainSpy);
      // First confirm commits (Issue + Run + confirmation) then the post-commit
      // drain throws → the client sees a failure even though it is durable.
      await expect(intakeSpy.confirm(projectId, res.token, chosen)).rejects.toThrow("drain boom");
      const committed = services.db.prepare("SELECT COUNT(*) c FROM issues").get() as { c: number };
      expect(committed.c).toBe(1);
      // Replay must re-run the idempotent drain so the queued Run still starts.
      const replay = await intakeSpy.confirm(projectId, res.token, chosen);
      expect(replay.replayed).toBe(true);
      expect(replay.response.issue_id).toBeTruthy();
      expect(drainCalls.length).toBe(2);
    });

    it("nonce-conflict replay drains the winner workspace before returning", async () => {
      const { res, chosen } = setupSequential();
      const winner: IntakeConfirmationRecord = {
        nonce: res.token.payload.nonce,
        project_id: projectId,
        workspace_id: workspaceId,
        recommendation_id: "winner-recommendation",
        chosen_json: JSON.stringify(chosen),
        issue_id: "iss_winner",
        target_kind: "run",
        target_id: "run_winner",
        issued_at: res.token.payload.issued_at,
        confirmed_at: NOW_ISO,
      };
      const confirmationRepo = new IntakeConfirmationRepository(services.db);
      vi.spyOn(confirmationRepo, "getByNonce").mockReturnValueOnce(null).mockReturnValueOnce(winner);
      vi.spyOn(confirmationRepo, "create").mockImplementation(() => {
        throw new Error("UNIQUE constraint failed: intake_confirmations.nonce");
      });
      const drainSpy = vi.fn(async () => {});
      const intakeSpy = buildNoopDrainIntake(services, drainSpy, undefined, confirmationRepo);

      const result = await intakeSpy.confirm(projectId, res.token, chosen);

      expect(result).toEqual({
        response: {
          issue_id: winner.issue_id,
          target_kind: winner.target_kind,
          target_id: winner.target_id,
          diff: [],
        },
        replayed: true,
      });
      expect(drainSpy).toHaveBeenCalledOnce();
      expect(drainSpy).toHaveBeenCalledWith(workspaceId);
      expect(services.db.prepare("SELECT COUNT(*) c FROM issues").get()).toEqual({ c: 0 });
    });

    it("per-attempt event buffer does not broadcast events from a rolled-back busy attempt", async () => {
      const { res, chosen } = setupSequential();
      // A trigger raises a busy-like error on the confirmation INSERT while a
      // marker row exists. The first attempt rolls back (its events must be
      // discarded); afterBusyRetry clears the marker so the second succeeds.
      services.db.exec(`
        CREATE TABLE busy_marker (n INTEGER NOT NULL);
        INSERT INTO busy_marker VALUES (1);
        CREATE TRIGGER busy_on_confirm
        BEFORE INSERT ON intake_confirmations
        WHEN (SELECT n FROM busy_marker) > 0
        BEGIN
          SELECT RAISE(ABORT, 'database is locked');
        END;
      `);
      const broadcastSpy = vi.spyOn(services.threadEventService, "broadcast");
      const clearBusy = vi.fn(() => services.db.prepare("DELETE FROM busy_marker").run());
      const intakeSpy = buildNoopDrainIntake(services, undefined, { afterBusyRetry: clearBusy });
      const result = await intakeSpy.confirm(projectId, res.token, chosen);
      expect(result.replayed).toBe(false);
      expect(clearBusy).toHaveBeenCalled();
      const broadcasted = broadcastSpy.mock.calls.map((c) => c[0] as { id: string });
      expect(broadcasted).toHaveLength(2);
      for (const event of broadcasted) {
        const row = services.db.prepare("SELECT id FROM thread_events WHERE id = ?").get(event.id);
        expect(row).toBeDefined();
      }
      broadcastSpy.mockRestore();
    });
  });
});
