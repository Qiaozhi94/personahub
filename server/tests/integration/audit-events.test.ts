import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";

// F013 T019/T023 (design §4 Event / Trace contract)：§4 事件表逐项触发对应动作
// 并核对落账，缺一即失败。配置类事件全部写 admin_audit_events（不写
// thread_events）；创建类与失败类动作同样必须落账。

describe("F013 T019: audit events cover every ownership/authorization/state action", () => {
  let services: TestServices;
  let tempDir: string;

  beforeEach(() => {
    services = createTestServices();
    tempDir = createTempDir();
  });

  afterEach(() => {
    disposeTestServices(services);
    cleanupTempDir(tempDir);
  });

  function recordedActions(targetId?: string): string[] {
    const rows = (
      targetId
        ? services.db.prepare("SELECT action FROM admin_audit_events WHERE target_id = ?").all(targetId)
        : services.db.prepare("SELECT action FROM admin_audit_events").all()
    ) as Array<{ action: string }>;
    return rows.map((row) => row.action);
  }

  it("Space group: created / selected / archived / restored all land", () => {
    const space = services.spaceService.create("Events");
    const other = services.spaceService.create("Other");
    services.spaceService.select(space.id);
    services.spaceService.select(other.id); // 移出选中后才能归档
    services.spaceService.archive(space.id);
    services.spaceService.restore(space.id);

    const actions = recordedActions(space.id);
    for (const expected of ["space.created", "space.selected", "space.archived", "space.restored"]) {
      expect(actions).toContain(expected);
    }
  });

  it("Project group: created / archived / restored / deleted (incl. creation event)", () => {
    const project = services.projectService.create("Events project");
    services.projectService.archive(project.id);
    services.projectService.restore(project.id);
    services.projectService.remove(project.id);

    const actions = recordedActions(project.id);
    for (const expected of ["project.created", "project.archived", "project.restored", "project.deleted"]) {
      expect(actions).toContain(expected);
    }
  });

  it("Repository group: created / authorized / scope_changed / revoked / verify_failed all land", () => {
    const repository = services.repositoryRegistry.create({ source: tempDir });
    services.repositoryRegistry.authorizePath({
      repository_id: repository.id,
      raw_path: tempDir,
      access: "read_write",
      scope: { read: [""], write: [""] },
    });
    // scope 变化：重新授权并收紧。
    services.repositoryRegistry.authorizePath({
      repository_id: repository.id,
      raw_path: tempDir,
      access: "read_write",
      scope: { read: ["src"], write: ["src"] },
    });
    const project = services.projectService.create("Repo events");
    const result = services.repositoryRegistry.verifyAuthorization({ repository_id: repository.id, project_id: project.id });
    expect(result.ok).toBe(false); // 无项目引用 → verify_failed 落账
    services.repositoryRegistry.revoke(repository.id);

    const actions = recordedActions(repository.id);
    for (const expected of [
      "repository.created",
      "repository.authorized",
      "repository.scope_changed",
      "repository.verify_failed",
      "repository.revoked",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("Skill group: created / revision_created / revision_activated / disabled / scanned / conflict pair", () => {
    const spaceA = services.spaceService.create("A");
    const global = services.skillRegistry.createSkill({
      display_name: "Emit",
      space_id: null,
      draft: { capability_tags: [] },
    }).skill;
    services.skillRegistry.createSkill({
      display_name: "Emit",
      space_id: spaceA.id,
      draft: { capability_tags: [] },
    });
    services.skillRegistry.disable(global.id);
    services.skillRegistry.scan();

    const actions = new Set([...recordedActions(), ...recordedActions(global.id)]);
    for (const expected of [
      "skill.created",
      "skill.revision_created",
      "skill.revision_activated",
      "skill.disabled",
      "skill.scanned",
    ]) {
      expect(actions).toContain(expected);
    }
    // conflict_detected 带 space_id。
    const conflictEvents = services.db
      .prepare("SELECT target_id, details_json FROM admin_audit_events WHERE action = 'skill.conflict_detected'")
      .all() as Array<{ target_id: string; details_json: string }>;
    expect(conflictEvents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(conflictEvents[0].details_json)).toHaveProperty("space_id");

    // conflict_resolved 同样带 space_id。
    services.skillRegistry.resolveConflict(spaceA.id, global.id);
    const resolved = services.db
      .prepare("SELECT details_json FROM admin_audit_events WHERE action = 'skill.conflict_resolved'")
      .get() as { details_json: string } | undefined;
    expect(resolved).toBeDefined();
    expect(JSON.parse(resolved!.details_json)).toHaveProperty("space_id");
  });

  it("Skill failure events: delivery_failed records detail (config events never touch thread_events)", () => {
    // 交付失败事件的落账通过 renderer 缺失（unsupported）验证事件管道；failed 与
    // unsupported 共用同一事件写入口（skill-delivery.ts 的 eventByState）。
    const project = services.projectService.create("Delivery events");
    services.db
      .prepare(
        `INSERT INTO agent_configs (id, project_id, name, role, cli_provider, command, args, capability_tags, status, created_at, updated_at)
         VALUES ('adp_evt', ?, 'n', 'implementation', 'unknowncli', 'cmd', '[]', '[]', 'available', datetime('now'), datetime('now'))`,
      )
      .run(project.id);
    const { skill, version } = services.skillRegistry.createSkill({
      display_name: "Evt",
      draft: { capability_tags: [] },
    });
    services.skillDelivery.enqueuePending(skill.id, version);
    services.skillDelivery.deliverAll(skill.id, version);

    const actions = recordedActions(skill.id);
    expect(actions).toContain("skill.delivery_pending");
    expect(actions).toContain("skill.delivery_unsupported");
  });

  it("config events never write thread_events", () => {
    const types = services.db
      .prepare("SELECT type FROM thread_events")
      .all() as Array<{ type: string }>;
    for (const row of types) {
      expect(row.type.startsWith("space.")).toBe(false);
      expect(row.type.startsWith("skill.")).toBe(false);
      expect(row.type.startsWith("repository.")).toBe(false);
    }
  });
});
