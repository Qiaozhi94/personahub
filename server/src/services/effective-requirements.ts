// F013 T016: EffectiveRequirementsResolver——F012 唯一可见的只读契约之一
// （design.md §4）。按 Skill revision ref 计算能力要求与完成要求的并集：
// 纯读；未知 ref 返回显式 not-found 而非抛异常；同一 ref 的两次解析输出
// 逐字节相同（AC-004）。

import type Database from "better-sqlite3";
import { mergeRequirements, parseRevisionContent, type Requirement } from "./skill-revision-schema.js";

export type SkillRef = `${string}@${number}`;

export interface EffectiveRequirements {
  capability_requirements: Requirement[];
  completion_requirements: Requirement[];
  source_revision: { skill_id: string; version: number };
}

export type EffectiveRequirementsResult = EffectiveRequirements | { not_found: true };

export function parseSkillRef(ref: string): { skill_id: string; version: number } | null {
  const atIndex = ref.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === ref.length - 1) return null;
  const skillId = ref.slice(0, atIndex);
  const version = Number(ref.slice(atIndex + 1));
  if (!Number.isInteger(version) || version <= 0) return null;
  return { skill_id: skillId, version };
}

export class EffectiveRequirementsResolver {
  constructor(private db: Database.Database) {}

  /**
   * @param ref 形如 "<skill_id>@<version>"。注意：本方法只回答该 revision 的
   * 内容；Skill 的可用性（skills.state AND skill_space_state 两层与运算）由
   * F012 的 eligibility 在本契约之外另行消费。
   */
  resolveEffectiveRequirements(ref: string): EffectiveRequirementsResult {
    const parsed = parseSkillRef(ref);
    if (!parsed) return { not_found: true };

    const row = this.db
      .prepare(
        "SELECT * FROM skill_revisions WHERE skill_id = ? AND version = ? AND published_at IS NOT NULL",
      )
      .get(parsed.skill_id, parsed.version) as
      | { steps_json: string | null; capability_tags_json: string; completion_requirements_json: string | null }
      | undefined;
    if (!row) return { not_found: true };

    // legacy revision 无法补造 adapter 契约，宽松解析；新 API 的 revision 在
    // 激活期已通过严格校验。
    const content = parseRevisionContent(
      {
        steps_json: row.steps_json,
        capability_tags_json: row.capability_tags_json,
        completion_requirements_json: row.completion_requirements_json,
      },
      { requireCompletionEvidence: false },
    );

    const all = [
      ...(content.steps ?? []).flatMap((step) => step.requirements),
      ...content.completionRequirements,
    ];
    const merged = mergeRequirements(all);

    return {
      capability_requirements: merged.filter((requirement) => requirement.kind === "capability"),
      completion_requirements: merged.filter((requirement) => requirement.kind === "completion"),
      source_revision: { skill_id: parsed.skill_id, version: parsed.version },
    };
  }
}
