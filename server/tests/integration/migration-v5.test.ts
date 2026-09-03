import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../../src/db/migrations.js";
import { createTestServices, disposeTestServices, createTempDir } from "../helpers.js";
import { AdapterStatus, RunStatus, RunRole, RunDispatchSource, AgentCapability } from "@personahub/shared/types";

type SummaryRow = Record<string, string | number>;

function insertSummary(db: Database.Database, overrides: SummaryRow = {}): void {
  const rnd = Math.random().toString(36).slice(2);
  const v: SummaryRow = {
    id: `es_${rnd}`,
    issue_id: `iss_${rnd}`,
    thread_id: "th",
    validator_run_id: "rv",
    implementation_run_id: "ri",
    validation_result: "passed",
    evidence_refs: "[]",
    summary_markdown: "md",
    same_origin_validation: 0,
    implementation_identity_json: "{}",
    validator_identity_json: "{}",
    policy_id: "p",
    policy_version: 1,
    policy_snapshot_json: "{}",
    policy_snapshot_hash: "sha256:abc",
    created_at: "2026-01-01",
    ...overrides,
  };
  db.prepare(
    `INSERT INTO evidence_summaries (id, issue_id, thread_id, validator_run_id, implementation_run_id, validation_result, evidence_refs, summary_markdown, same_origin_validation, implementation_identity_json, validator_identity_json, policy_id, policy_version, policy_snapshot_json, policy_snapshot_hash, created_at)
     VALUES (@id, @issue_id, @thread_id, @validator_run_id, @implementation_run_id, @validation_result, @evidence_refs, @summary_markdown, @same_origin_validation, @implementation_identity_json, @validator_identity_json, @policy_id, @policy_version, @policy_snapshot_json, @policy_snapshot_hash, @created_at)`,
  ).run(v);
}

describe("T095 schema v5 evidence_summaries invariants", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");
    applyMigrations(db);
  });
  afterEach(() => db.close());

  // v5 introduced per-round validator uniqueness; schema-v11 (BUG-003) widened
  // the same guarantee to (round, attempt) and renamed the index. The invariant
  // v5 owns — "a validator cannot silently duplicate a round" — is still in force.
  it("keeps a unique index guarding validator rounds", () => {
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_validator_per_round_attempt'").get();
    expect(idx).toBeTruthy();
  });

  it("accepts a well-formed evidence summary", () => {
    expect(() => insertSummary(db)).not.toThrow();
  });

  it("rejects validation_result other than 'passed'", () => {
    expect(() => insertSummary(db, { validation_result: "failed" })).toThrow();
  });

  it("rejects same_origin_validation outside 0/1", () => {
    expect(() => insertSummary(db, { same_origin_validation: 2 })).toThrow();
  });

  it("rejects a malformed policy snapshot hash", () => {
    expect(() => insertSummary(db, { policy_snapshot_hash: "md5:zzz" })).toThrow();
  });
});

describe("T095 per-round validator DB uniqueness", () => {
  it("rejects a second validator Run for the same issue+round at the DB level", () => {
    const services = createTestServices();
    const tempDir = createTempDir();
    try {
      const project = services.projectService.create("T");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      const val = services.agentConfigRepo.create({ project_id: project.id, name: "V", role: "validator", cli_provider: "codex", command: "codex", args: [], capability_tags: [AgentCapability.Validator], default_model: "m", status: AdapterStatus.Available });
      const base = {
        issue_id: issue.id, thread_id: issue.primary_thread!.id, workspace_id: issue.workspace_id,
        adapter_config_id: val.id, instructions: "", status: RunStatus.Completed,
        role: RunRole.Validator, dispatch_source: RunDispatchSource.System, validation_round: 1,
        adapter_identity: { adapter_config_id: val.id, name: "V", cli_provider: "codex", default_model: "m" },
      };
      services.runRepo.create(base);
      expect(() => services.runRepo.create(base)).toThrow();
    } finally {
      disposeTestServices(services);
    }
  });
});
