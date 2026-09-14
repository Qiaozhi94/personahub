// F012 T007 (AC-001/AC-006): three-tier eligibility evaluator — same-source
// downgrade, structural-only blocking, unverified conservatism, F013
// requirements frozen byte-identical, and gate visibility.

import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTestServices, disposeTestServices, type TestServices } from "../helpers.js";
import { EligibilityEvaluator, type EligibilityInput } from "../../src/services/eligibility-evaluator.js";
import { DispatchPurpose, RunPurpose, RunRole, RunStatus, type RunDispatchSource } from "@personahub/shared/types";
import { generateRunId } from "../../src/id.js";
import { createHash } from "node:crypto";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../fixtures/f012/capability-evidence.json", import.meta.url), "utf-8"),
) as {
  adapters: Record<string, { cli_version: string; probes: Record<string, {
    capability_key: string; verdict: string; probe_command: string; probe_result: string; probed_at: string; missing_reason: string | null;
  }> }>;
};

const CLI_VERSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(FIXTURE.adapters).map(([provider, adapter]) => [provider, adapter.cli_version]),
);

function seedEvidence(services: TestServices): void {
  const insert = services.db.prepare(
    "INSERT INTO adapter_capability_evidence (id, cli_provider, cli_version, capability_key, verdict, probe_command, probe_result, probed_at, missing_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [provider, adapter] of Object.entries(FIXTURE.adapters)) {
    for (const [key, probe] of Object.entries(adapter.probes)) {
      insert.run(
        `cap_${provider}_${key}`,
        provider,
        adapter.cli_version,
        key,
        probe.verdict,
        probe.probe_command,
        probe.probe_result,
        probe.probed_at,
        probe.missing_reason,
      );
    }
  }
}

function createAvailableAdapter(services: TestServices, projectId: string, provider: string, name: string, defaultModel: string | null) {
  return services.agentConfigRepo.create({
    project_id: projectId,
    name,
    role: "implementation",
    cli_provider: provider,
    command: provider === "codex" ? "codex" : provider === "claude-code" ? "claude" : "opencode",
    args: [],
    capability_tags: [],
    default_model: defaultModel,
    status: "available" as never,
  });
}

interface Scene {
  services: TestServices;
  evaluator: EligibilityEvaluator;
  codexId: string;
  claudeId: string;
  opencodeId: string;
  issueId: string;
  roomId: string;
  independentRoomId: string;
}

function buildScene(): Scene {
  const services = createTestServices();
  const spaceId = (services.db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string }).id;
  const project = services.projectRepo.create("P", null, spaceId);
  const workspace = services.workspaceRepo.create({
    project_id: project.id,
    local_path: "/tmp/f012-elig",
    local_path_normalized: "/tmp/f012-elig",
    git_branch: null,
    lock_state: "idle",
  });
  const issue = services.issueRepo.create({
    project_id: project.id,
    workspace_id: workspace.id,
    space_id: spaceId,
    title: "Eligibility issue",
    issue_type: "coding",
    workflow_template_id: "wft_coding_default",
    validation_policy_id: "vpl_coding_default",
    goal: null,
    status: "Inbox",
    priority: "normal",
    labels: [],
  });
  const thread = services.threadRepo.create({ issue_id: issue.id, thread_type: "primary", title: "T" });
  services.db.prepare(
    "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_task', ?, ?, 'Task room', 'active', ?, NULL)",
  ).run(spaceId, issue.id, new Date().toISOString());
  services.db.prepare(
    "INSERT INTO rooms (id, space_id, issue_id, title, state, created_at, ended_at) VALUES ('room_free', ?, NULL, 'Free chat', 'active', ?, NULL)",
  ).run(spaceId, new Date().toISOString());

  seedEvidence(services);
  const codex = createAvailableAdapter(services, project.id, "codex", "codex-gpt5.6-sol-high", "gpt-5.6-sol");
  const claude = createAvailableAdapter(services, project.id, "claude-code", "claude-default", "claude-sonnet-5");
  const opencode = createAvailableAdapter(services, project.id, "opencode", "oc-default", "deepseek/deepseek-v4-flash");

  const evaluator = new EligibilityEvaluator(services.db, services.agentConfigRepo, services.resolver, {
    currentCliVersion: (provider) => CLI_VERSIONS[provider] ?? null,
  });
  return {
    services,
    evaluator,
    codexId: codex.id,
    claudeId: claude.id,
    opencodeId: opencode.id,
    issueId: issue.id,
    roomId: "room_task",
    independentRoomId: "room_free",
  };
}

