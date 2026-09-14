// F012 T011 (AC-003): context assembly — the resume key 四元组, the five
// mandatory cold-start conditions, three-tier scope hashing, the
// independent-session start boundary, and the 不变量 12 ownership check on
// recordConsumption integration.

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import {
  DispatchContextError,
  ScopedContextAssembler,
  createContentHash,
  decideStartMode,
  hashContextItems,
  type ContextAssembler,
} from "../../src/services/context-assembler.js";
import { StartMode, type Attempt, type Dispatch } from "@personahub/shared/types";
import type { RepositoryRegistry } from "../../src/services/repository-registry.js";
import type { ArtifactConsumptionLedger } from "../../src/services/artifact/consumption.js";

function dispatchFixture(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: "dsp_t", room_id: "room_t", issue_id: "iss_t", client_request_id: "crq_t",
    state: "starting", purpose: "execute", runtime_id: "local", adapter_config_id: "adp_t",
    access_ref: null, model: "gpt-5.6-sol", depth_raw: "high", depth_normalized: "high",
    identity_snapshot_json: "{}", context_scope: "all", skill_revision_refs_json: "[]",
    effective_requirements_json: "[]", effective_requirements_hash: "sha256:x",
    handoff_refs_json: "[]", task_scope_json: null, requirement_override_json: null,
    grace_deadline_at: "2026-01-01T00:00:10Z", lease_owner: "w", lease_expires_at: null,
    graph_node_run_id: null, failed_reason_code: null, failed_diagnostics_json: null,
    created_at: "2026-01-01T00:00:00Z", started_at: null, ended_at: null,
    ...overrides,
  };
}

describe("decideStartMode — five mandatory cold starts (ADR 0009 §4)", () => {
  const base = {
    purpose: "execute" as const,
    previousAttempt: { id: "atm_1", provider_session_id: "ses_1" } as Pick<Attempt, "id" | "provider_session_id">,
    userRequestedRestart: false,
    previousTerminatedOnPoisonedInput: false,
    sessionUnusable: false,
    nativeMemoryIsolation: "supported" as const,
  };

  it("resumes only when everything lines up and the session exists", () => {
    const decision = decideStartMode(base);
    expect(decision.startMode).toBe(StartMode.Resumed);
    expect(decision.resumedFromAttemptId).toBe("atm_1");
    expect(decision.coldStartReason).toBeNull();
  });

  it("user_restart forces cold start", () => {
    const decision = decideStartMode({ ...base, userRequestedRestart: true });
    expect(decision.coldStartReason).toBe("user_restart");
  });

  it("session_unusable forces cold start", () => {
    expect(decideStartMode({ ...base, sessionUnusable: true }).coldStartReason).toBe("session_unusable");
  });

  it("poisoned_predecessor forces cold start", () => {
    expect(decideStartMode({ ...base, previousTerminatedOnPoisonedInput: true }).coldStartReason).toBe(
      "poisoned_predecessor",
    );
  });

  it("validate and design_cases purposes force cold start (independence_required)", () => {
    expect(decideStartMode({ ...base, purpose: "validate" as const }).coldStartReason).toBe("independence_required");
    expect(decideStartMode({ ...base, purpose: "design_cases" as const }).coldStartReason).toBe("independence_required");
  });

  it("memory isolation unavailable forces cold start — unsupported AND unverified", () => {
    expect(decideStartMode({ ...base, nativeMemoryIsolation: "unsupported" }).coldStartReason).toBe(
      "memory_isolation_unavailable",
    );
    expect(decideStartMode({ ...base, nativeMemoryIsolation: "unverified" }).coldStartReason).toBe(
      "memory_isolation_unavailable",
    );
  });

  it("no previous session means cold start without a forced reason", () => {
    const decision = decideStartMode({ ...base, previousAttempt: null });
    expect(decision.startMode).toBe(StartMode.Cold);
    expect(decision.coldStartReason).toBeNull();
  });

  it("resume failure never rewrites the previous attempt (it stays the resumed_from pointer)", () => {
    const decision = decideStartMode({ ...base, sessionUnusable: true });
    expect(decision.resumedFromAttemptId).toBeNull();
    expect(decision.startMode).toBe(StartMode.Cold);
  });
});

