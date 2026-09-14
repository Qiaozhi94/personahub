// F012 T000: capability evidence mutation tests — prove that eligibility
// inputs fail conservatively (NFR-003). The mutations mirror design AC-006:
// delete fields, change the CLI version, age the evidence past the window;
// every one of them must degrade to `unverified`, never to supported.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_EVIDENCE_MAX_AGE_MS,
  mapNativeDepthToThreeTier,
  nativeDepthLevels,
  parseCapabilityEvidenceFixture,
  verdictForAdapterCapability,
  type CapabilityEvidenceFixture,
} from "../../src/services/capability-evidence.js";

const FIXTURE_PATH = new URL("../fixtures/f012/capability-evidence.json", import.meta.url).pathname;

function loadFixture(): CapabilityEvidenceFixture {
  const raw: unknown = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  const parsed = parseCapabilityEvidenceFixture(raw);
  if (!parsed) throw new Error("committed fixture must parse");
  return parsed;
}

const NOW = Date.parse(loadFixture().generated_at);

describe("f012 capability evidence fixture", () => {
  it("covers all four capability probes for all three adapters with legal verdicts", () => {
    const fixture = loadFixture();
    for (const provider of ["codex", "claude-code", "opencode"]) {
      const adapter = fixture.adapters[provider];
      expect(adapter, `fixture must cover ${provider}`).toBeDefined();
      for (const key of ["model_enumeration", "depth", "session_resume", "native_memory_isolation"]) {
        const probe = adapter.probes[key];
        expect(probe, `${provider}/${key} probe`).toBeDefined();
        expect(["supported", "unsupported", "unverified"]).toContain(probe.verdict);
        expect(probe.probe_command.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(probe.probed_at))).toBe(false);
        if (probe.verdict === "unverified") {
          expect(probe.missing_reason, `${provider}/${key} unverified needs a reason`).toBeTruthy();
        }
        if (probe.verdict === "supported") {
          const parsed = JSON.parse(probe.probe_result) as { ok?: unknown };
          expect(parsed.ok, `${provider}/${key} supported needs ok:true`).toBe(true);
        }
      }
    }
  });

  it("carries no email or token material in probe results", () => {
    const fixture = loadFixture();
    const text = JSON.stringify(fixture);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
  });

  it("supported probes resolve as supported; unverified probes stay unverified", () => {
    const fixture = loadFixture();
    const codexResume = verdictForAdapterCapability(fixture, "codex", "session_resume", "codex-cli 0.154.0", NOW);
    expect(codexResume.verdict).toBe("supported");

    const claudeEnumeration = verdictForAdapterCapability(fixture, "claude-code", "model_enumeration", "2.1.268 (Claude Code)", NOW);
    expect(claudeEnumeration.verdict).toBe("unverified");
    if (claudeEnumeration.verdict === "unverified") {
      expect(claudeEnumeration.detail).toContain("model-list subcommand");
    }
  });
});

