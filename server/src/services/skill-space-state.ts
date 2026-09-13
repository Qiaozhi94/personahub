// F013 T013: skill_space_state 的分组与物化规则（design.md §3 冲突消解闭环）。
// 物化只看分组结果，不代表可用：全局 disabled 的 Skill 同样会得到一行 active——
// 那是"它在这个 Space 里没被同名项遮蔽"，不是"它能用"；可用性由读取端
// skills.state='active' AND skill_space_state.state='active' 两层与运算判定。

import type Database from "better-sqlite3";

export interface SkillGroupCandidate {
  id: string;
  display_name: string;
  source_identity: string;
  state: string;
}

export type SpaceEffectiveState = "active" | "shadowed" | "conflict";

/**
 * 对 Space S 的候选集按 lower(display_name) 分组：同组出现多个不同
 * source_identity 且 skills.state='active' 的成员 → 组内成员在该 Space 置
 * conflict；其余 active。候选集由调用方给定（Space 创建 = 全局 Skill；
 * Skill 激活 = global 为所有 Space / private 为自己 Space）。
 */
export function computeGroupStates(candidates: SkillGroupCandidate[]): Map<string, SpaceEffectiveState> {
  const byName = new Map<string, SkillGroupCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.display_name.toLowerCase();
    const group = byName.get(key);
    if (group) group.push(candidate);
    else byName.set(key, [candidate]);
  }

  const result = new Map<string, SpaceEffectiveState>();
  for (const group of byName.values()) {
    const activeMembers = group.filter((candidate) => candidate.state === "active");
    const conflicts =
      activeMembers.length > 1 &&
      new Set(activeMembers.map((candidate) => candidate.source_identity)).size > 1;
    for (const candidate of group) {
      result.set(candidate.id, conflicts && candidate.state === "active" ? "conflict" : "active");
    }
  }
  return result;
}

/**
 * 物化一律 UPSERT：重复激活同一 Skill 是正常操作，直接 INSERT 会撞主键；
 * UPSERT 同时保证"重新激活会按当前分组重算状态"，而不是保留上一次的 shadowed。
 */
export function upsertSpaceStates(
  db: Database.Database,
  entries: Array<{ skillId: string; spaceId: string; state: SpaceEffectiveState }>,
  updatedAt: string,
): void {
  const stmt = db.prepare(
    `INSERT INTO skill_space_state (skill_id, space_id, state, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (skill_id, space_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  );
  for (const entry of entries) {
    stmt.run(entry.skillId, entry.spaceId, entry.state, updatedAt);
  }
}

/** 候选集查询：对 Space S，候选 = space_id = S ∪ space_id IS NULL。 */
export function listCandidatesForSpace(db: Database.Database, spaceId: string): SkillGroupCandidate[] {
  return db
    .prepare(
      `SELECT id, display_name, source_identity, state FROM skills
       WHERE space_id = ? OR space_id IS NULL`,
    )
    .all(spaceId) as SkillGroupCandidate[];
}

/** 全局 Skill（space_id IS NULL）在每个现存 Space 各需一行。 */
export function listAllSpaceIds(db: Database.Database): string[] {
  return (db.prepare("SELECT id FROM spaces").all() as Array<{ id: string }>).map((row) => row.id);
}
