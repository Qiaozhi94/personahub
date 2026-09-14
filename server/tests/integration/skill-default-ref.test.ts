import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-003 (design §8 skill-default-ref)：不变量 A 的完备性证明。
// review tracked F013-R1-003 的关闭判据：对 project_skill_refs 与 skills 覆盖
// INSERT / UPDATE（逐列，含只改 skill_id）/ INSERT OR REPLACE / UPSERT 四类
// 写入路径，断言任何路径结束后每条引用都解析到 published_at IS NOT NULL 的
// revision。已知反例全部必须被拒；具体用几个 trigger 由 schema 决定，判据是
// 本测试全绿。

describe("F013 T011: invariant A — every default ref resolves to a published revision", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  function createSkillWithPublishedRevision(id: string, version = 1): void {
    // 写入时序（不变量 A）必须在事务内：autocommit 下 deferred FK 在语句末即检查。
    services.db.transaction(() => {
      const now = new Date().toISOString();
      services.db
        .prepare(
          `INSERT INTO skill_revisions (skill_id, version, title, capability_tags_json, steps_json, completion_requirements_json, content_hash, published_at, created_at)
           VALUES (?, ?, 'T', '[]', NULL, NULL, 'hash', ?, ?)`,
        )
        .run(id, version, now, now);
      services.db
        .prepare(
          `INSERT INTO skills (id, space_id, display_name, source_kind, source_identity, current_revision, state, created_at, updated_at)
           VALUES (?, NULL, ?, 'user', ?, ?, 'active', ?, ?)`,
        )
        .run(id, `Skill ${id}`, `user:${id}`, version, now, now);
    })();
  }

  function createDraftRevision(id: string, version: number): void {
    services.db.transaction(() => {
      const now = new Date().toISOString();
      services.db
        .prepare(
          `INSERT INTO skill_revisions (skill_id, version, title, capability_tags_json, content_hash, published_at, created_at)
           VALUES (?, ?, 'T', '[]', 'hash', NULL, ?)`,
        )
        .run(id, version, now);
    })();
  }

  const refCount = (): number =>
    (services.db.prepare("SELECT COUNT(*) AS n FROM project_skill_refs").get() as { n: number }).n;

  function projectId(): string {
    return services.projectService.create("InvA").id;
  }

  it("accepts a healthy default ref (skill + pinned + current all published)", () => {
    createSkillWithPublishedRevision("skl_ok");
    const project = projectId();
    services.db
      .prepare(
        "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, NULL, datetime('now'), datetime('now'))",
      )
      .run(project, "skl_ok");
    expect(refCount()).toBe(1);
  });

  it("rejects ghost skill + NULL pinned (INSERT path)", () => {
    const project = projectId();
    expect(() =>
      services.db
        .prepare(
          "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, 'skl_ghost', 1, NULL, datetime('now'), datetime('now'))",
        )
        .run(project),
    ).toThrow(/SKILL_REF_UNRESOLVABLE|FOREIGN KEY/);
    expect(refCount()).toBe(0);
  });

  it("rejects pinning to a draft revision (INSERT path)", () => {
    createSkillWithPublishedRevision("skl_pub");
    createDraftRevision("skl_pub", 2);
    const project = projectId();
    expect(() =>
      services.db
        .prepare(
          "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, 2, datetime('now'), datetime('now'))",
        )
        .run(project, "skl_pub"),
    ).toThrow(/SKILL_REF_UNRESOLVABLE/);
  });

  it("rejects current_revision pointing at a draft (skills INSERT path)", () => {
    expect(() =>
      services.db.transaction(() => {
        const now = new Date().toISOString();
        services.db
          .prepare(
            `INSERT INTO skill_revisions (skill_id, version, title, capability_tags_json, content_hash, published_at, created_at)
             VALUES ('skl_draft_cur', 1, 'T', '[]', 'hash', NULL, ?)`,
          )
          .run(now);
        services.db
          .prepare(
            `INSERT INTO skills (id, space_id, display_name, source_kind, source_identity, current_revision, state, created_at, updated_at)
             VALUES ('skl_draft_cur', NULL, 'D', 'user', 'u', 1, 'active', ?, ?)`,
          )
          .run(now, now);
      })(),
    ).toThrow(/SKILL_CURRENT_REVISION_NOT_PUBLISHED/);
  });

  it("rejects moving current_revision to a draft (skills UPDATE path)", () => {
    createSkillWithPublishedRevision("skl_mv");
    createDraftRevision("skl_mv", 2);
    expect(() =>
      services.db.prepare("UPDATE skills SET current_revision = 2 WHERE id = 'skl_mv'").run(),
    ).toThrow(/SKILL_CURRENT_REVISION_NOT_PUBLISHED/);
  });

  it("rejects UPDATE that re-points a ref to a ghost skill (only skill_id changed)", () => {
    createSkillWithPublishedRevision("skl_a");
    const project = projectId();
    services.db
      .prepare(
        "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, NULL, datetime('now'), datetime('now'))",
      )
      .run(project, "skl_a");

    // 已知反例 ②：BEFORE UPDATE OF pinned_version 挡不住只改 skill_id 的写法。
    expect(() =>
      services.db.prepare("UPDATE project_skill_refs SET skill_id = 'skl_missing' WHERE project_id = ?").run(project),
    ).toThrow(/SKILL_REF_UNRESOLVABLE|FOREIGN KEY/);
  });

  it("rejects INSERT OR REPLACE that would land on an unpublished revision", () => {
    createSkillWithPublishedRevision("skl_r1");
    createSkillWithPublishedRevision("skl_r2");
    createDraftRevision("skl_r2", 2);
    const project = projectId();

    // REPLACE 全列重写：目标 skill 的 current 解析必须仍然成立，否则拒绝。
    expect(() =>
      services.db
        .prepare(
          "INSERT OR REPLACE INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, 2, datetime('now'), datetime('now'))",
        )
        .run(project, "skl_r2"),
    ).toThrow(/SKILL_REF_UNRESOLVABLE|FOREIGN KEY/);
    expect(refCount()).toBe(0);
  });

  it("rejects UPSERT DO UPDATE that re-points to an unresolvable skill", () => {
    createSkillWithPublishedRevision("skl_up1");
    const project = projectId();
    services.db
      .prepare(
        "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, NULL, datetime('now'), datetime('now'))",
      )
      .run(project, "skl_up1");

    expect(() =>
      services.db
        .prepare(
          `INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at)
           VALUES (?, 'skl_missing', 0, NULL, datetime('now'), datetime('now'))
           ON CONFLICT (project_id, skill_id) DO UPDATE SET skill_id = 'skl_missing'`,
        )
        .run(project),
    ).toThrow(/SKILL_REF_UNRESOLVABLE|FOREIGN KEY/);
  });

  it("rejects deleting a revision referenced by skills.current_revision or a pinned ref", () => {
    createSkillWithPublishedRevision("skl_del");
    createSkillWithPublishedRevision("skl_del2", 2);
    const project = projectId();
    services.db
      .prepare(
        "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, 'skl_del2', 1, 2, datetime('now'), datetime('now'))",
      )
      .run(project);

    expect(() => services.db.prepare("DELETE FROM skill_revisions WHERE skill_id = 'skl_del' AND version = 1").run()).toThrow(
      /SKILL_REVISION_FROZEN/,
    );
    expect(() => services.db.prepare("DELETE FROM skill_revisions WHERE skill_id = 'skl_del2' AND version = 2").run()).toThrow(
      /SKILL_REVISION_FROZEN/,
    );
  });

  it("disabled skill keeps a resolvable published default ref (positive case)", () => {
    createSkillWithPublishedRevision("skl_dis");
    const project = projectId();
    services.db
      .prepare(
        "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, NULL, datetime('now'), datetime('now'))",
      )
      .run(project, "skl_dis");
    services.db.prepare("UPDATE skills SET state = 'disabled' WHERE id = 'skl_dis'").run();

    // disabled 只改 state、不清指针：默认 ref 仍解析到真实且已发布的 revision。
    const resolved = services.db
      .prepare(
        `SELECT r.version FROM project_skill_refs p
         JOIN skills s ON s.id = p.skill_id
         JOIN skill_revisions r ON r.skill_id = s.id AND r.version = COALESCE(p.pinned_version, s.current_revision)
         WHERE p.project_id = ? AND r.published_at IS NOT NULL`,
      )
      .get(project) as { version: number } | undefined;
    expect(resolved?.version).toBe(1);
  });
});
