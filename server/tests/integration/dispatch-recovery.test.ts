// F012 T012 (AC-004): cancelAttempt isolation + restart recovery with
// isRunOwnerDead — cancel touches only the target attempt; expired leases
// resume under the same dispatch without a second attempt; queued runs
// respawn; pause intent survives restart via dispatch_gates.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { DomainOutbox } from "../../src/services/domain-outbox.js";
import { DispatchGateService } from "../../src/services/dispatch-gate-service.js";
import { DispatchService, type DispatchConfirmInput } from "../../src/services/dispatch-service.js";
import { DispatchRecoveryService, isRunOwnerDead } from "../../src/services/dispatch-recovery.js";
import { StaleRecoveryService } from "../../src/services/stale-recovery.js";
import type { ContextAssembler } from "../../src/services/context-assembler.js";

function stubAssembler(): ContextAssembler {
  return {
    async assemble(input) {
      return {
        scope: input.dispatch.context_scope,
        items: [],
        contentHash: "sha256:stub",
        consumptionRefs: [],
        startMode: "cold",
        coldStartReason: null,
        resumedFromAttemptId: null,
      };
    },
    recordConsumptions() {},
  };
}

interface Scene {
  services: TestServices;
  gates: DispatchGateService;
  service: DispatchService;
  recovery: DispatchRecoveryService;
  issueId: string;
  adapterId: string;
  spawnedRunIds: string[];
  cancelledRunIds: string[];
  confirm: (clientRequestId: string) => ReturnType<DispatchService["confirm"]>;
}

let scene: Scene;

beforeEach(() => {
  const services = createTestServices();
  const spaceId = (services.db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
  const project = services.projectRepo.create("P", null, spaceId);
  const workspace = services.workspaceRepo.create({
    project_id: project.id,
    local_path: "/tmp/f012-recovery",
    local_path_normalized: "/tmp/f012-recovery",
    git_branch: null,
    lock_state: "idle",
  });
  const issue = services.issueRepo.create({
    project_id: project.id,
    workspace_id: workspace.id,
    space_id: spaceId,
    title: "Recovery issue",
    issue_type: "coding",
    workflow_template_id: "wft_coding_default",
    validation_policy_id: "vpl_coding_default",
    goal: "Recover",
    status: "Inbox",
    priority: "normal",
    labels: [],
  });
  services.db
    .prepare(
      "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_rec', ?, 'room_rec', 'primary', 'T', ?, ?)",
    )
    .run(issue.id, new Date().toISOString(), new Date().toISOString());
  services.db
    .prepare(
      "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_rec', ?, ?, 'R', 'active', ?, NULL)",
    )
    .run(spaceId, issue.id, new Date().toISOString());
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "codex-high",
    role: "implementation",
    cli_provider: "codex",
    command: "codex",
    args: [],
    capability_tags: [],
    default_model: "gpt-5.6-sol",
    status: "available" as never,
  });

  const outbox = new DomainOutbox(services.db);
  const gates = new DispatchGateService(services.db);
  const spawnedRunIds: string[] = [];
  const cancelledRunIds: string[] = [];
  const service = new DispatchService(services.db, outbox, gates, stubAssembler(), services.agentConfigRepo, services.runRepo, {
    graceWindowMs: () => 0,
    spawnRun: async (runId) => {
      spawnedRunIds.push(runId);
    },
    cancelRunningRun: async (runId) => {
      cancelledRunIds.push(runId);
    },
  });
  const staleRecovery = new StaleRecoveryService(services.runRepo, services.workspaceRepo, services.threadEventService, services.workspaceLockService);
  const recovery = new DispatchRecoveryService(services.db, outbox, staleRecovery, service, {
    spawnRun: async (runId) => {
      spawnedRunIds.push(runId);
    },
  });
  const base: DispatchConfirmInput = {
    roomId: "room_rec",
    clientRequestId: "crq_x",
    purpose: "execute",
    identity: {
      runtime_id: "local",
      adapter_config_id: adapter.id,
      access_ref: null,
      model: "gpt-5.6-sol",
      depth_raw: "high",
      depth_normalized: "high",
    },
    identitySnapshotJson: "{}",
    contextScope: "all",
    skillRevisionRefs: [],
    effectiveRequirementsJson: "[]",
    effectiveRequirementsHash: "sha256:none",
    handoffRefs: [],
    taskScopeJson: null,
    requirementOverride: null,
    graceWindowMs: 0,
    actor: "test",
  };
  scene = {
    services,
    gates,
    service,
    recovery,
    issueId: issue.id,
    adapterId: adapter.id,
    spawnedRunIds,
    cancelledRunIds,
    confirm: (clientRequestId: string) => service.confirm({ ...base, clientRequestId }),
  };
});

