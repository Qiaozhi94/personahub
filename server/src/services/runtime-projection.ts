// F012 T007: single-machine runtime projection — READ-ONLY aggregation of
// adapter status, workspace locks, queue depth, running runs and background
// task counts for the machine overview (design §6.3). It intentionally offers
// NO stop/intervention action: stopping execution lives on the task surface
// (PRD §5.10). Quota facts are ADR 0017 self-reported values; v0.3 collects
// none, so `quota` stays empty and the UI renders "—", never 0.

import type Database from "better-sqlite3";
import { GateState, RunStatus, type RuntimeAdapterFacts, type RuntimeMachineProjection } from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import type { AgentConfigRepository } from "../repositories/agent-config.js";
import { loadCapabilityEvidenceFromDb, parseCapabilityEvidenceFixture } from "./capability-evidence.js";

export interface RuntimeProjectionDependencies {
  agentConfigRepo: AgentConfigRepository;
  pendingAvailabilityProbes: () => number;
  pendingReprobes: () => number;
}

export class RuntimeProjectionService {
  constructor(
    private db: Database.Database,
    private deps: RuntimeProjectionDependencies,
  ) {}

  /** Machines table holds exactly one row in v0.3; the projection is its read
   *  model. Unknown machine ids are a 404, not an empty projection. */
  getMachineSnapshot(machineId = "local"): RuntimeMachineProjection {
    const machine = this.db
      .prepare("SELECT id, label, kind FROM runtime_machines WHERE id = ?")
      .get(machineId) as { id: string; label: string; kind: string } | undefined;
    if (!machine) throw new AppError(ErrorCode.RUNTIME_CONTEXT_UNAVAILABLE, `Unknown runtime machine: ${machineId}`);

    const adapters = this.listAdapters(machineId);

    const locks = this.db
      .prepare(
        `SELECT w.id AS workspace_id, w.project_id, w.locked_by_run_id, w.locked_at
         FROM workspaces w
         JOIN projects p ON p.id = w.project_id
         WHERE w.lock_state = 'locked' ORDER BY w.locked_at ASC`,
      )
      .all() as RuntimeMachineProjection["workspace_locks"];

    const queued = this.db
      .prepare("SELECT COUNT(*) AS c FROM runs WHERE status = ?")
      .get(RunStatus.Queued) as { c: number };
    const running = this.db
      .prepare("SELECT id FROM runs WHERE status = ? ORDER BY started_at ASC")
      .all(RunStatus.Running) as Array<{ id: string }>;

    const outboxRow = this.db
      .prepare(
        "SELECT SUM(CASE WHEN status IN ('pending','in_flight') THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'poison' THEN 1 ELSE 0 END) AS poison FROM domain_outbox",
      )
      .get() as { pending: number | null; poison: number | null };

    const gate = this.db
      .prepare("SELECT state, revision, reason, updated_at FROM dispatch_gates WHERE scope_type = 'runtime' AND scope_id = ?")
      .get(machineId) as { state: GateState; revision: number; reason: string | null; updated_at: string } | undefined;

    return {
      machine,
      adapters,
      workspace_locks: locks,
      queue: { queued_count: queued.c, running_run_ids: running.map((r) => r.id) },
      background: {
        pending_probe_count: this.deps.pendingAvailabilityProbes(),
        pending_reprobe_count: this.deps.pendingReprobes(),
        outbox: { pending: outboxRow.pending ?? 0, poison: outboxRow.poison ?? 0 },
      },
      runtime_gate: gate ?? { state: GateState.Open, revision: 0, reason: null, updated_at: "" },
      quota: [],
    };
  }

  /** Per-adapter facts for the runtime adapter tab: status, capability
   *  evidence (with CLI version + probe time) and the visible model list. */
  getAdapterFacts(adapterConfigId: string): RuntimeAdapterFacts {
    const adapter = this.deps.agentConfigRepo.getById(adapterConfigId);
    if (!adapter) throw new AppError(ErrorCode.ADAPTER_NOT_FOUND, "Adapter config not found.");

    // Freshest evidence row per capability regardless of the CLI version it
    // was recorded with — the UI displays the version alongside the verdict.
    const rows = this.db
      .prepare(
        `SELECT capability_key, verdict, cli_version, probed_at, missing_reason
         FROM adapter_capability_evidence
         WHERE id IN (
           SELECT id FROM adapter_capability_evidence
           WHERE cli_provider = ?
           ORDER BY probed_at DESC
         )
         GROUP BY capability_key`,
      )
      .all(adapter.cli_provider) as Array<{
      capability_key: string;
      verdict: "supported" | "unsupported" | "unverified";
      cli_version: string;
      probed_at: string;
      missing_reason: string | null;
    }>;

    let models: string[] = [];
    const enumeration = rows.find((row) => row.capability_key === "model_enumeration");
    if (enumeration?.verdict === "supported") {
      const fixture = parseCapabilityEvidenceFixture(loadCapabilityEvidenceFromDb(this.db));
      const probe = fixture?.adapters[adapter.cli_provider]?.probes["model_enumeration"];
      if (probe) {
        try {
          const parsed = JSON.parse(probe.probe_result) as { models?: Array<{ id?: string }> };
          models = (parsed.models ?? []).filter((m): m is { id: string } => typeof m.id === "string").map((m) => m.id);
        } catch {
          models = [];
        }
      }
    }

    return {
      adapter: {
        id: adapter.id,
        name: adapter.name,
        cli_provider: adapter.cli_provider,
        runtime_id: adapter.runtime_id,
        status: adapter.status,
        last_checked_at: adapter.last_checked_at,
        auth_status_message: adapter.auth_status_message,
        default_model: adapter.default_model,
      },
      capability_evidence: rows as RuntimeAdapterFacts["capability_evidence"],
      models,
      quota: [],
    };
  }

  private listAdapters(runtimeId: string): RuntimeMachineProjection["adapters"] {
    // listByProject is the repository's only listing surface; the machine
    // overview needs every adapter bound to this runtime, so read the table
    // directly — the repository stays project-scoped by design.
    const rows = this.db
      .prepare(
        "SELECT id, name, cli_provider, runtime_id, status, last_checked_at, auth_status_message, default_model FROM agent_configs WHERE runtime_id = ? ORDER BY created_at ASC",
      )
      .all(runtimeId) as RuntimeMachineProjection["adapters"];
    return rows;
  }
}