describe("ScopedContextAssembler (T011)", () => {
  function setup(roomIssueId: string | null, verifyResult?: { ok: boolean; reason?: string }) {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF"); // unit focus: assembler logic, not schema FKs
    applyMigrations(db);
    const spaceId = (db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_t', 'P', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(spaceId);
    db.prepare(
      "INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, push_credentials_enabled, created_at, updated_at) VALUES ('wsp_t', 'prj_t', '/tmp/t', '/tmp/t', 'idle', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    if (roomIssueId) {
      db.prepare(
        "INSERT INTO issues (id, project_id, workspace_id, space_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, validation_round_count, created_at, updated_at) VALUES (?, 'prj_t', 'wsp_t', ?, 'coding', 'wft_coding_default', 'vpl_coding_default', 'T', 'Inbox', 'normal', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
      ).run(roomIssueId, spaceId);
    }
    db.prepare(
      "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_t', ?, ?, 'T', 'active', '2026-01-01T00:00:00Z', NULL)",
    ).run(spaceId, roomIssueId);

    const repositoryRegistry = {
      listProjectRefs: () => [{ repository_id: "rep_1", role: "primary", access: "read_write" }],
      verifyAuthorization: () =>
        verifyResult === undefined ? { ok: true, real_path: "/tmp/t" } : (verifyResult as never),
    } as unknown as RepositoryRegistry;

    const recorded: Array<{ dispatchId: string; runId: string; revisionRef: string }> = [];
    const ledger = {
      record: (input: { dispatchId: string; runId: string; revisionRef: string }) => {
        recorded.push(input);
      },
    } as unknown as ArtifactConsumptionLedger;

    const assembler = new ScopedContextAssembler(
      db,
      repositoryRegistry,
      ledger,
      async ({ dispatch }) => ({
        items: [
          { source_ref: `issue:${dispatch.issue_id}`, kind: "issue", decision: "included", reason: null },
          { source_ref: "artifact:art_1@2", kind: "artifact", decision: "filtered", reason: "result_only scope" },
        ],
        consumptionRefs: [{ revisionRef: "artifact:art_1@2", purpose: "execute" }],
      }),
      () => "thr_t",
    );
    return { db, assembler, recorded };
  }

  it("assembles scoped refs, verifies authorization, and records consumption bound to the attempt", async () => {
    const { db, assembler, recorded } = setup("iss_t");
    db.prepare(
      "INSERT INTO attempts (id, dispatch_id, seq, run_id, state, start_mode, created_at) VALUES ('atm_t', 'dsp_t', 1, 'run_t', 'queued', 'cold', '2026-01-01T00:00:00Z')",
    ).run();
    const assembled = await assembler.assemble({ dispatch: dispatchFixture(), runId: "run_t", taskScope: null });
    expect(assembled.items).toHaveLength(2);
    expect(assembled.consumptionRefs).toHaveLength(1);

    assembler.recordConsumptions({ dispatch: dispatchFixture(), runId: "run_t", taskScope: null }, assembled, "thr_t");
    expect(recorded.map((r) => ({ dispatchId: r.dispatchId, runId: r.runId, revisionRef: r.revisionRef }))).toEqual([
      { dispatchId: "dsp_t", runId: "run_t", revisionRef: "artifact:art_1@2" },
    ]);
    db.close();
  });

  it("rejects consumption when the run is not owned by the dispatch (不变量 12)", async () => {
    const { db, assembler } = setup("iss_t");
    const assembled = await assembler.assemble({ dispatch: dispatchFixture(), runId: "run_t", taskScope: null });
    expect(() =>
      assembler.recordConsumptions({ dispatch: dispatchFixture(), runId: "run_t", taskScope: null }, assembled, null),
    ).toThrow(/not owned by dispatch/);
    db.close();
  });

  it("independent sessions cannot start execution (recorded v0.3 boundary)", async () => {
    const { db, assembler } = setup(null);
    await expect(
      assembler.assemble({ dispatch: dispatchFixture({ issue_id: null }), runId: "run_t", taskScope: null }),
    ).rejects.toThrow(/convert the session to a task/);
    db.close();
  });

  it("authorization failures surface the F013 reason as the failed_reason_code", async () => {
    const { db, assembler } = setup("iss_t", { ok: false, reason: "REPO_SCOPE_EMPTY" });
    await expect(
      assembler.assemble({ dispatch: dispatchFixture(), runId: "run_t", taskScope: null }),
    ).rejects.toMatchObject({ reasonCode: "REPO_SCOPE_EMPTY" });
    db.close();
  });

  it("content_hash rebuilds from refs deterministically regardless of item order", () => {
    const items = [
      { source_ref: "issue:iss_t", kind: "issue", decision: "included" as const, reason: null },
      { source_ref: "artifact:art_1@2", kind: "artifact", decision: "filtered" as const, reason: "result_only scope" },
    ];
    expect(hashContextItems(items)).toBe(hashContextItems([...items].reverse()));
    expect(hashContextItems(items)).toBe(
      createContentHash("artifact:art_1@2|filtered|result_only scope\nissue:iss_t|included|"),
    );
  });
});

describe("ContextAssembler interface is owned by DispatchService flows", () => {
  it("exposes assemble + recordConsumptions for the start transaction", async () => {
    const impl: ContextAssembler = {
      async assemble() {
        return {
          scope: "all" as const,
          items: [],
          contentHash: createContentHash(""),
          consumptionRefs: [],
          startMode: StartMode.Cold,
          coldStartReason: null,
          resumedFromAttemptId: null,
        };
      },
      recordConsumptions() {},
    };
    const out = await impl.assemble({
      dispatch: dispatchFixture(),
      runId: "run_x",
      taskScope: null,
    });
    expect(out.contentHash).toMatch(/^sha256:/);
    void DispatchContextError;
  });
});
