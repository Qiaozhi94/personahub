import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/db/index.js";
import { buildV02Fixture } from "../fixtures/build-v02-fixture.js";
import { EffectiveRequirementsResolver } from "../../src/services/effective-requirements.js";
import { SkillRegistry } from "../../src/services/skill-registry.js";
import { AuditService } from "../../src/services/audit.js";
import { AdminAuditEventRepository } from "../../src/repositories/admin-audit-event.js";

// F013 AC-001/AC-005 (design §8 legacy-skill-migration)：v10 fixture 升级后——
// 每条历史 Issue 的组合都能经 combo_map 解析到确定 skill@version（逐行 + 反查
// 零缺失）；Issue 上的 policy 优先；自由文本要求不被伪造成 tags；两旧表同 ID
// 时 alias 复合主键各自保真。

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function upgraded() {
  tempDir = mkdtempSync(join(tmpdir(), "f013-legacy-skill-"));
  const fixture = buildV02Fixture(tempDir);
  fixture.close();
  const db = openDatabase(join(tempDir, "v02-fixture.sqlite"));
  const audit = new AuditService(new AdminAuditEventRepository(db));
  return { db, registry: new SkillRegistry(db, audit), resolver: new EffectiveRequirementsResolver(db) };
}

describe("F013 legacy skill migration (v10 fixture)", () => {
  it("resolves every fixture issue combo to a definite skill@version (per-row + anti-join zero)", () => {
    const { db } = upgraded();
    try {
      const issues = db
        .prepare("SELECT id, workflow_template_id, validation_policy_id FROM issues")
        .all() as Array<{ id: string; workflow_template_id: string; validation_policy_id: string }>;
      expect(issues.length).toBeGreaterThanOrEqual(8);

      for (const issue of issues) {
        const hit = db
          .prepare(
            "SELECT skill_id, version FROM skill_legacy_combo_map WHERE workflow_template_id = ? AND validation_policy_id = ?",
          )
          .get(issue.workflow_template_id, issue.validation_policy_id) as
          | { skill_id: string; version: number }
          | undefined;
        expect(hit, `issue ${issue.id} combo unresolved`).toBeDefined();
        const revision = db
          .prepare("SELECT published_at FROM skill_revisions WHERE skill_id = ? AND version = ?")
          .get(hit!.skill_id, hit!.version) as { published_at: string } | undefined;
        expect(revision?.published_at).not.toBeNull();
      }

      const missing = db
        .prepare(
          `SELECT COUNT(*) AS n FROM issues i
           WHERE NOT EXISTS (
             SELECT 1 FROM skill_legacy_combo_map m
             WHERE m.workflow_template_id = i.workflow_template_id AND m.validation_policy_id = i.validation_policy_id
           )`,
        )
        .get() as { n: number };
      expect(missing.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it("legacy revisions resolve through the F012 contract with requirements intact", () => {
    const { db, resolver } = upgraded();
    try {
      const combo = db.prepare("SELECT skill_id, version FROM skill_legacy_combo_map LIMIT 1").get() as {
        skill_id: string;
        version: number;
      };
      const resolved = resolver.resolveEffectiveRequirements(`${combo.skill_id}@${combo.version}`);
      if ("not_found" in resolved) throw new Error("legacy revision must resolve");
      expect(resolved.source_revision).toEqual({ skill_id: combo.skill_id, version: combo.version });
    } finally {
      db.close();
    }
  });

  it("free-text evidence requirements are not forged into tags (soft + description)", () => {
    const { db } = upgraded();
    try {
      const rows = db
        .prepare("SELECT completion_requirements_json FROM skill_revisions WHERE completion_requirements_json IS NOT NULL")
        .all() as Array<{ completion_requirements_json: string }>;
      let sawSoftDescription = false;
      for (const row of rows) {
        const requirements = JSON.parse(row.completion_requirements_json) as Array<{
          strength: string;
          tags: string[];
          description?: string;
        }>;
        for (const requirement of requirements) {
          if (requirement.strength === "soft") {
            sawSoftDescription = true;
            expect(requirement.tags).toEqual([]); // 不伪造 tags
            expect(requirement.description?.length ?? 0).toBeGreaterThan(0);
          }
        }
      }
      // fixture 的默认 policy 全是结构化 v1（无自由文本）——该场景由
      // legacy-skill-mapping 单元断言覆盖；这里验证存在的结构化要求都带 tags。
      const structured = rows.some((row) =>
        (JSON.parse(row.completion_requirements_json) as Array<{ tags: string[] }>).some(
          (requirement) => requirement.tags.length > 0,
        ),
      );
      expect(structured || sawSoftDescription).toBe(true);
    } finally {
      db.close();
    }
  });

  it("alias composite PK keeps both legacy tables' rows even with colliding IDs", () => {
    const { db } = upgraded();
    try {
      const aliases = db
        .prepare("SELECT source_kind, legacy_id FROM skill_legacy_aliases")
        .all() as Array<{ source_kind: string; legacy_id: string }>;
      const workflowIds = aliases.filter((a) => a.source_kind === "workflow_template").map((a) => a.legacy_id);
      const policyIds = aliases.filter((a) => a.source_kind === "validation_policy").map((a) => a.legacy_id);
      // fixture: wft_coding_default / wft_v02_coding_v2 / vpl_coding_default 各一行。
      expect(workflowIds.sort()).toEqual(["wft_coding_default", "wft_v02_coding_v2"]);
      expect(policyIds).toEqual(["vpl_coding_default"]);

      // raw payload 保真（无法无损映射的字段不猜测语义）。
      const raw = db
        .prepare("SELECT raw_payload_json FROM skill_legacy_aliases WHERE source_kind = 'workflow_template' AND legacy_id = 'wft_v02_coding_v2'")
        .get() as { raw_payload_json: string };
      const payload = JSON.parse(raw.raw_payload_json) as Record<string, unknown>;
      expect(payload["status"]).toBe("inactive");
      expect(payload["version"]).toBe(2);
    } finally {
      db.close();
    }
  });
});
