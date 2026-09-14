// F012 T007: runtime projection — read-only machine facts (design §6.3) with
// an explicitly empty quota list (ADR 0017: v0.4 owns aggregation; missing
// facts are "—", never 0).

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { RuntimeProjectionService } from "../../src/services/runtime-projection.js";
import type { AgentConfigRepository } from "../../src/repositories/agent-config.js";
import { RunStatus } from "@personahub/shared/types";

function setup() {
  const db = new Database(":memory:");
  applyMigrations(db);
  const agentConfigRepo = {
    getById: (id: string) =>
      db.prepare("SELECT * FROM agent_configs WHERE id = ?").get(id) as never,
    listByProject: () => [] as never[],
  } as unknown as AgentConfigRepository;
  const service = new RuntimeProjectionService(db, {
    agentConfigRepo,
    pendingAvailabilityProbes: () => 2,
    pendingReprobes: () => 1,
  });
  return { db, service };
}

describe("RuntimeProjectionService (T007)", () => {
  it("projects the seeded local machine with the runtime gate state", () => {
    const { db, service } = setup();
    const snapshot = service.getMachineSnapshot("local");
    expect(snapshot.machine).toEqual({ id: "local", label: "This machine", kind: "local" });
    expect(snapshot.runtime_gate.state).toBe("open");
    expect(snapshot.runtime_gate.revision).toBe(0);
    expect(snapshot.background).toEqual({
      pending_probe_count: 2,
      pending_reprobe_count: 1,
      outbox: { pending: 0, poison: 0 },
    });
    expect(snapshot.quota).toEqual([]); // ADR 0017: absent facts, not zeros
    db.close();
  });

  it("lists adapters bound to the runtime, locks, queue depth and running runs", () => {
    const { db, service } = setup();
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_r', 'P', (SELECT id FROM spaces WHERE is_default = 1), '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, locked_by_run_id, push_credentials_enabled, created_at, updated_at) VALUES ('wsp_r', 'prj_r', '/tmp/r', '/tmp/r', 'locked', 'run_r', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, created_at, updated_at) VALUES ('adp_r', 'prj_r', 'codex-gpt5.6-sol-high', 'implementation', 'codex', 'codex', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO issues (id, project_id, workspace_id, space_id, issue_type, workflow_template_id, validation_policy_id, title, status, priority, validation_round_count, created_at, updated_at) VALUES ('iss_r', 'prj_r', 'wsp_r', (SELECT id FROM spaces WHERE is_default = 1), 'coding', 'wft_coding_default', 'vpl_coding_default', 'r', 'Running', 'normal', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO threads (id, issue_id, room_id, thread_type, title, created_at, updated_at) VALUES ('thr_r', 'iss_r', NULL, 'primary', 'r', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, created_at, updated_at) VALUES ('run_q', 'iss_r', 'thr_r', 'wsp_r', 'adp_r', 'queued', 'x', '2026-01-01T00:00:01Z', '2026-01-01T00:00:01Z')",
    ).run();
    db.prepare(
      "INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, started_at, created_at, updated_at) VALUES ('run_go', 'iss_r', 'thr_r', 'wsp_r', 'adp_r', 'running', 'x', '2026-01-01T00:00:02Z', '2026-01-01T00:00:02Z', '2026-01-01T00:00:02Z')",
    ).run();

    const snapshot = service.getMachineSnapshot("local");
    expect(snapshot.adapters).toHaveLength(1);
    expect(snapshot.adapters[0]).toMatchObject({ id: "adp_r", cli_provider: "codex", runtime_id: "local" });
    expect(snapshot.workspace_locks).toEqual([
      { workspace_id: "wsp_r", project_id: "prj_r", locked_by_run_id: "run_r", locked_at: null },
    ]);
    expect(snapshot.queue).toEqual({ queued_count: 1, running_run_ids: ["run_go"] });
    db.close();
  });

  it("adapter facts surface freshest capability evidence per key with the probe version", () => {
    const { db, service } = setup();
    db.prepare(
      "INSERT INTO projects (id, name, space_id, created_at, updated_at) VALUES ('prj_r', 'P', (SELECT id FROM spaces WHERE is_default = 1), '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, created_at, updated_at) VALUES ('adp_r', 'prj_r', 'codex', 'implementation', 'codex', 'codex', '[]', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO adapter_capability_evidence (id, cli_provider, cli_version, capability_key, verdict, probe_command, probe_result, probed_at, missing_reason) VALUES (?, 'codex', ?, ?, ?, 'cmd', '{}', ?, NULL)",
    );
    insert.run("cap_old", "0.153.0", "depth", "supported", "2026-09-01T00:00:00Z");
    insert.run("cap_new", "0.154.0", "depth", "supported", "2026-09-14T00:00:00Z");
    insert.run("cap_models", "0.154.0", "model_enumeration", "supported", "2026-09-14T00:00:00Z");

    const facts = service.getAdapterFacts("adp_r");
    const depth = facts.capability_evidence.find((row) => row.capability_key === "depth");
    expect(depth!.cli_version).toBe("0.154.0");
    expect(facts.capability_evidence.length).toBe(2);
    db.close();
  });

  it("unknown machine ids are a 404-class error, never an empty projection", () => {
    const { db, service } = setup();
    expect(() => service.getMachineSnapshot("nope")).toThrow();
    db.close();
  });
});
