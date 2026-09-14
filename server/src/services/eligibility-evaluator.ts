// F012 T007: three-tier eligibility evaluator — READ-ONLY (design §2): it
// never writes, never auto-downgrades, never silently hides. Input: runtime
// facts + F013 EffectiveRequirementsResolver (versioned, byte-identical per
// ref) + capability evidence (T000). Output: candidates per execution combo
// (adapter × access × model × depth), each recommended / selectable / blocked
// with per-item reasons carrying their requirement source (§4.2).
//
// Frozen semantics:
// - same source is selectable + conclusion downgrade, never blocked (§9.1);
// - native memory isolation unsupported OR unverified cannot carry an
//   independent validation (ADR 0011) — purpose=validate/design_cases blocked,
//   purpose=execute selectable with a recorded consequence;
// - a capability unknown (unverified evidence) can never satisfy a hard
//   requirement relying on it (NFR-003) — conservative failure, no bypass.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import {
  AdapterStatus,
  DepthNormalized,
  DispatchPurpose,
  RunRole,
  type CapabilityVerdictValue,
  type EligibilityCandidate,
  type EligibilityReason,
  type EligibilityResult,
  type EligibilityTier,
  type ExecutionIdentity,
} from "@personahub/shared/types";
import { ErrorCode } from "@personahub/shared/errors";
import { AppError } from "../api/errors.js";
import { resolveExecutable } from "../runtime/executable-resolver.js";
import type { AgentConfigRepository, AgentConfigRecord } from "../repositories/agent-config.js";
import type { EffectiveRequirements, EffectiveRequirementsResolver } from "./effective-requirements.js";
import {
  loadCapabilityEvidenceFromDb,
  mapNativeDepthToThreeTier,
  nativeDepthLevels,
  parseCapabilityEvidenceFixture,
  verdictForAdapterCapability,
  type CapabilityEvidenceFixture,
} from "./capability-evidence.js";

export interface EligibilityInput {
  roomId: string;
  purpose: DispatchPurpose;
  skillRefs: string[];
  contextScope: "all" | "result_only" | "goal_only";
}

export interface EligibilityEvaluatorOptions {
  /** Resolves the RUNNING CLI version per provider for staleness checks. */
  currentCliVersion?: (provider: string) => string | null;
}

const CLI_BINARIES: Record<string, string> = {
  codex: "codex",
  "claude-code": "claude",
  opencode: "opencode",
};

const CAPABILITY_KEYS = new Set([
  "model_enumeration",
  "depth",
  "session_resume",
  "native_memory_isolation",
  "tools",
  "quota",
]);

/** Structural tag → capability key; uninterpretable tags stay null. */
export function capabilityTagToKey(tag: string): string | null {
  const key = tag.replace(/-/g, "_");
  return CAPABILITY_KEYS.has(key) ? key : null;
}

const versionCache = new Map<string, string | null>();

