// F012 T000: capability evidence — fixture loading, staleness checks and
// conservative verdict derivation (NFR-003). Every consumer of capability
// facts MUST go through `verdictForAdapterCapability`: a missing, malformed,
// version-mismatched or expired evidence row degrades to `unverified`, never
// to supported (design §8 AC-006 mutation cases: 删字段 / 改 CLI 版本 / 过期证据).
//
// The depth three-tier mapping is a pure function so that `depth_raw`
// (adapter-native text) and `depth_normalized` (uniform tier) can be recorded
// together per dispatch (FR-008); a native level with no rule here must NOT
// enter candidates (design §9.2 无法映射的档位不进入候选).

import type { Database } from "better-sqlite3";
import type { CapabilityVerdictValue } from "@personahub/shared/types";

export const CAPABILITY_EVIDENCE_SCHEMA = "f012.capability-evidence/1";

/** Evidence older than this is expired regardless of CLI version. */
export const CAPABILITY_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface FixtureProbe {
  capability_key: string;
  verdict: string;
  probe_command: string;
  probe_result: string;
  probed_at: string;
  missing_reason: string | null;
}

export interface CapabilityEvidenceFixture {
  schema: string;
  generated_at: string;
  adapters: Record<string, { cli_version: string; probes: Record<string, FixtureProbe> }>;
}

export type EvidenceResolution =
  | {
      verdict: "supported" | "unsupported";
      evidence: FixtureProbe;
    }
  | {
      verdict: "unverified";
      /** Stable degradation code + human detail for UI/diagnostics. */
      degrade_reason: "EVIDENCE_MISSING" | "EVIDENCE_MALFORMED" | "EVIDENCE_STALE" | "EVIDENCE_EXPIRED";
      detail: string;
      evidence: FixtureProbe | null;
    };

/** Parse an unknown document into the fixture shape; null when the document
 *  deviates from the schema (callers must treat null as "no evidence"). */
export function parseCapabilityEvidenceFixture(raw: unknown): CapabilityEvidenceFixture | null {
  if (typeof raw !== "object" || raw === null) return null;
  const doc = raw as Record<string, unknown>;
  if (doc.schema !== CAPABILITY_EVIDENCE_SCHEMA) return null;
  if (typeof doc.generated_at !== "string") return null;
  if (typeof doc.adapters !== "object" || doc.adapters === null) return null;
  const adapters: CapabilityEvidenceFixture["adapters"] = {};
  for (const [provider, value] of Object.entries(doc.adapters as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) return null;
    const adapter = value as Record<string, unknown>;
    if (typeof adapter.cli_version !== "string") return null;
    if (typeof adapter.probes !== "object" || adapter.probes === null) return null;
    const probes: Record<string, FixtureProbe> = {};
    for (const [key, probeValue] of Object.entries(adapter.probes as Record<string, unknown>)) {
      if (typeof probeValue !== "object" || probeValue === null) return null;
      const probe = probeValue as Record<string, unknown>;
      if (
        typeof probe.capability_key !== "string" ||
        typeof probe.verdict !== "string" ||
        typeof probe.probe_command !== "string" ||
        typeof probe.probe_result !== "string" ||
        typeof probe.probed_at !== "string"
      ) {
        return null;
      }
      probes[key] = {
        capability_key: probe.capability_key,
        verdict: probe.verdict,
        probe_command: probe.probe_command,
        probe_result: probe.probe_result,
        probed_at: probe.probed_at,
        missing_reason: typeof probe.missing_reason === "string" ? probe.missing_reason : null,
      };
    }
    adapters[provider] = { cli_version: adapter.cli_version, probes };
  }
  return { schema: doc.schema, generated_at: doc.generated_at, adapters };
}

function versionToken(text: string): string | null {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null;
}

interface ParsedProbeResult {
  ok: boolean;
  native_levels?: unknown;
  [key: string]: unknown;
}

/**
 * Derive the effective verdict for one (provider, capability, running CLI
 * version) triple. The row's own verdict is only honored when the evidence is
 * complete (probe_result JSON with `ok` for supported rows), version-matched
 * and fresh — any deviation degrades to unverified with a stable reason.
 */
