import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { AppError } from "../../src/api/errors.js";
import { ErrorCode } from "@personahub/shared/errors";

// F013 AC-005 (design §8 skill-space-boundary / skill-conflict)：跨 Space 引用
// 拒绝；per-Space 分组冲突与消解；两条物化路径；两层与运算。

function hardEvidenceRequirement(id: string, tags: string[]) {
  return {
    id,
    kind: "completion" as const,
    strength: "hard" as const,
    tags,
    evidence: {
      evidence_kind: "event" as const,
      freshness: { scope: "per_attempt" as const },
      independence_required: true,
      status_map: { satisfied: ["resolved"], failed: ["missing"], not_applicable: ["truncated"] },
      decomposable: false as const,
    },
  };
}

describe("F013 AC-005: skill space boundary & conflict lifecycle", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  function defaultSpaceId(): string {
    return services.spaceService.getSelected()!.id;
  }

  function projectIdIn(spaceId: string): string {
    return services.projectService.create("P", undefined, spaceId).id;
  }

  it("rejects referencing another space's private skill (SKILL_SPACE_MISMATCH, INSERT & UPDATE)", () => {
    const spaceA = services.spaceService.create("A");
    const spaceB = services.spaceService.create("B");
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Private A",
      space_id: spaceA.id,
      draft: { capability_tags: [] },
    });
    const projectB = projectIdIn(spaceB.id);

    expect(() =>
      services.db
        .prepare(
          "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 1, NULL, datetime('now'), datetime('now'))",
        )
        .run(projectB, skill.id),
    ).toThrow(/SKILL_SPACE_MISMATCH/);

    // UPDATE 路径：把合法引用改成跨 Space。
    const projectA = projectIdIn(spaceA.id);
    services.db
      .prepare(
        "INSERT INTO project_skill_refs (project_id, skill_id, is_default, pinned_version, created_at, updated_at) VALUES (?, ?, 0, NULL, datetime('now'), datetime('now'))",
      )
      .run(projectA, skill.id);
    expect(() =>
      services.db.prepare("UPDATE project_skill_refs SET project_id = ? WHERE project_id = ?").run(projectB, projectA),
    ).toThrow(/SKILL_SPACE_MISMATCH/);
  });

  it("global skills are visible in every space including ones created later", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Global skill",
      space_id: null,
      draft: { capability_tags: [] },
    });
    expect(skill.space_id).toBeNull();

    const later = services.spaceService.create("Later space");
    const listed = services.skillRegistry.listForSpace(later.id);
    expect(listed.map((s) => s.id)).toContain(skill.id);
    // 不依赖下次 scan：Space 创建事务内已物化行。
    expect(listed.find((s) => s.id === skill.id)?.space_state).toBe("active");
  });

  it("does not list another space's private skills", () => {
    const spaceA = services.spaceService.create("Private A");
    const spaceB = services.spaceService.create("Private B");
    const privateA = services.skillRegistry.createSkill({
      display_name: "Only A",
      space_id: spaceA.id,
      draft: { capability_tags: [] },
    }).skill;
    expect(services.skillRegistry.listForSpace(spaceB.id).some((skill) => skill.id === privateA.id)).toBe(false);
  });

  it("global disabled skill stays unusable in a new space (two-layer AND)", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Will disable",
      space_id: null,
      draft: { capability_tags: [] },
    });
    services.skillRegistry.disable(skill.id);
    const fresh = services.spaceService.create("Fresh space");

    const row = services.skillRegistry.listForSpace(fresh.id).find((s) => s.id === skill.id);
    // 物化行是 active（未被同名项遮蔽），但全局 state 是 disabled：两层与运算为假。
    expect(row?.space_state).toBe("active");
    expect(row?.state).toBe("disabled");
  });

  it("same-name global + private skill conflict only within that space; other spaces unaffected", () => {
    const spaceA = services.spaceService.create("A");
    const spaceB = services.spaceService.create("B");

    const global = services.skillRegistry.createSkill({
      display_name: "Deploy",
      space_id: null,
      draft: { capability_tags: [] },
    }).skill;
    const privateA = services.skillRegistry.createSkill({
      display_name: "Deploy",
      space_id: spaceA.id,
      draft: { capability_tags: [] },
    }).skill;

    const inA = services.skillRegistry.listForSpace(spaceA.id);
    expect(inA.find((s) => s.id === global.id)?.space_state).toBe("conflict");
    expect(inA.find((s) => s.id === privateA.id)?.space_state).toBe("conflict");

    // Space B 只有 global 一个候选：active。
    const inB = services.skillRegistry.listForSpace(spaceB.id);
    expect(inB.find((s) => s.id === global.id)?.space_state).toBe("active");
  });

  it("resolve-conflict requires space_id; keeps winner active, shadows the rest in that space only", () => {
    const spaceA = services.spaceService.create("A");
    const spaceB = services.spaceService.create("B");
    const global = services.skillRegistry.createSkill({
      display_name: "Release",
      space_id: null,
      draft: { capability_tags: [] },
    }).skill;
    services.skillRegistry.createSkill({
      display_name: "Release",
      space_id: spaceA.id,
      draft: { capability_tags: [] },
    });

    // 服务层：无冲突组的消解被拒（路由层 zod 强制 space_id 必填，见 skills 路由）。
    try {
      services.skillRegistry.resolveConflict(spaceB.id, global.id);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.SKILL_CONFLICT_UNRESOLVED);
    }

    services.skillRegistry.resolveConflict(spaceA.id, global.id);
    const inA = services.skillRegistry.listForSpace(spaceA.id);
    expect(inA.find((s) => s.id === global.id)?.space_state).toBe("active");
    const privateRow = inA.find((s) => s.space_id === spaceA.id && s.display_name === "Release");
    expect(privateRow?.space_state).toBe("shadowed"); // 不是 disabled——那是全局意图

    // 选中 global 只影响它在该 Space 的行：Space B 不受影响。
    expect(services.skillRegistry.listForSpace(spaceB.id).find((s) => s.id === global.id)?.space_state).toBe("active");
  });

  it("auto-recovers a group when the competitor is disabled (no dangling conflict)", () => {
    const space = services.spaceService.create("A");
    const first = services.skillRegistry.createSkill({
      display_name: "Hotfix",
      space_id: null,
      draft: { capability_tags: [] },
    }).skill;
    const second = services.skillRegistry.createSkill({
      display_name: "Hotfix",
      space_id: space.id,
      draft: { capability_tags: [] },
    }).skill;
    expect(services.skillRegistry.listForSpace(space.id).find((s) => s.id === first.id)?.space_state).toBe("conflict");

    services.skillRegistry.disable(second.id);
    services.skillRegistry.scan(); // 扫描或消解动作触发恢复

    const row = services.skillRegistry.listForSpace(space.id).find((s) => s.id === first.id);
    expect(row?.space_state).toBe("active");
  });

  it("re-activation is idempotent (UPSERT) and recomputes state instead of keeping shadowed", () => {
    const spaceA = services.spaceService.create("A");
    const global = services.skillRegistry.createSkill({
      display_name: "Cycle",
      space_id: null,
      draft: { capability_tags: [] },
    }).skill;
    const privateA = services.skillRegistry.createSkill({
      display_name: "Cycle",
      space_id: spaceA.id,
      draft: { capability_tags: [] },
    }).skill;
    services.skillRegistry.resolveConflict(spaceA.id, privateA.id);

    // global 重新激活（正常操作）：按当前分组重算状态——两个 active 同名不同来源
    // 重新构成 conflict，而不是保留上一次的 shadowed。
    services.skillRegistry.activate(global.id, 1);
    expect(services.skillRegistry.listForSpace(spaceA.id).find((s) => s.id === global.id)?.space_state).toBe(
      "conflict",
    );
  });

  it("switching the project default demotes the previous default", () => {
    const space = defaultSpaceId();
    const project = projectIdIn(space);
    const first = services.skillRegistry.createSkill({ display_name: "First", space_id: space, draft: {} }).skill;
    const second = services.skillRegistry.createSkill({ display_name: "Second", space_id: space, draft: {} }).skill;
    const now = new Date().toISOString();
    services.skillRegistry.setDefaultSkillRef(project, first.id, null, now);
    services.skillRegistry.setDefaultSkillRef(project, second.id, null, new Date().toISOString());

    const refs = services.skillRegistry.listProjectSkillRefs(project);
    expect(refs.find((ref) => ref.skill_id === first.id)?.is_default).toBe(false);
    expect(refs.find((ref) => ref.skill_id === second.id)?.is_default).toBe(true);
  });

  it("can add a new revision after activating an older revision", () => {
    const skill = services.skillRegistry.createSkill({ display_name: "Revisions", draft: {} }).skill;
    expect(services.skillRegistry.addRevision(skill.id, {}).version).toBe(2);
    services.skillRegistry.activate(skill.id, 1);
    expect(services.skillRegistry.addRevision(skill.id, {}).version).toBe(3);
  });

  it("project references a global skill across spaces (allowed)", () => {
    const spaceB = services.spaceService.create("B");
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Shared global",
      space_id: null,
      draft: { capability_tags: [] },
    });
    const project = projectIdIn(spaceB.id);
    services.skillRegistry.setDefaultSkillRef(project, skill.id, null, new Date().toISOString());
    const refs = services.skillRegistry.listProjectSkillRefs(project);
    expect(refs).toHaveLength(1);
  });

  it("default skill requirement flows through completion requirements (FR-006 seam)", () => {
    const space = defaultSpaceId();
    const { skill } = services.skillRegistry.createSkill({
      display_name: "With reqs",
      space_id: space,
      draft: {
        completion_requirements: [hardEvidenceRequirement("tests", ["test"])],
      },
    });
    const resolved = services.resolver.resolveEffectiveRequirements(`${skill.id}@1`);
    if ("not_found" in resolved) throw new Error("expected resolution");
    expect(resolved.completion_requirements).toHaveLength(1);
    expect(resolved.completion_requirements[0].tags).toEqual(["test"]);
  });
});
