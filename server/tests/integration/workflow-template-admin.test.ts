import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { createTestServices, createTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { openDatabase } from "../../src/db/index.js";
import { WorkflowTemplateRepository } from "../../src/repositories/workflow-template.js";
import { AdminAuditEventRepository } from "../../src/repositories/admin-audit-event.js";
import { WorkflowTemplateAdminService } from "../../src/services/workflow-template-admin.js";
import { workflowTemplateRoutes } from "../../src/api/routes/workflow-templates.js";
import { AppError, getErrorStatus, buildErrorResponse } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";
import { ValidationBlockReason } from "@personahub/shared/types";
import { selectValidator } from "../../src/services/validation/validator-selector.js";

interface ServiceFixture {
  db: Database.Database;
  repo: WorkflowTemplateRepository;
  auditRepo: AdminAuditEventRepository;
  service: WorkflowTemplateAdminService;
}

function makeService(db?: Database.Database, auditRepo?: AdminAuditEventRepository): ServiceFixture {
  const realDb = db ?? openDatabase(":memory:");
  const repo = new WorkflowTemplateRepository(realDb);
  const audit = auditRepo ?? new AdminAuditEventRepository(realDb);
  const service = new WorkflowTemplateAdminService(repo, audit, realDb);
  return { db: realDb, repo, auditRepo: audit, service };
}

function stepsJson(steps: Array<{ id: string; role: string }>): string {
  return JSON.stringify({ schema_version: 1, steps });
}

const WITH_VALIDATOR = stepsJson([
  { id: "implementation", role: "implementation" },
  { id: "validation", role: "validator" },
]);

const NO_VALIDATOR = stepsJson([{ id: "implementation", role: "implementation" }]);

function setStepsJson(db: Database.Database, id: string, json: string | null): void {
  db.prepare("UPDATE workflow_templates SET steps_json = ?, updated_at = ? WHERE id = ?").run(
    json,
    new Date().toISOString(),
    id,
  );
}

function setActiveStatus(db: Database.Database, id: string, status: string): void {
  db.prepare("UPDATE workflow_templates SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    new Date().toISOString(),
    id,
  );
}

function buildRouteApp(service: WorkflowTemplateAdminService) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(getErrorStatus(error.code));
      return buildErrorResponse(error);
    }
    reply.code(500);
    return { error: { code: ErrorCode.INTERNAL_ERROR, message: error.message ?? "unexpected", details: {} } };
  });
  app.register(workflowTemplateRoutes, { workflowTemplateAdminService: service });
  return app;
}

const DEFAULT_TEMPLATE_ID = "wft_coding_default";

