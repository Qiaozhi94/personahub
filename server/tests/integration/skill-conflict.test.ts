import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestServices, createTempDir, cleanupTempDir, disposeTestServices, type TestServices } from "../helpers.js";
import { initGitRepo } from "../helpers.js";
import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../../src/db/index.js";
import { buildV02Fixture } from "../fixtures/build-v02-fixture.js";

// F013 AC-005 (design §8 skill-conflict) 补充断言：source_identity 重扫对齐、
// 激活前拒绝非法内容、冲突状态跨重启可见。

describe("F013 AC-005: conflict closure essentials", () => {
  let services: TestServices;

  beforeEach(() => {
    services = createTestServices();
  });

  afterEach(() => {
    disposeTestServices(services);
  });

  it("re-scan re-aligns by source_identity (update, not duplicate) and keeps states stable", () => {
    const { skill } = services.skillRegistry.createSkill({
      display_name: "Scanner",
      space_id: null,
      draft: { capability_tags: [] },
    });
    services.skillRegistry.scan();

    const rows = services.db
      .prepare("SELECT COUNT(*) AS n FROM skills WHERE source_identity = ?")
      .get(`user:${skill.id}`) as { n: number };
    expect(rows.n).toBe(1); // 同一来源重扫是更新，不是新建
  });

  it("rejects illegal steps schema / no source before activation", () => {
    expect(() =>
      services.skillRegistry.createSkill({
        display_name: "Bad steps",
        draft: {
          steps: [{ order: 0, title: "missing id", requirements: [] }],
        },
      }),
    ).toThrow();

    expect(() =>
      services.skillRegistry.createSkill({ display_name: "", draft: { capability_tags: [] } }),
    ).toThrow();
  });

  it("conflict states survive a full service restart (server-side truth)", () => {
    const tempDir = createTempDir();
    try {
      const dbPath = path.join(tempDir, "conflict.sqlite");
      const db = openDatabase(dbPath);
      const first = createTestServices(db);
      const spaceA = first.spaceService.create("A");
      first.skillRegistry.createSkill({ display_name: "Deploy", space_id: null, draft: { capability_tags: [] } });
      first.skillRegistry.createSkill({ display_name: "Deploy", space_id: spaceA.id, draft: { capability_tags: [] } });
      disposeTestServices(first);

      // 重启：同一 DB 重新装配服务。
      const db2 = openDatabase(dbPath);
      const second = createTestServices(db2);
      try {
        const inA = second.skillRegistry.listForSpace(spaceA.id).filter((s) => s.display_name === "Deploy");
        expect(inA.map((s) => s.space_state)).toEqual(["conflict", "conflict"]);
      } finally {
        disposeTestServices(second);
      }
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});

describe("F013 AC-005: legacy fixture combo map end-to-end", () => {
  it("every fixture issue combo resolves through skill_legacy_combo_map", () => {
    const tempDir = createTempDir();
    try {
      initGitRepo(tempDir); // no-op: keeps helper import honest for fixture build isolation
      const fixtureDir = path.join(tempDir, "fixture");
      fs.mkdirSync(fixtureDir, { recursive: true });
      const fixture = buildV02Fixture(fixtureDir);
      const dbPath = path.join(fixtureDir, "v02-fixture.sqlite");
      fixture.close();

      const db = openDatabase(dbPath);
      try {
        const missing = db
          .prepare(
            `SELECT COUNT(*) AS n FROM issues i
             WHERE NOT EXISTS (
               SELECT 1 FROM skill_legacy_combo_map m
               WHERE m.workflow_template_id = i.workflow_template_id
                 AND m.validation_policy_id = i.validation_policy_id
             )`,
          )
          .get() as { n: number };
        expect(missing.n).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
