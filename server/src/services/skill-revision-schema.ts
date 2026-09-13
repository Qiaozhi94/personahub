// F013 T010: canonical revision schema——steps 与 completion requirements 的
// 形状是 F012 的消费契约（design.md §3「canonical revision schema」）。
//
// Evidence 契约只认 `EvidenceRefKind`（server/src/evidence-ref.ts）唯一真相源：
// 本文件不枚举 kind 取值域，`EVIDENCE_NORMALIZATION_OWNER` 以 Record<K, …> 的
// 形式编译跟随——上游新增成员时这里编译失败，实现方必须显式认领归一化 owner
// 或显式留空（未认领的 kind 激活时报 SKILL_EVIDENCE_KIND_UNAVAILABLE）。
// 任何在这里或别处快照第二份 kind 清单都是契约违反（review tracked F013-R1-006）。

import type { EvidenceRefKind } from "../evidence-ref.js";
import { listEvidenceRefKinds } from "../evidence-ref.js";

export class SkillSchemaError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SKILL_SCHEMA_UNKNOWN_FIELD"
      | "SKILL_SCHEMA_INVALID"
      | "SKILL_EVIDENCE_STATUS_UNKNOWN"
      | "SKILL_EVIDENCE_STATUS_UNMAPPED"
      | "SKILL_EVIDENCE_KIND_UNAVAILABLE"
      | "SKILL_EVIDENCE_CONFLICT",
  ) {
    super(message);
    this.name = "SkillSchemaError";
  }
}

/** ADR 0010：完成要求必须提供 Evidence Adapter 契约。 */
export interface EvidenceSpec {
  /** 上游类型，不由本文件枚举（见文件头注释）。 */
  evidence_kind: EvidenceRefKind;
  freshness: { scope: "per_attempt" | "per_dispatch" | "persistent" };
  /** true 时同源验证不计入（v0.3 不变量 6）。 */
  independence_required: boolean;
  status_map: StatusMap;
  /** v0.3 不支持要求再分解。 */
  decomposable: false;
}

/** 领域状态是闭集枚举，不是自由字符串。 */
export type EvidenceDomainStatus = "satisfied" | "failed" | "not_applicable";

/**
 * 取值域固定为既有 EvidenceResolution.status（resolved / missing / truncated，
 * shared/src/types/trace.ts）——不另造一套无生产者的状态名。
 */
export type StatusMap = {
  satisfied: string[];
  failed: string[];
  not_applicable: string[];
};

export interface Requirement {
  /** revision 内唯一，kebab-case，保留前缀 "sys-" 不可用。 */
  id: string;
  kind: "capability" | "completion";
  /** hard 不满足即 ineligible；soft 只降权、不阻断。 */
  strength: "hard" | "soft";
  /** 结构化标签，不接受自由文本（ADR 0012：确定性规则引擎无法消费自由文本）。 */
  tags: string[];
  /** 给人读，不参与匹配。 */
  description?: string;
  /** kind="completion" 时必填。 */
  evidence?: EvidenceSpec;
}

export type Step = {
  id: string;
  order: number;
  title: string;
  requirements: Requirement[];
};

/**
 * 「Artifact 读取态 → EvidenceResolution.status」归一化 owner 的认领表。
 * key 必须覆盖 EvidenceRefKind 全域（编译跟随）；value 为 null 表示该 kind
 * 尚未有人认领归一化契约，带它的 completion 要求在激活时被拒绝。
 * `artifact` 由 F010 / F014 认领——在 owner 落地前这里是 null。
 */
const EVIDENCE_NORMALIZATION_OWNER: Record<EvidenceRefKind, string | null> = {
  event: "F004 EvidenceService.resolve（EvidenceResolution.status）",
  file_change_set: "F004 EvidenceService.resolve（EvidenceResolution.status）",
};

/** @internal 供测试核对认领表与上游域无漂移（编译跟随的运行时断言面）。 */
export function evidenceKindsWithoutNormalizationOwner(): EvidenceRefKind[] {
  return listEvidenceRefKinds().filter((kind) => EVIDENCE_NORMALIZATION_OWNER[kind] === null);
}