describe("F008 Phase 1: detail projection (T010/T011/T012/T013)", () => {
  let f: ServiceFixture;
  beforeEach(() => {
    f = makeService();
  });
  afterEach(() => {
    f.db.close();
  });

  it("T010: listByIssueType returns versions ascending", () => {
    f.repo.insertVersion(
      f.repo.getById(DEFAULT_TEMPLATE_ID)!,
      { name: "v2", steps_json: WITH_VALIDATOR },
      false,
      "wft_v2",
      2,
    );
    f.repo.insertVersion(
      f.repo.getById(DEFAULT_TEMPLATE_ID)!,
      { name: "v3", steps_json: WITH_VALIDATOR },
      false,
      "wft_v3",
      3,
    );
    const list = f.service.list("coding");
    expect(list.map((t) => t.version)).toEqual([1, 2, 3]);
  });

  it("T011: detail returns steps + validation_enabled=true when validator present", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const detail = f.service.detail(DEFAULT_TEMPLATE_ID);
    expect(detail.steps).toHaveLength(2);
    expect(detail.steps[1].role).toBe("validator");
    expect(detail.validation_enabled).toBe(true);
    expect(detail.parse_error).toBeNull();
  });

  it("T011: detail returns validation_enabled=false when no validator step", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, NO_VALIDATOR);
    const detail = f.service.detail(DEFAULT_TEMPLATE_ID);
    expect(detail.validation_enabled).toBe(false);
    expect(detail.steps).toHaveLength(1);
  });

  it("T012: invalid steps_json yields null validation_enabled + parse_error, request does not fail", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, "not json");
    const detail = f.service.detail(DEFAULT_TEMPLATE_ID);
    expect(detail.validation_enabled).toBeNull();
    expect(detail.parse_error).toContain("parse");
    expect(detail.steps).toEqual([]);
  });

  it("T012: null steps_json yields validation_enabled=false (loose parser returns []), no parse_error", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, null);
    const detail = f.service.detail(DEFAULT_TEMPLATE_ID);
    expect(detail.validation_enabled).toBe(false);
    expect(detail.parse_error).toBeNull();
  });

  it("T013: admin projection matches validator-selector for varied steps_json (AC-001 same-origin)", () => {
    const cases: Array<{ json: string | null; expected: boolean | null }> = [
      { json: WITH_VALIDATOR, expected: true },
      { json: NO_VALIDATOR, expected: false },
      { json: null, expected: false },
      { json: "not json", expected: null },
      { json: JSON.stringify({ schema_version: 1, steps: [{ id: "x", role: "reviewer" }] }), expected: false },
    ];
    for (const c of cases) {
      setStepsJson(f.db, DEFAULT_TEMPLATE_ID, c.json);
      const detail = f.service.detail(DEFAULT_TEMPLATE_ID);
      expect(detail.validation_enabled).toBe(c.expected);
      // AC-001: cross-check against the validator-selector's own derivation.
      // selectValidator returns WorkflowConfigurationInvalid iff the template
      // has no validator step (including null steps_json); for a with-validator
      // template it returns ValidatorUnavailable (validation on, just no
      // adapter). So validation_enabled === reason !== WorkflowConfigurationInvalid,
      // except when parse throws -> admin reports null.
      const template = f.repo.getById(DEFAULT_TEMPLATE_ID)!;
      let selectorEnabled: boolean | null;
      try {
        const result = selectValidator({ workflowTemplate: template, availableValidators: [] });
        selectorEnabled = result.reason !== ValidationBlockReason.WorkflowConfigurationInvalid;
      } catch {
        selectorEnabled = null;
      }
      expect(detail.validation_enabled).toBe(selectorEnabled);
    }
  });
});