/** Resolve and cache the installed CLI version for a provider. */
export function resolveCliVersion(provider: string): string | null {
  if (versionCache.has(provider)) return versionCache.get(provider)!;
  const binary = CLI_BINARIES[provider];
  let version: string | null = null;
  if (binary) {
    const resolved = resolveExecutable(binary);
    if (resolved.resolved) {
      try {
        const raw = execFileSync(resolved.resolved.executable, [...resolved.resolved.prefixArgs, "--version"], {
          encoding: "utf-8",
          timeout: 10_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        version = raw.trim().split("\n")[0] || null;
      } catch {
        version = null;
      }
    }
  }
  versionCache.set(provider, version);
  return version;
}

/** Test hook: drop cached CLI versions. */
export function clearCliVersionCache(): void {
  versionCache.clear();
}

interface RequirementState {
  blockedReasons: EligibilityReason[];
  effective: Array<EffectiveRequirements & { ref: string }>;
  hash: string;
}

interface DepthFacts {
  /** tier -> representative native raw level (first detected). */
  byTier: Map<"high" | "medium" | "low", string>;
  /** True when evidence was supported but no level mapped. */
  unmappable: boolean;
}

export class EligibilityEvaluator {
  private evidenceFixtureCache: CapabilityEvidenceFixture | null | undefined;

  constructor(
    private db: Database.Database,
    private agentConfigRepo: AgentConfigRepository,
    private resolver: EffectiveRequirementsResolver,
    private options: EligibilityEvaluatorOptions = {},
  ) {}

  private evidenceFor(provider: string, capabilityKey: string): ReturnType<typeof verdictForAdapterCapability> {
    const fixture = this.evidenceFixture();
    const currentVersion = this.options.currentCliVersion?.(provider) ?? resolveCliVersion(provider);
    return verdictForAdapterCapability(fixture, provider, capabilityKey, currentVersion ?? "");
  }

  private evidenceFixture(): CapabilityEvidenceFixture | null {
    if (this.evidenceFixtureCache === undefined) {
      this.evidenceFixtureCache = parseCapabilityEvidenceFixture(loadCapabilityEvidenceFromDb(this.db));
    }
    return this.evidenceFixtureCache;
  }

  /** F011 reads this via getIndependenceSnapshot; frozen here so eligibility
   *  and the F011 snapshot can never disagree. */
  capabilityVerdict(provider: string, capabilityKey: string): CapabilityVerdictValue {
    return this.evidenceFor(provider, capabilityKey).verdict;
  }

  evaluate(input: EligibilityInput): EligibilityResult {
    const room = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(input.roomId) as
      | { id: string; space_id: string; issue_id: string | null }
      | undefined;
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, `Room not found: ${input.roomId}`);

    const requirementState = this.resolveRequirements(input.skillRefs, room.space_id);
    const producer = this.producerIdentity(room.issue_id);
    const pausedReasons = this.gateReasons(room);

    const adapters = this.adaptersInScope(room.issue_id, room.space_id);
    const candidates: EligibilityCandidate[] = [];
    for (const adapter of adapters) {
      candidates.push(...this.candidatesForAdapter(adapter, input, requirementState, producer, pausedReasons));
    }

    return {
      candidates,
      requirements: {
        ref: input.skillRefs.join(","),
        hash: requirementState.hash,
        items: requirementState.effective.flatMap((e) => [...e.capability_requirements, ...e.completion_requirements]),
      },
    };
  }

  private resolveRequirements(skillRefs: string[], spaceId: string): RequirementState {
    const blockedReasons: EligibilityReason[] = [];
    const effective: Array<EffectiveRequirements & { ref: string }> = [];
    for (const ref of skillRefs) {
      const parsed = this.resolver.resolveEffectiveRequirements(ref);
      if ("not_found" in parsed) {
        blockedReasons.push({
          code: "SKILL_SOURCE_UNRESOLVED",
          source: ref,
          strength: "structural",
          consequence: "要求来源不可解析（revision 不存在或未发布）——结构性缺失，不可派工",
        });
        continue;
      }
      const availability = this.db
        .prepare(
          `SELECT s.state AS skill_state, sss.state AS space_state
           FROM skills s
           LEFT JOIN skill_space_state sss ON sss.skill_id = s.id AND sss.space_id = ?
           WHERE s.id = ?`,
        )
        .get(spaceId, parsed.source_revision.skill_id) as { skill_state: string; space_state: string | null } | undefined;
      if (!availability || availability.skill_state !== "active") {
        blockedReasons.push({
          code: "SKILL_DISABLED",
          source: ref,
          strength: "structural",
          consequence: "Skill 已全局禁用——结构性缺失，不可派工",
        });
        continue;
      }
      if (availability.space_state !== null && availability.space_state !== "active") {
        blockedReasons.push({
          code: "SKILL_SHADOWED",
          source: ref,
          strength: "structural",
          consequence: `Skill 在该 Space 处于 ${availability.space_state}——结构性缺失，不可派工`,
        });
        continue;
      }
      effective.push({ ...parsed, ref });
    }
    // Byte-identical per ref (F013 contract), so this hash is stable across
    // eligibility previews and the confirm-time snapshot.
    const hash = createHash("sha256").update(JSON.stringify(effective)).digest("hex");
    return { blockedReasons, effective, hash };
  }

  private capabilityRequirementReasons(
    requirementState: RequirementState,
    provider: string,
  ): { reasons: EligibilityReason[]; blocked: boolean } {
    const reasons: EligibilityReason[] = [];
    let blocked = false;
    for (const entry of requirementState.effective) {
      for (const requirement of entry.capability_requirements) {
        const keys = (requirement.tags ?? []).map(capabilityTagToKey).filter((key): key is string => key !== null);
        if (keys.length === 0) {
          // Conservative: a capability requirement whose tags we cannot map to
          // a known capability can never be verified as satisfied.
          const structural = requirement.strength === "hard";
          reasons.push({
            code: "SKILL_REQUIREMENT_UNMET",
            source: `${entry.ref}/${requirement.id}`,
            strength: structural ? "structural" : "soft",
            consequence: structural
              ? "硬性能力要求的标签无法与已知能力对应——保守失败，不可派工"
              : "软性能力要求无法解释——可派工，偏离将持久留痕",
          });
          if (structural) blocked = true;
          continue;
        }
        for (const key of keys) {
          const verdict = this.capabilityVerdict(provider, key);
          if (verdict === "supported") continue;
          // NFR-003: unsupported AND unverified both fail a hard requirement.
          const structural = requirement.strength === "hard";
          reasons.push({
            code: "SKILL_REQUIREMENT_UNMET",
            source: `${entry.ref}/${requirement.id}`,
            strength: structural ? "structural" : "soft",
            consequence: structural
              ? `依赖能力 ${key} 的裁决为 ${verdict}——不可承担该硬性要求`
              : `依赖能力 ${key} 的裁决为 ${verdict}——可派工，偏离将持久留痕`,
          });
          if (structural) blocked = true;
        }
      }
    }
    return { reasons, blocked };
  }

  private gateReasons(room: { issue_id: string | null }): EligibilityReason[] {
    const rows = this.db
      .prepare("SELECT scope_type, scope_id FROM dispatch_gates WHERE state = 'paused'")
      .all() as Array<{ scope_type: string; scope_id: string }>;
    return rows
      .filter(
        (row) =>
          row.scope_type === "runtime" ||
          (room.issue_id !== null && row.scope_type === "issue" && row.scope_id === room.issue_id),
      )
      .map((row) => ({
        code: "GATE_PAUSED",
        source: `gate:${row.scope_type}`,
        strength: "structural" as const,
        consequence: "派工闸门暂停中——恢复入口在运行时面 / 任务面",
      }));
  }

  private producerIdentity(issueId: string | null): { adapter_config_id: string; model: string } | null {
    if (!issueId) return null;
    const row = this.db
      .prepare(
        `SELECT adapter_identity_json FROM runs
         WHERE issue_id = ? AND role = ? AND adapter_identity_json IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(issueId, RunRole.Implementation) as { adapter_identity_json: string } | undefined;
    if (!row) return null;
    try {
      const identity = JSON.parse(row.adapter_identity_json) as { adapter_config_id?: string; default_model?: string | null };
      if (!identity.adapter_config_id) return null;
      return { adapter_config_id: identity.adapter_config_id, model: identity.default_model ?? "" };
    } catch {
      return null;
    }
  }

  private adaptersInScope(issueId: string | null, spaceId: string): AgentConfigRecord[] {
    if (issueId) {
      const projectRow = this.db.prepare("SELECT project_id FROM issues WHERE id = ?").get(issueId) as
        | { project_id: string | null }
        | undefined;
      if (projectRow?.project_id) {
        const adapters = this.agentConfigRepo.listByProject(projectRow.project_id);
        if (adapters.length > 0) return adapters;
      }
    }
    // Independent sessions (or unbound issues) see every active project in the
    // room's Space — dedupe by adapter id.
    const projects = this.db
      .prepare("SELECT id FROM projects WHERE space_id = ? AND state = 'active'")
      .all(spaceId) as Array<{ id: string }>;
    const byId = new Map<string, AgentConfigRecord>();
    for (const project of projects) {
      for (const adapter of this.agentConfigRepo.listByProject(project.id)) byId.set(adapter.id, adapter);
    }
    return [...byId.values()];
  }

  private depthFacts(provider: string): DepthFacts {
    const byTier = new Map<"high" | "medium" | "low", string>();
    const resolution = this.evidenceFor(provider, "depth");
    for (const raw of nativeDepthLevels(resolution)) {
      const tier = mapNativeDepthToThreeTier(provider, raw);
      if (tier && !byTier.has(tier)) byTier.set(tier, raw);
    }
    return { byTier, unmappable: resolution.verdict === "supported" && byTier.size === 0 };
  }

  private candidatesForAdapter(
    adapter: AgentConfigRecord,
    input: EligibilityInput,
    requirementState: RequirementState,
    producer: { adapter_config_id: string; model: string } | null,
    pausedReasons: EligibilityReason[],
  ): EligibilityCandidate[] {
    const provider = adapter.cli_provider;
    const baseReasons: EligibilityReason[] = [...pausedReasons, ...requirementState.blockedReasons];

    // Runtime facts first: offline adapter or unknown login is structural.
    if (adapter.status === AdapterStatus.Unavailable) {
      baseReasons.push({
        code: "ADAPTER_OFFLINE",
        source: "runtime",
        strength: "structural",
        consequence: "adapter 探测不可用——替代路径：修复登录或命令后重新验证",
      });
    } else if (adapter.status === AdapterStatus.Unknown) {
      baseReasons.push({
        code: "ADAPTER_LOGIN_UNKNOWN",
        source: "runtime",
        strength: "structural",
        consequence: "adapter 登录状态未知——先在运行时面执行“验证登录”",
      });
    }

    const independentPurpose = input.purpose !== DispatchPurpose.Execute;
    const enumeration = this.evidenceFor(provider, "model_enumeration");
    const models: string[] = [];
    if (enumeration.verdict === "supported") {
      try {
        const parsed = JSON.parse(enumeration.evidence.probe_result) as { models?: Array<{ id?: string }> };
        for (const model of parsed.models ?? []) if (model.id) models.push(model.id);
      } catch {
        // malformed evidence degrades to default-model-only below
      }
    }
    if (models.length === 0 && adapter.default_model) models.push(adapter.default_model);
    if (models.length === 0) {
      baseReasons.push({
        code: "MODEL_NOT_AVAILABLE",
        source: enumeration.verdict === "supported" ? "capability_evidence" : "runtime",
        strength: "structural",
        consequence: "无法确定该 adapter 的可用模型——结构性缺失",
      });
    }
    // Enumeration unknown: structural for independent validation, consequence
    // only for plain execution (NFR-003 purpose split, same as ADR 0011).
    const enumerationUnverified = enumeration.verdict === "unverified";
    if (enumerationUnverified && independentPurpose) {
      baseReasons.push({
        code: "ENUMERATION_UNVERIFIED",
        source: "capability_evidence",
        strength: "structural",
        consequence: "模型枚举无证据——不可承担依赖该能力的独立验证",
      });
    }

    const depths = this.depthFacts(provider);
    if (depths.byTier.size === 0) {
      baseReasons.push({
        code: "DEPTH_UNMAPPABLE",
        source: "capability_evidence",
        strength: "structural",
        consequence: "深度能力未探测或无法映射到三档——不可派工；重跑 capability probe 后恢复",
      });
    }

    // ADR 0011: native memory isolation gates independence, not execution.
    const memoryVerdict = this.capabilityVerdict(provider, "native_memory_isolation");
    const memoryBlocked = memoryVerdict !== "supported" && independentPurpose;
    if (memoryBlocked) {
      baseReasons.push({
        code: memoryVerdict === "unsupported" ? "NATIVE_MEMORY_UNSUPPORTED" : "NATIVE_MEMORY_UNVERIFIED",
        source: "capability_evidence",
        strength: "structural",
        consequence: "原生记忆隔离不可用——按 ADR 0011 不得承担要求独立性的验证",
      });
    }
    const memoryExecuteReason: EligibilityReason | null =
      memoryVerdict !== "supported" && !independentPurpose
        ? {
            code: memoryVerdict === "unsupported" ? "NATIVE_MEMORY_UNSUPPORTED" : "NATIVE_MEMORY_UNVERIFIED",
            source: "capability_evidence",
            strength: "soft",
            consequence: "原生记忆隔离不可用——执行可保留，验证类派工将不可选",
          }
        : null;

    const enumerationExecuteReason: EligibilityReason | null =
      enumerationUnverified && !independentPurpose
        ? {
            code: "ENUMERATION_UNVERIFIED",
            source: "capability_evidence",
            strength: "soft",
            consequence: "模型枚举无证据——可用集合未核对，执行保留并声明后果",
          }
        : null;

    const capabilityOutcome = this.capabilityRequirementReasons(requirementState, provider);

    const combinations: EligibilityCandidate[] = [];
    const modelList = models.length > 0 ? models : ["(unknown)"];
    const tiers: Array<"high" | "medium" | "low"> = depths.byTier.size > 0 ? [...depths.byTier.keys()] : ["low"];
    for (const model of modelList) {
      for (const tier of tiers) {
        const sameSource = producer !== null && producer.adapter_config_id === adapter.id && producer.model === model;
        const reasons: EligibilityReason[] = [
          ...baseReasons,
          ...capabilityOutcome.reasons,
          ...(memoryExecuteReason ? [memoryExecuteReason] : []),
          ...(enumerationExecuteReason ? [enumerationExecuteReason] : []),
          ...(sameSource
            ? [
                {
                  code: "SAME_SOURCE_DOWNGRADED",
                  source: "runtime",
                  strength: "soft" as const,
                  consequence: "与产出实现的执行组合同源——结论将降级为“有证据待验证”",
                },
              ]
            : []),
        ];
        const blocked =
          baseReasons.length > 0 || capabilityOutcome.blocked || memoryBlocked || depths.byTier.size === 0;
        const resultTier: EligibilityTier = blocked ? "blocked" : reasons.length > 0 ? "selectable" : "recommended";
        const identity: ExecutionIdentity = {
          runtime_id: adapter.runtime_id,
          adapter_config_id: adapter.id,
          access_ref: null,
          model,
          depth_raw: depths.byTier.get(tier) ?? "(unmapped)",
          depth_normalized: tier as DepthNormalized,
        };
        combinations.push({ identity, tier: resultTier, reasons });
      }
    }
    return combinations;
  }
}
