import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/db/index.js";
import { buildV02Fixture } from "../fixtures/build-v02-fixture.js";

// F013 AC-001 (design §8 legacy-workspace-migration)：v10 fixture 的
// prj_v02_alpha（两条 workspace）升级后只产生一条 primary；beta 不产生引用；
// 异常数据（default_workspace_id 为 NULL 但存在 workspace）取最早一条并留诊断。

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

function upgraded() {
  tempDir = mkdtempSync(join(tmpdir(), "f013-legacy-ws-"));
  const fixture = buildV02Fixture(tempDir);
  fixture.close();
  return openDatabase(join(tempDir, "v02-fixture.sqlite"));
}

describe("F013 AC-001: legacy workspace → repository reference migration", () => {
  it("prj_v02_alpha gets exactly one primary (read_write) plus one read-only reference", () => {
    const db = upgraded();
    try {
      const refs = db
        .prepare(
          `SELECT r.role, r.access, r.legacy_workspace_id
           FROM project_repository_refs r WHERE r.project_id = 'prj_v02_alpha'
           ORDER BY r.role`,
        )
        .all() as Array<{ role: string; access: string; legacy_workspace_id: string | null }>;
      expect(refs).toHaveLength(2);

      const primaries = refs.filter((r) => r.role === "primary");
      expect(primaries).toHaveLength(1);
      expect(primaries[0].access).toBe("read_write");
      expect(primaries[0].legacy_workspace_id).toBe("ws_v02_alpha");

      const references = refs.filter((r) => r.role === "reference");
      expect(references).toHaveLength(1);
      expect(references[0].access).toBe("read_only");
      // 迁移产生的 reference 同样回填 legacy_workspace_id（历史 Run 可追溯）。
      expect(references[0].legacy_workspace_id).toBe("ws_v02_graphok");
    } finally {
      db.close();
    }
  });

  it("prj_v02_beta (no workspace) produces no references", () => {
    const db = upgraded();
    try {
      const refs = db
        .prepare("SELECT COUNT(*) AS n FROM project_repository_refs WHERE project_id = 'prj_v02_beta'")
        .get() as { n: number };
      expect(refs.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it("migrated rows never fabricate machine-path authorization", () => {
    const db = upgraded();
    try {
      // 迁移只登记仓库与引用：授权行（real_path NOT NULL）只能在显式授权动作中创建。
      const machinePaths = db.prepare("SELECT COUNT(*) AS n FROM repository_machine_paths").get() as { n: number };
      expect(machinePaths.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it("anomalous default_workspace_id=NULL with workspaces picks earliest and writes a diagnostic", () => {
    tempDir = mkdtempSync(join(tmpdir(), "f013-legacy-ws-anomaly-"));
    const dbPath = join(tempDir, "anomaly.sqlite");
    const seed = new Database(dbPath);
    seed.pragma("foreign_keys = ON");
    seed.exec(loadSnapshot());
    // v10：projects.default_workspace_id 置 NULL，但挂两条 workspace。
    const now = "2026-01-01T00:00:00Z";
    seed.prepare("INSERT INTO projects (id, name, default_workspace_id, created_at, updated_at) VALUES ('prj_anom', 'Anom', NULL, ?, ?)").run(now, now);
    // 先插早的再插晚的（created_at 决定选取）。
    seed.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES ('wsp_anom_old', 'prj_anom', '/repo/old', '/repo/old', 'idle', '2026-01-01T00:00:00Z', ?)").run(now);
    seed.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES ('wsp_anom_new', 'prj_anom', '/repo/new', '/repo/new', 'idle', '2026-02-01T00:00:00Z', ?)").run(now);
    seed.close();

    const db = openDatabase(dbPath);
    try {
      const primaries = db
        .prepare("SELECT repository_id, legacy_workspace_id, access FROM project_repository_refs WHERE project_id = 'prj_anom' AND role = 'primary'")
        .all() as Array<{ repository_id: string; legacy_workspace_id: string; access: string }>;
      expect(primaries).toHaveLength(1);
      expect(primaries[0].legacy_workspace_id).toBe("wsp_anom_old"); // created_at 最早
      expect(primaries[0].access).toBe("read_write");

      const diagnostic = db
        .prepare("SELECT COUNT(*) AS n FROM admin_audit_events WHERE action = 'legacy_workspace_migration.default_workspace_missing' AND target_id = 'prj_anom'")
        .get() as { n: number };
      expect(diagnostic.n).toBe(1); // 不静默挑选
    } finally {
      db.close();
    }
  });

  it("two projects sharing one path resolve to the same shared repository row", () => {
    tempDir = mkdtempSync(join(tmpdir(), "f013-legacy-ws-shared-"));
    const dbPath = join(tempDir, "shared.sqlite");
    const seed = new Database(dbPath);
    seed.pragma("foreign_keys = ON");
    seed.exec(loadSnapshot());
    const now = "2026-01-01T00:00:00Z";
    seed.prepare("INSERT INTO projects (id, name, default_workspace_id, created_at, updated_at) VALUES ('prj_a', 'A', 'wsp_a', ?, ?)").run(now, now);
    seed.prepare("INSERT INTO projects (id, name, default_workspace_id, created_at, updated_at) VALUES ('prj_b', 'B', 'wsp_b', ?, ?)").run(now, now);
    seed.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES ('wsp_a', 'prj_a', '/repo/shared', '/repo/shared', 'idle', ?, ?)").run(now, now);
    seed.prepare("INSERT INTO workspaces (id, project_id, local_path, local_path_normalized, lock_state, created_at, updated_at) VALUES ('wsp_b', 'prj_b', '/repo/shared', '/repo/shared', 'idle', ?, ?)").run(now, now);
    seed.close();

    const db = openDatabase(dbPath);
    try {
      const repos = db
        .prepare("SELECT COUNT(DISTINCT repository_id) AS n FROM project_repository_refs")
        .get() as { n: number };
      expect(repos.n).toBe(1); // 仓库事实跨项目共享同一份
    } finally {
      db.close();
    }
  });
});

import { loadV02SnapshotSql as loadSnapshot } from "../fixtures/build-v02-fixture.js";
