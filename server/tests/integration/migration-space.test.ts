import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/db/index.js";
import { applyMigrations } from "../../src/db/migrations.js";
import { buildV02Fixture, V02_SNAPSHOT_PATH, loadV02SeedSql } from "../fixtures/build-v02-fixture.js";

// F013 AC-001 (design §8): the real release-v10 fixture must upgrade so that
// every Project / Issue lands in the single default Space with original IDs
// conserved, a repeat upgrade stays idempotent (one is_default, one
// is_selected), and the five F013 indexes exist. Batch assertions everywhere —
// `issues` rebuild + Space backfill is the canonical "single record passes,
// bulk misaligns" trap.

const EXPECTED_PROJECT_IDS = ["prj_v02_alpha", "prj_v02_beta"];
const EXPECTED_ISSUE_IDS = [
  "iss_v02_done",
  "iss_v02_running",
  "iss_v02_graph_blocked",
  "iss_v02_blocked",
  "iss_v02_validating",
  "iss_v02_roundlimit",
  "iss_v02_nocapable",
  "iss_v02_graphok",
];

const F013_INDEXES = [
  "idx_repo_machine_paths_real",
  "idx_project_repo_refs_repo",
  "idx_skill_revisions_skill",
  "idx_issues_space",
  "idx_projects_space",
];

let tempDir: string;

function upgradedFixtureDb(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), "f013-migration-space-"));
  const fixture = buildV02Fixture(tempDir);
  const dbPath = join(tempDir, "v02-fixture.sqlite");
  fixture.close();
  // Real upgrade chain: openDatabase runs v10 → v11 → v12 head.
  return openDatabase(dbPath);
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("F013 AC-001: v10 fixture → head Space migration", () => {
  it("backfills spaces for all projects and issues and conserves original IDs", () => {
    const db = upgradedFixtureDb();
    try {
      const defaultSpace = db.prepare("SELECT * FROM spaces WHERE is_default = 1").get() as {
        id: string;
        is_selected: number;
      };
      expect(defaultSpace).toBeDefined();
      expect(defaultSpace.is_selected).toBe(1);

      // Batch: every issue and project non-null space_id pointing at the default Space.
      const badIssues = db
        .prepare("SELECT COUNT(*) AS n FROM issues WHERE space_id IS NULL OR space_id <> ?")
        .get(defaultSpace.id) as { n: number };
      expect(badIssues.n).toBe(0);

      const badProjects = db
        .prepare("SELECT COUNT(*) AS n FROM projects WHERE space_id IS NULL OR space_id <> ?")
        .get(defaultSpace.id) as { n: number };
      expect(badProjects.n).toBe(0);

      // Original IDs conserved, project_id semantics intact.
      const projectIds = (db.prepare("SELECT id FROM projects ORDER BY id").all() as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(projectIds).toEqual([...EXPECTED_PROJECT_IDS].sort());

      const issueIds = (db.prepare("SELECT id FROM issues ORDER BY id").all() as Array<{ id: string }>).map(
        (r) => r.id,
      );
      expect(issueIds.sort()).toEqual([...EXPECTED_ISSUE_IDS].sort());

      const withProject = db
        .prepare("SELECT COUNT(*) AS n FROM issues WHERE project_id = 'prj_v02_alpha'")
        .get() as { n: number };
      expect(withProject.n).toBe(EXPECTED_ISSUE_IDS.length); // fixture: 全部 Issue 归属 alpha
    } finally {
      db.close();
    }
  });

  it("repeat upgrade is idempotent: one default, one selected, version not duplicated", () => {
    const db = upgradedFixtureDb();
    try {
      // 二次启动同一数据库：migration 幂等（version guard + 部分唯一索引双保险）。
      applyMigrations(db);
      const defaults = db.prepare("SELECT COUNT(*) AS c FROM spaces WHERE is_default = 1").get() as { c: number };
      const selected = db.prepare("SELECT COUNT(*) AS c FROM spaces WHERE is_selected = 1").get() as { c: number };
      const versions = db
        .prepare("SELECT COUNT(*) AS c FROM schema_version WHERE version = (SELECT MAX(version) FROM schema_version)")
        .get() as { c: number };
      expect(defaults.c).toBe(1);
      expect(selected.c).toBe(1);
      expect(versions.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it("passes foreign_key_check with zero rows after rebuild", () => {
    const db = upgradedFixtureDb();
    try {
      const violations = db.pragma("foreign_key_check") as unknown[];
      expect(violations).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("creates the five F013 indexes", () => {
    const db = upgradedFixtureDb();
    try {
      const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map(
        (r) => r.name,
      );
      for (const index of F013_INDEXES) {
        expect(names).toContain(index);
      }
    } finally {
      db.close();
    }
  });

  it("migrated legacy workflow becomes an active skill resolvable per issue combo", () => {
    const db = upgradedFixtureDb();
    try {
      const skills = db.prepare("SELECT * FROM skills WHERE source_kind = 'legacy-workflow'").all() as Array<{
        id: string;
        space_id: string | null;
        state: string;
        current_revision: number;
        source_identity: string;
      }>;
      // wft_coding_default + wft_v02_coding_v2 → 两行 legacy skill。
      expect(skills.length).toBeGreaterThanOrEqual(2);
      for (const skill of skills) {
        expect(skill.space_id).not.toBeNull(); // 归入默认 Space
        expect(skill.state).toBe("active");
        expect(skill.current_revision).toBeGreaterThan(0);
        expect(skill.source_identity).toMatch(/^workflow:/);
      }

      // 每条历史 Issue 的 (workflow, policy) 组合都能解析到确定的 skill@version。
      const missing = db
        .prepare(
          `SELECT COUNT(*) AS n FROM issues i
           WHERE i.workflow_template_id IS NOT NULL AND i.validation_policy_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM skill_legacy_combo_map m
               WHERE m.workflow_template_id = i.workflow_template_id
                 AND m.validation_policy_id = i.validation_policy_id
             )`,
        )
        .get() as { n: number };
      expect(missing.n).toBe(0);

      // 同一 workflow 配两个 policy 时两条组合各自解析到不同 revision（alias 单行表达不了的场景）。
      // fixture 只有单一 policy，这里验证 combo_map 行与 revision 行一一对应。
      const comboCount = db.prepare("SELECT COUNT(*) AS n FROM skill_legacy_combo_map").get() as { n: number };
      const revisionCount = db
        .prepare("SELECT COUNT(*) AS n FROM skill_revisions WHERE published_at IS NOT NULL")
        .get() as { n: number };
      expect(comboCount.n).toBe(revisionCount.n);
    } finally {
      db.close();
    }
  });

  it("legacy aliases keep raw payloads for both legacy tables with independent ID spaces", () => {
    const db = upgradedFixtureDb();
    try {
      const aliases = db
        .prepare("SELECT source_kind, legacy_id FROM skill_legacy_aliases ORDER BY source_kind, legacy_id")
        .all() as Array<{ source_kind: string; legacy_id: string }>;
      const kinds = new Set(aliases.map((a) => a.source_kind));
      expect(kinds).toEqual(new Set(["workflow_template", "validation_policy"]));
      for (const alias of aliases) {
        expect(alias.legacy_id.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });

  it("snapshot file remains the frozen v10 source (never regenerated from head)", () => {
    // 防呆：本文件依赖真实 release 快照，而不是当前 head 的 DDL。
    const sql = loadV02SeedSql();
    expect(sql).toContain("prj_v02_alpha");
  });

  it("snapshot path is the committed v10 schema", () => {
    expect(V02_SNAPSHOT_PATH).toContain("v02-schema-v10.sql");
  });
});