describe("F008 Phase 2: versioned writes (T020/T020b/T020c/T021/T022/T023/T024)", () => {
  let f: ServiceFixture;
  beforeEach(() => {
    f = makeService();
  });
  afterEach(() => {
    f.db.close();
  });

  it("T020: createVersion produces new id, version=max+1, inherits issue_type + non-editable fields", () => {
    const source = f.repo.getById(DEFAULT_TEMPLATE_ID)!;
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    f.db
      .prepare(
        "UPDATE workflow_templates SET collaboration_topology = ?, validation_policy_id = ?, handoff_policy_json = ?, evidence_requirements_json = ?, agent_team_template_id = ? WHERE id = ?",
      )
      .run("topo-x", "vpl_1", '{"h":1}', '{"e":1}', "att_1", DEFAULT_TEMPLATE_ID);
    const refreshed = f.repo.getById(DEFAULT_TEMPLATE_ID)!;

    const detail = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2", steps_json: NO_VALIDATOR });
    expect(detail.version).toBe(2);
    expect(detail.id).not.toBe(DEFAULT_TEMPLATE_ID);
    expect(detail.status).toBe("inactive");
    expect(detail.issue_type).toBe(refreshed.issue_type);
    expect(detail.collaboration_topology).toBe(refreshed.collaboration_topology);
    expect(detail.validation_policy_id).toBe(refreshed.validation_policy_id);
    expect(detail.handoff_policy_json).toBe(refreshed.handoff_policy_json);
    expect(detail.evidence_requirements_json).toBe(refreshed.evidence_requirements_json);
    expect(detail.agent_team_template_id).toBe(refreshed.agent_team_template_id);
    expect(detail.steps_json).toBe(NO_VALIDATOR);
    expect(detail.name).toBe("v2");
  });

  it("T020: non-editable field in body -> 400 TEMPLATE_FIELD_NOT_EDITABLE (route boundary)", async () => {
    const app = buildRouteApp(f.service);
    const res = await app.inject({
      method: "POST",
      url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
      payload: { collaboration_topology: "should-be-rejected" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe(ErrorCode.TEMPLATE_FIELD_NOT_EDITABLE);
    expect(body.error.field).toBe("collaboration_topology");
    await app.close();
  });

  it("T020: each non-editable field is rejected", async () => {
    const app = buildRouteApp(f.service);
    const fields = [
      "collaboration_topology",
      "validation_policy_id",
      "handoff_policy_json",
      "evidence_requirements_json",
      "agent_team_template_id",
      "issue_type",
      "id",
      "status",
      "version",
    ];
    for (const field of fields) {
      const res = await app.inject({
        method: "POST",
        url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
        payload: { [field]: "x" },
      });
      expect(res.statusCode, `field ${field}`).toBe(400);
      expect(JSON.parse(res.body).error.code, `field ${field}`).toBe(ErrorCode.TEMPLATE_FIELD_NOT_EDITABLE);
    }
    await app.close();
  });

  it("T020: unknown/typo field is also rejected as non-editable", async () => {
    const app = buildRouteApp(f.service);
    const res = await app.inject({
      method: "POST",
      url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
      payload: { actvate: true },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.TEMPLATE_FIELD_NOT_EDITABLE);
    await app.close();
  });

  it("T020b: concurrent max+1 collision maps to 409 TEMPLATE_VERSION_CONFLICT (not 500)", () => {
    // Pre-seed v2 (inactive) so the real max is 2.
    f.repo.insertVersion(
      f.repo.getById(DEFAULT_TEMPLATE_ID)!,
      { name: "v2seed", steps_json: WITH_VALIDATOR },
      false,
      "wft_v2seed",
      2,
    );
    // Make getMaxVersion return a stale value (1) so createVersion computes
    // version=2 and collides with the seeded v2 row via the unique index.
    const realGetMax = f.repo.getMaxVersion.bind(f.repo);
    f.repo.getMaxVersion = () => 1;
    try {
      try {
        f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2collide", steps_json: WITH_VALIDATOR });
        throw new Error("expected TEMPLATE_VERSION_CONFLICT");
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_VERSION_CONFLICT);
        expect(getErrorStatus((e as AppError).code)).toBe(409);
      }
    } finally {
      f.repo.getMaxVersion = realGetMax;
    }
  });

  it("T020c: non-editable fields are read-only and inherited (no runtime consumer)", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    f.db
      .prepare("UPDATE workflow_templates SET handoff_policy_json = ?, evidence_requirements_json = ? WHERE id = ?")
      .run('{"orig":true}', '{"orig":true}', DEFAULT_TEMPLATE_ID);
    const detail = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2", steps_json: NO_VALIDATOR });
    // Inherited verbatim; the request never had a way to set them.
    expect(detail.handoff_policy_json).toBe('{"orig":true}');
    expect(detail.evidence_requirements_json).toBe('{"orig":true}');
  });

  it("T021: insertVersion activate:true deactivates siblings in the same txn -> single active", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const detail = f.service.createVersion(DEFAULT_TEMPLATE_ID, {
      name: "v2",
      steps_json: WITH_VALIDATOR,
      activate: true,
    });
    expect(detail.status).toBe("active");
    expect(detail.version).toBe(2);
    const active = f.repo.listByIssueType("coding").filter((t) => t.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(detail.id);
    // Original v1 is now inactive.
    expect(f.repo.getById(DEFAULT_TEMPLATE_ID)!.status).toBe("inactive");
  });

  it("T022: editing a template referenced by an in-progress issue leaves the original row + issue ref unchanged", () => {
    const tempDir = createTempDir();
    const services = createTestServices();
    try {
      setStepsJson(services.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
      const project = services.projectService.create("P");
      services.workspaceService.bind(project.id, tempDir);
      const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
      expect(issue.workflow_template_id).toBe(DEFAULT_TEMPLATE_ID);

      const before = services.workflowTemplateRepo.getById(DEFAULT_TEMPLATE_ID)!;

      const adminRepo = new AdminAuditEventRepository(services.db);
      const admin = new WorkflowTemplateAdminService(services.workflowTemplateRepo, adminRepo, services.db);
      admin.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2", steps_json: NO_VALIDATOR });

      const after = services.workflowTemplateRepo.getById(DEFAULT_TEMPLATE_ID)!;
      expect(after.steps_json).toBe(before.steps_json);
      expect(after.name).toBe(before.name);
      expect(after.status).toBe(before.status);
      expect(after.version).toBe(before.version);
      expect(after.collaboration_topology).toBe(before.collaboration_topology);

      const refetchedIssue = services.issueRepo.getById(issue.id)!;
      expect(refetchedIssue.workflow_template_id).toBe(DEFAULT_TEMPLATE_ID);
    } finally {
      disposeTestServices(services);
    }
  });

  it("T023: deactivate last active -> 409 LAST_ACTIVE_TEMPLATE (user-level, not INTERNAL_ERROR)", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    try {
      f.service.deactivate(DEFAULT_TEMPLATE_ID);
      throw new Error("expected LAST_ACTIVE_TEMPLATE");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(ErrorCode.LAST_ACTIVE_TEMPLATE);
      expect(getErrorStatus((e as AppError).code)).toBe(409);
    }
    // The template is still active (reject did not mutate).
    expect(f.repo.getById(DEFAULT_TEMPLATE_ID)!.status).toBe("active");
  });

  it("T023b: single-active invariant across activate/insertVersion interleavings", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    // v2 inactive (no validator), v3 inactive (validator)
    const v2 = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2", steps_json: NO_VALIDATOR });
    const v3 = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v3", steps_json: WITH_VALIDATOR });
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);

    // Activate old v1 (validator) -> single active.
    f.service.activate(DEFAULT_TEMPLATE_ID);
    expect(f.repo.countActiveByIssueType("coding")).toBe(1);

    // Double-activate different versions.
    f.service.activate(v2.id, true);
    expect(f.repo.countActiveByIssueType("coding")).toBe(1);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(v2.id);
    f.service.activate(v3.id);
    expect(f.repo.countActiveByIssueType("coding")).toBe(1);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(v3.id);

    // activate + insertVersion({activate:true}) interleaved.
    f.service.activate(v2.id, true);
    expect(f.repo.countActiveByIssueType("coding")).toBe(1);
    const v4 = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v4", steps_json: WITH_VALIDATOR, activate: true });
    expect(f.repo.countActiveByIssueType("coding")).toBe(1);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(v4.id);
  });

  it("T023d: activate hard-rejects NULL steps_json; inactive draft may save invalid", () => {
    // Save an invalid draft (allowed).
    const draft = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "bad-draft", steps_json: "not json" });
    expect(draft.status).toBe("inactive");
    expect(draft.validation_enabled).toBeNull();
    // Activating it is rejected.
    try {
      f.service.activate(draft.id);
      throw new Error("expected TEMPLATE_STEPS_INVALID");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    }
    // Activating a NULL-steps version is rejected too.
    const nullDraft = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "null-draft", steps_json: null });
    try {
      f.service.activate(nullDraft.id);
      throw new Error("expected TEMPLATE_STEPS_INVALID");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    }
  });

  it("T023e: source invalid + target valid -> activate requires acknowledge, before=unknown, allowed (escape hatch)", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, "not json"); // corrupt the active default
    // Without acknowledge -> rejected (cannot prove validation wasn't disabled).
    const fix = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "fix", steps_json: WITH_VALIDATOR });
    expect(fix.status).toBe("inactive");
    try {
      f.service.activate(fix.id);
      throw new Error("expected VALIDATION_DISABLE_NOT_ACKNOWLEDGED");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED);
    }
    // With acknowledge -> allowed; audit before=unknown (null).
    f.service.activate(fix.id, true);
    const active = f.repo.getActiveByIssueType("coding")!;
    expect(active.id).toBe(fix.id);
    const audits = f.auditRepo.listByTarget(fix.id).filter((a) => a.action === "template.activated");
    expect(audits).toHaveLength(1);
    const details = JSON.parse(audits[0].details_json);
    expect(details.validation_enabled_before).toBeNull();
    expect(details.validation_enabled_after).toBe(true);
    expect(details.acknowledge_validation_disabled).toBe(true);
  });

  it("T024: getDefault() unchanged by inactive version; changes only after activate", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    expect(f.repo.getDefault()!.id).toBe(DEFAULT_TEMPLATE_ID);
    const v2 = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2", steps_json: WITH_VALIDATOR });
    expect(v2.status).toBe("inactive");
    expect(f.repo.getDefault()!.id).toBe(DEFAULT_TEMPLATE_ID);
    f.service.activate(v2.id);
    expect(f.repo.getDefault()!.id).toBe(v2.id);
    expect(f.repo.getDefault()!.version).toBe(2);
  });
});

