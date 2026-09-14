// F012 T021/T022/T023 (AC-002/AC-004/AC-007/AC-008) integration layer:
// - two connections racing the claim CAS → exactly one dispatch/attempt
// - outbox survives a process restart (new instance, same DB) without loss
//   or duplication, with per-consumer acks shared across restarts (F011's
//   `acceptance.completed` reuse of the same outbox instance)
// - task_scope_json flows from confirm into F013 verifyAuthorization; an
//   unauthorized repository writes start_failed with zero Runs on the claim
//   path (FR-011 / 不变量 14).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { DomainOutbox } from "../../src/services/domain-outbox.js";
import { DispatchGateService } from "../../src/services/dispatch-gate-service.js";
import { DispatchService, type DispatchConfirmInput } from "../../src/services/dispatch-service.js";
import { DispatchContextError, type ContextAssembler } from "../../src/services/context-assembler.js";
import type { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import type { RunRepository } from "../../src/repositories/run.js";
import type { Dispatch } from "@personahub/shared/types";

const SPACES: Array<{ id: string; name: string }> = [{ id: "spc_def", name: "Default" }];

function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  applyMigrations(db);
  if (SPACES[0]) {
    db.prepare(
      "INSERT OR IGNORE INTO spaces (id, name, is_default, state, created_at, updated_at) VALUES (?, ?, 1, 'active', ?, ?)",
    ).run(SPACES[0].id, SPACES[0].name, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
  }
  return db;
}

interface Graph {
  roomId: string;
  issueId: string;
  adapterId: string;
}

function buildGraph(db: Database.Database): Graph {
  db.prepare(
    "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_c', 'C', (SELECT id FROM spaces WHERE is_default = 1), '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES ('wsp_c', 'prj_c', '/tmp/c', '/tmp/c', 'idle', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO issues (id, project_id, workspace_id, space_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, validation_round_count, created_at, updated_at) VALUES ('iss_c', 'prj_c', 'wsp_c', (SELECT id FROM spaces WHERE is_default = 1), 'coding', 'wft_coding_default', 'vpl_coding_default', 'C', 'Inbox', 'normal', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_c', 'iss_c', 'room_c', 'primary', 'C', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_c', (SELECT id FROM spaces WHERE is_default = 1), 'iss_c', 'C', 'active', '2026-01-01T00:00:00Z', NULL)",
  ).run();
  db.prepare(
    "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, created_at, updated_at) VALUES ('adp_c', 'prj_c', 'codex-high', 'implementation', 'codex', 'codex', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
  ).run();
  return { roomId: "room_c", issueId: "iss_c", adapterId: "adp_c" };
}

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

function makeService(db: Database.Database, graph: Graph, spawns: string[]): DispatchService {
  const gates = new DispatchGateService(db);
  // A dedicated outbox per service mirrors per-process workers sharing one DB.
  const outbox = new DomainOutbox(db);
  const agentConfigRepo = { getById: (id: string) => db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as never } as unknown as AgentConfigRepository;
  const runRepo = {
    getById: (id: string) => db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as never,
    create: (input: Record<string, unknown>) => {
      db.prepare(
        "INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, 'iss_c', 'thr_c', 'wsp_c', ?, 'queued', 'x', 'implementation', 'user_explicit', ?, ?)",
      ).run(input.id, input.adapter_config_id, new Date().toISOString(), new Date().toISOString());
    },
    transitionStatus: (id: string, from: string, to: string) => {
      const r = db.prepare("UPDATE runs SET status = ? WHERE id = ? AND status = ?").run(to, id, from);
      return { success: r.changes > 0 };
    },
  } as unknown as RunRepository;
  return new DispatchService(db, outbox, gates, stubAssembler(), agentConfigRepo, runRepo, {
    graceWindowMs: () => 0,
    spawnRun: async (runId) => {
      spawns.push(runId);
    },
  });
}

function confirmInput(graph: Graph, clientRequestId: string): DispatchConfirmInput {
  return {
    roomId: graph.roomId,
    clientRequestId,
    purpose: "execute",
    identity: {
      runtime_id: "local",
      adapter_config_id: graph.adapterId,
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
}

describe("F012 T021/T022/T023 integration", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f012-int-"));
    dbPath = join(dir, "db.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("two processes racing the claim produce exactly one dispatch→attempt→spawn (AC-004)", async () => {
    const dbA = openDb(dbPath);
    const dbB = openDb(dbPath);
    const graph = buildGraph(dbA); // rows live in the shared file; B reads them

    const spawnsA: string[] = [];
    const spawnsB: string[] = [];
    const serviceA = makeService(dbA, graph, spawnsA);
    const serviceB = makeService(dbB, graph, spawnsB);

    const dispatch: Dispatch = serviceA.confirm(confirmInput(graph, "crq_race"));
    expect(dispatch.state).toBe("draft");

    const [outcomeA, outcomeB] = await Promise.all([
      serviceA.claimAndStart(dispatch.id, "worker-A"),
      serviceB.claimAndStart(dispatch.id, "worker-B"),
    ]);

    const dispatched = [outcomeA, outcomeB].filter((o) => o.dispatch.state === "dispatched");
    expect(dispatched).toHaveLength(1);
    const attempts = (dbA.prepare("SELECT COUNT(*) AS c FROM attempts WHERE dispatch_id = ?").get(dispatch.id) as { c: number }).c;
    expect(attempts).toBe(1);
    const runs = (dbA.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(runs).toBe(1);
    const totalSpawns = [...spawnsA, ...spawnsB];
    expect(totalSpawns).toHaveLength(1);
    dbA.close();
    dbB.close();
  });

  it("outbox redelivers across a process restart; consumer acks are shared and idempotent (AC-007)", async () => {
    const db1 = openDb(dbPath);
    const outbox1 = new DomainOutbox(db1);
    const handled: string[] = [];
    outbox1.registerConsumer("acceptance.completed", "issue-service", (event) => {
      handled.push(`handled:${event.dedupe_key}`);
    });
    db1.transaction(() => {
      outbox1.enqueue(db1, { topic: "acceptance.completed", payload: { summary_id: "evs_1" }, dedupeKey: "acceptance:evs_1" });
    })();

    // worker claims, then the process dies before the consumer ran. The
    // lease had 1s left when it died; the restart observes it expired.
    outbox1.claimBatch("worker-crashed", 10, 1_000);
    db1.close();

    // "restart": new instance over the same DB re-registers the same consumer
    const db2 = openDb(dbPath);
    // the crashed worker's lease expires while the process is down
    db2.prepare("UPDATE domain_outbox SET claim_expires_at = '2026-01-01T00:00:00Z' WHERE status = 'in_flight'").run();
    const outbox2 = new DomainOutbox(db2);
    const stillHandled: string[] = [];
    outbox2.registerConsumer("acceptance.completed", "issue-service", (event) => {
      stillHandled.push(`handled:${event.dedupe_key}`);
    });
    const delivered = await outbox2.tick("worker-restart", 60_000);
    expect(delivered).toBe(1);
    expect(stillHandled).toEqual(["handled:acceptance:evs_1"]);
    expect(handled).toEqual([]); // the crashed process never delivered it

    // replaying the tick after delivery is a no-op — acks made it idempotent
    const again = await outbox2.tick("worker-restart", 60_000);
    expect(again).toBe(0);
    expect(stillHandled).toHaveLength(1);

    // re-enqueueing the same domain fact is absorbed by the dedupe key
    let secondId = "";
    db2.transaction(() => {
      secondId = outbox2.enqueue(db2, { topic: "acceptance.completed", payload: {}, dedupeKey: "acceptance:evs_1" });
    })();
    const rows = db2.prepare("SELECT id, status FROM domain_outbox").all() as Array<{ id: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(secondId).toBe(rows[0]!.id);
    expect(rows[0]!.status).toBe("delivered");
    void stillHandled;
    db2.close();
  });

  it("task_scope_json reaches F013 verifyAuthorization; unauthorized repo → start_failed with zero Runs (FR-011)", async () => {
    const db = openDb(dbPath);
    const graph = buildGraph(db);
    const gates = new DispatchGateService(db);
    const outbox = new DomainOutbox(db);
    const captured: Array<{ repository_id?: string; task_scope?: unknown }> = [];

    const assembler: ContextAssembler = {
      async assemble(input) {
        // Stand-in for ScopedContextAssembler's authorization step: capture
        // exactly what the dispatch froze and enforce a narrowing rule.
        const primary = { repository_id: "rep_auth" };
        captured.push({ repository_id: primary.repository_id, task_scope: input.taskScope });
        if (input.taskScope && input.taskScope["write"]?.length === 0) {
          throw Object.assign(new Error("scope empty after narrowing"), { code: "REPO_SCOPE_EMPTY" });
        }
        return {
          scope: input.dispatch.context_scope,
          items: [],
          contentHash: "sha256:ok",
          consumptionRefs: [],
          startMode: "cold",
          coldStartReason: null,
          resumedFromAttemptId: null,
        };
      },
      recordConsumptions() {},
    };

    const agentConfigRepo = { getById: (id: string) => db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as never } as unknown as AgentConfigRepository;
    const runRepo = {
      getById: (id: string) => db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as never,
      create: (input: Record<string, unknown>) => {
        db.prepare(
          "INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, dispatch_source, created_at, updated_at) VALUES (?, 'iss_c', 'thr_c', 'wsp_c', ?, 'queued', 'x', 'implementation', 'user_explicit', ?, ?)",
        ).run(input.id, input.adapter_config_id, new Date().toISOString(), new Date().toISOString());
      },
    } as unknown as RunRepository;

    const spawns: string[] = [];
    const service = new DispatchService(db, outbox, gates, assembler, agentConfigRepo, runRepo, {
      graceWindowMs: () => 0,
      spawnRun: async (runId) => spawns.push(runId),
    });

    // path A: narrowed task scope survives confirm → frozen on the row →
    // handed to the authorization re-check
    const ok = await service.startNow(
      service.confirm({ ...confirmInput(graph, "crq_scope"), taskScopeJson: JSON.stringify({ read: ["src"], write: ["src"] }) }).id,
      "worker-1",
    );
    expect(ok.dispatch.state).toBe("dispatched");
    expect(captured[0]?.task_scope).toEqual({ read: ["src"], write: ["src"] });
    expect(spawns).toHaveLength(1);

    // path B: an unauthorized repository (narrowed to nothing) fails the
    // claim path into start_failed with a stable reason and zero Runs
    const failingAssembler: ContextAssembler = {
      async assemble() {
        throw new DispatchContextError("REPO_SCOPE_EMPTY", "no authorized paths after narrowing");
      },
      recordConsumptions() {},
    };
    const serviceFail = new DispatchService(db, outbox, gates, failingAssembler, agentConfigRepo, runRepo, {
      graceWindowMs: () => 0,
      spawnRun: async (runId) => spawns.push(runId),
    });
    const bad = serviceFail.confirm(confirmInput(graph, "crq_unauth"));
    const outcome = await serviceFail.startNow(bad.id, "worker-1");
    expect(outcome.dispatch.state).toBe("start_failed");
    expect(outcome.dispatch.failed_reason_code).toBe("REPO_SCOPE_EMPTY");
    expect(spawns).toHaveLength(1); // no new spawn
    const runCount = (db.prepare("SELECT COUNT(*) AS c FROM runs").get() as { c: number }).c;
    expect(runCount).toBe(1); // only path A's run exists
    db.close();
  });
});