afterEach(() => {
  disposeTestServices(scene.services);
});

describe("F012 cancelAttempt isolation (T012, §5.4)", () => {
  it("cancels the queued attempt and its run; the dispatch stays dispatched", async () => {
    const dispatch = scene.confirm("crq_ca");
    const outcome = await scene.service.claimAndStart(dispatch.id, "worker-1");
    expect(outcome.attemptId).toBeTruthy();
    const attempt = await scene.service.cancelAttempt(outcome.attemptId!, "user");
    expect(attempt.state).toBe("cancelled");
    const run = scene.services.runRepo.getById(outcome.runId!);
    expect(run!.status).toBe("cancelled");
    const dispatchRow = scene.services.db.prepare("SELECT state FROM dispatches WHERE id = ?").get(dispatch.id) as {
      state: string;
    };
    expect(dispatchRow.state).toBe("dispatched"); // dispatched fact untouched
    await expect(scene.service.cancelAttempt(attempt.id, "user")).rejects.toThrow(/already cancelled/);
  });
});

describe("F012 restart recovery (T012, §5.6)", () => {
  it("expired starting lease resumes the SAME dispatch without a second attempt", async () => {
    const dispatch = scene.confirm("crq_lease");
    // simulate: the claim CAS happened, the lease expired BEFORE the attempt
    // existed (crash inside the assembly phase)
    scene.services.db
      .prepare("UPDATE dispatches SET state = 'starting', lease_owner = 'dead-owner', lease_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), dispatch.id);
    const tally = await scene.recovery.recoverAll("worker-2");
    expect(tally.leasesResumed).toContain(dispatch.id);
    const row = scene.services.db.prepare("SELECT state FROM dispatches WHERE id = ?").get(dispatch.id) as {
      state: string;
    };
    expect(row.state).toBe("dispatched");
    const attempts = scene.services.db.prepare("SELECT COUNT(*) AS c FROM attempts WHERE dispatch_id = ?").get(dispatch.id) as {
      c: number;
    };
    expect(attempts.c).toBe(1); // never a second attempt
  });

  it("post-commit crash residue (queued run) is respawned through the spawn hook", async () => {
    const dispatch = scene.confirm("crq_respawn");
    const outcome = await scene.service.claimAndStart(dispatch.id, "worker-1");
    // crash right after commit: the attempt exists, the run is still queued
    scene.spawnedRunIds.length = 0;
    scene.services.db
      .prepare("UPDATE dispatches SET lease_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), dispatch.id);
    await scene.recovery.recoverAll("worker-2");
    expect(scene.spawnedRunIds).toContain(outcome.runId!);
    const attempts = scene.services.db.prepare("SELECT COUNT(*) AS c FROM attempts WHERE dispatch_id = ?").get(dispatch.id) as {
      c: number;
    };
    expect(attempts.c).toBe(1); // spawn-stage resume, not a new attempt
  });

  it("pause intent persists across restart without user action", async () => {
    const dispatch = scene.confirm("crq_pause");
    scene.gates.setPaused("issue", scene.issueId, true, "intervention", "user");
    const gateBefore = scene.services.db
      .prepare("SELECT state, revision FROM dispatch_gates WHERE scope_type = 'issue' AND scope_id = ?")
      .get(scene.issueId) as { state: string; revision: number };
    await scene.recovery.recoverAll("worker-restart");
    const gateAfter = scene.services.db
      .prepare("SELECT state, revision FROM dispatch_gates WHERE scope_type = 'issue' AND scope_id = ?")
      .get(scene.issueId) as { state: string; revision: number };
    expect(gateAfter).toEqual(gateBefore); // untouched by recovery
    const row = scene.services.db.prepare("SELECT state FROM dispatches WHERE id = ?").get(dispatch.id) as {
      state: string;
    };
    expect(row.state).toBe("draft"); // paused gate still blocks the start
  });

  it("isRunOwnerDead is the named single-process inference (ADR 0015 §3)", () => {
    expect(isRunOwnerDead({ id: "run_1", started_at: null })).toBe(true);
  });
});