describe("F008 Phase 3: destructive-change gate (T030/T030b/T030c/T030d)", () => {
  let f: ServiceFixture;
  beforeEach(() => {
    f = makeService();
  });
  afterEach(() => {
    f.db.close();
  });

  it("T030: activating a version that removed the validator step requires acknowledge -> else 400 + consequence", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const noVal = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "no-val", steps_json: NO_VALIDATOR });
    // Without acknowledge.
    try {
      f.service.activate(noVal.id);
      throw new Error("expected VALIDATION_DISABLE_NOT_ACKNOWLEDGED");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED);
      expect(getErrorStatus((e as AppError).code)).toBe(400);
      expect((e as AppError).message).toContain("disables validation");
    }
    // With acknowledge -> succeeds.
    f.service.activate(noVal.id, true);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(noVal.id);
  });

  it("T030b row1: target invalid/NULL -> unconditional reject TEMPLATE_STEPS_INVALID", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const bad = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "bad", steps_json: "not json" });
    try {
      f.service.activate(bad.id);
      throw new Error("expected reject");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    }
  });

  it("T030b row2: currently active valid + target disables validation -> require acknowledge", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const noVal = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "no-val", steps_json: NO_VALIDATOR });
    try {
      f.service.activate(noVal.id);
      throw new Error("expected acknowledge");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED);
    }
    f.service.activate(noVal.id, true);
    const details = JSON.parse(
      f.auditRepo.listByTarget(noVal.id).filter((a) => a.action === "template.activated")[0].details_json,
    );
    expect(details.validation_enabled_before).toBe(true);
    expect(details.validation_enabled_after).toBe(false);
  });

  it("T030b row3: currently active invalid + target valid -> require acknowledge, before=unknown, allow", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, "not json");
    const fix = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "fix", steps_json: WITH_VALIDATOR });
    try {
      f.service.activate(fix.id);
      throw new Error("expected acknowledge");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED);
    }
    f.service.activate(fix.id, true);
    const details = JSON.parse(
      f.auditRepo.listByTarget(fix.id).filter((a) => a.action === "template.activated")[0].details_json,
    );
    expect(details.validation_enabled_before).toBeNull();
    expect(details.validation_enabled_after).toBe(true);
  });

  it("T030b row4: target valid + keeps validator -> no acknowledge needed", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const keep = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "keep-val", steps_json: WITH_VALIDATOR });
    // No acknowledge required; should succeed directly.
    f.service.activate(keep.id);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(keep.id);
  });

  it("T030b: enabling validation (active no-validator -> target validator) needs no acknowledge", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, NO_VALIDATOR);
    setActiveStatus(f.db, DEFAULT_TEMPLATE_ID, "active");
    const withVal = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "enable-val", steps_json: WITH_VALIDATOR });
    f.service.activate(withVal.id);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(withVal.id);
    const details = JSON.parse(
      f.auditRepo.listByTarget(withVal.id).filter((a) => a.action === "template.activated")[0].details_json,
    );
    expect(details.validation_enabled_before).toBe(false);
    expect(details.validation_enabled_after).toBe(true);
  });

  it("T030c: cloning from inactive no-validator v1 while active v3 has validator STILL requires acknowledge", () => {
    // v1 (default) active with validator.
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    // v2 inactive, no validator (the "old" source to clone from).
    const v2 = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "old-no-val", steps_json: NO_VALIDATOR });
    // v3 active with validator (the current default).
    const v3 = f.service.createVersion(DEFAULT_TEMPLATE_ID, {
      name: "cur-val",
      steps_json: WITH_VALIDATOR,
      activate: true,
    });
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(v3.id);
    // Clone from v2 (no validator) -> v4, activate. The source v2 has no
    // validator, so a source-vs-target comparison would say "no change" and
    // skip the gate. The gate must key off currentlyActive (v3, validator) and
    // STILL require acknowledge.
    const v4 = f.service.createVersion(v2.id, { name: "clone-of-v2", steps_json: NO_VALIDATOR });
    try {
      f.service.activate(v4.id);
      throw new Error("expected acknowledge (currentlyActive has validator)");
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED);
    }
    f.service.activate(v4.id, true);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(v4.id);
  });

  it("T030d: activate re-reads currentlyActive inside txn (audit before reflects in-txn state, not a stale snapshot)", () => {
    // v1 active with validator.
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    // Mutate v1's steps_json to no-validator AFTER service construction but
    // before activate. The gate must see the CURRENT (no-validator) v1, not a
    // cached validator snapshot.
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, NO_VALIDATOR);
    const v2 = f.service.createVersion(DEFAULT_TEMPLATE_ID, {
      name: "v2-val",
      steps_json: WITH_VALIDATOR,
      activate: true,
    });
    // v2 activated; currentlyActive was v1 (now no-validator). before=false.
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(v2.id);
    const details = JSON.parse(
      f.auditRepo.listByTarget(v2.id).filter((a) => a.action === "template.version_created")[0].details_json,
    );
    expect(details.validation_enabled_before).toBe(false);
    expect(details.validation_enabled_after).toBe(true);
  });
});

