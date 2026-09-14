import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";

// F013 AC-003 (design §8 skill-revision-schema)：schema 拒绝规则与合并规则。
// 未知字段 fail-closed；sys- 保留前缀 / 重复 id / 不连续 order 拒绝；发布后
// 内容列 UPDATE 被 trigger 拦截；同 tags 的 hard/soft 合并取 hard；同一 ref
// 两次解析输出逐字节相同。

function validEvidence() {
  return {
    evidence_kind: "event",
    freshness: { scope: "per_attempt" },
    independence_required: true,
    status_map: { satisfied: ["resolved"], failed: ["missing"], not_applicable: ["truncated"] },
    decomposable: false,
  };
}

describe("F013 AC-003: revision schema & merge rules", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("creates a grouped skill (steps present ⇒ 编组) through the registry", () => {
    const { skill, version } = services.skillRegistry.createSkill({
      display_name: "API Migration",
      draft: {
        capability_tags: ["typescript"],
        steps: [
          { id: "implement", order: 0, title: "Implement", requirements: [] },
          { id: "verify", order: 1, title: "Verify", requirements: [] },
        ],
        completion_requirements: [
          {
            id: "tests-pass",
            kind: "completion",
            strength: "hard",
            tags: ["test"],
            evidence: validEvidence(),
          },
        ],
      },
    });
    expect(version).toBe(1);
    const detail = services.skillRegistry.getRevision(skill.id, 1);
    expect(detail.revision.has_steps).toBe(true);
    expect(detail.revision.step_count).toBe(2);
  });

  it("rejects unknown fields (SKILL_SCHEMA_UNKNOWN_FIELD), reserved sys- prefix and duplicate ids", () => {
    const expectReject = (code: string, draft: Parameters<typeof services.skillRegistry.createSkill>[0]["draft"]) => {
      try {
        services.skillRegistry.createSkill({ display_name: "X", draft });
        expect.unreachable();
      } catch (error) {
        const details = (error as { details?: { code?: string } }).details;
        const haystack = `${(error as Error).message} ${details?.code ?? ""}`;
        expect(haystack).toContain(code);
      }
    };

    expectReject("SKILL_SCHEMA_UNKNOWN_FIELD", {
      steps: [{ id: "a", order: 0, title: "A", requirements: [], sneaky: true }],
    });
    expectReject("sys-", {
      completion_requirements: [
        { id: "sys-forbidden", kind: "completion", strength: "hard", tags: ["t"], evidence: validEvidence() },
      ],
    });
    expectReject("Duplicate requirement id", {
      completion_requirements: [
        { id: "dup", kind: "completion", strength: "hard", tags: ["t"], evidence: validEvidence() },
        { id: "dup", kind: "completion", strength: "soft", tags: ["u"], evidence: validEvidence() },
      ],
    });
    expectReject("contiguous", {
      steps: [
        { id: "a", order: 0, title: "A", requirements: [] },
        { id: "b", order: 2, title: "B", requirements: [] },
      ],
    });
  });

  it("freezes published revisions: content UPDATE is rejected by trigger", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Frozen",
      draft: { capability_tags: [] },
    });
    expect(() =>
      services.db
        .prepare("UPDATE skill_revisions SET title = 'rewritten' WHERE skill_id = ? AND version = 1")
        .run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
    expect(() =>
      services.db.prepare("UPDATE skill_revisions SET published_at = NULL WHERE skill_id = ? AND version = 1").run(skill.id),
    ).toThrow(/SKILL_REVISION_FROZEN/);
  });

  it("merges same-tags hard/soft requirements taking hard (byte-stable output)", async () => {
    const { mergeRequirements } = await import("../../src/services/skill-revision-schema.js");
    const evidence = validEvidence();
    const merged = mergeRequirements([
      { id: "b-soft", kind: "completion", strength: "soft", tags: ["lint"], description: "soft desc" },
      { id: "a-hard", kind: "completion", strength: "hard", tags: ["lint"], evidence },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].strength).toBe("hard");
    expect(merged[0].id).toBe("a-hard"); // 参与合并中字典序最小
    expect(merged[0].description).toContain("soft desc");

    const first = JSON.stringify(mergeRequirements([...merged]));
    const second = JSON.stringify(mergeRequirements([...merged].reverse()));
    expect(first).toBe(second);
  });

  it("getRevision output is byte-identical across calls for the same ref", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Stable",
      draft: {
        steps: [{ id: "only", order: 0, title: "Only", requirements: [] }],
        completion_requirements: [
          { id: "req-a", kind: "completion", strength: "hard", tags: ["z", "a"], evidence: validEvidence() },
        ],
      },
    });
    const first = JSON.stringify(services.skillRegistry.getRevision(skill.id, 1));
    const second = JSON.stringify(services.skillRegistry.getRevision(skill.id, 1));
    expect(first).toBe(second);
  });
});

describe("F013 R1-012: revision description persistence", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("persists draft.description and feeds it into the content hash", () => {
    const first = services.skillRegistry.createSkill({
      display_name: "Described",
      draft: { description: "Release: production", capability_tags: [] },
    });
    const second = services.skillRegistry.createSkill({
      display_name: "Described",
      draft: { description: "Release: staging", capability_tags: [] },
    });
    const readHash = (skillId: string): { description: string | null; content_hash: string } =>
      services.db
        .prepare("SELECT description, content_hash FROM skill_revisions WHERE skill_id = ? AND version = 1")
        .get(skillId) as { description: string | null; content_hash: string };

    const firstRow = readHash(first.skill.id);
    const secondRow = readHash(second.skill.id);
    expect(firstRow.description).toBe("Release: production");
    expect(secondRow.description).toBe("Release: staging");
    expect(firstRow.content_hash).not.toBe(secondRow.content_hash);
  });
});
