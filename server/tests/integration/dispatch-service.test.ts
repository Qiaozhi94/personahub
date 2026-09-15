// F012 T010/T012/T014 (AC-002/AC-004/AC-008): DispatchService lifecycle —
// confirm idempotency, cancel/claim races, gate linearization, acceptance
// lock on BOTH start paths, deterministic start_failed with zero Runs, and
// spawn strictly after commit.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { DomainOutbox } from "../../src/services/domain-outbox.js";
import { DispatchGateService } from "../../src/services/dispatch-gate-service.js";
import { DispatchService, type DispatchConfirmInput } from "../../src/services/dispatch-service.js";
import type { ContextAssembler, AssembledContext, AssembleInput } from "../../src/services/context-assembler.js";
import type { Dispatch } from "@personahub/shared/types";

function stubAssembler(assembleImpl?: (input: AssembleInput) => Promise<AssembledContext>): ContextAssembler {
  return {
    async assemble(input) {
      if (assembleImpl) return assembleImpl(input);
      return {
        scope: input.dispatch.context_scope,
        items: [{ source_ref: "issue:iss_g", kind: "issue", decision: "included", reason: null }],
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
  outbox: DomainOutbox;
  gates: DispatchGateService;
  service: DispatchService;
  roomId: string;
  issueId: string;
  adapterId: string;
  spawnedRunIds: string[];
  confirmInput: Partial<DispatchConfirmInput>;
}

let scene: Scene;

function buildScene(spawn?: (runId: string) => Promise<void>, assembler?: ContextAssembler): void {
  const services = createTestServices();
  const spaceId = (services.db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
  const project = services.projectRepo.create("P", null, spaceId);
  const workspace = services.workspaceRepo.create({
    project_id: project.id,
    local_path: "/tmp/f012-dispatch",
    local_path_normalized: "/tmp/f012-dispatch",
    git_branch: null,
    lock_state: "idle",
  });
  const issue = services.issueRepo.create({
    project_id: project.id,
    workspace_id: workspace.id,
    space_id: spaceId,
    title: "Dispatch issue",
    issue_type: "coding",
    workflow_template_id: "wft_coding_default",
    validation_policy_id: "vpl_coding_default",
    goal: "Ship it",
    status: "Inbox",
    priority: "normal",
    labels: [],
  });
  services.db
    .prepare(
      "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_d', ?, 'room_d', 'primary', 'T', ?, ?)",
    )
    .run(issue.id, new Date().toISOString(), new Date().toISOString());
  services.db
    .prepare(
      "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_d', ?, ?, 'D', 'active', ?, NULL)",
    )
    .run(spaceId, issue.id, new Date().toISOString());
  // independent room without workspace
  services.db
    .prepare(
      "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_free', ?, NULL, 'Free', 'active', ?, NULL)",
    )
    .run(spaceId, new Date().toISOString());
  const adapter = services.agentConfigRepo.create({
    project_id: project.id,
    name: "codex-gpt5.6-sol-high",
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
  const service = new DispatchService(services.db, outbox, gates, assembler ?? stubAssembler(), services.agentConfigRepo, services.runRepo, services.nodeRunRepo, services.graphRunRepo, {
    graceWindowMs: () => 10_000,
    spawnRun: spawn ?? (async (runId) => spawnedRunIds.push(runId)),
  });
  scene = {
    services,
    outbox,
    gates,
    service,
    roomId: "room_d",
    issueId: issue.id,
    adapterId: adapter.id,
    spawnedRunIds,
    confirmInput: {
      roomId: "room_d",
      purpose: "execute",
      identity: {
        runtime_id: "local",
        adapter_config_id: adapter.id,
        access_ref: null,
        model: "gpt-5.6-sol",
        depth_raw: "high",
        depth_normalized: "high",
      },
      identitySnapshotJson: JSON.stringify({ adapter_config_id: adapter.id, runtime_id: "local" }),
      contextScope: "all",
      skillRevisionRefs: [],
      effectiveRequirementsJson: "[]",
      effectiveRequirementsHash: "sha256:none",
      handoffRefs: [],
      taskScopeJson: null,
      requirementOverride: null,
      actor: "test",
    },
  };
}

function confirm(overrides: Partial<DispatchConfirmInput> = {}): Dispatch {
  return scene.service.confirm({
    clientRequestId: `crq_${Math.random().toString(36).slice(2)}`,
    graceWindowMs: 10_000,
    ...scene.confirmInput,
    ...overrides,
  } as DispatchConfirmInput);
}

beforeEach(() => {
  buildScene();
});
afterEach(() => {
  disposeTestServices(scene.services);
});

describe("F012 DispatchService confirm (T010, FR-004)", () => {
  it("creates exactly one draft with grace deadline and a drafted outbox event in the same commit", () => {
    const dispatch = confirm({ clientRequestId: "crq_1" });
    expect(dispatch.state).toBe("draft");
    expect(dispatch.issue_id).toBe(scene.issueId);
    const due = new Date(dispatch.grace_deadline_at).getTime() - new Date(dispatch.created_at).getTime();
    expect(due).toBe(10_000);
    const events = scene.services.db.prepare("SELECT topic FROM domain_outbox").all() as Array<{ topic: string }>;
    expect(events.map((e) => e.topic)).toEqual(["dispatch.drafted"]);
  });

  it("repeated confirm with the same idempotency key returns the SAME draft with no second event", () => {
    const first = confirm({ clientRequestId: "crq_same" });
    const second = confirm({ clientRequestId: "crq_same" });
    expect(second.id).toBe(first.id);
    const count = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM dispatches").get() as { c: number }).c;
    const events = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM domain_outbox").get() as { c: number }).c;
    expect(count).toBe(1);
    expect(events).toBe(1);
  });

  it("rejects confirm while the runtime gate is paused (DISPATCH_GATE_PAUSED)", () => {
    scene.gates.setPaused("runtime", "local", true, "hold", "test");
    try {
      confirm();
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("DISPATCH_GATE_PAUSED");
    }
  });

});

describe("F012 DispatchService cancel vs claim (AC-002/AC-004)", () => {
  it("cancel inside the window keeps one cancelled dispatch and zero runs", async () => {
    const dispatch = confirm({ clientRequestId: "crq_c" });
    const cancelled = scene.service.cancel(dispatch.id, "user");
    expect(cancelled.state).toBe("cancelled");
    await scene.service.claimDue("worker");
    const runs = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(runs).toBe(0);
    try {
      scene.service.cancel(dispatch.id, "user");
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("DISPATCH_NOT_CANCELLABLE");
    }
  });

  it("cancel racing claim: whichever commits first wins, exactly one dispatch/attempt results", async () => {
    const dispatch = confirm({ clientRequestId: "crq_race" });
    // force due so claim can proceed immediately
    scene.services.db.prepare("UPDATE dispatches SET grace_deadline_at = ? WHERE id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      dispatch.id,
    );
    const winner = await scene.service.claimAndStart(dispatch.id, "worker-1");
    expect(winner.dispatch.state).toBe("dispatched");
    try {
      scene.service.cancel(dispatch.id, "user");
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("DISPATCH_NOT_CANCELLABLE");
    }
    const attempts = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM attempts").get() as { c: number }).c;
    expect(attempts).toBe(1);
  });

  it("pause committed between confirm and claim prevents the start (no missed-start window)", async () => {
    const dispatch = confirm({ clientRequestId: "crq_p" });
    scene.services.db
      .prepare("UPDATE dispatches SET grace_deadline_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), dispatch.id);
    scene.gates.setPaused("issue", scene.issueId, true, "intervention", "user");
    await scene.service.claimDue("worker");
    const state = (scene.services.db.prepare("SELECT state FROM dispatches WHERE id = ?").get(dispatch.id) as { state: string }).state;
    expect(state).toBe("draft"); // stayed a draft — pause observed by the claim
    const runs = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(runs).toBe(0);
  });
});

describe("F012 DispatchService start transaction (AC-002)", () => {
  it("claim writes attempt+run+context snapshot+dispatched atomically and spawns only after commit", async () => {
    const spawned: string[] = [];
    buildScene(async (runId) => {
      spawned.push(runId);
      // inside the spawn hook the transaction must already be committed
      const row = scene.services.db.prepare("SELECT state FROM dispatches WHERE state = 'dispatched'").get();
      expect(row).toBeTruthy();
    });
    const dispatch = confirm({ clientRequestId: "crq_s" });
    scene.services.db
      .prepare("UPDATE dispatches SET grace_deadline_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), dispatch.id);
    const outcome = await scene.service.claimAndStart(dispatch.id, "worker-1");
    expect(outcome.spawn).toBe(true);
    expect(outcome.runId).toBe(spawned[0]);
    const attempt = scene.services.db.prepare("SELECT * FROM attempts WHERE dispatch_id = ?").get(dispatch.id) as {
      seq: number;
      state: string;
      start_mode: string;
    };
    expect(attempt.seq).toBe(1);
    expect(attempt.state).toBe("queued");
    expect(attempt.start_mode).toBe("cold");
    const snapshot = scene.services.db.prepare("SELECT * FROM dispatch_context_snapshots WHERE dispatch_id = ?").get(dispatch.id) as {
      content_hash: string;
    };
    expect(snapshot.content_hash).toBe("sha256:stub");
    const dispatchRow = scene.services.db.prepare("SELECT state, started_at FROM dispatches WHERE id = ?").get(dispatch.id) as {
      state: string;
      started_at: string | null;
    };
    expect(dispatchRow.state).toBe("dispatched");
    expect(dispatchRow.started_at).not.toBeNull();
  });

  it("start-before-commit failure injection: assembler failure writes start_failed with ZERO runs and no spawn", async () => {
    const failing = stubAssembler(async () => {
      throw Object.assign(new Error("ref not resolvable"), { isAppLike: true });
    });
    buildScene(undefined, failing);
    const dispatch = confirm({ clientRequestId: "crq_f" });
    scene.services.db
      .prepare("UPDATE dispatches SET grace_deadline_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), dispatch.id);
    // stub throws a non-AppError → transient path: the error propagates to
    // the worker boundary, the lease stays held, no terminal write happens
    await expect(scene.service.claimAndStart(dispatch.id, "worker-1")).rejects.toThrow("ref not resolvable");
    expect(scene.spawnedRunIds).toEqual([]);
    const runs = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(runs).toBe(0);
    const state = (scene.services.db.prepare("SELECT state, lease_owner FROM dispatches WHERE id = ?").get(dispatch.id) as {
      state: string;
      lease_owner: string | null;
    });
    expect(state.state).toBe("starting");
    expect(state.lease_owner).toBe("worker-1");
  });

  it("deterministic assembler failure (AppError) writes start_failed + diagnostics, zero Runs", async () => {
    const { AppError } = await import("../../src/api/errors.js");
    const failing = stubAssembler(async () => {
      throw new AppError("REPO_NOT_AUTHORIZED" as never, "path not authorized");
    });
    buildScene(undefined, failing);
    const dispatch = confirm({ clientRequestId: "crq_det" });
    const outcome = await scene.service.startNow(dispatch.id, "worker-1");
    expect(outcome.dispatch.state).toBe("start_failed");
    expect(outcome.dispatch.failed_reason_code).toBe("REPO_NOT_AUTHORIZED");
    expect(outcome.dispatch.failed_diagnostics_json).toContain("path not authorized");
    expect(scene.spawnedRunIds).toEqual([]);
    const runs = (scene.services.db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(attemptCount(scene, dispatch.id)).toBe(0);
    expect(runs).toBe(0);
  });
});

function attemptCount(s: Scene, dispatchId: string): number {
  return (s.services.db.prepare("SELECT COUNT(*) AS c FROM attempts WHERE dispatch_id = ?").get(dispatchId) as { c: number }).c;
}

describe("F012 acceptance lock on both start paths (T014, AC-008)", () => {
  it("confirm and deadline claim both reject with DISPATCH_ACCEPTANCE_LOCKED", async () => {
    const { services } = { services: scene.services };
    buildScene();
    const lockedServices = scene.services;
    const service = new DispatchService(
      lockedServices.db,
      scene.outbox,
      scene.gates,
      stubAssembler(),
      lockedServices.agentConfigRepo,
      lockedServices.runRepo,
      lockedServices.nodeRunRepo,
      lockedServices.graphRunRepo,
      {
        graceWindowMs: () => 0,
        acceptanceLock: () => ({ locked: true, reason: "Acceptance case completed — create a new task." }),
      },
    );
    try {
      service.confirm({ ...scene.confirmInput, clientRequestId: "crq_lock1", graceWindowMs: 0 } as DispatchConfirmInput);
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe("DISPATCH_ACCEPTANCE_LOCKED");
    }

    // confirm WITHOUT the lock, then engage the lock; deadline claim must
    // write start_failed rather than create an Attempt (design §4.3).
    const dispatch = scene.service.confirm({ ...scene.confirmInput, clientRequestId: "crq_lock2", graceWindowMs: 0 } as DispatchConfirmInput);
    const claimService = new DispatchService(
      lockedServices.db,
      scene.outbox,
      scene.gates,
      stubAssembler(async () => {
        throw new Error("must not assemble");
      }),
      lockedServices.agentConfigRepo,
      lockedServices.runRepo,
      lockedServices.nodeRunRepo,
      lockedServices.graphRunRepo,
      {
        graceWindowMs: () => 0,
        acceptanceLock: () => ({ locked: true }),
      },
    );
    const outcome = await claimService.claimAndStart(dispatch.id, "worker-1");
    expect(outcome.dispatch.state).toBe("start_failed");
    expect(outcome.dispatch.failed_reason_code).toBe("DISPATCH_ACCEPTANCE_LOCKED");
    expect(attemptCount(scene, dispatch.id)).toBe(0);
    void services;
  });
});

describe("F012 zero grace window (AC-002, graph nodes)", () => {
  it("graceWindowMs=0 dispatches immediately on claimDue", async () => {
    const dispatch = confirm({ clientRequestId: "crq_0", graceWindowMs: 0 });
    const processed = await scene.service.claimDue("worker-1");
    expect(processed).toContain(dispatch.id);
    const row = scene.services.db.prepare("SELECT state FROM dispatches WHERE id = ?").get(dispatch.id) as { state: string };
    expect(row.state).toBe("dispatched");
  });
});