describe("F008 Phase 3: audit atomicity (T031/T031b)", () => {
  let f: ServiceFixture;
  beforeEach(() => {
    f = makeService();
  });
  afterEach(() => {
    f.db.close();
  });

  it("T031: audit written same txn with action/target/version/acknowledge/before+after; actor_id null", () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const noVal = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "no-val", steps_json: NO_VALIDATOR });
    f.service.activate(noVal.id, true);
    const audits = f.auditRepo.listByTarget(noVal.id);
    const activated = audits.find((a) => a.action === "template.activated")!;
    expect(activated).toBeDefined();
    expect(activated.target_id).toBe(noVal.id);
    expect(activated.target_version).toBe(noVal.version);
    expect(activated.actor_id).toBeNull();
    expect(activated.actor_type).toBe("local_user");
    const details = JSON.parse(activated.details_json);
    expect(details.acknowledge_validation_disabled).toBe(true);
    expect(details.validation_enabled_before).toBe(true);
    expect(details.validation_enabled_after).toBe(false);
  });

  it("T031b: audit insert failure rolls back the template change too", () => {
    class FailingAuditRepo extends AdminAuditEventRepository {
      insert(): void {
        throw new Error("injected audit failure");
      }
    }
    const failing = makeService(f.db, new FailingAuditRepo(f.db));
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const beforeCount = f.repo.listByIssueType("coding").length;
    expect(() =>
      failing.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2", steps_json: WITH_VALIDATOR }),
    ).toThrow("injected audit failure");
    // No new template row, no audit row, original state intact.
    expect(f.repo.listByIssueType("coding").length).toBe(beforeCount);
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(DEFAULT_TEMPLATE_ID);
    // activate rollback too.
    const v2 = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "v2-real", steps_json: WITH_VALIDATOR });
    const activeBefore = f.repo.getActiveByIssueType("coding")!.id;
    expect(() => failing.service.activate(v2.id)).toThrow("injected audit failure");
    expect(f.repo.getActiveByIssueType("coding")!.id).toBe(activeBefore);
  });
});