const REQUIREMENT_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EVIDENCE_SPEC_KEYS = new Set(["evidence_kind", "freshness", "independence_required", "status_map", "decomposable"]);
const REQUIREMENT_KEYS = new Set(["id", "kind", "strength", "tags", "description", "evidence"]);
const STEP_KEYS = new Set(["id", "order", "title", "requirements"]);
const STATUS_VALUES = new Set(["resolved", "missing", "truncated"]);
const DOMAIN_KEYS = ["satisfied", "failed", "not_applicable"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 未知字段 fail-closed：schema 外的键一律拒绝激活，不静默丢弃。 */
function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new SkillSchemaError(`Unknown field "${key}" in ${where}`, "SKILL_SCHEMA_UNKNOWN_FIELD");
    }
  }
}

function parseStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string" || tag.trim() === "")) {
    throw new SkillSchemaError(`${where} must be a non-empty string array`, "SKILL_SCHEMA_INVALID");
  }
  return value as string[];
}

function parseStatusMap(value: unknown): StatusMap {
  if (!isPlainObject(value)) {
    throw new SkillSchemaError("status_map must be an object", "SKILL_SCHEMA_INVALID");
  }
  rejectUnknownKeys(value, new Set<string>(DOMAIN_KEYS), "status_map");

  const seen = new Map<string, string>();
  const result: StatusMap = { satisfied: [], failed: [], not_applicable: [] };
  for (const key of DOMAIN_KEYS) {
    const statuses = parseStringArray(value[key], `status_map.${key}`);
    for (const status of statuses) {
      if (!STATUS_VALUES.has(status)) {
        throw new SkillSchemaError(
          `Unknown evidence status "${status}" in status_map.${key}`,
          "SKILL_EVIDENCE_STATUS_UNKNOWN",
        );
      }
      if (seen.has(status)) {
        throw new SkillSchemaError(
          `Evidence status "${status}" appears under both ${seen.get(status)} and ${key}`,
          "SKILL_EVIDENCE_STATUS_UNMAPPED",
        );
      }
      seen.set(status, key);
    }
    result[key] = statuses;
  }
  // 三个状态必须被完整覆盖：各恰好出现在一个键下，缺映射是配置错误，激活时挡下。
  for (const status of STATUS_VALUES) {
    if (!seen.has(status)) {
      throw new SkillSchemaError(
        `Evidence status "${status}" is not mapped to any status_map key`,
        "SKILL_EVIDENCE_STATUS_UNMAPPED",
      );
    }
  }
  return result;
}

function parseEvidenceSpec(value: unknown): EvidenceSpec {
  if (!isPlainObject(value)) {
    throw new SkillSchemaError("evidence must be an object", "SKILL_SCHEMA_INVALID");
  }
  rejectUnknownKeys(value, EVIDENCE_SPEC_KEYS, "evidence");

  if (typeof value.evidence_kind !== "string") {
    throw new SkillSchemaError("evidence_kind must be a string", "SKILL_SCHEMA_INVALID");
  }
  if (!(listEvidenceRefKinds() as string[]).includes(value.evidence_kind)) {
    // 不在 EvidenceRefKind 域内的 kind 同样按"未认领 owner"拒绝：owner 只可能
    // 认领上游类型里存在的 kind。
    throw new SkillSchemaError(
      `Evidence kind "${value.evidence_kind}" has no normalization owner`,
      "SKILL_EVIDENCE_KIND_UNAVAILABLE",
    );
  }

  if (!isPlainObject(value.freshness) || !isPlainObject((value.freshness as Record<string, unknown>).scope)) {
    throw new SkillSchemaError("freshness.scope is required", "SKILL_SCHEMA_INVALID");
  }
  const scope = (value.freshness as Record<string, unknown>).scope as unknown;
  if (scope !== "per_attempt" && scope !== "per_dispatch" && scope !== "persistent") {
    throw new SkillSchemaError("freshness.scope must be per_attempt | per_dispatch | persistent", "SKILL_SCHEMA_INVALID");
  }

  if (typeof value.independence_required !== "boolean") {
    throw new SkillSchemaError("independence_required must be a boolean", "SKILL_SCHEMA_INVALID");
  }
  if (value.decomposable !== false) {
    throw new SkillSchemaError("decomposable must be false in v0.3", "SKILL_SCHEMA_INVALID");
  }

  const kind = value.evidence_kind as EvidenceRefKind;
  if (EVIDENCE_NORMALIZATION_OWNER[kind] === null) {
    throw new SkillSchemaError(
      `Evidence kind "${kind}" has no normalization owner`,
      "SKILL_EVIDENCE_KIND_UNAVAILABLE",
    );
  }

  return {
    evidence_kind: kind,
    freshness: { scope },
    independence_required: value.independence_required,
    status_map: parseStatusMap(value.status_map),
    decomposable: false,
  };
}