export function verdictForAdapterCapability(
  fixture: CapabilityEvidenceFixture | null,
  provider: string,
  capabilityKey: string,
  currentCliVersion: string,
  nowMs: number = Date.now(),
): EvidenceResolution {
  const adapter = fixture?.adapters[provider];
  const probe = adapter?.probes[capabilityKey];
  if (!adapter || !probe) {
    return { verdict: "unverified", degrade_reason: "EVIDENCE_MISSING", detail: `no ${capabilityKey} evidence for ${provider}`, evidence: null };
  }

  let parsed: ParsedProbeResult | null = null;
  try {
    parsed = JSON.parse(probe.probe_result) as ParsedProbeResult;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") {
    return { verdict: "unverified", degrade_reason: "EVIDENCE_MALFORMED", detail: "probe_result is not parseable JSON", evidence: probe };
  }
  if (probe.verdict === "supported" && parsed.ok !== true) {
    return { verdict: "unverified", degrade_reason: "EVIDENCE_MALFORMED", detail: "supported verdict without ok:true probe result", evidence: probe };
  }

  const evidenceVersion = versionToken(adapter.cli_version);
  const runningVersion = versionToken(currentCliVersion);
  if (!evidenceVersion || !runningVersion || evidenceVersion !== runningVersion) {
    return {
      verdict: "unverified",
      degrade_reason: "EVIDENCE_STALE",
      detail: `evidence recorded for CLI ${adapter.cli_version}, running ${currentCliVersion}`,
      evidence: probe,
    };
  }

  const probedAt = Date.parse(probe.probed_at);
  if (Number.isNaN(probedAt) || nowMs - probedAt > CAPABILITY_EVIDENCE_MAX_AGE_MS) {
    return { verdict: "unverified", degrade_reason: "EVIDENCE_EXPIRED", detail: `evidence probed at ${probe.probed_at} is older than the retention window`, evidence: probe };
  }

  if (probe.verdict === "supported" || probe.verdict === "unsupported") {
    return { verdict: probe.verdict, evidence: probe };
  }
  return { verdict: "unverified", degrade_reason: "EVIDENCE_MISSING", detail: probe.missing_reason ?? "probe recorded unverified", evidence: probe };
}

/** Native depth levels recorded by the depth probe; empty when absent. */
export function nativeDepthLevels(resolution: EvidenceResolution): string[] {
  if (resolution.verdict !== "supported") return [];
  try {
    const parsed = JSON.parse(resolution.evidence.probe_result) as ParsedProbeResult;
    if (!Array.isArray(parsed.native_levels)) return [];
    return parsed.native_levels.filter((level): level is string => typeof level === "string");
  } catch {
    return [];
  }
}

const DEPTH_THREE_TIER_MAP: Record<string, Record<string, "high" | "medium" | "low">> = {
  codex: { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high", ultra: "high" },
  "claude-code": { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" },
  opencode: { minimal: "low", low: "low", medium: "medium", high: "high", max: "high" },
};

/**
 * Map an adapter-native depth level onto the uniform three tiers. `null`
 * means "cannot map" — the level must not become a dispatch candidate
 * (design §9.2); `none`/`minimal` on codex deliberately map to null because
 * they disable reasoning rather than lowering it.
 */
export function mapNativeDepthToThreeTier(provider: string, raw: string): "high" | "medium" | "low" | null {
  return DEPTH_THREE_TIER_MAP[provider]?.[raw] ?? null;
}

/** Build the fixture shape from the `adapter_capability_evidence` table
 *  (populated by the T000 probe script's --import mode). Providers or
 *  capabilities without rows are simply absent → EVIDENCE_MISSING downstream. */
export function loadCapabilityEvidenceFromDb(db: Database): CapabilityEvidenceFixture {
  const rows = db
    .prepare("SELECT cli_provider, cli_version, capability_key, verdict, probe_command, probe_result, probed_at, missing_reason FROM adapter_capability_evidence")
    .all() as Array<{
    cli_provider: string;
    cli_version: string;
    capability_key: string;
    verdict: string;
    probe_command: string;
    probe_result: string;
    probed_at: string;
    missing_reason: string | null;
  }>;
  const fixture: CapabilityEvidenceFixture = { schema: CAPABILITY_EVIDENCE_SCHEMA, generated_at: new Date(0).toISOString(), adapters: {} };
  for (const row of rows) {
    const adapter = (fixture.adapters[row.cli_provider] ??= { cli_version: row.cli_version, probes: {} });
    adapter.probes[row.capability_key] = {
      capability_key: row.capability_key,
      verdict: row.verdict,
      probe_command: row.probe_command,
      probe_result: row.probe_result,
      probed_at: row.probed_at,
      missing_reason: row.missing_reason,
    };
  }
  return fixture;
}

export type { CapabilityVerdictValue };