describe("F008 Phase 3: end-to-end validation disable (T032)", () => {
  let services: TestServices;
  let tempDir: string;
  beforeEach(() => {
    tempDir = createTempDir();
    services = createTestServices();
  });
  afterEach(() => {
    disposeTestServices(services);
  });

  it("T032: after enabling a no-validator template, a new Issue's default template would not trigger validation", () => {
    setStepsJson(services.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    // Activate a no-validator template as the new default.
    const adminRepo = new AdminAuditEventRepository(services.db);
    const admin = new WorkflowTemplateAdminService(services.workflowTemplateRepo, adminRepo, services.db);
    const noVal = admin.createVersion(DEFAULT_TEMPLATE_ID, {
      name: "no-val",
      steps_json: NO_VALIDATOR,
      activate: true,
      acknowledge_validation_disabled: true,
    });
    expect(services.workflowTemplateRepo.getDefault()!.id).toBe(noVal.id);

    const project = services.projectService.create("P");
    services.workspaceService.bind(project.id, tempDir);
    const { issue } = services.issueService.create(project.id, { title: "T", goal: "G" });
    // The new issue points at the no-validator template.
    expect(issue.workflow_template_id).toBe(noVal.id);

    // The validator-selector reports WorkflowConfigurationInvalid (no
    // validation step) - i.e. an implementation Run completing would NOT
    // trigger validation (same source of truth as the runtime).
    const template = services.workflowTemplateRepo.getById(noVal.id)!;
    const result = selectValidator({ workflowTemplate: template, availableValidators: [] });
    expect(result.selected).toBeNull();
    expect(result.reason).toBe(ValidationBlockReason.WorkflowConfigurationInvalid);
  });
});

describe("F008 routes: minimal Fastify app (T010/T020/T023/T030 end-to-end via HTTP)", () => {
  let f: ServiceFixture;
  beforeEach(() => {
    f = makeService();
  });
  afterEach(() => {
    f.db.close();
  });

  it("GET /api/workflow-templates returns the version list", async () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const app = buildRouteApp(f.service);
    const res = await app.inject({ method: "GET", url: "/api/workflow-templates?issue_type=coding" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].validation_enabled).toBe(true);
    await app.close();
  });

  it("GET /api/workflow-templates/:id -> 404 TEMPLATE_NOT_FOUND for unknown id", async () => {
    const app = buildRouteApp(f.service);
    const res = await app.inject({ method: "GET", url: "/api/workflow-templates/wft_missing" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.TEMPLATE_NOT_FOUND);
    await app.close();
  });

  it("POST /:sourceId/versions with activate:true + no acknowledge when validation disabled -> 400", async () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const app = buildRouteApp(f.service);
    const res = await app.inject({
      method: "POST",
      url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
      payload: { name: "v2", steps_json: NO_VALIDATOR, activate: true },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.VALIDATION_DISABLE_NOT_ACKNOWLEDGED);
    await app.close();
  });

  it("POST /:sourceId/versions with activate:true + acknowledge -> 201 + single active", async () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const app = buildRouteApp(f.service);
    const res = await app.inject({
      method: "POST",
      url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/versions`,
      payload: { name: "v2", steps_json: NO_VALIDATOR, activate: true, acknowledge_validation_disabled: true },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.template.status).toBe("active");
    expect(f.repo.countActiveByIssueType("coding")).toBe(1);
    await app.close();
  });

  it("POST /:id/deactivate on last active -> 409 LAST_ACTIVE_TEMPLATE", async () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const app = buildRouteApp(f.service);
    const res = await app.inject({
      method: "POST",
      url: `/api/workflow-templates/${DEFAULT_TEMPLATE_ID}/deactivate`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.LAST_ACTIVE_TEMPLATE);
    await app.close();
  });

  it("POST /:id/activate on invalid steps -> 400 TEMPLATE_STEPS_INVALID", async () => {
    setStepsJson(f.db, DEFAULT_TEMPLATE_ID, WITH_VALIDATOR);
    const draft = f.service.createVersion(DEFAULT_TEMPLATE_ID, { name: "bad", steps_json: "not json" });
    const app = buildRouteApp(f.service);
    const res = await app.inject({ method: "POST", url: `/api/workflow-templates/${draft.id}/activate`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(ErrorCode.TEMPLATE_STEPS_INVALID);
    await app.close();
  });
});