export function parseRequirement(value: unknown, where: string): Requirement {
  if (!isPlainObject(value)) {
    throw new SkillSchemaError(`${where} must be an object`, "SKILL_SCHEMA_INVALID");
  }
  rejectUnknownKeys(value, REQUIREMENT_KEYS, where);

  if (typeof value.id !== "string" || !REQUIREMENT_ID_PATTERN.test(value.id)) {
    throw new SkillSchemaError(`${where}.id must be kebab-case`, "SKILL_SCHEMA_INVALID");
  }
  if (value.id.startsWith("sys-")) {
    throw new SkillSchemaError(`${where}.id uses reserved prefix "sys-"`, "SKILL_SCHEMA_INVALID");
  }
  if (value.kind !== "capability" && value.kind !== "completion") {
    throw new SkillSchemaError(`${where}.kind must be capability | completion`, "SKILL_SCHEMA_INVALID");
  }
  if (value.strength !== "hard" && value.strength !== "soft") {
    throw new SkillSchemaError(`${where}.strength must be hard | soft`, "SKILL_SCHEMA_INVALID");
  }
  const tags = parseStringArray(value.tags, `${where}.tags`);
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new SkillSchemaError(`${where}.description must be a string`, "SKILL_SCHEMA_INVALID");
  }

  const requirement: Requirement = {
    id: value.id,
    kind: value.kind,
    strength: value.strength,
    tags,
  };
  if (value.description !== undefined) {
    requirement.description = value.description;
  }
  if (value.kind === "completion") {
    if (value.evidence === undefined) {
      throw new SkillSchemaError(`${where}.evidence is required for completion requirements (ADR 0010)`, "SKILL_SCHEMA_INVALID");
    }
    requirement.evidence = parseEvidenceSpec(value.evidence);
  } else if (value.evidence !== undefined) {
    throw new SkillSchemaError(`${where}.evidence is only valid on completion requirements`, "SKILL_SCHEMA_INVALID");
  }
  return requirement;
}

export function parseStep(value: unknown, where: string): Step {
  if (!isPlainObject(value)) {
    throw new SkillSchemaError(`${where} must be an object`, "SKILL_SCHEMA_INVALID");
  }
  rejectUnknownKeys(value, STEP_KEYS, where);

  if (typeof value.id !== "string" || !REQUIREMENT_ID_PATTERN.test(value.id)) {
    throw new SkillSchemaError(`${where}.id must be kebab-case`, "SKILL_SCHEMA_INVALID");
  }
  if (typeof value.order !== "number" || !Number.isInteger(value.order)) {
    throw new SkillSchemaError(`${where}.order must be an integer`, "SKILL_SCHEMA_INVALID");
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    throw new SkillSchemaError(`${where}.title must be a non-empty string`, "SKILL_SCHEMA_INVALID");
  }
  if (!Array.isArray(value.requirements)) {
    throw new SkillSchemaError(`${where}.requirements must be an array`, "SKILL_SCHEMA_INVALID");
  }
  return {
    id: value.id,
    order: value.order,
    title: value.title,
    requirements: value.requirements.map((req, index) => parseRequirement(req, `${where}.requirements[${index}]`)),
  };
}

export interface ParsedRevisionContent {
  steps: Step[] | null;
  capabilityTags: string[];
  completionRequirements: Requirement[];
}

/**
 * 解析 revision 的三个内容列并执行全部激活期校验：
 * - 未知字段 / 非法 id / 不连续 order / 保留前缀 → SKILL_SCHEMA_*；
 * - evidence 契约校验（status_map 闭集、完整覆盖、owner 认领）；
 * - Requirement.id 在 revision 内唯一（跨 steps 与 Skill 级）。
 */