function input(partial: Partial<EligibilityInput> & { roomId: string }): EligibilityInput {
  return { purpose: DispatchPurpose.Execute, skillRefs: [], contextScope: "all", ...partial };
}

let scene: Scene;
beforeEach(() => {
  scene = buildScene();
});
afterEach(() => {
  disposeTestServices(scene.services);
});

function candidatesFor(result: { candidates: Array<{ identity: { adapter_config_id: string }; tier: string; reasons: Array<{ code: string }> }> }, adapterId: string) {
  return result.candidates.filter((c) => c.identity.adapter_config_id === adapterId);
}

describe("F012 eligibility evaluator (T007)", () => {
  it("emits recommended codex combos from enumerated models with mapped depths", () => {
    const result = scene.evaluator.evaluate(input({ roomId: scene.roomId }));
    const codex = candidatesFor(result, scene.codexId);
    // 5 visible models × 3 mapped tiers (low/medium/high)
    expect(codex.length).toBe(15);
    const solHigh = codex.find((c) => c.identity.model === "gpt-5.6-sol" && c.identity.depth_normalized === "high");
    expect(solHigh!.tier).toBe("recommended");
    expect(solHigh!.identity.depth_raw).toBe("high");
    expect(solHigh!.reasons).toHaveLength(0);
  });

  it("marks the producer combo same-source selectable with conclusion downgrade, others stay recommended", () => {
    const producerIdentity = {
      adapter_config_id: scene.codexId,
      name: "codex",
      cli_provider: "codex",
      default_model: "gpt-5.6-sol",
      runtime_id: "local",
    };
    scene.services.db.prepare(
      `INSERT INTO runs (id, issue_id, thread_id, workspace_id, adapter_config_id, status, instructions, role, purpose, dispatch_source, adapter_identity_json, created_at, updated_at)
       VALUES (?, ?, (SELECT id FROM threads WHERE issue_id = ? LIMIT 1), (SELECT workspace_id FROM issues WHERE id = ?), ?, ?, 'go', ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateRunId(), scene.issueId, scene.issueId, scene.issueId, scene.codexId,
      RunStatus.Completed, RunRole.Implementation, RunPurpose.WorkflowBound, "user_explicit" as RunDispatchSource,
      JSON.stringify(producerIdentity), new Date().toISOString(), new Date().toISOString(),
    );
    const result = scene.evaluator.evaluate(input({ roomId: scene.roomId }));
    const codex = candidatesFor(result, scene.codexId);
    const sol = codex.filter((c) => c.identity.model === "gpt-5.6-sol");
    for (const candidate of sol) {
      expect(candidate.tier).toBe("selectable");
      expect(candidate.reasons.map((r) => r.code)).toContain("SAME_SOURCE_DOWNGRADED");
    }
    const other = codex.filter((c) => c.identity.model !== "gpt-5.6-sol" && c.identity.depth_normalized === "high");
    for (const candidate of other) expect(candidate.tier).toBe("recommended");
  });

  it("claude-code: unverified enumeration+memory is blocked for validation, selectable for execution", () => {
    const validateResult = scene.evaluator.evaluate(input({ roomId: scene.roomId, purpose: DispatchPurpose.Validate }));
    for (const candidate of candidatesFor(validateResult, scene.claudeId)) {
      expect(candidate.tier).toBe("blocked");
      expect(candidate.reasons.map((r) => r.code)).toContain("ENUMERATION_UNVERIFIED");
      expect(candidate.reasons.map((r) => r.code)).toContain("NATIVE_MEMORY_UNVERIFIED");
    }
    const executeResult = scene.evaluator.evaluate(input({ roomId: scene.roomId, purpose: DispatchPurpose.Execute }));
    for (const candidate of candidatesFor(executeResult, scene.claudeId)) {
      expect(candidate.tier).toBe("selectable");
      const codes = candidate.reasons.map((r) => r.code);
      expect(codes).toContain("ENUMERATION_UNVERIFIED");
      expect(codes).toContain("NATIVE_MEMORY_UNVERIFIED");
    }
  });

  it("opencode: unmappable depth blocks both purposes with a visible reason", () => {
    for (const purpose of [DispatchPurpose.Execute, DispatchPurpose.Validate]) {
      const result = scene.evaluator.evaluate(input({ roomId: scene.roomId, purpose }));
      const oc = candidatesFor(result, scene.opencodeId);
      expect(oc.length).toBeGreaterThan(0);
      for (const candidate of oc) {
        expect(candidate.tier).toBe("blocked");
        expect(candidate.reasons.map((r) => r.code)).toContain("DEPTH_UNMAPPABLE");
        expect(candidate.identity.depth_raw).toBe("(unmapped)");
      }
    }
  });

  it("hard capability requirements fail conservatively on unsupported/unverified evidence (NFR-003)", () => {
    const { skill } = scene.services.skillRegistry.createSkill({
      display_name: "Independent review",
      draft: {
        steps: [],
        completion_requirements: [
          { id: "need-isolation", kind: "capability", strength: "hard", tags: ["native-memory-isolation"] },
        ],
      },
    });
    const ref = `${skill.id}@1`;
    const executeResult = scene.evaluator.evaluate(input({ roomId: scene.roomId, skillRefs: [ref] }));
    for (const candidate of candidatesFor(executeResult, scene.claudeId)) {
      expect(candidate.tier).toBe("blocked");
      const reason = candidate.reasons.find((r) => r.code === "SKILL_REQUIREMENT_UNMET");
      expect(reason).toBeTruthy();
      expect(reason!.source).toBe(`${ref}/need-isolation`);
    }
    for (const candidate of candidatesFor(executeResult, scene.codexId)) {
      expect(candidate.tier).toBe("recommended");
    }
  });

  it("an unresolvable skill ref blocks every candidate structurally", () => {
    const result = scene.evaluator.evaluate(input({ roomId: scene.roomId, skillRefs: ["skl_missing@9"] }));
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.tier).toBe("blocked");
      expect(candidate.reasons.map((r) => r.code)).toContain("SKILL_SOURCE_UNRESOLVED");
    }
  });

  it("paused runtime gate blocks all candidates with the recovery pointer", () => {
    scene.services.db.prepare("UPDATE dispatch_gates SET state = 'paused', revision = revision + 1 WHERE scope_type = 'runtime'").run();
    const result = scene.evaluator.evaluate(input({ roomId: scene.independentRoomId }));
    for (const candidate of result.candidates) {
      expect(candidate.tier).toBe("blocked");
      expect(candidate.reasons.map((r) => r.code)).toContain("GATE_PAUSED");
    }
  });

  it("freezes F013 requirements byte-identically: hash stable across evaluations and skill upgrades", () => {
    const { skill } = scene.services.skillRegistry.createSkill({
      display_name: "Stable",
      draft: { steps: [], completion_requirements: [{ id: "c1", kind: "capability", strength: "soft", tags: ["depth"] }] },
    });
    const ref = `${skill.id}@1`;
    const first = scene.evaluator.evaluate(input({ roomId: scene.roomId, skillRefs: [ref] }));
    // An upgrade appends a new revision; the ref still resolves to @1 verbatim.
    scene.services.skillRegistry.addRevision(skill.id, {
      version: 2,
      steps: [],
      completion_requirements: [{ id: "c2", kind: "capability", strength: "hard", tags: ["quota"] }],
    } as never);
    const second = scene.evaluator.evaluate(input({ roomId: scene.roomId, skillRefs: [ref] }));
    expect(second.requirements.hash).toBe(first.requirements.hash);
    expect(first.requirements.hash).toBe(
      createHash("sha256").update(
        JSON.stringify([
          {
            ...(scene.services.resolver.resolveEffectiveRequirements(ref) as object),
            ref,
          },
        ]),
      ).digest("hex"),
    );
  });

  it("disabled skills block with SKILL_DISABLED; eligible candidate sets shrink accordingly", () => {
    const { skill } = scene.services.skillRegistry.createSkill({
      display_name: "Disabled later",
      draft: { steps: [], completion_requirements: [] },
    });
    scene.services.skillRegistry.disable(skill.id);
    const result = scene.evaluator.evaluate(input({ roomId: scene.roomId, skillRefs: [`${skill.id}@1`] }));
    for (const candidate of result.candidates) {
      expect(candidate.tier).toBe("blocked");
      expect(candidate.reasons.map((r) => r.code)).toContain("SKILL_DISABLED");
    }
  });
});
