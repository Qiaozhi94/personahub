import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-004 (design §8 effective-requirements)：同一 skill@version ref 在
// Skill 升级、禁用、冲突后解析结果逐字不变（revision 内容不可变）；未知 ref
// 返回 not-found 而非抛异常。

function hardEvidence(id: string, tags: string[], description?: string) {
  return {
    id,
    kind: "completion" as const,
    strength: "hard" as const,
    tags,
    ...(description ? { description } : {}),
    evidence: {
      evidence_kind: "event" as const,
      freshness: { scope: "per_attempt" as const },
      independence_required: true,
      status_map: { satisfied: ["resolved"], failed: ["missing"], not_applicable: ["truncated"] },
      decomposable: false as const,
    },
  };
}

describe("F013 AC-004: versioned effective requirements", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("resolves the union of skill-level and step requirements, deduped and split by kind", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Full",
      draft: {
        steps: [
          {
            id: "step-a",
            order: 0,
            title: "A",
            requirements: [hardEvidence("step-req", ["step", "shared"])],
          },
        ],
        completion_requirements: [
          hardEvidence("skill-req", ["skill"]),
          { id: "cap-req", kind: "capability", strength: "hard", tags: ["typescript"] },
        ],
      },
    });

    const resolved = services.resolver.resolveEffectiveRequirements(`${skill.id}@1`);
    if ("not_found" in resolved) throw new Error("expected resolution");

    expect(resolved.source_revision).toEqual({ skill_id: skill.id, version: 1 });
    expect(resolved.completion_requirements.map((r) => r.id).sort()).toEqual(["skill-req", "step-req"]);
    expect(resolved.capability_requirements.map((r) => r.id)).toEqual(["cap-req"]);
  });

  it("returns not_found (not throw) for unknown refs", () => {
    expect(services.resolver.resolveEffectiveRequirements("skl_missing@1")).toEqual({ not_found: true });
    expect(services.resolver.resolveEffectiveRequirements("garbage")).toEqual({ not_found: true });
    expect(services.resolver.resolveEffectiveRequirements("skl_missing@01")).toEqual({ not_found: true });
    expect(services.resolver.resolveEffectiveRequirements("skl_missing@1e2")).toEqual({ not_found: true });
    expect(services.resolver.resolveEffectiveRequirements("skl_missing@9007199254740992")).toEqual({ not_found: true });
  });

  it("upgrade / disable / conflict do not change the old ref's resolution (NFR-001)", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Immutable",
      draft: { completion_requirements: [hardEvidence("v1-req", ["v1"])] },
    });
    const before = JSON.stringify(services.resolver.resolveEffectiveRequirements(`${skill.id}@1`));

    // 升级：追加 v2 并推进 current_revision。
    services.skillRegistry.addRevision(skill.id, {
      completion_requirements: [hardEvidence("v2-req", ["v2"])],
    });
    // 禁用：只改全局意图。
    services.skillRegistry.disable(skill.id);
    // 冲突：与另一个同名 skill 互相置 conflict（per-Space 生效结果变化）。
    services.skillRegistry.createSkill({ display_name: "Immutable", draft: {} });

    const after = JSON.stringify(services.resolver.resolveEffectiveRequirements(`${skill.id}@1`));
    expect(after).toBe(before); // 逐字不变
  });

  it("pinned default refs resolve to their pinned revision, not current", () => {
    const space = services.spaceService.getSelected()!.id;
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Pinned",
      space_id: space,
      draft: { completion_requirements: [hardEvidence("p1", ["p1"])] },
    });
    services.skillRegistry.addRevision(skill.id, {
      completion_requirements: [hardEvidence("p2", ["p2"])],
    });

    const v1 = services.resolver.resolveEffectiveRequirements(`${skill.id}@1`);
    if ("not_found" in v1) throw new Error("expected resolution");
    expect(v1.completion_requirements[0].tags).toEqual(["p1"]);
  });
});