describe("conservative failure under fixture mutation (AC-006)", () => {
  it("missing evidence row degrades to unverified (EVIDENCE_MISSING)", () => {
    const fixture = loadFixture();
    const result = verdictForAdapterCapability(fixture, "opencode", "depth", "1.18.30", NOW);
    // opencode depth was probed unverified — an entirely absent row must look
    // the same to the consumer: unverified, never supported.
    expect(result.verdict).toBe("unverified");

    const absent = verdictForAdapterCapability(fixture, "codex", "tools", "codex-cli 0.154.0", NOW);
    expect(absent.verdict).toBe("unverified");
    if (absent.verdict === "unverified") expect(absent.degrade_reason).toBe("EVIDENCE_MISSING");
  });

  it("unparseable fixture document degrades to unverified (EVIDENCE_MISSING)", () => {
    expect(parseCapabilityEvidenceFixture({ schema: "something/else" })).toBeNull();
    expect(parseCapabilityEvidenceFixture(null)).toBeNull();
    const broken = verdictForAdapterCapability(null, "codex", "session_resume", "codex-cli 0.154.0", NOW);
    expect(broken.verdict).toBe("unverified");
  });

  it("mutating a supported row: removed ok flag degrades to unverified (EVIDENCE_MALFORMED)", () => {
    const fixture = loadFixture();
    const probe = fixture.adapters["codex"].probes["session_resume"];
    const parsed = JSON.parse(probe.probe_result) as Record<string, unknown>;
    delete parsed.ok;
    probe.probe_result = JSON.stringify(parsed);

    const result = verdictForAdapterCapability(fixture, "codex", "session_resume", "codex-cli 0.154.0", NOW);
    expect(result.verdict).toBe("unverified");
    if (result.verdict === "unverified") expect(result.degrade_reason).toBe("EVIDENCE_MALFORMED");
  });

  it("mutating the CLI version degrades to unverified (EVIDENCE_STALE)", () => {
    const fixture = loadFixture();
    const result = verdictForAdapterCapability(fixture, "codex", "session_resume", "codex-cli 0.999.0", NOW);
    expect(result.verdict).toBe("unverified");
    if (result.verdict === "unverified") {
      expect(result.degrade_reason).toBe("EVIDENCE_STALE");
      expect(result.detail).toContain("0.999.0");
    }
  });

  it("aging evidence past the retention window degrades to unverified (EVIDENCE_EXPIRED)", () => {
    const fixture = loadFixture();
    const result = verdictForAdapterCapability(fixture, "codex", "session_resume", "codex-cli 0.154.0", NOW + CAPABILITY_EVIDENCE_MAX_AGE_MS + 1);
    expect(result.verdict).toBe("unverified");
    if (result.verdict === "unverified") expect(result.degrade_reason).toBe("EVIDENCE_EXPIRED");
  });

  it("corrupting probe_result JSON degrades to unverified", () => {
    const fixture = loadFixture();
    fixture.adapters["codex"].probes["session_resume"].probe_result = "{not json";
    const result = verdictForAdapterCapability(fixture, "codex", "session_resume", "codex-cli 0.154.0", NOW);
    expect(result.verdict).toBe("unverified");
    if (result.verdict === "unverified") expect(result.degrade_reason).toBe("EVIDENCE_MALFORMED");
  });
});

describe("depth three-tier mapping (FR-008)", () => {
  it("maps detected codex native levels; none/minimal do not become candidates", () => {
    expect(mapNativeDepthToThreeTier("codex", "low")).toBe("low");
    expect(mapNativeDepthToThreeTier("codex", "medium")).toBe("medium");
    expect(mapNativeDepthToThreeTier("codex", "high")).toBe("high");
    expect(mapNativeDepthToThreeTier("codex", "xhigh")).toBe("high");
    expect(mapNativeDepthToThreeTier("codex", "max")).toBe("high");
    expect(mapNativeDepthToThreeTier("codex", "ultra")).toBe("high");
    expect(mapNativeDepthToThreeTier("codex", "none")).toBeNull();
    expect(mapNativeDepthToThreeTier("codex", "minimal")).toBeNull();
  });

  it("maps claude and opencode levels and rejects unknown levels", () => {
    expect(mapNativeDepthToThreeTier("claude-code", "xhigh")).toBe("high");
    expect(mapNativeDepthToThreeTier("opencode", "minimal")).toBe("low");
    expect(mapNativeDepthToThreeTier("opencode", "__bogus_level__")).toBeNull();
    expect(mapNativeDepthToThreeTier("unknown-provider", "high")).toBeNull();
  });

  it("nativeDepthLevels returns the recorded levels only from supported evidence", () => {
    const fixture = loadFixture();
    const codexDepth = verdictForAdapterCapability(fixture, "codex", "depth", "codex-cli 0.154.0", NOW);
    expect(nativeDepthLevels(codexDepth)).toContain("xhigh");

    // opencode depth is unverified — no levels may leak from the failed probe.
    const opencodeDepth = verdictForAdapterCapability(fixture, "opencode", "depth", "1.18.30", NOW);
    expect(nativeDepthLevels(opencodeDepth)).toEqual([]);
  });
});
