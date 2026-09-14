import { describe, it, expect } from "vitest";
import type { EvidenceRefKind } from "../../src/evidence-ref.js";
import { listEvidenceRefKinds } from "../../src/evidence-ref.js";
import {
  evidenceKindsWithoutNormalizationOwner,
  mergeRequirements,
  parseRevisionContent,
  SkillSchemaError,
} from "../../src/services/skill-revision-schema.js";

// F013 AC-004 (design §8 evidence-spec)：EvidenceRefKind 是唯一真相源——上游新增
// 成员时本处编译即跟随（下方 exhaustiveness 常量会在缺成员时编译失败）；认领表
// 与上游域无漂移；status_map 闭集 + 完整覆盖；未认领 owner 的 kind 拒绝激活。

/** 编译跟随断言：EvidenceRefKind 增删成员时本行编译失败，强制实现方显式处理。 */
const _EXHAUSTIVENESS: Record<EvidenceRefKind, true> = { event: true, file_change_set: true, artifact: true };

function evidenceSpec(overrides: Partial<Record<string, unknown>> = {}, kind: EvidenceRefKind = "event") {
  return {
    evidence_kind: kind,
    freshness: { scope: "per_attempt" },
    independence_required: true,
    status_map: { satisfied: ["resolved"], failed: ["missing"], not_applicable: ["truncated"] },
    decomposable: false,
    ...overrides,
  };
}

describe("F013 AC-004: EvidenceSpec contract", () => {
  it("tracks which kinds still lack a normalization owner (compile-following)", () => {
    // 认领表 key 必须恰好覆盖 EvidenceRefKind 域（运行时面：与 REF_PREFIX_BY_KIND 派生值比对）。
    // artifact 已在上游域中，但归一化 owner 未认领，因此它是当前唯一的 owner-less kind。
    expect(evidenceKindsWithoutNormalizationOwner()).toEqual(["artifact"]);
    expect(listEvidenceRefKinds().sort()).toEqual(["artifact", "event", "file_change_set"]);
  });

  it("accepts a well-formed completion requirement with evidence", () => {
    const content = parseRevisionContent(
      {
        steps_json: null,
        capability_tags_json: "[]",
        completion_requirements_json: JSON.stringify([
          { id: "tests", kind: "completion", strength: "hard", tags: ["test"], evidence: evidenceSpec() },
        ]),
      },
      { requireCompletionEvidence: true },
    );
    expect(content.completionRequirements).toHaveLength(1);
  });

  it("rejects completion requirements without evidence in strict mode (ADR 0010)", () => {
    expect(() =>
      parseRevisionContent(
        {
          steps_json: null,
          capability_tags_json: "[]",
          completion_requirements_json: JSON.stringify([
            { id: "no-evidence", kind: "completion", strength: "hard", tags: ["t"] },
          ]),
        },
        { requireCompletionEvidence: true },
      ),
    ).toThrow(SkillSchemaError);
  });

  it("tolerates legacy revisions without evidence in permissive mode (migration path)", () => {
    const content = parseRevisionContent(
      {
        steps_json: null,
        capability_tags_json: "[]",
        completion_requirements_json: JSON.stringify([
          { id: "legacy-req", kind: "completion", strength: "soft", tags: [], description: "自由文本" },
        ]),
      },
      { requireCompletionEvidence: false },
    );
    expect(content.completionRequirements[0].evidence).toBeUndefined();
  });

  it("rejects out-of-domain statuses with SKILL_EVIDENCE_STATUS_UNKNOWN (incl. emitted/present/empty)", () => {
    for (const bad of ["emitted", "present", "empty"]) {
      try {
        parseRevisionContent(
          {
            steps_json: null,
            capability_tags_json: "[]",
            completion_requirements_json: JSON.stringify([
              {
                id: "bad",
                kind: "completion",
                strength: "hard",
                tags: ["t"],
                evidence: evidenceSpec({
                  status_map: { satisfied: [bad], failed: ["missing"], not_applicable: ["truncated"] },
                }),
              },
            ]),
          },
          { requireCompletionEvidence: true },
        );
        expect.unreachable(`${bad} must be rejected`);
      } catch (error) {
        expect((error as SkillSchemaError).code).toBe("SKILL_EVIDENCE_STATUS_UNKNOWN");
      }
    }
  });

  it("requires every domain status to be mapped exactly once (SKILL_EVIDENCE_STATUS_UNMAPPED)", () => {
    try {
      parseRevisionContent(
        {
          steps_json: null,
          capability_tags_json: "[]",
          completion_requirements_json: JSON.stringify([
            {
              id: "partial",
              kind: "completion",
              strength: "hard",
              tags: ["t"],
              evidence: evidenceSpec({
                status_map: { satisfied: ["resolved", "missing"], failed: [], not_applicable: [] },
              }),
            },
          ]),
        },
        { requireCompletionEvidence: true },
      );
      expect.unreachable();
    } catch (error) {
      expect((error as SkillSchemaError).code).toBe("SKILL_EVIDENCE_STATUS_UNMAPPED");
    }

    // 同一状态出现在两个键下同样拒绝（互斥）。
    try {
      parseRevisionContent(
        {
          steps_json: null,
          capability_tags_json: "[]",
          completion_requirements_json: JSON.stringify([
            {
              id: "dup",
              kind: "completion",
              strength: "hard",
              tags: ["t"],
              evidence: evidenceSpec({
                status_map: { satisfied: ["resolved"], failed: ["resolved"], not_applicable: ["truncated", "missing"] },
              }),
            },
          ]),
        },
        { requireCompletionEvidence: true },
      );
      expect.unreachable();
    } catch (error) {
      expect((error as SkillSchemaError).code).toBe("SKILL_EVIDENCE_STATUS_UNMAPPED");
    }
  });

  it("rejects owner-less kinds at activation (artifact until its normalization owner lands)", () => {
    // artifact 已在 EvidenceRefKind 中，但归一化 owner 未认领（design §3 启用条件），
    // 因此带它的 requirement 在激活时必须以 SKILL_EVIDENCE_KIND_UNAVAILABLE 拒绝。
    const forged = evidenceSpec({}, "artifact" as EvidenceRefKind);
    try {
      parseRevisionContent(
        {
          steps_json: null,
          capability_tags_json: "[]",
          completion_requirements_json: JSON.stringify([
            { id: "artifact-req", kind: "completion", strength: "hard", tags: ["a"], evidence: forged },
          ]),
        },
        { requireCompletionEvidence: true },
      );
      expect.unreachable();
    } catch (error) {
      expect((error as SkillSchemaError).code).toBe("SKILL_EVIDENCE_KIND_UNAVAILABLE");
    }
  });

  it("merge conflict: same (kind, tags) with different evidence specs is rejected at merge", () => {
    const first = {
      id: "a",
      kind: "completion" as const,
      strength: "hard" as const,
      tags: ["same"],
      evidence: evidenceSpec({}, "event"),
    };
    const second = {
      id: "b",
      kind: "completion" as const,
      strength: "hard" as const,
      tags: ["same"],
      evidence: evidenceSpec({ independence_required: false }, "event"),
    };
    expect(() => mergeRequirements([first, second])).toThrow(SkillSchemaError);
  });
});