export function parseRevisionContent(input: {
  steps_json: string | null;
  capability_tags_json: string | null;
  completion_requirements_json: string | null;
}): ParsedRevisionContent {
  const capabilityTags = input.capability_tags_json
    ? (JSON.parse(input.capability_tags_json) as unknown)
    : [];

  let steps: Step[] | null = null;
  if (input.steps_json !== null && input.steps_json !== undefined) {
    const raw = JSON.parse(input.steps_json) as unknown;
    if (!Array.isArray(raw)) {
      throw new SkillSchemaError("steps_json must be an array", "SKILL_SCHEMA_INVALID");
    }
    steps = raw.map((step, index) => parseStep(step, `steps[${index}]`));
    // order 在 revision 内必须连续且唯一（0..N-1，任意出现顺序）。
    const orders = steps.map((step) => step.order).sort((a, b) => a - b);
    orders.forEach((order, index) => {
      if (order !== index) {
        throw new SkillSchemaError(`Step order must be contiguous 0..N-1; got ${JSON.stringify(orders)}`, "SKILL_SCHEMA_INVALID");
      }
    });
    const stepIds = new Set<string>();
    for (const step of steps) {
      if (stepIds.has(step.id)) {
        throw new SkillSchemaError(`Duplicate step id "${step.id}"`, "SKILL_SCHEMA_INVALID");
      }
      stepIds.add(step.id);
    }
  }

  let completionRequirements: Requirement[] = [];
  if (input.completion_requirements_json !== null && input.completion_requirements_json !== undefined) {
    const raw = JSON.parse(input.completion_requirements_json) as unknown;
    if (!Array.isArray(raw)) {
      throw new SkillSchemaError("completion_requirements_json must be an array", "SKILL_SCHEMA_INVALID");
    }
    completionRequirements = raw.map((req, index) => parseRequirement(req, `completion_requirements[${index}]`));
  }

  const ids = new Set<string>();
  const all: Requirement[] = [...(steps ?? []).flatMap((step) => step.requirements), ...completionRequirements];
  for (const requirement of all) {
    if (ids.has(requirement.id)) {
      throw new SkillSchemaError(`Duplicate requirement id "${requirement.id}"`, "SKILL_SCHEMA_INVALID");
    }
    ids.add(requirement.id);
  }

  if (!Array.isArray(capabilityTags) || capabilityTags.some((tag) => typeof tag !== "string")) {
    throw new SkillSchemaError("capability_tags_json must be a string array", "SKILL_SCHEMA_INVALID");
  }

  return { steps, capabilityTags: capabilityTags as string[], completionRequirements };
}

/**
 * 合并规则（design §3）：effective requirements = Skill 级 ∪ 所有 step 的
 * requirements。去重键是 (kind, tags 升序 join)，不含 strength；同键合并时
 * strength 取 hard、evidence 取 hard 那条的，同键同强度而 evidence 不同即
 * SKILL_EVIDENCE_CONFLICT 拒绝；description 拼接去重；合并后 id 取字典序最小。
 * 输出按 (kind, id) 稳定排序，同一 ref 的两次解析逐字节相同。
 */
export function mergeRequirements(requirements: Requirement[]): Requirement[] {
  const groups = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    const key = `${requirement.kind}|${[...requirement.tags].sort().join("\u0001")}`;
    const group = groups.get(key);
    if (group) group.push(requirement);
    else groups.set(key, [requirement]);
  }

  const merged: Requirement[] = [];
  for (const group of groups.values()) {
    const hard = group.filter((requirement) => requirement.strength === "hard");
    const winners = hard.length > 0 ? hard : group;
    const base: Requirement = { ...winners[0] };
    if (winners.length > 1) {
      const firstEvidence = JSON.stringify(winners[0].evidence ?? null);
      for (const winner of winners.slice(1)) {
        if (JSON.stringify(winner.evidence ?? null) !== firstEvidence) {
          throw new SkillSchemaError(
            `Requirements "${group.map((r => r.id)).join(",")}" share (kind, tags) but differ in evidence spec`,
            "SKILL_EVIDENCE_CONFLICT",
          );
        }
      }
    }
    base.id = require_minId(group).min;
    base.strength = hard.length > 0 ? "hard" : group[0].strength;
    const descriptions = new Set<string>();
    for (const requirement of group) {
      if (requirement.description) descriptions.add(requirement.description);
    }
    if (descriptions.size > 0) base.description = [...descriptions].sort().join("\n");
    else delete base.description;
    merged.push(base);
  }

  return merged.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind === "capability" ? -1 : 1));
}

// helper kept tiny: lexicographically smallest id of a merge group
function require_minId(group: Requirement[]): { min: string } {
  let min = group[0].id;
  for (const requirement of group.slice(1)) {
    if (requirement.id < min) min = requirement.id;
  }
  return { min };
}
