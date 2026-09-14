// F013 T015: legacy Workflow Template + Validation Policy → Skill revision 的
// 无损映射规则（design.md §3「legacy Workflow + Validation Policy 的合并映射」）。
// 纯函数，无 IO：能映射成 tags 的转结构化 Requirement；纯自由文本转 description
// 且 strength='soft'，不伪造 tags；无法无损映射的字段保留在
// skill_legacy_aliases.raw_payload_json，不猜测语义。

import type { Requirement, Step } from "./skill-revision-schema.js";

export interface LegacyWorkflowRow {
  id: string;
  name: string;
  issue_type: string;
  validation_policy_id: string | null;
  steps_json: string | null;
  handoff_policy_json: string | null;
  evidence_requirements_json: string | null;
}

export interface LegacyValidationPolicyRow {
  id: string;
  name: string;
  issue_type: string;
  pass_conditions_json: string | null;
  fail_conditions_json: string | null;
  evidence_requirements_json: string | null;
}

export interface LegacyRevisionContent {
  steps: Step[] | null;
  capability_tags: string[];
  completion_requirements: Requirement[];
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function kebabOrFallback(raw: string | undefined | null, fallback: string): string {
  if (raw && KEBAB.test(raw)) return raw;
  return fallback;
}

function safeParseJson(raw: string | null): { ok: true; value: unknown } | { ok: false } {
  if (raw === null || raw.trim() === "") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * workflow_templates.steps_json → Step[]。order 按原数组下标；无 id 的步骤生成
 * `legacy-step-<n>`（n 为 1 起的下标）；id 不合 kebab-case 时保留在 title，id 用
 * 兜底值。解析失败返回 null（revision 不标记为编组；原始 JSON 已在 alias 里）。
 */
export function mapWorkflowSteps(stepsJson: string | null): Step[] | null {
  const parsed = safeParseJson(stepsJson);
  if (!parsed.ok) return null;
  const value = parsed.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const rawSteps = (value as Record<string, unknown>).steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;

  return rawSteps.map((entry, index) => {
    const step = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const rawId = typeof step.id === "string" ? step.id : null;
    const role = typeof step.role === "string" ? step.role : null;
    const title = typeof step.title === "string" ? step.title : (role ?? rawId ?? `step-${index + 1}`);
    return {
      id: kebabOrFallback(rawId, `legacy-step-${index + 1}`),
      order: index,
      title,
      requirements: [],
    };
  });
}

/**
 * v0.2 结构化 evidence requirements（schema_version 1）→ 结构化 completion
 * Requirement，strength='hard'（验证要求默认是硬要求）。布尔为 false 的键不产生
 * 要求（"不要求"不是要求）。未知键不猜测语义，不产生 tags。
 */
function mapStructuredEvidenceRequirements(value: unknown, requirementId: string): Requirement[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const tags: string[] = [];
  if (record.require_handoff === true) tags.push("validation:handoff");
  if (record.require_file_trace === true) tags.push("validation:file-trace");
  if (record.require_verification === true) tags.push("validation:verification");
  if (Array.isArray(record.accepted_verification_kinds)) {
    for (const kind of record.accepted_verification_kinds) {
      if (typeof kind === "string" && kind.trim() !== "") tags.push(`validation:verification:${kind.trim()}`);
    }
  }
  if (tags.length === 0) return [];
  return [
    {
      id: requirementId,
      kind: "completion",
      strength: "hard",
      tags,
    },
  ];
}

/**
 * 任意 evidence_requirements_json → Requirement[]。结构化 v1 → hard 结构化；
 * 解析失败 / 自由文本 → 一条 tags 为空的 soft Requirement（description 保留原文，
 * 不伪造 tags）。
 */
export function mapEvidenceRequirements(raw: string | null, requirementId: string): Requirement[] {
  const parsed = safeParseJson(raw);
  if (parsed.ok) {
    const mapped = mapStructuredEvidenceRequirements(parsed.value, requirementId);
    if (mapped.length > 0) return mapped;
    // 结构化但映射不出任何 tags：降级为 soft description，不伪造。
    return [
      {
        id: requirementId,
        kind: "completion",
        strength: "soft",
        tags: [],
        description: typeof parsed.value === "string" ? parsed.value : JSON.stringify(parsed.value),
      },
    ];
  }
  if (raw === null || raw.trim() === "") return [];
  return [
    {
      id: requirementId,
      kind: "completion",
      strength: "soft",
      tags: [],
      description: raw,
    },
  ];
}

/** validation_policies 的判定条件：pass / fail / evidence 三处，各自一条软硬规则。 */
export function mapValidationPolicy(policy: LegacyValidationPolicyRow): Requirement[] {
  const requirements: Requirement[] = [];
  requirements.push(...mapEvidenceRequirements(policy.evidence_requirements_json, "legacy-policy-evidence"));
  // pass / fail conditions 是自由文本形态的判定条件：软要求 + description，不伪造 tags。
  for (const [raw, id] of [
    [policy.pass_conditions_json, "legacy-policy-pass"],
    [policy.fail_conditions_json, "legacy-policy-fail"],
  ] as const) {
    const parsed = safeParseJson(raw);
    if (parsed.ok) {
      const mapped = mapStructuredEvidenceRequirements(parsed.value, id);
      if (mapped.length > 0) {
        requirements.push(...mapped);
        continue;
      }
      if (raw !== null && raw.trim() !== "") {
        requirements.push({
          id,
          kind: "completion",
          strength: "soft",
          tags: [],
          description: typeof parsed.value === "string" ? parsed.value : JSON.stringify(parsed.value),
        });
      }
    } else if (raw !== null && raw.trim() !== "") {
      requirements.push({ id, kind: "completion", strength: "soft", tags: [], description: raw });
    }
  }
  return requirements;
}

function dedupeRequirementsById(requirements: Requirement[]): Requirement[] {
  const byId = new Map<string, Requirement>();
  for (const requirement of requirements) {
    const existing = byId.get(requirement.id);
    if (!existing) {
      byId.set(requirement.id, requirement);
      continue;
    }
    // 同 id：合并 tags 与 description，strength 取 hard（只会加严）。
    const tags = [...new Set([...existing.tags, ...requirement.tags])];
    byId.set(requirement.id, {
      ...existing,
      strength: existing.strength === "hard" || requirement.strength === "hard" ? "hard" : "soft",
      tags,
      description: [existing.description, requirement.description].filter(Boolean).join("\n") || undefined,
    });
  }
  return [...byId.values()];
}

/**
 * 一个 (workflow, policy) 组合的 revision 内容。同一 workflow 配过两个 policy
 * 会产生两个 revision（由 migrations-v12 按 combo 逐个调用）；workflow 自带的
 * evidence requirements 与 policy 的判定条件按 id 去重合并，strength 取 hard。
 */
export function buildLegacyRevisionContent(
  workflow: LegacyWorkflowRow,
  policy: LegacyValidationPolicyRow | null,
): LegacyRevisionContent {
  let requirements: Requirement[] = [];
  requirements.push(...mapEvidenceRequirements(workflow.evidence_requirements_json, "legacy-workflow-evidence"));
  if (policy) {
    requirements.push(...mapValidationPolicy(policy));
  }
  requirements = dedupeRequirementsById(requirements);
  if (requirements.length === 0) requirements = [];

  return {
    steps: mapWorkflowSteps(workflow.steps_json),
    capability_tags: [workflow.issue_type],
    completion_requirements: requirements,
  };
}
